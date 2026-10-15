#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <mbedtls/sha256.h>
#include <atomic>
#include <deque>
#include <vector>
#include "include/board_config.h"
#include "include/sws_core.h"

#if SWS_OLED_VARIANT == 0
U8G2_SSD1306_72X40_ER_F_HW_I2C display(U8G2_R0,U8X8_PIN_NONE,SWS_OLED_SCL,SWS_OLED_SDA);
#elif SWS_OLED_VARIANT == 1
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0,U8X8_PIN_NONE,SWS_OLED_SCL,SWS_OLED_SDA);
#elif SWS_OLED_VARIANT == 2
U8G2_SH1106_128X64_NONAME_F_HW_I2C display(U8G2_R0,U8X8_PIN_NONE,SWS_OLED_SCL,SWS_OLED_SDA);
#else
#error Unsupported SWS_OLED_VARIANT
#endif

NimBLEServer* server=nullptr;
NimBLECharacteristic* notifier=nullptr;
std::atomic<bool> linked{false},subscribed{false},rxOverflow{false};
std::atomic<uint32_t> epoch{0};
std::atomic<uint16_t> peer{BLE_HS_CONN_HANDLE_NONE};
struct RxChunk {uint32_t epoch;uint16_t size;uint8_t bytes[244];};
QueueHandle_t rxQueue=nullptr;
std::deque<std::string> tx;
size_t txOffset=0,txBytes=0,rxCount=0,rxTotal=0;
uint32_t lastEpoch=0,nextTx=0,txBlockedAt=0,stageAt=0,savedAt=0,lastDisplay=0,rebootAt=0;
bool oledReady=false,rebootPending=false,hasSavedNotice=false;
std::string stage="idle";

class Hardware : public sws::Platform {
  Preferences prefs;
  bool ready=false;
public:
  void begin(){ready=prefs.begin("watercfg",false);}
  uint32_t now() override{return millis();}
  std::string randomToken() override {char out[33];for(int i=0;i<16;i++)snprintf(out+2*i,3,"%02x",uint8_t(esp_random()));return out;}
  std::string hash(const std::string& nonce) override {
    std::string input=nonce+SWS_DEVICE_SECRET;unsigned char bytes[32];char output[65];
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    if(mbedtls_sha256(reinterpret_cast<const unsigned char*>(input.data()),input.size(),bytes,0)!=0)return "";
#else
    if(mbedtls_sha256_ret(reinterpret_cast<const unsigned char*>(input.data()),input.size(),bytes,0)!=0)return "";
#endif
    for(int i=0;i<32;i++)snprintf(output+2*i,3,"%02x",bytes[i]);return output;
  }
  bool load(std::string& raw) override {
    raw.clear();if(!ready)return false;size_t length=prefs.getBytesLength("package");if(!length)return true;
    if(length<5||length>sws::MAX_CONFIG+4)return false;
    std::vector<uint8_t> bytes(length);if(prefs.getBytes("package",bytes.data(),length)!=length)return false;
    uint32_t crc;memcpy(&crc,bytes.data(),4);raw.assign(reinterpret_cast<char*>(bytes.data()+4),length-4);
    return sws::crc32(raw)==crc;
  }
  bool save(const std::string& raw) override {
    if(!ready||raw.size()>sws::MAX_CONFIG)return false;
    // One blob is the commit unit. Revision and plant are derived from this blob,
    // never written to separate keys that could disagree after power loss.
    uint32_t crc=sws::crc32(raw);std::vector<uint8_t> bytes(raw.size()+4);
    memcpy(bytes.data(),&crc,4);memcpy(bytes.data()+4,raw.data(),raw.size());
    if(prefs.putBytes("package",bytes.data(),bytes.size())!=bytes.size())return false;
    std::string readback;return load(readback)&&readback==raw;
  }
  bool erase() override {return ready&&prefs.clear()&&prefs.getBytesLength("package")==0;}
  bool storageReady() override{return ready;}
  void event(const char* value) override {
    stage=value;stageAt=millis();
    if(stage=="saved"){savedAt=millis();hasSavedNotice=true;}
    if(stage=="reset")hasSavedNotice=false;
    Serial.printf("SWS stage=%s\n",value);
  }
  void rebootAfterReply() override {rebootPending=true;rebootAt=millis();}
} hardware;
sws::Receiver receiver;
sws::Endpoint* endpoint=nullptr;

