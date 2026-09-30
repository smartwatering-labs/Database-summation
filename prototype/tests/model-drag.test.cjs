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
   return page.evaluate(async({before})=>{
    const {Quaternion}=await import('/static/vendor/three/build/three.module.js');
    const start=new Quaternion().fromArray(before.split(',').map(Number)),end=new Quaternion().fromArray(document.querySelector('#model-stage').dataset.orientation.split(',').map(Number));
    return end.multiply(start.invert()).toArray();
   },{before});
  };
  // Relative screen-space axes stay consistent even after many changed orientations.
  for(let i=0;i<3;i++){
   const horizontal=await drag(110,6);assert.ok(horizontal[1]>.1,`right drag turns right: ${horizontal}`);assert.ok(Math.abs(horizontal[0])<.0001&&Math.abs(horizontal[2])<.0001,'horizontal jitter does not pitch or roll');
   const vertical=await drag(6,90);assert.ok(vertical[0]>.1,'down drag tilts down');assert.ok(Math.abs(vertical[1])<.0001&&Math.abs(vertical[2])<.0001,'vertical jitter does not yaw or roll');
  }
  const reverse=await drag(-110,4);assert.ok(reverse[1]<-.1,'left drag reverses the screen direction');
  const returnPath=await drag(140,60,true);assert.ok(Math.abs(returnPath[3])>.999999,'retracing a gesture returns exactly without accumulated roll');
  const diagonal=await drag(90,90);assert.ok(diagonal[0]>.1&&diagonal[1]>.1,'diagonal drag remains available');
  const stopped=await orientation();await page.waitForTimeout(300);assert.equal(await orientation(),stopped,'release settles without long coasting');
  await canvas.focus();await page.keyboard.press('Home');await settled();assert.equal(await orientation(),home);
  await page.keyboard.press('ArrowRight');await settled();assert.notEqual(await orientation(),home);
  await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await settled();assert.equal(await orientation(),home,'panel restore still returns to the saved pose');
  assert.deepEqual(errors,[]);console.log('PASS: consistent screen axes after repeated rotations, hand-jitter rejection, reverse/diagonal/retraced drags, short settling, keyboard and panel restore');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
