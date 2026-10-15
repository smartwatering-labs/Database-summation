const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve('test-results/preview-lighting');
fs.mkdirSync(out, { recursive: true });
const idle = page => page.waitForFunction(() => {
  const stage = document.querySelector('#model-stage'), main = document.querySelector('#main');
  return stage.dataset.ready === 'true' && stage.dataset.moving === 'false' && !main.inert && main.dataset.surfaceMoving === 'false';
});
async function boardColor(page, name) {
  const png = await page.locator('#model-canvas').screenshot();
  fs.writeFileSync(path.join(out, name + '.png'), png);
  return page.evaluate(async data => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0); image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, green = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (b > r * 1.5 && b > g * 1.1 && g > 20 && b > 40) { count++; green += g; blue += b; }
    }
    return { count, green: green / count, blue: blue / count };
  }, png.toString('base64'));
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], samples = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5000') + '/#configure');
    await idle(page);
    for (const entry of ['initial', 'reopened']) {
      await page.locator('[data-panel-toggle]').click(); await idle(page);
      const pose = await page.locator('#model-stage').getAttribute('data-orientation');
      const q = pose.split(',').map(Number);
      assert.ok(Math.abs(q[0] - Math.SQRT1_2) < 1e-8 && Math.abs(q[1]) < 1e-8 && Math.abs(q[2]) < 1e-8, 'preview remains exactly top-down');
      const before = await boardColor(page, entry + '-idle');
      const box = await page.locator('#model-canvas').boundingBox(), x = box.x + box.width * .5, y = box.y + box.height * .4;
      // Half a pixel changes the view by less than 0.1 degree: the old LTC
      // degeneracy causes a large brightness jump despite this tiny movement.
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + .5, y); await page.mouse.up(); await idle(page);
      const moved = await boardColor(page, entry + '-tiny-drag');
      await page.locator('#model-canvas').press('Home'); await idle(page);
      const reset = await boardColor(page, entry + '-reset');
      samples.push({ entry, before, moved, reset });
      fs.writeFileSync(path.join(out, 'colors.json'), JSON.stringify(samples, null, 2));
      assert.ok(before.count > 50000 && moved.count > 50000, 'real blue PCB pixels are present');
      for (const color of ['green', 'blue']) {
        assert.ok(Math.abs(before[color] - moved[color]) < 3, `no sudden ${color} brightness change: ${JSON.stringify(samples.at(-1))}`);
        assert.ok(Math.abs(before[color] - reset[color]) < .5, 'reset restores the same lighting');
      }
      await page.locator('[data-panel-toggle]').click(); await idle(page);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: exact top-down preview, tiny-drag lighting continuity, Home reset and repeated preview opening');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
