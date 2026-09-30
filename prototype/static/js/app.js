import { api, exportConfig } from './services/api.js';
import './variable-proximity.js';
import { enhancePage, closeDetails } from './presentation.js';
import { modelStage } from './model-stage.js';
import { surfaceMotion } from './surface-motion.js';
import './interaction-motion.js';
import './theme.js';
import { DeviceController } from './services/device.js';
import { home } from './pages/home.js';
import { product } from './pages/product.js';
import { configure, resultPanel, countryMatches, countryOptions } from './pages/configure.js';
import { devicePage } from './pages/device.js';
import { button, icon, escape as e, drawChart, modes } from './ui.js';

const device = new DeviceController();
const state = {
  settings: { demoEnabled: false, ble: {} }, plants: { items: [] },
  scene: { plantId:'tomato', locationToken:'', cultivation:'pot', potLiters:10, light:'partial', season:'autumn', supplyVariant:'builtin', reservoirLiters:20, flowRateMlSec:null, waterSource:'储水桶，已接好水泵与供水管' },
  place:{countries:[],country:null,province:null,city:null,provinces:[],cities:[],countryText:'',countryOpen:false,active:-1,countriesLoading:false,countryError:''},
  result:null, dirty:false, generating:false, environment:null, environmentLoading:false, historyOpen:false, historyPage:0,
  selectedLocation:null, locationCandidates:[], locationLoading:false, locationError:'', environmentError:'',
  ready:false, deviceError:'', writeResult:null,
};
const pages = {home:['首页','home',home],product:['产品介绍','leaf',product],configure:['个性化库编译','settings',configure],device:['硬件情况查看','device',devicePage]};
const main = document.querySelector('#main'), dialog = document.querySelector('#dialog');
let route = 'home', toastTimer, generationAbort, environmentAbort, environmentGeneration = 0, locationGeneration = 0, locationAbort, dialogSubmit, pollFailures = 0;
let countryGeneration=0,countryAbort;
let navigationVersion=0;
const navigation=document.querySelector('#navigation');
const indicatorMotion={y:0,height:0,frame:0,initialized:false};
const desktopNavigation=matchMedia('(min-width:768px)'),reducedNavigation=matchMedia('(prefers-reduced-motion: reduce)');
function moveNavigationIndicator(link,animate=true){
  const indicator=navigation.querySelector('.nav-hover-indicator');
  if(!indicator||!link)return;
  cancelAnimationFrame(indicatorMotion.frame);indicatorMotion.frame=0;
  // A closed mobile menu has zero-sized boxes and a different offset parent.
  // Never cache that geometry for the desktop indicator.
  if(!desktopNavigation.matches){indicatorMotion.initialized=false;indicator.classList.remove('visible');return;}
  const bounds=link.getBoundingClientRect(),parent=navigation.getBoundingClientRect();
  if(!bounds.width||!bounds.height){indicatorMotion.initialized=false;return;}
  const targetY=bounds.top-parent.top+navigation.scrollTop,targetHeight=bounds.height;
  indicator.style.left=`${bounds.left-parent.left}px`;indicator.style.right='auto';indicator.style.width=`${bounds.width}px`;
  const fromY=indicatorMotion.y,fromHeight=indicatorMotion.height;
  const duration=animate&&indicatorMotion.initialized&&!reducedNavigation.matches?220:0,start=performance.now();
  indicatorMotion.initialized=true;
  const tick=time=>{
    const t=duration?Math.min(1,Math.max(0,(time-start)/duration)):1,p=1-Math.pow(1-t,3);
    indicatorMotion.y=fromY+(targetY-fromY)*p;indicatorMotion.height=fromHeight+(targetHeight-fromHeight)*p;
    indicator.style.height=`${indicatorMotion.height}px`;indicator.style.transform=`translate3d(0,${indicatorMotion.y}px,0)`;
    if(t<1)indicatorMotion.frame=requestAnimationFrame(tick);else indicatorMotion.frame=0;
  };
  if(duration)indicatorMotion.frame=requestAnimationFrame(tick);else tick(start);
  indicator.classList.add('visible');
}
navigation.innerHTML = '<span class="nav-hover-indicator" aria-hidden="true"></span>'+Object.entries(pages).filter(([key])=>key!=='admin').map(([key,[label,symbol]])=>`<a class="nav-link" href="#${key}">${icon(symbol)}<span>${label}</span></a>`).join('');
const alignNavigation=()=>moveNavigationIndicator(navigation.querySelector('[aria-current="page"]'),false);
const navigationObserver=new ResizeObserver(alignNavigation);
navigationObserver.observe(navigation);navigation.querySelectorAll('.nav-link').forEach(link=>navigationObserver.observe(link));
desktopNavigation.addEventListener('change',alignNavigation);reducedNavigation.addEventListener('change',alignNavigation);
addEventListener('resize',alignNavigation);
addEventListener('pagehide',()=>{cancelAnimationFrame(indicatorMotion.frame);navigationObserver.disconnect();},{once:true});

