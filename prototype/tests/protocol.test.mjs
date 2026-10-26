import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, encodeMessage, FrameDecoder, validateHandshake, authentication, validateHistory, validateStatus, validateEventPage } from '../static/js/services/protocol.js';
import { DemoTransport } from '../static/js/services/demo.js';
import { DeviceController } from '../static/js/services/device.js';
import { BleTransport } from '../static/js/services/ble.js';
import { validateConfigFile, importedConfigResult, configFileContents } from '../static/js/services/config-file.js';
import { readConnectionSession, CONNECTION_SESSION_KEY } from '../static/js/services/connection-session.js';

const bleSettings = {
  serviceUuid:'00000000-0000-4000-8000-000000000001',
  writeUuid:'00000000-0000-4000-8000-000000000002',
  notifyUuid:'00000000-0000-4000-8000-000000000003',
};
function deferred() { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; }
function mockGatt(t) {
  const selected=new EventTarget(),reader=new EventTarget(),demo=new DemoTransport(()=>{},()=>{},0);
  selected.id=crypto.randomUUID(); reader.properties={notify:true}; reader.startNotifications=async()=>reader;
  const decoder=new FrameDecoder(async message=>{
    const payload=await demo.request(message.action,message.payload);
    for(const frame of encodeMessage({id:message.id,protocol:'SWS-BLE',protocolVersion:'1.0',status:'ok',payload})){
      reader.value=new DataView(frame.buffer,frame.byteOffset,frame.byteLength);
      reader.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  });
  const writer={properties:{write:true},writeValueWithResponse:async bytes=>decoder.push(bytes)};
  const service={getCharacteristic:async uuid=>uuid===bleSettings.writeUuid?writer:reader};
  const gatt={connected:false,connects:0,disconnects:0,
    async connect(){this.connects++;this.connected=true;await demo.connect();return this;},
    async getPrimaryService(){return service;},
    disconnect(){this.disconnects++;const wasConnected=this.connected;this.connected=false;
      if(wasConnected)selected.dispatchEvent(new Event('gattserverdisconnected'));},
  };
  selected.gatt=gatt;
  for(const [key,value] of Object.entries({isSecureContext:true,navigator:{bluetooth:{requestDevice:async()=>selected}}})){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
  }
  return {selected,gatt,service,reader,demo};
}

test('a remembered permitted device reconnects without a chooser and completes a fresh handshake and status read',async t=>{
  const {selected,gatt,demo}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const items=new Map(),previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)}});
  t.after(()=>previous?Object.defineProperty(globalThis,'sessionStorage',previous):delete globalThis.sessionStorage);
  const actions=[],request=demo.request.bind(demo);demo.request=(action,...args)=>{actions.push(action);return request(action,...args);};
  await controller.connect(bleSettings,false,{remember:true});
  const saved=readConnectionSession();assert.equal(saved.browserDeviceId,selected.id);
  controller.disconnect();
  navigator.bluetooth.requestDevice=async()=>{throw new Error('A reload must not open a chooser');};
  navigator.bluetooth.getDevices=async()=>[{id:'different-device',gatt:{connect(){throw new Error('Wrong device');}}},selected];
  await controller.connect(saved.settings,false,{remember:true,rememberedDeviceId:saved.browserDeviceId,expectedDeviceId:saved.deviceId});
  assert.equal(controller.state,'ready');assert.equal(gatt.connects,2);
  for(const action of ['handshake','authenticate','status'])assert.equal(actions.filter(value=>value===action).length,2);
  controller.disconnect('',{forget:true});assert.equal(items.has(CONNECTION_SESSION_KEY),false);
});

