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
  // Sample rendered CSS on every browser frame, not just the animation's end state.
  const frames=await page.evaluate(()=>new Promise(resolve=>{
   const samples=[],began=performance.now();location.hash='configure';
   function sample(t){const main=document.querySelector('#main'),stage=document.querySelector('#model-stage');
    if(document.body.dataset.page==='configure')samples.push({opacity:Number(getComputedStyle(main).opacity),blur:parseFloat(getComputedStyle(stage).filter.match(/blur\(([^p]+)/)?.[1]||'0'),panel:Number(main.dataset.panelOpen)});
    if(t-began<10000&&(document.body.dataset.page!=='configure'||main.inert))requestAnimationFrame(sample);else resolve(samples);
   }requestAnimationFrame(sample);
  }));
  fs.writeFileSync(path.join(out,'reveal-frames.json'),JSON.stringify(frames,null,2));
  assert.ok(frames.some(f=>f.opacity>.05&&f.opacity<.95),'observed reveal intermediate frames');
  frames.forEach(f=>assert.ok(Math.abs(f.blur-8*f.opacity*f.panel)<.025,'panel reveal and defocus share progress'));
  await go('configure');
  const panel=page.locator('.workspace-panel'),shell=page.locator('.main-shell');
  assert.ok((await panel.boundingBox()).width/(await shell.boundingBox()).width>.9,'wide panel');
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backdropFilter),'none');
  const form=await page.locator('#scenario-form').boundingBox(),result=await page.locator('#configuration-result').boundingBox();assert.ok(result.x>form.x+form.width,'form and preview side by side');
  await page.screenshot({path:path.join(out,'configure-wide.png')});
  await page.getByLabel('供水装置',{exact:true}).selectOption('valve');await page.getByLabel('用户水泵流量',{exact:true}).fill('17');
  const scrollBefore=await page.locator('.panel-scroll').evaluate(n=>n.scrollTop);
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='0.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  assert.ok(await panel.evaluate(n=>n.inert));
  const blur=await page.locator('#model-stage').evaluate(n=>{
   const filter=getComputedStyle(n).filter;
   return filter==='none'?0:parseFloat(filter.match(/blur\(([^p]+)/)?.[1]??'NaN');
  });
  assert.equal(blur,0,'preview has no background defocus');
  await page.screenshot({path:path.join(out,'configure-model.png')});
  await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='1.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  assert.equal(await page.getByLabel('用户水泵流量',{exact:true}).inputValue(),'17');assert.equal(await page.locator('.panel-scroll').evaluate(n=>n.scrollTop),scrollBefore);
  await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await page.waitForTimeout(70);await page.getByRole('button',{name:'返回配置面板',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='1.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  await page.getByRole('button',{name:'查看结构说明',exact:true}).click();await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});
  await go('device');await page.getByRole('button',{name:'体验模拟设备',exact:true}).click();await page.locator('.sensor-grid').waitFor();await page.waitForTimeout(500);
  assert.ok((await page.locator('.device-controls').boundingBox()).x>(await page.locator('.device-readings').boundingBox()).x);
  await page.screenshot({path:path.join(out,'device-wide.png')});
  await page.locator('.panel-toggle').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='0.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false');
  assert.ok(await page.locator('.workspace-panel').evaluate(n=>n.inert));assert.ok(await page.locator('.panel-toggle').evaluate(n=>n===document.activeElement));
  await go('configure');assert.equal(await page.locator('#main').getAttribute('data-panel-open'),'1.0000');
  for(const width of [390,768,1024]){await page.setViewportSize({width,height:844});for(const route of ['configure','device']){await go(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width===390){assert.ok((await page.locator('.main-shell').boundingBox()).x<1,'mobile shell is not offset by desktop rail');await page.screenshot({path:path.join(out,route+'-mobile.png')});}}}
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();assert.equal(await page.locator('#main').getAttribute('data-panel-open'),'0.0000');
  assert.deepEqual(errors,[]);console.log('PASS: synchronized rendered blur/opacity, wide workspaces, docking/interruption, preserved inputs/scroll, real variable font interpolation, keyboard, responsive, reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