function toast(message, error = false) {
  const node = document.querySelector('#toast'); clearTimeout(toastTimer); node.textContent = message;
  node.className = 'toast' + (error ? ' error' : ''); node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 7000 : 4500);
}

function updateChrome() {
  const labels = {disconnected:'未连接',connecting:'正在连接',handshaking:'正在握手',ready:device.demo?'模拟设备 · 已连接':'设备已连接',error:'连接失败'};
  const label = labels[device.state];
  document.querySelector('#connection-status').innerHTML = `<span class="status-dot ${device.state==='ready'?'online':''}"></span>${e(label)}`;
  document.querySelector('#sidebar-connection').textContent = label;
  const connect = document.querySelector('.sidebar-bottom [data-action="connect"]');
  connect.disabled = device.busy; connect.textContent = device.state==='ready' ? '连接管理' : '连接设备';
  document.querySelector('#breadcrumb').textContent = '控制台 / ' + pages[route][0];
  const current=navigation.querySelector('.nav-link[aria-current="page"]'),next=navigation.querySelector(`.nav-link[href="#${route}"]`);
  if(current!==next){current?.removeAttribute('aria-current');next?.setAttribute('aria-current','page');moveNavigationIndicator(next);}
  else if(!indicatorMotion.initialized)moveNavigationIndicator(next);
}

function render() {
  if (!state.ready) return;
  const savedScroll=main.dataset.route===route?(main.querySelector('.panel-scroll')?.scrollTop||0):0;
  main.innerHTML = pages[route][2](state, device);
  main.dataset.route=route;
  document.title = pages[route][0] + ' · 浇水'; updateChrome(); updateLocks();
  enhancePage(main, route);
  surfaceMotion.bind();
  const panel=main.querySelector('.panel-scroll');if(panel)panel.scrollTop=savedScroll;
  draw();
  modelStage.update(route);
  document.dispatchEvent(new CustomEvent('workspace:render',{detail:{route}}));
}
function invalidateLocation() {
  locationGeneration++;locationAbort?.abort();environmentGeneration++;environmentAbort?.abort();
  state.scene.locationToken='';state.selectedLocation=null;state.locationCandidates=[];state.locationLoading=false;
  state.environment=null;state.environmentError='';state.environmentLoading=false;state.locationError='';
  state.dirty=!!state.result;state.writeResult=null;
  const confirmation=document.querySelector('#location-confirmation');if(confirmation)confirmation.innerHTML='';
    const panel=document.querySelector('#environment-panel');if(panel)panel.innerHTML='';
  const error=document.querySelector('#location-error');if(error)error.innerHTML='';
  const submit=document.querySelector('#scenario-form button[type="submit"]');if(submit)submit.disabled=true;
}
async function loadEnvironment() {
  if(!state.scene.locationToken)return;
  const generation=++environmentGeneration;
  environmentAbort?.abort();environmentAbort=new AbortController();
  state.environmentLoading=true;state.environment=null;state.environmentError='';render();
  try {
    const result=await api('/api/environment',{method:'POST',body:{locationToken:state.scene.locationToken},signal:environmentAbort.signal});
    if(generation===environmentGeneration)state.environment=result;
  } catch(error) {
    if(generation===environmentGeneration)state.environmentError=error.message;
  } finally {
    if(generation===environmentGeneration){state.environmentLoading=false;render();}
  }
}
async function chooseLocation(selected) {
  if(!selected?.selectable||!selected.locationToken)return;
  state.selectedLocation=selected;state.scene.locationToken=selected.locationToken;state.dirty=!!state.result;state.writeResult=null;
  const months=selected.latitude>=0
    ? ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter']
    : ['summer','summer','autumn','autumn','autumn','winter','winter','winter','spring','spring','spring','summer'];
  state.scene.season=months[new Date().getUTCMonth()];
  await loadEnvironment();
}