test('unsupported recovery and revoked permission never open a chooser and leave manual connection available',async t=>{
  const {selected,gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  let choosers=0;navigator.bluetooth.requestDevice=async()=>{choosers++;return selected;};
  const options={rememberedDeviceId:selected.id,expectedDeviceId:'DEMO-WATER001'};
  await assert.rejects(controller.connect(bleSettings,false,options),/未开放蓝牙自动恢复/);
  assert.equal(controller.busy,false);
  navigator.bluetooth.getDevices=async()=>[{id:'other'}];
  await assert.rejects(controller.connect(bleSettings,false,options),/未找到上次设备/);
  assert.equal(choosers,0);assert.equal(gatt.connects,0);
  await controller.connect(bleSettings);assert.equal(controller.state,'ready');assert.equal(choosers,1);
});

test('cancelled permission lookup cannot reconnect after a manual disconnect',async t=>{
  const {selected,gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const permitted=deferred();navigator.bluetooth.getDevices=()=>permitted.promise;
  const pending=controller.connect(bleSettings,false,{rememberedDeviceId:selected.id});
  const rejected=assert.rejects(pending,/连接已取消/);
  assert.equal(controller.connectionPhase,'restoring');controller.disconnect('',{forget:true});
  permitted.resolve([selected]);await rejected;
  assert.equal(controller.state,'disconnected');assert.equal(gatt.connects,0);
});

test('restoration verifies the saved protocol identity before authenticating',async t=>{
  const {selected,gatt,demo}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  navigator.bluetooth.getDevices=async()=>[selected];
  const actions=[],request=demo.request.bind(demo);demo.request=(action,...args)=>{actions.push(action);return request(action,...args);};
  await assert.rejects(controller.connect(bleSettings,false,{rememberedDeviceId:selected.id,expectedDeviceId:'C3-other'}),/设备身份不匹配/);
  assert.deepEqual(actions,['handshake']);assert.equal(gatt.connected,false);assert.equal(controller.busy,false);
});

test('GATT disconnect during discovery recovers before exposing ready device panels',async t=>{
  const {gatt,service}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  let discoveries=0;
  gatt.getPrimaryService=async()=>{
    if(++discoveries===1){
      gatt.disconnect();
      assert.equal(controller.state,'connecting');assert.equal(controller.busy,true);
      await assert.rejects(controller.connect(bleSettings),/请等待/);
      throw new DOMException('GATT Server is disconnected. Cannot retrieve services.','NetworkError');
    }
    return service;
  };
  await controller.connect(bleSettings);
  assert.equal(gatt.connects,2);assert.equal(discoveries,2);
  assert.equal(controller.state,'ready');assert.equal(controller.busy,false);
  assert.match(devicePage({settings:{}},controller),/手动控制/);
});

test('a browser connection-in-progress error is retried with fresh service discovery',async t=>{
  const {gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const connect=gatt.connect.bind(gatt);let calls=0;
  gatt.connect=async()=>{if(++calls===1)throw new DOMException('Connection already in progress.','NetworkError');return connect();};
  await controller.connect(bleSettings);
  assert.equal(calls,2);assert.equal(controller.state,'ready');assert.equal(controller.busy,false);
});

test('a pending native connection is awaited, retried once, then reported without cancelling it',async t=>{
  const {gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  let calls=0;
  gatt.connect=async()=>{
    assert.equal(gatt.disconnects,0,'busy platform work must not be cancelled by retries');
    calls++;
    throw new DOMException('Connection already in progress.','NetworkError');
  };
  const phases=[];controller.addEventListener('change',()=>phases.push(controller.connectionPhase));
  await assert.rejects(controller.connect(bleSettings),/系统蓝牙设置[\s\S]*配对记录/);
  assert.equal(calls,2,'a pending native request is awaited, not re-requested in a loop');
  assert.equal(gatt.disconnects,1,'only the failure teardown releases the device');
  assert.equal(controller.state,'error');assert.equal(controller.busy,false);
  for(const phase of ['choosing','connecting','waiting'])assert.ok(phases.includes(phase),phase);
});

test('late cancelled GATT connect cannot overlap or disconnect a newer session',async t=>{
  const {gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const entered=deferred(),release=deferred(),connect=gatt.connect.bind(gatt);let calls=0;
  gatt.connect=async()=>{calls++;entered.resolve();await release.promise;return connect();};
  const old=controller.connect(bleSettings);const rejected=assert.rejects(old,/连接已取消/);
  await entered.promise;controller.disconnect();
  const current=controller.connect(bleSettings);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1,'the native connect still in progress must be awaited');
  release.resolve();await rejected;await current;
  assert.equal(calls,1);assert.equal(gatt.connected,true);assert.equal(controller.state,'ready');
});

test('cancelling the device chooser prevents its late result from starting GATT',async t=>{
  const {selected,gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const choice=deferred();let picks=0;
  navigator.bluetooth.requestDevice=()=>++picks===1?choice.promise:Promise.resolve(selected);
  const old=controller.connect(bleSettings);const rejected=assert.rejects(old,/连接已取消/);
  assert.equal(controller.connectionPhase,'choosing');
  assert.match(devicePage({settings:{}},controller),/等待选择设备/);
  controller.disconnect();await controller.connect(bleSettings);
  choice.resolve(selected);await rejected;
  assert.equal(gatt.connects,1);assert.equal(gatt.connected,true);assert.equal(controller.state,'ready');
});

test('exhausted GATT setup releases busy state and a subsequent connection succeeds',async t=>{
  const {gatt,service}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  gatt.getPrimaryService=async()=>{throw new DOMException('GATT Server is disconnected.','NetworkError');};
  await assert.rejects(controller.connect(bleSettings),/蓝牙在连接初始化时断开/);
  assert.equal(gatt.connects,3);assert.equal(controller.busy,false);assert.equal(controller.state,'error');
  gatt.getPrimaryService=async()=>service;
  await controller.connect(bleSettings);assert.equal(controller.state,'ready');
});

test('an existing GATT link still completes notifications and handshake before ready',async t=>{
  const {gatt,demo}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  gatt.connected=true;await demo.connect();
  await controller.connect(bleSettings);
  assert.equal(gatt.connects,0);assert.equal(controller.state,'ready');assert.equal(controller.status.deviceId,'DEMO-WATER001');
});

test('a stalled native connection times out and its late completion is closed',async t=>{
  const {gatt}=mockGatt(t),controller=new DeviceController();t.after(()=>controller.disconnect());
  const entered=deferred(),release=deferred(),connect=gatt.connect.bind(gatt);
  gatt.connect=async()=>{entered.resolve();await release.promise;return connect();};
  t.mock.timers.enable({apis:['setTimeout']});
  const opening=controller.connect(bleSettings);const rejected=assert.rejects(opening,/蓝牙连接初始化超时/);
  await entered.promise;t.mock.timers.tick(30000);await rejected;
  assert.equal(controller.busy,false);assert.equal(controller.state,'error');
  release.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gatt.connected,false,'a late native completion must not leave an orphan GATT connection');
});

test('browser configuration files use the server 1.0 limits and strip private fields',()=>{
  const config={deviceModel:'ESP32-WATER-C3',configVersion:'1.0',revision:2,plant:' 番茄 ',
    auth:'private',signature:'private',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,
      pulseCount:9,pulseOnMs:3000,pulseOffMs:25000,unexpected:'ignored'},display:{roundWaterMl:20,unexpected:'ignored'}};
  const clean=validateConfigFile(config);
  assert.equal(clean.plant,'番茄');assert.equal(clean.auth,undefined);
  assert.equal(clean.params.unexpected,undefined);assert.equal(clean.display.unexpected,undefined);
  assert.equal(importedConfigResult(config).storage,'temporary');
  const file=configFileContents(config);
  assert.equal(file.revision,2);assert.equal(JSON.parse(file.contents).auth,undefined);
  assert.throws(()=>validateConfigFile(config,2),/不高于设备当前版本/);
  for(const invalid of [
    {...config,revision:2.5},{...config,configVersion:'2.0'},{...config,protocolVersion:null},
    {...config,params:{...config.params,soilWeight:.1}},
    {...config,params:{...config.params,pulseCount:12,pulseOffMs:60000}},
    {...config,display:null},{...config,display:{roundWaterMl:-1}},
    {...config,params:{...config.params,pulseOnMs:true}}
  ])assert.throws(()=>validateConfigFile(invalid));
});

test('bound 2.0 configuration keeps the interval and rejects another target',async()=>{
  const config={deviceModel:'ESP32-WATER-C3',configVersion:'2.0',revision:1,plant:'番茄',
    targetDeviceId:'DEMO-WATER001',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,
      pulseCount:2,pulseOnMs:3000,pulseOffMs:25000,minWaterIntervalSeconds:172800}};
  const clean=validateConfigFile(config);
  assert.equal(clean.params.minWaterIntervalSeconds,172800);
  assert.equal(clean.targetDeviceId,'DEMO-WATER001');
  const reference={context:'outdoor',title:'Fixture reference',reference:'https://example.org/fixture',temperatureMinC:20,temperatureMaxC:30};
  assert.deepEqual(validateConfigFile({...config,environmentReference:reference}).environmentReference,reference);
  assert.throws(()=>validateConfigFile({...config,environmentReference:{...reference,temperatureMaxC:19}}),/temperatureMaxC/);
  assert.throws(()=>validateConfigFile({...config,targetDeviceId:'../other'}),/目标设备/);
  assert.throws(()=>validateConfigFile({...config,params:{...config.params,minWaterIntervalSeconds:3599}}),/minWaterIntervalSeconds/);
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  await assert.rejects(controller.upload({...config,targetDeviceId:'OTHER'}),/目标设备/);
  assert.equal((await controller.upload(clean)).saved,true);
  controller.disconnect();
});
import { devicePage } from '../static/js/pages/device.js';

test('BLE negotiated limits reject oversize UTF-8 configuration before any GATT write',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;let writes=0;
  transport.writer={writeValueWithResponse:async()=>{writes++;}};
  transport.configureLimits({maxConfigBytes:300});
  await assert.rejects(transport.request('setConfiguration',{config:{plant:'中'.repeat(110)}}),/超过设备容量/);
  assert.equal(writes,0);assert.equal(transport.pending.size,0);
  transport.configureLimits({writeChunkBytes:244});assert.equal(transport.limits.writeChunkBytes,244);
  for(const limits of [{maxFrames:0},{writeChunkBytes:245},{framePayloadBytes:NaN}])assert.throws(()=>transport.configureLimits(limits),/不兼容/);
  transport.disconnect();
});

test('configuration firmware page exposes supported modes and no invented sensor readings',()=>{
  const html=devicePage({settings:{}},{state:'ready',status:{deviceId:'C3',fwVersion:'3.4.0',configRevision:1,mode:'DISPLAY',sample:null},handshake:{protocolVersion:'1.0',runtimeProfile:'configuration-oled',supportedModes:['DISPLAY','PREPARE']},history:[]});
  assert.match(html,/OLED 状态显示/);assert.doesNotMatch(html,/<option value="LONGRUN"/);
  assert.match(html,/这版固件不采集传感器数据/);assert.doesNotMatch(html,/长期模式默认每 2 小时/);
});

test('CRC32 and fragmented Unicode roundtrip',()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),'cbf43926');
  const message={id:'test-id',plant:'番茄🌱',records:Array.from({length:84},(_,i)=>({i,soilAdc:i}))};
  const frames=encodeMessage(message,21);let received;const decoder=new FrameDecoder(m=>received=m,error=>{throw error;});
  for(const frame of frames)for(let i=0;i<frame.length;i+=7)decoder.push(frame.slice(i,i+7));
  assert.deepEqual(received,message);
});

