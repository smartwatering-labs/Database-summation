const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH,
    args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5001');
    await page.getByRole('button', { name: '连接模拟设备', exact: true }).click();
    await page.locator('#connection-status').filter({ hasText: '模拟设备' }).waitFor();
    await page.evaluate(() => { location.hash = 'configure'; });
    await page.locator('#config-file').waitFor({ state: 'attached' });
    await page.getByText('补充现场测量（可选）').click();
    await page.getByLabel('现场空气温度', { exact: true }).waitFor();
    const blocked = [];
    await page.route('**/api/**', route => { blocked.push(route.request().url()); return route.abort(); });
    const config = { deviceModel: 'ESP32-WATER-C3', configVersion: '1.0', revision: 1, plant: '番茄',
      auth: 'discard-me', params: { soilWeight: .6, tempWeight: .3, airWeight: .1,
        threshold: 50, pulseCount: 9, pulseOnMs: 3000, pulseOffMs: 25000 } };
    await page.locator('#config-file').setInputFiles({ name: 'config.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(config)) });
    await page.locator('.result-metrics').waitFor();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
    const download = await downloadReady;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).auth, undefined);
    await page.getByRole('button', { name: '发送到模拟设备', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.locator('.write-status.success').waitFor();
    await page.evaluate(() => { location.hash = 'device'; });
    await page.getByRole('button', { name: '从设备读取', exact: true }).click();
    await page.evaluate(() => { location.hash = 'configure'; });
    await page.locator('.result-metrics').waitFor();
    assert.equal(blocked.filter(url => /configurations\/(import|export)/.test(url)).length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: loaded mobile page imports, exports, sends and reads a configuration while API requests are blocked');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
