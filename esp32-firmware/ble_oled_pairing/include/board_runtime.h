#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <esp_sleep.h>
#include <esp_system.h>
#include <driver/gpio.h>
#include <sys/time.h>
#include <deque>
#include <vector>
#include "watering_runtime.h"
#include "sensor_quality.h"

struct SleepCheckpoint {uint32_t magic=0,boot=0,revision=0;uint64_t remaining=0;int64_t savedEpoch=0;uint32_t crc=0;};
RTC_DATA_ATTR SleepCheckpoint swsSleep;

class BoardRuntime:public sws::RuntimeIO {
  Preferences prefs;
  bool initialized=false,nvs=false,logs=false,pumpState=false,clockTrusted=false,sampleDone=false,resumed=false;
  std::string deviceId,serialLine;
  sws::RuntimeConfig config;
  sws::WateringRuntime control;
  JsonDocument latest;
  JsonDocument reference;
  uint32_t lastReferenceCheck=0;
  unsigned outsideCount[2]{},insideCount[2]{};
  bool deviating[2]{};
  std::deque<std::string> history,events;
  uint32_t boot=0,seq=0,eventSeq=0,logSeq=0,lastFlush=0,lastHistory=0,nextSample=0,phaseAt=0,lastAdc=0,sampleAt=0;
  uint64_t resumedWait=0;
  int64_t prepareFinishedAt=0;
  bool dirty=false,servoAttached=false,supplySuspected=false,manualPumpOn=false;
  uint32_t manualPumpAt=0;
  unsigned acquisition=0,adcCount=0,servoStage=0;
  int soil[5]{},rain[5]{},solar[5]{};
  double temperature=NAN,humidity=NAN;
  unsigned quickRemaining=0,quickValid=0;
  std::string quickStimulatedKey;
  const char* channelKeys[5]={"temperatureC","humidityPct","soilAdc","rainAdc","solarVoltageV"};
  bool invalidChannel[5]{};
  sws::ChannelQuality channelQuality[5];
  int64_t lastSyncAt=0;
  double deviationSum[2]{},deviationMin[2]{},deviationMax[2]{};
  std::string pack(const std::string& raw){JsonDocument d;d["crc"]=sws::hex32(sws::crc32(raw));d["data"]=raw;return sws::json(d);}
  bool unpack(const std::string& raw,std::string& out){JsonDocument d;if(deserializeJson(d,raw)||!d["data"].is<const char*>())return false;
    out=d["data"].as<std::string>();return d["crc"].as<std::string>()==sws::hex32(sws::crc32(out));}
  bool saveRecord(const char* key,const std::string& raw){if(!nvs)return false;auto blob=pack(raw);
    return prefs.putString(key,blob.c_str())==blob.size()&&prefs.getString(key).c_str()==blob;}
  bool loadRecord(const char* key,std::string& raw){if(!nvs)return false;String value=prefs.getString(key);return value.length()&&unpack(value.c_str(),raw);}
  int64_t epochTime()const{return clockTrusted?time(nullptr):0;}
  static uint32_t crcBytes(uint32_t crc,const std::string& bytes){for(uint8_t b:bytes){crc^=b;for(int n=0;n<8;n++)crc=(crc>>1)^(0xedb88320u&-(crc&1));}return crc;}
  static void trim(std::deque<std::string>& records,size_t count,size_t bytes){size_t total=0;for(auto& row:records)total+=row.size();while(!records.empty()&&(records.size()>count||total>bytes)){total-=records.front().size();records.pop_front();}}
  bool readSnapshot(const String& path,uint32_t& sequence,std::deque<std::string>* samples=nullptr,std::deque<std::string>* messages=nullptr){
    File f=LittleFS.open(path,"r");if(!f||f.size()==0||f.size()>100000)return false;
    f.seek(f.size()-1);if(f.read()!='\n'){f.close();return false;}f.seek(0);
    String header=f.readStringUntil('\n');unsigned long version,expected;unsigned sampleCount,eventCount;
    if(sscanf(header.c_str(),"SWSLOG1 %lu %lx %u %u",&version,&expected,&sampleCount,&eventCount)!=4||sampleCount>168||eventCount>48){f.close();return false;}
    uint32_t crc=0xffffffff;unsigned h=0,e=0;size_t sampleBytes=0,eventBytes=0;
    while(f.available()){
      String line=f.readStringUntil('\n');if(line.length()<2||line.length()>3000){f.close();return false;}
      std::string raw=line.c_str();crc=crcBytes(crc,raw+"\n");JsonDocument row;
      if(deserializeJson(row,raw.substr(1))||!row.is<JsonObject>()){f.close();return false;}
      if(raw[0]=='H'){h++;sampleBytes+=raw.size()-1;if(samples)samples->push_back(raw.substr(1));}
      else if(raw[0]=='E'){e++;eventBytes+=raw.size()-1;if(messages)messages->push_back(raw.substr(1));}
      else {f.close();return false;}
      if(h>168||e>48||sampleBytes>49152||eventBytes>20480){f.close();return false;}
    }f.close();sequence=version;return h==sampleCount&&e==eventCount&&(crc^0xffffffff)==expected;
  }
  void loadLogs(){
    bool existed=false,valid=false;
    for(int slot=0;slot<2;slot++){String path=String("/sws-log-")+slot+".log";if(!LittleFS.exists(path))continue;existed=true;
      std::deque<std::string> samples,messages;uint32_t sequence;
      if(!readSnapshot(path,sequence,&samples,&messages))continue;valid=true;
      if(sequence<logSeq)continue;logSeq=sequence;history.swap(samples);events.swap(messages);
    }if(existed&&!valid)logs=false;
  }
  bool flush(){
    if(!logs||pumpState)return false;if(!dirty)return true;
    trim(history,168,49152);trim(events,48,20480);
    uint32_t crc=0xffffffff;for(auto& raw:history)crc=crcBytes(crc,"H"+raw+"\n");for(auto& raw:events)crc=crcBytes(crc,"E"+raw+"\n");
    char header[80];snprintf(header,sizeof(header),"SWSLOG1 %lu %08lx %u %u\n",(unsigned long)(logSeq+1),(unsigned long)(crc^0xffffffff),unsigned(history.size()),unsigned(events.size()));
    String path=String("/sws-log-")+((logSeq+1)%2)+".log";File f=LittleFS.open(path,"w");if(!f)return false;
    bool written=f.print(header)==strlen(header);
    for(auto& raw:history)written=written&&(f.print('H')==1&&f.print(raw.c_str())==raw.size()&&f.print('\n')==1);
    for(auto& raw:events)written=written&&(f.print('E')==1&&f.print(raw.c_str())==raw.size()&&f.print('\n')==1);
    f.flush();f.close();uint32_t sequence;
    if(!written||!readSnapshot(path,sequence)||sequence!=logSeq+1)return false;logSeq++;dirty=false;lastFlush=millis();return true;
  }
  void quality(JsonObject q,int index,sws::QualityState state,const char* reason){
    auto item=q[channelKeys[index]].to<JsonObject>();item["status"]=sws::qualityName(state);
    if(state!=sws::QualityState::Valid)item["reason"]=reason;
    item["consecutiveFailures"]=channelQuality[index].failureCount();
    item["jumpCount"]=channelQuality[index].jumpCount();
    if(channelQuality[index].lastValidAt())item["lastValidUptimeMs"]=channelQuality[index].lastValidAt();
  }
  static int median(int* values){std::sort(values,values+5);return values[2];}
  bool pulse(uint8_t level,uint32_t& duration){uint32_t start=micros();while(digitalRead(SWS_DHT_PIN)==level){if(uint32_t(micros()-start)>120)return false;}duration=uint32_t(micros()-start);return true;}
  void captureDht(){
    uint8_t data[5]{};uint32_t width;
    digitalWrite(SWS_DHT_PIN,HIGH);delayMicroseconds(30);pinMode(SWS_DHT_PIN,INPUT);
    if(!pulse(HIGH,width)||!pulse(LOW,width)||!pulse(HIGH,width))return;
    for(int bit=0;bit<40;bit++){if(!pulse(LOW,width)||!pulse(HIGH,width))return;data[bit/8]=(data[bit/8]<<1)|(width>45);}
    if(uint8_t(data[0]+data[1]+data[2]+data[3])!=data[4])return;
    if(SWS_DHT_MODEL==22){humidity=((uint16_t(data[0])<<8)|data[1])/10.;temperature=(((uint16_t(data[2]&0x7f)<<8)|data[3])/10.)*((data[2]&0x80)?-1:1);}
    else {humidity=data[0]+data[1]/10.;temperature=data[2]+data[3]/10.;}
    if(temperature<-20||temperature>60||humidity<0||humidity>100)temperature=humidity=NAN;
  }
  void finishSample(uint32_t now){
    bool firstSample=!sampleDone;
    digitalWrite(SWS_SENSOR_POWER_PIN,LOW);pinMode(SWS_DHT_PIN,INPUT);acquisition=0;sampleAt=now;sampleDone=true;
    const double rawTemperature=temperature,rawHumidity=humidity;
    const int rawSoil=median(soil),rawRain=median(rain),millivolts=median(solar);
    const double directSolar=millivolts/1000./SWS_SOLAR_DIVIDER;
    sws::SensorReading s;s.temperature=temperature;s.humidity=humidity;s.soil=rawSoil;s.rain=rawRain;
    s.solar=millivolts<2500?directSolar:NAN;s.sequence=++seq;
    bool directAir=std::isfinite(s.temperature)&&std::isfinite(s.humidity);
    if(s.soil<sws::SENSOR_ADC_MIN||s.soil>sws::SENSOR_ADC_MAX)s.soil=-1;
    if(s.rain<sws::SENSOR_ADC_MIN||s.rain>sws::SENSOR_ADC_MAX)s.rain=-1;
    const double rawValues[]={s.temperature,s.humidity,double(s.soil),double(s.rain),s.solar};
    const bool suppliedFailure=!directAir&&s.soil<0&&s.rain<0;
    const double jumps[]={7,25,950,950,7};
    sws::QualityState states[5];
    for(int i=0;i<5;i++){
      double value=rawValues[i];if(i==2||i==3){if(value<0)value=NAN;}
      states[i]=channelQuality[i].observe(value,true,jumps[i],now);
      if(suppliedFailure)states[i]=sws::QualityState::Suspect;
    }
    if(states[0]!=sws::QualityState::Valid&&states[0]!=sws::QualityState::Stale)s.temperature=NAN;
    if(states[1]!=sws::QualityState::Valid&&states[1]!=sws::QualityState::Stale)s.humidity=NAN;
    if(states[2]!=sws::QualityState::Valid)s.soil=-1;
    if(states[3]!=sws::QualityState::Valid)s.rain=-1;
    if(states[4]!=sws::QualityState::Valid)s.solar=NAN;
    control.accept(s,now);latest.clear();auto row=latest.to<JsonObject>();
    row["bootCount"]=boot;row["sampleSeq"]=seq;row["sampledAt"]=epochTime();row["timeQuality"]=clockTrusted?"trusted":"relative";
    if(lastSyncAt>0)row["lastSyncAt"]=lastSyncAt;else row["lastSyncAt"]=nullptr;
    row["rawSoilAdc"]=rawSoil;row["rawRainAdc"]=rawRain;
    if(std::isfinite(rawTemperature))row["rawTemperatureC"]=rawTemperature;else row["rawTemperatureC"]=nullptr;
    if(std::isfinite(rawHumidity))row["rawHumidityPct"]=rawHumidity;else row["rawHumidityPct"]=nullptr;
    if(std::isfinite(rawTemperature))row["temperatureC"]=rawTemperature;else row["temperatureC"]=nullptr;
    if(std::isfinite(rawHumidity))row["humidityPct"]=rawHumidity;else row["humidityPct"]=nullptr;
    row["soilAdc"]=rawSoil;row["rainAdc"]=rawRain;row["solarVoltageV"]=directSolar;
    row["solarAdcMilliVolts"]=millivolts;
    if(std::isfinite(control.demand()))row["wateringDemand"]=control.demand();else row["wateringDemand"]=nullptr;
    row["rainDetected"]=control.raining();row["watered"]=false;
    auto q=row["quality"].to<JsonObject>();
    for(int i=0;i<5;i++){
      const char* reason=suppliedFailure?"sensor-supply-suspected":
        channelQuality[i].stuckAfterStimulus()?"stuck-after-stimulus":
        i<2?"read-failed":i==4?"voltage-out-of-range":"out-of-range-or-jump";
      quality(q,i,states[i],reason);
      bool abnormal=states[i]==sws::QualityState::Suspect||states[i]==sws::QualityState::Invalid;
      if(abnormal&&!invalidChannel[i])sensorEvent(channelKeys[i],false);
      if(states[i]==sws::QualityState::Valid&&invalidChannel[i])sensorEvent(channelKeys[i],true);
      invalidChannel[i]=abnormal;
    }
    if(suppliedFailure&&!supplySuspected)runtimeEvent("sensor-supply-suspected","共用传感器供电或接线待检查，自动浇水保持抑制");
    if(!suppliedFailure&&supplySuspected)runtimeEvent("sensor-supply-recovered","各通道重新采样；仍需核对质量状态");
    supplySuspected=suppliedFailure;
    if(uint32_t(now-lastReferenceCheck)>=60000){lastReferenceCheck=now;
      for(int i=0;i<2;i++){const char* minKey=i?"humidityMinPct":"temperatureMinC",*maxKey=i?"humidityMaxPct":"temperatureMaxC";
        double value=i?s.humidity:s.temperature;if(reference[minKey].isNull()||!std::isfinite(value)){outsideCount[i]=insideCount[i]=0;continue;}
        bool outside=value<reference[minKey].as<double>()||value>reference[maxKey].as<double>();
        if(outside){insideCount[i]=0;if(!outsideCount[i]){deviationSum[i]=0;deviationMin[i]=deviationMax[i]=value;}outsideCount[i]++;deviationSum[i]+=value;deviationMin[i]=std::min(deviationMin[i],value);deviationMax[i]=std::max(deviationMax[i],value);}
        else {outsideCount[i]=0;insideCount[i]++;}
        if(outsideCount[i]>=3&&!deviating[i]){deviating[i]=true;runtimeEvent("environment-deviation","参考范围持续偏离，请核对现场环境");JsonDocument e;deserializeJson(e,events.back());e["sensorKey"]=channelKeys[i];e["severity"]="warning";e["value"]=value;
          e["referenceMin"]=reference[minKey];e["referenceMax"]=reference[maxKey];e["observedSummary"]["count"]=outsideCount[i];e["observedSummary"]["mean"]=deviationSum[i]/outsideCount[i];e["observedSummary"]["min"]=deviationMin[i];e["observedSummary"]["max"]=deviationMax[i];e["observedSummary"]["windowSeconds"]=(outsideCount[i]-1)*60;e["quality"]="valid";events.back()=sws::json(e);dirty=true;}
        if(insideCount[i]>=3&&deviating[i]){deviating[i]=false;for(auto it=events.rbegin();it!=events.rend();++it){JsonDocument e;deserializeJson(e,*it);if(e["code"]=="environment-deviation"&&e["sensorKey"]==channelKeys[i]&&e["recoveredAt"].isNull()){e["recoveredAt"]=epochTime();e["recoveryValue"]=value;*it=sws::json(e);dirty=true;break;}}}
      }
    }
    if(quickRemaining){if(states[0]==sws::QualityState::Valid&&states[1]==sws::QualityState::Valid&&s.soil>=0&&s.rain>=0)quickValid++;if(--quickRemaining==0){runtimeEvent("quick-check-completed","三轮快速检查已结束，请查看有效样本数");Serial.printf("QUICK_CHECK valid=%u total=3\n",quickValid);}}
    bool retain=(control.currentMode()=="LONGRUN"&&(firstSample||uint32_t(now-lastHistory)>=60000))||(control.currentMode()=="PREPARE"&&uint32_t(now-lastHistory)>=60000);
    if(retain){history.push_back(sws::json(row));trim(history,168,49152);lastHistory=now;dirty=true;}
    nextSample=now+SWS_SAMPLE_INTERVAL_MS;
  }
  void sensorEvent(const char* key,bool recovered){
    if(recovered){for(auto it=events.rbegin();it!=events.rend();++it){JsonDocument e;deserializeJson(e,*it);if(e["sensorKey"]==key&&e["recoveredAt"].isNull()){e["recoveredAt"]=epochTime();*it=sws::json(e);dirty=true;break;}}}
    else {runtimeEvent("sensor-invalid","关键传感器失效时抑制自动浇水");JsonDocument e;deserializeJson(e,events.back());e["sensorKey"]=key;
      if(std::string(key)=="soilAdc"){e["referenceMin"]=sws::SENSOR_ADC_MIN;e["referenceMax"]=sws::SENSOR_ADC_MAX;e["observedSummary"]["value"]=latest["rawSoilAdc"];}
      else if(std::string(key)=="rainAdc"){e["referenceMin"]=sws::SENSOR_ADC_MIN;e["referenceMax"]=sws::SENSOR_ADC_MAX;e["observedSummary"]["value"]=latest["rawRainAdc"];}
      else if(std::string(key)=="temperatureC"){e["referenceMin"]=-20;e["referenceMax"]=60;e["observedSummary"]["value"]=latest["temperatureC"];}
      else if(std::string(key)=="humidityPct"){e["referenceMin"]=0;e["referenceMax"]=100;e["observedSummary"]["value"]=latest["humidityPct"];}
      e["quality"]=latest["quality"][key]["status"];events.back()=sws::json(e);dirty=true;}
  }
  bool startServo(){if(control.active()||pumpState||servoStage)return false;
    servoAttached=ledcAttach(SWS_SERVO_PIN,50,14);if(!servoAttached){runtimeEvent("servo-error","擦拭未执行，请检查 PWM 和供电");return false;}
    ledcWrite(SWS_SERVO_PIN,uint32_t(SWS_SERVO_WIPE_US)*16383/20000);servoStage=1;phaseAt=millis();return true;}
  void reportPumpState(const char* source){
    if(initialized)delayMicroseconds(5);
    Serial.printf("PUMPSTATUS source=%s firmware=%s pin=%u on=%u commandedLevel=%u pinLevel=%d activeLevel=%u initialized=%u\n",
      source,sws::FW_VERSION,unsigned(SWS_PUMP_PIN),unsigned(pumpState),
      unsigned(pumpState?SWS_PUMP_ON_LEVEL:SWS_PUMP_OFF_LEVEL),initialized?digitalRead(SWS_PUMP_PIN):-1,
      unsigned(SWS_PUMP_ON_LEVEL),unsigned(initialized));
  }
  void serialCommand(){
    unsigned count=0;while(Serial.available()&&count++<128){char c=Serial.read();if(c=='\r')continue;
      if(c!='\n'){if(serialLine.size()<2048)serialLine+=c;else serialLine.clear();continue;}
      std::string line=serialLine;serialLine.clear();
      if(line=="STOP"){shutdown();Serial.println("STOPPED");continue;}
      if(line=="SAMPLE"){Serial.println(sws::json(latest).c_str());continue;}
      if(line=="PUMPSTATUS"){reportPumpState("query");continue;}
      if(control.currentMode()!="DISPLAY"||control.active()){Serial.println("DISPLAY_REQUIRED");continue;}
      if(provision&&provision(line))continue;
      if(line=="LOGFORMAT"){logs=LittleFS.format()&&LittleFS.begin(false);history.clear();events.clear();logSeq=0;dirty=true;logs=logs&&flush();control.storage(logs&&nvs);Serial.println(logs?"LOGS_READY":"LOGS_FAILED");}
      else if(line=="WIPE"){Serial.println(startServo()?"WIPE_STARTED":"WIPE_UNAVAILABLE");}
      else Serial.println("UNKNOWN_COMMAND");
    }
  }
public:
  std::function<bool(const std::string&)> provision;
  BoardRuntime():control(*this){}
  void pump(bool on)override{pumpState=on;if(initialized){digitalWrite(SWS_PUMP_PIN,on?SWS_PUMP_ON_LEVEL:SWS_PUMP_OFF_LEVEL);reportPumpState("command");}}
  void manualPumpOff(const char* code="manual-pump-off"){
    if(!manualPumpOn)return;manualPumpOn=false;pump(false);runtimeEvent(code,"手动水泵已关闭");}
  bool checkpoint(bool attempting,uint32_t revision)override{JsonDocument d;d["attempting"]=attempting;d["revision"]=revision;
    d["recordedAt"]=epochTime();return saveRecord("attempt",sws::json(d))&&flush();}
  void runtimeEvent(const char* code,const char* impact)override{
    if(std::string(code)=="prepare-started")prepareFinishedAt=0;
    if(std::string(code)=="prepare-completed"){
      prepareFinishedAt=epochTime();JsonDocument baseline;baseline["revision"]=config.revision;baseline["deviceId"]=deviceId;
      const char* keys[]={"temperatureC","humidityPct","soilAdc","rainAdc","solarVoltageV"};
      for(int i=0;i<5;i++){double value=control.baselineValue(i);if(std::isfinite(value))baseline["channels"][keys[i]]=value;else baseline["channels"][keys[i]]=nullptr;}
      baseline["finishedAt"]=prepareFinishedAt;
      if(!saveRecord("baseline",sws::json(baseline)))logs=false;
    }
    JsonDocument d;d["eventId"]=deviceId+"-"+std::to_string(boot)+"-"+std::to_string(++eventSeq);d["deviceId"]=deviceId;
    d["bootCount"]=boot;d["eventSeq"]=eventSeq;d["code"]=code;
    std::string eventCode=code;d["severity"]=(eventCode.find("invalid")!=std::string::npos||eventCode.find("suspected")!=std::string::npos||eventCode.find("failed")!=std::string::npos)?"warning":"info";
    d["configRevision"]=config.revision;d["occurredAt"]=epochTime();d["recoveredAt"]=nullptr;d["timeQuality"]=clockTrusted?"trusted":"relative";d["controlImpact"]=impact;
    events.push_back(sws::json(d));trim(events,48,20480);dirty=true;Serial.printf("RUNTIME %s\n",code);
    if(std::string(code)=="watering-completed"&&!latest.isNull()){latest["watered"]=true;history.push_back(sws::json(latest));trim(history,168,49152);}
  }
  void begin(const std::string& id){
    deviceId=id;digitalWrite(SWS_PUMP_PIN,SWS_PUMP_OFF_LEVEL);pinMode(SWS_PUMP_PIN,OUTPUT);pinMode(SWS_SENSOR_POWER_PIN,OUTPUT);digitalWrite(SWS_SENSOR_POWER_PIN,LOW);
#if SWS_WAKE_PIN >= 0
    pinMode(SWS_WAKE_PIN,INPUT_PULLUP);
#endif
    gpio_hold_dis(gpio_num_t(SWS_PUMP_PIN));gpio_hold_dis(gpio_num_t(SWS_SENSOR_POWER_PIN));gpio_deep_sleep_hold_dis();
    pinMode(SWS_SERVO_PIN,OUTPUT);digitalWrite(SWS_SERVO_PIN,LOW);gpio_hold_dis(gpio_num_t(SWS_SERVO_PIN));pinMode(SWS_DHT_PIN,INPUT);initialized=true;
    analogReadResolution(12);analogSetPinAttenuation(SWS_SOIL_PIN,ADC_11db);analogSetPinAttenuation(SWS_RAIN_PIN,ADC_11db);analogSetPinAttenuation(SWS_SOLAR_PIN,ADC_11db);
    nvs=prefs.begin("waterrun",false);logs=LittleFS.begin(false);if(logs)loadLogs();
    {std::string raw;JsonDocument d;if(loadRecord("timesync",raw)&&!deserializeJson(d,raw)&&d["lastSyncAt"].as<int64_t>()>1700000000)lastSyncAt=d["lastSyncAt"].as<int64_t>();}
    uint32_t expected=sws::crc32(std::string(reinterpret_cast<char*>(&swsSleep),offsetof(SleepCheckpoint,crc)));
    resumed=esp_reset_reason()==ESP_RST_DEEPSLEEP&&esp_sleep_get_wakeup_cause()!=ESP_SLEEP_WAKEUP_UNDEFINED&&swsSleep.magic==0x53575336&&expected==swsSleep.crc;
    boot=resumed?swsSleep.boot+1:prefs.getUInt("boot",0)+1;if(nvs)prefs.putUInt("boot",boot);
    clockTrusted=resumed&&time(nullptr)>=swsSleep.savedEpoch&&swsSleep.savedEpoch>1700000000;
    uint64_t actual=clockTrusted?uint64_t(time(nullptr)-swsSleep.savedEpoch)*1000:0;
    resumedWait=clockTrusted&&swsSleep.remaining>actual?swsSleep.remaining-actual:0;
    std::string raw;JsonDocument d;bool interrupted=loadRecord("attempt",raw)&&!deserializeJson(d,raw)&&d["attempting"]==true;
    control.begin(millis(),nvs&&logs,interrupted,resumedWait);control.clock(clockTrusted);
    runtimeEvent("boot","上电先关泵；运行前置条件通过后方可自动浇水");
  }
  void configure(JsonVariantConst c,bool restoring=false){auto p=c["params"];config.revision=c["revision"]|0;config.bound=c["configVersion"]=="2.0";
    reference.clear();if(!c["environmentReference"].isNull())reference.set(c["environmentReference"]);for(int i=0;i<2;i++){outsideCount[i]=insideCount[i]=0;deviating[i]=false;deviationSum[i]=0;}
    config.soilWeight=p["soilWeight"]|.6;config.tempWeight=p["tempWeight"]|.3;config.airWeight=p["airWeight"]|.1;config.threshold=p["threshold"]|50.;
    config.pulses=p["pulseCount"]|0;config.onMs=p["pulseOnMs"]|0;config.offMs=p["pulseOffMs"]|0;config.intervalSeconds=p["minWaterIntervalSeconds"]|0;
    control.configure(config,restoring&&resumed&&swsSleep.revision==config.revision);
    if(restoring){std::string raw;JsonDocument d;if(loadRecord("baseline",raw)&&!deserializeJson(d,raw)&&d["revision"]==config.revision
      &&(d["deviceId"].isNull()||d["deviceId"]==deviceId)&&clockTrusted&&d["finishedAt"].as<int64_t>()>0
      &&epochTime()>=d["finishedAt"].as<int64_t>()&&epochTime()-d["finishedAt"].as<int64_t>()<=86400){
        const char* keys[]={"temperatureC","humidityPct","soilAdc","rainAdc","solarVoltageV"};
        std::array<double,5> values{{NAN,NAN,NAN,NAN,NAN}};for(int i=0;i<5;i++)if(!d["channels"][keys[i]].isNull())values[i]=d["channels"][keys[i]].as<double>();
        if(!std::isfinite(values[0])&&!d["temperatureC"].isNull())values[0]=d["temperatureC"].as<double>();
        control.restoreBaselines(values);
      }}
    else prepareFinishedAt=0;
    if(restoring&&resumed&&clockTrusted&&swsSleep.revision==config.revision&&control.setMode("LONGRUN",millis()))startServo();}
  void describe(JsonObject out){out["runtimeProfile"]="watering-board-10-01";out["automaticWatering"]=control.automaticReady();
    auto modes=out["supportedModes"].to<JsonArray>();modes.add("DISPLAY");modes.add("PREPARE");if(control.automaticReady())modes.add("LONGRUN");
    auto caps=out["capabilities"].as<JsonArray>();for(auto s:{"sample-quality","events","time-sync","time-probe","emergency-stop","prepare-summary","quick-check","manual-control"})caps.add(s);
    out["wakeSources"]["timer"]=true;out["wakeSources"]["button"]=SWS_WAKE_PIN>=0;}
  void status(JsonObject out){if(latest.isNull())out["sample"]=nullptr;else out["sample"].set(latest);
    out["sensorState"]=latest.isNull()?"starting":"sampling";
    out["mode"]=control.currentMode();out["automaticWatering"]=control.automaticReady();out["timeQuality"]=clockTrusted?"trusted":"unknown";
    if(lastSyncAt>0)out["lastSyncAt"]=lastSyncAt;else out["lastSyncAt"]=nullptr;
    out["controlState"]=manualPumpOn?"manual-watering":control.active()?"watering":"idle";out["controlInhibition"]=control.inhibition();
    out["manualPumpOn"]=manualPumpOn;out["servoBusy"]=servoStage!=0;
    if(control.intervalRemainingMs()==UINT64_MAX)out["minIntervalRemainingSeconds"]=nullptr;else out["minIntervalRemainingSeconds"]=control.intervalRemainingMs()/1000;
    out["logStorageReady"]=logs;out["quickCheck"]["remainingSamples"]=quickRemaining;out["quickCheck"]["validSamples"]=quickValid;
    if(!quickStimulatedKey.empty())out["quickCheck"]["stimulatedSensorKey"]=quickStimulatedKey;
    out["prepareSummary"]["validSamples"]=control.prepareValidSamples();out["prepareSummary"]["totalSamples"]=control.prepareTotalSamples();
    auto summary=out["prepareSummary"].as<JsonObject>();if(std::isfinite(control.prepareMeanTemperature()))summary["temperatureC"]=control.prepareMeanTemperature();
    if(std::isfinite(control.prepareMeanHumidity()))summary["humidityPct"]=control.prepareMeanHumidity();
    auto channels=summary["channels"].to<JsonObject>();const char* keys[]={"temperatureC","humidityPct","soilAdc","rainAdc","solarVoltageV"};
    for(int i=0;i<5;i++){auto v=channels[keys[i]].to<JsonObject>();const auto& stats=control.prepareChannel(i);
      v["validSamples"]=stats.valid;v["failedSamples"]=stats.failed;
      if(stats.valid){v["mean"]=stats.mean();v["min"]=stats.minimum;v["max"]=stats.maximum;v["largestStep"]=stats.largestStep;v["firstSampleUptimeMs"]=stats.firstAt;v["lastSampleUptimeMs"]=stats.lastAt;}
      else {v["mean"]=nullptr;v["min"]=nullptr;v["max"]=nullptr;}}
    auto baselines=summary["baseline"].to<JsonObject>();for(int i=0;i<5;i++){double value=control.baselineValue(i);if(std::isfinite(value))baselines[keys[i]]=value;else baselines[keys[i]]=nullptr;}
    summary["complete"]=control.prepareComplete();summary["finishedAt"]=prepareFinishedAt;summary["durationSeconds"]=control.prepareComplete()?600:0;summary["bootCount"]=boot;summary["configRevision"]=config.revision;}
  bool modeAllowed(const std::string& mode){return mode=="DISPLAY"||mode=="PREPARE"||(mode=="LONGRUN"&&control.automaticReady());}
  bool changeMode(const std::string& mode){if(!modeAllowed(mode))return false;manualPumpOff();if(mode!="LONGRUN")shutdown();if(!control.setMode(mode,millis()))return false;sampleDone=false;nextSample=0;if(mode=="LONGRUN")startServo();return true;}
  bool active()const{return control.active()||manualPumpOn;}
  std::string mode()const{return control.currentMode();}
  bool displayRows(std::string& second,std::string& third){
    if(latest.isNull())return false;char text[40];
    if(control.currentMode()=="PREPARE"){second="准备期有效样本";snprintf(text,sizeof(text),"%lu / %lu",(unsigned long)control.prepareValidSamples(),(unsigned long)control.prepareTotalSamples());third=text;return true;}
    if(control.active()){second="正在脉冲浇水";snprintf(text,sizeof(text),"%lu / %lu",(unsigned long)control.completedPulses(),(unsigned long)config.pulses);third=text;return true;}
    if((millis()/2000)%2==0){snprintf(text,sizeof(text),"T%.1f H%.1f",latest["temperatureC"].isNull()?NAN:latest["temperatureC"].as<double>(),latest["humidityPct"].isNull()?NAN:latest["humidityPct"].as<double>());second=text;}
    else {snprintf(text,sizeof(text),"S%d R%d",latest["soilAdc"]|-1,latest["rainAdc"]|-1);second=text;}
    third=control.currentMode();return true;
  }
  int request(const std::string& action,JsonVariantConst p,JsonObject out,std::string& error){
    if(action=="manualServo"){
      if(control.currentMode()!="DISPLAY"||control.active()||manualPumpOn){error="请先进入展示模式并关闭水泵";return -1;}
      if(servoStage){error="舵机正在执行上一次动作";return -1;}
      if(!startServo()){error="舵机 PWM 启动失败，请检查接线与供电";return -1;}
      out["started"]=true;out["durationMs"]=SWS_SERVO_MOVE_MS*2;return 1;
    }
    if(action=="manualPump"){
      if(!p["on"].is<bool>()){error="水泵命令缺少开关状态";return -1;}
      if(control.currentMode()!="DISPLAY"||control.active()||servoStage){error="请先进入展示模式并等待舵机停止";return -1;}
      bool on=p["on"].as<bool>();
      if(on){pump(true);if(!manualPumpOn){manualPumpOn=true;manualPumpAt=millis();runtimeEvent("manual-pump-on","手动水泵已开启，30 秒后自动关闭");}}
      else if(manualPumpOn)manualPumpOff();else pump(false);
      out["pumpOn"]=manualPumpOn;out["maxRunSeconds"]=30;return 1;
    }
    if(action=="quickCheck"){
      if(control.currentMode()!="DISPLAY"||active()){error="快速检查需先停止浇水并进入展示模式";return -1;}
      std::string key=p["stimulatedSensorKey"]|"";int channel=-1;
      if(!key.empty()){
        for(int i=0;i<5;i++)if(key==channelKeys[i])channel=i;
        if(channel<0){error="检查通道无效";return -1;}
        if(!channelQuality[channel].provoke()){error="先读取一次有效采样，再开始受刺激检查";return -1;}
      }
      quickStimulatedKey=key;quickRemaining=3;quickValid=0;nextSample=0;out["started"]=true;
      if(channel>=0)out["stimulatedSensorKey"]=key;
      return 1;
    }
    if(action=="stop"){shutdown();out["stopped"]=true;return 1;}
    if(action=="timeProbe"){out["deviceUptimeMs"]=millis();out["clockTrusted"]=clockTrusted;return 1;}
    if(action=="syncTime"){
      if(control.active()){error="设备正在浇水，暂停校时";return -1;}
      uint64_t correctedMs=0;uint32_t estimate=0;
      if(!p["sentAtEpochMs"].isNull()){
        if(!sws::finiteNumber(p["sentAtEpochMs"],1700000000000.,4102444800000.,true)||
           !sws::finiteNumber(p["estimatedOneWayMs"],0,2000,true)){error="校时参数无效";return -1;}
        estimate=p["estimatedOneWayMs"].as<uint32_t>();correctedMs=p["sentAtEpochMs"].as<uint64_t>()+estimate;
      }else if(sws::finiteNumber(p["epochSeconds"],1700000000,4102444800,true))correctedMs=p["epochSeconds"].as<uint64_t>()*1000;
      else {error="校时参数无效";return -1;}
      timeval t{time_t(correctedMs/1000),suseconds_t((correctedMs%1000)*1000)};
      if(settimeofday(&t,nullptr)!=0){error="设备校时失败";return -1;}
      clockTrusted=true;lastSyncAt=time(nullptr);control.clock(true);
      JsonDocument stamp;stamp["lastSyncAt"]=lastSyncAt;if(!saveRecord("timesync",sws::json(stamp))){error="校时记录保存失败";return -1;}
      out["synchronized"]=true;out["epochSeconds"]=lastSyncAt;out["latencyEstimateMs"]=estimate;return 1;}
    if(action!="history"&&action!="events")return 0;auto& records=action=="history"?history:events;
    size_t offset=0;std::string cursor=p["cursor"]|"";if(!cursor.empty()){
      if(cursor.find_first_not_of("0123456789")!=std::string::npos||cursor.size()>6){error="分页游标无效";return -1;}offset=strtoul(cursor.c_str(),nullptr,10);}
    if(offset>records.size()){error="记录已变化，请重新读取";return -1;}size_t limit=24;if(!p["limit"].isNull()){
      if(!sws::finiteNumber(p["limit"],1,24,true)){error="分页上限无效";return -1;}limit=p["limit"].as<size_t>();}
    out["deviceId"]=deviceId;auto rows=out["records"].to<JsonArray>();size_t end=std::min(records.size(),offset+limit);
    for(size_t i=offset;i<end;i++){JsonDocument row;if(!deserializeJson(row,records[i])){rows.add(row.as<JsonVariantConst>());
      if(sws::json(out).size()>5000){rows.remove(rows.size()-1);end=i;break;}}}
    if(end<records.size())out["nextCursor"]=std::to_string(end);else out["nextCursor"]=nullptr;return 1;
  }
  void shutdown(){manualPumpOff();control.stop();digitalWrite(SWS_SENSOR_POWER_PIN,LOW);pinMode(SWS_DHT_PIN,INPUT);acquisition=0;if(servoAttached)ledcDetach(SWS_SERVO_PIN);pinMode(SWS_SERVO_PIN,OUTPUT);digitalWrite(SWS_SERVO_PIN,LOW);servoAttached=false;servoStage=0;flush();}
  bool erase(){shutdown();control.reset();config=sws::RuntimeConfig{};clockTrusted=false;lastSyncAt=0;swsSleep={};bool ok=nvs&&prefs.clear();
    for(int slot=0;slot<2;slot++){String path=String("/sws-log-")+slot+".log";if(LittleFS.exists(path)&&!LittleFS.remove(path))ok=false;}
    history.clear();events.clear();logSeq=0;dirty=true;return ok&&flush();}
  void tick(uint32_t now,bool linked,bool txIdle){
    serialCommand();control.storage(nvs&&logs);control.tick(now);
    if(manualPumpOn&&uint32_t(now-manualPumpAt)>=30000)manualPumpOff("manual-pump-timeout");
    if(servoStage&&uint32_t(now-phaseAt)>=SWS_SERVO_MOVE_MS){if(servoStage==1){ledcWrite(SWS_SERVO_PIN,uint32_t(SWS_SERVO_PARK_US)*16383/20000);servoStage=2;phaseAt=now;}
      else {ledcDetach(SWS_SERVO_PIN);servoAttached=false;servoStage=0;runtimeEvent("wipe-completed","舵机擦拭命令已完成，需以实物动作验收");}}
    bool waitForSleep=control.currentMode()=="LONGRUN"&&sampleDone&&!control.active()&&!linked;
    if(!waitForSleep&&!servoStage&&acquisition==0&&int32_t(now-nextSample)>=0){digitalWrite(SWS_SENSOR_POWER_PIN,HIGH);temperature=humidity=NAN;acquisition=1;phaseAt=now;}
    if(acquisition==1&&uint32_t(now-phaseAt)>=SWS_SENSOR_SETTLE_MS){pinMode(SWS_DHT_PIN,OUTPUT);digitalWrite(SWS_DHT_PIN,LOW);acquisition=2;phaseAt=now;}
    if(acquisition==2&&uint32_t(now-phaseAt)>=(SWS_DHT_MODEL==22?2:20)){captureDht();adcCount=0;acquisition=3;lastAdc=now;}
    if(acquisition==3&&uint32_t(now-lastAdc)>=5){lastAdc=now;soil[adcCount]=analogRead(SWS_SOIL_PIN);rain[adcCount]=analogRead(SWS_RAIN_PIN);solar[adcCount]=analogReadMilliVolts(SWS_SOLAR_PIN);if(++adcCount==5)finishSample(now);}
    if(logs&&dirty&&!pumpState&&uint32_t(now-lastFlush)>=60000){lastFlush=now;if(!flush()){logs=false;control.storage(false);runtimeEvent("log-storage-failed","日志保存失败，自动浇水暂停");}}
    if(control.currentMode()=="LONGRUN"&&sampleDone&&!control.active()&&!linked&&txIdle&&uint32_t(now-sampleAt)>=10000&&control.automaticReady()){
      if(!flush()){logs=false;return;}digitalWrite(SWS_PUMP_PIN,SWS_PUMP_OFF_LEVEL);digitalWrite(SWS_SENSOR_POWER_PIN,LOW);pinMode(SWS_DHT_PIN,INPUT);
      swsSleep={};swsSleep.magic=0x53575336;swsSleep.boot=boot;swsSleep.revision=config.revision;swsSleep.remaining=control.intervalRemainingMs();swsSleep.savedEpoch=time(nullptr);
      swsSleep.crc=sws::crc32(std::string(reinterpret_cast<char*>(&swsSleep),offsetof(SleepCheckpoint,crc)));
       if(esp_sleep_enable_timer_wakeup(7200ULL*1000000)==ESP_OK){
#if SWS_WAKE_PIN >= 0
         // A held button is handled while awake; wait for release before arming level wake.
         if(digitalRead(SWS_WAKE_PIN)==LOW)return;
         if(esp_deep_sleep_enable_gpio_wakeup(1ULL<<SWS_WAKE_PIN,ESP_GPIO_WAKEUP_GPIO_LOW)!=ESP_OK){runtimeEvent("wake-pin-error","外部唤醒引脚配置失败，保持设备在线");return;}
#endif
         pinMode(SWS_SERVO_PIN,OUTPUT);digitalWrite(SWS_SERVO_PIN,LOW);gpio_hold_en(gpio_num_t(SWS_PUMP_PIN));gpio_hold_en(gpio_num_t(SWS_SENSOR_POWER_PIN));gpio_hold_en(gpio_num_t(SWS_SERVO_PIN));gpio_deep_sleep_hold_en();Serial.flush();esp_deep_sleep_start();}
    }
  }
};
