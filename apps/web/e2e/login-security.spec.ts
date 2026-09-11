import { test, expect } from '@playwright/test';

test('login cannot submit credentials before JavaScript is ready', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:8080'}/login`);
  await expect(page.locator('input[type=email]')).toBeDisabled();
  await expect(page.locator('input[type=password]')).toBeDisabled();
  await expect(page.locator('button[type=submit]')).toBeDisabled();
  await expect(page.locator('form')).toHaveAttribute('method', 'post');
  expect(new URL(page.url()).search).toBe('');
  await context.close();
});
