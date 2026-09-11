import webpush from 'web-push';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { db } from '../../services/db.service';
import { permissionService } from '../../services/permission.service';
import { Notification } from '@work-ai/database';

let vapid: { publicKey: string; privateKey: string } | undefined;
export function getVapid() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    if (process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY) throw new Error('Both VAPID keys are required');
    const directory = path.resolve(process.env.PUSH_KEY_DIRECTORY || 'storage');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'web-push-keys.json');
    try { vapid = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      const keys = webpush.generateVAPIDKeys();
      try { writeFileSync(file, JSON.stringify(keys), { flag: 'wx', mode: 0o600 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
      vapid = JSON.parse(readFileSync(file, 'utf8'));
    }
  }
  return vapid!;
}

// Push URLs are untrusted client input. Only known browser push services may be contacted.
export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) ||
       url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}

type Scope = { userId: string; orgId: string; systemRole: string };
export async function canReadNotification(user: Scope, notification: Notification) {
  if (notification.userId !== user.userId || notification.orgId !== user.orgId) return false;
  if (notification.entityType === 'CONVERSATION') return !!await db.conversationMember.findFirst({ where: { userId: user.userId, conversationId: notification.entityId || '', conversation: { orgId: user.orgId } } });
  if (notification.entityType === 'TASK') {
    const task = await db.task.findFirst({ where: { AND: [permissionService.readableTaskWhere(user), { id: notification.entityId || '' }] } });
    if (!task) return false;
    if (['TASK_DUE_SOON', 'TASK_OVERDUE'].includes(notification.type)) {
      return task.assigneeId === user.userId && task.status !== 'COMPLETED' && !!task.deadline && !!notification.eventKey?.includes(`:${task.deadline.toISOString()}:`) && (notification.type !== 'TASK_DUE_SOON' || task.deadline > new Date());
    }
    return true;
  }
  return true;
}

export function notificationHref(notification: { entityType: string | null; entityId: string | null }) {
  if (notification.entityType === 'TASK' && notification.entityId) return `/tasks?task=${encodeURIComponent(notification.entityId)}`;
  if (notification.entityType === 'CONVERSATION' && notification.entityId) return `/chat?conversation=${encodeURIComponent(notification.entityId)}`;
  return '/today';
}

export class NotificationsService {
  private running = false;
  async dispatch() {
    if (this.running || process.env.PUSH_ENABLED === 'false') return;
    this.running = true;
    try {
      const now = new Date();
      const pending = await db.notification.findMany({ where: { pushProcessedAt: null, pushNextAt: { lte: now }, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }, orderBy: [{ pushNextAt: 'asc' }, { createdAt: 'asc' }], take: 40 });
      for (const item of pending) {
        const claim = await db.notification.updateMany({ where: { id: item.id, pushProcessedAt: null, pushNextAt: { lte: now } }, data: { pushNextAt: new Date(Date.now() + 300000), pushAttempts: { increment: 1 } } });
        if (!claim.count) continue;
        try {
          const user = await db.user.findUnique({ where: { id: item.userId } });
          const allowed = user?.status === 'ACTIVE' && !user.mustChangePassword && !item.isRead && await canReadNotification({ userId: user.id, orgId: user.orgId, systemRole: user.systemRole }, item);
          let retry = false;
          if (allowed) {
            const subscriptions = await db.pushSubscription.findMany({ where: { userId: item.userId, session: { expiresAt: { gt: new Date() }, userId: item.userId } }, take: 10 });
            const accepted = new Set(item.pushAcceptedSubscriptionIds || []);
            let usable = 0;
            for (const subscription of subscriptions) {
              if (!validPushEndpoint(subscription.endpoint)) { await db.pushSubscription.deleteMany({ where: { id: subscription.id } }); continue; }
              if (accepted.has(subscription.id)) { usable++; continue; }
              try {
                await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey } }, JSON.stringify({ id: item.id, title: 'WorkAI · Thông báo mới', body: item.type === 'MENTION' ? 'Bạn được nhắc đến trong một tin nhắn.' : item.type === 'MESSAGE' ? 'Có tin nhắn mới trong hội thoại của bạn.' : item.type === 'TASK_ASSIGNED' ? 'Bạn có công việc mới được giao.' : item.type === 'PUSH_TEST' ? 'Thông báo thử đã đến thiết bị của bạn.' : 'Có công việc cần bạn kiểm tra thời hạn.', href: notificationHref(item) }), { vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com', ...getVapid() }, TTL: 86400, urgency: ['MENTION', 'TASK_ASSIGNED', 'PUSH_TEST'].includes(item.type) ? 'high' : 'normal', timeout: 10000 });
                usable++;
                accepted.add(subscription.id);
                // Provider acceptance is durable per endpoint; it is not proof of OS display.
                await db.notification.update({ where: { id: item.id }, data: { pushAcceptedSubscriptionIds: { push: subscription.id } } });
              } catch (error: any) {
                if ([404, 410].includes(error.statusCode)) await db.pushSubscription.deleteMany({ where: { id: subscription.id } });
                else retry = true;
              }
            }
            if (!usable) retry = true;
          }
          await db.notification.update({ where: { id: item.id }, data: retry ? { pushNextAt: new Date(Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(item.pushAttempts, 8))) } : { pushProcessedAt: new Date() } });
        } catch {
          // The durable lease expires so another pass can retry after a process/database failure.
          console.error('Notification delivery failed', item.id);
        }
      }
    } finally { this.running = false; }
  }
}
export const notificationsService = new NotificationsService();
