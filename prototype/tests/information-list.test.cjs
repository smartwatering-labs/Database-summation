const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/information-list');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const idle=r=>page.waitForFunction(r=>document.querySelector('#model-stage').dataset.ready==='true'&&document.querySelector('#model-stage').dataset.route===r&&document.querySelector('#model-stage').dataset.moving==='false'&&document.querySelector('#main').dataset.route===r&&!document.querySelector('#main').inert&&document.querySelector('#main').dataset.surfaceMoving==='false',r);
  const go=async r=>{await page.evaluate(r=>location.hash=r,r);await idle(r);};
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5000');await idle('home');
  for(const route of ['home','product']){
   await go(route);assert.equal(await page.locator('#main ol.hero-index>li').count(),route==='home'?3:4);assert.equal(await page.locator('#main .hero-hotspots').count(),0);
   const entries=await page.locator('#main .detail-row').all();
   for(const entry of entries){
    const label=await entry.getAttribute('aria-label');await entry.click();await page.locator('#detail-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#detail-title').innerText(),label);assert.ok((await page.locator('#detail-body').innerText()).length>100);
    if(route==='product'&&label==='工作原理'){
     assert.match(await page.locator('#detail-body').innerText(),/AO3400A/);assert.match(await page.locator('#detail-body').innerText(),/电池电量.*没有独立/);
     await page.locator('.board-comparison img').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.board-comparison img')].every(img=>img.complete&&img.naturalWidth>0));
     await page.screenshot({path:path.join(out,'hardware-details.png')});
    }
    assert.doesNotMatch(await page.locator('#detail-body').innerText(),/继电器/);
    await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});assert.ok(await entry.evaluate(n=>document.activeElement===n),'closing details restores row focus');
   }
  }
  await go('product');assert.deepEqual(await page.locator('.detail-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('aria-label'))),['硬件结构','工作原理','情况需知','使用流程']);await page.getByRole('button',{name:'情况需知',exact:true}).click();assert.match(await page.locator('#detail-body').innerText(),/DISPLAY[\s\S]*PREPARE[\s\S]*LONGRUN/);await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});
  for(const [width,height] of [[320,740],[390,844],[768,900],[1024,768],[1440,1000],[1920,1080]]){
   await page.setViewportSize({width,height});
   for(const route of ['home','product']){
    await go(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${route}: no horizontal overflow`);
    assert.ok(await page.locator('.detail-row').evaluateAll(rows=>rows.every(n=>{const b=n.getBoundingClientRect();return b.width>200&&b.height>=60;})),`${width} ${route}: generous row targets`);
    await page.screenshot({path:path.join(out,`${width}-${route}.png`),fullPage:true});
   }
  }
  await page.setViewportSize({width:390,height:844});await go('home');await page.getByRole('button',{name:'报错处理',exact:true}).click();await page.locator('#detail-body a[href="#configure"]').click();await idle('configure');assert.equal(await page.locator('#detail-dialog').getAttribute('open'),null);
  await page.emulateMedia({reducedMotion:'reduce'});await go('product');assert.equal(await page.locator('.page-exit-snapshot').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: unified lists, all seven details, latest dual-board content/assets, mode guide, keyboard/focus, responsive layouts, links and reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
