const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.TEST_URL || 'http://127.0.0.1:5000';
const output = path.resolve(process.env.ARTIFACT_DIR || 'test-results/browser');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH || fs.existsSync(edge) ? { executablePath: process.env.BROWSER_PATH || edge } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    // The public location and weather providers are outside this browser test.
    const environment = {
      provider: '测试天气', temperatureC: 25, humidityPct: 60, elevationM: 5,
      precipitationMmDay: 1, sunshineHoursDay: 6, period: '测试时段',
      observedAt: '2026-10-20T12:00:00+08:00', fetchedAt: '2026-10-20T12:00:00+08:00', timezone: 'Asia/Shanghai',
    };
    const generated = {
      source: 'api', environment,
      config: {
        revision: 1, plant: '番茄', locationName: '日本 · 东京', source: 'api',
        supplyVariant: 'builtin', configVersion: '1.0',
        display: { roundWaterMl: 50, reservoirDays: 10, dailyWaterNeedMl: 100, flowRateMlSec: 22, estimatedIntervalDays: 1 },
        params: { threshold: 53, pulseCount: 1, pulseOnMs: 3000, pulseOffMs: 25000 },
      },
    };
    let submitted;
    await page.route('**/api/locations/countries', route => route.fulfill({ json: { items: [
      { id: 'JP', kind: 'country', name: '日本', englishName: 'Japan', countryCode: 'JP', selectionToken: 'country-token' },
    ] } }));
    await page.route('**/api/locations/children', route => route.fulfill({ json: { items: [
      { id: 'tokyo', kind: 'city', name: '东京', terminal: true, selectionToken: 'city-token' },
    ] } }));
    await page.route('**/api/locations/select', route => route.fulfill({ json: { location: {
      selectable: true, locationToken: 'test-location', latitude: 35.7, longitude: 139.7, displayName: '日本 · 东京',
    } } }));
    await page.route('**/api/environment', route => route.fulfill({ json: environment }));
    await page.route('**/api/configurations/generate', route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: generated });
    });

    const ready = route => page.waitForFunction(route => {
      const main = document.querySelector('#main');
      return document.body.dataset.page === route && main.dataset.route === route && !main.inert;
    }, route, { timeout: 30000 });
    const go = async route => { await page.evaluate(route => { location.hash = route; }, route); await ready(route); };
    const rows = () => page.locator('.hero-index .detail-row').evaluateAll(nodes => nodes.map(node => ({
      title: node.querySelector('strong').textContent,
      summary: node.querySelector('.index-copy > span').textContent,
      aria: node.getAttribute('aria-label'),
    })));

    await page.goto(`${base}/#home`);
    await ready('home');
    assert.equal(await page.locator('.hero-copy h1').innerText(), '呵护植物\n及人之所不能及');
    assert.equal(await page.locator('.hero-description').innerText(), '客制化植物灌溉方案\n为每一种植物提供独到环境');
    assert.equal(await page.locator('.index-heading').count(), 0);
    assert.deepEqual(await rows(), [
      { title: '数据处理', summary: '我们是怎么生成客制化方案的，你的数据上传后会怎么样', aria: '数据处理' },
      { title: '编译须知', summary: '在客制化时，设备如何进行通讯和编译', aria: '编译须知' },
      { title: '报错处理', summary: '不同的报错信号意味着什么？', aria: '报错处理' },
    ]);
    assert.equal(await page.locator('.index-number').count(), 0);
    for (const label of ['连接浇水设备', '生成个性化配置', '连接模拟设备']) {
      assert.equal(await page.getByText(label, { exact: true }).count(), 1);
    }
    await page.screenshot({ path: path.join(output, 'home.png') });

    await go('product');
    assert.equal(await page.locator('.hero-copy h1').innerText(), '设备设计\n为什么值得信赖');
    assert.equal(await page.locator('.hero-description').innerText(), '从里到外，对其设计进行了解');
    assert.equal(await page.locator('.index-heading').count(), 0);
    assert.equal(await page.locator('.product-hero .hero-visual-region figcaption').count(), 0);
    assert.deepEqual(await rows(), [
      { title: '硬件结构', summary: '外壳设计与内部功能设计', aria: '硬件结构' },
      { title: '工作原理', summary: '机器的自动化依据与实现逻辑', aria: '工作原理' },
      { title: '情况需知', summary: '机器为什么会报错，可能的归因是什么？', aria: '情况需知' },
      { title: '使用流程', summary: '使用设备具体流程', aria: '使用流程' },
    ]);
    assert.equal(await page.locator('.index-number').count(), 0);
    await page.screenshot({ path: path.join(output, 'product.png') });

    await go('configure');
    const supply = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: '水源与流量' }) });
    assert.equal(await supply.locator('.settings-group .field-row').count(), 3);
    assert.equal(await page.getByText('水源描述', { exact: true }).count(), 0);
    await page.getByLabel('国家 / 地区', { exact: true }).fill('日');
    await page.locator('[data-action="choose-country"][data-code="JP"]').click();
    await page.locator('#place-city option[value="tokyo"]').waitFor({ state: 'attached' });
    await page.getByLabel('城市', { exact: true }).selectOption('tokyo');
    await page.locator('.environment-summary').waitFor();
    await page.getByRole('button', { name: '分析并生成配置', exact: true }).click();
    await page.locator('.result-metrics').waitFor();
    assert.ok(submitted && !Object.keys(submitted).some(key => key.toLowerCase() === 'watersource'));
    assert.equal(await page.locator('.result-heading .status-badge').innerText(), 'R1');
    await page.screenshot({ path: path.join(output, 'configure.png') });

    await go('device');
    const deviceText = await page.locator('#main').innerText();
    assert.ok(!deviceText.includes('上次连接设备') && !deviceText.includes('深度休眠时无法由网页远程唤醒'));
    const disconnected = await page.evaluate(async () => {
      const { devicePage } = await import('/static/js/pages/device.js');
      return devicePage({ settings: { demoEnabled: false } }, {
        state: 'disconnected', busy: false,
        pendingWrite: { deviceId: 'TEST-DEVICE', config: { revision: 3 } },
        lastSnapshot: { status: { deviceId: 'OLD-DEVICE' }, readAt: Date.now() },
      });
    });
    assert.match(disconnected, /R3 写入结果待核对/);
    assert.doesNotMatch(disconnected, /上次连接设备|深度休眠时无法由网页远程唤醒/);
    await page.screenshot({ path: path.join(output, 'device.png') });

    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['home', 'product', 'configure', 'device']) {
        await go(route);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px ${route} overflows`);
        if (width >= 1200 && ['home', 'product'].includes(route)) {
          const gap = await page.evaluate(() => document.querySelector('.hero-side-stack').getBoundingClientRect().top
            - document.querySelector('.hero-copy .actions').getBoundingClientRect().bottom);
          assert.ok(gap >= 20 && gap <= 48, `${width}px ${route} action-to-index gap is ${gap}px`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: four routes, exact copy and index labels, generation payload, device notices, responsive layout and browser console');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
