import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { FrameDecoder, encodeMessage, authentication, validateHandshake, validateStatus, handshakeAuthentication, secureMessage, readSecureMessage } from '../../prototype/static/js/services/protocol.js';
import { BleTransport } from '../../prototype/static/js/services/ble.js';
import { DeviceController } from '../../prototype/static/js/services/device.js';

const executable=process.env.FIRMWARE_HARNESS || fileURLToPath(new URL('../.tools/firmware-harness.exe',import.meta.url));
const configuration=(revision=1)=>({deviceModel:'ESP32-WATER-C3',configVersion:'1.0',protocolVersion:'1.0',revision,plant:'番茄🌱',locationName:'中国 · 江苏省 · 南京市',supplyVariant:'builtin',params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:9,pulseOnMs:3000,pulseOffMs:25000},display:{dailyWaterNeedMl:200,flowRateMlSec:22}});
function device(t){
  const process=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const replies=[],waiters=[];let controlAck;
  const decoder=new FrameDecoder(message=>{
    if(message.status==='progress')return;
    if(waiters.length)waiters.shift()(message);else replies.push(message);
  },error=>{throw error;});
  const lines=createInterface({input:process.stdout});
  lines.on('line',line=>line==='@ok'?controlAck?.():decoder.push(new TextEncoder().encode(line+'\n')));
  t.after(()=>{lines.close();process.stdin.end();process.kill();});
  let sequence=0;
  const send=(action,payload={},transform=frames=>frames)=>{
    const message={id:'native-'+(++sequence),protocol:'SWS-BLE',protocolVersion:'1.0',action,payload};
    for(const frame of transform(encodeMessage(message)))process.stdin.write(frame);
  };
  const next=()=>replies.length?Promise.resolve(replies.shift()):new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Native firmware reply timed out')),3000);
    waiters.push(result=>{clearTimeout(timer);resolve(result);});
  });
  const request=async(...args)=>{send(...args);const reply=await next();if(reply.status!=='ok')throw new Error(reply.message);return reply.payload;};
  const control=value=>new Promise(resolve=>{controlAck=resolve;process.stdin.write('@'+JSON.stringify(value)+'\n');});
  const authenticate=async()=>{const h=validateHandshake(await request('handshake'));await request('authenticate',{auth:await authentication(h.nonce)});return h;};
  return {request,send,next,control,authenticate,process};
}

test('real C++ endpoint exchanges Unicode configuration, survives restart, and supports confirmed operations',async t=>{
  const d=device(t);const h=await d.authenticate();assert.equal(h.transport.maxConfigBytes,6144);
  const initial=validateStatus(await d.request('status'),h.deviceId);assert.equal(initial.sample,null);assert.equal(initial.configRevision,0);
  const config=configuration();assert.deepEqual(await d.request('setConfiguration',{config},frames=>[frames[1],frames[1],...frames.filter((_,i)=>i!==1).reverse()]),{saved:true,revision:1});
  await assert.rejects(d.request('status'),/认证/);
  await d.authenticate();assert.deepEqual((await d.request('getConfiguration')).config,config);
  await assert.rejects(d.request('setConfiguration',{config}),/递增/);
  await d.control({restart:true});await d.authenticate();assert.deepEqual((await d.request('getConfiguration')).config,config);
  assert.deepEqual((await d.request('history')).records,[]);
  await assert.rejects(d.request('prepareOperation',{operation:'mode',mode:'LONGRUN'}),/自动浇水/);
  let prepared=await d.request('prepareOperation',{operation:'mode',mode:'PREPARE'});
  assert.equal((await d.request('confirmOperation',prepared)).confirmed,true);
  assert.equal((await d.request('status')).mode,'PREPARE');
  await assert.rejects(d.request('confirmOperation',prepared),/令牌/);
  prepared=await d.request('prepareOperation',{operation:'factoryReset'});
  await d.request('confirmOperation',prepared);await d.control({restart:true});await d.authenticate();
  assert.equal((await d.request('status')).configRevision,0);assert.equal((await d.request('getConfiguration')).config,null);
});