test('out-of-order and duplicate frame handling',()=>{
  const message={id:'order',value:'abc'.repeat(100)},frames=encodeMessage(message,30);let received;
  const decoder=new FrameDecoder(m=>received=m,error=>{throw error;});
  decoder.push(frames[2]);decoder.push(frames[2]);
  for(const frame of [...frames].reverse())decoder.push(frame);
  assert.deepEqual(received,message);
});

test('corrupt checksum is rejected and decoder recovers',()=>{
  let failed=0,received;const decoder=new FrameDecoder(m=>received=m,()=>failed++);
  const message={id:'bad',value:'payload'},frame=JSON.parse(new TextDecoder().decode(encodeMessage(message)[0]));frame.checksum='00000000';
  decoder.push(new TextEncoder().encode(JSON.stringify(frame)+'\n'));assert.equal(failed,1);assert.equal(received,undefined);
  decoder.push(encodeMessage(message)[0]);assert.deepEqual(received,message);
});

test('handshake rejects incompatible protocols and firmware',()=>{
  const valid={protocol:'SWS-BLE',protocolVersion:'1.0',model:'ESP32-C3',deviceId:'ONE',fwVersion:'3.3',nonce:'12345678'};
  assert.equal(validateHandshake(valid),valid);
  for(const change of [{protocol:'SWS-HS'},{model:'OTHER'},{fwVersion:'2.9'},{nonce:''}])assert.throws(()=>validateHandshake({...valid,...change}));
});

