import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/notifications/config', route => route.fulfill({ json: { success: true, data: { required: false, publicKey: '' } } }));
  await page.goto('/login');
  await page.locator('input[type=email]').fill(process.env.E2E_EMAIL || 'admin@techcorp.vn');
  await page.locator('input[type=password]').fill(process.env.E2E_PASSWORD || 'Admin@123456');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/chat$/);
});

test('manual member assignment, group filters and responsive form', async ({ page }, testInfo) => {
  const self = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const member = { id: 'qa-sang', fullName: 'Nguyễn Văn Sang' };
  const tasks: any[] = [];
  let submitted: any;
  await page.route('**/api/v1/tasks/options', route => route.fulfill({ json: { success: true, data: { canAssignPersonal: true, personalAssignees: [self, member], groups: [{ id: 'room:web', name: 'Web Team', type: 'ROOM', sourceConversationId: 'web', teamId: null, projectId: null, canAssign: true, members: [self, member] }] } } }));
  await page.route('**/api/v1/tasks', async route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      const task = { ...submitted, id: 'qa-task', assignee: member, status: 'TODO', version: 1 };
      tasks.push(task);
      return route.fulfill({ status: 201, json: { success: true, data: task } });
    }
    return route.fulfill({ json: { success: true, data: tasks } });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Hoàn thành nội dung SEO cho Tuấn');
  await dialog.getByLabel('Mô tả', { exact: true }).fill('Rà soát nội dung theo brief đã thống nhất.');
  await dialog.getByLabel('Nhóm phụ trách', { exact: true }).selectOption('room:web');
  await dialog.getByLabel('Người phụ trách', { exact: true }).selectOption(member.id);
  await dialog.getByLabel('Hạn hoàn thành', { exact: true }).fill('2027-01-10T17:00');
  await dialog.getByRole('combobox', { name: 'Ưu tiên', exact: true }).selectOption('HIGH');
  await dialog.getByLabel('Cần duyệt hoàn thành').check();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('manual-assignment.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Lưu công việc' }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toMatchObject({ assigneeId: member.id, sourceConversationId: 'web', priority: 'HIGH', requiresReview: true });
  expect(Number.isNaN(Date.parse(submitted.deadline))).toBe(false);
  await expect(page.getByRole('button', { name: submitted.title })).toBeVisible();
  await page.getByLabel('Lọc nhóm').selectOption('room:web');
  await page.getByLabel('Lọc người phụ trách').selectOption(member.id);
  await expect(page.getByRole('button', { name: submitted.title })).toBeVisible();
  await page.getByLabel('Lọc người phụ trách').selectOption(self.id);
  await expect(page.getByText('Không có công việc phù hợp')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lead assignment stays within a managed group and failures keep the form', async ({ page }) => {
  const self = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const member = { id: 'qa-member', fullName: 'Thành viên nhóm' };
  await page.route('**/api/v1/tasks/options', route => route.fulfill({ json: { success: true, data: { canAssignPersonal: false, personalAssignees: [self], groups: [{ id: 'room:managed', name: 'Nhóm phụ trách', type: 'ROOM', sourceConversationId: 'managed', canAssign: true, members: [self, member] }, { id: 'room:other', name: 'Nhóm chỉ tham gia', type: 'ROOM', sourceConversationId: 'other', canAssign: false, members: [self] }] } } }));
  await page.route('**/api/v1/tasks', route => route.fulfill(route.request().method() === 'POST' ? { status: 403, json: { success: false, error: { message: 'Quyền lead đã thay đổi' } } } : { json: { success: true, data: [] } }));
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Người phụ trách', { exact: true }).locator('option')).toHaveCount(2);
  await expect(dialog.getByLabel('Nhóm phụ trách', { exact: true }).locator('option[value="room:other"]')).toHaveCount(0);
  await dialog.getByLabel('Nhóm phụ trách', { exact: true }).selectOption('room:managed');
  await dialog.getByLabel('Người phụ trách', { exact: true }).selectOption(member.id);
  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Công việc giao thủ công');
  await dialog.getByRole('button', { name: 'Lưu công việc' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Quyền lead đã thay đổi');
  await expect(dialog.getByLabel('Tên công việc', { exact: true })).toHaveValue('Công việc giao thủ công');
});

test('view-only task details do not expose mutation controls', async ({ page }) => {
  await page.route('**/api/v1/tasks/readonly', route => route.fulfill({ json: { success: true, data: { id: 'readonly', title: 'Công việc của thành viên khác', status: 'TODO', priority: 'NORMAL', canEdit: false, checklistItems: [{ id: 'item', title: 'Kiểm tra nội dung', isCompleted: false }] } } }));
  await page.goto('/tasks?task=readonly');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Chỉ xem', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Tên công việc', { exact: true })).toHaveAttribute('readonly', '');
  await expect(dialog.getByRole('button', { name: 'Lưu công việc' })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
});
