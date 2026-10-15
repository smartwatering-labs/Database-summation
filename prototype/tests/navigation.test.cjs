const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/navigation');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.TEST_URL||'http://127.0.0.1:5000';
  const aligned=async()=>{
   await page.waitForFunction(()=>{const a=document.querySelector('.nav-link[aria-current="page"]').getBoundingClientRect(),b=document.querySelector('.nav-hover-indicator').getBoundingClientRect();return ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.1);});
   assert.equal(await page.locator('.nav-link[aria-current=page]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)','only the moving indicator paints a desktop selection');
  };
  for(const theme of ['minimal','classic']){
   await page.goto(base+'/?theme='+theme+'#home');await page.waitForFunction(()=>!!document.querySelector('.nav-link[aria-current="page"]'));await aligned();
   const frames=await page.evaluate(()=>new Promise(resolve=>{
    const result=[],start=performance.now();location.hash='device';
    function sample(time){const selected=document.querySelector('.nav-link[aria-current]'),indicator=document.querySelector('.nav-hover-indicator'),a=selected.getBoundingClientRect(),b=indicator.getBoundingClientRect();result.push({route:selected.hash,y:b.y,height:b.height,targetHeight:a.height,background:getComputedStyle(selected).backgroundColor});if(time-start<500)requestAnimationFrame(sample);else resolve(result);}requestAnimationFrame(sample);
   }));
   assert.ok(frames.some(f=>f.route==='#device'));frames.forEach(f=>{assert.ok(Math.abs(f.height-f.targetHeight)<.1,'indicator never stretches during the move');assert.equal(f.background,'rgba(0, 0, 0, 0)');});
   await aligned();
   const y=await page.locator('.nav-hover-indicator').evaluate(n=>n.getBoundingClientRect().y);
   await page.locator('.nav-link[href="#home"]').hover();await page.waitForTimeout(80);assert.equal(await page.locator('.nav-hover-indicator').evaluate(n=>n.getBoundingClientRect().y),y,'hover does not move selection');
   await page.evaluate(async()=>{for(const r of ['product','home','configure','device','product']){location.hash=r;await new Promise(resolve=>setTimeout(resolve,35));}});
   await page.locator('.nav-link[href="#product"][aria-current=page]').waitFor();await aligned();
   await page.locator('#navigation').screenshot({path:path.join(out,theme+'-selection.png')});
   await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click();
   assert.equal(await page.locator('.nav-hover-indicator').isVisible(),false);
   await page.locator('.nav-link[href="#configure"]').click();await page.waitForFunction(()=>document.body.dataset.page==='configure');
   await page.setViewportSize({width:1440,height:1000});await aligned();
   await page.locator('.nav-link').evaluateAll(nodes=>nodes.forEach(n=>n.style.fontSize='17px'));await aligned();
   await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await page.waitForTimeout(700);await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await page.waitForTimeout(700);await aligned();
   await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>location.hash='device');await page.locator('.nav-link[href="#device"][aria-current=page]').waitFor();await aligned();await page.emulateMedia({reducedMotion:'no-preference'});
   fs.writeFileSync(path.join(out,theme+'-frames.json'),JSON.stringify(frames,null,2));
  }
  assert.deepEqual(errors,[]);console.log('PASS: one selection background, constant-height intermediate frames, exact alignment, interrupted routes, mobile-to-desktop, resized labels, collapsed sidebar, saved palette URLs, reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