test('history handles unclocked device records without fabricating timestamps',()=>{
  const sample={bootCount:1,sampledAt:0,temperatureC:26,humidityPct:50,soilAdc:12,rainAdc:2000,wateringDemand:40};
  assert.equal(validateHistory([sample])[0].sampledAt,0);
  assert.equal(validateHistory([{...sample,sampledAt:Math.floor(Date.now()/1000)-8*86400}]).length,0);
  assert.throws(()=>validateHistory([{...sample,humidityPct:900}]));
  assert.throws(()=>validateStatus({protocol:'SWS-BLE',protocolVersion:'1.0',deviceId:'wrong'},'expected'));
});

test('demo nonce cannot be replayed',async()=>{
  const device=new DemoTransport(()=>{},()=>{},0);await device.connect();
  const handshake=await device.request('handshake');const auth=await authentication(handshake.nonce);
  assert.equal((await device.request('authenticate',{auth})).authenticated,true);
  await assert.rejects(device.request('authenticate',{auth}),/认证失败/);
});

test('controller performs real application state flow against explicit simulator',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  assert.equal(controller.state,'ready');assert.equal(controller.demo,true);assert.equal(controller.status.configRevision,0);
  const records=await controller.readHistory();assert.equal(records.length,84);
  await assert.rejects(controller.operate('mode','LONGRUN'),/先写入配置/);
  const config={deviceModel:'ESP32-WATER-C3',revision:1,plant:'番茄',configVersion:'1.0',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:9,pulseOnMs:3000,pulseOffMs:25000}};
  await controller.upload(config);assert.equal(controller.stage,'saved');assert.equal(controller.status.configRevision,1);
  assert.deepEqual(await controller.download(),config);
  await assert.rejects(controller.upload(config),/配置版本已更新/);
  await controller.operate('mode','PREPARE');assert.equal(controller.status.mode,'PREPARE');
  controller.disconnect();assert.equal(controller.status,null);assert.equal(controller.history.length,0);assert.equal(controller.trend.length,0);
  await controller.connect({},true);controller.transport.latency=0;
  assert.equal(controller.status.configRevision,1,'simulated NVS survives reconnect within the current page');
  await controller.operate('factoryReset');
  await new Promise(resolve=>setTimeout(resolve,380));
  assert.equal(controller.state,'disconnected');
  await controller.connect({},true);assert.equal(controller.status.configRevision,0);controller.disconnect();
});

