const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const mode = process.argv[2] || 'after';
const out = path.resolve(__dirname, '../test-results/product-studio', mode); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--enable-unsafe-swiftshader'] });
  const errors = [], failures = [], metrics = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => failures.push(r.url() + ': ' + r.failure()?.errorText));
    for (const [width, height] of mode === 'before' ? [[1440,1000],[390,844]] : [[320,740],[390,844],[768,900],[1024,768],[1440,900],[1440,1000],[1920,1080]]) {
      await page.setViewportSize({ width, height });
      for (const route of ['home', 'product']) {
        const started = Date.now();
        await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5001') + '/#' + route);
        await page.waitForFunction(route => {
          const s = document.querySelector('#model-stage'), m = document.querySelector('#main');
          return s.dataset.ready === 'true' && s.dataset.route === route && s.dataset.moving === 'false' && s.dataset.shadowMoving === 'false' && m.dataset.route === route && !m.inert && m.dataset.surfaceMoving === 'false';
        }, route, { timeout: 45000 });
        await page.evaluate(async () => { await Promise.all(document.querySelector('.main-shell').getAnimations().map(a=>a.finished.catch(()=>{}))); await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); });
        const diagnostics = await page.evaluate(async () => (await import('/static/js/model-stage.js')).modelStage.diagnostics());
        if (diagnostics?.lights.length !== 3 || !diagnostics.ground.receiver || !diagnostics.ground.visible || diagnostics.shells.some(s => !s.casts || !s.receives)) throw Error('Physical scene is incomplete: ' + JSON.stringify(diagnostics));
        const metric = await page.evaluate(() => ({
          gpu: (() => { const gl = document.querySelector('#model-canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info'); return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
          overflow: document.documentElement.scrollWidth > innerWidth,
          canvas: document.querySelector('#model-canvas').getBoundingClientRect().toJSON(),
          title: document.querySelector('.hero-copy').getBoundingClientRect().toJSON(),
          status: document.querySelector('#connection-status').textContent,
          rows: [...document.querySelectorAll('.detail-row')].map(n => n.getBoundingClientRect().toJSON()),
        }));
        metrics.push({ width, height, route, readyMs: Date.now() - started, diagnostics, ...metric });
        if (metric.overflow) throw Error('Horizontal overflow: ' + width + ' ' + route);
        // Chromium full-page captures can reset desktop sidebar media-query
        // transitions. Keep its real viewport; phones have no desktop margin.
        await page.screenshot({ path: path.join(out, `${width}x${height}-${route}.png`), fullPage: width < 768 });
      }
    }
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ errors, failures, metrics }, null, 2));
    if (errors.length || failures.length) throw Error(JSON.stringify({ errors, failures }));
    console.log('Captured', metrics.length, 'pages; no page/console errors, failed requests or horizontal overflow.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
