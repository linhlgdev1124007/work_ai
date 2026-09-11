import { db } from '../../services/db.service';
import { CreateTaskDto, UpdateTaskDto, TaskStatus, TaskPriority } from '@work-ai/shared';
import { Prisma } from '@work-ai/database';
import { permissionService } from '../../services/permission.service';

type TaskResult = Prisma.TaskGetPayload<{ include: { assignee: true; creator: true; team: true; project: true } }> & { isOverdue: boolean };

export class TasksService {
  constructor(private client: Prisma.TransactionClient = db) {}

  async getOptions(user: { userId: string; orgId: string; systemRole: string }) {
    const admin = permissionService.isAdmin(user);
    const person = { id: true, fullName: true } as const;
    const [rooms, teams, users] = await Promise.all([
      db.conversation.findMany({ where: { orgId: user.orgId, ...(admin ? {} : { members: { some: { userId: user.userId } } }) }, select: { id: true, name: true, teamId: true, projectId: true, members: { where: { user: { status: 'ACTIVE' } }, select: { userId: true, role: true, user: { select: person } } } }, orderBy: { name: 'asc' } }),
      db.team.findMany({ where: { orgId: user.orgId, ...(admin ? {} : { members: { some: { userId: user.userId } } }) }, select: { id: true, name: true, members: { where: { user: { status: 'ACTIVE' } }, select: { userId: true, role: true, user: { select: person } } } }, orderBy: { name: 'asc' } }),
      db.user.findMany({ where: { orgId: user.orgId, status: 'ACTIVE', ...(admin ? {} : { id: user.userId }) }, select: person, orderBy: { fullName: 'asc' } })
    ]);
    const groups = [
      ...rooms.map(room => ({ id: `room:${room.id}`, name: room.name, type: 'ROOM', sourceConversationId: room.id, teamId: room.teamId, projectId: room.projectId, canAssign: admin || room.members.some(member => member.userId === user.userId && member.role === 'LEAD'), members: room.members.map(member => member.user) })),
      ...teams.map(team => ({ id: `team:${team.id}`, name: team.name, type: 'TEAM', sourceConversationId: null, teamId: team.id, projectId: null, canAssign: admin || team.members.some(member => member.userId === user.userId && member.role === 'LEAD'), members: team.members.map(member => member.user) }))
    ];
    return { canAssignPersonal: admin, personalAssignees: users, groups };
  }
  /**
   * Tính toán cờ isOverdue cho một Task
   */
  computeIsOverdue(task: { status: string; deadline: Date | null; completedAt: Date | null }): boolean {
    if (!task.deadline) return false;
    const now = new Date();
    if (task.status === TaskStatus.COMPLETED) {
      return task.completedAt ? task.completedAt > task.deadline : false;
    }
    return now > task.deadline;
  }

  /**
   * Tạo task mới (Form nhanh hoặc chi tiết)
   */
  async createTask(creatorId: string, orgId: string, dto: CreateTaskDto): Promise<TaskResult> {
    if (this.client === db) return db.$transaction(tx => new TasksService(tx).createTask(creatorId, orgId, dto));
    const client = this.client;
    const deadlineDate = dto.deadline ? new Date(dto.deadline) : null;

    const task = await client.task.create({
      data: {
        orgId,
        creatorId,
        title: dto.title,
        description: dto.description || null,
        teamId: dto.teamId || null,
        projectId: dto.projectId || null,
        assigneeId: dto.assigneeId || null,
        priority: dto.priority || TaskPriority.NORMAL,
        status: dto.status || TaskStatus.TODO,
        completedAt: dto.status === TaskStatus.COMPLETED ? new Date() : null,
        completionDeadline: dto.status === TaskStatus.COMPLETED ? deadlineDate : null,
        deadline: deadlineDate,
        estimateMinutes: dto.estimateMinutes || null,
        requiresReview: dto.requiresReview || false,
        parentId: dto.parentId || null,
        sourceMessageId: dto.sourceMessageId || null,
        sourceConversationId: dto.sourceConversationId || null
      },
      include: {
        assignee: true,
        creator: true,
        team: true,
        project: true
      }
    });

    await client.notification.create({ data: { orgId, userId: task.assigneeId || creatorId, type: 'TASK_ASSIGNED', title: 'Có công việc mới', body: task.title, entityType: 'TASK', entityId: task.id, eventKey: `task:${task.id}:created` } });
    // Ghi nhận lịch sử tạo task
    await client.taskEvent.create({
      data: {
        taskId: task.id,
        actorId: creatorId,
        actionType: 'CREATED',
        newValue: task.title,
        metadata: JSON.stringify({ priority: task.priority, deadline: task.deadline })
      }
    });

    return {
      ...task,
      isOverdue: this.computeIsOverdue(task)
    };
  }

