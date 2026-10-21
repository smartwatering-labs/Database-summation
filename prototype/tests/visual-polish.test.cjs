const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5000';
const output = path.resolve('test-results/title-spacing-2026-10-20/verified');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--enable-unsafe-swiftshader'],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const [width, height] of [[1440, 1000], [1920, 1080], [768, 900], [414, 896], [390, 844], [375, 812], [320, 700]]) {
      const heroPositions = {};
      await page.setViewportSize({ width, height });
      for (const route of ['home', 'product', 'configure', 'device']) {
        const response = await page.goto(`${baseUrl}/#${route}`);
        await page.waitForFunction(target => {
          const stage = document.querySelector('#model-stage');
          return document.body.dataset.page === target && document.querySelector('#main').dataset.route === target
            && stage.dataset.ready === 'true' && stage.dataset.moving === 'false' && !document.querySelector('#main').inert;
        }, route, { timeout: 30000 });
        const state = await page.evaluate(() => ({
          title: document.title,
          route: document.body.dataset.page,
          mainRoute: document.querySelector('#main')?.dataset.route,
          paper: getComputedStyle(document.querySelector('.main-shell')).backgroundColor,
          stagePaper: getComputedStyle(document.querySelector('#model-stage')).backgroundColor,
          topPaper: getComputedStyle(document.querySelector('.topline')).backgroundColor,
          sidebarPaper: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
          sidebarActivePaper: getComputedStyle(document.querySelector('.nav-link[aria-current=page]')).backgroundColor,
          indicatorPaper: getComputedStyle(document.querySelector('.nav-hover-indicator')).backgroundColor,
          workbench: ['configure', 'device'].includes(document.body.dataset.page) ? (() => {
            const panel = getComputedStyle(document.querySelector('.workspace-panel'));
            return { paper: panel.backgroundColor, shadow: panel.boxShadow, border: panel.borderTopWidth };
          })() : null,
          formWithinPanel: document.body.dataset.page === 'configure' ? (() => {
            const form = document.querySelector('.configuration-layout form');
            const scroller = document.querySelector('.workspace-panel .panel-scroll');
            return form.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 1;
          })() : null,
          overflow: document.documentElement.scrollWidth > innerWidth,
          hero: ['home', 'product'].includes(document.body.dataset.page) ? (() => {
            const heading = document.querySelector('.hero-copy h1');
            const firstLine = document.createRange(); firstLine.selectNodeContents(heading.firstChild);
            const secondLine = document.createRange(); secondLine.selectNodeContents(heading.querySelector('.muted').firstChild);
            const primary = document.querySelector('.hero-page .actions .button.primary');
            const secondary = document.querySelector('.hero-page .actions .button.secondary');
            const demo = document.querySelector('.hero-demo');
            return {
              headingSize: parseFloat(getComputedStyle(heading).fontSize),
              headingInk: getComputedStyle(heading).color,
              headingMuted: getComputedStyle(heading.querySelector('.muted')).color,
              headingTop: heading.getBoundingClientRect().top,
              headingLeft: heading.getBoundingClientRect().left,
              firstLineWidth: firstLine.getBoundingClientRect().width,
              secondLineWidth: heading.querySelector('.muted').getBoundingClientRect().width,
              secondLineSize: parseFloat(getComputedStyle(heading.querySelector('.muted')).fontSize),
              lineGap: secondLine.getBoundingClientRect().top - firstLine.getBoundingClientRect().bottom,
              primaryRadius: parseFloat(getComputedStyle(primary).borderTopLeftRadius),
              secondaryBorder: getComputedStyle(secondary).borderTopWidth,
              demoBorder: demo ? getComputedStyle(demo).borderTopWidth : null,
            };
          })() : null,
        }));
        assert.equal(state.route, route);
        assert.equal(state.mainRoute, route);
        assert.equal(state.paper, 'rgb(255, 255, 255)');
        assert.equal(state.stagePaper, state.paper);
        assert.equal(state.topPaper, state.paper);
        assert.equal(state.sidebarPaper, 'rgb(238, 240, 242)', `${width}px ${route} sidebar paper`);
        assert.equal(state.sidebarActivePaper, width >= 768 ? 'rgba(0, 0, 0, 0)' : state.paper, `${width}px ${route} active navigation`);
        assert.equal(state.indicatorPaper, state.paper, `${width}px ${route} navigation indicator`);
        assert.equal(state.overflow, false, `${width}px ${route} overflow`);
        if (route === 'configure') assert.equal(state.formWithinPanel, true, `${width}px form fits workbench`);
        if (state.workbench) {
          assert.equal(state.workbench.paper, 'rgba(237, 239, 241, 0.92)', `${route} translucent workbench`);
          assert.notEqual(state.workbench.shadow, 'none', `${route} workbench depth`);
          assert.equal(state.workbench.border, '1px', `${route} workbench border`);
        }
        if (state.hero) {
          assert.notEqual(state.hero.headingInk, state.hero.headingMuted, `${route} muted title contrast`);
          assert.ok(state.hero.secondLineSize < state.hero.headingSize, `${route} secondary heading is smaller`);
          assert.ok(Math.abs(state.hero.firstLineWidth - state.hero.secondLineWidth) < 5, `${width}px ${route} title lines align (${state.hero.firstLineWidth}px vs ${state.hero.secondLineWidth}px)`);
          assert.ok(state.hero.lineGap >= 0 && state.hero.lineGap <= 12, `${width}px ${route} title line spacing (${state.hero.lineGap}px)`);
          assert.ok(state.hero.primaryRadius >= 14, `${route} primary radius`);
          assert.equal(state.hero.secondaryBorder, '1px', `${route} secondary outline`);
          if (route === 'home') assert.equal(state.hero.demoBorder, '1px', 'demo outline');
          heroPositions[route] = { top: state.hero.headingTop, left: state.hero.headingLeft };
        }
        await page.screenshot({ path: path.join(output, `${width}-${route}.png`) });
        console.log(`${width}px ${route}: ${response?.status() || 'route change'}, heading ${state.hero ? `${state.hero.headingSize}px` : 'workspace'}, no overflow`);
      }
      assert.ok(Math.abs(heroPositions.home.top - heroPositions.product.top) <= 1, `${width}px hero titles share top edge`);
      assert.ok(Math.abs(heroPositions.home.left - heroPositions.product.left) <= 1, `${width}px hero titles share left edge`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/#home`);
    await page.waitForFunction(() => document.body.dataset.page === 'home' && !document.querySelector('#main').inert);
    await page.locator('#menu-toggle').click();
    assert.equal(await page.locator('#sidebar').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(238, 240, 242)', 'mobile menu uses grey navigation surface');
    assert.equal(await page.locator('#sidebar').isVisible(), true, 'mobile navigation opens');
    await page.keyboard.press('Escape');
    await page.locator('#sidebar').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#sidebar').isVisible(), false, 'mobile navigation closes');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${baseUrl}/#home`);
    await page.waitForFunction(() => document.body.dataset.page === 'home' && document.querySelector('.nav-hover-indicator.visible'));
    const navFrames = await page.evaluate(() => new Promise(resolve => {
      const indicator = document.querySelector('.nav-hover-indicator');
      const samples = [indicator.getBoundingClientRect().top], start = performance.now();
      location.hash = 'product';
      const frame = () => {
        samples.push(indicator.getBoundingClientRect().top);
        if (performance.now() - start < 330) requestAnimationFrame(frame);
        else resolve(samples);
      };
      requestAnimationFrame(frame);
    }));
    assert.ok(navFrames.some(y => y > navFrames[0] + 5 && y < navFrames.at(-1) - 5), 'desktop navigation indicator visibly travels between links');
    console.log(`navigation indicator: ${navFrames.length} sampled frames with visible travel`);
    await page.goto(`${baseUrl}/#configure`);
    await page.waitForFunction(() => document.body.dataset.page === 'configure' && !document.querySelector('#main').inert);
    const frames = await page.evaluate(() => new Promise(resolve => {
      const colors = () => ['body', '.main-shell', '.topline', '#model-stage']
        .map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor);
      const samples = [colors()], start = performance.now();
      location.hash = 'device';
      function sample() {
        samples.push(colors());
        if (performance.now() - start < 750) requestAnimationFrame(sample);
        else resolve(samples);
      }
      requestAnimationFrame(sample);
    }));
    assert.ok(frames.length > 8, 'route transition was sampled over several frames');
    for (const colors of frames) assert.deepEqual(colors, frames[0], 'route 3→4 background stays continuous');
    console.log(`configure→device: ${frames.length} frames with one continuous background`);
    assert.deepEqual(errors, [], 'no page errors');
    console.log(JSON.stringify({ errors }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
