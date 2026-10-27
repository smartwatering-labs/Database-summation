import { icon } from './ui.js';
import { localize } from './i18n.js';
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),dialog=document.querySelector('#detail-dialog');
const details=new Map();let returnFocus,oldOverflow='',closing=false,closeVersion=0;
const motions=[];
function cancelMotions(){while(motions.length)motions.pop().cancel();}
function animateOpen(){
 if(reduced.matches||typeof dialog.animate!=='function')return;
 const play=(node,frames,options)=>{
  const animation=node.animate(frames,{...options,fill:'both'});motions.push(animation);
  animation.finished.then(()=>{const index=motions.indexOf(animation);if(index>=0){motions.splice(index,1);animation.cancel();}}).catch(()=>{});
 };
 play(dialog,[{opacity:0,transform:'translate3d(0,20px,0) scale(.976)'},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],{duration:420,easing:'cubic-bezier(.16,1,.3,1)'});
 for(const [selector,delay] of [['.detail-heading',45],['#detail-title',70],['#detail-body',95]]){
  const node=dialog.querySelector(selector);
  if(node)play(node,[{opacity:0,transform:'translate3d(0,9px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:340,delay,easing:'cubic-bezier(.16,1,.3,1)'});
 }
}
function disclosure(parent,nodes,title,label,id){
 const content=document.createElement('div');nodes.filter(Boolean).forEach(n=>content.append(n));details.set(id,{title,html:content.innerHTML});
 const button=document.createElement('button');button.type='button';button.className='button disclosure-button';button.dataset.detail=id;
 button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','detail-dialog');button.innerHTML=`<span>${label}</span>${icon('arrow',17)}`;parent.append(button);return button;
}
function informationIndex(sections,label){
 const panel=document.createElement('section');panel.className='hero-index-panel';panel.setAttribute('aria-label',label);
 const list=document.createElement('ol');list.className='hero-index';
 sections.forEach(section=>{
  const {detailSection:id,label:title,summary}=section.dataset;details.set(id,{title,html:section.innerHTML});
  const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='detail-row';button.dataset.detail=id;
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','detail-dialog');button.setAttribute('aria-label',title);
  button.innerHTML=`<span class="index-copy"><strong>${title}</strong><span>${summary}</span></span>${icon('arrow',17)}`;
  item.append(button);list.append(item);
 });
 panel.append(list);return panel;
}
function openDetails(id,trigger){
 const detail=details.get(id);if(!detail)return;returnFocus=trigger;closing=false;closeVersion++;cancelMotions();dialog.classList.remove('is-closing');
 document.querySelector('#detail-title').textContent=detail.title;const body=document.querySelector('#detail-body');body.innerHTML=detail.html;
 localize(dialog);
 if(!dialog.open){oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();}
 animateOpen();
}
export function closeDetails(){closeVersion++;cancelMotions();if(dialog.open)dialog.close();}
dialog.addEventListener('close',()=>{cancelMotions();document.body.style.overflow=oldOverflow;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});closing=false;dialog.classList.remove('is-closing');});
function animatedClose(){
 if(closing||!dialog.open)return;
 closing=true;
 if(reduced.matches||typeof dialog.animate!=='function'){closeDetails();return;}
 const opacity=getComputedStyle(dialog).opacity,transform=getComputedStyle(dialog).transform;
 cancelMotions();
 const version=++closeVersion;dialog.classList.add('is-closing');
 const animation=dialog.animate([{opacity,transform},{opacity:0,transform:'translate3d(0,10px,0) scale(.985)'}],{duration:190,easing:'cubic-bezier(.7,0,.84,0)',fill:'forwards'});
 motions.push(animation);
 animation.finished.then(()=>{if(version===closeVersion)closeDetails();}).catch(()=>{});
}
reduced.addEventListener('change',()=>{if(reduced.matches){cancelMotions();if(closing)closeDetails();}});
addEventListener('pagehide',closeDetails);
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
  const note=document.createElement('p');note.textContent=route==='configure'?'顶盖已移除，正上方查看主板和实际元器件。':'外壳已移除，侧向查看两层主板；设备数据以蓝牙握手后读取的实际状态为准';
  const tools=document.createElement('div');tools.className='workspace-tools';
  const label=document.createElement('span');label.className='workspace-label';label.textContent=route==='configure'?'场景设定 → 配置预览':'设备状态 · 数据与操作';
  const info=document.createElement('div');info.className='workspace-caption';disclosure(info,[note],route==='configure'?'内部结构':'硬件模型','查看结构说明','structure');
  const toggle=document.createElement('button');toggle.type='button';toggle.className='button outline panel-toggle';toggle.dataset.panelToggle='';toggle.setAttribute('aria-controls','workspace-panel');toggle.setAttribute('aria-expanded','true');toggle.innerHTML=`${icon('device',16)}<span>查看 3D 模型</span>${icon('arrow',16)}`;
  tools.append(label,info,toggle);const hint=document.createElement('p');hint.className='model-view-hint';hint.textContent=matchMedia('(pointer:coarse)').matches?'单指旋转 · 双指缩放 · 双击归位':'拖动旋转 · 滚轮缩放 · 双击归位';main.append(tools,hint);return;
 }
 const hero=document.createElement('section');hero.className=`hero-page ${route==='home'?'home-hero':'product-hero'}`;hero.setAttribute('aria-label',route==='home'?'浇水系统展示':'产品介绍与使用说明');
 const index=informationIndex(Array.from(main.querySelectorAll('[data-detail-section]')),route==='home'?'从这里开始':'了解产品');
 const visual=document.createElement('figure');visual.className='hero-visual-region';
 visual.setAttribute('aria-label',route==='home'?'浇水设备完整外观':'顶盖、上层主板、下层主板与底壳的分解视图');
 visual.innerHTML=`<div class="model-state" role="status"><span class="model-state-loading">正在呈现设备模型</span><span class="model-state-error">暂时无法显示模型，刷新页面可重试。</span></div>`;
 if(route==='home'){
  const heading=main.querySelector('.home-heading');heading.classList.add('hero-copy');
  const stack=document.createElement('aside');stack.className='hero-side-stack';stack.setAttribute('aria-label','开始使用');
  const demo=main.querySelector('.demo-entry');
  stack.append(index);
  if(demo){const button=demo.querySelector('button');button.classList.add('hero-demo');stack.append(button);}
  const content=document.createElement('div');content.className='hero-content';content.append(heading,stack);hero.append(content,visual);
 }else{
  const intro=main.querySelector('.product-copy-source');
  const copy=document.createElement('div');copy.className='hero-copy product-copy';copy.append(...intro.childNodes);
  const actions=main.querySelector('.actions.content-section');actions.classList.remove('content-section');copy.append(actions);
  const stack=document.createElement('aside');stack.className='hero-side-stack';stack.setAttribute('aria-label','了解产品');stack.append(index);
  const content=document.createElement('div');content.className='hero-content';content.append(copy,stack);hero.append(content,visual);
 }
 main.replaceChildren(hero);
}

const rail=document.querySelector('#sidebar'),toggle=document.querySelector('#sidebar-toggle');
toggle.addEventListener('click',()=>{
 const collapsed=document.body.classList.toggle('sidebar-collapsed');
 toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展开侧边栏':'收起侧边栏');
 rail.inert=collapsed;rail.setAttribute('aria-hidden',String(collapsed));
});
const narrow=matchMedia('(max-width:767px)');
narrow.addEventListener('change',()=>{document.body.classList.remove('sidebar-collapsed');rail.inert=narrow.matches&&!rail.classList.contains('open');rail.removeAttribute('aria-hidden');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','收起侧边栏');});
