const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/refinements');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],timings=[];page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.TEST_URL||'http://127.0.0.1:5000';await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true');
  const settled=async route=>page.waitForFunction(r=>document.body.dataset.page===r&&!document.querySelector('#main').inert&&document.querySelector('#model-stage').dataset.moving==='false',route);
  const go=async route=>{const time=Date.now();await page.evaluate(r=>location.hash=r,route);await settled(route);timings.push({route,ms:Date.now()-time});};
  const orientation=()=>page.locator('#model-stage').getAttribute('data-orientation');
  const waitPanel=async value=>page.waitForFunction(v=>document.querySelector('#main').dataset.panelOpen===v&&document.querySelector('#main').dataset.surfaceMoving==='false',value);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'minimal');
  assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).color),'rgb(29, 29, 31)');
  for(const width of [1440,1600,1920,1024,768,390,320]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(700);
   const status=await page.locator('#connection-status').boundingBox();assert.ok(status.x+status.width<=width-12,`status fully inside viewport ${width}`);
   assert.equal(await page.locator('#connection-status').evaluate(n=>n.scrollWidth>n.clientWidth),false);
  }
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,'home-minimal.png')});
  for(const route of ['product','configure','device','home','device','configure'])await go(route);
  assert.ok(timings.every(t=>t.ms<1300),JSON.stringify(timings));
  await page.screenshot({path:path.join(out,'configure-minimal.png')});
  assert.equal(await page.locator('.model-caption').count(),0);
  const front=await orientation();await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await waitPanel('0.0000');
  const box=await page.locator('#model-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.55,{steps:12});await page.mouse.up();await page.waitForTimeout(50);
  const rotated=await orientation();assert.notEqual(rotated,front,'mouse drag rotates actual scene');
  await page.screenshot({path:path.join(out,'rotated-model.png')});
  await page.getByRole('button',{name:'返回配置面板',exact:true}).click();
  await page.waitForTimeout(100);const intermediate=await orientation();assert.notEqual(intermediate,rotated);assert.notEqual(intermediate,front,'return interpolates');
  await waitPanel('1.0000');await settled('configure');assert.equal(await orientation(),front,'returns to page pose');
  assert.equal(await page.locator('#model-stage').getAttribute('data-interactive'),'false');
  await page.goto(base+'/?theme=classic#configure');await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true');await settled('configure');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'minimal','old bookmarks use the single current palette');
  assert.equal(new URL(page.url()).searchParams.has('theme'),false);
  assert.equal(await page.getByLabel('网站配色',{exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await page.locator('#sidebar').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  assert.equal(await page.locator('.sidebar .desktop-brand').isVisible(),false);
  const links=await page.locator('#navigation a').all();let bottom=0;
  for(const link of links){const b=await link.boundingBox();assert.ok(b.y>=bottom&&b.x>=0&&b.x+b.width<=390);bottom=b.y+b.height;}
  await page.screenshot({path:path.join(out,'mobile-menu.png')});
  await page.locator('#navigation a[href="#device"]').click();await settled('device');assert.equal(await page.locator('.sidebar.open').count(),0);assert.equal(await page.locator('.main-shell').evaluate(n=>n.inert),false);
  await page.screenshot({path:path.join(out,'mobile-device.png')});
  await page.evaluate(async()=>{for(const r of ['home','configure','product','device']){location.hash=r;await new Promise(resolve=>setTimeout(resolve,55));}});await settled('device');
  const touchPage=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await touchPage.goto(base+'/#configure');
  await touchPage.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true'&&!document.querySelector('#main').inert);
  await touchPage.getByRole('button',{name:'查看 3D 模型',exact:true}).tap();await touchPage.waitForFunction(()=>document.querySelector('#main').dataset.surfaceMoving==='false');
  const q=await touchPage.locator('#model-stage').getAttribute('data-orientation'),cdp=await touchPage.context().newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:130,y:420}]});
  for(let x=150;x<=270;x+=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:460}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touchPage.waitForTimeout(60);
  assert.notEqual(await touchPage.locator('#model-stage').getAttribute('data-orientation'),q,'touch drag rotates');
  await touchPage.getByRole('button',{name:'返回配置面板',exact:true}).tap();await touchPage.waitForFunction(()=>document.querySelector('#main').dataset.panelOpen==='1.0000'&&document.querySelector('#main').dataset.surfaceMoving==='false'&&document.querySelector('#model-stage').dataset.moving==='false');
  assert.equal(await touchPage.locator('#model-stage').getAttribute('data-orientation'),q);await touchPage.close();
  fs.writeFileSync(path.join(out,'timings.json'),JSON.stringify(timings,null,2));assert.deepEqual(errors,[]);
  console.log('PASS: bounded route transitions, status placement, mobile menu, mouse/touch rotation + smooth return, removed caption, retired palette bookmarks',timings);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