test('known saved ACK remains successful when follow-up status fails',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const original=controller.transport.request.bind(controller.transport);let saved=false;
  controller.transport.request=async(action,payload)=>{
    if(saved&&action==='handshake'){controller.disconnect('sleep during follow-up');throw new Error('sleep during follow-up');}
    const result=await original(action,payload);if(action==='setConfiguration')saved=true;return result;
  };
  const result=await controller.upload({deviceModel:'ESP32-WATER-C3',revision:1,plant:'罗勒'});
  assert.equal(result.saved,true);assert.equal(result.statusRefreshFailed,true);assert.equal(controller.stage,'saved');controller.disconnect();
});

test('lost save reply is reconciled by reading the original device before another write',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const config={deviceModel:'ESP32-WATER-C3',configVersion:'1.0',revision:1,plant:'番茄',plantId:'tomato',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:2,pulseOnMs:3000,pulseOffMs:25000}};
  const request=controller.transport.request.bind(controller.transport);
  controller.transport.request=async(action,payload)=>{
    const result=await request(action,payload);
    if(action==='setConfiguration')throw new Error('设备响应超时');
    return result;
  };
  await assert.rejects(controller.upload(config),/超时/);
  assert.equal(controller.stage,'unknown');assert.equal(controller.pendingWrite.deviceId,'DEMO-WATER001');
  await assert.rejects(controller.upload(config),/待核对/);
  controller.disconnect();await controller.connect({},true);controller.transport.latency=0;
  const originalHandshake=controller.handshake;
  controller.handshake={...originalHandshake,deviceId:'OTHER-DEVICE'};
  await assert.rejects(controller.verifyPendingWrite(),/原设备/);
  assert.ok(controller.pendingWrite);
  controller.handshake=originalHandshake;
  assert.equal(await controller.verifyPendingWrite(),'saved');
  assert.equal(controller.pendingWrite,null);assert.equal(controller.stage,'saved');controller.disconnect();
});

