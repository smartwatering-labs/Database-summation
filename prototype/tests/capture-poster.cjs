const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const out = path.resolve('test-results/poster', process.env.CAPTURE_PHASE || 'after');
 fs.mkdirSync(out, {recursive:true});
 const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--enable-unsafe-swiftshader']});
 try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  for (const [width,height] of [[1440,1000],[390,844],[1920,1080],[768,900]]) {
   await page.setViewportSize({width,height});
   for (const route of ['home','product']) {
    await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5000'}/#${route}`);
    if(process.env.CAPTURE_LANG==='en'&&await page.locator('html').getAttribute('lang')!=='en'){await page.locator('#language-toggle').click();await page.waitForFunction(()=>document.documentElement.lang==='en'&&!document.documentElement.dataset.languageChanging);}
    await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true' && document.querySelector('#model-stage').dataset.moving==='false' && !document.querySelector('#main').inert, null, {timeout:60000});
    await page.locator('.main-shell').evaluate(async node=>{await Promise.all(node.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await page.waitForTimeout(500);
    // Viewport captures preserve the actual responsive breakpoint and canvas.
    await page.screenshot({path:path.join(out,`${width}-${route}.png`)});
    console.log(width,route, await page.locator('.hero-visual-region').boundingBox());
   }
  }
  console.log(JSON.stringify({errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
