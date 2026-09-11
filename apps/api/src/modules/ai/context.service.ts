import { createHash } from 'crypto';
import IORedis from 'ioredis';
import { db } from '../../services/db.service';
import { permissionService } from '../../services/permission.service';
import { config } from '../../config';

type UserScope = { userId: string; orgId: string; systemRole: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const businessDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();

export class ContextService {
  private redis?: IORedis;
  private connection() {
    if (!config.redisUrl) return undefined;
    if (!this.redis) {
      this.redis = new IORedis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, commandTimeout: 1500, retryStrategy: () => null });
      this.redis.on('error', () => {});
    }
    return this.redis;
  }

  async build(user: UserScope, question: string, now = new Date()) {
    // Only joined conversations: elevated admin access is never pulled into AI implicitly.
    const memberships = await db.conversationMember.findMany({ where: { userId: user.userId, conversation: { orgId: user.orgId } }, select: { conversationId: true } });
    const ids = memberships.map(m => m.conversationId).sort();
    const messages = await db.message.findMany({ where: { conversationId: { in: ids }, isDeleted: false, createdAt: { lte: now } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2001, select: { id: true, conversationId: true, content: true, createdAt: true, updatedAt: true, sender: { select: { fullName: true } } } });
    const truncated = messages.length > 2000;
    const groups = new Map<string, typeof messages>();
    for (const message of messages.slice(0, 2000).reverse()) {
      const day = businessDay(message.createdAt);
      groups.set(day, [...(groups.get(day) || []), message]);
    }
    const today = businessDay(now);
    const words = normalize(question).split(/\W+/).filter(w => w.length > 3);
    let hits = 0;
    const daily: { day: string; facts: { id: string; conversationId: string; text: string }[] }[] = [];
    for (const [day, items] of groups) {
      const key = `ai:daily:v1:${digest([user.orgId, user.userId, ids, day])}`;
      const signature = digest(items);
      let facts: { id: string; conversationId: string; text: string }[] | undefined;
      try {
        const cached = await this.connection()?.get(key);
        if (cached) { const parsed = JSON.parse(cached); if (parsed.signature === signature) { facts = parsed.facts; hits++; } }
      } catch { /* Cache availability must not block a question. */ }
      if (!facts) {
        facts = items.map(m => ({ id: m.id, conversationId: m.conversationId, text: `${m.sender.fullName}: ${m.content.replace(/\s+/g, ' ').trim().slice(0, 600)}` }));
        try { await this.connection()?.set(key, JSON.stringify({ signature, facts }), 'EX', 86400 * 7); } catch { /* Rebuild from the database on the next request. */ }
      }
      daily.push({ day, facts });
    }
    const historical = daily.filter(d => d.day < today).flatMap(d => d.facts.map(f => ({ ...f, day: d.day, score: words.reduce((n, w) => n + Number(normalize(f.text).includes(w)), 0) })));
    historical.sort((a, b) => b.score - a.score || b.day.localeCompare(a.day));
    const selected = historical.slice(0, 16).sort((a, b) => a.day.localeCompare(b.day));
    const current = daily.find(d => d.day === today)?.facts || [];
    const recent = current.slice(-24);
    const tasks = await db.task.findMany({ where: { AND: [permissionService.readableTaskWhere(user), { status: { not: 'COMPLETED' } }] }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 61, select: { id: true, title: true, status: true, priority: true, deadline: true, assignee: { select: { fullName: true } } } });
    const people = await permissionService.scopedUsers(user);
    const work = await db.currentWork.findMany({ where: { userId: { in: people.map(p => p.id) } }, select: { userId: true, customStatusText: true, startedAt: true } });
    return { historical: selected, today: recent, tasks: tasks.slice(0, 60), currentWork: work.map(w => ({ name: people.find(p => p.id === w.userId)?.fullName, text: w.customStatusText, since: w.startedAt })), metadata: { asOf: now.toISOString(), timezone: 'Asia/Ho_Chi_Minh', cachedDays: hits, totalDays: daily.length, truncated: truncated || current.length > 24 || historical.length > 16 || tasks.length > 60 }, sources: [...selected, ...recent].map(m => ({ label: m.text.slice(0, 90), href: `/chat?conversation=${m.conversationId}` })) };
  }

  async statistics(user: UserScope, question: string, now = new Date()) {
    const q = normalize(question).trim().replace(/[?.!]$/g, '');
    // Exact supported intents only. Do not silently ignore a date/person/project filter.
    if (!['thong ke cong viec', 'thong ke cong viec hom nay', 'tong quan cong viec', 'bao nhieu cong viec qua han', 'cong viec cua toi'].includes(q)) return null;
    const where = { AND: [permissionService.readableTaskWhere(user), ...(q === 'cong viec cua toi' ? [{ assigneeId: user.userId }] : [])] };
    const counts = await db.task.groupBy({ by: ['status'], where, _count: { _all: true } });
    const overdue = await db.task.count({ where: { AND: [where, { status: { not: 'COMPLETED' }, deadline: { lt: now } }] } });
    const total = counts.reduce((n, row) => n + row._count._all, 0);
    const completed = counts.find(r => r.status === 'COMPLETED')?._count._all || 0;
    return { answer: `Tại thời điểm ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}, trong phạm vi công việc ${q === 'cong viec cua toi' ? 'được giao cho bạn' : 'bạn được phép xem'}:\n\nTổng cộng: ${total}\nĐã hoàn thành: ${completed}\nChưa hoàn thành: ${total - completed}\nĐang thực hiện: ${counts.find(r => r.status === 'IN_PROGRESS')?._count._all || 0}\nQuá hạn chưa hoàn thành: ${overdue}\n\nĐây là số liệu hiện tại của toàn bộ công việc, không chỉ công việc tạo hôm nay.`, mode: 'database', asOf: now.toISOString(), sources: [{ label: 'Danh sách công việc', href: '/tasks' }, { label: 'Báo cáo', href: '/reports' }] };
  }
}

export const contextService = new ContextService();
