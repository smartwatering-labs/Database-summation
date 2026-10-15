// VariableProximity: spatial falloff from React Bits, plus time smoothing.
// Actual local variable font axes; no synthetic stroke or discrete font switch.
const radius=100,fromWeight=400,toWeight=900;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const letters=[...document.querySelectorAll('.variable-proximity-line')].flatMap(line=>{
 const text=line.textContent;
 line.replaceChildren(...[...text].map(character=>{const span=document.createElement('span');span.className='variable-proximity-letter';span.textContent=character;return span;}));
 return [...line.children].map(node=>({node,value:0,target:0}));
});
let pointer={x:-Infinity,y:-Infinity},frame=0,last=0;
function targets(){
 for(const item of letters){
  const rect=item.node.getBoundingClientRect(),distance=Math.hypot(pointer.x-rect.left-rect.width/2,pointer.y-rect.top-rect.height/2);
  item.target=reduced.matches||!rect.width?0:Math.max(0,1-distance/radius);
 }
 wake();
}
function tick(time){
 frame=0;const dt=last?Math.min((time-last)/1000,.05):1/60;last=time;let pending=false;
 const blend=reduced.matches?1:1-Math.exp(-dt/0.13);
 for(const item of letters){
  item.value+=(item.target-item.value)*blend;
  if(Math.abs(item.value-item.target)<.0008)item.value=item.target;else pending=true;
  const weight=fromWeight+(toWeight-fromWeight)*item.value,opsz=9+31*item.value;
  item.node.style.fontVariationSettings=`'wght' ${weight.toFixed(2)}, 'opsz' ${opsz.toFixed(2)}`;
 }
 if(pending)wake();else last=0;
}
function wake(){if(!frame&&!document.hidden)frame=requestAnimationFrame(tick);}
function reset(){pointer={x:-Infinity,y:-Infinity};targets();}
addEventListener('pointermove',e=>{if(e.pointerType!=='touch'){pointer={x:e.clientX,y:e.clientY};targets();}},{passive:true});
addEventListener('pointerout',e=>{if(!e.relatedTarget)reset();});addEventListener('blur',reset);
addEventListener('resize',targets);document.addEventListener('scroll',targets,{passive:true,capture:true});
reduced.addEventListener('change',targets);
// Fixed glyph advances prevent heavy letters pushing neighbours away from the cursor.
async function measure(){
 await document.fonts.load('400 27px "Roboto Flex Local"');
 for(const {node} of letters){if(node.getBoundingClientRect().width){node.style.width='';node.style.width=`${node.getBoundingClientRect().width}px`;}}
 targets();
}
measure().catch(()=>targets());
matchMedia('(max-width:767px)').addEventListener('change',()=>{letters.forEach(({node})=>node.style.width='');measure();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;last=0;}else reset();});
addEventListener('pagehide',()=>cancelAnimationFrame(frame),{once:true});
