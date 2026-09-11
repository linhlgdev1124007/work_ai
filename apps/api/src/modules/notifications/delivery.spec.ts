import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/db.service', () => ({ db: { notification: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, user: { findUnique: vi.fn() }, task: { findFirst: vi.fn() }, pushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() } } }));
vi.mock('web-push', () => ({ default: { sendNotification: vi.fn(), generateVAPIDKeys: vi.fn() } }));
import webpush from 'web-push';
import { db } from '../../services/db.service';
import { NotificationsService } from './notifications.service';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUSH_ENABLED = 'true'; process.env.VAPID_PUBLIC_KEY = 'test'; process.env.VAPID_PRIVATE_KEY = 'test';
  vi.mocked(db.notification.findMany).mockResolvedValue([{ id: 'n1', userId: 'u', orgId: 'org', entityType: 'TASK', entityId: 't', type: 'TASK_ASSIGNED', body: 'Confidential task', pushAttempts: 0, isRead: false }] as any);
  vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'u', orgId: 'org', systemRole: 'ADMIN', status: 'ACTIVE', mustChangePassword: false } as any);
  vi.mocked(db.task.findFirst).mockResolvedValue({ id: 't' } as any);
  vi.mocked(db.pushSubscription.findMany).mockResolvedValue([{ id: 's', endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dhKey: 'key', authKey: 'auth' }] as any);
  vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);
});
describe('Durable push dispatcher', () => {
  it('sends generic payload and marks processed', async () => { await new NotificationsService().dispatch(); expect(webpush.sendNotification).toHaveBeenCalledTimes(1); const payload = JSON.parse(String(vi.mocked(webpush.sendNotification).mock.calls[0][1])); expect(payload.href).toBe('/tasks?task=t'); expect(JSON.stringify(payload)).not.toContain('Confidential'); expect(db.notification.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pushProcessedAt: expect.any(Date) } })); });
  it('removes expired endpoints', async () => { vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 }); await new NotificationsService().dispatch(); expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's' } }); });
  it('reschedules transient failures', async () => { vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 503 }); await new NotificationsService().dispatch(); expect(db.notification.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pushNextAt: expect.any(Date) } })); });
  it('does not deliver to revoked sessions', async () => { vi.mocked(db.pushSubscription.findMany).mockResolvedValue([]); await new NotificationsService().dispatch(); expect(webpush.sendNotification).not.toHaveBeenCalled(); expect(db.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u', session: { expiresAt: { gt: expect.any(Date) }, userId: 'u' } } })); });
  it('keeps undelivered notifications pending when no endpoint exists', async () => {
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([]);
    await new NotificationsService().dispatch();
    expect(db.notification.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pushNextAt: expect.any(Date) } }));
    expect(db.notification.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { pushProcessedAt: expect.any(Date) } }));
  });
  it.each(['https://web.push.apple.com/test', 'https://wns2.example.notify.windows.com/test'])('supports provider endpoints %s', async endpoint => {
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([{ id: 's', endpoint, p256dhKey: 'key', authKey: 'auth' }] as any);
    await new NotificationsService().dispatch();
    expect(webpush.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint }), expect.any(String), expect.objectContaining({ TTL: 86400 }));
  });
  it('persists acceptance separately and does not resend to the successful device', async () => {
    const notification = { id: 'n1', userId: 'u', orgId: 'org', entityType: 'TASK', entityId: 't', type: 'TASK_ASSIGNED', pushAttempts: 0, isRead: false, pushAcceptedSubscriptionIds: [] as string[] };
    vi.mocked(db.notification.findMany).mockResolvedValue([notification] as any);
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([{ id: 'mac', endpoint: 'https://web.push.apple.com/test', p256dhKey: 'key', authKey: 'auth' }, { id: 'win', endpoint: 'https://fcm.googleapis.com/test', p256dhKey: 'key', authKey: 'auth' }] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({} as any).mockRejectedValueOnce({ statusCode: 503 });
    await new NotificationsService().dispatch();
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { pushAcceptedSubscriptionIds: { push: 'mac' } } });
    notification.pushAcceptedSubscriptionIds = ['mac'];
    vi.mocked(webpush.sendNotification).mockClear().mockResolvedValue({} as any);
    await new NotificationsService().dispatch();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/test' }), expect.any(String), expect.any(Object));
  });
  it('does not discard retry work merely after eight failures', async () => {
    await new NotificationsService().dispatch();
    const where = vi.mocked(db.notification.findMany).mock.calls[0][0]?.where;
    expect(where).not.toHaveProperty('pushAttempts');
    expect(where).toHaveProperty('createdAt.gte');
  });
  it('does not deliver after account suspension', async () => { vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'u', status: 'SUSPENDED' } as any); await new NotificationsService().dispatch(); expect(webpush.sendNotification).not.toHaveBeenCalled(); });
  it('does not deliver when another worker owns the lease', async () => { vi.mocked(db.notification.updateMany).mockResolvedValue({ count: 0 }); await new NotificationsService().dispatch(); expect(webpush.sendNotification).not.toHaveBeenCalled(); });
  it('does not deliver private tasks after losing access', async () => { vi.mocked(db.task.findFirst).mockResolvedValue(null); await new NotificationsService().dispatch(); expect(webpush.sendNotification).not.toHaveBeenCalled(); });
});