void clearTx(){tx.clear();txOffset=txBytes=0;txBlockedAt=0;}
void terminateLink(){if(server&&linked.load())server->disconnect(peer.load());}
void queueReply(JsonVariantConst message){
  if(!linked.load()||!subscribed.load())return;
  bool ok=sws::frames(message,[](const std::string& line){
    if(txBytes+line.size()>24576)return false;tx.push_back(line);txBytes+=line.size();return true;
  });
  if(!ok){clearTx();hardware.event("error");terminateLink();}
}
void sendNext(uint32_t now){
  if(tx.empty()||!linked.load()||!subscribed.load()||int32_t(now-nextTx)<0)return;
  auto& front=tx.front();size_t length=std::min<size_t>(20,front.size()-txOffset);
  bool ok=notifier->notify(reinterpret_cast<const uint8_t*>(front.data()+txOffset),length,peer.load());
  nextTx=now+10;
  if(!ok){if(!txBlockedAt)txBlockedAt=now;else if(uint32_t(now-txBlockedAt)>3000){clearTx();terminateLink();}return;}
  txBlockedAt=0;txOffset+=length;txBytes-=length;
  if(txOffset==front.size()){tx.pop_front();txOffset=0;}
}
void drawDisplay(uint32_t now){
  if(!oledReady||uint32_t(now-lastDisplay)<100)return;lastDisplay=now;
  display.clearBuffer();display.setFont(u8g2_font_wqy12_t_gb2312a);
  display.drawUTF8(0,11,linked.load()?"蓝牙:连接":"蓝牙:未连接");
  std::string second,third;
  char text[40];
  if(!hardware.storageReady()){second="存储错误";third="检查串口";}
  else if(stage=="error"&&uint32_t(now-stageAt)<3000){second="操作失败";third="请在网页重试";}
  else if(rxTotal){second="接收数据包";snprintf(text,sizeof(text),"%u / %u",unsigned(rxCount),unsigned(rxTotal));third=text;}
  else if(stage=="validating"){second="校验并保存";third="请保持连接";}
  else if(hasSavedNotice&&uint32_t(now-savedAt)<18000){
    auto c=endpoint->configuration();auto p=c["params"];unsigned page=(now-savedAt)/2000;
    if(page==0){second="配置已保存";snprintf(text,sizeof(text),"R%lu",static_cast<unsigned long>(endpoint->revision()));third=text;}
    if(page==1){second="阈值 / 次数";snprintf(text,sizeof(text),"T%.1f N%d",p["threshold"].as<double>(),p["pulseCount"].as<int>());third=text;}
    if(page==2){snprintf(text,sizeof(text),"ON %d ms",p["pulseOnMs"].as<int>());second=text;snprintf(text,sizeof(text),"OFF %d ms",p["pulseOffMs"].as<int>());third=text;}
    if(page==3){second="土 温 空";snprintf(text,sizeof(text),"%.2f %.2f %.2f",p["soilWeight"].as<double>(),p["tempWeight"].as<double>(),p["airWeight"].as<double>());third=text;}
    if(page>=4){
      const char* keys[]={"dailyWaterNeedMl","roundWaterMl","flowRateMlSec","estimatedIntervalDays","reservoirDays"};
      const char* labels[]={"日需水 mL","每轮水量 mL","流量 mL/s","间隔 天","储水 天"};
      second=labels[page-4];auto value=c["display"][keys[page-4]];
      if(value.isNull())third="--";else {snprintf(text,sizeof(text),"%.1f",value.as<double>());third=text;}
    }
  } else {second=linked.load()?(endpoint->authorized()?"等待数据包":"等待认证"):"等待网页连接";
    snprintf(text,sizeof(text),"R%lu",static_cast<unsigned long>(endpoint->revision()));third=text;}
  if(!second.empty()&&static_cast<uint8_t>(second[0])<128)display.setFont(u8g2_font_5x7_tf);
  display.drawUTF8(0,25,second.c_str());
  display.setFont(u8g2_font_wqy12_t_gb2312a);
  // Use a compact numeric font for packet numbers so 72px screens do not clip.
  bool numeric=!third.empty()&&static_cast<uint8_t>(third[0])<128;
  if(numeric)display.setFont(u8g2_font_5x7_tf);
  display.drawUTF8(0,38,third.c_str());display.sendBuffer();
}

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s,NimBLEConnInfo& info) override {
    if(linked.exchange(true)){s->disconnect(info.getConnHandle());return;}
    peer=info.getConnHandle();subscribed=false;epoch.fetch_add(1);
    s->updateConnParams(info.getConnHandle(),12,24,0,500);
  }
  void onDisconnect(NimBLEServer*,NimBLEConnInfo& info,int) override {
    if(info.getConnHandle()!=peer.load())return;
    linked=false;subscribed=false;peer=BLE_HS_CONN_HANDLE_NONE;epoch.fetch_add(1);
  }
};
class NotifyCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*,NimBLEConnInfo& info,uint16_t value) override {
    if(info.getConnHandle()==peer.load())subscribed=(value&1)!=0;
  }
};
class WriteCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c,NimBLEConnInfo& info) override {
    if(info.getConnHandle()!=peer.load()||!subscribed.load())return;
    auto value=c->getValue();RxChunk chunk{};
    if(value.size()>sizeof(chunk.bytes)){rxOverflow=true;return;}
    chunk.epoch=epoch.load();chunk.size=value.size();memcpy(chunk.bytes,value.data(),chunk.size);
    if(xQueueSend(rxQueue,&chunk,0)!=pdTRUE)rxOverflow=true;
  }
};
ServerCallbacks serverCallbacks;NotifyCallbacks notifyCallbacks;WriteCallbacks writeCallbacks;

