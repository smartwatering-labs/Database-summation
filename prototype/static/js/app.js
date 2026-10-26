import { api, exportConfig } from './services/api.js';
import { importedConfigResult } from './services/config-file.js';
import { validateCredential } from './services/protocol.js';
import './variable-proximity.js';
import { enhancePage, closeDetails } from './presentation.js';
import { modelStage } from './model-stage.js';
import { surfaceMotion } from './surface-motion.js';
import './interaction-motion.js';
import './theme.js';
import { DeviceController } from './services/device.js';
import { home } from './pages/home.js';
import { product } from './pages/product.js';
import { configure, connectivityPanel, resultPanel, countryMatches, countryOptions } from './pages/configure.js';
import { devicePage } from './pages/device.js';
import { button, icon, escape as e, drawChart, connectionPhases } from './ui.js';
import { initDeviceHold } from './device-hold.js';
import { getLanguage, localize, observeLanguage, translateText } from './i18n.js';
import { initLanguageCurtain, switchLanguage } from './language-curtain.js';

const device = new DeviceController();
const state = {
  settings: { demoEnabled: false, ble: {} }, plants: { items: [] },
  scene: { plantId:'tomato', locationToken:'', cultivation:'pot', siteType:'outdoor', potLiters:10, light:'partial', season:'autumn', supplyVariant:'builtin', reservoirLiters:20, flowRateMlSec:null, siteTemperatureC:null,siteHumidityPct:null,siteObservedLocal:'' },
  place:{countries:[],country:null,province:null,city:null,provinces:[],cities:[],countryText:'',countryOpen:false,active:-1,countriesLoading:false,countryError:''},
  result:null, resultTargetDeviceId:null, dirty:false, generating:false, environment:null, environmentLoading:false, historyOpen:false, historyPage:0, eventsOpen:false, eventsPage:0, eventsLoading:false,
  selectedLocation:null, locationCandidates:[], locationLoading:false, locationError:'', environmentError:'',
  ready:false, backendReachable:null, backendCheckedAt:null, deviceError:'', writeResult:null, revealConfiguration:false,
};
const pages = {home:['首页','home',home],product:['产品介绍','leaf',product],configure:['个性化库编译','settings',configure],device:['硬件情况查看','device',devicePage]};
const main = document.querySelector('#main'), dialog = document.querySelector('#dialog');
observeLanguage();
initLanguageCurtain(() => {
  if(state.place.country){state.place.countryText=getLanguage()==='en'?(state.place.country.englishName||state.place.country.name):state.place.country.name;const countryInput=document.querySelector('#country-search');if(countryInput)countryInput.value=state.place.countryText;}
  document.title=pages[route][0]+' · 浇水';
  if(state.ready&&route==='device')render({freshDeviceControls:true});
  else if(state.ready&&route==='configure')render();
  else localize(document);
});
document.querySelector('#language-toggle').addEventListener('click', () => {
  void switchLanguage(getLanguage()==='zh'?'en':'zh');
});
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
  const label = connectionPhases[device.connectionPhase]?.[0] || labels[device.state];
  document.querySelector('#sidebar-connection').textContent = label;
  const connect = document.querySelector('.sidebar-bottom [data-action="connect"]');
  connect.disabled = device.busy; connect.textContent = device.state==='ready' ? '连接管理' : '连接设备';
  document.querySelector('#breadcrumb').textContent = '控制台 / ' + pages[route][0];
  const current=navigation.querySelector('.nav-link[aria-current="page"]'),next=navigation.querySelector(`.nav-link[href="#${route}"]`);
  if(current!==next){current?.removeAttribute('aria-current');next?.setAttribute('aria-current','page');moveNavigationIndicator(next);}
  else if(!indicatorMotion.initialized)moveNavigationIndicator(next);
}