  /**
   * Cập nhật thông tin Task
   */
  async updateTask(taskId: string, actorId: string, dto: UpdateTaskDto): Promise<TaskResult> {
    if (this.client === db) return db.$transaction(tx => new TasksService(tx).updateTask(taskId, actorId, dto));
    const client = this.client;
    const existing = await client.task.findUnique({
      where: { id: taskId },
      include: { checklistItems: true, subtasks: true, dependencies: { include: { dependsOnTask: true } } }
    });

    if (!existing) {
      throw new Error('Không tìm thấy task yêu cầu.');
    }

    // Kiểm tra version chống xung đột sửa đồng thời (Optimistic Concurrency Control)
    if (dto.expectedVersion !== undefined && existing.version !== dto.expectedVersion) {
      throw Object.assign(new Error('Dữ liệu task đã được thay đổi bởi người khác, vui lòng tải lại.'), { statusCode: 409 });
    }

    const updates: any = {
      version: { increment: 1 }
    };

    if (dto.estimateMinutes !== undefined) updates.estimateMinutes = dto.estimateMinutes;
    if (dto.requiresReview !== undefined) updates.requiresReview = dto.requiresReview;

    const changes: Array<{ field: string; oldVal: any; newVal: any }> = [];

    if (dto.title !== undefined && dto.title !== existing.title) {
      updates.title = dto.title;
      changes.push({ field: 'title', oldVal: existing.title, newVal: dto.title });
    }

    if (dto.description !== undefined && dto.description !== existing.description) {
      updates.description = dto.description;
      changes.push({ field: 'description', oldVal: existing.description, newVal: dto.description });
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      updates.assigneeId = dto.assigneeId;
      changes.push({ field: 'assigneeId', oldVal: existing.assigneeId, newVal: dto.assigneeId });
    }

    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      updates.priority = dto.priority;
      changes.push({ field: 'priority', oldVal: existing.priority, newVal: dto.priority });
    }

    if (dto.deadline !== undefined) {
      const newDl = dto.deadline ? new Date(dto.deadline) : null;
      updates.deadline = newDl;
      changes.push({ field: 'deadline', oldVal: existing.deadline, newVal: newDl });
    }

    // Xử lý chuyển trạng thái hoàn thành (COMPLETED)
    if (dto.status !== undefined && dto.status !== existing.status) {
      if (dto.status === TaskStatus.COMPLETED) {
        // Kiểm tra điều kiện hoàn thành
        const hasUnfinishedChecklist = existing.checklistItems.some(item => !item.isCompleted);
        const hasUnfinishedSubtasks = existing.subtasks.some(st => st.status !== TaskStatus.COMPLETED);
        const hasUnfinishedDependencies = existing.dependencies.some(dep => dep.dependsOnTask.status !== TaskStatus.COMPLETED);

        const isBlocked = hasUnfinishedChecklist || hasUnfinishedSubtasks || hasUnfinishedDependencies;

        if (isBlocked && !dto.overrideReason) {
          throw new Error('Không thể hoàn thành task do còn mục checklist, subtask con hoặc task phụ thuộc chưa xong.');
        }

        updates.completedAt = new Date();
        updates.completionDeadline = dto.deadline !== undefined ? updates.deadline : existing.deadline;
      } else if (existing.status === TaskStatus.COMPLETED) {
        // Mở lại task (Reopen)
        updates.completedAt = null;
      }

      updates.status = dto.status;
      changes.push({ field: 'status', oldVal: existing.status, newVal: dto.status });
    }

    const updatedTask = await client.task.update({
      where: { id: taskId, version: existing.version },
      data: updates,
      include: {
        assignee: true,
        creator: true,
        team: true,
        project: true
      }
    });

    if (updatedTask.assigneeId && updatedTask.assigneeId !== existing.assigneeId) {
      await client.notification.create({ data: { orgId: updatedTask.orgId, userId: updatedTask.assigneeId, type: 'TASK_ASSIGNED', title: 'Bạn được giao công việc', body: updatedTask.title, entityType: 'TASK', entityId: taskId, eventKey: `task:${taskId}:assigned:${updatedTask.version}` } });
    }
    // Ghi nhận các thay đổi vào task_events
    for (const change of changes) {
      await client.taskEvent.create({
        data: {
          taskId,
          actorId,
          actionType: 'UPDATED',
          fieldChanged: change.field,
          oldValue: String(change.oldVal),
          newValue: String(change.newVal),
          metadata: dto.overrideReason ? JSON.stringify({ overrideReason: dto.overrideReason }) : null
        }
      });
    }

