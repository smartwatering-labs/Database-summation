import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, encodeMessage, FrameDecoder, validateHandshake, authentication, validateHistory, validateStatus } from '../static/js/services/protocol.js';
import { DemoTransport } from '../static/js/services/demo.js';
import { DeviceController } from '../static/js/services/device.js';
import { BleTransport } from '../static/js/services/ble.js';
import { devicePage } from '../static/js/pages/device.js';

test('BLE negotiated limits reject oversize UTF-8 configuration before any GATT write',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;let writes=0;
  transport.writer={writeValueWithResponse:async()=>{writes++;}};
  transport.configureLimits({maxConfigBytes:300});
  await assert.rejects(transport.request('setConfiguration',{config:{plant:'中'.repeat(110)}}),/超过设备容量/);
  assert.equal(writes,0);assert.equal(transport.pending.size,0);
  for(const limits of [{maxFrames:0},{writeChunkBytes:244},{framePayloadBytes:NaN}])assert.throws(()=>transport.configureLimits(limits),/不兼容/);
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
    if(saved&&action==='handshake')throw new Error('sleep during follow-up');
    const result=await original(action,payload);if(action==='setConfiguration')saved=true;return result;
  };
  const result=await controller.upload({deviceModel:'ESP32-WATER-C3',revision:1,plant:'罗勒'});
  assert.equal(result.saved,true);assert.equal(result.statusRefreshFailed,true);assert.equal(controller.stage,'saved');controller.disconnect();
});

test('BLE transport reassembles response notifications and serializes writes',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;let active=0,maxActive=0;
  const decoder=new FrameDecoder(message=>{
    const reply={id:message.id,protocol:'SWS-BLE',protocolVersion:'1.0',status:'ok',payload:{echo:message.action}};
    for(const frame of encodeMessage(reply,30))for(let i=0;i<frame.length;i+=11)transport.decoder.push(frame.slice(i,i+11));
  },error=>{throw error;});
  transport.writer={async writeValueWithResponse(bytes){active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,1));decoder.push(bytes);active--;}};
  const result=await Promise.all([transport.request('status'),transport.request('history')]);
  assert.deepEqual(result,[{echo:'status'},{echo:'history'}]);assert.equal(maxActive,1);assert.equal(transport.pending.size,0);transport.disconnect();
});

test('BLE disconnect rejects pending request even when GATT write hangs',async()=>{
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  transport.writer={writeValueWithResponse:()=>new Promise(()=>{})};
  const request=transport.request('setConfiguration',{});
  setTimeout(()=>transport.disconnect(),5);
  await assert.rejects(request,/连接已关闭/);assert.equal(transport.pending.size,0);
});
