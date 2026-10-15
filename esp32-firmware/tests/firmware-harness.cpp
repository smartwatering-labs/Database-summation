// Native adapter for the exact protocol/validation code used by the ESP32.
// Only hardware time, entropy and flash are replaced for fault injection.
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <iostream>
#include <memory>
#include "../ble_oled_pairing/include/sws_core.h"

struct Host : sws::Platform {
  uint32_t time=100, counter=0;
  std::string persisted;
  std::string secret,operatorSecret,viewerSecret;
  bool failSave=false, failErase=false, rebooted=false;
  uint32_t now() override {return time;}
  std::string randomToken() override {return std::string(24,'0')+sws::hex32(++counter);}
  std::string hash(const std::string& nonce) override {
    BCRYPT_ALG_HANDLE algorithm=nullptr; BCRYPT_HASH_HANDLE hash=nullptr;
    unsigned char digest[32];std::string input=nonce+"SWS2026C3", result;
    if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)!=0)return result;
    if(BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0)==0){
      if(BCryptHashData(hash,reinterpret_cast<PUCHAR>(&input[0]),input.size(),0)==0 && BCryptFinishHash(hash,digest,32,0)==0){
        char bytes[3];for(auto b:digest){snprintf(bytes,sizeof(bytes),"%02x",b);result+=bytes;}
      }
      BCryptDestroyHash(hash);
    }
    BCryptCloseAlgorithmProvider(algorithm,0);return result;
  }
  bool load(std::string& raw) override {raw=persisted;return true;}
  bool save(const std::string& raw) override {if(failSave)return false;persisted=raw;return true;}
  bool erase() override {if(failErase)return false;persisted.clear();return true;}
  bool storageReady() override {return true;}
  int runtimeRequest(const std::string& action,JsonVariantConst,JsonObject out,std::string&)override{
    if(action!="stop")return 0;out["stopped"]=true;return 1;
  }
  void event(const char*) override {}
  void rebootAfterReply() override {rebooted=true;}
  const char* authProfile()override{return secret.empty()?"development":"hmac-sha256-v1";}
  bool hasRole(const std::string& role)override{return role=="owner"?!secret.empty():role=="operator"?!operatorSecret.empty():role=="viewer"?!viewerSecret.empty():false;}
  std::string secureMac(const std::string& input)override{return secureMacForRole(input,"owner");}
  std::string secureMacForRole(const std::string& input,const std::string& role)override{
    const std::string& selected=role=="operator"?operatorSecret:role=="viewer"?viewerSecret:secret;
    if(selected.size()!=64)return "";unsigned char key[32],digest[32];for(int i=0;i<32;i++)key[i]=strtoul(selected.substr(i*2,2).c_str(),nullptr,16);
    BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;std::string result;
    if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,BCRYPT_ALG_HANDLE_HMAC_FLAG)!=0)return result;
    if(BCryptCreateHash(algorithm,&hash,nullptr,0,key,sizeof(key),0)==0){
      if(BCryptHashData(hash,reinterpret_cast<PUCHAR>(const_cast<char*>(input.data())),input.size(),0)==0&&BCryptFinishHash(hash,digest,32,0)==0){char bytes[3];for(auto b:digest){snprintf(bytes,sizeof(bytes),"%02x",b);result+=bytes;}}
      BCryptDestroyHash(hash);
    }BCryptCloseAlgorithmProvider(algorithm,0);return result;
  }
};
int main(){
  Host host;sws::Receiver receiver;std::unique_ptr<sws::Endpoint> endpoint;
  auto restart=[&](){
    receiver.reset();endpoint.reset(new sws::Endpoint(host,"NATIVE-C3"));endpoint->restore();
    endpoint->emit=[](JsonVariantConst reply){sws::frames(reply,[](const std::string& frame){std::cout<<frame<<std::flush;return true;});};
  };
  restart();
  receiver.onMessage=[&](JsonVariantConst request){endpoint->handle(request);};
  receiver.onError=[&](const std::string& id,const char* error){endpoint->error(id,error);};
  std::string line;
  while(std::getline(std::cin,line)){
    if(!line.empty()&&line[0]=='@'){
      JsonDocument control;if(deserializeJson(control,line.substr(1)))return 2;
      if(control["restart"]==true)restart();
      if(control["secret"].is<const char*>()){host.secret=control["secret"].as<std::string>();endpoint->resetSession();}
      if(control["operatorSecret"].is<const char*>()){host.operatorSecret=control["operatorSecret"].as<std::string>();endpoint->resetSession();}
      if(control["viewerSecret"].is<const char*>()){host.viewerSecret=control["viewerSecret"].as<std::string>();endpoint->resetSession();}
      if(control["disconnect"]==true){receiver.reset();endpoint->resetSession();}
      if(!control["failSave"].isNull())host.failSave=control["failSave"].as<bool>();
      if(!control["failErase"].isNull())host.failErase=control["failErase"].as<bool>();
      if(!control["advance"].isNull()){host.time+=control["advance"].as<uint32_t>();receiver.tick(host.time);}
      std::cout<<"@ok\n"<<std::flush;continue;
    }
    line+='\n';
    for(size_t offset=0;offset<line.size();offset+=7)
      receiver.push(reinterpret_cast<const uint8_t*>(line.data()+offset),std::min<size_t>(7,line.size()-offset),host.time);
  }
}
