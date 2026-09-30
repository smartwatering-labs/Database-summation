const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/hero');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning')console.log(m.text());});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5000');
  await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true',null,{timeout:30000});
  const settled=async route=>{
   await page.waitForFunction(r=>document.body.dataset.page===r&&document.querySelector('#model-stage').dataset.route===r&&document.querySelector('#model-stage').dataset.moving==='false'&&!document.querySelector('#main').inert,route);
   await page.waitForTimeout(450);
  };
  const go=async route=>{await page.evaluate(r=>location.hash=r,route);await settled(route);};
  await settled('home');await page.evaluate(()=>window.originalCanvas=document.querySelector('#model-canvas'));
  for(const route of ['home','product','configure','device']){await go(route);await page.screenshot({path:path.join(out,route+'.png'),fullPage:true});}
  await go('home');await page.getByRole('button',{name:'硬件组成',exact:true}).click();await page.waitForTimeout(600);
  assert.match(await page.locator('#detail-body').innerText(),/ESP32-C3/);await page.screenshot({path:path.join(out,'details.png')});await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});
  for(const from of ['home','product','configure','device'])for(const to of ['home','product','configure','device'].filter(r=>r!==from)){
   await go(from);await go(to);assert.ok(await page.evaluate(()=>window.originalCanvas===document.querySelector('#model-canvas')));
   assert.ok(Math.abs(Number(await page.locator('#model-stage').getAttribute('data-open'))-(to==='configure'?1:0))<.002);
  }
  await page.evaluate(async()=>{for(const route of ['home','configure','product','configure','device']){location.hash=route;await new Promise(r=>setTimeout(r,70));}});await settled('device');
  await page.getByRole('button',{name:'收起侧边栏'}).click();await page.waitForTimeout(750);
  assert.ok(await page.locator('#sidebar').evaluate(n=>n.inert));assert.ok((await page.locator('.main-shell').boundingBox()).x<2);
  await page.screenshot({path:path.join(out,'sidebar-collapsed.png')});await page.getByRole('button',{name:'展开侧边栏'}).click();await page.waitForTimeout(750);
  await page.getByRole('button',{name:'体验模拟设备',exact:true}).click();await page.locator('.sensor-grid').waitFor();
  await page.getByRole('button',{name:'读取最近一周',exact:true}).click();await page.locator('.history-summary').waitFor();
  assert.equal(await page.locator('tbody tr').count(),12);
  await page.getByRole('button',{name:'下一页',exact:true}).click();assert.match(await page.locator('.pagination').innerText(),/第 2/);
  const panel=page.locator('.panel-scroll');const before=await panel.evaluate(n=>n.scrollTop);assert.ok(before>0,'panel maintains position after history rerender');
  await panel.evaluate(n=>n.scrollTop=0);await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'device-connected.png')});
  await go('configure');await page.getByLabel('供水装置',{exact:true}).selectOption('valve');await page.getByLabel('用户水泵流量',{exact:true}).fill('13');
  await page.locator('.panel-scroll').evaluate(n=>n.scrollTop=0);await page.getByRole('button',{name:'查看结构说明'}).click();await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});assert.equal(await page.getByLabel('用户水泵流量',{exact:true}).inputValue(),'13');
  for(const width of [390,768,1024]){
   await page.setViewportSize({width,height:844});
   for(const route of ['home','product','configure','device']){
    await go(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${route} no overflow`);
    if(width===390)await page.screenshot({path:path.join(out,route+'-mobile.png'),fullPage:true});
   }
  }
  await page.setViewportSize({width:390,height:650});await go('home');
  const anchored=await page.locator('#model-stage').evaluate(n=>n.getBoundingClientRect().top+scrollY);
  for(const y of [90,9999,0,60,0]){await page.evaluate(y=>window.scrollTo(0,y),y);await page.waitForTimeout(30);const now=await page.locator('#model-stage').evaluate(n=>n.getBoundingClientRect().top+scrollY);assert.ok(Math.abs(now-anchored)<1,'canvas stays attached to document at scroll boundaries');}
  await page.emulateMedia({reducedMotion:'reduce'});await go('configure');assert.equal(Number(await page.locator('#model-stage').getAttribute('data-open')),1);
  const fallback=await browser.newPage({viewport:{width:1440,height:1000}});
  await fallback.route('**/assets/models/model.json',r=>r.abort());
  await fallback.goto(process.env.TEST_URL||'http://127.0.0.1:5000');
  await fallback.locator('#model-stage.model-failed').waitFor();
  assert.ok(await fallback.locator('.model-fallback').isVisible());
  await fallback.getByRole('button',{name:'连接模拟设备',exact:true}).click();
  await fallback.evaluate(()=>location.hash='device');
  await fallback.locator('.sensor-grid').waitFor();
  await fallback.waitForFunction(()=>!document.querySelector('#main').inert);
  await fallback.close();
  assert.deepEqual(errors,[]);console.log('PASS: hero scenes, 12 transitions, interrupts, glass panels, dialogs, rail collapse, scroll attachment, business state, responsive, reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
