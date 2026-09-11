import { db } from '../../services/db.service';
import { SetCurrentWorkDto, TaskStatus } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';
import { Prisma, CurrentWork, Task } from '@work-ai/database';

export class CurrentWorkService {
  constructor(private client: Prisma.TransactionClient = db) {}
  /**
   * Cập nhật trạng thái "Tôi đang làm gì"
   * Mỗi người chỉ có 1 current work duy nhất tại 1 thời điểm
   */
  async setCurrentWork(userId: string, dto: SetCurrentWorkDto): Promise<CurrentWork & { task: Task | null }> {
    if (this.client === db) return db.$transaction(tx => new CurrentWorkService(tx).setCurrentWork(userId, dto));
    const client = this.client;
    await client.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    let taskTitle: string | null = null;

    if (dto.taskId) {
      const task = await client.task.findUnique({ where: { id: dto.taskId } });
      if (task) {
        taskTitle = task.title;
        // Nếu task đang ở trạng thái TODO, tự động chuyển sang IN_PROGRESS
        if (task.status === TaskStatus.TODO) {
          await client.task.update({
            where: { id: task.id },
            data: { status: TaskStatus.IN_PROGRESS, version: { increment: 1 } }
          });
        }
      }
    }

    const currentWork = await client.currentWork.upsert({
      where: { userId },
      update: {
        taskId: dto.taskId || null,
        customStatusText: dto.customStatusText || taskTitle || null,
        startedAt: new Date()
      },
      create: {
        userId,
        taskId: dto.taskId || null,
        customStatusText: dto.customStatusText || taskTitle || null,
        startedAt: new Date()
      },
      include: { task: true }
    });

    // Ghi sự kiện trạng thái làm việc
    await client.workStatusEvent.create({
      data: {
        userId,
        taskId: dto.taskId || null,
        statusText: currentWork.customStatusText || 'Đang làm việc',
        action: 'START'
      }
    });

    return currentWork;
  }

  /**
   * Lấy Current Work của 1 user
   */
  async getUserCurrentWork(userId: string) {
    return await db.currentWork.findUnique({
      where: { userId },
      include: { task: true }
    });
  }

  /**
   * Lấy dữ liệu cho màn hình "Ai đang làm gì" (Who is doing what Dashboard)
   * Hiển thị toàn bộ thành viên trong tổ chức / team
   */
  async getWhoIsDoingWhat(userContext: { userId: string; orgId: string; systemRole: string }, teamId?: string) {
    const users = await permissionService.scopedUsers(userContext);
    const scopedUserIds = users.map(user => user.id);

    const hydratedUsers = await db.user.findMany({
      where: {
        id: { in: scopedUserIds },
        teamMemberships: teamId ? { some: { teamId } } : undefined
      },
      include: {
        currentWork: { include: { task: true } },
        attendanceSessions: {
          where: { status: 'OPEN' },
          take: 1
        },
        assignedTasks: {
          where: {
            isArchived: false,
            status: { not: TaskStatus.COMPLETED }
          }
        }
      }
    });

    const now = new Date();

    return hydratedUsers.map(user => {
      // 1. Tính toán task lá (Leaf Tasks): task không có subtask con
      // Vì truy vấn lấy các task được giao cho user, chỉ tính những task chưa completed
      const activeTasks = user.assignedTasks;

      // 2. Tìm deadline gần nhất
      const tasksWithDeadline = activeTasks
        .filter(t => t.deadline !== null)
        .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime());
      const nearestDeadline = tasksWithDeadline.length > 0 ? tasksWithDeadline[0].deadline : null;

      // 3. Số task bị trễ
      const overdueTasksCount = activeTasks.filter(t => t.deadline && now > t.deadline).length;

      // 4. Trạng thái In/Out
      const isCheckedIn = user.attendanceSessions.length > 0;

      // 5. Chuỗi mô tả công việc đang làm
      const doingText = user.currentWork
        ? user.currentWork.customStatusText || user.currentWork.task?.title || 'Đang làm việc'
        : 'Chưa cập nhật'; // Đúng quy định trong plan.md: Không tự suy diễn là "đang rảnh"

      return {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isCheckedIn,
        currentWork: {
          statusText: doingText,
          taskId: user.currentWork?.taskId || null,
          startedAt: user.currentWork?.startedAt || null
        },
        remainingTasksCount: activeTasks.length, // Đếm số task còn lại
        nearestDeadline,
        overdueTasksCount
      };
    });
  }
}

export const currentWorkService = new CurrentWorkService();
