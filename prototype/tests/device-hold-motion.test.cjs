const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const output = path.resolve('test-results/device-hold-motion');
fs.mkdirSync(output, { recursive: true });

async function hold(page, button, duration) {
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(duration);
  await page.mouse.up();
}

async function assertEqualButtonSizes(page) {
  const sizes = await page.locator('.device-controls [data-action="device-download"], .device-controls [data-device-hold]').evaluateAll(buttons =>
    buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { action: button.dataset.action, width: box.width, height: box.height };
    }));
  assert.equal(sizes.length, 3, 'the three lower action buttons share one size');
  for (const size of sizes) {
    assert.ok(Math.abs(size.width - sizes[0].width) <= 1, `${size.action} width matches`);
    assert.ok(Math.abs(size.height - sizes[0].height) <= 1, `${size.action} height matches`);
  }
  assert.ok(sizes[0].width < 112 && sizes[0].height < 46, 'the three lower buttons are slightly smaller');
  const mode = await page.locator('[data-action="mode"]').boundingBox();
  assert.ok(mode.width < sizes[0].width, 'apply uses its original compact width');
  const select = await page.locator('#target-mode').boundingBox();
  assert.ok(Math.abs(select.y + select.height / 2 - mode.y - mode.height / 2) <= 2, 'mode selection and apply stay on one line');
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5001');
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'home' && !document.querySelector('#main').inert);

    await page.getByRole('button', { name: '数据处理', exact: true }).click();
    assert.equal(await page.locator('#detail-dialog').evaluate(node => node.open), true);
    assert.ok(await page.locator('#detail-dialog').evaluate(node => node.getAnimations().length > 0), 'detail panel has an entrance animation');
    await page.keyboard.press('Escape');
    await page.locator('#detail-dialog').waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: '连接模拟设备', exact: true }).click();
    await page.evaluate(() => { location.hash = 'device'; });
    await page.waitForFunction(() => document.querySelector('#main').dataset.route === 'device' && !document.querySelector('#main').inert && !!document.querySelector('[data-action="mode"]'));

    const mode = page.locator('[data-action="mode"]');
    const read = page.locator('[data-action="device-download"]');
    const restart = page.locator('[data-action="restart"]');
    const reset = page.locator('[data-action="factory-reset"]');
    assert.equal(await page.locator('[data-device-hold]').count(), 2);
    assert.equal(await mode.getAttribute('data-device-hold'), null);
    assert.equal(await read.getAttribute('data-device-hold'), null);
    assert.equal(await read.locator('svg').count(), 0, 'read button has no icon');
    assert.equal(await page.locator('#device-hold-hint').count(), 0);
    assert.equal(await page.getByText('长按 2 秒清除设备配置并重启；此操作无法撤销，建议先读取并导出配置。').count(), 0);
    await assertEqualButtonSizes(page);

    const colors = await page.locator('[data-device-hold]').evaluateAll(buttons => buttons.map(button => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, color: style.color };
    }));
    assert.deepEqual(colors[0], colors[1], 'restart and reset have the same default colors');

    await page.setViewportSize({ width: 320, height: 720 });
    await assertEqualButtonSizes(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px device page has no horizontal overflow');
    await page.locator('#language-toggle').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.documentElement.dataset.languageChanging);
    await assertEqualButtonSizes(page);
    await page.locator('#language-toggle').click();
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && !document.documentElement.dataset.languageChanging);
    await page.setViewportSize({ width: 1440, height: 900 });

    const manual = page.locator('.manual-control');
    assert.equal(await manual.locator('h2').innerText(), '手动控制');
    assert.equal(await manual.locator('.section-heading p').innerText(), '点击按钮以控制舵机和水泵');
    assert.ok(await page.locator('.manual-control').evaluate(node => node.compareDocumentPosition(document.querySelector('.history-section:not(.manual-control)')) & Node.DOCUMENT_POSITION_FOLLOWING), 'manual controls precede device events');
    await manual.getByRole('button', { name: '打开水泵' }).click();
    await page.waitForFunction(() => document.querySelector('.manual-control [data-action="manual-pump"]')?.textContent.includes('关闭水泵'));
    assert.equal(await manual.locator('[data-action="manual-pump"]').getAttribute('aria-pressed'), 'true');
    await manual.getByRole('button', { name: '关闭水泵' }).click();
    await page.waitForFunction(() => document.querySelector('.manual-control [data-action="manual-pump"]')?.textContent.includes('打开水泵'));
    assert.equal(await manual.locator('[data-action="manual-pump"]').getAttribute('aria-pressed'), 'false');
    await manual.getByRole('button', { name: '控制舵机' }).click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('舵机已开始一次扫动'));

    await page.locator('#target-mode').selectOption('PREPARE');
    await mode.click();
    await page.waitForFunction(() => document.querySelector('[data-current-mode]')?.textContent.includes('准备 / 采样'));
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);

    await read.click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('设备尚未保存配置'));
    assert.equal(await page.locator('[data-action="device-download"].is-armed').count(), 0);
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);

    await reset.evaluate(node => node.addEventListener('animationstart', event => {
      if (event.animationName === 'device-hold-arm') window.__armFeedback = true;
    }));
    await reset.click();
    await page.waitForFunction(() => window.__armFeedback === true);
    assert.equal(await reset.locator('.device-hold-content').innerText(), '长按确认恢复');
    assert.ok(await reset.evaluate(node => node.classList.contains('is-armed')));
    const armedColors = await reset.evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    });
    assert.deepEqual(armedColors, colors[1], 'arming keeps the same colors');
    const textColors = await reset.evaluate(node => ({
      base: getComputedStyle(node.querySelector('.device-hold-content')).color,
      fill: getComputedStyle(node.querySelector('.device-hold-fill-content')).color,
    }));
    assert.equal(textColors.base, colors[1].color);
    assert.notEqual(textColors.fill, textColors.base, 'fill text changes color as progress crosses it');

    const box = await reset.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(350);
    const progress = await reset.locator('.device-hold-fill').evaluate(node => getComputedStyle(node).clipPath);
    assert.match(progress, /^inset\(0px? \d/, 'hold progress uses a clip mask');
    assert.notEqual(progress, 'inset(0px 0px 0px 0px)', 'hold is not complete before one second');
    await page.screenshot({ path: path.join(output, 'hold-progress.png') });
    await page.mouse.up();
    assert.ok(await reset.evaluate(node => node.classList.contains('is-armed')), 'early release leaves confirmation armed');
    assert.equal(await page.getByText('设备已确认恢复出厂').count(), 0, 'early release does not reset');

    await page.setViewportSize({ width: 390, height: 844 });
    await reset.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile viewport has no horizontal overflow');
    await assertEqualButtonSizes(page);
    await page.screenshot({ path: path.join(output, 'armed-mobile.png') });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await reset.locator('.device-hold-fill').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await hold(page, reset, 1100);
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('设备已确认恢复出厂'));
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);

    await page.getByRole('button', { name: '体验模拟设备' }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-action="restart"]'));
    await restart.click();
    assert.equal(await restart.locator('.device-hold-content').innerText(), '长按确认重启');
    await hold(page, restart, 1100);
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('设备已确认重启'));
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), false);
    assert.deepEqual(errors, []);
    console.log('PASS: compact apply on one line at 320px in both languages; three smaller buttons; arm feedback; direct apply/read; one-second holds; mobile; reduced motion');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
