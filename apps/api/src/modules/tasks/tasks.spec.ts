import { describe, it, expect, beforeAll } from 'vitest';
import { tasksService } from './tasks.service';
import { db } from '../../services/db.service';
import { TaskStatus, TaskPriority } from '@work-ai/shared';

describe('Kiểm thử Quản lý Task Nâng Cao (Task Management & Integrity Tests)', () => {
  let orgId: string;
  let adminId: string;
  let taskAId: string;
  let taskBId: string;

  beforeAll(async () => {
    const org = await db.organization.findFirst();
    const admin = await db.user.findFirst({ where: { systemRole: 'ADMIN' } });
    orgId = org!.id;
    adminId = admin!.id;

    // Tạo 2 task mẫu để test dependency
    const taskA = await tasksService.createTask(adminId, orgId, {
      title: 'Task A: Thiết kế database',
      priority: TaskPriority.HIGH
    });
    const taskB = await tasksService.createTask(adminId, orgId, {
      title: 'Task B: Viết API Backend',
      priority: TaskPriority.NORMAL
    });

    taskAId = taskA.id;
    taskBId = taskB.id;
  });

  it('1. Thêm dependency hợp lệ: Task B phụ thuộc Task A', async () => {
    const dep = await tasksService.addDependency(taskBId, taskAId);
    expect(dep).toBeDefined();
    expect(dep.taskId).toBe(taskBId);
    expect(dep.dependsOnTaskId).toBe(taskAId);
  });

  it('2. Chặn phát hiện vòng lặp chu trình (Cycle Detection): Task A phụ thuộc lại Task B -> Phải ném lỗi', async () => {
    await expect(tasksService.addDependency(taskAId, taskBId)).rejects.toThrow(
      'Phát hiện vòng lặp chu trình: Task điều kiện đã phụ thuộc vào task này.'
    );
  });

  it('3. Chặn hoàn thành task khi task phụ thuộc chưa hoàn thành (nếu không có override)', async () => {
    await expect(
      tasksService.updateTask(taskBId, adminId, {
        status: TaskStatus.COMPLETED
      })
    ).rejects.toThrow('Không thể hoàn thành task do còn mục checklist, subtask con hoặc task phụ thuộc chưa xong.');
  });

  it('4. Cho phép hoàn thành task khi có lý do Override giải trình', async () => {
    const updated = await tasksService.updateTask(taskBId, adminId, {
      status: TaskStatus.COMPLETED,
      overrideReason: 'Khách hàng duyệt hoàn thành gấp'
    });
    expect(updated.status).toBe(TaskStatus.COMPLETED);
    expect(updated.completedAt).toBeDefined();
  });

  it('5. Tính toán tự động cờ Overdue khi quá deadline', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const isOverdue = tasksService.computeIsOverdue({
      status: TaskStatus.TODO,
      deadline: yesterday,
      completedAt: null
    });
    expect(isOverdue).toBe(true);
  });
});