test('readback requires the complete saved configuration to match',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const config={deviceModel:'ESP32-WATER-C3',configVersion:'1.0',revision:1,plant:'番茄',plantId:'tomato',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:2,pulseOnMs:3000,pulseOffMs:25000},display:{roundWaterMl:132}};
  controller.pendingWrite={deviceId:controller.handshake.deviceId,config};
  controller.transport.config={...structuredClone(config),display:{roundWaterMl:88}};
  controller.transport.revision=1;
  assert.equal(await controller.verifyPendingWrite(),'changed');
  assert.equal(controller.stage,'changed');controller.disconnect();
});

test('repeat status reads do not add the same sample to the trend',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const sample={...controller.status.sample,bootCount:7,sampleSeq:12};
  controller.status={...controller.status,sample};controller.record();const length=controller.trend.length;
  controller.status={...controller.status,sample:{...sample,wateringDemand:55}};controller.record();
  assert.equal(controller.trend.length,length);
  controller.status={...controller.status,sample:{...sample,sampleSeq:13}};controller.record();
  assert.equal(controller.trend.length,length+1);controller.disconnect();
});

test('sample quality suppresses invalid soil trend points and event pages retain device identity',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const initial=controller.trend.length;
  const sample={...controller.status.sample,sampleSeq:100,soilAdc:6,quality:{...controller.status.sample.quality,soilAdc:{status:'invalid',reason:'open-circuit'}}};
  validateStatus({...controller.status,sample},controller.status.deviceId);
  controller.status={...controller.status,sample};controller.record();
  assert.equal(controller.trend.length,initial);
  assert.equal(validateHistory([sample])[0].soilAdc,6);
  assert.equal(validateStatus({...controller.status,sample:{...sample,soilAdc:200}},controller.status.deviceId).sample.soilAdc,200);
  assert.throws(()=>validateStatus({...controller.status,sample:{...sample,soilAdc:4096}},controller.status.deviceId),/设备采样数据无效/);
  assert.throws(()=>validateStatus({...controller.status,sample:{...sample,quality:{soilAdc:{status:'unknown'}}}},controller.status.deviceId),/通道质量格式无效/);
  assert.throws(()=>validateStatus({...controller.status,sample:{...sample,sampleSeq:-1}},controller.status.deviceId),/采样身份/);
  const events=await controller.readEvents();assert.equal(events.length,2);
  assert.equal(events[0].code,'sensor-invalid');
  assert.throws(()=>validateEventPage({deviceId:'OTHER',records:[]},controller.status.deviceId),/来源/);
  const html=devicePage({settings:{},eventsOpen:true,eventsPage:0},{...controller});
  assert.match(html,/设备事件/);assert.match(html,/sensor-invalid/);assert.match(html,/太阳能输入/);
  controller.disconnect();
});

