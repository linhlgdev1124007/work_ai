import { test, expect } from '@playwright/test';

async function login(page: any) {
  await page.route('**/api/v1/notifications/config', (route: any) => route.fulfill({ json: { success: true, data: { required: false, publicKey: '' } } }));
  await page.goto('/login');
  await page.locator('input[type=email]').fill(process.env.E2E_EMAIL || 'admin@techcorp.vn');
  await page.locator('input[type=password]').fill(process.env.E2E_PASSWORD || 'Admin@123456');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeVisible();
}

test('chat is the default entry and B6 is available in mentions', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('nav a').first()).toHaveAttribute('href', '/chat');
  await page.getByRole('combobox', { name: 'Tag thành viên' }).selectOption('b6');
  await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toHaveValue('@b6 ');
});

test('assistant Markdown and read receipts stay contained', async ({ page }, testInfo) => {
  await login(page);
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  await page.route('**/api/v1/chat/conversations/*/read', route => route.fulfill({ json: { success: true } }));
  await page.route('**/api/v1/chat/conversations/*/messages?*', route => route.fulfill({ json: { success: true, data: { nextCursor: null, receipts: [{ userId: 'reader', fullName: 'Người đọc kiểm thử', messageId: 'message', createdAt: '2026-09-11T00:00:00.000Z' }], messages: [{ id: 'message', senderId: me.id, sender: { fullName: me.fullName }, content: '@b6 tiến độ nhóm thế nào?', createdAt: '2026-09-11T00:00:00.000Z', kind: 'CHAT', assistantReply: '### Tiến độ nhóm\n\n**Đang thực hiện**\n\n| Công việc | Trạng thái |\n| --- | --- |\n| Banner | Đang làm |\n\n```text\n' + 'long-code-'.repeat(35) + '\n```\n\n<script>window.pwned=true</script>\n\n[Không an toàn](javascript:alert(1))' }] } } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tiến độ nhóm' })).toBeVisible();
  await expect(page.getByText('Đã đọc: Người đọc kiểm thử')).toBeVisible();
  await expect(page.locator('.chat-markdown table')).toBeVisible();
  expect(await page.locator('.chat-markdown a').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('chat-markdown.png'), fullPage: true });
});

test('group tasks and lead management are accessible', async ({ page }, testInfo) => {
  await login(page);
  await page.getByRole('button', { name: 'Nhóm và công việc' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Lead nhóm chat' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Gom nhóm công việc' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Gom nhóm công việc' }).selectOption('assignee');
  await page.route('**/api/v1/chat/conversations/*/lead', route => route.fulfill({ json: { success: true, data: { userId: null } } }));
  await page.getByRole('button', { name: 'Lưu lead' }).click();
  await expect(page.getByRole('status')).toContainText('Đã cập nhật lead');
  await page.getByRole('button', { name: 'Phân công mới' }).click();
  await expect(page.getByRole('button', { name: 'Xác nhận tạo việc' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('chat-group.png'), fullPage: true });
});

test('duplicate proposal offers update, separate creation and skip', async ({ page }, testInfo) => {
  await login(page);
  await page.route('**/api/v1/chat/conversations/*/read', route => route.fulfill({ json: { success: true } }));
  await page.route('**/api/v1/chat/conversations/*/messages?*', route => route.fulfill({ json: { success: true, data: { nextCursor: null, receipts: [], messages: [{ id: 'proposal-message', sender: { fullName: 'Lead' }, content: 'Làm hình ảnh chiến dịch nhé', createdAt: new Date().toISOString(), kind: 'TASK_REQUEST', aiActions: [{ id: 'proposal', status: 'PENDING_CONFIRMATION', intent: 'CREATE_TASK', expiresAt: new Date(Date.now() + 86400000).toISOString(), patchPayload: JSON.stringify({ title: 'Hình ảnh chiến dịch', assignee_name: 'Sang', duplicates: [{ id: 'old-task', title: 'Banner launch', status: 'IN_PROGRESS', version: 2 }] }) }] }] } } }));
  await page.reload();
  await expect(page.getByText('Có thể trùng công việc đã nhận')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cập nhật việc này' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo việc riêng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ qua' })).toBeVisible();
  let payload: any;
  await page.route('**/api/v1/ai/actions/proposal/confirm', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 409, json: { success: false, error: { message: 'Phiên bản đã thay đổi' } } }); });
  await page.getByRole('button', { name: 'Cập nhật việc này' }).click();
  await expect(page.getByRole('region', { name: 'Xác nhận thao tác' }).getByRole('alert')).toContainText('Phiên bản đã thay đổi');
  expect(payload.resolution).toMatchObject({ mode: 'update', taskId: 'old-task', expectedVersion: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('chat-duplicate.png'), fullPage: true });
});
