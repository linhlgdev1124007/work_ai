import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/notifications/config', route => route.fulfill({ json: { success: true, data: { required: false, publicKey: '' } } }));
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=email]').fill(process.env.E2E_EMAIL || 'admin@techcorp.vn');
  await page.locator('input[type=password]').fill(process.env.E2E_PASSWORD || 'Admin@123456');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeVisible();
});

for (const route of ['/today', '/tasks', '/team', '/reports', '/attendance', '/admin', '/chat', '/assistant']) {
  test(`renders ${route} with real APIs`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('/api/v1/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).not.toHaveText('Đang tải...');
    await expect(page.locator('main')).not.toBeEmpty();
    if (route === '/chat') await expect(page.getByText('Realtime đang bật')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}.png`), fullPage: true });
  });
}

test('today recovers after API failure without crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/tasks/today', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Server unavailable' } }) }));
  await page.goto('/today');
  await expect(page.locator('main').getByRole('alert')).toContainText('Server unavailable');
  await page.unroute('**/api/v1/tasks/today');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('main h1')).toContainText('Chào');
  expect(errors).toEqual([]);
});

test('expired session redirects to login', async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
});

test('assistant answers statistics from the real database', async ({ page }) => {
  await page.goto('/assistant');
  await page.getByRole('button', { name: 'Thống kê công việc hôm nay' }).click();
  await expect(page.getByText('Số liệu trực tiếp', { exact: false })).toBeVisible();
  await expect(page.locator('.answer-text')).toContainText('Tổng cộng:');
  await expect(page.locator('.source-link').first()).toHaveAttribute('href', '/tasks');
});

test('task filters and create dialog are keyboard accessible', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Tìm công việc' }).fill('no-match-unique-918291');
  await expect(page.getByText('Không có công việc phù hợp')).toBeVisible();
});

test('mobile menu exposes attendance and chat selection works', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile navigation');
  await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
  await page.getByRole('link', { name: 'Chấm công' }).click();
  await expect(page).toHaveURL(/\/attendance$/);
  await page.goto('/chat');
  const selector = page.getByRole('combobox', { name: 'Hội thoại' });
  await expect(selector).toBeVisible();
  await expect(selector.locator('option').first()).toBeAttached();
  const options = await selector.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(0);
  if (options.length > 1) {
    await selector.selectOption({ index: 1 });
    await expect(page.locator('main')).toContainText(options[1]);
  }
});