test('direct readings remain visible at ADC limits and do not create a valid control sample',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const sample={...controller.status.sample,sampleSeq:101,temperatureC:25,humidityPct:54,soilAdc:0,rainAdc:4095,solarVoltageV:1.03,wateringDemand:null,
    rawTemperatureC:25,rawHumidityPct:54,rawSoilAdc:0,rawRainAdc:4095,solarAdcMilliVolts:206,
    quality:Object.fromEntries(['temperatureC','humidityPct','soilAdc','rainAdc','solarVoltageV'].map(key=>[key,{status:'invalid',reason:'read-failed'}]))};
  controller.status=validateStatus({...controller.status,manualPumpOn:true,sample},controller.status.deviceId);
  const trendLength=controller.trend.length;controller.record();
  assert.equal(controller.trend.length,trendLength);
  const html=devicePage({settings:{}},controller);
  assert.match(html,/土壤原始 ADC<\/span><strong>0/);
  assert.match(html,/雨量原始 ADC<\/span><strong>4095/);
  assert.match(html,/空气温度<\/span><strong>25/);
  assert.match(html,/太阳能 ADC 电压<\/span><strong>206/);
  controller.status.sample={...sample,rawTemperatureC:null,temperatureC:27};
  assert.match(devicePage({settings:{}},controller),/空气温度<\/span><strong>—/);
  assert.match(html,/设备已确认开泵命令；未检测实际出水/);
  assert.throws(()=>validateStatus({...controller.status,sample:{...sample,rawSoilAdc:4096}},controller.status.deviceId),/原始采样数据无效/);
  controller.status.manualPumpOn=false;controller.history=[sample];
  const readyHtml=devicePage({settings:{},historyOpen:true},controller);
  assert.ok(!readyHtml.match(/<button[^>]*data-action="manual-servo"[^>]*>/)[0].includes('disabled'));
  assert.match(readyHtml,/<td>25 °C<\/td><td>54%<\/td><td>0<\/td><td>4095<\/td>/);
  controller.disconnect();
});

test('a late status response cannot replace a newer connection',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const transport=controller.transport,request=transport.request.bind(transport);
  let release;const late=new Promise(resolve=>{release=resolve;});let intercepted=false;
  transport.request=(action,payload)=>{
    if(action==='status'&&!intercepted){intercepted=true;return late;}
    return request(action,payload);
  };
  const refresh=controller.refresh();
  controller.disconnect();await controller.connect({},true);controller.transport.latency=0;
  const current=controller.status;
  release({...current,configRevision:99});
  await assert.rejects(refresh,/连接已取消/);
  assert.equal(controller.state,'ready');assert.equal(controller.busy,false);
  assert.equal(controller.status,current);assert.notEqual(controller.status.configRevision,99);
  controller.disconnect();
});

test('a late save response leaves the new connection pending readback',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const transport=controller.transport,request=transport.request.bind(transport);
  let release;const late=new Promise(resolve=>{release=resolve;});
  let enteredWrite;const writeStarted=new Promise(resolve=>{enteredWrite=resolve;});
  transport.request=(action,payload)=>{
    if(action==='setConfiguration'){enteredWrite();return late;}
    return request(action,payload);
  };
  const config={deviceModel:'ESP32-WATER-C3',configVersion:'1.0',revision:1,plant:'番茄',plantId:'tomato',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:2,pulseOnMs:3000,pulseOffMs:25000}};
  const upload=controller.upload(config);
  await writeStarted;assert.ok(controller.pendingWrite);
  controller.disconnect();await controller.connect({},true);controller.transport.latency=0;
  release({saved:true,revision:1});
  await assert.rejects(upload,/连接已取消/);
  assert.equal(controller.state,'ready');assert.equal(controller.stage,null);
  assert.equal(controller.pendingWrite?.deviceId,'DEMO-WATER001');
  controller.disconnect();
});