test('C++ nonce and confirmation expire, are single-use and are cleared on disconnect',async t=>{
  const d=device(t);let h=await d.request('handshake');let auth=await authentication(h.nonce);
  await d.control({advance:30001});await assert.rejects(d.request('authenticate',{auth}),/失效/);
  h=await d.request('handshake');auth=await authentication(h.nonce);
  await assert.rejects(d.request('authenticate',{auth:'0'.repeat(64)}),/认证失败/);
  await assert.rejects(d.request('authenticate',{auth}),/失效/);
  await d.authenticate();const prepared=await d.request('prepareOperation',{operation:'restart'});
  await d.control({advance:30001});await assert.rejects(d.request('confirmOperation',prepared),/令牌/);
  await d.control({disconnect:true});await assert.rejects(d.request('status'),/认证/);
});

test('C++ rejects invalid configurations and storage failures without a saved acknowledgement',async t=>{
  const d=device(t);await d.authenticate();
  for(const mutate of [c=>c.params.soilWeight='0.6',c=>c.params.threshold=true,c=>c.params.soilWeight=.9,c=>c.params.pulseOnMs=5001,c=>c.params.pulseCount=1.5,c=>c.params.pulseOffMs=60000,c=>c.revision=2147483648,c=>c.deviceModel='other',c=>c.extra='中'.repeat(2200)]){
    const config=configuration();mutate(config);await assert.rejects(d.request('setConfiguration',{config}));
    assert.equal((await d.request('status')).configRevision,0);
  }
  await d.control({failSave:true});await assert.rejects(d.request('setConfiguration',{config:configuration()}),/NVS/);
  assert.equal((await d.request('status')).configRevision,0);
  await d.control({failSave:false});await d.request('setConfiguration',{config:configuration()});await d.authenticate();
  await d.control({failErase:true});const prepared=await d.request('prepareOperation',{operation:'factoryReset'});
  await assert.rejects(d.request('confirmOperation',prepared),/NVS/);assert.equal((await d.request('status')).configRevision,1);
});

test('C++ binds 2.0 configurations to the device and checks the control interval',async t=>{
  const d=device(t),handshake=await d.authenticate();
  assert.equal(handshake.maxConfigVersion,'2.0');
  const config={...configuration(),configVersion:'2.0',targetDeviceId:handshake.deviceId,
    params:{...configuration().params,minWaterIntervalSeconds:172800}};
  await assert.rejects(d.request('setConfiguration',{config:{...config,targetDeviceId:'C3-other'}}),/目标设备不匹配/);
  await assert.rejects(d.request('setConfiguration',{config:{...config,params:{...config.params,minWaterIntervalSeconds:3599}}}),/最短浇水间隔/);
  assert.deepEqual(await d.request('setConfiguration',{config}),{saved:true,revision:1});
  await d.authenticate();assert.deepEqual((await d.request('getConfiguration')).config,config);
});

test('C++ rejects corrupt frames and recovers after a partial-message timeout',async t=>{
  const d=device(t);await d.authenticate();
  await assert.rejects(d.request('status',{},frames=>frames.map(frame=>{
    const value=JSON.parse(new TextDecoder().decode(frame));value.checksum='00000000';return Buffer.from(JSON.stringify(value)+'\n');
  })),/CRC32/);
  d.send('setConfiguration',{config:configuration()},frames=>frames.slice(0,1));
  await d.control({advance:20001});assert.match((await d.next()).message,/超时/);
  assert.equal((await d.request('status')).configRevision,0);
});

test('browser controller and GATT framing operate directly against the compiled firmware core',async t=>{
  const d=device(t),transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  const lines=createInterface({input:d.process.stdout});
  lines.on('line',line=>{if(!line.startsWith('@'))transport.decoder.push(new TextEncoder().encode(line+'\n'));});
  t.after(()=>{lines.close();transport.disconnect();});
  transport.writer={writeValueWithResponse:async bytes=>{d.process.stdin.write(bytes);}};
  const controller=new DeviceController();controller.transport=transport;controller.state='ready';
  await controller.authenticate();controller.status=await transport.request('status');
  const result=await controller.upload(configuration());assert.equal(result.saved,true);assert.equal(controller.status.configRevision,1);
  assert.deepEqual(await controller.download(),configuration());await controller.operate('mode','PREPARE');
  assert.equal(controller.status.mode,'PREPARE');assert.deepEqual(await controller.readHistory(),[]);
});

