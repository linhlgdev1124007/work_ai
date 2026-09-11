import { test, expect } from '@playwright/test';

async function login(page: any) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(process.env.E2E_EMAIL || 'admin@techcorp.vn');
  await page.locator('input[type=password]').fill(process.env.E2E_PASSWORD || 'Admin@123456');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/chat$/);
}

test('denied permission blocks workspace without blocking logout', async ({ page }, testInfo) => {
  await page.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); Notification.requestPermission = async () => 'denied'; });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Bật thông báo để tiếp tục' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cho phép thông báo' }).click();
  await expect(page.locator('.inline-error[role=alert]')).toContainText('cho phép thông báo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.getByRole('heading', { name: 'Bật thông báo để tiếp tục' }).boundingBox())!.x).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath('notification-gate.png') });
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('granted permission also requires successful device registration', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    const subscription = { options: {}, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/browser-test', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => true };
    const registration = { pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration } });
  });
  let succeed = false;
  await page.route('**/api/v1/notifications/subscriptions', route => route.fulfill({ status: succeed ? 200 : 503, json: succeed ? { success: true } : { success: false, error: { message: 'Push registration unavailable' } } }));
  await login(page);
  await expect(page.locator('.inline-error[role=alert]')).toContainText('Push registration unavailable');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  succeed = true;
  await page.getByRole('button', { name: 'Kiểm tra lại' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Thông báo' })).toBeVisible();
});

test('chat remains one automatic composer with member mention control', async ({ page }) => {
  await page.route('**/api/v1/notifications/config', route => route.fulfill({ json: { success: true, data: { required: false, publicKey: '' } } }));
  await login(page);
  await page.goto('/chat');
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phân công', exact: true })).toHaveCount(0);
  const select = page.getByRole('combobox', { name: 'Tag thành viên' });
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  if (options.length > 1) {
    await select.selectOption({ index: 1 });
    await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toHaveValue('@' + options[1] + ' ');
  }
});

test('Mac notification guidance distinguishes Safari from iOS installation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 Version/16.1 Safari/605.1.15' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
  });
  await login(page);
  await expect(page.locator('.inline-error[role=alert]')).toContainText('macOS Ventura');
  await expect(page.locator('.inline-error[role=alert]')).toContainText('System Settings');
  await expect(page.locator('.inline-error[role=alert]')).not.toContainText('iPhone');
});

test('Windows guidance covers system permission and do not disturb', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
  });
  await login(page);
  await expect(page.locator('.inline-error')).toContainText('Settings > System > Notifications');
  await expect(page.locator('.inline-error')).toContainText('Do not disturb');
});

test('online recovery repairs a lost subscription and test push reports queued only', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    const subscription = { options: {}, toJSON: () => ({ endpoint: 'https://web.push.apple.com/browser-test', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => true };
    const registration = { pushManager: { getSubscription: async () => (window as any).lostSubscription ? null : subscription, subscribe: async () => { (window as any).repairs = ((window as any).repairs || 0) + 1; (window as any).lostSubscription = false; return subscription; } } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration } });
  });
  await page.route('**/api/v1/notifications/subscriptions', route => route.fulfill({ json: { success: true } }));
  await page.route('**/api/v1/notifications/test', route => route.fulfill({ status: 202, json: { success: true, data: { id: 'queued-test' } } }));
  await login(page);
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => { (window as any).lostSubscription = true; window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => (window as any).repairs)).toBe(1);
  await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
  await page.getByRole('button', { name: 'Gửi thông báo thử' }).click();
  await expect(page.getByRole('dialog').locator('p[role=status]')).toContainText('Đã xếp hàng gửi');
  await expect(page.getByRole('dialog').locator('p[role=status]')).toContainText('chưa xác nhận thiết bị đã nhận');
});
