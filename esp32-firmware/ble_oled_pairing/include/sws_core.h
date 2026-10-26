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
constexpr const char* FW_VERSION="3.8.0";
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
inline bool sameDigest(const std::string& left,const std::string& right){if(left.size()!=64||right.size()!=64)return false;uint8_t diff=0;for(size_t i=0;i<64;i++)diff|=left[i]^right[i];return diff==0;}
inline bool unbase64Message(const std::string& text,std::string& out){out.clear();if(text.size()>12000||text.size()%4)return false;
  for(size_t i=0;i<text.size();i+=160){std::string part;if(!unbase64(text.substr(i,160),part))return false;out+=part;}return out.size()<=MAX_MESSAGE;}
inline bool finiteNumber(JsonVariantConst v,double low,double high,bool integer=false) {
  if(v.is<bool>()||!v.is<double>())return false;
  double x=v.as<double>();return std::isfinite(x)&&x>=low&&x<=high&&(!integer||std::floor(x)==x);
}
inline bool validConfig(JsonVariantConst config,std::string& error,const std::string& expectedDeviceId="") {
  auto fail=[&](const char* why){error=why;return false;};
  const bool v2=config["configVersion"]=="2.0";
  if(!config.is<JsonObjectConst>()||config["deviceModel"]!="ESP32-WATER-C3"||(!v2&&config["configVersion"]!="1.0")||
     (!config["protocolVersion"].isNull()&&config["protocolVersion"]!="1.0"))return fail("配置型号或版本不兼容");
  if(!finiteNumber(config["revision"],1,2147483647,true))return fail("配置 revision 无效");
  if(!config["plant"].is<const char*>()||config["plant"].as<std::string>().empty()||config["plant"].as<std::string>().size()>600)return fail("植物名称无效");
  auto p=config["params"];
  double sum=0;for(const char* key:{"soilWeight","tempWeight","airWeight"}){if(!finiteNumber(p[key],0,1))return fail("权重必须为 0–1 的数值");sum+=p[key].as<double>();}
  if(std::abs(sum-1)>0.015)return fail("三项权重之和必须为 1");
  if(!finiteNumber(p["threshold"],20,90)||!finiteNumber(p["pulseCount"],1,12,true)||
     !finiteNumber(p["pulseOnMs"],500,5000,true)||!finiteNumber(p["pulseOffMs"],5000,60000,true))return fail("脉冲或阈值超出范围");
  if(p["pulseCount"].as<uint32_t>()*(p["pulseOnMs"].as<uint32_t>()+p["pulseOffMs"].as<uint32_t>())>360000)return fail("单轮时长超过六分钟");
  if(v2){
    if(!config["targetDeviceId"].is<const char*>())return fail("缺少目标设备 ID");
    std::string target=config["targetDeviceId"].as<std::string>();
    if(target.empty()||target.size()>64||!std::all_of(target.begin(),target.end(),[](unsigned char c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_';}))return fail("目标设备 ID 格式无效");
    if(!expectedDeviceId.empty()&&target!=expectedDeviceId)return fail("配置目标设备不匹配");
    if(!finiteNumber(p["minWaterIntervalSeconds"],3600,2592000,true))return fail("最短浇水间隔无效");
  }
  if(!config["supplyVariant"].isNull()&&config["supplyVariant"]!="builtin"&&config["supplyVariant"]!="valve")return fail("供水变体无效");
  if(!config["display"].isNull()&&!config["display"].is<JsonObjectConst>())return fail("display 必须是对象");
  for(const char* key:{"dailyWaterNeedMl","roundWaterMl","estimatedIntervalDays","reservoirDays","flowRateMlSec"})
    if(!config["display"][key].isNull()&&!finiteNumber(config["display"][key],0,1000000))return fail("展示数值无效");
  auto reference=config["environmentReference"];
  if(!reference.isNull()){
    if(!v2||!reference.is<JsonObjectConst>()||!reference["title"].is<const char*>()||!reference["reference"].is<const char*>()
      ||(reference["context"]!="outdoor"&&reference["context"]!="indoor"&&reference["context"]!="greenhouse"))return fail("环境参考格式无效");
    bool any=false;
    for(const char* prefix:{"temperature","humidity"}){std::string minKey=std::string(prefix)+(*prefix=='t'?"MinC":"MinPct"),maxKey=std::string(prefix)+(*prefix=='t'?"MaxC":"MaxPct");
      if(!reference[minKey].isNull()||!reference[maxKey].isNull()){any=true;double low=*prefix=='t'?-20:0,high=*prefix=='t'?60:100;
        if(!finiteNumber(reference[minKey],low,high)||!finiteNumber(reference[maxKey],reference[minKey].as<double>(),high))return fail("环境参考范围无效");}}
    if(!any)return fail("环境参考缺少完整范围");
  }
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
  virtual void describe(JsonObject){}
  virtual void runtimeStatus(JsonObject){}
  virtual std::string runtimeMode(const std::string& fallback){return fallback;}
  virtual bool modeAllowed(const std::string& target){return target=="DISPLAY"||target=="PREPARE";}
  virtual bool changeMode(const std::string&){return true;}
  virtual bool canConfigure(){return true;}
  virtual void configurationChanged(JsonVariantConst){}
  virtual int runtimeRequest(const std::string&,JsonVariantConst,JsonObject,std::string&){return 0;}
  virtual void beforeReset(){}
  virtual const char* authProfile(){return "development";}
  virtual std::string secureMac(const std::string&){return "";}
  virtual std::string secureMacForRole(const std::string& message,const std::string& role){return role=="owner"?secureMac(message):"";}
  virtual bool hasRole(const std::string& role){return role=="owner";}
};
class Endpoint {
  Platform& hw;
  std::string deviceId,nonce,opToken,operation,targetMode;
  uint32_t nonceAt=0,opAt=0;
  bool authenticated=false;
  bool processingSecured=false;
  uint32_t secureSequence=0;
  std::string sessionNonce;
  std::string sessionRole="owner";
  JsonDocument config;
  std::string mode="DISPLAY";
  void respond(const std::string& id,const char* status,JsonVariantConst payload,const char* message=nullptr,const char* stage=nullptr){
    JsonDocument out;out["id"]=id;out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;out["status"]=status;
    if(!payload.isNull())out["payload"].set(payload);if(message)out["message"]=message;if(stage)out["stage"]=stage;
    if(processingSecured){std::string body=base64(json(out));JsonDocument secured;secured["id"]=id;secured["protocol"]=PROTOCOL;secured["protocolVersion"]=VERSION;secured["status"]="secured";
      secured["payload"]["sequence"]=secureSequence;secured["payload"]["body"]=body;
      secured["payload"]["mac"]=hw.secureMacForRole("response|"+deviceId+"|"+sessionNonce+"|"+std::to_string(secureSequence)+"|"+body,sessionRole);emit(secured);
    }else emit(out);
  }
public:
  std::function<void(JsonVariantConst)> emit=[](JsonVariantConst){};
  Endpoint(Platform& platform,const std::string& id):hw(platform),deviceId(id){}
  bool restore(){std::string raw,error;if(!hw.load(raw))return false;if(raw.empty())return true;
    if(deserializeJson(config,raw)||!validConfig(config,error,deviceId)){config.clear();return false;}return true;}
  uint32_t revision()const{return config["revision"]|uint32_t(0);}
  JsonVariantConst configuration()const{return config.as<JsonVariantConst>();}
  const std::string& currentMode()const{return mode;}
  bool authorized()const{return authenticated;}
  void resetSession(){authenticated=false;nonce.clear();opToken.clear();operation.clear();sessionNonce.clear();sessionRole="owner";secureSequence=0;}
  void error(const std::string& id,const char* message){hw.event("error");if(validId(id))respond(id,"error",JsonVariantConst(),message);}
  void handle(JsonVariantConst request){
    std::string id=request["id"]|"";
    if(!validId(id))return;
    if(request["protocol"]!=PROTOCOL||request["protocolVersion"]!=VERSION){error(id,"协议不兼容");return;}
    if(!request["action"].is<const char*>()||!request["payload"].is<JsonObjectConst>()){error(id,"请求结构无效");return;}
    std::string action=request["action"].as<std::string>();auto p=request["payload"];
    JsonDocument response;auto out=response.to<JsonObject>();
    if(action=="secured"){
      if(processingSecured||!authenticated||std::string(hw.authProfile())!="hmac-sha256-v1"){error(id,"认证会话无效，请重新连接");return;}
      if(!finiteNumber(p["sequence"],1,2147483647,true)||p["sequence"].as<uint32_t>()!=secureSequence+1
        ||!p["body"].is<const char*>()||!p["mac"].is<const char*>()){error(id,"认证消息序号无效");return;}
      std::string body=p["body"].as<std::string>();std::string expected=hw.secureMacForRole("request|"+deviceId+"|"+sessionNonce+"|"+std::to_string(secureSequence+1)+"|"+body,sessionRole);
      if(!sameDigest(expected,p["mac"].as<std::string>())){error(id,"认证消息完整性校验失败");return;}
      std::string raw;JsonDocument inner;if(!unbase64Message(body,raw)||deserializeJson(inner,raw)||inner["id"].as<std::string>()!=id
        ||inner["action"]=="secured"||inner["action"]=="handshake"||inner["action"]=="authenticate"){error(id,"认证消息内容无效");return;}
      secureSequence++;processingSecured=true;handle(inner.as<JsonVariantConst>());processingSecured=false;return;
    }
    if(action=="handshake"){
      resetSession();nonce=hw.randomToken();nonceAt=hw.now();out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;
      out["deviceId"]=deviceId;out["model"]="ESP32-C3";out["fwVersion"]=FW_VERSION;out["nonce"]=nonce;
      out["runtimeProfile"]="configuration-oled";out["automaticWatering"]=false;out["maxConfigVersion"]="2.0";
      auto modes=out["supportedModes"].to<JsonArray>();modes.add("DISPLAY");modes.add("PREPARE");
      auto cap=out["capabilities"].to<JsonArray>();for(const char* s:{"status","configuration","history","confirmed-operations","oled","minimum-interval","target-bound-config"})cap.add(s);
      auto limits=out["transport"].to<JsonObject>();limits["maxMessageBytes"]=MAX_MESSAGE;limits["maxConfigBytes"]=MAX_CONFIG;limits["maxFrames"]=MAX_PARTS;limits["framePayloadBytes"]=FRAME_BYTES;limits["writeChunkBytes"]=20;
      hw.describe(out);
      out["authProfile"]=hw.authProfile();
      if(std::string(hw.authProfile())=="hmac-sha256-v1"){
        out["deviceProof"]=hw.secureMac("device|"+deviceId+"|"+nonce);
        for(const char* role:{"operator","viewer"})if(hw.hasRole(role))out["deviceProofs"][role]=hw.secureMacForRole("device|"+deviceId+"|"+nonce,role);
        out["transport"]["maxConfigBytes"]=4000;
        out["authorizationModel"]="local-role-v1";
        out["linkEncryption"]="required";
      }
      hw.event("handshake");respond(id,"ok",out);return;
    }
    if(action=="authenticate"){
      std::string value=p["auth"]|"";std::string role=p["role"]|"owner";auto challenge=nonce;nonce.clear();authenticated=false;
      if(challenge.empty()||uint32_t(hw.now()-nonceAt)>NONCE_TIMEOUT||value.size()!=64){error(id,"认证随机数失效，请重新握手");return;}
      if(role!="owner"&&role!="operator"&&role!="viewer"){error(id,"认证角色无效");return;}
      auto expected=std::string(hw.authProfile())=="hmac-sha256-v1"?
        hw.secureMacForRole("client|"+(role=="owner"?"":role+"|")+deviceId+"|"+challenge,role):hw.hash(challenge);
      if(expected.size()!=64){error(id,"设备认证计算失败");return;}
      uint8_t diff=0;for(size_t i=0;i<64;i++)diff|=value[i]^expected[i];
      if(diff){error(id,"认证失败，请重新握手");return;}
      authenticated=true;sessionNonce=challenge;sessionRole=role;secureSequence=0;out["authenticated"]=true;out["role"]=role;hw.event("authenticated");respond(id,"ok",out);return;
    }
    if(!authenticated){error(id,"请先完成握手认证");return;}
    if(std::string(hw.authProfile())=="hmac-sha256-v1"&&!processingSecured){error(id,"设备需要认证消息封装");return;}
    if(std::string(hw.authProfile())=="hmac-sha256-v1"){
      bool readOnly=action=="status"||action=="history"||action=="events"||action=="getConfiguration"||action=="timeProbe";
      if(sessionRole=="viewer"&&!readOnly&&action!="stop"){error(id,"当前凭据仅允许读取设备数据");return;}
      if(sessionRole=="operator"&&(action=="setConfiguration"||
          (action=="prepareOperation"&&std::string(p["operation"]|"")=="factoryReset"))){error(id,"当前凭据无权修改配置或恢复出厂");return;}
    }
    if(action=="status"){
      out["protocol"]=PROTOCOL;out["protocolVersion"]=VERSION;out["deviceId"]=deviceId;out["fwVersion"]=FW_VERSION;
      out["mode"]=hw.runtimeMode(mode);out["configRevision"]=revision();out["configured"]=revision()>0;out["plant"]=config["plant"]|"";
      out["authorizationRole"]=sessionRole;
      out["sample"]=nullptr;out["sensorState"]="not-configured";out["automaticWatering"]=false;
      out["storageReady"]=hw.storageReady();out["uptimeSeconds"]=hw.now()/1000;out["bluetoothConnected"]=true;out["authenticated"]=true;
      hw.runtimeStatus(out);
      respond(id,"ok",out);return;
    }
    if(action=="getConfiguration"){if(revision())out["config"].set(config);else out["config"]=nullptr;respond(id,"ok",out);return;}
    std::string runtimeError;int runtimeResult=hw.runtimeRequest(action,p,out,runtimeError);
    if(runtimeResult){if(runtimeResult<0)error(id,runtimeError.c_str());else respond(id,"ok",out);return;}
    if(action=="history"){
      out["deviceId"]=deviceId;out["records"].to<JsonArray>();out["nextCursor"]=nullptr;out["source"]="no-sensor-data";respond(id,"ok",out);return;
    }
    if(action=="setConfiguration"){
      if(!hw.canConfigure()){error(id,"设备正在执行浇水，请停止后再更新配置");return;}
      std::string reason;auto incoming=p["config"];
      if(!validConfig(incoming,reason,deviceId)){error(id,reason.c_str());return;}
      if(incoming["revision"].as<uint32_t>()<=revision()){error(id,"配置版本未递增，请重新生成");return;}
      hw.event("validating");respond(id,"progress",JsonVariantConst(),nullptr,"validating");
      auto raw=json(incoming);
      if(std::string(hw.authProfile())=="hmac-sha256-v1"&&raw.size()>4000){error(id,"认证配置超过 4000 字节容量");return;}
      if(!hw.save(raw)){error(id,"NVS 写入或回读校验失败，未确认保存");return;}
      config.set(incoming);hw.configurationChanged(config);authenticated=false;hw.event("saved");out["saved"]=true;out["revision"]=revision();respond(id,"ok",out);return;
    }
    if(action=="prepareOperation"){
      operation=p["operation"]|"";targetMode=p["mode"]|"";opToken.clear();
      if(operation!="mode"&&operation!="restart"&&operation!="factoryReset"){error(id,"未知设备操作");return;}
      if(operation=="mode"&&!hw.modeAllowed(targetMode)){error(id,"自动浇水模式需要有效标定、2.0 配置、日志存储和可信时间");return;}
      opToken=hw.randomToken();opAt=hw.now();out["confirmationToken"]=opToken;out["expiresInSeconds"]=30;respond(id,"ok",out);return;
    }
    if(action=="confirmOperation"){
      std::string token=p["confirmationToken"]|"",expected=opToken;opToken.clear();
      if(expected.empty()||token!=expected||uint32_t(hw.now()-opAt)>OP_TIMEOUT){error(id,"确认令牌无效或过期");return;}
      if(operation=="mode"){if(!hw.changeMode(targetMode)){error(id,"模式前置条件已变化，请重新检查");return;}mode=targetMode;}
      else hw.beforeReset();
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
