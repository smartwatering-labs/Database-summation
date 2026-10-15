// One clock owns content visibility, panel docking and the model's defocus.
// No backdrop-filter on the panel: nested opacity/filter layers delay it in Chromium.
import { modelStage } from './model-stage.js';
const main=document.querySelector('#main'),stage=document.querySelector('#model-stage');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let value={reveal:1,panel:1,exitBlur:0},workspace=false,page='home',panelTarget=1,exitSnapshot;
let frame=0,finish,pendingTarget;
function paint(){
 main.style.opacity=value.reveal;
 main.style.filter=value.reveal===1?'none':`blur(${(1-value.reveal)*9}px)`;
 main.style.setProperty('--panel-open',value.panel);
 const blur=Math.max(value.exitBlur,workspace?8*value.reveal*value.panel:0);
 stage.style.filter=blur<.001?'none':`blur(${blur}px)`;
 main.dataset.reveal=value.reveal.toFixed(4);
 main.dataset.panelOpen=value.panel.toFixed(4);
}
function cancel(){cancelAnimationFrame(frame);frame=0;finish?.(false);finish=null;}
function animate(target,duration){
 cancel();const start={...value},began=performance.now();pendingTarget={...value,...target};
 main.dataset.surfaceMoving='true';
 return new Promise(resolve=>{
  finish=resolve;
  const tick=time=>{
   const t=reduced.matches||document.hidden||duration===0?1:Math.min(1,Math.max(0,(time-began)/duration)),p=1-Math.pow(1-t,3);
   for(const key of Object.keys(value))value[key]=start[key]+(pendingTarget[key]-start[key])*p;
   paint();
   if(t<1)frame=requestAnimationFrame(tick);
   else{frame=0;main.dataset.surfaceMoving='false';finish=null;resolve(true);}
  };
  if(reduced.matches||!duration)tick(began+duration);else frame=requestAnimationFrame(tick);
 });
}
function bind(){
 main.classList.toggle('model-view',workspace&&!panelTarget);
 const panel=main.querySelector('.workspace-panel'),toggle=main.querySelector('[data-panel-toggle]');
 if(panel){panel.inert=!panelTarget;panel.setAttribute('aria-hidden',String(!panelTarget));}
 if(toggle){
  toggle.setAttribute('aria-expanded',String(!!panelTarget));
  toggle.querySelector('span').textContent=panelTarget?'查看 3D 模型':page==='configure'?'返回配置面板':'返回硬件面板';
  toggle.classList.toggle('panel-return',!panelTarget);
 }
 paint();
}
function captureExit(){
 exitSnapshot?.remove();
 const box=main.getBoundingClientRect(),snapshot=main.cloneNode(true);
 snapshot.removeAttribute('id');snapshot.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
 snapshot.classList.add('page-exit-snapshot');snapshot.inert=true;snapshot.setAttribute('aria-hidden','true');
 Object.assign(snapshot.style,{position:'fixed',left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`,margin:'0',pointerEvents:'none'});
 snapshot.style.setProperty('width',`${box.width}px`,'important');
 const originals=main.querySelectorAll('input,select,textarea'),copies=snapshot.querySelectorAll('input,select,textarea');
 originals.forEach((node,i)=>{copies[i].value=node.value;if('checked' in node)copies[i].checked=node.checked;});
 document.body.append(snapshot);const scroll=main.querySelector('.panel-scroll');
 if(scroll)snapshot.querySelector('.panel-scroll').scrollTop=scroll.scrollTop;
 exitSnapshot=snapshot;
 const clean=()=>{snapshot.remove();if(exitSnapshot===snapshot)exitSnapshot=null;};
 snapshot.animate([{opacity:value.reveal,filter:main.style.filter},{opacity:0,filter:'blur(6px)'}],{duration:120,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'}).finished.then(clean,clean);
}
export const surfaceMotion={
 hide(){return animate({reveal:0},70);},
 setPage(next,animated=false){
  if(animated)captureExit();else{exitSnapshot?.remove();exitSnapshot=null;}
  const previousBlur=Math.max(value.exitBlur,workspace?8*value.reveal*value.panel:0);
  cancel();page=next;workspace=['configure','device'].includes(next);panelTarget=1;value.panel=1;
  value.reveal=animated?0:1;value.exitBlur=animated?previousBlur:0;main.classList.remove('model-view');paint();
  if(animated)animate({exitBlur:0},120);
 },
 reveal(animated=true){return animate({reveal:1},animated?150:0);},
 bind,
 toggle(){panelTarget=panelTarget?0:1;modelStage.setInteractive(!panelTarget);bind();return animate({panel:panelTarget},440);}
};
let touchToggle,lastTouchToggle=0;
document.addEventListener('pointerdown',e=>{const button=e.target.closest('[data-panel-toggle]');if(button&&e.pointerType==='touch')touchToggle={button,id:e.pointerId,x:e.clientX,y:e.clientY};});
document.addEventListener('pointercancel',()=>{touchToggle=null;});
document.addEventListener('pointerup',e=>{
 if(!touchToggle||touchToggle.id!==e.pointerId)return;
 const tap=touchToggle;touchToggle=null;
 if(e.target.closest('[data-panel-toggle]')===tap.button&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<12){
  // Mobile browsers can suppress the compatibility click following a canvas drag.
  e.preventDefault();lastTouchToggle=performance.now();tap.button.click();
 }
});
document.addEventListener('click',e=>{
 if(!e.target.closest('[data-panel-toggle]')||main.inert)return;
 if(lastTouchToggle&&e.detail&&performance.now()-lastTouchToggle<700)return;
 surfaceMotion.toggle();
});
reduced.addEventListener('change',()=>{if(reduced.matches&&frame){value={...pendingTarget};cancel();paint();main.dataset.surfaceMoving='false';}});
addEventListener('pagehide',cancel,{once:true});