for(const chunkBytes of [20,244])test(`BLE transport reassembles notifications and serializes ${chunkBytes}-byte writes`,async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;let active=0,maxActive=0,maxWritten=0;
  if(chunkBytes!==20)transport.configureLimits({writeChunkBytes:chunkBytes});
  const decoder=new FrameDecoder(message=>{
    if(message.action==='status')assert.equal(message.payload.unicode,'🌱'.repeat(200));
    const reply={id:message.id,protocol:'SWS-BLE',protocolVersion:'1.0',status:'ok',payload:{echo:message.action}};
    for(const frame of encodeMessage(reply,30))for(let i=0;i<frame.length;i+=11)transport.decoder.push(frame.slice(i,i+11));
  },error=>{throw error;});
  transport.writer={async writeValueWithResponse(bytes){assert.ok(bytes.length<=chunkBytes);maxWritten=Math.max(maxWritten,bytes.length);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,1));decoder.push(bytes);active--;}};
  const result=await Promise.all([transport.request('status',{unicode:'🌱'.repeat(200)}),transport.request('history')]);
  assert.deepEqual(result,[{echo:'status'},{echo:'history'}]);assert.equal(maxWritten,chunkBytes);assert.equal(maxActive,1);assert.equal(transport.pending.size,0);transport.disconnect();
});

test('BLE disconnect rejects pending request even when GATT write hangs',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  transport.writer={writeValueWithResponse:()=>new Promise(()=>{})};
  const request=transport.request('setConfiguration',{});
  setTimeout(()=>transport.disconnect(),5);
  await assert.rejects(request,/连接已关闭/);assert.equal(transport.pending.size,0);
});

test('priority stop interrupts a fragmented request and waits for the stop acknowledgement',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let regular=0,stops=0;
  transport.writer={writeValueWithResponse:async bytes=>{
    if(bytes.length===1&&bytes[0]===33){stops++;for(const frame of encodeMessage({id:'emergency-stop',protocol:'SWS-BLE',protocolVersion:'1.0',status:'ok',payload:{stopped:true}}))transport.decoder.push(frame);return;}
    regular++;entered();await held;
  }};
  const request=transport.request('setConfiguration',{config:{plant:'番茄'}});request.catch(()=>{});
  await started;const stopping=transport.emergencyStop();release();
  await assert.rejects(request,/停止命令|传输/);assert.equal((await stopping).stopped,true);
  assert.equal(stops,1);assert.equal(regular,1);assert.equal(transport.pending.size,0);transport.disconnect();
});

test('background status leaves user operations available and discards a disconnected session',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  const transport=controller.transport,request=transport.request.bind(transport);
  let release;const held=new Promise(resolve=>{release=resolve;});
  transport.request=async(action,payload)=>{const value=await request(action,payload);if(action==='status')await held;return value;};
  const reading=controller.refresh({background:true});reading.catch(()=>{});
  assert.equal(controller.busy,false);
  await controller.readEvents();assert.ok(controller.events.length>0);
  controller.disconnect();await controller.connect({},true);const current=controller.status;
  release();await assert.rejects(reading,/连接已取消/);assert.equal(controller.status,current);
  assert.equal(controller.refreshing,false);controller.disconnect();
});

test('device summary requires fresh direct preparation data and the current revision',async()=>{
  const controller=new DeviceController();await controller.connect({},true);controller.transport.latency=0;
  controller.demo=false;controller.handshake.capabilities.push('prepare-summary');
  controller.status={...controller.status,timeQuality:'trusted',prepareSummary:{
    complete:true,validSamples:100,totalSamples:110,durationSeconds:600,configRevision:0,
    temperatureC:25,humidityPct:60,finishedAt:Math.floor(Date.now()/1000)}};
  assert.equal(controller.observationReport().temperatureC,25);
  const valid=structuredClone(controller.status.prepareSummary);
  for(const change of [{durationSeconds:undefined},{configRevision:1},{humidityPct:101},{totalSamples:200},{finishedAt:valid.finishedAt-3601}]){
    controller.status.prepareSummary={...valid,...change};assert.throws(()=>controller.observationReport());
  }controller.disconnect();
});
