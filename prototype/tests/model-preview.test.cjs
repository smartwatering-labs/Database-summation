const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TEST_URL || 'http://127.0.0.1:5000';
const out = path.resolve('test-results/model-preview');
fs.mkdirSync(out, { recursive: true });

const idle = (page, route) => page.waitForFunction(route => {
  const stage = document.querySelector('#model-stage'), main = document.querySelector('#main');
  return stage.dataset.ready === 'true' && stage.dataset.route === route && stage.dataset.moving === 'false'
    && main.dataset.route === route && !main.inert && main.dataset.surfaceMoving === 'false';
}, route);
const go = async (page, route) => { await page.evaluate(route => location.hash = route, route); await idle(page, route); };
const openPreview = async page => {
  await page.locator('[data-panel-toggle]').click();
  await page.waitForFunction(() => document.querySelector('#main').dataset.panelOpen === '0.0000'
    && document.querySelector('#main').dataset.surfaceMoving === 'false' && document.querySelector('#model-stage').dataset.interactive === 'true');
};
const orientation = page => page.locator('#model-stage').getAttribute('data-orientation');
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.split(',').map(Number).reduce((sum, n, i) => sum + n * Number(b.split(',')[i]), 0))));
const zoom = async page => Number(await page.locator('#model-stage').getAttribute('data-zoom'));

