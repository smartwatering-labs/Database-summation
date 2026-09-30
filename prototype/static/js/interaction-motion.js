// Soft surface feedback and restrained content reveals for the frosted interface.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
// Keep feedback in viewport coordinates, outside surfaces that move or blur.
// A manual popover also puts it above native modal dialogs and their backdrops.
const feedbackLayer=document.createElement('div');
feedbackLayer.className='click-feedback-layer';feedbackLayer.setAttribute('aria-hidden','true');
const topLayer=typeof feedbackLayer.showPopover==='function';
if(topLayer)feedbackLayer.setAttribute('popover','manual');
document.body.append(feedbackLayer);
let feedbackFrame=0;
function raiseFeedback(){
 if(feedbackFrame)return;
 feedbackFrame=requestAnimationFrame(()=>{
  feedbackFrame=0;
  if(!feedbackLayer.childElementCount||!topLayer)return;
  // Run after click handlers have opened dialogs; newest top-layer entry wins.
  if(feedbackLayer.matches(':popover-open'))feedbackLayer.hidePopover();
  feedbackLayer.showPopover();
 });
}
const dialogObserver=new MutationObserver(()=>{if(feedbackLayer.childElementCount)raiseFeedback();});
document.querySelectorAll('dialog').forEach(dialog=>dialogObserver.observe(dialog,{attributes:true,attributeFilter:['open']}));
document.addEventListener('click',event=>{
 const button=event.target.closest('.button,.sidebar-toggle');
 if(!button||button.disabled||button.closest('[inert]')||reduced.matches)return;
 const rect=button.getBoundingClientRect();
 const feedback=document.createElement('span');feedback.className='click-feedback';
 Object.assign(feedback.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,borderRadius:getComputedStyle(button).borderRadius});
 feedback.classList.toggle('primary-feedback',button.classList.contains('primary'));
 const surface=document.createElement('i');feedback.append(surface);feedbackLayer.append(feedback);raiseFeedback();
 const animations=[surface.animate([
  {opacity:0,transform:'scale(.985)'},
  {opacity:.65,transform:'scale(1)',offset:.18},
  {opacity:0,transform:'scale(1.045)'}
 ],{duration:280,easing:'ease-out',fill:'forwards'}).finished];
 button.animate([{scale:'.985'},{scale:'1'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
 Promise.allSettled(animations).then(()=>{
  feedback.remove();
  if(!feedbackLayer.childElementCount&&topLayer&&feedbackLayer.matches(':popover-open'))feedbackLayer.hidePopover();
 });
},true);

let priorRoute='',priorResult='',priorStatus='';
document.addEventListener('workspace:render',event=>{
 const main=document.querySelector('#main'),result=main.querySelector('.result-metrics'),status=main.querySelector('.write-status');
 const resultText=result?.textContent||'',statusText=status?.textContent||'',samePage=priorRoute===event.detail.route;
 if(samePage&&!main.inert&&!reduced.matches){
  for(const node of [resultText&&resultText!==priorResult?result:null,statusText&&statusText!==priorStatus?status:null].filter(Boolean))
   node.animate([{opacity:0,transform:'translateY(8px)',filter:'blur(3px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
 }
 priorRoute=event.detail.route;priorResult=resultText;priorStatus=statusText;
});
