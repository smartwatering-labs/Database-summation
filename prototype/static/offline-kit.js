import { DeviceController } from './js/services/device.js';
import { validateConfigFile } from './js/services/config-file.js';
import { exportConfig } from './js/services/api.js';
import { validateCredential } from './js/services/protocol.js';

const device=new DeviceController();
const byId=id=>document.getElementById(id);
let config=null;
let credential=null;

function fields(node,rows){
  node.replaceChildren();
  for(const [label,value] of rows){
    const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent=label;description.textContent=String(value);row.append(term,description);node.append(row);
  }
}
function message(value,error=false){const node=byId('message');node.textContent=value;node.classList.toggle('error',error);}
function update(){
  const ready=device.state==='ready',busy=device.busy;
  fields(byId('config-summary'),config?[
    ['植物',config.plant],['格式',config.configVersion],['版本',`R${config.revision}`],
    ['目标设备',config.configVersion==='2.0'?config.targetDeviceId:'1.0 配置未绑定设备'],
    ['最短浇水间隔',config.configVersion==='2.0'?`${config.params.minWaterIntervalSeconds} 秒`:'未包含控制字段']
  ]:[['当前配置','尚未导入']]);
  fields(byId('device-summary'),ready?[
    ['设备 ID',device.status.deviceId],['固件版本',device.status.fwVersion],
    ['当前配置版本',`R${device.status.configRevision}`],['状态',device.demo?'模拟设备':'已连接'],
    ['认证方式',device.handshake.authProfile==='hmac-sha256-v1'?'设备密钥认证与消息校验':'开发认证'],
    ['写入核对',device.pendingWrite?'待原设备读回':'无待核对写入']
  ]:[['设备',device.error||'尚未连接']]);
  byId('connect').disabled=busy;byId('disconnect').disabled=!ready||busy;
  byId('export').disabled=!config;
  byId('upload').disabled=!ready||busy||!config||!!device.pendingWrite;
  byId('verify').disabled=!ready||busy||!device.pendingWrite||device.pendingWrite.deviceId!==device.status?.deviceId;
  byId('download').disabled=!ready||busy;
}
device.addEventListener('change',update);
byId('file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>64*1024)throw new Error('配置文件超过 64 KB');
    const parsed=JSON.parse(await file.text());
    config=validateConfigFile(parsed);message(`已导入 ${config.plant} R${config.revision}，请连接并核对目标设备。`);update();
  }catch(error){config=null;message(error instanceof SyntaxError?'JSON 文件格式无效':error.message,true);update();}
  finally{event.target.value='';}
});
byId('export').addEventListener('click',()=>{try{exportConfig(config);message('当前配置已导出。');}catch(error){message(error.message,true);}});
byId('credential').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>4096)throw new Error('凭据文件超过 4 KB');credential=validateCredential(JSON.parse(await file.text()));byId('credential-state').textContent=`本页已载入 ${credential.deviceId} 的凭据；刷新后清除。`;}
  catch(error){credential=null;message(error.message,true);}finally{event.target.value='';}
});
byId('connect').addEventListener('click',async()=>{
  const settings={serviceUuid:byId('service-uuid').value.trim(),writeUuid:byId('write-uuid').value.trim(),notifyUuid:byId('notify-uuid').value.trim(),credential};
  try{message('正在连接并读取设备状态…');await device.connect(settings);message(`已连接 ${device.status.deviceId}，当前 R${device.status.configRevision}。`);}
  catch(error){message(error.message,true);}finally{update();}
});
byId('disconnect').addEventListener('click',()=>{device.disconnect();message('设备已断开。');update();});
byId('upload').addEventListener('click',async()=>{
  try{
    if(!config||device.state!=='ready')throw new Error('请先导入配置并连接设备');
    validateConfigFile(config,device.status.configRevision);
    if(config.configVersion==='2.0'&&config.targetDeviceId!==device.status.deviceId)throw new Error('配置目标设备与当前连接不一致');
    if(!window.confirm(`将 ${config.plant} R${config.revision} 发送到 ${device.status.deviceId}。确认发送？`))return;
    message('正在发送并等待设备保存回执…');const result=await device.upload(config);
    message(result.statusRefreshFailed?'设备已确认保存；请重连读取状态核对。':'设备已确认保存配置。');
  }catch(error){message(error.message,true);}finally{update();}
});
byId('verify').addEventListener('click',async()=>{
  try{message('正在从原设备读回配置…');const result=await device.verifyPendingWrite();
    message(({saved:'读回确认：已保存该配置。','not-saved':'读回确认：尚未保存该版本。',changed:'设备配置已变化，请重新生成或核对。'})[result]);}
  catch(error){message(error.message,true);}finally{update();}
});
byId('download').addEventListener('click',async()=>{
  try{const downloaded=await device.download();config=validateConfigFile(downloaded);message(`已读取设备配置 R${config.revision}；可导出本机文件。`);}
  catch(error){message(error.message,true);}finally{update();}
});

async function install(){
  const node=byId('cache-state');
  if(!('serviceWorker' in navigator)||!globalThis.isSecureContext){node.textContent='当前浏览器环境不支持离线缓存；可在服务在线时使用此页。';return;}
  try{
    const registration=await navigator.serviceWorker.register('/offline-sw.js',{scope:'/'});
    await navigator.serviceWorker.ready;
    node.textContent=registration.active?'离线入口已缓存；保存 JSON 文件后，可在本地服务关闭时重新打开本页。':'离线入口正在缓存，请稍后刷新确认。';
  }catch(error){node.textContent=`离线缓存未安装：${error.message}`;}
}
update();install();
addEventListener('pagehide',()=>{credential=null;device.credential=null;device.disconnect();});
