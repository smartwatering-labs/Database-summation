import { icon } from './ui.js';
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),dialog=document.querySelector('#detail-dialog');
const details=new Map();let returnFocus,oldOverflow='',closing=false,closeVersion=0;
function disclosure(parent,nodes,title,label,id){
 const content=document.createElement('div');nodes.filter(Boolean).forEach(n=>content.append(n));details.set(id,{title,html:content.innerHTML});
 const button=document.createElement('button');button.type='button';button.className='button disclosure-button';button.dataset.detail=id;
 button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','detail-dialog');button.innerHTML=`<span>${label}</span>${icon('arrow',17)}`;parent.append(button);return button;
}
function openDetails(id,trigger){
 const detail=details.get(id);if(!detail)return;returnFocus=trigger;closing=false;closeVersion++;dialog.classList.remove('is-closing');
 document.querySelector('#detail-title').textContent=detail.title;const body=document.querySelector('#detail-body');body.innerHTML=detail.html;
 oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
 if(!reduced.matches)Array.from(body.children).forEach((node,i)=>node.animate([{opacity:0,transform:'translateY(14px)',filter:'blur(5px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:480,delay:Math.min(i*55,180),fill:'backwards',easing:'cubic-bezier(.22,1,.36,1)'}));
}
export function closeDetails(){closeVersion++;if(dialog.open)dialog.close();}
dialog.addEventListener('close',()=>{document.body.style.overflow=oldOverflow;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});closing=false;dialog.classList.remove('is-closing');});
function animatedClose(){if(closing)return;closing=true;if(reduced.matches){closeDetails();return;}const version=++closeVersion;dialog.classList.add('is-closing');dialog.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(10px)'}],{duration:160,easing:'ease-out'}).finished.then(()=>{if(version===closeVersion)closeDetails();}).catch(()=>{});}
dialog.addEventListener('cancel',e=>{e.preventDefault();animatedClose();});
dialog.addEventListener('click',e=>{const b=dialog.getBoundingClientRect();if(e.target.closest('[data-detail-close]')||(e.target===dialog&&(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)))animatedClose();});
document.addEventListener('click',e=>{const trigger=e.target.closest('[data-detail]');if(trigger)openDetails(trigger.dataset.detail,trigger);});

export function enhancePage(main,route){
 details.clear();
 if(route==='configure'||route==='device'){
  if(route==='device'){
   const controls=main.querySelector('.device-controls'),history=main.querySelector('.history-section');
   if(controls&&history){
    const readings=document.createElement('section');readings.className='device-readings';readings.setAttribute('aria-label','当前采样与趋势');
    while(controls.nextElementSibling&&controls.nextElementSibling!==history)readings.append(controls.nextElementSibling);
    const dashboard=document.createElement('div');dashboard.className='device-dashboard';history.before(dashboard);dashboard.append(readings,controls);
   }
  }
  const panel=document.createElement('section');panel.className='workspace-panel';panel.id='workspace-panel';panel.setAttribute('aria-label',route==='configure'?'个性化配置面板':'硬件状态面板');
  const scroll=document.createElement('div');scroll.className='panel-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',route==='configure'?'配置内容，可滚动':'设备内容，可滚动');
  while(main.firstChild)scroll.append(main.firstChild);panel.append(scroll);main.append(panel);
  const note=document.createElement('p');note.textContent=route==='configure'?'外壳已展开，内部芯片位置暂留空；后续随正式模型补充':'外壳已合拢，设备数据以蓝牙握手后读取的实际状态为准';
  const tools=document.createElement('div');tools.className='workspace-tools';
  const label=document.createElement('span');label.className='workspace-label';label.textContent=route==='configure'?'场景设定 → 配置预览':'设备状态 · 数据与操作';
  const info=document.createElement('div');info.className='workspace-caption';disclosure(info,[note],route==='configure'?'内部结构':'硬件模型','查看结构说明','structure');
  const toggle=document.createElement('button');toggle.type='button';toggle.className='button outline panel-toggle';toggle.dataset.panelToggle='';toggle.setAttribute('aria-controls','workspace-panel');toggle.setAttribute('aria-expanded','true');toggle.innerHTML=`${icon('device',16)}<span>查看 3D 模型</span>${icon('arrow',16)}`;
  tools.append(label,info,toggle);const hint=document.createElement('p');hint.className='model-view-hint';hint.textContent='拖动旋转模型 · 展开面板后自动归位';main.append(tools,hint);return;
 }
 const hero=document.createElement('section');hero.className='hero-page';hero.setAttribute('aria-label',route==='home'?'浇水系统展示':'产品介绍与使用说明');
 const buttons=document.createElement('div');buttons.className='hero-hotspots';
 const footer=document.createElement('div');footer.className='hero-footer';
 if(route==='home'){
  const heading=main.querySelector('.home-heading');heading.classList.add('hero-copy');
  const copy=main.querySelector('.hardware-copy');
  disclosure(buttons,[copy],'感知环境，按需浇灌','硬件组成','hardware');
  disclosure(buttons,[main.querySelector('.home-notices')],'蓝牙兼容与设备唤醒','连接须知','connection');
  disclosure(buttons,[main.querySelector('.quick-section')],'你的工作区','进入工作区','workspace');
  const demo=main.querySelector('.demo-entry');
  if(demo){const button=demo.querySelector('button');button.classList.add('hero-demo');footer.append(button);}
  const note=document.createElement('span');note.textContent='连接前，请先按外置按钮唤醒设备';footer.prepend(note);hero.append(heading);
 }else{
  const heading=main.querySelector('.page-heading');heading.classList.add('hero-product-heading');
  const intro=main.querySelector('.product-intro>div');
  const copy=document.createElement('div');copy.className='hero-copy product-copy';copy.append(intro.querySelector('h2'));
  disclosure(buttons,Array.from(intro.querySelectorAll('p')),'产品用途与工作原理','工作原理','principle');
  disclosure(buttons,[main.querySelector('.workflow')],'从环境感知到节水执行','运行流程','workflow');
  disclosure(buttons,[main.querySelector('.mode-explanations')],'三种运行模式','运行模式','modes');
  disclosure(buttons,[main.querySelector('.guide-rows'),main.querySelector('.notice.warning')],'首次使用与实物校准','首次使用','guide');
  const actions=main.querySelector('.actions.content-section');actions.classList.remove('content-section');copy.append(actions);
  const note=document.createElement('span');note.textContent='感知环境 · 按需浇灌';footer.append(note);hero.append(heading,copy);
 }
 hero.append(buttons,footer);main.replaceChildren(hero);
}

const rail=document.querySelector('#sidebar'),toggle=document.querySelector('#sidebar-toggle');
toggle.addEventListener('click',()=>{
 const collapsed=document.body.classList.toggle('sidebar-collapsed');
 toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展开侧边栏':'收起侧边栏');
 rail.inert=collapsed;rail.setAttribute('aria-hidden',String(collapsed));
});
const narrow=matchMedia('(max-width:767px)');
narrow.addEventListener('change',()=>{document.body.classList.remove('sidebar-collapsed');rail.inert=false;rail.removeAttribute('aria-hidden');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','收起侧边栏');});
