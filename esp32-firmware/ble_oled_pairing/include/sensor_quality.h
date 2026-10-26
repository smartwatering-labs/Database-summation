#pragma once
#include <cmath>
#include <cstdint>

namespace sws {
enum class QualityState {Valid,Suspect,Invalid,Stale};
inline const char* qualityName(QualityState state){
  switch(state){case QualityState::Valid:return "valid";case QualityState::Suspect:return "suspect";
    case QualityState::Invalid:return "invalid";case QualityState::Stale:return "stale";
    default:return "invalid";}
}
class ChannelQuality {
  QualityState current=QualityState::Valid;
  double previous=NAN,pendingJump=NAN,provokedFrom=NAN;
  uint32_t failures=0,recoveries=0,jumps=0,unchanged=0,lastGoodAt=0;
  bool provoked=false;
public:
  QualityState state()const{return current;}
  uint32_t failureCount()const{return failures;}
  uint32_t jumpCount()const{return jumps;}
  uint32_t unchangedCount()const{return unchanged;}
  uint32_t lastValidAt()const{return lastGoodAt;}
  bool stuckAfterStimulus()const{return provoked&&unchanged>=3;}
  void reset(){*this=ChannelQuality{};}
  bool provoke(){if(!std::isfinite(previous))return false;provoked=true;provokedFrom=previous;unchanged=0;return true;}
  QualityState observe(double value,bool fresh,double jumpLimit,uint32_t now){
    if(!fresh){current=QualityState::Stale;return current;}
    if(!std::isfinite(value)){
      failures++;recoveries=0;pendingJump=NAN;
      current=failures>=2?QualityState::Invalid:QualityState::Suspect;
      return current;
    }
    failures=0;
    if(std::isfinite(previous)&&std::isfinite(jumpLimit)&&jumpLimit>0&&std::abs(value-previous)>jumpLimit){
      if(std::isfinite(pendingJump)&&std::abs(value-pendingJump)<=jumpLimit/2){
        // A second coherent reading confirms the new level; one more sample clears suspicion.
        previous=value;pendingJump=NAN;recoveries=1;current=QualityState::Suspect;return current;
      }
      pendingJump=value;jumps++;recoveries=0;current=QualityState::Suspect;return current;
    }
    pendingJump=NAN;
    if(provoked&&std::isfinite(provokedFrom)){
      if(std::abs(value-provokedFrom)<1){unchanged++;if(unchanged>=3){current=QualityState::Suspect;return current;}}
      else {provoked=false;unchanged=0;}
    }
    if(current==QualityState::Invalid||current==QualityState::Suspect||current==QualityState::Stale){
      if(++recoveries<2){current=QualityState::Suspect;return current;}
    }
    recoveries=0;current=QualityState::Valid;previous=value;lastGoodAt=now;
    return current;
  }
};
}
