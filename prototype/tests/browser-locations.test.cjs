// Focused browser regression: failed list retry, keyboard selection and stale responses.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:360,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const countries=[{id:'CN',name:'中国',englishName:'China',countryCode:'CN',kind:'country',terminal:false,selectionToken:'cn'},
  {id:'JP',name:'日本',englishName:'Japan',countryCode:'JP',kind:'country',terminal:false,selectionToken:'jp'}];
 let attempts=0,release,started;
 const pending=new Promise(r=>release=r),received=new Promise(r=>started=r);
 await page.route('**/api/locations/countries',r=>r.fulfill({status:++attempts===1?503:200,json:attempts===1?{message:'测试：列表加载失败'}:{items:countries}}));
 await page.route('**/api/locations/children',async r=>{
  if(r.request().postDataJSON().parentToken==='cn'){
   started();await pending;
   await r.fulfill({json:{items:[{id:'stale',name:'过期省份',terminal:false}]}}).catch(()=>{});
  } else await r.fulfill({json:{items:[{id:'tokyo',name:'Tokyo',kind:'city',terminal:true,selectionToken:'tokyo'}]}});
 });
 try {
  await page.goto((process.env.TEST_URL||'http://127.0.0.1:5000')+'/#configure');
  await page.getByText('测试：列表加载失败',{exact:true}).waitFor();
  await page.getByRole('button',{name:'重新加载地点列表',exact:true}).click();
  await page.getByLabel('国家 / 地区',{exact:true}).fill('中');
  await page.getByRole('option',{name:'中国 China',exact:true}).waitFor();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await received;
  await page.getByLabel('国家 / 地区',{exact:true}).fill('日');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.locator('#place-city option[value="tokyo"]').waitFor({state:'attached'});
  release();await page.waitForTimeout(100);
  assert.equal(await page.locator('#place-province').count(),0);
  assert.equal(await page.locator('#country-search').inputValue(),'日本');
  assert.equal(await page.locator('#scenario-form button[type="submit"]').isDisabled(),true);
  await page.getByLabel('国家 / 地区',{exact:true}).fill('zz-no-country');
  await page.getByText('没有匹配的国家，请尝试中文名称或英文名称').waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#country-options').isHidden(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);console.log('PASS: retry, keyboard selection, stale response ignored, invalid text blocked, mobile layout');
 }finally{release();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
