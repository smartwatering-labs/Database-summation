const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.TEST_URL||'http://127.0.0.1:5000')+'/#configure');
  await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true'&&document.querySelector('#model-stage').dataset.route==='configure'&&!document.querySelector('#main').inert&&document.querySelector('#main').dataset.surfaceMoving==='false');
  const settled=()=>page.waitForFunction(()=>document.querySelector('#model-stage').dataset.moving==='false');
  const orientation=()=>page.locator('#model-stage').getAttribute('data-orientation');
  await settled();const home=await orientation();
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.surfaceMoving==='false');
  const canvas=page.locator('#model-canvas'),box=await canvas.boundingBox(),x=box.x+box.width*.45,y=box.y+box.height*.45;
  const drag=async(dx,dy,back=false)=>{
   const before=await orientation();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:10});
   if(back)await page.mouse.move(x,y,{steps:10});
   await page.mouse.up();await settled();
   return { before, after: await orientation() };
  };
  const reset=async()=>{await canvas.focus();await page.keyboard.press('Home');await settled();};
  const same=(a,b)=>Math.abs(a.split(',').map(Number).reduce((sum,n,i)=>sum+n*Number(b.split(',')[i]),0))>1-1e-10;
  const frontMovement=async result=>page.evaluate(async({before,after})=>{
   const {Quaternion,Vector3}=await import('/static/vendor/three/build/three.module.js');
   const start=new Quaternion().fromArray(before.split(',').map(Number)),end=new Quaternion().fromArray(after.split(',').map(Number));
   // Track the surface facing the camera, rather than assuming quaternion signs
   // describe the direction a user sees on screen.
   const front=new Vector3(0,0,1).applyQuaternion(start.invert()).applyQuaternion(end);
   return {x:front.x,y:front.y};
  },result);
  assert.ok((await frontMovement(await drag(100,0))).x>.15,'right drag moves the camera-facing surface right');
  await reset();assert.ok((await frontMovement(await drag(0,100))).y<-.15,'down drag moves the camera-facing surface down, including from the exact top view');
  await reset();
  // A turntable keeps independent yaw/tilt values. Changing gesture order must
  // reach the same orientation, including after yaw crosses 90 and 180 degrees.
  await drag(100,6);await drag(6,90);const xy=await orientation();
  await reset();await drag(6,90);await drag(100,6);
  assert.ok(same(xy,await orientation()),'horizontal and vertical drags use independent fixed axes');
  await reset();await drag(390,0);const yawOnly=await orientation();
  await drag(0,110);await drag(0,-110);
  assert.ok(same(yawOnly,await orientation()),'tilt out and back preserves yaw beyond 90 degrees');
  await drag(390,0);const rotated=await orientation();
  const reverse=await drag(-110,4);await drag(110,4);
  assert.ok(same(rotated,await orientation()),'reverse yaw returns after more than half a turn');
  assert.ok(!same(reverse.before,reverse.after));
  const returnPath=await drag(140,60,true);assert.ok(same(returnPath.before,returnPath.after),'retracing a gesture returns exactly');
  await reset();await drag(120,0);await drag(0,80);const twoAxes=await orientation();
  await reset();await drag(120,80);
  assert.ok(same(twoAxes,await orientation()),'diagonal drag composes the same fixed axes without free roll');
  await drag(0,1200);const clamped=await orientation();await drag(0,300);
  assert.ok(same(clamped,await orientation()),'pitch stops at the inspection range limit');
  const stopped=await orientation();await page.waitForTimeout(300);assert.equal(await orientation(),stopped,'release settles without long coasting');
  await canvas.focus();await page.keyboard.press('Home');await settled();assert.equal(await orientation(),home);
  await page.keyboard.press('ArrowRight');await settled();assert.notEqual(await orientation(),home);
  await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await settled();assert.equal(await orientation(),home,'panel restore still returns to the saved pose');
  await page.evaluate(()=>location.hash='device');await page.waitForFunction(()=>document.querySelector('#main').dataset.route==='device'&&!document.querySelector('#main').inert);
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.surfaceMoving==='false');
  const gentle=await drag(2,1),start=gentle.before.split(',').map(Number),end=gentle.after.split(',').map(Number);
  const angle=2*Math.acos(Math.min(1,Math.abs(start.reduce((sum,n,i)=>sum+n*end[i],0))));
  assert.ok(angle<.03,'first small gesture continues from the default view without an orientation jump');
  await reset();
  assert.ok((await frontMovement(await drag(100,0))).x>.15,'hardware page also follows rightward pointer movement');
  await reset();assert.ok((await frontMovement(await drag(0,100))).y<-.15,'hardware page also follows downward pointer movement');
  assert.deepEqual(errors,[]);console.log('PASS: fixed-axis turntable, order-independent yaw/tilt, yaw beyond 180 degrees, pitch limit, reverse/retraced drag, no coasting, keyboard and panel restore');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
