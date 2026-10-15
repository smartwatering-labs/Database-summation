const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'allow'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const base=process.env.TEST_URL||'http://127.0.0.1:5001';
    await page.goto(base+'/offline-kit');
    await page.getByText('离线入口已缓存').waitFor({timeout:20000});
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'离线配置入口'}).waitFor();
    const config={deviceModel:'ESP32-WATER-C3',configVersion:'2.0',revision:2,plant:'番茄',targetDeviceId:'DEMO-WATER001',
      params:{soilWeight:.6,tempWeight:.3,airWeight:.1,threshold:50,pulseCount:2,pulseOnMs:3000,pulseOffMs:25000,minWaterIntervalSeconds:172800}};
    await page.locator('#file').setInputFiles({name:'config.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config))});
    await page.getByText('已导入 番茄 R2').waitFor();
    await page.locator('#credential').setInputFiles({name:'owner.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({deviceId:'DEMO-WATER001',secret:'1f'.repeat(32)}))});
    await page.locator('#credential-state').filter({hasText:'DEMO-WATER001'}).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('1f'.repeat(32)));
    const next=page.waitForEvent('download');await page.locator('#export').click();const file=await next;
    const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).targetDeviceId,'DEMO-WATER001');
    assert.deepEqual(errors,[]);
    console.log('PASS: cached offline entry reloads without network, validates import and exports a bound configuration');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
