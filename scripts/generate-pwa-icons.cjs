const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = createRequire(path.resolve(__dirname, '../apps/web/package.json'))('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const size of [192, 512]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<body style="margin:0;background:#157a66;color:white;display:grid;place-items:center;width:100vw;height:100vh;font:700 ${Math.round(size * 0.58)}px Arial">W</body>`);
      await page.screenshot({ path: path.resolve(__dirname, `../apps/web/public/icon-${size}.png`) });
    }
  } finally { await browser.close(); }
})();
