const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const output=path.resolve('test-results/reactbits-motion-2026-10-20/verified');
fs.mkdirSync(output,{recursive:true});

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=process.env.TEST_URL||'http://127.0.0.1:5000';
  const ready=route=>page.waitForFunction(route=>{
   const main=document.querySelector('#main'),stage=document.querySelector('#model-stage');
   return document.body.dataset.page===route&&main.dataset.route===route&&!main.inert
    &&main.dataset.surfaceMoving==='false'&&stage.dataset.ready==='true'&&stage.dataset.moving==='false';
  },route,{timeout:30000});
  await page.goto(base+'/#home');await ready('home');
  assert.equal(await page.locator('.click-feedback-layer').count(),0,'button feedback needs no popover overlay');
  const primary=page.locator('.hero-page .actions .button.primary');
  await primary.hover();await page.waitForTimeout(240);
  assert.ok(await primary.evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m42<-.7),'pointer hover gives a quiet one-pixel lift');
  const box=await primary.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.waitForTimeout(130);
  assert.ok(await primary.evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m11<.995),'press has immediate tactile response');
  await page.mouse.up();
  await page.locator('#dialog').waitFor({state:'visible'});
  await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'desktop-home.png')});
  const transition=await page.evaluate(()=>new Promise(resolve=>{
   const start=performance.now();location.hash='product';
   function sample(){const main=document.querySelector('#main'),stage=document.querySelector('#model-stage');
    if(document.body.dataset.page==='product'&&!main.inert)resolve({elapsed:performance.now()-start,modelMoving:stage.dataset.moving});
    else requestAnimationFrame(sample);
   }requestAnimationFrame(sample);
  }));
  assert.equal(transition.modelMoving,'false','the original route handoff waits for the model pose before unlocking content');
  await ready('product');await page.screenshot({path:path.join(output,'desktop-product.png')});
  const row=page.locator('.detail-row').first();await row.hover();await page.waitForTimeout(250);
  assert.ok(await row.locator('svg').evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).m41>=3),'detail arrow confirms the whole row is actionable');
  await row.click();await page.locator('#detail-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#detail-body').evaluate(node=>node.querySelectorAll('*').length>0),true);
  assert.equal(await page.locator('#detail-body').evaluate(node=>[...node.children].some(child=>child.getAnimations().length>0)),false,'reading content does not stagger or blur');
  await page.screenshot({path:path.join(output,'desktop-detail.png')});
  await page.keyboard.press('Escape');await page.locator('#detail-dialog').waitFor({state:'hidden'});
  assert.ok(await row.evaluate(node=>document.activeElement===node),'detail close restores the trigger focus');
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/#home');await ready('home');
  const sidebar=page.locator('#sidebar'),menu=page.locator('#menu-toggle');
  assert.equal(await sidebar.evaluate(node=>node.inert),true,'closed mobile menu cannot receive focus');
  await menu.click();await sidebar.waitFor({state:'visible'});
  assert.equal(await sidebar.evaluate(node=>node.inert),false);
  assert.equal(await page.locator('.main-shell').evaluate(node=>node.inert),true);
  await page.screenshot({path:path.join(output,'mobile-menu.png')});
  await page.keyboard.press('Escape');await sidebar.waitFor({state:'hidden'});
  assert.equal(await sidebar.evaluate(node=>node.inert),true);
  assert.equal(await page.locator('.main-shell').evaluate(node=>node.inert),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/#home');await ready('home');
  await page.locator('.hero-page .actions .button.primary').hover();
  assert.equal(await page.locator('.hero-page .actions .button.primary').evaluate(node=>getComputedStyle(node).transform),'none','reduced-motion hover has no spatial movement');
  assert.deepEqual(errors,[],'no page errors');
  console.log('PASS: responsive button, row, dialog and mobile-menu feedback; original route timing; reduced motion; no overlay or page errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
