const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.TEST_URL||'http://127.0.0.1:5000';
const out=path.resolve('test-results/poster/loading');fs.mkdirSync(out,{recursive:true});
const idle=page=>page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true'&&document.querySelector('#model-stage').dataset.moving==='false'&&!document.querySelector('#main').inert);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  for(const route of ['home','product']){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),requests=[],errors=[];
   page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
   let release;const gate=new Promise(resolve=>release=resolve);
   await page.route('**/watering-box-9-30ver.glb',async r=>{await gate;await r.continue();});
   await page.goto(`${base}/#${route}`);
   await page.locator('.model-state-loading').waitFor({state:'visible'});
   await page.waitForTimeout(1200);
   assert.equal(await page.locator('.model-fallback, img[src*="controller.png"]').count(),0);
   assert.equal(await page.locator('h1').count(),1);
   await page.screenshot({path:path.join(out,`${route}-loading.png`)});
   release();await idle(page);assert.ok(await page.locator('.model-state').isHidden());
   await page.reload();await idle(page);
   assert.ok(requests.every(url=>!url.includes('/assets/controller.png')),'old hero image is never requested, including reload');
   for(const [width,height] of [[320,740],[390,844],[768,900],[1024,768],[1440,768],[1920,1080]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(800);await idle(page);
    const result=await page.evaluate(()=>{
     const copy=document.querySelector('.hero-copy').getBoundingClientRect(),region=document.querySelector('.hero-visual-region').getBoundingClientRect(),stage=document.querySelector('#model-stage').getBoundingClientRect();
     const title=document.querySelector('h1'),style=getComputedStyle(title);
     return{overflow:document.documentElement.scrollWidth>innerWidth,lines:title.getBoundingClientRect().height/parseFloat(style.lineHeight),clear:innerWidth>=960?copy.right<region.left:copy.bottom<region.top,contained:stage.bottom>=region.bottom-1};
    });
    assert.equal(result.overflow,false,`${width} ${route}: no horizontal overflow`);
    assert.ok(result.lines<=2.1,`${width} ${route}: headline stays on two lines`);
    assert.ok(result.clear&&result.contained,`${width} ${route}: model has its own fully contained display region`);
    if(width===1440)await page.screenshot({path:path.join(out,`${route}-short-desktop.png`),fullPage:true});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  for(const mode of ['asset-failure','webgl-unavailable']){
   const page=await browser.newPage({viewport:{width:390,height:844}});
   if(mode==='asset-failure')await page.route('**/assets/models/model.json',r=>r.abort());
   else await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});
   await page.goto(base);await page.locator('.model-state-error').waitFor({state:'visible'});
   assert.ok(await page.locator('.model-state-loading').isHidden());
   await page.getByRole('button',{name:'数据处理',exact:true}).click();
   await page.locator('#detail-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
   await page.locator('#detail-dialog').waitFor({state:'hidden'});
   await page.evaluate(()=>location.hash='product');await page.locator('#main .model-state-error').waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.querySelector('#main').inert);
   await page.screenshot({path:path.join(out,`${mode}.png`),fullPage:true});await page.close();
  }
  console.log('PASS: cold load and reload without legacy image requests, loading/error states, WebGL fallback, two-line headings, six viewport sizes, short desktop containment, usable details without 3D');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
