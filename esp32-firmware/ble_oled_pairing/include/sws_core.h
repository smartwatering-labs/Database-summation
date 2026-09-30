#pragma once
// Same code is compiled for ESP32 and the native browser-contract test harness.
#include <ArduinoJson.h>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <string>
#include <cstdio>
#include <cstring>
#include <algorithm>

namespace sws {
constexpr size_t MAX_MESSAGE=8192, MAX_CONFIG=6144, FRAME_BYTES=120, MAX_PARTS=70, MAX_LINE=512;
constexpr uint32_t FRAME_TIMEOUT=20000, NONCE_TIMEOUT=30000, OP_TIMEOUT=30000;
constexpr const char* PROTOCOL="SWS-BLE";
constexpr const char* VERSION="1.0";
constexpr const char* FW_VERSION="3.4.0";
inline std::string json(JsonVariantConst value) {std::string out;serializeJson(value,out);return out;}
inline uint32_t crc32(const std::string& bytes) {
  uint32_t crc=0xffffffff;
  for(uint8_t b:bytes){crc^=b;for(int n=0;n<8;n++)crc=(crc>>1)^(0xedb88320u&-(crc&1));}
  return crc^0xffffffff;
}
inline std::string hex32(uint32_t value){char s[9];snprintf(s,sizeof(s),"%08lx",static_cast<unsigned long>(value));return s;}
constexpr const char* B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
inline std::string base64(const std::string& bytes) {
  std::string out;out.reserve((bytes.size()+2)/3*4);
  for(size_t i=0;i<bytes.size();i+=3){
    uint32_t n=uint8_t(bytes[i])<<16;
    if(i+1<bytes.size())n|=uint8_t(bytes[i+1])<<8;
    if(i+2<bytes.size())n|=uint8_t(bytes[i+2]);
    out+=B64[(n>>18)&63];out+=B64[(n>>12)&63];out+=i+1<bytes.size()?B64[(n>>6)&63]:'=';out+=i+2<bytes.size()?B64[n&63]:'=';
  }return out;
}
inline bool unbase64(const std::string& text,std::string& out) {
  out.clear();if(text.empty()||text.size()%4||text.size()>160)return false;
  for(size_t i=0;i<text.size();i+=4){
    int v[4];for(int j=0;j<4;j++){const char c=text[i+j];const char* p=c?strchr(B64,c):nullptr;v[j]=p?int(p-B64):-1;}
    bool p2=text[i+2]=='=',p3=text[i+3]=='=';
    if(v[0]<0||v[1]<0||(!p2&&v[2]<0)||(!p3&&v[3]<0)|| (p2&&!p3)||((p2||p3)&&i+4!=text.size()))return false;
    if((p2&&(v[1]&15))||(!p2&&p3&&(v[2]&3)))return false;
    uint32_t n=(v[0]<<18)|(v[1]<<12)|((p2?0:v[2])<<6)|(p3?0:v[3]);
    out+=char(n>>16);if(!p2)out+=char(n>>8);if(!p3)out+=char(n);
  }return true;
}
inline bool validId(const std::string& id){return !id.empty()&&id.size()<=80;}
inline bool finiteNumber(JsonVariantConst v,double low,double high,bool integer=false) {
  if(v.is<bool>()||!v.is<double>())return false;
  double x=v.as<double>();return std::isfinite(x)&&x>=low&&x<=high&&(!integer||std::floor(x)==x);
}
inline bool validConfig(JsonVariantConst config,std::string& error) {
  auto fail=[&](const char* why){error=why;return false;};
  if(!config.is<JsonObjectConst>()||config["deviceModel"]!="ESP32-WATER-C3"||config["configVersion"]!="1.0"||
     (!config["protocolVersion"].isNull()&&config["protocolVersion"]!="1.0"))return fail("配置型号或版本不兼容");
  if(!finiteNumber(config["revision"],1,2147483647,true))return fail("配置 revision 无效");
  if(!config["plant"].is<const char*>()||config["plant"].as<std::string>().empty()||config["plant"].as<std::string>().size()>600)return fail("植物名称无效");
  auto p=config["params"];
  double sum=0;for(const char* key:{"soilWeight","tempWeight","airWeight"}){if(!finiteNumber(p[key],0,1))return fail("权重必须为 0–1 的数值");sum+=p[key].as<double>();}
  if(std::abs(sum-1)>0.015)return fail("三项权重之和必须为 1");
  if(!finiteNumber(p["threshold"],20,90)||!finiteNumber(p["pulseCount"],1,12,true)||
     !finiteNumber(p["pulseOnMs"],500,5000,true)||!finiteNumber(p["pulseOffMs"],5000,60000,true))return fail("脉冲或阈值超出范围");
  if(p["pulseCount"].as<uint32_t>()*(p["pulseOnMs"].as<uint32_t>()+p["pulseOffMs"].as<uint32_t>())>360000)return fail("单轮时长超过六分钟");
  if(!config["supplyVariant"].isNull()&&config["supplyVariant"]!="builtin"&&config["supplyVariant"]!="valve")return fail("供水变体无效");
  if(!config["display"].isNull()&&!config["display"].is<JsonObjectConst>())return fail("display 必须是对象");
  for(const char* key:{"dailyWaterNeedMl","roundWaterMl","estimatedIntervalDays","reservoirDays","flowRateMlSec"})
    if(!config["display"][key].isNull()&&!finiteNumber(config["display"][key],0,1000000))return fail("展示数值无效");
  if(json(config).size()>MAX_CONFIG)return fail("配置超过设备 6144 字节容量");
  return true;
}

using FrameSink=std::function<bool(const std::string&)>;
inline bool frames(JsonVariantConst message,const FrameSink& sink) {
  std::string raw=json(message),id=message["id"].as<std::string>();
  if(!validId(id)||raw.size()>MAX_MESSAGE)return false;
  auto checksum=hex32(crc32(raw));size_t total=(raw.size()+FRAME_BYTES-1)/FRAME_BYTES;
  for(size_t i=0;i<total;i++){
    JsonDocument f;f["id"]=id;f["index"]=i;f["total"]=total;f["checksum"]=checksum;f["data"]=base64(raw.substr(i*FRAME_BYTES,FRAME_BYTES));
    if(!sink(json(f)+"\n"))return false;
  }return true;
}

class Receiver {
  std::string line,id,checksum;
  std::array<std::string,MAX_PARTS> parts;
  std::array<bool,MAX_PARTS> present{};
  size_t total=0,count=0,size=0;
  uint32_t started=0,lineStarted=0;
  bool dropping=false;
  void fail(const char* why){auto old=id;reset();onError(old,why);}
  void accept(const std::string& text,uint32_t now) {
    JsonDocument f;
    if(deserializeJson(f,text,DeserializationOption::NestingLimit(4))||!f.is<JsonObject>()){fail("分包 JSON 无效");return;}
    if(!f["id"].is<const char*>()||!f["checksum"].is<const char*>()||!f["data"].is<const char*>()){fail("分包字段类型无效");return;}
    auto fid=f["id"].as<std::string>(),crc=f["checksum"].as<std::string>();
    if(!validId(fid)||crc.size()!=8||crc.find_first_not_of("0123456789abcdef")!=std::string::npos||
       !finiteNumber(f["total"],1,MAX_PARTS,true)||!finiteNumber(f["index"],0,MAX_PARTS-1,true)){fail("分包范围无效");return;}
    size_t n=f["total"].as<size_t>(),index=f["index"].as<size_t>();
    if(index>=n){fail("分包序号无效");return;}
    if(id.empty()){id=fid;checksum=crc;total=n;started=now;}
    if(id!=fid||checksum!=crc||total!=n){fail("分包消息或元数据不一致");return;}
    std::string part;if(!unbase64(f["data"].as<std::string>(),part)){fail("Base64 分包无效");return;}
    if(present[index]){if(parts[index]!=part)fail("重复分包内容不同");return;}
    if(size+part.size()>MAX_MESSAGE){fail("消息超过设备容量");return;}
    parts[index]=part;present[index]=true;size+=part.size();count++;onProgress(count,total);
    if(count!=total)return;
    std::string raw;raw.reserve(size);for(size_t i=0;i<total;i++)raw+=parts[i];
    auto expected=id;bool valid=hex32(crc32(raw))==checksum;reset();
    if(!valid){onError(expected,"消息 CRC32 校验失败");return;}
    JsonDocument message;
    if(deserializeJson(message,raw,DeserializationOption::NestingLimit(12))||!message.is<JsonObject>()||message["id"].as<std::string>()!=expected){onError(expected,"业务消息编号或 JSON 无效");return;}
    onMessage(message.as<JsonVariantConst>());
  }
public:
  std::function<void(JsonVariantConst)> onMessage=[](JsonVariantConst){};
  std::function<void(const std::string&,const char*)> onError=[](const std::string&,const char*){};
  std::function<void(size_t,size_t)> onProgress=[](size_t,size_t){};
  void reset(){line.clear();id.clear();checksum.clear();for(auto& p:parts)p.clear();present.fill(false);total=count=size=0;dropping=false;}
  void tick(uint32_t now){if((!id.empty()&&uint32_t(now-started)>FRAME_TIMEOUT)||(!line.empty()&&uint32_t(now-lineStarted)>FRAME_TIMEOUT))fail("分包接收超时");}
  void push(const uint8_t* bytes,size_t length,uint32_t now){
    tick(now);
    for(size_t i=0;i<length;i++){
      char c=char(bytes[i]);if(dropping){if(c=='\n')dropping=false;continue;}
      if(c=='\n'){auto ready=line;line.clear();if(!ready.empty())accept(ready,now);}
      else if(c=='\0'||line.size()>=MAX_LINE){fail("分包行超限或含空字节");dropping=true;}
      else {if(line.empty())lineStarted=now;line+=c;}
    }
  }
};

// All methods run on the main application task, never in a NimBLE callback.
struct Platform {
  virtual ~Platform()=default;
  virtual uint32_t now()=0;
  virtual std::string randomToken()=0;
  virtual std::string hash(const std::string& nonce)=0;
  virtual bool load(std::string& config)=0;
  virtual bool save(const std::string& config)=0;
  virtual bool erase()=0;
  virtual bool storageReady()=0;
  virtual void event(const char* stage)=0;
  virtual void rebootAfterReply()=0;
};
class Endpoint {
  Platform& hw;
  std::string deviceId,nonce,opToken,operation,targetMode;
  uint32_t nonceAt=0,opAt=0;
  bool authenticated=false;
  JsonDocument config;
  std::string mode="DISPLAY";
  void respond(const std::string& id,const char* status,JsonVariantConst payload,const char* message=nullptr,const char* stage=nullptr){
    JsonDocument out;out["id"]=id;out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;out["status"]=status;
    if(!payload.isNull())out["payload"].set(payload);if(message)out["message"]=message;if(stage)out["stage"]=stage;emit(out);
  }
public:
  std::function<void(JsonVariantConst)> emit=[](JsonVariantConst){};
  Endpoint(Platform& platform,const std::string& id):hw(platform),deviceId(id){}
  bool restore(){std::string raw,error;if(!hw.load(raw))return false;if(raw.empty())return true;
    if(deserializeJson(config,raw)||!validConfig(config,error)){config.clear();return false;}return true;}
  uint32_t revision()const{return config["revision"]|uint32_t(0);}
  JsonVariantConst configuration()const{return config.as<JsonVariantConst>();}
  const std::string& currentMode()const{return mode;}
  bool authorized()const{return authenticated;}
  void resetSession(){authenticated=false;nonce.clear();opToken.clear();operation.clear();}
  void error(const std::string& id,const char* message){hw.event("error");if(validId(id))respond(id,"error",JsonVariantConst(),message);}
  void handle(JsonVariantConst request){
    std::string id=request["id"]|"";
    if(!validId(id))return;
    if(request["protocol"]!=PROTOCOL||request["protocolVersion"]!=VERSION){error(id,"协议不兼容");return;}
    if(!request["action"].is<const char*>()||!request["payload"].is<JsonObjectConst>()){error(id,"请求结构无效");return;}
    std::string action=request["action"].as<std::string>();auto p=request["payload"];
    JsonDocument response;auto out=response.to<JsonObject>();
    if(action=="handshake"){
      resetSession();nonce=hw.randomToken();nonceAt=hw.now();out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;
      out["deviceId"]=deviceId;out["model"]="ESP32-C3";out["fwVersion"]=FW_VERSION;out["nonce"]=nonce;
      out["runtimeProfile"]="configuration-oled";out["automaticWatering"]=false;
      auto modes=out["supportedModes"].to<JsonArray>();modes.add("DISPLAY");modes.add("PREPARE");
      auto cap=out["capabilities"].to<JsonArray>();for(const char* s:{"status","configuration","history","confirmed-operations","oled"})cap.add(s);
      auto limits=out["transport"].to<JsonObject>();limits["maxMessageBytes"]=MAX_MESSAGE;limits["maxConfigBytes"]=MAX_CONFIG;limits["maxFrames"]=MAX_PARTS;limits["framePayloadBytes"]=FRAME_BYTES;limits["writeChunkBytes"]=20;
      hw.event("handshake");respond(id,"ok",out);return;
    }
    if(action=="authenticate"){
      std::string value=p["auth"]|"";auto challenge=nonce;nonce.clear();authenticated=false;
      if(challenge.empty()||uint32_t(hw.now()-nonceAt)>NONCE_TIMEOUT||value.size()!=64){error(id,"认证随机数失效，请重新握手");return;}
      auto expected=hw.hash(challenge);if(expected.size()!=64){error(id,"设备认证计算失败");return;}
      uint8_t diff=0;for(size_t i=0;i<64;i++)diff|=value[i]^expected[i];
      if(diff){error(id,"认证失败，请重新握手");return;}
      authenticated=true;out["authenticated"]=true;hw.event("authenticated");respond(id,"ok",out);return;
    }
    if(!authenticated){error(id,"请先完成握手认证");return;}
    if(action=="status"){
      out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;out["deviceId"]=deviceId;out["fwVersion"]=FW_VERSION;
      out["mode"]=mode;out["configRevision"]=revision();out["configured"]=revision()>0;out["plant"]=config["plant"]|"";
      out["sample"]=nullptr;out["sensorState"]="not-configured";out["automaticWatering"]=false;
      out["storageReady"]=hw.storageReady();out["uptimeSeconds"]=hw.now()/1000;out["bluetoothConnected"]=true;out["authenticated"]=true;
      respond(id,"ok",out);return;
    }
    if(action=="getConfiguration"){if(revision())out["config"].set(config);else out["config"]=nullptr;respond(id,"ok",out);return;}
    if(action=="history"){
      out["deviceId"]=deviceId;out["records"].to<JsonArray>();out["nextCursor"]=nullptr;out["source"]="no-sensor-data";respond(id,"ok",out);return;
    }
    if(action=="setConfiguration"){
      std::string reason;auto incoming=p["config"];
      if(!validConfig(incoming,reason)){error(id,reason.c_str());return;}
      if(incoming["revision"].as<uint32_t>()<=revision()){error(id,"配置版本未递增，请重新生成");return;}
      hw.event("validating");respond(id,"progress",JsonVariantConst(),nullptr,"validating");
      auto raw=json(incoming);
      if(!hw.save(raw)){error(id,"NVS 写入或回读校验失败，未确认保存");return;}
      config.set(incoming);authenticated=false;hw.event("saved");out["saved"]=true;out["revision"]=revision();respond(id,"ok",out);return;
    }
    if(action=="prepareOperation"){
      operation=p["operation"]|"";targetMode=p["mode"]|"";opToken.clear();
      if(operation!="mode"&&operation!="restart"&&operation!="factoryReset"){error(id,"未知设备操作");return;}
      if(operation=="mode"&&targetMode!="DISPLAY"&&targetMode!="PREPARE"){error(id,"当前通信固件尚未启用自动浇水，不能进入 LONGRUN");return;}
      opToken=hw.randomToken();opAt=hw.now();out["confirmationToken"]=opToken;out["expiresInSeconds"]=30;respond(id,"ok",out);return;
    }
    if(action=="confirmOperation"){
      std::string token=p["confirmationToken"]|"",expected=opToken;opToken.clear();
      if(expected.empty()||token!=expected||uint32_t(hw.now()-opAt)>OP_TIMEOUT){error(id,"确认令牌无效或过期");return;}
      if(operation=="mode")mode=targetMode;
      if(operation=="factoryReset"){
        if(!hw.erase()){error(id,"NVS 清除失败，设备未恢复出厂");return;}
        config.clear();mode="DISPLAY";hw.event("reset");
      }
      out["confirmed"]=true;out["mode"]=mode;respond(id,"ok",out);
      if(operation!="mode")hw.rebootAfterReply();else hw.event("mode");return;
    }
    error(id,"未知操作");
  }
};
} // namespace sws