// Inspect rendered pixels, so a correct quaternion cannot hide a low or clipped model.
async function renderedBounds(page) {
  const viewport = page.viewportSize(), initial = await page.locator('#model-canvas').boundingBox();
  // The narrow product stage has a fixed 1040px minimum. Expand only the test
  // viewport height to capture it without CDP's transient media-query override.
  const expanded = initial.height > 900 && viewport.width < 1200;
  if (expanded) await page.setViewportSize({ width: viewport.width, height: Math.ceil(initial.y + initial.height) });
  await page.locator('.main-shell').evaluate(async node => {
    await Promise.all(node.getAnimations().map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const main = page.locator('#main');
  // Isolate product pixels from the poster paper when measuring the assembly.
  const background = await page.locator('#model-stage').evaluate(node => {
    const previous = node.style.background; node.style.background = '#fff'; return previous;
  });
  const opacity = await main.evaluate(node => {
    const previous = { value: node.style.getPropertyValue('opacity'), priority: node.style.getPropertyPriority('opacity') };
    node.style.setProperty('opacity', '0', 'important'); return previous;
  });
  let png;
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clip = await page.locator('#model-canvas').evaluate(node => {
      const b = node.getBoundingClientRect();
      return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: Math.min(b.height, innerHeight-b.y), scale: 1 };
    });
    // Capture the tall model without changing the layout viewport/media queries.
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    png = Buffer.from(capture.data, 'base64');
    fs.writeFileSync(path.join(out, `pixels-${viewport.width}-${await main.getAttribute('data-route')}.png`), png);
  }
  finally {
    await cdp.detach(); await main.evaluate((node, previous) => node.style.setProperty('opacity', previous.value, previous.priority), opacity);
    await page.locator('#model-stage').evaluate((node, previous) => { node.style.background = previous; }, background);
    if (expanded) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator('.main-shell').evaluate(async node => {
        await Promise.all(node.getAnimations().map(a => a.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    }
  }
  return page.evaluate(async source => {
    const img = new Image(); img.src = 'data:image/png;base64,' + source; await img.decode();
    const surface = document.createElement('canvas'); surface.width = img.width; surface.height = img.height;
    const ctx = surface.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    let left = img.width, right = 0, top = img.height, bottom = 0, count = 0;
    const rows = new Map(), bands = [];
    for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      // White ABS is brighter than the old metal shell; include its lit faces,
      // while excluding the pure-white background and faint ground reflection.
      if (pixels[i + 3] > 100 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
        rows.set(y, (rows.get(y) || 0) + 1);
      }
    }
    for (const [y, pixels] of rows) {
      if (pixels < 4) continue;
      const last = bands.at(-1);
      if (last && y - last.bottom <= 4) last.bottom = y;
      else bands.push({ top: y, bottom: y });
    }
    return { left, right, top, bottom, count, bands, width: img.width, height: img.height };
  }, png.toString('base64'));
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/#configure'); await idle(page, 'configure'); await openPreview(page);
    const firstBounds = await renderedBounds(page), rest = await orientation(page);
    assert.ok(Math.abs((firstBounds.top + firstBounds.bottom) / 2 / firstBounds.height - .48) < .035, 'top-down assembly is centered');
    const q = rest.split(',').map(Number);
    assert.ok(Math.abs(q[1]) < 1e-8 && Math.abs(q[2]) < 1e-8 && Math.abs(q[0] - Math.SQRT1_2) < 1e-8, 'top view has no yaw or roll');
    const box = await page.locator('#model-canvas').boundingBox(), x = box.x + box.width * .5, y = box.y + box.height * .45;
    await page.mouse.move(x, y); await page.mouse.wheel(0, -260);
    await page.waitForFunction(() => Number(document.querySelector('#model-stage').dataset.zoom) > 1.25);
    await idle(page, 'configure');
    assert.ok(angle(rest, await orientation(page)) < 1e-6, 'zoom does not rotate the board');
    await page.mouse.down(); await page.mouse.move(x + 120, y + 4);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(angle(rest, await orientation(page)) > .25, 'drag reaches its new orientation while the pointer is still down');
    await page.mouse.up(); await idle(page, 'configure');
    await page.mouse.dblclick(x, y); await idle(page, 'configure');
    assert.ok(angle(rest, await orientation(page)) < 1e-6 && await zoom(page) === 1, 'double click resets rotation and zoom');
    await page.mouse.wheel(0, -12000); await idle(page, 'configure');
    assert.ok(await zoom(page) <= 1.75, 'zoom has an upper bound');
    await page.getByRole('button', { name: '返回配置面板', exact: true }).click();
    await page.waitForFunction(() => {
      const main = document.querySelector('#main'), stage = document.querySelector('#model-stage');
      return main.dataset.panelOpen === '1.0000' && main.dataset.surfaceMoving === 'false'
        && stage.dataset.moving === 'false' && stage.dataset.interactive === 'false';
    });
    assert.equal(await zoom(page), 1, 'panel restore resets zoom');
    await go(page, 'home'); await go(page, 'configure'); await openPreview(page);
    const revisited = await renderedBounds(page);
    for (const key of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(firstBounds[key] - revisited[key]) <= 2, 'deep link and navigation use identical model framing');
    await go(page, 'device'); await openPreview(page);
    const board = await renderedBounds(page);
    assert.ok((board.top + board.bottom) / 2 / board.height < .51 && board.bottom < board.height * .85, `hardware board is raised and fully visible: ${JSON.stringify(board)}`);

    for (const [width, height] of [[320, 740], [390, 844], [768, 844], [960, 768], [1024, 768], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      for (const route of ['home', 'product']) {
        await go(page, route);
        const b = await renderedBounds(page);
        if (route === 'product') {
          assert.equal(b.bands.length, 4, `${width}px product: all four layers remain visible: ${JSON.stringify(b.bands)}`);
          for (let i = 1; i < b.bands.length; i++) {
            assert.ok(b.bands[i].top - b.bands[i-1].bottom >= (width >= 1200 ? 8 : 6), `${width}px product: layers remain distinct: ${JSON.stringify(b.bands)}`);
          }
        }
        assert.ok(b.count > 2000 && b.left > 4 && b.right < b.width - 4 && b.top > 4 && b.bottom < b.height - 4, `${width} ${route}: model fits ${JSON.stringify(b)}`);
        const canvas = await page.locator('#model-canvas').boundingBox(), title = await page.locator('.hero-copy').boundingBox();
        if (width >= 768) {
          const rail = await page.locator('.sidebar').boundingBox();
          const layout = await page.evaluate(() => ({ shell: document.querySelector('.main-shell').getBoundingClientRect().toJSON(), scrollX, margin: getComputedStyle(document.querySelector('.main-shell')).marginLeft, scroll: [...document.querySelectorAll('body,.main-shell,#main')].map(n => [n.className || n.id, n.scrollLeft]) }));
          assert.ok(title.x >= rail.x + rail.width + 16, `${width} ${route}: content clears the sidebar ${JSON.stringify(layout)}`);
        }
        if (width >= 960) {
          const reading = route === 'home' ? await page.locator('.hero-side-stack').boundingBox() : title;
          assert.ok(canvas.x + b.left > reading.x + reading.width + 12, 'assembly clears the visible reading content on its left');
          if (route === 'product') {
            const region = await page.locator('.hero-visual-region').boundingBox();
            assert.ok(b.bottom - b.top > region.height * .84, 'exploded assembly fills its display region');
          }
        } else assert.ok(canvas.y + b.top >= title.y + title.height + 16, `${width} ${route}: model clears the title and primary actions above it`);
        if (route === 'product' && width < 768) assert.ok(b.right - b.left > b.width * .65, 'phone exploded model remains large with room for its shadow');
        if (route === 'home' && width === 1440) {
          assert.ok(b.right - b.left > b.width * .45 && b.right - b.left < b.width * .65, 'assembled model remains the dominant object in a balanced two-column layout');
          const card = await page.locator('.hero-side-stack').boundingBox();
          assert.ok(Math.abs(card.x-title.x)<1 && card.y > title.y+title.height+20, 'information aligns below the title and actions');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
        // Full-page capture temporarily resizes Chromium's layout viewport and can
        // restart the sidebar's margin transition. Inspect the actual viewport.
        if (width === 320 || width === 1024) await page.screenshot({ path: path.join(out, `${width}-${route}.png`) });
      }
    }

    // A preview opened before the large GLB finishes must become interactive on load.
    const early = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    early.on('pageerror', e => errors.push(e.message));
    let releaseModel;
    const gate = new Promise(resolve => releaseModel = resolve);
    await early.route('**/watering-box-9-30ver.glb', async request => { await gate; await request.continue(); });
    await early.goto(base + '/#device');
    await early.waitForFunction(() => document.querySelector('#main').dataset.route === 'device' && !document.querySelector('#main').inert);
    await early.locator('[data-panel-toggle]').click();
    await early.waitForFunction(() => document.querySelector('#main').dataset.panelOpen === '0.0000');
    releaseModel(); await idle(early, 'device');
    assert.equal(await early.locator('#model-stage').getAttribute('data-interactive'), 'true', 'preview intent survives model loading');
    await early.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(base + '/#configure'); await idle(mobile, 'configure');
    await mobile.locator('[data-panel-toggle]').tap();
    await mobile.waitForFunction(() => document.querySelector('#main').dataset.panelOpen === '0.0000' && document.querySelector('#main').dataset.surfaceMoving === 'false');
    const touchRest = await orientation(mobile), cdp = await mobile.context().newCDPSession(mobile);
    const touch = (x, y, id) => ({ x, y, id, radiusX: 3, radiusY: 3, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(125, 400, 1), touch(245, 400, 2)] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(125 - i * 8, 400, 1), touch(245 + i * 8, 400, 2)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(mobile, 'configure');
    assert.ok(await zoom(mobile) > 1.5, 'two fingers enlarge the model');
    assert.ok(angle(touchRest, await orientation(mobile)) < 1e-6, 'pinching does not tilt the board');
    await mobile.touchscreen.tap(185, 400); await mobile.touchscreen.tap(185, 400); await idle(mobile, 'configure');
    assert.equal(await zoom(mobile), 1, 'double tap resets zoom');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(150, 400, 1)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(245, 403, 1)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(mobile, 'configure');
    assert.ok(angle(touchRest, await orientation(mobile)) > .25, 'one finger still rotates after pinching');
    await mobile.locator('[data-panel-toggle]').tap();
    await mobile.waitForFunction(() => {
      const main = document.querySelector('#main'), stage = document.querySelector('#model-stage');
      return main.dataset.panelOpen === '1.0000' && main.dataset.surfaceMoving === 'false'
        && stage.dataset.moving === 'false' && stage.dataset.interactive === 'false';
    });
    assert.ok(angle(touchRest, await orientation(mobile)) < 1e-6, 'touch panel restore reaches the stored pose');
    await mobile.emulateMedia({ reducedMotion: 'reduce' }); await go(mobile, 'device');
    assert.equal(await zoom(mobile), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: rendered framing, straight top view, wheel/pinch zoom, immediate dragging, mouse/touch reset, early interaction, responsive title clearance, reduced motion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