void setup(){
  Serial.begin(115200);hardware.begin();
  char id[24];uint64_t mac=ESP.getEfuseMac();snprintf(id,sizeof(id),"C3-%04x%08lx",uint16_t(mac>>32),static_cast<unsigned long>(mac&0xffffffff));
  endpoint=new sws::Endpoint(hardware,id);
  if(!endpoint->restore())hardware.event("error");
  endpoint->emit=queueReply;
  receiver.onMessage=[](JsonVariantConst m){rxCount=rxTotal=0;endpoint->handle(m);};
  receiver.onError=[](const std::string& id,const char* error){rxCount=rxTotal=0;endpoint->error(id,error);};
  receiver.onProgress=[](size_t n,size_t total){rxCount=n;rxTotal=total;};
  Wire.begin(SWS_OLED_SDA,SWS_OLED_SCL);Wire.setTimeOut(30);
  Wire.beginTransmission(SWS_OLED_ADDRESS);oledReady=Wire.endTransmission()==0;
  if(oledReady){display.setI2CAddress(SWS_OLED_ADDRESS<<1);display.begin();display.setBusClock(400000);}
  Serial.printf("SWS %s device=%s OLED=%s I2C=%d/%d address=0x%02x\n",sws::FW_VERSION,id,oledReady?"found":"missing",SWS_OLED_SDA,SWS_OLED_SCL,SWS_OLED_ADDRESS);
  rxQueue=xQueueCreate(64,sizeof(RxChunk));if(!rxQueue){hardware.event("error");return;}
  NimBLEDevice::init("SWS-ESP32C3");server=NimBLEDevice::createServer();server->setCallbacks(&serverCallbacks,false);
  auto* service=server->createService(SWS_SERVICE_UUID);
  auto* writer=service->createCharacteristic(SWS_WRITE_UUID,NIMBLE_PROPERTY::WRITE);writer->setCallbacks(&writeCallbacks);
  notifier=service->createCharacteristic(SWS_NOTIFY_UUID,NIMBLE_PROPERTY::NOTIFY);notifier->setCallbacks(&notifyCallbacks);
  service->start();auto* advertising=NimBLEDevice::getAdvertising();advertising->addServiceUUID(SWS_SERVICE_UUID);
  advertising->enableScanResponse(true);advertising->setName("SWS-ESP32C3");advertising->start();
}
void loop(){
  uint32_t now=millis(),currentEpoch=epoch.load();
  if(currentEpoch!=lastEpoch){lastEpoch=currentEpoch;receiver.reset();endpoint->resetSession();clearTx();rxCount=rxTotal=0;
    hardware.event(linked.load()?"connected":"disconnected");if(!linked.load()&&server&&!rebootPending)NimBLEDevice::startAdvertising();}
  if(rxOverflow.exchange(false)){receiver.reset();clearTx();rxCount=rxTotal=0;hardware.event("error");terminateLink();}
  RxChunk chunk;unsigned processed=0;
  while(rxQueue&&processed++<8&&xQueueReceive(rxQueue,&chunk,0)==pdTRUE){
    if(chunk.epoch==lastEpoch&&linked.load())receiver.push(chunk.bytes,chunk.size,now);
  }
  receiver.tick(now);sendNext(now);drawDisplay(now);
  if(rebootPending&&((tx.empty()&&uint32_t(now-rebootAt)>500)||uint32_t(now-rebootAt)>10000))ESP.restart();
  delay(2);
}
