const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const output = path.resolve('test-results/device-reload-layout');
const sessionKey = 'watering-ble-session';
const base = process.env.TEST_URL || 'http://127.0.0.1:5000';

async function installBluetooth() {
  if (!['http:', 'https:'].includes(location.protocol)) return;
  const track = key => {
    const stats = JSON.parse(sessionStorage.getItem('ble-test:stats') || '{}');
    stats[key] = (stats[key] || 0) + 1;
    sessionStorage.setItem('ble-test:stats', JSON.stringify(stats));
  };
  let selectedPromise;
  const selectedDevice = () => selectedPromise ||= (async () => {
    const { DemoTransport } = await import('/static/js/services/demo.js');
    const { FrameDecoder, encodeMessage } = await import('/static/js/services/protocol.js');
    const demo = new DemoTransport(() => {}, () => {}, 0);
    const selected = new EventTarget(), reader = new EventTarget();
    selected.id = 'remembered-browser-device';
    reader.properties = { notify:true };
    reader.startNotifications = async () => { track('subscriptions'); return reader; };
    const decoder = new FrameDecoder(async message => {
      track(message.action);
      const payload = await demo.request(message.action, message.payload);
      if (message.action === 'handshake') payload.capabilities.push('time-sync', 'quick-check', 'emergency-stop');
      for (const frame of encodeMessage({ id:message.id, protocol:'SWS-BLE', protocolVersion:'1.0', status:'ok', payload })) {
        reader.value = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
        reader.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    });
    const writer = { properties:{ write:true }, writeValueWithResponse:async bytes => decoder.push(bytes) };
    const service = { getCharacteristic:async uuid => uuid.endsWith('002') ? writer : reader };
    selected.gatt = {
      connected:false,
      async connect() { track('connections'); this.connected = true; await demo.connect(); return this; },
      async getPrimaryService() { track('services'); return service; },
      disconnect() {
        const linked = this.connected; this.connected = false;
        if (linked) selected.dispatchEvent(new Event('gattserverdisconnected'));
      },
    };
    return selected;
  })();
  const bluetooth = {
    async requestDevice() { track('picker'); sessionStorage.setItem('ble-test:granted', 'yes'); return selectedDevice(); },
  };
  if (sessionStorage.getItem('ble-test:mode') !== 'unsupported') bluetooth.getDevices = async () => {
    track('permissions');
    return sessionStorage.getItem('ble-test:granted') && sessionStorage.getItem('ble-test:mode') !== 'revoked' ? [await selectedDevice()] : [];
  };
  Object.defineProperty(navigator, 'bluetooth', { configurable:true, value:bluetooth });
}
async function ready(page) {
  await page.locator('.device-identity').waitFor();
  await page.waitForFunction(() => !document.querySelector('#main').inert && !document.querySelector('#main').classList.contains('content-hidden'));
}
async function choose(page) {
  await page.locator('.device-empty [data-action="connect"]').click();
  await page.getByRole('button', { name:'选择并连接设备', exact:true }).click();
  await ready(page);
}
const stats = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('ble-test:stats') || '{}'));

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--enable-unsafe-swiftshader'] });
  try {
    fs.mkdirSync(output, { recursive:true });
    const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
    await context.addInitScript(installBluetooth);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#device');
    await choose(page);
    assert.equal((await stats(page)).picker, 1);
    const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), sessionKey);
    assert.equal(saved.deviceId, 'DEMO-WATER001');
    assert.equal(saved.browserDeviceId, 'remembered-browser-device');
    assert.equal(saved.config, undefined);

    await page.reload(); await ready(page);
    const reloaded = await stats(page);
    assert.equal(reloaded.picker, 1, 'a reload must not reopen the picker');
    for (const key of ['permissions','connections','services','subscriptions','handshake','authenticate','status']) assert.ok(reloaded[key] >= (key === 'permissions' ? 1 : 2), key);

    // The right edge stays put while the wider control column grows left.
    const metrics = [];
    for (const language of ['zh','en']) {
      if (language === 'en') {
        await page.locator('#language-toggle').click();
        await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.documentElement.dataset.languageChanging && !document.querySelector('#main').inert);
      }
      for (const width of [1920,1440,1200,1199,960,768,390,320]) {
        await page.setViewportSize({width, height:1000});
        if (width < 768 && await page.locator('#sidebar').evaluate(node => node.classList.contains('open'))) await page.locator('#menu-toggle').click();
        if (width < 768) await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'hidden');
        await page.locator('.device-controls').scrollIntoViewIfNeeded();
        const metric = await page.locator('.device-controls').evaluate(node => {
          const rect = node.getBoundingClientRect();
          const overflow = [...node.querySelectorAll('.field-row, .field-row button, .field-row select')].filter(item => {
            const bounds = item.getBoundingClientRect();
            return bounds.left < rect.left - 1 || bounds.right > rect.right + 1;
          }).map(item => item.id || item.dataset.action || item.className);
          return { viewport:innerWidth, width:rect.width, left:rect.left, right:rect.right, overflow,
            documentOverflow:document.documentElement.scrollWidth > innerWidth,
            columns:getComputedStyle(node.parentElement).gridTemplateColumns };
        });
        metrics.push({language, ...metric});
        assert.equal(metric.documentOverflow, false, `${language} ${width}: page overflow`);
        assert.deepEqual(metric.overflow, [], `${language} ${width}: control overflow`);
        if (width >= 1200) {
          assert.ok(Math.abs(metric.width - 384) < 1, `${language} ${width}: wider controls`);
          assert.ok(Math.abs(metric.right - (width - 80)) < 1, `${language} ${width}: right edge is unchanged`);
        } else assert.equal(metric.columns.split(' ').length, 1, `${language} ${width}: single-column controls`);
        if (width === 1440 || width === 390) await page.screenshot({path:path.join(output, `after-${language}-${width}.png`)});
      }
    }
    fs.writeFileSync(path.join(output,'after.json'),JSON.stringify(metrics,null,2));

    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#main [data-action="disconnect"]').click();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), sessionKey), null);
    const permissionCalls = (await stats(page)).permissions;
    await page.reload();
    await page.locator('.device-empty').waitFor();
    assert.equal((await stats(page)).permissions, permissionCalls, 'manual disconnect disables reload recovery');

    // Recovery failure remains usable and does not launch an unsolicited picker.
    await page.locator('#language-toggle').click();
    await page.waitForFunction(() => document.documentElement.lang.startsWith('zh') && !document.documentElement.dataset.languageChanging);
    await choose(page);
    await page.evaluate(() => sessionStorage.setItem('ble-test:mode','unsupported'));
    const pickerCount = (await stats(page)).picker;
    await page.reload();
    await page.locator('.device-empty').filter({hasText:'未开放蓝牙自动恢复'}).waitFor();
    assert.equal((await stats(page)).picker, pickerCount);
    assert.equal(await page.locator('.device-empty [data-action="connect"]').isEnabled(), true);
    await page.locator('#language-toggle').click();
    await page.locator('.device-empty').filter({hasText:'Automatic Bluetooth recovery is unavailable'}).waitFor();
    await page.evaluate(() => sessionStorage.setItem('ble-test:mode','revoked'));
    await page.reload();
    await page.locator('.device-empty').filter({hasText:'Permission for the previous device was not found'}).waitFor();
    assert.equal((await stats(page)).picker, pickerCount);
    assert.deepEqual(errors, []);
    console.log('PASS: reload restores one permitted device without a picker; fresh handshake/status; disconnect persists; unsupported/revoked recovery is usable; 16 localized layouts fit');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
