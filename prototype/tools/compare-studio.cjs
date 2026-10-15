// Fixed camera/material trials. Overrides are served only to this test browser.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '../test-results/studio-trials');
const variants = {
  baseline: {},
  soft: {
    shell: { roughness: .3, envMapIntensity: .28 },
    key: { position: [-3, 3, 5], size: [4, 5], intensity: 7 },
    fill: { position: [5, 1, 3], size: [3, 5], intensity: 2.8 },
    shadow: { radius: 7, intensity: .28 },
  },
  sculpted: {
    shell: { roughness: .32, envMapIntensity: .2 },
    key: { position: [-4, 2, 4], size: [3, 5], intensity: 10 },
    fill: { position: [5, 3, 2], size: [4, 5], intensity: 3.8 },
    shadow: { radius: 6, intensity: .22 },
  },
  balanced: {
    shell: { roughness: .38, envMapIntensity: .32 },
    key: { position: [-3.5, 4, 4], size: [4, 5], intensity: 5 },
    fill: { position: [5, 1, 3], size: [3, 5], intensity: 1.8 },
    rim: { intensity: 3 },
    shadow: { radius: 7, intensity: .15 },
  },
  close: {
    shell: { roughness: .42, envMapIntensity: .26 },
    key: { position: [-2, 3.8, 2.5], size: [3, 4], intensity: 4 },
    fill: { position: [5, 1, 4], size: [3, 5], intensity: 2.4 },
    rim: { intensity: 2.5 },
    shadow: { radius: 7, intensity: .2 },
  },
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const [name, spec] of Object.entries(variants)) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.route('**/product-studio.js', async route => {
        const response = await route.fetch();
        let body = await response.text();
        body += '\nconst trial = ' + JSON.stringify(spec) + '; Object.assign(productStudio.shell, trial.shell); for (const role of ["key", "fill", "rim", "shadow"]) Object.assign(productStudio.lights[role], trial[role]);';
        await route.fulfill({ response, body });
      });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5001') + '/#home');
      await page.waitForFunction(() => document.querySelector('#model-stage').dataset.ready === 'true' && document.querySelector('#model-stage').dataset.shadowMoving === 'false');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, name + '.png') });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('Studio trials saved to', out);
})().catch(e => { console.error(e); process.exit(1); });
