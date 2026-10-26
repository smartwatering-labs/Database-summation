const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.TEST_URL||'http://127.0.0.1:5000';
const chinese=/[\u3400-\u9fff]/u;
const waitLanguage=(page,lang)=>page.waitForFunction(expected=>document.documentElement.lang===expected&&!document.documentElement.dataset.languageChanging,lang);
async function leftovers(page){return page.evaluate(()=>{
  const visible=node=>{const parent=node.parentElement;return parent&&!parent.closest('script,style,noscript,pre,code,[translate="no"],#language-toggle,.page-exit-snapshot')&&parent.getClientRects().length>0&&getComputedStyle(parent).visibility!=='hidden'};
  const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;const found=[];
  while(node=walk.nextNode())if(visible(node)&&/[\u3400-\u9fff]/u.test(node.nodeValue))found.push(node.nodeValue.trim());
  for(const element of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]'))if(element.getClientRects().length&&!element.closest('#language-toggle'))for(const name of ['aria-label','placeholder','title','alt']){const value=element.getAttribute(name);if(value&&/[\u3400-\u9fff]/u.test(value))found.push(`${name}: ${value}`)}
  return [...new Set(found)];
})}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text())});
  await page.goto(base+'/#home',{waitUntil:'domcontentloaded'});await page.waitForSelector('#main[data-route="home"]');
  await page.locator('#language-toggle').click();await waitLanguage(page,'en');
  for(const route of ['home','product','configure','device']){
    if(route!=='home'){await page.evaluate(route=>location.hash=route,route);await page.waitForSelector(`#main[data-route="${route}"]`);}
    await page.waitForTimeout(500);
    let missing=await leftovers(page);assert.deepEqual(missing,[],`${route}: ${JSON.stringify(missing)}`);
    if(route==='home'||route==='product')for(const action of await page.locator('.hero-page .actions .button').all()){
      const style=await action.evaluate(node=>{const s=getComputedStyle(node);return {radius:s.borderTopLeftRadius,background:s.backgroundColor,border:s.borderTopWidth}});
      assert.equal(style.radius,'999px');assert.equal(style.background,await action.evaluate(node=>node.classList.contains('primary'))?'rgb(0, 102, 204)':'rgb(255, 255, 255)');assert.equal(style.border,'1px');
    }
    if(['home','product'].includes(route))for(const item of await page.locator('.detail-row').all()){
      await item.click();await page.waitForTimeout(50);
      missing=await leftovers(page);assert.deepEqual(missing,[],`${route} dialog: ${JSON.stringify(missing)}`);
      await page.locator('[data-detail-close]').click();await page.waitForTimeout(200);
    }
    if(route==='home'){
      assert.equal(await page.getByText('Smart watering device',{exact:true}).count(),0,'removed home caption stays absent in English');
      await page.getByRole('button',{name:'Connect watering device'}).click();
      missing=await leftovers(page);assert.deepEqual(missing,[],`connection dialog: ${JSON.stringify(missing)}`);
      await page.getByRole('button',{name:'Cancel'}).click();
    }
  }
  await page.getByRole('button',{name:'Try demo device'}).click();await page.locator('.device-identity').waitFor({timeout:20000});
  assert.deepEqual(await leftovers(page),[],'connected demo device contains untranslated copy');
  assert.ok(await page.getByRole('button',{name:'Move servo',exact:true}).isEnabled());
  assert.ok(await page.getByRole('button',{name:'Turn pump on',exact:true}).isEnabled());
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  assert.equal(await page.locator('#dialog').evaluate(node=>node.open),false);
  assert.equal(await page.locator('[data-action="factory-reset"] .device-hold-content').innerText(),'Hold to reset');
  assert.deepEqual(await leftovers(page),[],'armed factory reset contains untranslated copy');
  await page.locator('#language-toggle').click();await waitLanguage(page,'zh-CN');
  assert.equal(await page.locator('[data-action="factory-reset"] .device-hold-content').innerText(),'恢复出厂');
  await page.getByRole('button',{name:'重启',exact:true}).click();
  assert.equal(await page.locator('[data-action="restart"] .device-hold-content').innerText(),'长按确认重启');
  await page.locator('#language-toggle').click();await waitLanguage(page,'en');
  assert.equal(await page.locator('[data-action="restart"] .device-hold-content').innerText(),'Restart');
  assert.equal(await page.locator('[data-action="factory-reset"] .device-hold-content').innerText(),'Reset');
  await page.getByRole('button',{name:'Read past week'}).click();await page.waitForTimeout(500);
  assert.deepEqual(await leftovers(page),[],'history contains untranslated copy');
  const eventButton=page.getByRole('button',{name:'Read device events'});
  if(await eventButton.count()){await eventButton.click();await page.waitForTimeout(500);assert.deepEqual(await leftovers(page),[],'events contain untranslated copy');}
  await page.route('**/api/locations/countries',route=>route.fulfill({json:{items:[{id:'JP',kind:'country',name:'日本',englishName:'Japan',countryCode:'JP',selectionToken:'country-token'}]}}));
  await page.route('**/api/locations/children',route=>route.fulfill({json:{items:[{id:'tokyo',kind:'city',name:'东京',terminal:true,selectionToken:'city-token'}]}}));
  await page.route('**/api/locations/select',route=>route.fulfill({json:{location:{selectable:true,locationToken:'test-location',latitude:35.7,longitude:139.7,displayName:'日本 · 东京'}}}));
  await page.route('**/api/environment',route=>route.fulfill({json:{provider:'Open-Meteo',temperatureC:25,humidityPct:60,elevationM:5,precipitationMmDay:1,sunshineHoursDay:6,period:'Current',observedAt:'2026-10-20T12:00:00+08:00',fetchedAt:'2026-10-20T12:00:00+08:00',timezone:'Asia/Shanghai'}}));
  await page.route('**/api/configurations/generate',route=>route.fulfill({json:{source:'api',environment:{temperatureC:25,humidityPct:60},config:{revision:1,plant:'番茄',locationName:'日本 · 东京',source:'api',supplyVariant:'builtin',configVersion:'1.0',display:{roundWaterMl:50,reservoirDays:10,dailyWaterNeedMl:100,flowRateMlSec:22,estimatedIntervalDays:1},params:{threshold:53,pulseCount:1,pulseOnMs:3000,pulseOffMs:25000}}}}));
  await page.evaluate(()=>location.hash='configure');await page.waitForSelector('#main[data-route="configure"]');
  await page.locator('[data-action="reload-locations"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="reload-locations"]')?.disabled===false);
  await page.getByLabel('Country / region',{exact:true}).click();
  await page.getByLabel('Country / region',{exact:true}).fill('日');
  await page.locator('#country-options:not([hidden])').waitFor();
  await page.locator('[data-action="choose-country"][data-code="JP"]').click();
  await page.locator('#place-city option[value="tokyo"]').waitFor({state:'attached'});
  await page.getByLabel('City',{exact:true}).selectOption('tokyo');
  await page.locator('.environment-summary').waitFor();
  await page.getByRole('button',{name:'Analyze and generate configuration'}).click();await page.locator('.result-metrics').waitFor();
  assert.deepEqual(await leftovers(page),[],'configuration result contains untranslated copy');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});for(const route of ['home','product','configure','device']){await page.evaluate(route=>location.hash=route,route);await page.waitForSelector(`#main[data-route="${route}"]`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}px ${route} overflows`);}}
  await page.evaluate(()=>location.hash='configure');await page.waitForSelector('#main[data-route="configure"]');
  assert.deepEqual(errors,[]);
  await page.locator('#language-toggle').click();await waitLanguage(page,'zh-CN');assert.match(await page.locator('#breadcrumb').textContent(),/控制台/);assert.equal(await page.locator('#country-search').inputValue(),'日本');
  await page.evaluate(()=>location.hash='home');await page.waitForSelector('#main[data-route="home"]');assert.match(await page.locator('.hero-copy h1').innerText(),/呵护植物/);assert.equal(await page.getByText('智能浇水设备',{exact:true}).count(),0,'removed home caption stays absent in Chinese');
  await page.locator('#language-toggle').click();await waitLanguage(page,'en');await page.reload();await page.waitForSelector('#main[data-route="home"]');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.locator('.hero-copy h1').innerText(),/Care for plants/);
  console.log('PASS: language switch, four routes and details, dialogs, demo data, generated configuration, responsive widths, and Chinese restoration');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
