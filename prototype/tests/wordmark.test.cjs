const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5000', { waitUntil: 'domcontentloaded' });
    const wordmark = page.locator('.desktop-brand.wordmark');
    const letter = wordmark.locator('.variable-proximity-letter').first();
    await letter.waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const weight=()=>letter.evaluate(node=>Number(getComputedStyle(node).fontVariationSettings.match(/"wght"\s+([\d.]+)/)[1]));
    assert.deepEqual(await wordmark.locator('.variable-proximity-line').allInnerTexts(), ['Smart', 'Watering', 'System']);
    assert.equal(await wordmark.evaluate(node => getComputedStyle(node).fontSize), '27px');
    await page.mouse.move(700, 500);
    await page.waitForTimeout(800);
    assert.equal(await weight(), 400);
    const box = await letter.boundingBox();
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2);
    await page.waitForTimeout(50);
    assert.equal(await weight(), 400);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(350);
    assert.ok(await weight() > 700);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.mobile-header .wordmark').evaluate(node => getComputedStyle(node).fontSize), '15px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    console.log('PASS: local variable font, monochrome wordmark and 100px proximity on desktop and mobile');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
