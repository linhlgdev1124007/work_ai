import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../../middleware/auth.middleware';
import { db } from '../../services/db.service';
import { canReadNotification, getVapid, notificationHref, validPushEndpoint } from './notifications.service';

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware);
notificationsRouter.post('/test', rateLimit({ windowMs: 60000, limit: 3, keyGenerator: req => req.user!.userId }), async (req, res) => {
  try {
    if (process.env.PUSH_ENABLED === 'false') return res.status(503).json({ success: false, error: { message: 'Dịch vụ gửi thông báo đang tắt.' } });
    const count = await db.pushSubscription.count({ where: { userId: req.user!.userId, session: { userId: req.user!.userId, expiresAt: { gt: new Date() } } } });
    if (!count) return res.status(409).json({ success: false, error: { message: 'Chưa có thiết bị đăng ký hợp lệ. Hãy tải lại trang và bật thông báo.' } });
    const notice = await db.notification.create({ data: { orgId: req.user!.orgId, userId: req.user!.userId, type: 'PUSH_TEST', title: 'Kiểm tra thông báo', body: 'Thông báo thử cho các thiết bị đã đăng ký của bạn.' } });
    return res.status(202).json({ success: true, data: { id: notice.id } });
  } catch { return res.status(500).json({ success: false, error: { message: 'Không xếp hàng được thông báo thử.' } }); }
});
notificationsRouter.get('/config', (_req, res) => {
  try { res.json({ success: true, data: { publicKey: getVapid().publicKey, required: process.env.PUSH_REQUIRED !== 'false' } }); }
  catch { res.status(503).json({ success: false, error: { message: 'Chưa cấu hình được Web Push. Liên hệ quản trị viên.' } }); }
});
notificationsRouter.get('/', async (req, res) => {
  try {
    const rows = await db.notification.findMany({ where: { orgId: req.user!.orgId, userId: req.user!.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    const data = [];
    for (const row of rows) if (await canReadNotification(req.user!, row)) data.push({ id: row.id, type: row.type, title: row.title, body: row.body, isRead: row.isRead, createdAt: row.createdAt, href: notificationHref(row) });
    res.json({ success: true, data });
  } catch { res.status(500).json({ success: false, error: { message: 'Không tải được thông báo' } }); }
});
notificationsRouter.patch('/:id/read', async (req, res) => {
  try {
    const changed = await db.notification.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId, userId: req.user!.userId }, data: { isRead: true } });
    res.status(changed.count ? 200 : 404).json({ success: !!changed.count });
  } catch { res.status(500).json({ success: false }); }
});
const subscriptionSchema = z.object({ endpoint: z.string().max(2048).refine(validPushEndpoint), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(v => Buffer.from(v, 'base64url').length === 65), auth: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(v => Buffer.from(v, 'base64url').length === 16) }) });
notificationsRouter.post('/subscriptions', rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.user!.userId }), async (req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { message: 'Đăng ký thông báo không hợp lệ' } });
  try {
    const { endpoint, keys } = parsed.data;
    const existing = await db.pushSubscription.findUnique({ where: { endpoint } });
    if (existing && existing.userId !== req.user!.userId) return res.status(409).json({ success: false, error: { message: 'Thiết bị đang đăng ký cho tài khoản khác. Hãy hủy đăng ký cũ rồi thử lại.' } });
    if (!existing && await db.pushSubscription.count({ where: { userId: req.user!.userId } }) >= 10) return res.status(409).json({ success: false, error: { message: 'Tối đa 10 thiết bị. Đăng xuất thiết bị cũ rồi thử lại.' } });
    await db.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, userId: req.user!.userId, sessionId: req.user!.id, p256dhKey: keys.p256dh, authKey: keys.auth }, update: { sessionId: req.user!.id, p256dhKey: keys.p256dh, authKey: keys.auth } });
    if (!existing) await db.notification.updateMany({ where: { userId: req.user!.userId, orgId: req.user!.orgId, pushProcessedAt: null, isRead: false, createdAt: { gte: new Date(Date.now() - 7 * 86400000) }, pushNextAt: { gt: new Date(Date.now() + 300000) } }, data: { pushNextAt: new Date(Date.now() + 300000) } });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: { message: 'Không lưu được đăng ký thông báo' } }); }
});
notificationsRouter.delete('/subscriptions', async (req, res) => {
  if (typeof req.body.endpoint !== 'string') return res.status(400).json({ success: false });
  try { await db.pushSubscription.deleteMany({ where: { endpoint: req.body.endpoint, userId: req.user!.userId } }); res.json({ success: true }); }
  catch { res.status(500).json({ success: false }); }
});