function render({freshDeviceControls=false}={}) {
  if (!state.ready) return;
  const savedScroll=main.dataset.route===route?(main.querySelector('.panel-scroll')?.scrollTop||0):0;
  const retainedControls=!freshDeviceControls&&route==='device'&&main.dataset.route===route&&device.state==='ready'
    &&main.dataset.deviceGeneration===String(device.generation)?main.querySelector('.device-controls'):null;
  main.innerHTML = pages[route][2](state, device);
  const freshControls=main.querySelector('.device-controls');
  if(retainedControls&&freshControls){
    const previous=retainedControls.querySelector('#target-mode'),fresh=freshControls.querySelector('#target-mode');
    const selected=previous?.value===retainedControls.dataset.mode?fresh?.value:previous?.value;
    if(previous&&fresh){
      const options=node=>JSON.stringify([...node.options].map(option=>[option.value,option.textContent]));
      if(options(previous)!==options(fresh))previous.innerHTML=fresh.innerHTML;
      previous.value=[...previous.options].some(option=>option.value===selected)?selected:fresh.value;
      previous.disabled=fresh.disabled;
    }
    retainedControls.querySelectorAll('button[data-action]').forEach(node=>{
      const replacement=freshControls.querySelector(`[data-action="${node.dataset.action}"]`);
      if(replacement)node.disabled=replacement.disabled;
    });
    retainedControls.querySelector('[data-current-mode]').textContent=freshControls.querySelector('[data-current-mode]').textContent;
    freshControls.replaceWith(retainedControls);
  }
  const controls=main.querySelector('.device-controls');if(controls)controls.dataset.mode=device.status.mode;
  main.dataset.deviceGeneration=String(device.generation);
  main.dataset.route=route;
  document.title = pages[route][0] + ' · 浇水'; updateChrome(); updateLocks();
  enhancePage(main, route);
  surfaceMotion.bind();
  const panel=main.querySelector('.panel-scroll');if(panel)panel.scrollTop=savedScroll;
  draw();
  modelStage.update(route);
  document.dispatchEvent(new CustomEvent('workspace:render',{detail:{route}}));
  localize(document);
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
  Object.assign(state.place,{country,countryText:getLanguage()==='en'?country.englishName||country.name:country.name,countryOpen:false,active:-1,province:null,city:null,provinces:[],cities:[]});
  await loadPlace(country);
}

