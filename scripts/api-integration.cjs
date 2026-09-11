const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const path = require('node:path');
const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const bcrypt = apiRequire('bcryptjs');
const webRequire = createRequire(path.resolve(__dirname, '../apps/web/package.json'));
const { io } = webRequire('socket.io-client');
const sockets = [];
const db = new PrismaClient();
const base = 'http://127.0.0.1:3001/api/v1';
const password = 'Integration@123456';
const organizations = [];
let checks = 0;
let server;

async function request(route, token, method = 'GET', body) {
  const response = await fetch(base + route, {
    method, signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  assert(!JSON.stringify(data).match(/"(passwordHash|tokenHash)"/), `Secret leaked: ${route}`);
  return { status: response.status, data: data.data, body: data, headers: response.headers };
}
async function expectStatus(route, token, method, body, status) {
  const result = await request(route, token, method, body);
  assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.body)}`);
  checks++;
  return result.data;
}
async function login(user) {
  const result = await request('/auth/login', null, 'POST', { email: user.email, password });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  checks++;
  return result.data.token;
}
async function connect(token) {
  const socket = io('http://127.0.0.1:3001', { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
async function join(socket, id) {
  return new Promise((resolve, reject) => socket.timeout(5000).emit('join_conversation', id, (error, ack) => error ? reject(error) : resolve(ack)));
}
async function fixture(label) {
  const org = await db.organization.create({ data: { code: `qa-${randomUUID()}`, name: label } });
  organizations.push(org.id);
  const hash = await bcrypt.hash(password, 10);
  async function user(role) {
    return db.user.create({ data: { orgId: org.id, email: `${randomUUID()}@example.test`, fullName: role, systemRole: role === 'ADMIN' ? 'ADMIN' : 'MEMBER', passwordHash: hash } });
  }
  const admin = await user('ADMIN'), member = await user('MEMBER'), outsider = await user('OUTSIDER');
  const team = await db.team.create({ data: { orgId: org.id, name: 'QA team', members: { create: [{ userId: admin.id, role: 'LEAD' }, { userId: member.id }] } } });
  const project = await db.project.create({ data: { orgId: org.id, teamId: team.id, name: 'QA project', code: 'QA', members: { create: { userId: member.id } } } });
  const conversation = await db.conversation.create({ data: { orgId: org.id, name: 'QA chat', type: 'GROUP', members: { create: [{ userId: admin.id }, { userId: member.id }] } } });
  const task = await db.task.create({ data: { orgId: org.id, creatorId: admin.id, title: 'QA private task' } });
  return { org, admin, member, outsider, team, project, conversation, task };
}

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/work_ai_test', 'Use the isolated test database');
  server = spawn(process.execPath, ['apps/api/dist/main.js'], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, AI_ENABLED: 'false', PUSH_ENABLED: 'false', REDIS_URL: '' } });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch('http://127.0.0.1:3001/readyz')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'API failed to start');
  const a = await fixture('QA A'), b = await fixture('QA B');
  const admin = await login(a.admin), member = await login(a.member), outsider = await login(a.outsider), otherAdmin = await login(b.admin);
  await expectStatus('/ai/query', null, 'POST', { question: 'Thống kê công việc' }, 401);
  const adminStats = await expectStatus('/ai/query', admin, 'POST', { question: 'Thống kê công việc' }, 200);
  assert.equal(adminStats.mode, 'database');
  assert(adminStats.answer.includes('Tổng cộng: 1'), 'AI statistics leaked another tenant');
  const memberStats = await expectStatus('/ai/query', member, 'POST', { question: 'Thống kê công việc' }, 200);
  assert(memberStats.answer.includes('Tổng cộng: 0'), 'AI statistics leaked a private task');
  checks += 3;

  for (const route of ['/auth/me', '/auth/me/bootstrap', '/tasks', '/tasks/today', '/attendance/current', '/attendance/history', '/current-work/me', '/current-work/who-is-doing-what', '/reports/summary', '/search?q=QA', '/chat/conversations', '/admin/overview']) {
    await expectStatus(route, null, 'GET', undefined, 401);
    await expectStatus(route, admin, 'GET', undefined, 200);
    if (!route.startsWith('/admin')) await expectStatus(route, member, 'GET', undefined, 200);
  }
  await expectStatus('/auth/login', null, 'POST', { email: a.admin.email, password: 'incorrect-password' }, 401);
  for (const body of [{}, { email: 'bad', password }, { email: a.admin.email, password: {} }]) await expectStatus('/auth/login', null, 'POST', body, 400);
  await expectStatus('/auth/me', 'not-a-token', 'GET', undefined, 401);
  await expectStatus('/not-found', admin, 'GET', undefined, 404);
  const malformed = await fetch(base + '/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).success, false); checks++;

  await expectStatus('/admin/overview', member, 'GET', undefined, 403);
  for (const body of [{ email: 'wrong', fullName: 'Name' }, { email: 'valid@example.test', fullName: '  ' }, { email: 'valid@example.test', fullName: 'Name', systemRole: 'ROOT' }]) await expectStatus('/admin/users', admin, 'POST', body, 400);
  await expectStatus(`/admin/users/${a.member.id}/status`, admin, 'PATCH', { status: 'wrong' }, 400);
  await expectStatus(`/admin/users/${a.admin.id}/status`, admin, 'PATCH', { status: 'SUSPENDED' }, 400);
  await expectStatus(`/admin/teams/${a.team.id}/members/${a.member.id}`, admin, 'PUT', { role: 'ROOT' }, 400);
  await expectStatus('/admin/teams', admin, 'POST', { name: '  ' }, 400);
  await expectStatus('/admin/projects', admin, 'POST', { name: 'Cross tenant', code: 'BAD', teamId: b.team.id }, 400);

  const userResult = await expectStatus('/admin/users', admin, 'POST', { email: `${randomUUID()}@example.test`, fullName: 'New hire', password }, 201);
  const newUserToken = await login(userResult.user);
  await expectStatus('/tasks', newUserToken, 'GET', undefined, 403);
  await expectStatus('/auth/change-password', newUserToken, 'POST', { currentPassword: 'wrong-password', newPassword: 'Changed@123456' }, 400);
  await expectStatus('/auth/change-password', newUserToken, 'POST', { currentPassword: password, newPassword: 'Changed@123456' }, 200);
  await expectStatus('/auth/me', newUserToken, 'GET', undefined, 401);
  await expectStatus('/auth/login', null, 'POST', { email: userResult.user.email, password: 'Changed@123456' }, 200);

  for (const body of [{}, { title: '   ' }, { title: 'Bad', status: 'WRONG' }, { title: 'Bad', deadline: 'tomorrow' }, { title: 'Bad', estimateMinutes: -1 }]) await expectStatus('/tasks', admin, 'POST', body, 400);
  for (const field of ['assigneeId', 'teamId', 'projectId', 'parentId', 'sourceConversationId']) {
    const id = { assigneeId: b.member.id, teamId: b.team.id, projectId: b.project.id, parentId: b.task.id, sourceConversationId: b.conversation.id }[field];
    await expectStatus('/tasks', admin, 'POST', { title: 'Cross tenant', [field]: id }, 403);
  }
  await expectStatus(`/tasks/${b.task.id}`, admin, 'GET', undefined, 403);
  await expectStatus(`/tasks/${a.task.id}`, outsider, 'GET', undefined, 403);
  await expectStatus(`/tasks/${b.task.id}`, admin, 'PATCH', { title: 'Unauthorized' }, 403);
  await expectStatus('/tasks', member, 'POST', { title: 'Assign other', assigneeId: a.outsider.id }, 403);
  const task = await expectStatus('/tasks', admin, 'POST', { title: 'API lifecycle', teamId: a.team.id, assigneeId: a.member.id, requiresReview: true }, 201);
  await expectStatus(`/tasks/${task.id}`, member, 'GET', undefined, 200);
  await expectStatus(`/tasks/${task.id}`, member, 'PATCH', { status: 'COMPLETED' }, 403);
  await expectStatus(`/tasks/${task.id}`, member, 'PATCH', { requiresReview: false }, 403);
  await expectStatus(`/tasks/${task.id}`, member, 'PATCH', { deadline: '2030-01-01T00:00:00Z' }, 403);
  await expectStatus(`/tasks/${task.id}`, admin, 'PATCH', { assigneeId: b.member.id }, 403);
  const item = await expectStatus(`/tasks/${task.id}/checklist`, member, 'POST', { title: 'Verify' }, 201);
  for (const title of [' ', 123, {}]) await expectStatus(`/tasks/${task.id}/checklist`, member, 'POST', { title }, 400);
  await expectStatus(`/tasks/checklist/${item.id}/toggle`, member, 'PATCH', { isCompleted: 'false' }, 400);
  await expectStatus(`/tasks/${task.id}`, admin, 'PATCH', { status: 'COMPLETED' }, 400);
  await expectStatus(`/tasks/checklist/${item.id}/toggle`, member, 'PATCH', { isCompleted: true }, 200);
  const completed = await expectStatus(`/tasks/${task.id}`, admin, 'PATCH', { status: 'COMPLETED', estimateMinutes: 30, deadline: '2030-01-01T00:00:00Z' }, 200);
  assert(completed.completedAt); assert.equal(completed.estimateMinutes, 30);
  assert.equal(completed.completionDeadline, '2030-01-01T00:00:00.000Z');
  const reopened = await expectStatus(`/tasks/${task.id}`, admin, 'PATCH', { status: 'TODO', requiresReview: false }, 200);
  assert.equal(reopened.completedAt, null); assert.equal(reopened.requiresReview, false);
  const racing = await Promise.all(Array.from({ length: 5 }, (_, i) => request(`/tasks/${task.id}`, admin, 'PATCH', { title: `Race ${i}`, expectedVersion: reopened.version })));
  assert.equal(racing.filter(r => r.status === 200).length, 1, 'Exactly one optimistic update must succeed'); checks++;
  const dependency = await expectStatus('/tasks', admin, 'POST', { title: 'Dependency' }, 201);
  await expectStatus(`/tasks/${task.id}/dependencies`, admin, 'POST', { dependsOnTaskId: dependency.id }, 201);
  await expectStatus(`/tasks/${dependency.id}/dependencies`, admin, 'POST', { dependsOnTaskId: task.id }, 400);
  await expectStatus(`/tasks/${task.id}/dependencies`, admin, 'POST', { dependsOnTaskId: task.id }, 400);
  await expectStatus(`/tasks/${task.id}`, admin, 'PATCH', { status: 'COMPLETED' }, 400);

  await expectStatus('/current-work/me', member, 'POST', { taskId: b.task.id }, 403);
  await expectStatus('/current-work/me', member, 'POST', { taskId: task.id }, 200);
  await expectStatus('/attendance/out', member, 'POST', {}, 400);
  const checkIns = await Promise.all(Array.from({ length: 8 }, () => request('/attendance/in', member, 'POST', {})));
  assert.equal(checkIns.filter(r => r.status === 200).length, 1, 'Only one OPEN session');
  assert.equal(await db.attendanceSession.count({ where: { userId: a.member.id, status: 'OPEN' } }), 1); checks++;
  await expectStatus('/attendance/in', member, 'POST', {}, 400);
  await expectStatus('/attendance/out', member, 'POST', {}, 200);
  assert.equal(await expectStatus('/current-work/me', member, 'GET', undefined, 200), null);
  const adjustmentBody = { requestedCheckIn: '2025-01-01T08:00:00Z', requestedCheckOut: '2025-01-01T12:00:00Z', reason: 'Missing attendance record' };
  const otherSession = await db.attendanceSession.create({ data: { orgId: b.org.id, userId: b.member.id, status: 'CLOSED', checkOutTime: new Date() } });
  await expectStatus('/attendance/adjustments', member, 'POST', { ...adjustmentBody, sessionId: otherSession.id }, 400);
  const adj = await expectStatus('/attendance/adjustments', member, 'POST', adjustmentBody, 201);
  await expectStatus(`/attendance/adjustments/${adj.id}/review`, otherAdmin, 'POST', { isApproved: true }, 403);
  await expectStatus(`/attendance/adjustments/${adj.id}/review`, outsider, 'POST', { isApproved: true }, 403);
  await expectStatus(`/attendance/adjustments/${adj.id}/review`, admin, 'POST', { isApproved: 'false' }, 400);
  const approvals = await Promise.all(Array.from({ length: 4 }, () => request(`/attendance/adjustments/${adj.id}/review`, admin, 'POST', { isApproved: true })));
  assert.equal(approvals.filter(r => r.status === 200).length, 1); checks++;
  const overlap = await expectStatus('/attendance/adjustments', member, 'POST', adjustmentBody, 201);
  await expectStatus(`/attendance/adjustments/${overlap.id}/review`, admin, 'POST', { isApproved: true }, 400);
  const self = await expectStatus('/attendance/adjustments', admin, 'POST', adjustmentBody, 201);
  await expectStatus(`/attendance/adjustments/${self.id}/review`, admin, 'POST', { isApproved: true }, 400);

  const conv = a.conversation.id;
  await expectStatus(`/chat/conversations/${conv}/messages`, outsider, 'GET', undefined, 403);
  await expectStatus(`/chat/conversations/${b.conversation.id}/messages`, admin, 'GET', undefined, 403);
  for (const limit of ['NaN', '-1', '0', '101']) await expectStatus(`/chat/conversations/${conv}/messages?limit=${limit}`, member, 'GET', undefined, 400);
  await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: ' ', clientMessageId: randomUUID() }, 400);
  const messageBody = { conversationId: conv, content: 'Integration message', clientMessageId: randomUUID() };
  const messages = await Promise.all(Array.from({ length: 5 }, () => request('/chat/messages', member, 'POST', messageBody)));
  assert(messages.every(r => r.status === 201)); assert.equal(new Set(messages.map(r => r.data.id)).size, 1);
  assert.equal((await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: conv, userId: a.admin.id } } })).unreadCount, 1); checks++;
  await expectStatus('/chat/messages', admin, 'POST', messageBody, 400);
  const foreignMessage = await db.message.create({ data: { conversationId: b.conversation.id, senderId: b.admin.id, content: 'Private', clientMessageId: randomUUID() } });
  await expectStatus('/chat/messages', member, 'POST', { ...messageBody, clientMessageId: randomUUID(), replyToId: foreignMessage.id }, 400);
  await expectStatus(`/chat/conversations/${conv}/read`, member, 'POST', { messageId: foreignMessage.id }, 400);
  await expectStatus(`/chat/conversations/${conv}/read`, admin, 'POST', { messageId: messages[0].data.id }, 200);
  await expectStatus(`/chat/conversations/${conv}/messages?limit=1`, member, 'GET', undefined, 200);
  assert.equal(await db.notification.count({ where: { eventKey: `message:${messages[0].data.id}:${a.admin.id}` } }), 1); checks++;
  const mention = await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: '@ADMIN trưa nay ăn gì haha?', mentionIds: [a.admin.id], clientMessageId: randomUUID() }, 201);
  const mentionNotice = await db.notification.findUnique({ where: { eventKey: `message:${mention.id}:${a.admin.id}` } });
  assert.equal(mentionNotice.type, 'MENTION'); checks++;
  const emojiContent = 'x'.repeat(239) + String.fromCodePoint(0x1f600);
  const emojiMessage = await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: emojiContent, clientMessageId: randomUUID() }, 201);
  assert.equal((await db.notification.findUnique({ where: { eventKey: `message:${emojiMessage.id}:${a.admin.id}` } })).body, emojiContent); checks++;
  await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: '@OUTSIDER hello', mentionIds: [a.outsider.id], clientMessageId: randomUUID() }, 400);
  await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: '@MEMBER hello', mentionIds: [b.member.id], clientMessageId: randomUUID() }, 400);
  const notices = await expectStatus('/notifications', admin, 'GET', undefined, 200);
  assert(notices.some(n => n.id === mentionNotice.id && n.href === `/chat?conversation=${conv}`)); checks++;
  await expectStatus(`/notifications/${mentionNotice.id}/read`, otherAdmin, 'PATCH', {}, 404);
  await expectStatus(`/notifications/${mentionNotice.id}/read`, admin, 'PATCH', {}, 200);
  await expectStatus('/notifications/config', null, 'GET', undefined, 401);
  await expectStatus('/notifications/test', null, 'POST', {}, 401);
  await expectStatus('/notifications/test', admin, 'POST', {}, 503);
  const pushConfig = await expectStatus('/notifications/config', admin, 'GET', undefined, 200);
  assert(pushConfig.publicKey && !pushConfig.privateKey); checks++;
  const ecdh = require('node:crypto').createECDH('prime256v1'); ecdh.generateKeys();
  const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') } };
  await expectStatus('/notifications/subscriptions', admin, 'POST', { ...subscription, endpoint: 'https://127.0.0.1/private' }, 400);
  await expectStatus('/notifications/subscriptions', admin, 'POST', subscription, 200);
  await expectStatus('/notifications/subscriptions', member, 'POST', subscription, 409);
  await expectStatus('/notifications/subscriptions', member, 'DELETE', { endpoint: subscription.endpoint }, 200);
  assert.equal(await db.pushSubscription.count({ where: { endpoint: subscription.endpoint } }), 1); checks++;
  await expectStatus('/notifications/subscriptions', admin, 'DELETE', { endpoint: subscription.endpoint }, 200);
  const { remindersService } = require('../apps/api/dist/modules/reminders/reminders.service');
  const due = await db.task.create({ data: { orgId: a.org.id, creatorId: a.admin.id, assigneeId: a.member.id, title: 'Push due soon', deadline: new Date(Date.now() + 3600000) } });
  await remindersService.scanAndSendReminders(); await remindersService.scanAndSendReminders();
  assert.equal(await db.notification.count({ where: { entityId: due.id, type: 'TASK_DUE_SOON' } }), 1); checks++;
  await db.task.update({ where: { id: due.id }, data: { title: 'Renamed without deadline change', version: { increment: 1 } } });
  await remindersService.scanAndSendReminders();
  assert.equal(await db.notification.count({ where: { entityId: due.id, type: 'TASK_DUE_SOON' } }), 1); checks++;
  await db.task.update({ where: { id: due.id }, data: { deadline: new Date(Date.now() - 60000) } });
  await remindersService.scanAndSendReminders(); await remindersService.scanAndSendReminders();
  assert.equal(await db.notification.count({ where: { entityId: due.id, type: 'TASK_OVERDUE' } }), 1); checks++;
  const memberNotices = await expectStatus('/notifications', member, 'GET', undefined, 200);
  assert(!memberNotices.some(n => n.type === 'TASK_DUE_SOON' && n.href.includes(due.id))); checks++;
  const { aiService } = require('../apps/api/dist/modules/ai/ai.service');
  const originalCall = aiService.callVertexGemini;
  aiService.callVertexGemini = async () => JSON.stringify({ is_work_instruction: false, intent: 'NONE', confidence: 0.99, data: {} });
  const social = await aiService.processIncomingMessage(mention.id, conv, a.member.id, mention.content, a.org.id);
  assert.equal(social.aiAction, null); assert.equal(social.kind, 'CHAT'); checks += 2;
  const assignment = await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: 'ADMIN làm banner trước 17h mai nhé', clientMessageId: randomUUID() }, 201);
  aiService.callVertexGemini = async () => JSON.stringify({ is_work_instruction: true, intent: 'CREATE_TASK', confidence: 0.98, data: { title: 'Làm banner', assignee_name: 'ADMIN' } });
  const classifiedProposal = await aiService.processIncomingMessage(assignment.id, conv, a.member.id, assignment.content, a.org.id);
  assert.equal(classifiedProposal.aiAction.status, 'PENDING_CONFIRMATION'); assert.equal(classifiedProposal.executedTask, null); checks += 2;
  await aiService.processIncomingMessage(assignment.id, conv, a.member.id, assignment.content, a.org.id);
  assert.equal(await db.aiAction.count({ where: { sourceMessageId: assignment.id } }), 1); checks++;
  await db.user.update({ where: { id: a.admin.id }, data: { fullName: 'Nguyễn Văn Sang' } });
  const seo = await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: '@Nguyễn Văn Sang mai done task SEO cho Tuấn nhe', clientMessageId: randomUUID() }, 201);
  const sentAt = new Date('2026-09-11T09:21:02.088Z');
  await db.message.update({ where: { id: seo.id }, data: { createdAt: sentAt } });
  aiService.callVertexGemini = async prompt => {
    if (JSON.parse(prompt).extracted) {
      assert.equal(JSON.parse(prompt).extracted.title, 'SEO cho Tuấn'); checks++;
      return JSON.stringify({ title: 'Hoàn thành công việc SEO cho Tuấn' });
    }
    assert.equal(JSON.parse(prompt).now, sentAt.toISOString()); checks++;
    return JSON.stringify({ is_work_instruction: true, intent: 'CREATE_TASK', confidence: .98, data: { title: 'SEO cho Tuấn', assignee_name: 'Nguyễn Văn Sang', deadline_iso: '2026-09-12T23:59:59+07:00' } });
  };
  const seoResult = await aiService.processIncomingMessage(seo.id, conv, a.member.id, seo.content, a.org.id);
  const seoPayload = JSON.parse(seoResult.aiAction.patchPayload);
  assert.equal(seoResult.kind, 'TASK_REQUEST');
  assert.equal(seoResult.aiAction.intent, 'CREATE_TASK');
  assert.equal(seoResult.aiAction.status, 'PENDING_CONFIRMATION');
  assert.equal(seoPayload.assignee_id, a.admin.id);
  assert.equal(seoPayload.deadline_iso, '2026-09-12T23:59:59+07:00');
  assert.equal(seoResult.executedTask, null); checks += 6;
  assert.equal(seoPayload.title, 'Hoàn thành công việc SEO cho Tuấn');
  assert.equal(seoPayload.extracted_title, 'SEO cho Tuấn');
  assert.equal(seoPayload.title_refinement_status, 'REFINED'); checks += 3;
  await db.user.update({ where: { id: a.admin.id }, data: { fullName: 'ADMIN' } });
  aiService.callVertexGemini = async () => { throw new Error('Provider unavailable'); };
  const failedClassification = await aiService.processIncomingMessage(messages[0].data.id, conv, a.member.id, messageBody.content, a.org.id);
  assert.equal(failedClassification.kind, 'UNCLASSIFIED'); assert.equal(failedClassification.aiAction, null); checks += 2;
  aiService.callVertexGemini = originalCall;
  for (const question of ['', {}, ' '.repeat(10)]) await expectStatus('/ai/query', member, 'POST', { question }, 400);
  for (const command of ['confirm', 'cancel', 'undo']) await expectStatus(`/ai/actions/missing/${command}`, member, 'POST', {}, 400);
  await expectStatus('/ai/actions/missing', member, 'GET', undefined, 404);
  await db.task.createMany({ data: Array.from({ length: 70 }, (_, i) => ({ orgId: a.org.id, creatorId: a.admin.id, title: `Filler ${i}` })) });
  const searchable = await db.task.create({ data: { orgId: a.org.id, creatorId: a.admin.id, title: 'Kiểm tra tìm kiếm đặc biệt' } });
  const search = await expectStatus('/search?q=kiem%20tra%20tim%20kiem', admin, 'GET', undefined, 200);
  assert(search.tasks.some(task => task.id === searchable.id), 'Search misses tasks beyond first 50'); checks++;
  await db.task.create({ data: { orgId: a.org.id, creatorId: a.admin.id, title: '=HYPERLINK("unsafe")' } });
  for (const report of ['tasks', 'attendance']) {
    await expectStatus(`/reports/export/${report}`, member, 'GET', undefined, 403);
    const csv = await fetch(base + `/reports/export/${report}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
    const content = await csv.text();
    if (report === 'tasks') assert(content.includes("'=HYPERLINK"), 'Spreadsheet formulas must be escaped');
    checks++;
  }

  const run = await db.aiRun.create({ data: { orgId: a.org.id, conversationId: conv, triggerMessageId: messages[0].data.id, modelName: 'test-fixture', status: 'SUCCESS' } });
  async function action(intent, payload, extra = {}) {
    return db.aiAction.create({ data: { orgId: a.org.id, conversationId: conv, sourceMessageId: messages[0].data.id, aiRunId: run.id, initiatorId: a.member.id, intent, targetEntityType: 'TASK', patchPayload: JSON.stringify(payload), evidenceText: 'Test fixture', confidence: 1, expiresAt: new Date(Date.now() + 86400000), ...extra } });
  }
  const proposal = await action('CREATE_TASK', { title: 'Confirmed once', assignee_id: a.member.id });
  await expectStatus(`/ai/actions/${proposal.id}`, otherAdmin, 'GET', undefined, 403);
  await expectStatus(`/ai/actions/${proposal.id}/confirm`, otherAdmin, 'POST', {}, 403);
  const confirmations = await Promise.all(Array.from({ length: 4 }, () => request(`/ai/actions/${proposal.id}/confirm`, admin, 'POST', {})));
  assert.equal(confirmations.filter(r => r.status === 200).length, 1);
  assert.equal(await db.task.count({ where: { orgId: a.org.id, title: 'Confirmed once' } }), 1); checks++;
  const target = confirmations.find(r => r.status === 200).data.task;
  await expectStatus(`/ai/actions/${proposal.id}/cancel`, admin, 'POST', {}, 409);
  await expectStatus(`/ai/actions/${proposal.id}/undo`, otherAdmin, 'POST', {}, 403);
  await expectStatus(`/ai/actions/${proposal.id}/undo`, admin, 'POST', {}, 200);
  assert.equal((await db.task.findUnique({ where: { id: target.id } })).isArchived, true);
  await expectStatus(`/ai/actions/${proposal.id}/undo`, admin, 'POST', {}, 400);
  const current = await db.task.findUnique({ where: { id: task.id } });
  const statusAction = await action('UPDATE_STATUS', { status: 'WAITING' }, { targetEntityId: task.id, expectedVersion: current.version });
  await expectStatus(`/ai/actions/${statusAction.id}/confirm`, admin, 'POST', {}, 400);
  await db.task.update({ where: { id: task.id }, data: { sourceConversationId: conv } });
  await expectStatus(`/ai/actions/${statusAction.id}/confirm`, admin, 'POST', {}, 200);
  assert.equal((await db.task.findUnique({ where: { id: task.id } })).status, 'WAITING');
  await expectStatus(`/ai/actions/${statusAction.id}/undo`, admin, 'POST', {}, 400);
  const workAction = await action('SET_CURRENT_WORK', { current_work_text: 'Preparing report' });
  await expectStatus(`/ai/actions/${workAction.id}/confirm`, member, 'POST', {}, 200);
  assert.equal((await expectStatus('/current-work/me', member, 'GET', undefined, 200)).customStatusText, 'Preparing report');
  const expired = await action('CREATE_TASK', { title: 'Expired' }, { expiresAt: new Date(0) });
  await expectStatus(`/ai/actions/${expired.id}/confirm`, admin, 'POST', {}, 400);
  const cancelled = await action('CREATE_TASK', { title: 'Cancelled' });
  await expectStatus(`/ai/actions/${cancelled.id}/cancel`, admin, 'POST', {}, 200);
  await expectStatus(`/ai/actions/${cancelled.id}/confirm`, admin, 'POST', {}, 400);

  const socket = await connect(admin);
  assert.equal((await join(socket, conv)).success, true); checks++;
  assert.equal((await join(socket, b.conversation.id)).success, false); checks++;
  const guestSocket = await connect(outsider);
  assert.equal((await join(guestSocket, conv)).success, false); checks++;
  socket.emit('typing', null);
  const incoming = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Realtime message missing')), 5000); socket.once('message.created', value => { clearTimeout(timer); resolve(value); }); });
  await expectStatus('/chat/messages', member, 'POST', { conversationId: conv, content: 'Realtime verified', clientMessageId: randomUUID() }, 201);
  const event = await incoming;
  assert.equal(event.content, 'Realtime verified'); assert(!JSON.stringify(event).includes('passwordHash')); checks++;
  const socketToken = await login(a.outsider);
  // Chat workspace: real authorization, receipts, group counts and AI confirmation.
  await expectStatus(`/chat/conversations/${conv}/lead`, member, 'PATCH', { userId: a.member.id }, 403);
  await expectStatus(`/chat/conversations/${conv}/lead`, otherAdmin, 'PATCH', { userId: a.member.id }, 403);
  await expectStatus(`/chat/conversations/${conv}/lead`, admin, 'PATCH', { userId: a.outsider.id }, 400);
  await expectStatus(`/chat/conversations/${conv}/lead`, admin, 'PATCH', { userId: a.member.id }, 200);
  await expectStatus('/tasks/options', null, 'GET', undefined, 401);
  const leadOptions = await expectStatus('/tasks/options', member, 'GET', undefined, 200);
  assert(leadOptions.groups.find(group => group.sourceConversationId === conv)?.canAssign);
  assert(!leadOptions.groups.some(group => group.sourceConversationId === b.conversation.id));
  assert.deepEqual(leadOptions.personalAssignees.map(person => person.id), [a.member.id]); checks += 3;
  const adminOptions = await expectStatus('/tasks/options', admin, 'GET', undefined, 200);
  assert(adminOptions.personalAssignees.some(person => person.id === a.outsider.id));
  assert(!adminOptions.personalAssignees.some(person => person.id === b.member.id)); checks += 2;
  const privateManual = await expectStatus('/tasks', admin, 'POST', { title: 'Manual individual assignment', description: 'Specific brief', assigneeId: a.outsider.id, deadline: '2027-01-01T10:00:00.000Z', priority: 'HIGH' }, 201);
  await expectStatus(`/tasks/${privateManual.id}`, outsider, 'GET', undefined, 200);
  await expectStatus(`/tasks/${privateManual.id}`, member, 'GET', undefined, 403);
  await expectStatus(`/tasks/${privateManual.id}`, otherAdmin, 'GET', undefined, 403);
  assert.equal(await db.notification.count({ where: { entityId: privateManual.id, userId: a.outsider.id, type: 'TASK_ASSIGNED' } }), 1); checks++;
  await db.teamMember.update({ where: { teamId_userId: { teamId: a.team.id, userId: a.member.id } }, data: { role: 'LEAD' } });
  await expectStatus('/tasks', member, 'POST', { title: 'Forbidden team assignment', teamId: a.team.id, assigneeId: a.outsider.id }, 403);
  const teamManual = await expectStatus('/tasks', member, 'POST', { title: 'Manual team assignment', teamId: a.team.id, assigneeId: a.admin.id }, 201);
  await expectStatus(`/tasks/${teamManual.id}`, member, 'PATCH', { assigneeId: a.outsider.id }, 403);
  const leadTaskView = await expectStatus(`/tasks/${teamManual.id}`, member, 'GET', undefined, 200);
  assert.equal(leadTaskView.canEdit, true); checks++;
  await db.teamMember.update({ where: { teamId_userId: { teamId: a.team.id, userId: a.member.id } }, data: { role: 'MEMBER' } });
  const readableTeamTask = await expectStatus('/tasks', admin, 'POST', { title: 'Team readable task', teamId: a.team.id, assigneeId: a.admin.id }, 201);
  const readOnlyTask = await expectStatus(`/tasks/${readableTeamTask.id}`, member, 'GET', undefined, 200);
  assert.equal(readOnlyTask.canEdit, false); checks++;
  const groupTask = await expectStatus('/tasks', member, 'POST', { title: 'Banner launch campaign', sourceConversationId: conv, assigneeId: a.admin.id }, 201);
  await expectStatus('/tasks', member, 'POST', { title: 'Outside room', sourceConversationId: conv, assigneeId: a.outsider.id }, 403);
  await expectStatus(`/chat/conversations/${conv}/tasks`, outsider, 'GET', undefined, 403);
  await expectStatus(`/chat/conversations/${conv}/tasks`, otherAdmin, 'GET', undefined, 403);
  const groupStats = await expectStatus(`/chat/conversations/${conv}/tasks`, member, 'GET', undefined, 200);
  assert(groupStats.tasks.some(t => t.id === groupTask.id)); assert.equal(groupStats.total, groupStats.counts.reduce((n, c) => n + c._count, 0)); checks += 2;
  const summary = await expectStatus('/reports/summary', member, 'GET', undefined, 200);
  assert(summary.byConversation.some(r => r.id === conv)); assert(!summary.byConversation.some(r => r.id === b.conversation.id)); checks += 2;
  const oldRead = await expectStatus('/chat/messages', admin, 'POST', { conversationId: conv, content: 'Read first', clientMessageId: randomUUID() }, 201);
  await new Promise(resolve => setTimeout(resolve, 5));
  const newRead = await expectStatus('/chat/messages', admin, 'POST', { conversationId: conv, content: 'Read second', clientMessageId: randomUUID() }, 201);
  const receiptEvent = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Read receipt missing')), 5000); socket.once('conversation.read', data => { clearTimeout(timer); resolve(data); }); });
  await expectStatus(`/chat/conversations/${conv}/read`, member, 'POST', { messageId: oldRead.id }, 200);
  assert.equal((await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: conv, userId: a.member.id } } })).unreadCount, 1); checks++;
  assert((await receiptEvent).receipts.some(r => r.userId === a.member.id)); checks++;
  await expectStatus(`/chat/conversations/${conv}/read`, member, 'POST', { messageId: newRead.id }, 200);
  await expectStatus(`/chat/conversations/${conv}/read`, member, 'POST', { messageId: oldRead.id }, 200);
  const marker = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: conv, userId: a.member.id } } });
  assert.equal(marker.lastReadMessageId, newRead.id); assert.equal(marker.unreadCount, 0); checks += 2;
  const readMessages = await expectStatus(`/chat/conversations/${conv}/messages`, admin, 'GET', undefined, 200);
  assert(readMessages.receipts.some(r => r.userId === a.member.id && r.messageId === newRead.id)); checks++;
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => request('/chat/messages', admin, 'POST', { conversationId: conv, content: `Concurrent receipt ${i}`, clientMessageId: randomUUID() })));
  assert(burst.every(r => r.status === 201)); assert.equal(new Set(burst.map(r => r.data.createdAt)).size, 8); checks += 2;
  const lastBurst = burst.map(r => r.data).sort((x, y) => x.createdAt.localeCompare(y.createdAt)).at(-1);
  await expectStatus(`/chat/conversations/${conv}/read`, member, 'POST', { messageId: lastBurst.id }, 200);
  assert.equal((await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: conv, userId: a.member.id } } })).unreadCount, 0); checks++;

  const duplicate = await action('CREATE_TASK', { title: 'Launch artwork', assignee_id: a.admin.id, duplicates: [{ id: groupTask.id, title: groupTask.title, version: groupTask.version }] });
  await expectStatus(`/ai/actions/${duplicate.id}/confirm`, member, 'POST', {}, 409);
  await expectStatus(`/ai/actions/${duplicate.id}/confirm`, member, 'POST', { resolution: { mode: 'update', taskId: b.task.id, expectedVersion: 1 } }, 400);
  await expectStatus(`/ai/actions/${duplicate.id}/confirm`, member, 'POST', { resolution: { mode: 'update', taskId: groupTask.id, expectedVersion: 999 } }, 409);
  const merged = await expectStatus(`/ai/actions/${duplicate.id}/confirm`, member, 'POST', { resolution: { mode: 'update', taskId: groupTask.id, expectedVersion: groupTask.version, title: 'Launch artwork revised' } }, 200);
  assert.equal(merged.task.id, groupTask.id); assert.equal(merged.task.title, 'Launch artwork revised'); checks += 2;
  await expectStatus(`/ai/actions/${duplicate.id}/undo`, member, 'POST', {}, 400);
  const independentProposal = await action('CREATE_TASK', { title: 'Launch artwork revised', assignee_id: a.admin.id });
  await expectStatus(`/ai/actions/${independentProposal.id}/confirm`, member, 'POST', {}, 409);
  const separate = await expectStatus(`/ai/actions/${independentProposal.id}/confirm`, member, 'POST', { resolution: { mode: 'create', title: 'Separate variant' } }, 200);
  assert.notEqual(separate.task.id, groupTask.id); checks++;
  const racingProposals = await Promise.all([action('CREATE_TASK', { title: 'Concurrent duplicate guard' }), action('CREATE_TASK', { title: 'Concurrent duplicate guard' })]);
  const racingResults = await Promise.all(racingProposals.map(p => request(`/ai/actions/${p.id}/confirm`, admin, 'POST', { resolution: { mode: 'create' } })));
  assert.equal(racingResults.filter(r => r.status === 200).length, 1); assert.equal(racingResults.filter(r => r.status === 409).length, 1); checks += 2;
  const refreshedProposal = await db.aiAction.findUnique({ where: { id: racingProposals[racingResults.findIndex(r => r.status === 409)].id } });
  assert.equal(JSON.parse(refreshedProposal.patchPayload).duplicates.length, 1); checks++;
  await expectStatus(`/chat/conversations/${conv}/lead`, admin, 'PATCH', { userId: null }, 200);
  await expectStatus('/tasks', member, 'POST', { title: 'No longer lead', sourceConversationId: conv, assigneeId: a.admin.id }, 403);

  async function classify(content, output) {
    const source = await db.message.create({ data: { conversationId: conv, senderId: a.member.id, content, clientMessageId: randomUUID() } });
    aiService.callVertexGemini = async prompt => { assert(!prompt.includes('QA private task')); return JSON.stringify(output); };
    const result = await aiService.processIncomingMessage(source.id, conv, a.member.id, content, a.org.id);
    return { result, source: await db.message.findUnique({ where: { id: source.id } }) };
  }
  const b6 = await classify('@b6 tiến độ việc launch thế nào?', { is_work_instruction: false, intent: 'QUERY_TASKS', confidence: 1, data: {}, reply_markdown: '### Tiến độ\n\n**Chưa hoàn thành**' });
  assert.equal(b6.result.aiAction, null); assert.match(b6.source.assistantReply, /\*\*Chưa hoàn thành\*\*/); checks += 2;
  const semantic = await classify('Thiết kế hình ảnh cho chiến dịch launch nhé', { is_work_instruction: true, intent: 'CREATE_TASK', confidence: .98, duplicate_task_ids: [groupTask.id, b.task.id], data: { title: 'Campaign launch visual' } });
  assert.deepEqual(JSON.parse(semantic.result.aiAction.patchPayload).duplicates.map(t => t.id), [groupTask.id]); checks++;
  const finished = await classify('task launch xong rồi nha', { is_work_instruction: true, intent: 'UPDATE_STATUS', confidence: .98, data: { task_id: groupTask.id, status: 'COMPLETED' } });
  assert.equal(finished.result.aiAction.expectedVersion, merged.task.version); assert.equal((await db.task.findUnique({ where: { id: groupTask.id } })).status, 'TODO'); checks += 2;
  await expectStatus(`/ai/actions/${finished.result.aiAction.id}/confirm`, admin, 'POST', {}, 200);
  assert.equal((await db.task.findUnique({ where: { id: groupTask.id } })).status, 'COMPLETED'); checks++;
  const invalidTarget = await classify('Sửa task ngoài nhóm', { is_work_instruction: true, intent: 'UPDATE_STATUS', confidence: 1, data: { task_id: b.task.id, status: 'COMPLETED' } });
  assert.equal(invalidTarget.result.kind, 'UNCLASSIFIED'); assert.equal(invalidTarget.result.aiAction, null); checks += 2;
  const simple = await classify('@b6 thống kê công việc nhóm', {});
  assert.match(simple.source.assistantReply, /Tổng cộng:/); checks++;
  aiService.callVertexGemini = originalCall;
  const revoked = await connect(socketToken);
  const disconnected = once(revoked, 'disconnect');
  await expectStatus('/auth/logout', socketToken, 'POST', {}, 200);
  await Promise.race([disconnected, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Revoked socket remained connected')), 5000); timer.unref(); })]); checks++;
  await assert.rejects(connect('invalid-token')); checks++;

  const independent = await login(a.outsider);
  await expectStatus('/auth/logout', independent, 'POST', {}, 200);
  await expectStatus('/auth/me', independent, 'GET', undefined, 401);
  await expectStatus(`/admin/users/${a.outsider.id}/status`, admin, 'PATCH', { status: 'SUSPENDED' }, 200);
  await expectStatus('/auth/me', outsider, 'GET', undefined, 401);
  await expectStatus('/auth/login', null, 'POST', { email: a.outsider.email, password }, 401);
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const attempt = await request('/auth/login', null, 'POST', { email: 'missing@example.test', password });
    if (attempt.status === 429) { limited = true; break; }
    assert.equal(attempt.status, 401);
  }
  assert(limited, 'Login rate limit did not activate'); checks++;
  console.log(`API INTEGRATION: ${checks} checks passed (HTTP + PostgreSQL, including concurrent writes).`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  sockets.forEach(socket => socket.disconnect());
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  for (const id of organizations.reverse()) await db.organization.delete({ where: { id } });
  await db.$disconnect();
});
