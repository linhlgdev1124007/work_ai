// Opt-in real provider smoke test using an isolated installed-Chrome profile.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const webRequire = createRequire(path.resolve(__dirname, '../apps/web/package.json'));
const { chromium } = webRequire('@playwright/test');

async function main() {
  const origin = process.env.E2E_BASE_URL || 'http://localhost:8080';
  const tempRoot = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'workai-push-smoke-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, permissions: ['notifications'] });
  try {
    const login = await context.request.post(origin + '/api/v1/auth/login', { data: { email: process.env.E2E_EMAIL || 'admin@techcorp.vn', password: process.env.E2E_PASSWORD || 'Admin@123456' } });
    if (!login.ok()) throw new Error('Login failed: ' + login.status());
    const page = await context.newPage();
    await page.goto(origin + '/chat');
    try { await page.getByRole('navigation').waitFor({ timeout: 30000 }); }
    catch {
      const diagnostic = await page.evaluate(() => ({ permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission, secure: isSecureContext, error: document.querySelector('.inline-error')?.textContent }));
      throw new Error('Real registration unavailable: ' + JSON.stringify(diagnostic));
    }
    const sent = await context.request.post(origin + '/api/v1/notifications/test');
    const result = await sent.json();
    if (sent.status() !== 202) throw new Error('Test not queued: ' + JSON.stringify(result));
    const id = result.data.id;
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 25000));
    const worker = context.serviceWorkers().find(worker => worker.url() === origin + '/sw.js');
    if (!worker) throw new Error('No active Service Worker available to inspect with the tab closed');
    const tags = await worker.evaluate(async () => (await self.registration.getNotifications()).map(n => n.tag));
    if (!tags.includes(id)) throw new Error('No matching Service Worker notification observed; provider-to-browser delivery is unverified');
    console.log('REAL PUSH: provider-to-Service-Worker notification observed while the site tab remained closed. Native OS toast visibility is NOT verified in headless mode.');
  } finally {
    await context.request.post(origin + '/api/v1/auth/logout').catch(() => {});
    await context.close();
    if (path.dirname(path.resolve(profile)) === tempRoot && path.basename(profile).startsWith('workai-push-smoke-')) fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