function updateResult() {
  const result = document.querySelector('#configuration-result');
  if (result) result.innerHTML = resultPanel(state, device);
  updateConnectivity();
}
function updateConnectivity(){document.querySelector('#connectivity-panel')?.replaceWith(document.createRange().createContextualFragment(connectivityPanel(state,device)));}
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
  const sidebar=document.querySelector('#sidebar');
  sidebar.classList.remove('open');
  sidebar.inert=!desktopNavigation.matches;
  document.querySelector('.main-shell').inert=false;
  const toggle=document.querySelector('#menu-toggle'); toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','打开导航'); toggle.innerHTML=icon('menu'); document.body.style.overflow='';
}
async function navigate() {
  const hash=location.hash.slice(1)||'home',next=pages[hash]?hash:'home';
  const version=++navigationVersion,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const changing=!!main.dataset.route&&main.dataset.route!==next;
  closeDetails();closeMenu();main.inert=true;
  surfaceMotion.setPage(next,changing&&!reduce);
  route=next;render();window.scrollTo({top:0,behavior:'instant'});
  const movement=modelStage.whenSettled();
  if(route==='configure'&&!state.place.countries.length&&!state.place.countriesLoading&&!state.place.countryError)loadCountries();
  if(changing&&!reduce)await movement;
  if(version!==navigationVersion)return;
  await surfaceMotion.reveal(changing&&!reduce);if(version!==navigationVersion)return;
  main.inert=false;
  main.focus({preventScroll:true});
  if(route==='configure'&&state.revealConfiguration){
    state.revealConfiguration=false;
    document.querySelector('#configuration-result')?.scrollIntoView({block:'start',behavior:'instant'});
  }
}
window.addEventListener('hashchange',navigate);
document.querySelector('#menu-toggle').innerHTML=icon('menu');
document.querySelector('#menu-toggle').addEventListener('click',()=>{
  const sidebar=document.querySelector('#sidebar');
  const open=sidebar.classList.toggle('open'), toggle=document.querySelector('#menu-toggle');
  sidebar.inert=!open;
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
  const confirmationText=translateText(requiredText);
  openDialog(title,`<p class="dialog-description">${e(description)}</p>${device.demo?'<p class="notice warning">当前操作目标为模拟设备</p>':''}${requiredText?`<label class="dialog-field">请输入“${e(confirmationText)}”确认<input name="confirmation" required autocomplete="off"></label>`:''}`,async form=>{
    if(requiredText&&new FormData(form).get('confirmation')!==confirmationText)throw new Error('确认文字不一致');
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
  <label class="dialog-field">设备密钥凭据（已供应密钥的设备需导入）<input type="file" name="credentialFile" accept=".json,application/json"></label>
  ${ble.credential?`<p class="caption muted">本页已载入 ${e(ble.credential.deviceId)} 的凭据；刷新页面后清除。</p>`:''}
  <p class="caption muted">SWS-BLE 1.0 · JSON 分包传输；页面不支持远程唤醒设备</p>${device.state==='ready'?button('断开当前连接','disconnect',{type:'outline',extra:'type="button"'}):''}`,async form=>{
    const data=new FormData(form),file=data.get('credentialFile');
    if(file?.size){if(file.size>4096)throw new Error('设备凭据文件超过 4 KB');state.settings.ble.credential=validateCredential(JSON.parse(await file.text()));}
    for(const key of ['serviceUuid','writeUuid','notifyUuid'])state.settings.ble[key]=data.get(key);
    dialog.close(); resetDeviceView(); await device.connect(state.settings.ble); toast('设备连接与握手成功');render();
  },'选择并连接设备');
}
function resetDeviceView(){if(state.scene.deviceObservation){state.scene.deviceObservation=null;state.dirty=!!state.result;}state.historyOpen=false;state.historyPage=0;state.eventsOpen=false;state.eventsPage=0;state.eventsLoading=false;state.deviceError='';state.writeResult=device.pendingWrite?'unknown':null;pollFailures=0;}

function readScene(form) {
  const data=Object.fromEntries(new FormData(form));
    for(const key of ['potLiters','reservoirLiters','flowRateMlSec','siteTemperatureC','siteHumidityPct']){
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
    const nextConfig=device.state==='ready'&&device.handshake?.maxConfigVersion==='2.0'
      &&['minimum-interval','target-bound-config'].every(value=>device.handshake.capabilities?.includes(value));
    if(nextConfig){payload.configVersion='2.0';payload.targetDeviceId=device.status.deviceId;}
    if([payload.siteTemperatureC,payload.siteHumidityPct,payload.siteObservedLocal].some(value=>value!==null&&value!=='')){
      const measured=new Date(payload.siteObservedLocal);
      if(payload.siteTemperatureC===null||payload.siteHumidityPct===null||!Number.isFinite(measured.getTime())){
        state.formError='现场判断需要同时填写温度、空气湿度和测量时间';state.generating=false;render();return;
      }
      payload.onsiteObservation={temperatureC:payload.siteTemperatureC,humidityPct:payload.siteHumidityPct,observedAt:measured.toISOString()};
    }
    const generationTargetDeviceId=device.state==='ready'?device.status.deviceId:null;
    generationAbort=new AbortController();render();
    try {
      const generated=await api('/api/configurations/generate',{method:'POST',body:payload,signal:generationAbort.signal});
      state.result=generated;state.resultTargetDeviceId=generationTargetDeviceId;
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
    state.result=importedConfigResult(config);state.resultTargetDeviceId=null;
    state.dirty=false;state.writeResult=null;device.stage=null;toast('配置已在浏览器校验并导入');render();
  }catch(error){toast(error.message,true);}
  finally{const node=document.querySelector('#config-file');if(node)node.value='';}
}

const actions={
  'go-device':()=>{location.hash='device';},
  connect:connectionDialog,
  'close-dialog':()=>dialog.close(),
  demo:async()=>{if(!state.settings.demoEnabled)throw new Error('模拟设备未启用');resetDeviceView();await device.connect({},true);toast('模拟设备已连接，所有读数均为演示数据');render();},
  disconnect:()=>{device.disconnect();resetDeviceView();dialog.close();render();toast('设备已断开');},
  refresh:async()=>{await device.refresh();state.deviceError='';pollFailures=0;render();toast('已读取最新设备状态');},
  'sync-time':async()=>{await device.syncTime();render();toast('设备已确认校时，最短间隔继续按经过时间计算');},
  'quick-check':async()=>{
    const sensorKey=document.querySelector('#stimulated-sensor')?.value||'';
    await device.quickCheck(sensorKey);render();
    toast(sensorKey?'三轮检查已开始，请立即改变所选传感器的实际输入':'设备已开始三轮传感器检查，请随后刷新查看结果');
  },
  'stop-watering':async()=>{await device.stop();render();toast('设备已确认停泵并回到展示模式');},
  'manual-servo':async()=>{await device.manualServo();toast('舵机已开始一次扫动');},
  'manual-pump':async()=>{
    const on=device.status?.manualPumpOn!==true;
    await device.manualPump(on);
    toast(on?'设备已确认开泵命令，实际出水未检测':'设备已确认关泵命令');
  },
  'use-device-observation':async()=>{await device.refresh();state.scene.deviceObservation=device.observationReport();state.dirty=!!state.result;render();toast('已选择设备准备期温湿度作为本次生成输入');},
  'clear-device-observation':()=>{state.scene.deviceObservation=null;state.dirty=!!state.result;render();},
  environment:loadEnvironment,
  'choose-country':element=>selectCountry(element.dataset.code),
  'reload-locations':loadCountries,
  import:()=>document.querySelector('#config-file').click(),
  export:async()=>{if(!state.result)throw new Error('请先生成或导入配置');await exportConfig(state.result.config);toast('配置文件已导出');},
  upload:()=>{
    if(state.dirty)throw new Error('场景已修改，请重新生成配置');
    if(device.pendingWrite)throw new Error('上次写入结果待核对，请先连接原设备并读回配置');
    if(state.resultTargetDeviceId && state.resultTargetDeviceId!==device.status?.deviceId)throw new Error('配置生成时连接的是另一台设备，请重新生成后发送');
    const config=structuredClone(state.result?.config);if(!config)throw new Error('请先生成配置');
    if(config.configVersion==='2.0'&&config.targetDeviceId!==device.status?.deviceId)throw new Error('配置绑定的目标设备与当前连接不一致');
    confirmAction('发送配置到设备',`将 ${config.plant} 的 R${config.revision} 配置发送到 ${device.status?.deviceId}；设备会校验版本和参数，并在本地保存`,async()=>{
      state.writeResult=null;
      try{const result=await device.upload(config);state.writeResult='saved';toast(result.statusRefreshFailed?'配置已保存；状态刷新失败，请重新连接核对':'设备已确认配置写入成功');}
      catch(error){state.writeResult=device.stage;throw error;}
      finally{render();}
    });
  },
  'verify-write':async()=>{
    const result=await device.verifyPendingWrite();state.writeResult=device.stage;render();
    toast(result==='saved'?'读回确认：设备已保存该配置':result==='not-saved'?'读回确认：设备未保存该版本，可重新发送':'设备配置已变化，请重新生成并核对后发送',result!=='saved');
  },
  'device-download':async()=>{
    const config=await device.download();state.result=importedConfigResult(config);state.resultTargetDeviceId=device.status.deviceId;state.dirty=false;state.writeResult=null;
    if(route==='configure'){render();document.querySelector('#configuration-result')?.scrollIntoView({block:'start',behavior:'instant'});}
    else {state.revealConfiguration=true;location.hash='configure';}
    toast(`设备配置 R${config.revision} 已读回，可核对参数或导出`);
  },
  mode:async()=>{
    const mode=document.querySelector('#target-mode').value;
    await device.operate('mode',mode);render();toast('设备已确认模式切换');
  },
  restart:async()=>{await device.operate('restart');toast('设备已确认重启');},
  'factory-reset':async()=>{await device.operate('factoryReset');toast('设备已确认恢复出厂');},
  history:async()=>{
    state.historyLoading=true;render();
    try{await device.readHistory();state.historyOpen=true;state.historyPage=0;toast(`已读取 ${device.history.length} 条近期记录`);}
    finally{state.historyLoading=false;render();}
  },
  'history-prev':()=>{state.historyPage=Math.max(0,state.historyPage-1);render();},
  'history-next':()=>{state.historyPage=Math.min(Math.ceil(device.history.length/12)-1,state.historyPage+1);render();},
  events:async()=>{
    state.eventsLoading=true;render();
    try{await device.readEvents();state.eventsOpen=true;state.eventsPage=0;toast(`已读取 ${device.events.length} 条设备事件`);}
    finally{state.eventsLoading=false;render();}
  },
  'events-prev':()=>{state.eventsPage=Math.max(0,state.eventsPage-1);render();},
  'events-next':()=>{state.eventsPage=Math.min(Math.ceil(device.events.length/8)-1,state.eventsPage+1);render();},
  retry:()=>initialize(),
};

async function runAction(element){
  const action=actions[element.dataset.action];if(!action||element.disabled)return;
  try{await action(element);}catch(error){toast(error.message,true);if(route==='device'){state.deviceError=error.message;render();}}
}
initDeviceHold(runAction);
document.addEventListener('click',event=>{
  const element=event.target.closest('[data-action]');if(!element||element.disabled)return;
  event.preventDefault();
  void runAction(element);
});

const polling=setInterval(async()=>{
  if(route!=='device'||document.visibilityState!=='visible'||device.state!=='ready'||device.busy||device.stopping||device.refreshing||dialog.open)return;
  const generation=device.generation;
  try{await device.refresh({background:true});if(generation===device.generation){pollFailures=0;const hadError=!!state.deviceError;state.deviceError='';if(hadError&&route==='device')render();}}
  catch(error){if(generation!==device.generation||device.state!=='ready'||device.stopping)return;state.deviceError=error.message;pollFailures++;if(pollFailures>=3)device.disconnect('连续读取失败，请唤醒设备并重新连接');render();}
},10000);
const backendPolling=setInterval(async()=>{
  if(document.visibilityState!=='visible'||!state.ready)return;
  try{await api('/api/settings',{timeoutMs:5000});state.backendReachable=true;}
  catch{state.backendReachable=false;}
  state.backendCheckedAt=Date.now();if(route==='configure')updateConnectivity();
},30000);
window.addEventListener('resize',()=>{draw();if(window.innerWidth>=768)closeMenu();});
window.addEventListener('pagehide',()=>{
  device.credential=null;if(state.settings.ble)state.settings.ble.credential=null;
  generationAbort?.abort();environmentAbort?.abort();locationAbort?.abort();countryAbort?.abort();clearInterval(polling);clearInterval(backendPolling);device.disconnect();device.simulator=null;
    state.scene={};state.result=null;state.environment=null;state.selectedLocation=null;state.locationCandidates=[];state.place={countries:[]};
  document.querySelectorAll('input,textarea').forEach(node=>{node.value='';});
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

async function initialize() {
  try{
    const [settings,plants]=await Promise.all(['/api/settings','/api/plants'].map(path=>api(path)));
    Object.assign(state,{settings,plants,ready:true,backendReachable:true,backendCheckedAt:Date.now()});navigate();
  }catch(error){main.innerHTML=`<section class="empty-state"><h1>工作区暂时无法加载</h1><p>${e(error.message)}</p>${button('重新加载','retry',{type:'primary'})}</section>`;}
}
initialize();
if ('serviceWorker' in navigator && globalThis.isSecureContext) {
  navigator.serviceWorker.register('/offline-sw.js', { scope: '/' }).catch(() => {});
}