function syncCountryMenu() {
  const input=document.querySelector('#country-search'),list=document.querySelector('#country-options');
  if(!input||!list)return;
  input.setAttribute('aria-expanded',String(state.place.countryOpen));
  if(state.place.active>=0)input.setAttribute('aria-activedescendant','country-option-'+state.place.active);
  else input.removeAttribute('aria-activedescendant');
  list.hidden=!state.place.countryOpen;list.innerHTML=countryOptions(state);
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
}
async function loadCountries() {
  const g=++countryGeneration;countryAbort?.abort();countryAbort=new AbortController();
  invalidateLocation();Object.assign(state.place,{countries:[],country:null,province:null,city:null,provinces:[],cities:[],countriesLoading:true,countryError:'',active:-1});render();
  try {
    const result=await api('/api/locations/countries',{signal:countryAbort.signal,timeoutMs:30000});
    if(g===countryGeneration)state.place.countries=result.items;
  }catch(error){if(g===countryGeneration)state.place.countryError=error.message;}
  finally{if(g===countryGeneration){state.place.countriesLoading=false;syncCountryMenu();
    const reload=document.querySelector('[data-action="reload-locations"]');if(reload)reload.disabled=state.generating;
    const error=document.querySelector('#location-error');if(error)error.textContent=state.place.countryError;
  }}
}
async function loadPlace(node) {
  invalidateLocation();const g=++locationGeneration;locationAbort=new AbortController();state.locationLoading=true;render();
  try {
    const result=await api(node.terminal?'/api/locations/select':'/api/locations/children',{
      method:'POST',body:node.terminal?{selectionToken:node.selectionToken}:{parentToken:node.selectionToken},signal:locationAbort.signal,timeoutMs:30000});
    if(g!==locationGeneration)return;
    state.locationLoading=false;
    if(node.terminal){await chooseLocation(result.location);return;}
    if(node.kind==='country'&&node.id==='CN')state.place.provinces=result.items;
    else state.place.cities=result.items;
  }catch(error){if(g===locationGeneration)state.locationError=error.message;}
  finally{if(g===locationGeneration){state.locationLoading=false;render();}}
}
async function selectCountry(code) {
  const country=state.place.countries.find(item=>item.id===code);if(!country)return;
  Object.assign(state.place,{country,countryText:country.name,countryOpen:false,active:-1,province:null,city:null,provinces:[],cities:[]});
  await loadPlace(country);
}

function updateResult() {
  const result = document.querySelector('#configuration-result');
  if (result) result.innerHTML = resultPanel(state, device);
}
function updateLocks() {
  document.querySelectorAll('#scenario-form input,#scenario-form select,#scenario-form textarea').forEach(node=>{ node.disabled = state.generating || node.dataset.unavailable==='true'; });
}
function draw() { drawChart(document.querySelector('#demand-chart'), device.trend, null); }

device.addEventListener('change', () => {
  updateChrome();
  if (!state.ready) return;
  if (route==='device') render();
  else if (route==='configure') {
    // Sensor events must not replace an in-progress scene form.
    updateResult();
    document.querySelectorAll('.device-controls button,.device-controls select').forEach(node=>{node.disabled=device.state!=='ready'||device.busy||state.generating;});
  }
});

