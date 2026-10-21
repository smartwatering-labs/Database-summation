const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.env.TEST_URL || 'http://127.0.0.1:5000';
const edge = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const settled = (page, lang) => page.waitForFunction(expected =>
  document.documentElement.lang === expected && !document.documentElement.dataset.languageChanging, lang);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: edge, args: ['--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('watering-language', 'zh'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#home');
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'home'
      && !document.querySelector('#main').inert
      && document.querySelector('#model-stage').dataset.ready === 'true');

    const start = await page.evaluate(() => {
      document.querySelector('#language-toggle').click();
      return {
        phase: document.documentElement.dataset.languageChanging,
        targets: document.querySelector('.hero-copy').getAnimations().length,
        modelFilter: getComputedStyle(document.querySelector('#model-stage')).filter,
      };
    });
    assert.equal(start.phase, 'out', 'language switch starts with a visible exit');
    assert.ok(start.targets > 0, 'poster copy participates in the transition');
    assert.equal(start.modelFilter, 'none', 'the WebGL stage stays unfiltered');
    await settled(page, 'en');
    assert.match(await page.locator('.hero-copy h1').innerText(), /Care for plants/);

    await page.evaluate(() => {
      const toggle = document.querySelector('#language-toggle');
      toggle.click();
      toggle.click();
    });
    await settled(page, 'en');
    assert.match(await page.locator('.hero-copy h1').innerText(), /Care for plants/,
      'a rapid double switch keeps the expected language');

    await page.evaluate(() => {
      document.querySelector('#language-toggle').click();
      location.hash = 'product';
    });
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'product'
      && !document.querySelector('#main').inert);
    await settled(page, 'zh-CN');
    assert.match(await page.locator('.hero-copy h1').innerText(), /设备设计/,
      'navigation completes an interrupted language switch');

    await page.evaluate(() => { location.hash = 'configure'; });
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'configure'
      && !document.querySelector('#main').inert);
    await page.evaluate(() => document.querySelector('#language-toggle').click());
    const panel = await page.locator('.workspace-panel').evaluate(node => ({
      opacity: getComputedStyle(node).opacity,
      background: getComputedStyle(node).backgroundColor,
    }));
    assert.equal(panel.opacity, '1', 'the translucent panel itself does not disappear');
    assert.match(panel.background, /rgba\(/, 'the translucent panel stays translucent');
    await settled(page, 'en');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { location.hash = 'home'; });
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'home'
      && !document.querySelector('#main').inert
      && document.querySelector('#main').dataset.surfaceMoving === 'false');
    await page.locator('#language-toggle').focus();
    await page.keyboard.press('Enter');
    await settled(page, 'zh-CN');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'language-toggle',
      'keyboard focus stays on the language control');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      'mobile translation causes no horizontal overflow');

    const reduced = await browser.newContext({ reducedMotion: 'reduce' });
    await reduced.addInitScript(() => localStorage.setItem('watering-language', 'zh'));
    const reducedPage = await reduced.newPage();
    reducedPage.on('pageerror', error => errors.push(error.message));
    await reducedPage.goto(base + '/#home');
    await reducedPage.waitForFunction(() => document.querySelector('#main').dataset.route === 'home'
      && !document.querySelector('#main').inert);
    const instant = await reducedPage.evaluate(() => {
      document.querySelector('#language-toggle').click();
      return {
        lang: document.documentElement.lang,
        phase: document.documentElement.dataset.languageChanging,
        animations: document.querySelector('.hero-copy').getAnimations().length,
      };
    });
    assert.equal(instant.lang, 'en');
    assert.equal(instant.phase, undefined);
    assert.equal(instant.animations, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: language crossfade, stable 3D/panel, rapid reversal, route interruption, reduced motion');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
