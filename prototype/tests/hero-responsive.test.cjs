const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.TEST_URL || 'http://127.0.0.1:5000';
const desktop = [[1920, 1080], [1440, 900], [1440, 720], [1366, 768], [1280, 800], [1280, 720], [1024, 768], [1024, 600], [960, 700], [960, 600]];
const stacked = [[768, 1024], [390, 844], [320, 700]];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    for (const [width, height] of [...desktop, ...stacked]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#product');
      await page.waitForFunction(() => {
        const stage = document.querySelector('#model-stage'), main = document.querySelector('#main');
        return document.body.dataset.page === 'product' && stage.dataset.ready === 'true'
          && stage.dataset.route === 'product' && stage.dataset.moving === 'false' && !main.inert;
      });
      const inspect = () => page.evaluate(() => {
        const rect = selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return {
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth,
          viewportHeight: innerHeight,
          viewportWidth: innerWidth,
          copy: rect('.hero-copy'),
          visual: rect('.hero-visual-region'),
          details: rect('.hero-side-stack'),
          primary: getComputedStyle(document.querySelector('.hero-page .actions .button.primary')).backgroundColor,
          actions: [...document.querySelectorAll('.hero-page .actions .button')].map(node => node.getBoundingClientRect().top),
        };
      });
      const chinese = await inspect();
      assert.ok(chinese.width <= width, width + 'px product: no horizontal overflow');
      assert.equal(chinese.primary, 'rgb(0, 102, 204)', width + 'px product: main action is blue');
      if (width >= 960) {
        assert.ok(chinese.height <= height + 1, width + 'x' + height + ' product: all content fits the first viewport ' + JSON.stringify(chinese));
        assert.ok(chinese.copy.right + 12 < chinese.visual.left, width + 'px product: text and model stay in separate columns');
        assert.ok(chinese.visual.bottom <= height - 20, width + 'px product: model has bottom breathing room');
        assert.ok(chinese.details.bottom <= height - 16, width + 'px product: all four sections remain visible');
      } else {
        assert.ok(chinese.copy.bottom < chinese.visual.top && chinese.visual.bottom < chinese.details.top,
          width + 'px product: reading order stays intact on narrow screens');
      }
      await page.locator('#language-toggle').click();
      await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.documentElement.dataset.languageChanging);
      const english = await inspect();
      assert.ok(english.width <= width, width + 'px English product: no horizontal overflow');
      if (width >= 960) {
        assert.ok(english.height <= height + 1, width + 'px English product: all content fits the first viewport');
        assert.ok(Math.abs(english.actions[0] - english.actions[1]) < 1, width + 'px English product: actions stay on one line');
      }
      await page.evaluate(() => { location.hash = 'home'; });
      await page.waitForFunction(() => document.querySelector('#model-stage').dataset.route === 'home'
        && document.querySelector('#model-stage').dataset.moving === 'false'
        && !document.querySelector('#main').inert);
      assert.equal(await page.getByText('Smart watering device', { exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, [], width + 'px console');
      await page.close();
    }
    console.log('PASS: two-column desktop poster, first-viewport product, compact English actions, stacked narrow screens, accent and removed caption');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
