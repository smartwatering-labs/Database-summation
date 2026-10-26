const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5001') + '/#device');
    await page.locator('#main[data-route="device"] .device-empty').waitFor();
    await page.evaluate(async () => {
      const { DemoTransport } = await import('/static/js/services/demo.js');
      const { FrameDecoder, encodeMessage } = await import('/static/js/services/protocol.js');
      const demo = new DemoTransport(() => {}, () => {}, 0);
      const selected = new EventTarget(), reader = new EventTarget();
      selected.id = 'browser-gatt-regression';
      reader.properties = { notify: true };
      reader.startNotifications = async () => reader;
      const decoder = new FrameDecoder(async message => {
        const payload = await demo.request(message.action, message.payload);
        for (const frame of encodeMessage({ id: message.id, protocol: 'SWS-BLE', protocolVersion: '1.0', status: 'ok', payload })) {
          reader.value = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
          reader.dispatchEvent(new Event('characteristicvaluechanged'));
        }
      });
      const writer = { properties: { write: true }, writeValueWithResponse: async bytes => decoder.push(bytes) };
      let characteristicIndex = 0, discoveryCalls = 0;
      const service = { getCharacteristic: async () => (++characteristicIndex % 2) ? writer : reader };
      window.__gattConnects = 0;
      window.__gattDisconnects = 0;
      window.__pendingSettles = 0;
      window.__stuck = false;
      selected.gatt = {
        connected: false,
        async connect() {
          window.__gattConnects++;
          // "Connection already in progress" means one native Connect is still
          // pending. Either it settles into a link on its own, or it is dead.
          if (window.__pendingSettles > 0) {
            window.__pendingSettles--;
            const gatt = this;
            setTimeout(() => { gatt.connected = true; }, 600);
            throw new DOMException('Connection already in progress.', 'NetworkError');
          }
          if (window.__stuck) throw new DOMException('Connection already in progress.', 'NetworkError');
          this.connected = true; await demo.connect(); return this;
        },
        async getPrimaryService() {
          if (++discoveryCalls === 1) {
            this.disconnect();
            throw new DOMException('GATT Server is disconnected. Cannot retrieve services.', 'NetworkError');
          }
          return service;
        },
        disconnect() {
          window.__gattDisconnects++;
          const wasConnected = this.connected; this.connected = false;
          if (wasConnected) selected.dispatchEvent(new Event('gattserverdisconnected'));
        },
      };
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: () => {
        window.__pickerBeforeBusyRender = !!document.querySelector('.device-empty [data-action="connect"]');
        return new Promise(resolve => { window.__selectDevice = () => resolve(selected); });
      } } });
    });
    const openDialog = async (withCredential = false) => {
      await page.locator('.device-empty [data-action="connect"]').click();
      if (withCredential) {
        await page.locator('[name="credentialFile"]').setInputFiles({ name: 'device.json', mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ deviceId: 'DEMO-WATER001', secret: 'ab'.repeat(32) })) });
        await page.waitForFunction(() => !document.querySelector('#dialog-form button[type="submit"]').disabled);
      }
      await page.getByRole('button', { name: '选择并连接设备', exact: true }).click();
      await page.getByRole('heading', { name: '等待选择设备', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__pickerBeforeBusyRender), true, 'browser chooser is requested before rebuilding the device page');
      assert.equal(await page.locator('#sidebar-connection').textContent(), '等待选择设备');
      await page.evaluate(() => window.__selectDevice());
    };
    const connect = async (withCredential = false) => {
      await openDialog(withCredential);
      await page.locator('.device-identity').waitFor({ timeout: 30000 });
      assert.ok(await page.locator('.manual-control').isVisible());
      assert.ok(await page.locator('[data-action="manual-pump"]').isEnabled());
      assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    };
    const disconnect = async () => {
      await page.locator('#main [data-action="disconnect"]').click();
      await page.locator('.device-empty').waitFor();
    };
    const counters = () => page.evaluate(() => ({ connects: window.__gattConnects, disconnects: window.__gattDisconnects }));

    // A GATT disconnect during discovery retries and connects again.
    await connect(true);
    assert.equal((await counters()).connects, 2);
    await disconnect();

    // A pending native Connect settles into a link: wait for it, never re-request.
    const settledFrom = await page.evaluate(() => { window.__pendingSettles = 1; return true; });
    assert.ok(settledFrom);
    const beforeSettle = await counters();
    await connect();
    const afterSettle = await counters();
    assert.equal(afterSettle.connects - beforeSettle.connects, 1, 'pending Connect is reused instead of re-requested');
    assert.equal(afterSettle.disconnects, beforeSettle.disconnects, 'pending Connect is not interrupted while it may still succeed');
    await disconnect();

    // A pending Connect that never settles is released once, then reported.
    await page.evaluate(() => { window.__stuck = true; });
    const beforeStuck = await counters();
    await openDialog();
    await page.locator('.device-empty').filter({ hasText: '蓝牙连接请求一直未完成' }).waitFor({ timeout: 30000 });
    const afterStuck = await counters();
    assert.equal(afterStuck.connects - beforeStuck.connects, 2, 'a dead pending Connect is retried once, not spammed');
    await page.evaluate(() => { window.__stuck = false; });
    assert.deepEqual(errors, []);
    console.log('PASS: GATT discovery disconnect recovers; a pending Connect is waited out instead of re-requested; a pending Connect that never settles is reported without being cancelled');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
