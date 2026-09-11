import { db } from '../../services/db.service';

export class RemindersService {
  async scanAndSendReminders() {
    const now = new Date();
    let cursor: string | undefined;
    // A deadline/recipient identity, rather than task version, prevents unrelated edits from re-notifying.
    for (;;) {
      const tasks = await db.task.findMany({ where: { isArchived: false, status: { not: 'COMPLETED' }, assigneeId: { not: null }, deadline: { lte: new Date(now.getTime() + 7200000) } }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!tasks.length) break;
      await db.notification.createMany({ data: tasks.map(task => {
        const overdue = task.deadline! < now;
        return { orgId: task.orgId, userId: task.assigneeId!, type: overdue ? 'TASK_OVERDUE' : 'TASK_DUE_SOON', title: overdue ? 'Công việc đã quá hạn' : 'Công việc sắp đến hạn', body: task.title, entityType: 'TASK', entityId: task.id, eventKey: `deadline:${task.id}:${task.assigneeId}:${task.deadline!.toISOString()}:${overdue ? 'overdue' : 'soon'}` };
      }), skipDuplicates: true });
      cursor = tasks[tasks.length - 1].id;
    }
  }
}
export const remindersService = new RemindersService();
