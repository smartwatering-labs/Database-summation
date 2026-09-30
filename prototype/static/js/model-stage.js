// Document-positioned canvas: scrolling never interpolates its screen position.
// Only model poses interpolate, using one interruptible scene for all routes.
const stage=document.querySelector('#model-stage'), canvas=document.querySelector('#model-canvas');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let route='home', config, THREE, renderer, scene, camera, rig, root, environment;
let ready=false, disposed=false, lost=false, frame=0, open=0, scale=1;
let x=0,y=0, width=0,height=0, parts=[],textures=[],targetQuaternion;
let resolveSettled,settledPromise=Promise.resolve(),poseTween,interactive=false,drag,manualTarget,lastFrameTime=0;
function targetFor(page){const pose=config.poses[page];return {x:pose.position?.[0]||0,y:pose.position?.[1]||0,scale:pose.scale};}
function wake(){if(ready&&!disposed&&!lost&&!document.hidden&&!frame)frame=requestAnimationFrame(tick);}
function settle(){stage.dataset.moving='false';resolveSettled?.();resolveSettled=null;}
function beginPose(duration=440){
 manualTarget=null;
 resolveSettled?.();settledPromise=new Promise(resolve=>resolveSettled=resolve);
 if(!ready||lost||document.hidden){settle();return;}
 const pose=config.poses[route],target=targetFor(route);
 targetQuaternion.setFromEuler(new THREE.Euler(...pose.rotation));
 poseTween={start:performance.now(),duration,quaternion:rig.quaternion.clone(),target:targetQuaternion.clone(),open,scale,x,y,pose,targetPosition:target};
 stage.dataset.moving='true';wake();
}
function setInteractive(enabled){
 interactive=enabled&&ready&&!lost;stage.dataset.interactive=String(interactive);stage.setAttribute('aria-hidden',String(!interactive));canvas.tabIndex=interactive?0:-1;
 if(drag){if(canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;}
 if(!enabled&&ready)beginPose();
}
function tick(time){
 frame=0;if(!ready||disposed||lost||document.hidden)return;
 const dt=Math.min(50,Math.max(0,time-lastFrameTime));lastFrameTime=time;
 if(manualTarget){
  rig.quaternion.slerp(manualTarget,reduced.matches?1:1-Math.exp(-dt/28));
  if(rig.quaternion.angleTo(manualTarget)<.0001){rig.quaternion.copy(manualTarget);manualTarget=null;}
 }
 if(poseTween){
  const a=poseTween,t=reduced.matches?1:Math.min(1,Math.max(0,(time-a.start)/a.duration)),p=1-Math.pow(1-t,3);
  rig.quaternion.slerpQuaternions(a.quaternion,a.target,p);
  open=THREE.MathUtils.lerp(a.open,a.pose.open,p);scale=THREE.MathUtils.lerp(a.scale,a.targetPosition.scale,p);x=THREE.MathUtils.lerp(a.x,a.targetPosition.x,p);y=THREE.MathUtils.lerp(a.y,a.targetPosition.y,p);
  if(t===1)poseTween=null;
 }
 for(const part of parts)part.node.position.copy(part.closed).lerp(part.open,open);
 const panel=document.querySelector('.panel-scroll');
 const range=panel?Math.max(1,panel.scrollHeight-panel.clientHeight):Math.max(1,document.documentElement.scrollHeight-innerHeight);
 const progress=reduced.matches||interactive?0:Math.min(1,Math.max(0,(panel?panel.scrollTop:scrollY)/range));
 rig.scale.setScalar(scale*(1-progress*.06));rig.position.set(innerWidth<768?x*.25:x,y,0);
 const q=rig.quaternion.clone();rig.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(progress*.045,progress*.09,0)));
 const w=Math.max(1,Math.round(stage.clientWidth)),h=Math.max(1,Math.round(stage.clientHeight));
 if(width!==w||height!==h){width=w;height=h;renderer.setSize(w,h,false);}
 const aspect=w/h,halfHeight=innerWidth<768?Math.max(2.4,2.8/aspect):Math.max(2.4+open*.4,3.45/aspect);
 camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();
 renderer.render(scene,camera);rig.quaternion.copy(q);
 stage.dataset.route=route;stage.dataset.open=open.toFixed(4);
 stage.dataset.orientation=rig.quaternion.toArray().join(',');
 if(poseTween||manualTarget)wake();else settle();
}
function planarUV(geometry){
 const p=geometry.attributes.position,n=geometry.attributes.normal,uv=new Float32Array(p.count*2);
 for(let i=0;i<p.count;i++){const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));const u=ax>ay&&ax>az?p.getY(i):p.getX(i),v=az>=ax&&az>=ay?p.getY(i):p.getZ(i);uv[i*2]=u/6;uv[i*2+1]=v/6;}
 geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
}
async function initialize(){
 try{
  const response=await fetch('/static/assets/models/model.json');if(!response.ok)throw Error('模型配置读取失败');config=await response.json();
  THREE=await import('../vendor/three/build/three.module.js');if(disposed)return;
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0xffffff,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-4,4,2.4,-2.4,.1,100);camera.position.set(0,0,15);
  const {RoomEnvironment}=await import('../vendor/three/addons/environments/RoomEnvironment.js');const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  environment=pmrem.fromScene(room,.035);scene.environment=environment.texture;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff,0x8090a8,1));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(-4,7,6);scene.add(light);
  if(config.format==='obj'){
   const [{OBJLoader},{MTLLoader}]=await Promise.all([import('../vendor/three/addons/loaders/OBJLoader.js'),import('../vendor/three/addons/loaders/MTLLoader.js')]);
   const materials=await new MTLLoader().loadAsync(config.materials);root=await new OBJLoader().setMaterials(materials).loadAsync(config.url);
  }else{const {GLTFLoader}=await import('../vendor/three/addons/loaders/GLTFLoader.js');root=(await new GLTFLoader().loadAsync(config.url)).scene;}
  const loader=new THREE.TextureLoader(),base='/static/assets/materials/metal012/Metal012_1K-JPG_';
  textures=await Promise.all(['Color','Roughness','NormalGL','Metalness'].map(name=>loader.loadAsync(base+name+'.jpg')));
  textures.forEach(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(6,18);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});textures[0].colorSpace=THREE.SRGBColorSpace;
  if(disposed){release();return;}
  root.traverse(node=>{
   if(!node.isMesh)return;planarUV(node.geometry);const old=Array.isArray(node.material)?node.material:[node.material];
   const replacement=old.map(m=>{const dark=m.color.getHex()<0x444444;return new THREE.MeshPhysicalMaterial({color:dark?0x202b3d:0xe2e9f3,map:dark?null:textures[0],roughnessMap:textures[1],normalMap:textures[2],normalScale:new THREE.Vector2(.045,.045),metalnessMap:textures[3],metalness:dark?.55:.94,roughness:dark?.66:.42,anisotropy:.4,envMapIntensity:1.5,clearcoat:.16,clearcoatRoughness:.32,side:THREE.DoubleSide});});
   node.material=Array.isArray(node.material)?replacement:replacement[0];old.forEach(m=>m.dispose());
  });
  parts=(config.parts||[]).map(p=>{const node=root.getObjectByName(p.name);if(!node)throw Error('缺少模型部件：'+p.name);const closed=new THREE.Vector3(...p.closed);node.position.copy(closed);return {node,closed,open:new THREE.Vector3(...p.open)};});
  if(config.upAxis==='z')root.rotation.x=-Math.PI/2;
  const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());root.position.sub(bounds.getCenter(new THREE.Vector3()));
  const normalized=new THREE.Group();normalized.add(root);normalized.scale.setScalar(4.2/Math.max(size.x,size.y,size.z));
  rig=new THREE.Group();rig.add(normalized);scene.add(rig);targetQuaternion=new THREE.Quaternion();rig.quaternion.setFromEuler(new THREE.Euler(...config.poses[route].rotation));
  const target=targetFor(route);open=config.poses[route].open;scale=target.scale;x=target.x;y=target.y;
  ready=true;stage.dataset.ready='true';document.body.classList.add('model-ready');wake();
 }catch(error){stage.dataset.error=error.message;stage.classList.add('model-failed');document.body.classList.remove('model-ready');console.warn('3D 展示暂不可用，全部业务操作仍可使用',error);ready=false;settle();release();}
}
function release(){cancelAnimationFrame(frame);frame=0;root?.traverse(n=>{n.geometry?.dispose();(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m?.dispose());});textures.forEach(t=>t.dispose());environment?.dispose();renderer?.dispose();}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;document.body.classList.remove('model-ready');settle();});
canvas.addEventListener('webglcontextrestored',()=>{lost=false;document.body.classList.add('model-ready');wake();});
canvas.setAttribute('role','img');canvas.setAttribute('aria-label','三维模型，拖动或使用方向键旋转，Home 键归位');
canvas.addEventListener('pointerdown',e=>{
 if(!interactive||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;
 poseTween=null;manualTarget=null;settle();
 const rect=canvas.getBoundingClientRect();
 drag={id:e.pointerId,x:e.clientX,y:e.clientY,base:rig.quaternion.clone(),axis:null,sensitivity:Math.PI/Math.max(600,Math.min(rect.width,rect.height))};
 canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});
});
function rotate(dx,dy,base=manualTarget||rig.quaternion){
 if(poseTween){poseTween=null;settle();}
 const angle=Math.hypot(dx,dy);
 const axis=new THREE.Vector3(dy,dx,0).applyQuaternion(camera.quaternion).normalize();
 manualTarget=new THREE.Quaternion().setFromAxisAngle(axis,angle).multiply(base).normalize();
 stage.dataset.moving='true';wake();
}
canvas.addEventListener('pointermove',e=>{
 if(!interactive||!drag||drag.id!==e.pointerId)return;
 let dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 if(!drag.axis){
  if(Math.hypot(dx,dy)<5)return;
  // Infer intent once per gesture, so a slightly uneven horizontal drag cannot tilt upward.
  drag.axis=Math.abs(dx)>Math.abs(dy)*1.6?'horizontal':Math.abs(dy)>Math.abs(dx)*1.6?'vertical':'free';
 }
 // Small cross-axis motion is hand jitter; deliberate bends still rotate freely.
 if(drag.axis==='horizontal')dy=Math.sign(dy)*Math.max(0,Math.abs(dy)-24);
 if(drag.axis==='vertical')dx=Math.sign(dx)*Math.max(0,Math.abs(dx)-24);
 // Start-relative screen axes avoid accumulating event noise or diagonal Euler roll.
 rotate(dx*drag.sensitivity,dy*drag.sensitivity,drag.base);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(drag?.id===e.pointerId)drag=null;});
canvas.addEventListener('keydown',e=>{if(!interactive)return;const moves={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,-.12],ArrowDown:[0,.12]};if(moves[e.key]){e.preventDefault();rotate(...moves[e.key]);}else if(e.key==='Home'){e.preventDefault();beginPose();}});
addEventListener('scroll',wake,{passive:true});document.addEventListener('scroll',e=>{if(e.target?.classList?.contains('panel-scroll'))wake();},{passive:true,capture:true});
addEventListener('resize',wake);reduced.addEventListener('change',wake);document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;settle();}else wake();});
const observer=new ResizeObserver(wake);observer.observe(stage);
addEventListener('pagehide',()=>{disposed=true;ready=false;observer.disconnect();settle();release();},{once:true});
export const modelStage={
 update(next,publish=true){if(publish)document.body.dataset.page=next;if(next!==route){interactive=false;stage.dataset.interactive='false';stage.setAttribute('aria-hidden','true');canvas.tabIndex=-1;if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;route=next;beginPose();}else if(ready)wake();return settledPromise;},
 setInteractive,
 whenSettled(){return settledPromise;}
};
initialize();