function closeMenu() {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('.main-shell').inert=false;
  const toggle=document.querySelector('#menu-toggle'); toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','打开导航'); toggle.innerHTML=icon('menu'); document.body.style.overflow='';
}
async function navigate() {
  const hash=location.hash.slice(1)||'home',next=pages[hash]?hash:'home';
  const version=++navigationVersion,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const changing=!!main.dataset.route&&main.dataset.route!==next;
  closeDetails();closeMenu();main.inert=true;
  const movement=modelStage.update(next,false);
  if(changing&&!reduce){await surfaceMotion.hide();if(version!==navigationVersion)return;}
  surfaceMotion.setPage(next);
  route=next;render();window.scrollTo({top:0,behavior:'instant'});
  if(route==='configure'&&!state.place.countries.length&&!state.place.countriesLoading&&!state.place.countryError)loadCountries();
  if(changing&&!reduce)await movement;
  if(version!==navigationVersion)return;
  await surfaceMotion.reveal(changing&&!reduce);if(version!==navigationVersion)return;
  main.inert=false;
  main.focus({preventScroll:true});
}
window.addEventListener('hashchange',navigate);
document.querySelector('#menu-toggle').innerHTML=icon('menu');
document.querySelector('#menu-toggle').addEventListener('click',()=>{
  const open=document.querySelector('#sidebar').classList.toggle('open'), toggle=document.querySelector('#menu-toggle');
  toggle.setAttribute('aria-expanded',String(open)); toggle.setAttribute('aria-label',open?'关闭导航':'打开导航'); toggle.innerHTML=icon(open?'close':'menu');
  document.body.style.overflow=open?'hidden':'';
  document.querySelector('.main-shell').inert=open;
  if(open) document.querySelector('#navigation a')?.focus();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!dialog.open&&!document.querySelector('#detail-dialog').open) {closeMenu();document.querySelector('#menu-toggle').focus();}
  if(event.key==='Tab'&&document.querySelector('#sidebar').classList.contains('open')) {
    const nodes=[document.querySelector('#menu-toggle'),...document.querySelectorAll('#sidebar a,#sidebar button:not(:disabled),#sidebar select')].filter(node=>node.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});

function openDialog(title, content, submit, label='确认') {
  dialogSubmit=submit;
  document.querySelector('#dialog-content').innerHTML=`<form id="dialog-form" autocomplete="off"><div class="dialog-heading"><h2 id="dialog-title">${e(title)}</h2><button type="button" class="button ghost icon-button" data-action="close-dialog" aria-label="关闭对话框">${icon('close')}</button></div>${content}<div class="form-error" id="dialog-error" role="alert"></div><div class="dialog-actions">${button('取消','close-dialog',{type:'outline',extra:'type="button"'})}<button type="submit" class="button primary">${e(label)}</button></div></form>`;
  dialog.showModal();
}
function confirmAction(title, description, operation, requiredText='') {
  openDialog(title,`<p class="dialog-description">${e(description)}</p>${device.demo?'<p class="notice warning">当前操作目标为模拟设备</p>':''}${requiredText?`<label class="dialog-field">请输入“${e(requiredText)}”确认<input name="confirmation" required autocomplete="off"></label>`:''}`,async form=>{
    if(requiredText&&new FormData(form).get('confirmation')!==requiredText)throw new Error('确认文字不一致');
    dialog.close(); await operation();
  });
}

function connectionDialog() {
  if(device.busy)return toast('请等待当前设备操作完成');
  closeMenu();
  const ble=state.settings.ble;
  openDialog('连接浇水设备',`<p class="dialog-description">请按外置按钮唤醒 ESP32-C3，并打开电脑或手机蓝牙；浏览器会让你选择设备</p>
  <div class="notice">默认值对应随项目提供的 ESP32-C3 BLE 验证固件；以下设置只在当前页面生效，量产固件可在部署环境中覆盖</div>
  ${['serviceUuid','writeUuid','notifyUuid'].map((key,i)=>`<label class="dialog-field">${['BLE 服务 UUID','写入特征 UUID','通知特征 UUID'][i]}<input name="${key}" value="${e(ble[key]||'')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"></label>`).join('')}
  <p class="caption muted">SWS-BLE 1.0 · JSON 分包传输；页面不支持远程唤醒设备</p>${device.state==='ready'?button('断开当前连接','disconnect',{type:'outline',extra:'type="button"'}):''}`,async form=>{
    Object.assign(state.settings.ble,Object.fromEntries(new FormData(form)));
    dialog.close(); resetDeviceView(); await device.connect(state.settings.ble); toast('设备连接与握手成功');render();
  },'选择并连接设备');
}
function resetDeviceView(){state.historyOpen=false;state.historyPage=0;state.deviceError='';state.writeResult=null;pollFailures=0;}

function readScene(form) {
  const data=Object.fromEntries(new FormData(form));
    for(const key of ['potLiters','reservoirLiters','flowRateMlSec']){
      const value=data[key] ?? state.scene[key];data[key]=value==null||value===''?null:Number(value);
    }
  return {...state.scene,...data};
}

main.addEventListener('input',event=>{
  if(!event.target.closest('#scenario-form'))return;
  if(event.target.id==='country-search'){
    invalidateLocation();Object.assign(state.place,{countryText:event.target.value,country:null,province:null,city:null,provinces:[],cities:[],countryOpen:true,active:-1});
    document.querySelector('#place-dependent').innerHTML='';syncCountryMenu();updateResult();return;
  }
  state.scene=readScene(document.querySelector('#scenario-form'));state.dirty=!!state.result;state.writeResult=null;
  if(state.result)updateResult();
});
main.addEventListener('change',event=>{
  if(event.target.id==='config-file') {importFile(event.target.files[0]);return;}
  if(!event.target.closest('#scenario-form'))return;
  state.scene=readScene(document.querySelector('#scenario-form'));state.dirty=!!state.result;
  if(event.target.id==='place-province'){
    const province=state.place.provinces.find(x=>x.id===event.target.value);if(!province)return;
    Object.assign(state.place,{province,city:null,cities:[]});loadPlace(province);return;
  }
  if(event.target.id==='place-city'){
    const city=state.place.cities.find(x=>x.id===event.target.value);if(!city)return;
    state.place.city=city;loadPlace(city);return;
  }
  if(['cultivation','supplyVariant'].includes(event.target.name))render();
});

main.addEventListener('focusin',event=>{if(event.target.id==='country-search'){state.place.countryOpen=true;syncCountryMenu();}});
main.addEventListener('focusout',event=>{if(event.target.closest('.country-field')&&!event.relatedTarget?.closest('.country-field')){state.place.countryOpen=false;syncCountryMenu();}});
main.addEventListener('keydown',event=>{
  if(event.target.id!=='country-search')return;
  const items=countryMatches(state);
  if(['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)){
    event.preventDefault();event.stopPropagation();
    if(event.key==='Escape'){state.place.countryOpen=false;state.place.active=-1;}
    else if(event.key==='Enter'){if(state.place.countryOpen&&items.length)selectCountry(items[Math.max(0,state.place.active)].id);return;}
    else {state.place.countryOpen=true;state.place.active=items.length?(state.place.active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length:-1;}
    syncCountryMenu();
  }
});

main.addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.target.id==='scenario-form') {
    if(state.generating||device.busy||!state.scene.locationToken||state.environmentLoading||!state.environment)return;
    state.scene=readScene(event.target);state.formError='';state.generating=true;state.writeResult=null;device.stage=null;
    const payload={...state.scene,currentRevision:device.status?.configRevision||0};
    generationAbort=new AbortController();render();
    try {
      state.result=await api('/api/configurations/generate',{method:'POST',body:payload,signal:generationAbort.signal});
      state.environment=state.result.environment;state.dirty=false;toast('配置已生成，请检查推荐说明后再发送');
    }catch(error){state.formError=error.message;toast(error.message,true);}
    finally{state.generating=false;render();document.querySelector(state.formError?'#form-error':'#configuration-result')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  }
});

dialog.addEventListener('submit',async event=>{
  event.preventDefault();const submit=event.target.querySelector('button[type=submit]');submit.disabled=true;
  try{await dialogSubmit(event.target);}catch(error){if(dialog.open)document.querySelector('#dialog-error').textContent=error.message;else toast(error.message,true);}
  finally{submit.disabled=false;}
});

async function importFile(file) {
  if(!file)return;
  try{
    if(file.size>64*1024)throw new Error('配置文件超过 64 KB');
    let config;try{config=JSON.parse(await file.text());}catch{throw new Error('无法解析 JSON 文件，请检查文件格式');}
    state.result=await api('/api/configurations/import',{method:'POST',body:{config}});
    state.dirty=false;state.writeResult=null;device.stage=null;toast('配置导入并校验成功');render();
  }catch(error){toast(error.message,true);const node=document.querySelector('#config-file');if(node)node.value='';}
}

const actions={
  'go-device':()=>{location.hash='device';},
  connect:connectionDialog,
  'close-dialog':()=>dialog.close(),
  demo:async()=>{if(!state.settings.demoEnabled)throw new Error('模拟设备未启用');resetDeviceView();await device.connect({},true);toast('模拟设备已连接，所有读数均为演示数据');render();},
  disconnect:()=>{device.disconnect();resetDeviceView();dialog.close();render();toast('设备已断开');},
  refresh:async()=>{await device.refresh();state.deviceError='';pollFailures=0;render();toast('已读取最新设备状态');},
  environment:loadEnvironment,
  'choose-country':element=>selectCountry(element.dataset.code),
  'reload-locations':loadCountries,
  import:()=>document.querySelector('#config-file').click(),
  export:async()=>{if(!state.result)throw new Error('请先生成或导入配置');await exportConfig(state.result.config);toast('配置文件已导出');},
  upload:()=>{
    if(state.dirty)throw new Error('场景已修改，请重新生成配置');
    const config=structuredClone(state.result?.config);if(!config)throw new Error('请先生成配置');
    confirmAction('发送配置到设备',`将 ${config.plant} 的 R${config.revision} 配置发送到 ${device.status?.deviceId}；设备会校验版本和参数，并在本地保存`,async()=>{
      state.writeResult=null;
      try{const result=await device.upload(config);state.writeResult='saved';toast(result.statusRefreshFailed?'配置已保存；状态刷新失败，请重新连接核对':'设备已确认配置写入成功');}
      catch(error){state.writeResult='failed';throw error;}
      finally{render();}
    });
  },
  'device-download':async()=>{const config=await device.download();state.result=await api('/api/configurations/import',{method:'POST',body:{config}});state.dirty=false;state.writeResult=null;render();toast('已读取设备配置，可预览或导出');},
  mode:()=>{
    const mode=document.querySelector('#target-mode').value;
    confirmAction('确认切换运行模式',`将切换到 ${mode}（${modes[mode]}）；${mode==='LONGRUN'?'请先完成实物标定，长期运行可能执行浇水并进入休眠':'设备将按目标模式工作'}；操作仍需固件二次确认`,async()=>{await device.operate('mode',mode);render();toast('设备已确认模式切换');});
  },
  restart:()=>confirmAction('重启设备','设备将重启，蓝牙连接会断开；当前已保存配置仍保留',async()=>{await device.operate('restart');toast('设备已确认重启');}),
  'factory-reset':()=>confirmAction('恢复出厂设置','此操作将清除设备本地配置并重启，无法撤销；建议先读取并导出配置',async()=>{await device.operate('factoryReset');toast('设备已确认恢复出厂');},'恢复出厂'),
  history:async()=>{
    state.historyLoading=true;render();
    try{await device.readHistory();state.historyOpen=true;state.historyPage=0;toast(`已读取 ${device.history.length} 条近期记录`);}
    finally{state.historyLoading=false;render();}
  },
  'history-prev':()=>{state.historyPage=Math.max(0,state.historyPage-1);render();},
  'history-next':()=>{state.historyPage=Math.min(Math.ceil(device.history.length/12)-1,state.historyPage+1);render();},
  retry:()=>initialize(),
};

document.addEventListener('click',async event=>{
  const element=event.target.closest('[data-action]');if(!element||element.disabled)return;
  const action=actions[element.dataset.action];if(!action)return;
  event.preventDefault();
  try{await action(element);}catch(error){toast(error.message,true);if(route==='device'){state.deviceError=error.message;render();}}
});

const polling=setInterval(async()=>{
  if(route!=='device'||document.visibilityState!=='visible'||device.state!=='ready'||device.busy||dialog.open)return;
  try{await device.refresh();pollFailures=0;state.deviceError='';}
  catch(error){state.deviceError=error.message;pollFailures++;if(pollFailures>=3)device.disconnect('连续读取失败，请唤醒设备并重新连接');render();}
},10000);
window.addEventListener('resize',()=>{draw();if(window.innerWidth>=768)closeMenu();});
window.addEventListener('pagehide',()=>{
  generationAbort?.abort();environmentAbort?.abort();locationAbort?.abort();countryAbort?.abort();clearInterval(polling);device.disconnect();device.simulator=null;
    state.scene={};state.result=null;state.environment=null;state.selectedLocation=null;state.locationCandidates=[];state.place={countries:[]};
  document.querySelectorAll('input,textarea').forEach(node=>{node.value='';});
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

async function initialize() {
  try{
    const [settings,plants]=await Promise.all(['/api/settings','/api/plants'].map(path=>api(path)));
    Object.assign(state,{settings,plants,ready:true});navigate();
  }catch(error){main.innerHTML=`<section class="empty-state"><h1>工作区暂时无法加载</h1><p>${e(error.message)}</p>${button('重新加载','retry',{type:'primary'})}</section>`;}
}
initialize();