test('per-device mutual authentication signs messages and rejects replay and tampering',async t=>{
  const d=device(t),secret='1f'.repeat(32);await d.control({secret});
  const handshake=await d.request('handshake');assert.equal(handshake.authProfile,'hmac-sha256-v1');
  await assert.rejects(handshakeAuthentication({...handshake,deviceProof:'0'.repeat(64)},{deviceId:'NATIVE-C3',secret}),/身份/);
  const auth=await handshakeAuthentication(handshake,{deviceId:'NATIVE-C3',secret});
  await d.request('authenticate',{auth:auth.auth});
  await assert.rejects(d.request('status'),/封装/);
  const inner={id:'native-4',protocol:'SWS-BLE',protocolVersion:'1.0',action:'status',payload:{}};
  // The raw helper sequence includes handshake, authentication and rejected status.
  const envelope=await secureMessage(inner,auth.security,'request',1);
  d.send('secured',envelope);const reply=await d.next();assert.equal(reply.status,'secured');
  assert.equal((await readSecureMessage(reply.payload,auth.security,'response',1)).payload.deviceId,'NATIVE-C3');
  await assert.rejects(d.request('secured',envelope),/序号/);
  const nextInner={...inner,id:'native-6'},next=await secureMessage(nextInner,auth.security,'request',2);
  await assert.rejects(d.request('secured',{...next,mac:'0'.repeat(64)}),/完整性/);
});

test('browser controller provisions an authenticated transport against the firmware core',async t=>{
  const d=device(t),secret='2f'.repeat(32);await d.control({secret});
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  const lines=createInterface({input:d.process.stdout});lines.on('line',line=>{if(!line.startsWith('@'))transport.decoder.push(new TextEncoder().encode(line+'\n'));});
  t.after(()=>{lines.close();transport.disconnect();});transport.writer={writeValueWithResponse:async bytes=>{d.process.stdin.write(bytes);}};
  const controller=new DeviceController();controller.transport=transport;controller.state='ready';controller.credential={deviceId:'NATIVE-C3',secret};
  await controller.authenticate();controller.status=await transport.request('status');
  assert.equal(transport.limits.maxConfigBytes,4000);assert.equal((await controller.upload(configuration())).saved,true);
  assert.deepEqual(await controller.download(),configuration());
});

test('viewer and operator credentials are enforced by the C++ endpoint',async t=>{
  const d=device(t),secret='3f'.repeat(32),viewerSecret='4f'.repeat(32),operatorSecret='5f'.repeat(32);
  await d.control({secret,viewerSecret,operatorSecret});
  const transport=new BleTransport({},()=>{},()=>{});transport.closed=false;
  const lines=createInterface({input:d.process.stdout});
  lines.on('line',line=>{if(!line.startsWith('@'))transport.decoder.push(new TextEncoder().encode(line+'\n'));});
  t.after(()=>{lines.close();transport.disconnect();});
  transport.writer={writeValueWithResponse:async bytes=>{d.process.stdin.write(bytes);}};
  const controller=new DeviceController();controller.transport=transport;controller.state='ready';
  controller.credential={deviceId:'NATIVE-C3',role:'viewer',secret:viewerSecret};
  await controller.authenticate();
  assert.equal(controller.handshake.authorizationRole,'viewer');
  assert.equal((await transport.request('status')).authorizationRole,'viewer');
  await assert.rejects(transport.request('setConfiguration',{config:configuration()}),/仅允许读取/);
  assert.equal((await transport.request('stop')).stopped,true);
  controller.credential={deviceId:'NATIVE-C3',role:'operator',secret:operatorSecret};
  await controller.authenticate();
  assert.equal((await transport.request('status')).authorizationRole,'operator');
  await assert.rejects(transport.request('setConfiguration',{config:configuration()}),/无权修改/);
  await assert.rejects(transport.request('prepareOperation',{operation:'factoryReset'}),/无权修改/);
  const prepared=await transport.request('prepareOperation',{operation:'mode',mode:'PREPARE'});
  assert.equal((await transport.request('confirmOperation',prepared)).confirmed,true);
});
