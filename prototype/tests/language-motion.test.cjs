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
      const toggle = document.querySelector('#language-toggle');
      const curtain = document.querySelector('.language-curtain');
      toggle.click();
      const cover = curtain.getAnimations()[0];
      cover.pause();
      cover.currentTime = 150;
      const halfway = curtain.getBoundingClientRect();
      cover.currentTime = 300;
      const covered = curtain.getBoundingClientRect();
      cover.finish();
      return {
        phase: document.documentElement.dataset.languageChanging,
        lang: document.documentElement.lang,
        label: toggle.textContent,
        pending: toggle.dataset.switchingTo,
        curtainCount: document.querySelectorAll('.language-curtain').length,
        halfway: halfway.width,
        covered: [covered.left, covered.right, covered.top, covered.bottom],
        pointerEvents: getComputedStyle(curtain).pointerEvents,
        modelFilter: getComputedStyle(document.querySelector('#model-stage')).filter,
      };
    });
    assert.equal(start.phase, 'cover');
    assert.equal(start.lang, 'zh-CN', 'language stays Chinese until the curtain finishes covering');
    assert.equal(start.label, 'EN', 'button text waits for full cover');
    assert.equal(start.pending, 'en', 'button gives immediate feedback');
    assert.equal(start.curtainCount, 1);
    assert.ok(start.halfway > 0 && start.halfway < 1440);
    assert.deepEqual(start.covered.map(Math.round), [0, 1440, 0, 900]);
    assert.equal(start.pointerEvents, 'none');
    assert.equal(start.modelFilter, 'none', 'the WebGL stage stays unfiltered');
    await page.waitForFunction(() => document.documentElement.dataset.languageChanging === 'reveal');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.ok(await page.locator('.hero-copy').evaluate(node => node.getAnimations().length > 0),
      'new copy floats in as the curtain leaves');
    await settled(page, 'en');
    assert.match(await page.locator('.hero-copy h1').innerText(), /Care for plants/);

    await page.evaluate(() => {
      const toggle = document.querySelector('#language-toggle');
      for (let index = 0; index < 5; index++) toggle.click();
    });
    await settled(page, 'zh-CN');
    assert.equal(await page.locator('#language-toggle').innerText(), 'EN');
    assert.equal(await page.locator('#language-toggle').getAttribute('aria-label'), '切换为英语');
    assert.equal(await page.locator('.language-curtain').evaluate(node => node.getAnimations().length), 0);

    await page.evaluate(() => {
      document.querySelector('#language-toggle').click();
      location.hash = 'product';
    });
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'product'
      && !document.querySelector('#main').inert);
    await settled(page, 'zh-CN');
    assert.match(await page.locator('.hero-copy h1').innerText(), /设备设计/,
      'navigation cancels the unfinished cover without changing language');

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

    const mobileCoverage = await page.evaluate(() => {
      document.querySelector('#language-toggle').click();
      const curtain = document.querySelector('.language-curtain');
      const cover = curtain.getAnimations()[0];
      cover.pause();
      cover.currentTime = 300;
      const bounds = curtain.getBoundingClientRect();
      cover.finish();
      return [bounds.left, bounds.right, bounds.top, bounds.bottom];
    });
    assert.deepEqual(mobileCoverage.map(Math.round), [0, 390, 0, 844]);
    await settled(page, 'en');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.evaluate(() => document.querySelector('#language-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.languageChanging === 'cover');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settled(page, 'zh-CN');
    assert.equal(await page.locator('.language-curtain').evaluate(node => node.getAnimations().length), 0,
      'changing the system preference cancels the active curtain');

    const fallback = await page.evaluate(() => {
      const curtain = document.querySelector('.language-curtain');
      curtain.animate = undefined;
      document.querySelector('#language-toggle').click();
      const result = {
        lang: document.documentElement.lang,
        phase: document.documentElement.dataset.languageChanging,
        animations: curtain.getAnimations().length,
      };
      delete curtain.animate;
      return result;
    });
    assert.deepEqual(fallback, { lang: 'en', phase: undefined, animations: 0 },
      'missing Web Animations API falls back to an instant switch');

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
    console.log('PASS: language curtain, covered text swap, stable 3D/panel, five clicks, route interruption, viewport coverage, reduced motion, no WAAPI');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
