const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve('test-results/shadow-transition'); fs.mkdirSync(out, { recursive: true });
const idle = (page, route) => page.waitForFunction(route => {
  const s = document.querySelector('#model-stage'), m = document.querySelector('#main');
  return s.dataset.ready === 'true' && s.dataset.route === route && s.dataset.moving === 'false'
    && s.dataset.shadowMoving === 'false' && !m.inert && m.dataset.surfaceMoving === 'false';
}, route);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install();
    await page.addInitScript(() => {
      const shaders = new WeakSet(), programs = new WeakSet(), locations = new WeakMap(), alphas = new WeakMap(), current = new WeakMap();
      window.shadowDraws = [];
      for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
        const p = type.prototype, source = p.shaderSource, attach = p.attachShader, get = p.getUniformLocation, use = p.useProgram, uniform = p.uniform1f, draw = p.drawElements;
        p.shaderSource = function(shader, code) { if (code.includes('opacity * ( 1.0 - getShadowMask() )')) shaders.add(shader); return source.call(this, shader, code); };
        p.attachShader = function(program, shader) { if (shaders.has(shader)) programs.add(program); return attach.call(this, program, shader); };
        p.getUniformLocation = function(program, name) { const loc = get.call(this, program, name); if (loc && name === 'opacity') locations.set(loc, program); return loc; };
        p.useProgram = function(program) { current.set(this, program); return use.call(this, program); };
        p.uniform1f = function(loc, value) { if (locations.has(loc)) alphas.set(locations.get(loc), value); return uniform.call(this, loc, value); };
        p.drawElements = function(...args) {
          const program = current.get(this);
          if (programs.has(program)) window.shadowDraws.push({ time: performance.now(), route: document.querySelector('#model-stage').dataset.route, alpha: alphas.get(program) });
          return draw.apply(this, args);
        };
      }
    });
    await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5000') + '/#home'); await idle(page, 'home');
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
    const start = async route => page.evaluate(route => { window.shadowDraws = []; location.hash = route; }, route);
    await start('configure'); await page.clock.runFor(750);
    const fadeOut = await page.evaluate(() => window.shadowDraws);
    assert.ok(fadeOut.some(d => d.alpha > .005 && d.alpha < .12), 'outgoing shadow has intermediate rendered alpha');
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.0000', 'workspace has no ground shadow');
    await start('home');
    let elapsed = 0;
    for (const time of [430, 480, 540, 600, 720]) {
      await page.clock.runFor(time - elapsed); elapsed = time;
      await page.screenshot({ path: path.join(out, `home-${time}.png`) });
    }
    const fadeIn = await page.evaluate(() => window.shadowDraws);
    const values = [...new Map(fadeIn.map(d => [d.time, d.alpha])).values()];
    assert.ok(values.some(a => a > 0 && a < .03) && values.some(a => a > .06 && a < .11), 'incoming shadow is drawn at low and intermediate alpha');
    assert.ok(values.every((a, i) => !i || a >= values[i - 1] - .0001), 'fade-in is monotonic');
    assert.ok(Math.max(...values.slice(1).map((a, i) => a - values[i])) < .025, 'no one-frame jump to full shadow');
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.1300');
    assert.equal(await page.locator('#model-stage').getAttribute('data-moving'), 'false');
    // Interrupt the fade-in with another route, then return while fading out.
    await start('device'); await page.clock.runFor(750); await start('home'); await page.clock.runFor(520);
    const partial = Number(await page.locator('#model-stage').getAttribute('data-shadow-opacity'));
    assert.ok(partial > .005 && partial < .12, 'test interrupts a genuinely partial shadow');
    await start('product'); await page.clock.runFor(16);
    const interrupted = Number(await page.locator('#model-stage').getAttribute('data-shadow-opacity'));
    assert.ok(Math.abs(interrupted - partial) < .025, 'interruption retains current alpha');
    await page.clock.runFor(35); await start('home'); await page.clock.runFor(800);
    assert.equal(await page.locator('#model-stage').getAttribute('data-route'), 'home');
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.1300');
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-moving'), 'false');
    await start('product'); await page.clock.runFor(800);
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.0900', 'product shadow reaches its own intensity');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await start('device'); await page.clock.runFor(100);
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.0000');
    await start('home'); await page.clock.runFor(100);
    assert.equal(await page.locator('#model-stage').getAttribute('data-shadow-opacity'), '0.1300', 'reduced motion settles immediately');
    fs.writeFileSync(path.join(out, 'draws.json'), JSON.stringify({ fadeOut, fadeIn, partial, interrupted }, null, 2));
    assert.deepEqual(errors, []);
    console.log('PASS: rendered shadow fade-in/out, continuous interruption, final route/intensity, reduced motion');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
