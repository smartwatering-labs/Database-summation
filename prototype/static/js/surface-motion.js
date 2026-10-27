// Content reveal and panel docking share one clock. The stationary model is
// defocused only below an open workspace panel.
import { modelStage } from './model-stage.js';
import { localize } from './i18n.js';
const main=document.querySelector('#main'),stage=document.querySelector('#model-stage');
const defocus=document.createElement('div'),stillCanvas=document.createElement('canvas');
defocus.id='model-defocus';defocus.setAttribute('aria-hidden','true');
stillCanvas.setAttribute('aria-hidden','true');defocus.append(stillCanvas);stage.append(defocus);
const stillContext=stillCanvas.getContext('2d',{alpha:true});
function alignStill(){
 const source=stage.getBoundingClientRect(),underlay=defocus.getBoundingClientRect();
 Object.assign(stillCanvas.style,{
  width:source.width+'px',height:source.height+'px',
  left:(source.left-underlay.left)+'px',top:(source.top-underlay.top)+'px'
 });
}
function installStill(bitmap){
 stillCanvas.width=bitmap.width;stillCanvas.height=bitmap.height;
 // Rasterize the blur once while the model is settled. Opacity animation
 // then composites an ordinary bitmap instead of filtering a large canvas.
 if('filter' in stillContext){
  const scale=bitmap.width/Math.max(1,stage.getBoundingClientRect().width);
  stillContext.filter='blur('+(8*scale).toFixed(2)+'px)';
  stillCanvas.style.filter='none';
 }else stillCanvas.style.filter='blur(8px)';
 stillContext.drawImage(bitmap,0,0);
 stillContext.filter='none';
 bitmap.close();
 alignStill();
}
new ResizeObserver(()=>{if(defocus.style.visibility==='visible')alignStill();}).observe(stage);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let value={reveal:1,panel:1},workspace=false,page='home',panelTarget=1,exitSnapshot;
let frame=0,finish,pendingTarget,defocusVersion=0,stillReady=false;
function hideStill(){
 stillReady=false;
 defocus.style.opacity='0';
 defocus.style.visibility='hidden';
}
function syncStill(){
 const opacity=stillReady&&workspace?value.reveal*value.panel:0;
 defocus.style.opacity=String(opacity);
 defocus.style.visibility=opacity>0?'visible':'hidden';
}
async function prepareStill(version,fadeOnReady=false){
 await modelStage.whenSettled();
 if(version!==defocusVersion||!workspace||!panelTarget||document.hidden)return false;
 const still=await modelStage.captureStill();
 if(!still)return false;
 if(version!==defocusVersion||!workspace||!panelTarget||document.hidden||stage.dataset.moving!=='false'){still.close();return false;}
 installStill(still);
 stillReady=true;
 syncStill();
 if(fadeOnReady&&value.reveal===1&&value.panel===1&&!reduced.matches)
  defocus.animate([{opacity:0},{opacity:1}],{duration:150,easing:'cubic-bezier(.33,1,.68,1)'});
 return true;
}
async function warmStill(){
 if(!stillReady||reduced.matches||document.hidden)return;
 // Let the browser prepare the bitmap layer before the visible motion.
 defocus.style.visibility='visible';
 defocus.style.opacity='.001';
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
function paint(){
 main.style.opacity=value.reveal;
 main.style.setProperty('--panel-open',value.panel);
 main.dataset.reveal=value.reveal.toFixed(4);
 main.dataset.panelOpen=value.panel.toFixed(4);
 syncStill();
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
  localize(toggle);
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
 snapshot.animate([{opacity:value.reveal,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],{duration:120,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'}).finished.then(clean,clean);
}
export const surfaceMotion={
 hide(){return animate({reveal:0},70);},
 setPage(next,animated=false){
  if(animated)captureExit();else{exitSnapshot?.remove();exitSnapshot=null;}
  cancel();++defocusVersion;hideStill();
  page=next;workspace=['configure','device'].includes(next);panelTarget=1;value.panel=1;
  value.reveal=animated?0:1;main.classList.remove('model-view');paint();
 },
 async reveal(animated=true){
  const version=defocusVersion;
  // The still is ready before content appears. Blur and reveal then use
  // the same cubic progress, rather than two sequential transitions.
  if(workspace&&animated){
   await prepareStill(version);
   if(version===defocusVersion)await warmStill();
  }
  if(version!==defocusVersion)return false;
  const motion=animate({reveal:1},animated?150:0);
  if(workspace&&!animated)void prepareStill(version,true);
  return motion;
 },
 bind,
 toggle(){
  const version=++defocusVersion;
  if(panelTarget){
   panelTarget=0;modelStage.setInteractive(true);bind();
   const motion=animate({panel:0},440);
   void motion.then(()=>{if(version===defocusVersion)hideStill();});
   return motion;
  }
  panelTarget=1;bind();
  return (async()=>{
   // Capture the sharp preview once before its return pose. The panel
   // and its blurred underlay then move on one clock; live WebGL stays clear.
   await prepareStill(version);
   if(version===defocusVersion)await warmStill();
   if(version!==defocusVersion||!panelTarget)return false;
   modelStage.setInteractive(false);
   return animate({panel:1},440);
  })();
 }
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
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){++defocusVersion;hideStill();}
 else if(workspace&&panelTarget)void prepareStill(++defocusVersion);
});
addEventListener('pagehide',()=>{cancel();},{once:true});
