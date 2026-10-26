#include <cassert>
#include <vector>
#include <string>
#include "../ble_oled_pairing/include/watering_runtime.h"
#include "../ble_oled_pairing/include/sensor_quality.h"
struct IO:sws::RuntimeIO {
  bool on=false,save=true;unsigned starts=0;std::vector<std::string> events;
  void pump(bool value)override{on=value;if(value)starts++;}
  bool checkpoint(bool,uint32_t)override{return save;}
  void runtimeEvent(const char* code,const char*)override{events.push_back(code);}
};
sws::RuntimeConfig configuration(){sws::RuntimeConfig c;c.bound=true;c.revision=2;c.pulses=2;c.onMs=500;c.offMs=5000;c.intervalSeconds=3600;c.threshold=30;return c;}
sws::SensorReading sample(){sws::SensorReading s;s.soil=3000;s.rain=2500;s.temperature=35;s.humidity=40;return s;}
int main(){
  IO io;sws::WateringRuntime runtime(io);runtime.begin(0,true);runtime.configure(configuration());
  assert(!runtime.setMode("LONGRUN",0));runtime.clock(true);
  assert(runtime.setMode("LONGRUN",0));runtime.accept(sample(),0);runtime.tick(1);assert(!io.on);
  runtime.accept(sample(),3600000);runtime.tick(3600000);assert(io.on);assert(!runtime.configure(configuration()));
  runtime.tick(3600500);assert(!io.on);runtime.tick(3605500);assert(io.on);
  runtime.tick(3606000);assert(!io.on);runtime.tick(3611000);assert(!runtime.active());assert(io.starts==2);
  runtime.accept(sample(),3611001);runtime.tick(3611001);assert(!io.on);
  IO failing;sws::WateringRuntime guarded(failing);guarded.begin(0,true);guarded.configure(configuration());guarded.clock(true);guarded.setMode("LONGRUN",0);
  failing.save=false;guarded.accept(sample(),3600000);guarded.tick(3600000);assert(!failing.on);assert(guarded.inhibition()=="checkpoint-failed");
  IO protection;sws::WateringRuntime protectedRuntime(protection);protectedRuntime.begin(0,true);protectedRuntime.configure(configuration());protectedRuntime.clock(true);protectedRuntime.setMode("LONGRUN",0);
  protectedRuntime.accept(sample(),3600000);protectedRuntime.tick(3600000);assert(protection.on);
  auto invalid=sample();invalid.soil=-1;protectedRuntime.accept(invalid,3600100);protectedRuntime.tick(3600100);assert(!protection.on);assert(!protectedRuntime.active());
  IO rails;sws::WateringRuntime railGuard(rails);railGuard.begin(0,true);railGuard.configure(configuration());railGuard.clock(true);assert(railGuard.setMode("LONGRUN",0));
  auto low=sample();low.soil=6;low.rain=4;railGuard.accept(low,3600000);railGuard.tick(3600000);assert(!rails.on);assert(railGuard.inhibition()=="soil-invalid");
  IO cold;sws::WateringRuntime recovered(cold);recovered.begin(0,true,true);recovered.configure(configuration());recovered.clock(true);recovered.setMode("LONGRUN",0);recovered.accept(sample(),0);recovered.tick(0);assert(!cold.on);assert(recovered.intervalRemainingMs()==3600000);
  IO earlier;sws::WateringRuntime earlyClock(earlier);earlyClock.begin(0,true,true);earlyClock.clock(true);earlyClock.configure(configuration(),true);assert(earlyClock.intervalRemainingMs()==3600000);
  IO sleep;sws::WateringRuntime restored(sleep);restored.begin(0,true,false,120000);restored.configure(configuration(),true);assert(restored.intervalRemainingMs()==120000);
  IO wrap;sws::WateringRuntime wrapping(wrap);wrapping.begin(0xfffffff0,true);wrapping.configure(configuration());wrapping.tick(100);assert(wrapping.intervalRemainingMs()==3600000-116);
  IO prep;sws::WateringRuntime prepare(prep);prepare.begin(0,true);prepare.setMode("PREPARE",0);
  for(unsigned n=0;n<10;n++){prepare.accept(sample(),n*2000);prepare.tick(n*2000);}prepare.tick(600000);assert(prepare.currentMode()=="DISPLAY");assert(prepare.prepareValidSamples()==10);assert(prep.events.back()=="prepare-completed");assert(!prep.on);
  assert(prepare.prepareChannel(0).valid==10&&prepare.prepareChannel(2).valid==10);
  assert(prepare.prepareChannel(4).failed==10);
  assert(prepare.baselineValue(0)==35&&prepare.baselineValue(1)==40&&prepare.baselineValue(2)==3000);
  assert(std::isnan(prepare.baselineValue(4)));
  sws::ChannelQuality quality;
  assert(quality.observe(100,true,20,1000)==sws::QualityState::Valid);
  assert(quality.observe(140,true,20,2000)==sws::QualityState::Suspect);
  assert(quality.jumpCount()==1);
  assert(quality.observe(141,true,20,3000)==sws::QualityState::Suspect);
  assert(quality.observe(141,true,20,4000)==sws::QualityState::Valid);
  assert(quality.provoke());
  quality.observe(141,true,20,5000);quality.observe(141,true,20,6000);
  assert(quality.observe(141,true,20,7000)==sws::QualityState::Suspect);
  assert(quality.stuckAfterStimulus());
  assert(quality.observe(148,true,20,8000)==sws::QualityState::Suspect);
  assert(quality.observe(148,true,20,9000)==sws::QualityState::Valid);
  assert(quality.observe(NAN,true,20,10000)==sws::QualityState::Suspect);
  assert(quality.observe(NAN,true,20,11000)==sws::QualityState::Invalid);
  assert(quality.observe(148,false,20,12000)==sws::QualityState::Stale);
  return 0;
}
