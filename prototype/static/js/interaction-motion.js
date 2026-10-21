// Results acknowledge a meaningful data change without animating every control.
// Button feedback lives in CSS so clicks never add a top-layer surface over dialogs.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');

let priorRoute='',priorResult='',priorStatus='';
document.addEventListener('workspace:render',event=>{
 const main=document.querySelector('#main'),result=main.querySelector('.result-metrics'),status=main.querySelector('.write-status');
 const resultText=result?.textContent||'',statusText=status?.textContent||'',samePage=priorRoute===event.detail.route;
 if(samePage&&!main.inert&&!reduced.matches){
  for(const node of [resultText&&resultText!==priorResult?result:null,statusText&&statusText!==priorStatus?status:null].filter(Boolean))
   node.animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
 }
 priorRoute=event.detail.route;priorResult=resultText;priorStatus=statusText;
});
