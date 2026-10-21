const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/workspace-motion');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5000');
  await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true');
  await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>document.fonts.check('400 27px "Roboto Flex Local"')));
  const advances=await page.evaluate(()=>{
   const span=document.createElement('span');span.textContent='Smart Watering';span.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font:40px "Roboto Flex Local";font-synthesis:none';document.body.append(span);
   const widths=[400,650,900].map(w=>{span.style.fontVariationSettings=`"wght" ${w}, "opsz" 9`;return span.getBoundingClientRect().width;});span.remove();return widths;
  });
  assert.ok(advances[0]<advances[1]&&advances[1]<advances[2],`real intermediate glyph outlines, not just CSS values: ${advances}`);
  const letter=page.locator('.desktop-brand .variable-proximity-letter').first();
  const weight=()=>letter.evaluate(n=>Number(getComputedStyle(n).fontVariationSettings.match(/"wght"\s+([\d.]+)/)[1]));
  await page.mouse.move(900,800);await page.waitForTimeout(700);assert.equal(await weight(),400);
  await page.locator('.desktop-brand').screenshot({path:path.join(out,'logo-rest.png')});
  const box=await letter.boundingBox(),color=await page.locator('.desktop-brand').evaluate(n=>getComputedStyle(n).color);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  const start=await weight();await page.waitForTimeout(85);const middle=await weight();await page.waitForTimeout(650);const end=await weight();
  assert.ok(start<end-100&&middle>start&&middle<end-15,`smooth variable axis ${start},${middle},${end}`);
  assert.equal(await page.locator('.desktop-brand').evaluate(n=>getComputedStyle(n).color),color,'logo stays monochrome');
  await page.locator('.desktop-brand').screenshot({path:path.join(out,'logo-proximity.png')});
  await page.mouse.move(900,800);await page.waitForTimeout(85);assert.ok(await weight()>400,'leave also interpolates');
  const go=async route=>{await page.evaluate(r=>location.hash=r,route);await page.waitForFunction(r=>document.body.dataset.page===r&&!document.querySelector('#main').inert&&document.querySelector('#main').dataset.surfaceMoving==='false',route);};
  const posterBlur=await page.evaluate(()=>new Promise(resolve=>{
   const layer=document.querySelector('#model-defocus'),samples=[],start=performance.now();
   location.hash='product';
   function sample(t){samples.push(Number(getComputedStyle(layer).opacity));if(t-start<650)requestAnimationFrame(sample);else resolve(samples);}
   requestAnimationFrame(sample);
  }));
  assert.ok(posterBlur.every(value=>value===0),'the model stays sharp throughout poster route changes');
  await go('product');assert.equal(await page.locator('#model-defocus').evaluate(n=>getComputedStyle(n).opacity),'0','poster settles sharp');
  await go('home');
  // Sample rendered CSS on every browser frame, not just the animation's end state.
  const frames=await page.evaluate(()=>new Promise(resolve=>{
   const samples=[],began=performance.now();location.hash='configure';
   function sample(t){const main=document.querySelector('#main'),stage=document.querySelector('#model-stage'),layer=document.querySelector('#model-defocus');
    if(document.body.dataset.page==='configure')samples.push({
     time:Math.round(t-began),opacity:Number(getComputedStyle(main).opacity),blur:8*Number(getComputedStyle(layer).opacity),
     moving:stage.dataset.moving==='true',panel:Number(main.dataset.panelOpen)
    });
    if(t-began<10000&&(document.body.dataset.page!=='configure'||main.inert||Number(getComputedStyle(layer).opacity)<.999))requestAnimationFrame(sample);else resolve(samples);
   }requestAnimationFrame(sample);
  }));
  fs.writeFileSync(path.join(out,'reveal-frames.json'),JSON.stringify(frames,null,2));
  assert.ok(frames.some(f=>f.opacity>.05&&f.opacity<.95),'observed reveal intermediate frames');
  assert.ok(frames.some(f=>f.moving),'observed the model pose transition');
  assert.ok(frames.filter(f=>f.moving).every(f=>f.blur===0),'model stays sharp on every moving frame');
  assert.ok(frames.some(f=>!f.moving&&f.blur>1&&f.blur<7),'blur fades in only after the model settles');
  const revealFrames=frames.filter(f=>f.opacity>.05&&f.opacity<.95&&!f.moving);
  assert.ok(revealFrames.length>=3&&revealFrames.every(f=>Math.abs(f.blur-8*f.opacity)<.2),'panel underlay blur shares the content reveal clock');
  assert.ok(Math.abs(frames.at(-1).blur-8)<.1,'open workspace panel settles with underlay blur');
  const underlay=await page.evaluate(()=>{
   const a=document.querySelector('#model-defocus').getBoundingClientRect(),b=document.querySelector('.workspace-panel').getBoundingClientRect();
   return {dx:Math.abs(a.left-b.left),dy:Math.abs(a.top-b.top),dw:Math.abs(a.width-b.width),dh:Math.abs(a.height-b.height)};
  });
  assert.ok(Object.values(underlay).every(v=>v<2),'blur stays within the panel bounds: '+JSON.stringify(underlay));
  const still=await page.evaluate(async()=>{
   const layer=document.querySelector('#model-defocus'),frame=layer.querySelector('canvas'),bitmap=await createImageBitmap(frame);
   const probe=document.createElement('canvas');probe.width=100;probe.height=100;
   const context=probe.getContext('2d');context.drawImage(bitmap,0,0,100,100);
   const pixels=context.getImageData(0,0,100,100).data;
   let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)visible++;
   bitmap.close();
   return {visible,filter:getComputedStyle(frame).filter,backdrop:getComputedStyle(layer).backdropFilter,liveFilter:getComputedStyle(document.querySelector('#model-canvas')).filter};
  });
  assert.ok(still.visible>100,'the blurred underlay contains actual rendered model pixels');
  assert.equal(still.filter,'none','the blur is rasterized before the opacity animation');
  assert.equal(still.backdrop,'none','no live backdrop filter runs during the fade');
  assert.equal(await page.locator('#model-defocus').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)','the live sharp model cannot show through transparent still pixels');
  assert.equal(still.liveFilter,'none','the live WebGL model stays unfiltered');
  await go('configure');
  const panel=page.locator('.workspace-panel'),shell=page.locator('.main-shell');
  assert.ok((await panel.boundingBox()).width/(await shell.boundingBox()).width>.9,'wide panel');
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backdropFilter),'none');
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(237, 239, 241, 0.92)','workbench remains translucent');
  const form=await page.locator('#scenario-form').boundingBox(),result=await page.locator('#configuration-result').boundingBox();assert.ok(result.x>form.x+form.width,'form and preview side by side');
  await page.screenshot({path:path.join(out,'configure-wide.png')});
  await page.getByLabel('供水装置',{exact:true}).selectOption('valve');await page.getByLabel('用户水泵流量',{exact:true}).fill('17');
  const scrollBefore=await page.locator('.panel-scroll').evaluate(n=>n.scrollTop);
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='0.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  assert.ok(await panel.evaluate(n=>n.inert));
  const blur=await page.locator('#model-defocus').evaluate(n=>Number(getComputedStyle(n).opacity));
  assert.equal(blur,0,'interactive preview removes the panel underlay blur');
  await page.screenshot({path:path.join(out,'configure-model.png')});
  await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='1.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#model-defocus')).opacity==='1');
  assert.equal(await page.locator('#model-defocus').evaluate(n=>getComputedStyle(n).opacity),'1','open panel restores its underlay blur after the model settles');
  assert.equal(await page.getByLabel('用户水泵流量',{exact:true}).inputValue(),'17');assert.equal(await page.locator('.panel-scroll').evaluate(n=>n.scrollTop),scrollBefore);
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await page.waitForTimeout(70);await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='1.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  await page.getByRole('button',{name:'查看结构说明',exact:true}).click();await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});
  const deviceFrames=await page.evaluate(()=>new Promise(resolve=>{
   const samples=[],began=performance.now();location.hash='device';
   function sample(t){const layer=document.querySelector('#model-defocus'),stage=document.querySelector('#model-stage');
    if(document.body.dataset.page==='device')samples.push({moving:stage.dataset.moving==='true',blur:Number(getComputedStyle(layer).opacity)});
    if(t-began<1200)requestAnimationFrame(sample);else resolve(samples);
   }requestAnimationFrame(sample);
  }));
  assert.ok(deviceFrames.some(f=>f.moving),'observed the configure-to-device model transition');
  assert.ok(deviceFrames.filter(f=>f.moving).every(f=>f.blur===0),'device transition model remains sharp while moving');
  await go('device');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#model-defocus')).opacity==='1');
  await page.getByRole('button',{name:'体验模拟设备',exact:true}).click();await page.locator('.sensor-grid').waitFor();await page.waitForTimeout(500);
  assert.ok((await page.locator('.device-controls').boundingBox()).x>(await page.locator('.device-readings').boundingBox()).x);
  await page.screenshot({path:path.join(out,'device-wide.png')});
  await page.locator('.panel-toggle').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='0.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  assert.ok(await page.locator('.workspace-panel').evaluate(n=>n.inert));assert.ok(await page.locator('.panel-toggle').evaluate(n=>n===document.activeElement));
  await go('configure');assert.equal(await page.locator('#main').getAttribute('data-panel-open'),'1.0000');
  for(const width of [390,768,1024]){await page.setViewportSize({width,height:844});for(const route of ['configure','device']){await go(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#model-defocus')).opacity==='1');
   const bounds=await page.evaluate(()=>{const a=document.querySelector('#model-defocus').getBoundingClientRect(),b=document.querySelector('.workspace-panel').getBoundingClientRect();return [Math.abs(a.left-b.left),Math.abs(a.top-b.top),Math.abs(a.width-b.width),Math.abs(a.height-b.height)];});
   assert.ok(bounds.every(v=>v<2),'responsive blur remains below the panel at '+width+'px: '+bounds.join(','));
   if(width===390){assert.ok((await page.locator('.main-shell').boundingBox()).x<1,'mobile shell is not offset by desktop rail');await page.screenshot({path:path.join(out,route+'-mobile.png')});}}}
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();assert.equal(await page.locator('#main').getAttribute('data-panel-open'),'0.0000');
  assert.equal(await page.locator('#model-defocus').evaluate(n=>getComputedStyle(n).opacity),'0','reduced motion reaches the sharp preview immediately');
  for(const route of ['configure','device']){
   const direct=await browser.newPage({viewport:{width:1440,height:1000}});
   direct.on('pageerror',e=>errors.push(e.message));
   await direct.goto((process.env.TEST_URL||'http://127.0.0.1:5000').split('#')[0]+'/#'+route);
   await direct.waitForFunction(r=>document.body.dataset.page===r&&document.querySelector('#model-stage').dataset.ready==='true'&&getComputedStyle(document.querySelector('#model-defocus')).opacity==='1',route,{timeout:30000});
   assert.equal(await direct.locator('#model-canvas').evaluate(n=>getComputedStyle(n).filter),'none','direct workspace load keeps the live canvas sharp');
   if(route==='device')await direct.screenshot({path:path.join(out,'device-direct.png')});
   await direct.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS: sharp model motion, panel-only settled underlay blur, translucent workspaces, docking/interruption, preserved inputs/scroll, keyboard, responsive, reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

