#pragma once
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <array>
#include <string>
#include "board_parameters.h"

namespace sws {
struct RuntimeConfig {
  double soilWeight=.6,tempWeight=.3,airWeight=.1,threshold=50;
  uint32_t pulses=0,onMs=0,offMs=0,intervalSeconds=0,revision=0;
  bool bound=false;
};
struct SensorReading {
  double temperature=NAN,humidity=NAN,solar=NAN;
  int soil=-1,rain=-1;
  uint32_t sequence=0;
  bool airMeasured=true;
};
struct ChannelStats {
  uint32_t valid=0,failed=0,firstAt=0,lastAt=0;
  double sum=0,minimum=NAN,maximum=NAN,largestStep=0,previous=NAN;
  void add(double value,uint32_t now){
    if(!std::isfinite(value)){failed++;return;}
    if(!valid){firstAt=now;minimum=maximum=value;}
    else {minimum=std::min(minimum,value);maximum=std::max(maximum,value);largestStep=std::max(largestStep,std::abs(value-previous));}
    valid++;sum+=value;previous=value;lastAt=now;
  }
  double mean()const{return valid?sum/valid:NAN;}
};
struct RuntimeIO {
  virtual ~RuntimeIO()=default;
  virtual void pump(bool on)=0;
  virtual bool checkpoint(bool attempting,uint32_t revision)=0;
  virtual void runtimeEvent(const char* code,const char* impact)=0;
};
class WateringRuntime {
  RuntimeIO& io;
  RuntimeConfig cfg;
  SensorReading latest;
  uint32_t lastSampleMs=0,phaseAt=0,roundAt=0,prepareAt=0,pulse=0,lastTick=0;
  uint64_t elapsedMs=0,eligibleMs=0;
  bool samplePresent=false,clockReady=false,storageReady=false,pumpOn=false,stopped=false,prepared=false;
  enum Phase {Idle,On,Off} phase=Idle;
  double temperatureSum=0,humiditySum=0,soilSum=0;
  std::array<ChannelStats,5> prepareStats{};
  std::array<double,5> baselineValues{{NAN,NAN,NAN,NAN,NAN}};
  uint32_t validSamples=0,totalSamples=0;
  std::string mode="DISPLAY",reason="sample-stale";
  static double clamp(double x,double lo,double hi){return std::max(lo,std::min(hi,x));}
  void off(){io.pump(false);pumpOn=false;}
  void finish(const char* code){off();phase=Idle;eligibleMs=elapsedMs+uint64_t(cfg.intervalSeconds)*1000;
    if(!io.checkpoint(false,cfg.revision)){storageReady=false;reason="storage-failed";}
    io.runtimeEvent(code,"水泵已关闭；下一轮受最短间隔约束");}
public:
  explicit WateringRuntime(RuntimeIO& port):io(port){off();}
  bool active()const{return phase!=Idle;}
  bool automaticReady()const{return cfg.bound&&cfg.intervalSeconds>=3600&&storageReady&&clockReady;}
  const std::string& currentMode()const{return mode;}
  const std::string& inhibition()const{return reason;}
  const SensorReading& sample()const{return latest;}
  uint32_t prepareValidSamples()const{return validSamples;}
  uint32_t prepareTotalSamples()const{return totalSamples;}
  double prepareMeanTemperature()const{return validSamples?temperatureSum/validSamples:NAN;}
  double prepareMeanHumidity()const{return validSamples?humiditySum/validSamples:NAN;}
  double prepareMeanSoil()const{return validSamples?soilSum/validSamples:NAN;}
  bool prepareComplete()const{return prepared;}
  double baseline()const{return baselineValues[0];}
  double baselineValue(size_t index)const{return index<baselineValues.size()?baselineValues[index]:NAN;}
  const ChannelStats& prepareChannel(size_t index)const{return prepareStats[index<prepareStats.size()?index:0];}
  void restoreBaseline(double value){baselineValues[0]=std::isfinite(value)&&value>=-20&&value<=60?value:NAN;}
  void restoreBaselines(const std::array<double,5>& values){baselineValues=values;restoreBaseline(values[0]);}
  uint32_t completedPulses()const{return pulse;}
  void storage(bool ready){storageReady=ready;}
  uint64_t intervalRemainingMs()const{return eligibleMs>elapsedMs?eligibleMs-elapsedMs:0;}
  void begin(uint32_t now,bool storage,bool recoveredAttempt=false,uint64_t carriedWaitMs=0){
    lastTick=now;storageReady=storage;eligibleMs=carriedWaitMs;off();
    if(recoveredAttempt){eligibleMs=UINT64_MAX;io.runtimeEvent("watering-interrupted","上次浇水结果待核对，重新校时后等待完整最短间隔");}
  }
  bool configure(const RuntimeConfig& value,bool restoring=false){if(active())return false;cfg=value;
    if(!restoring){prepared=false;baselineValues.fill(NAN);prepareStats={};}
    if(eligibleMs==UINT64_MAX&&clockReady&&cfg.intervalSeconds>=3600)eligibleMs=elapsedMs+uint64_t(cfg.intervalSeconds)*1000;
    if(!restoring)eligibleMs=std::max(eligibleMs,elapsedMs+uint64_t(cfg.intervalSeconds)*1000);return true;}
  void clock(bool trusted){clockReady=trusted;if(trusted&&eligibleMs==UINT64_MAX&&cfg.intervalSeconds>=3600)eligibleMs=elapsedMs+uint64_t(cfg.intervalSeconds)*1000;}
  bool setMode(const std::string& target,uint32_t now){
    if(target!="DISPLAY"&&target!="PREPARE"&&target!="LONGRUN")return false;
    if(target=="LONGRUN"&&!automaticReady())return false;
    if(active())finish("watering-stopped");mode=target;stopped=false;
    if(target=="PREPARE"){prepareAt=now;prepared=false;baselineValues.fill(NAN);validSamples=totalSamples=0;temperatureSum=humiditySum=soilSum=0;prepareStats={};io.runtimeEvent("prepare-started","准备期采样，水泵保持关闭");}
    return true;
  }
  bool soilValid()const{return latest.soil>=SENSOR_ADC_MIN&&latest.soil<=SENSOR_ADC_MAX;}
  bool rainValid()const{return latest.rain>=SENSOR_ADC_MIN&&latest.rain<=SENSOR_ADC_MAX;}
  bool airValid()const{return std::isfinite(latest.temperature)&&latest.temperature>=-20&&latest.temperature<=60
    &&std::isfinite(latest.humidity)&&latest.humidity>=0&&latest.humidity<=100;}
  bool raining()const{return rainValid()&&(RAIN_WET_BELOW?latest.rain<RAIN_THRESHOLD:latest.rain>RAIN_THRESHOLD);}
  double demand()const{
    if(!soilValid()||!rainValid()||!airValid())return NAN;if(raining())return 0;
    double dryness=clamp(100.*latest.soil/4095.,0,100);
    double base=std::isfinite(baseline())?std::max(28.,baseline()):28.;
    return clamp(dryness*cfg.soilWeight+clamp((latest.temperature-base)*100/12,0,100)*cfg.tempWeight
      +(100-latest.humidity)*cfg.airWeight+5,0,100);
  }
  void accept(const SensorReading& value,uint32_t now){
    latest=value;lastSampleMs=now;samplePresent=true;
    if(mode=="PREPARE"){totalSamples++;
      prepareStats[0].add(latest.airMeasured?latest.temperature:NAN,now);
      prepareStats[1].add(latest.airMeasured?latest.humidity:NAN,now);
      prepareStats[2].add(soilValid()?latest.soil:NAN,now);
      prepareStats[3].add(rainValid()?latest.rain:NAN,now);
      prepareStats[4].add(latest.solar,now);
      if(soilValid()&&rainValid()&&airValid()&&latest.airMeasured){
      validSamples++;temperatureSum+=latest.temperature;humiditySum+=latest.humidity;soilSum+=latest.soil;}}
  }
  void stop(){stopped=true;if(active())finish("watering-stopped");else off();mode="DISPLAY";reason="operator-stop";}
  void reset(){stop();cfg=RuntimeConfig{};clockReady=false;eligibleMs=0;samplePresent=false;prepared=false;baselineValues.fill(NAN);prepareStats={};}
  void tick(uint32_t now){
    elapsedMs+=uint32_t(now-lastTick);lastTick=now;
    if(mode=="PREPARE"&&uint32_t(now-prepareAt)>=600000){
      if(validSamples>=10&&double(validSamples)/std::max<uint32_t>(1,totalSamples)>=.8){
        for(size_t i=0;i<baselineValues.size();i++)baselineValues[i]=prepareStats[i].mean();
        prepared=true;io.runtimeEvent("prepare-completed","有效样本达到要求；基准已建立");}
      else io.runtimeEvent("prepare-insufficient","有效样本不足，请检查供电和接线后重新准备");
      mode="DISPLAY";off();return;
    }
    bool recent=samplePresent&&uint32_t(now-lastSampleMs)<=30000;
    if(!storageReady)reason="storage-unavailable";
    else if(!cfg.bound)reason="bound-config-required";else if(!clockReady)reason="time-untrusted";
    else if(!recent)reason="sample-stale";else if(!soilValid())reason="soil-invalid";
    else if(!rainValid())reason="rain-invalid";else if(!airValid())reason="air-invalid";
    else if(raining())reason="rain-detected";else if(stopped)reason="operator-stop";
    else reason="";
    if(active()&&(!reason.empty()||mode!="LONGRUN")){finish("watering-protected");return;}
    if(phase==On&&uint32_t(now-phaseAt)>=cfg.onMs){off();pulse++;phase=Off;phaseAt=now;}
    if(active()&&uint32_t(now-roundAt)>360000){finish("watering-timeout");return;}
    if(phase==Off&&uint32_t(now-phaseAt)>=cfg.offMs){
      if(pulse>=cfg.pulses){finish("watering-completed");return;}
      phase=On;phaseAt=now;io.pump(true);pumpOn=true;return;
    }
    if(phase!=Idle||mode!="LONGRUN"||!reason.empty()||!cfg.pulses||demand()<cfg.threshold)return;
    if(elapsedMs<eligibleMs){reason="minimum-interval";return;}
    if(!io.checkpoint(true,cfg.revision)){storageReady=false;reason="checkpoint-failed";off();return;}
    io.runtimeEvent("watering-started","已记录浇水尝试；开始受保护的脉冲轮次");
    pulse=0;phase=On;phaseAt=roundAt=now;io.pump(true);pumpOn=true;
  }
};
}