    return {
      ...updatedTask,
      isOverdue: this.computeIsOverdue(updatedTask)
    };
  }

  /**
   * Thêm Checklist Item vào Task
   */
  async addChecklistItem(taskId: string, title: string) {
    const count = await db.taskChecklistItem.count({ where: { taskId } });
    return await db.taskChecklistItem.create({
      data: {
        taskId,
        title,
        position: count
      }
    });
  }

  /**
   * Toggle hoàn thành Checklist Item
   */
  async toggleChecklistItem(itemId: string, actorId: string, isCompleted: boolean) {
    return await db.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        isCompleted,
        completedById: isCompleted ? actorId : null,
        completedAt: isCompleted ? new Date() : null
      }
    });
  }

  /**
   * Thêm liên kết phụ thuộc (Dependency) với thuật toán phát hiện chu trình (Cycle Detection)
   */
  async addDependency(taskId: string, dependsOnTaskId: string): Promise<Prisma.TaskDependencyGetPayload<{}>> {
    if (this.client === db) return db.$transaction(tx => new TasksService(tx).addDependency(taskId, dependsOnTaskId));
    const client = this.client;
    const task = await client.task.findUnique({ where: { id: taskId } });
    if (!task) throw new Error('Task not found');
    await client.$queryRaw`SELECT id FROM "Organization" WHERE id = ${task.orgId} FOR UPDATE`;
    if (!await client.task.findFirst({ where: { id: dependsOnTaskId, orgId: task.orgId } })) throw new Error('Invalid dependency');
    if (taskId === dependsOnTaskId) {
      throw new Error('Một task không thể tự phụ thuộc vào chính mình.');
    }

    // Thuật toán kiểm tra vòng lặp chu trình đồ thị (BFS)
    const visited = new Set<string>();
    const queue = [dependsOnTaskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) {
        throw new Error('Phát hiện vòng lặp chu trình: Task điều kiện đã phụ thuộc vào task này.');
      }

      if (!visited.has(current)) {
        visited.add(current);
        const nextDeps = await client.taskDependency.findMany({
          where: { taskId: current }
        });
        for (const dep of nextDeps) {
          queue.push(dep.dependsOnTaskId);
        }
      }
    }

    return await client.taskDependency.create({
      data: {
        taskId,
        dependsOnTaskId
      }
    });
  }

  /**
   * Lấy chi tiết một Task đầy đủ thông tin
   */
  async getTaskById(taskId: string) {
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true,
        creator: true,
        team: true,
        project: true,
        checklistItems: { orderBy: { position: 'asc' } },
        subtasks: { include: { assignee: true } },
        dependencies: { include: { dependsOnTask: true } },
        dependentOn: { include: { task: true } },
        events: {
          include: { actor: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!task) return null;

    return {
      ...task,
      isOverdue: this.computeIsOverdue(task)
    };
  }

  /**
   * Lấy danh sách việc cho trang "Hôm nay" của Member
   */
  async getTodayTasks(userId: string) {
    const tasks = await db.task.findMany({
      where: {
        assigneeId: userId,
        isArchived: false
      },
      include: {
        team: true,
        project: true
      },
      orderBy: { deadline: 'asc' }
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const doing: any[] = [];
    const overdue: any[] = [];
    const dueToday: any[] = [];
    const upcoming: any[] = [];
    const noDeadline: any[] = [];
    const completedToday: any[] = [];

    for (const t of tasks) {
      const isOverdue = this.computeIsOverdue(t);
      const enriched = { ...t, isOverdue };

      if (t.status === TaskStatus.COMPLETED) {
        if (t.completedAt && t.completedAt >= startOfToday && t.completedAt <= endOfToday) {
          completedToday.push(enriched);
        }
        continue;
      }

      if (t.status === TaskStatus.IN_PROGRESS) {
        doing.push(enriched);
      }

      if (isOverdue) {
        overdue.push(enriched);
      } else if (!t.deadline) {
        noDeadline.push(enriched);
      } else if (t.deadline >= startOfToday && t.deadline <= endOfToday) {
        dueToday.push(enriched);
      } else if (t.deadline > endOfToday) {
        upcoming.push(enriched);
      }
    }

    return {
      doing,
      overdue,
      dueToday,
      upcoming,
      noDeadline,
      completedToday
    };
  }
}

export const tasksService = new TasksService();
