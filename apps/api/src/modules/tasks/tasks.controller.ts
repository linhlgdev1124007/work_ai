import { Router, Request, Response } from 'express';
import { tasksService } from './tasks.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { CreateTaskSchema, UpdateTaskSchema } from '@work-ai/shared';
import { db } from '../../services/db.service';
import { permissionService } from '../../services/permission.service';
import { emitTaskEvent } from '../../services/realtime.service';

export const tasksRouter = Router();

tasksRouter.get('/options', authMiddleware, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await tasksService.getOptions(req.user!) });
  } catch {
    return res.status(500).json({ success: false, error: { message: 'Không thể tải danh sách người phụ trách' } });
  }
});

// Lấy danh sách việc cho trang "Hôm nay"
tasksRouter.get('/today', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = await tasksService.getTodayTasks(req.user!.userId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Lấy danh sách tất cả tasks có phân trang và bộ lọc
tasksRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { teamId, projectId, assigneeId, status, priority } = req.query;

    const tasks = await db.task.findMany({
      where: {
        AND: [
          permissionService.readableTaskWhere(req.user!),
          {
            teamId: teamId ? String(teamId) : undefined,
            projectId: projectId ? String(projectId) : undefined,
            assigneeId: assigneeId ? String(assigneeId) : undefined,
            status: status ? String(status) : undefined,
            priority: priority ? String(priority) : undefined
          }
        ],
      },
      include: {
        assignee: true,
        creator: true,
        team: true,
        project: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = tasks.map(t => ({
      ...t,
      isOverdue: tasksService.computeIsOverdue(t)
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Lấy chi tiết một task
tasksRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    await permissionService.assertTaskRead(req.user!, req.params.id);
    const task = await tasksService.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy task' } });
    }
    let canEdit = true;
    try { await permissionService.assertTaskMutation(req.user!, req.params.id); }
    catch (error: any) { if (error.statusCode !== 403) throw error; canEdit = false; }
    return res.status(200).json({ success: true, data: { ...task, canEdit } });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Tạo task mới
tasksRouter.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = CreateTaskSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ' }
      });
    }

    await permissionService.assertCanCreateTask(req.user!, parseResult.data);
    if (parseResult.data.parentId) await permissionService.assertTaskMutation(req.user!, parseResult.data.parentId);
    if (parseResult.data.sourceConversationId) await permissionService.assertConversationAccess(req.user!, parseResult.data.sourceConversationId);
    if (parseResult.data.sourceMessageId) {
      const message = await db.message.findUnique({ where: { id: parseResult.data.sourceMessageId } });
      if (!message) return res.status(400).json({ success: false, error: { message: 'Invalid source message' } });
      await permissionService.assertConversationAccess(req.user!, message.conversationId);
      if (parseResult.data.sourceConversationId && parseResult.data.sourceConversationId !== message.conversationId) return res.status(400).json({ success: false, error: { message: 'Invalid source conversation' } });
    }
    const task = await tasksService.createTask(req.user!.userId, req.user!.orgId, parseResult.data);
    const io = (req.app as any).get('socketio');
    emitTaskEvent(io, 'task.created', task);
    return res.status(201).json({ success: true, data: task });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Cập nhật task
tasksRouter.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = UpdateTaskSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ' }
      });
    }

    await permissionService.assertTaskMutation(req.user!, req.params.id, parseResult.data);
    const updatedTask = await tasksService.updateTask(req.params.id, req.user!.userId, parseResult.data);
    const io = (req.app as any).get('socketio');
    emitTaskEvent(io, 'task.updated', updatedTask);
    return res.status(200).json({ success: true, data: updatedTask });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Thêm checklist item
tasksRouter.post('/:id/checklist', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    if (typeof title !== 'string' || !title.trim() || title.length > 500) {
      return res.status(400).json({ success: false, error: { message: 'Tiêu đề không được để trống' } });
    }
    await permissionService.assertTaskMutation(req.user!, req.params.id);
    const item = await tasksService.addChecklistItem(req.params.id, title);
    return res.status(201).json({ success: true, data: item });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Toggle checklist item
tasksRouter.patch('/checklist/:itemId/toggle', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { isCompleted } = req.body;
    if (typeof isCompleted !== 'boolean') return res.status(400).json({ success: false, error: { message: 'isCompleted must be boolean' } });
    const checklist = await db.taskChecklistItem.findUnique({ where: { id: req.params.itemId } });
    if (!checklist) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy checklist item' } });
    }
    await permissionService.assertTaskMutation(req.user!, checklist.taskId);
    const item = await tasksService.toggleChecklistItem(req.params.itemId, req.user!.userId, !!isCompleted);
    return res.status(200).json({ success: true, data: item });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Thêm dependency
tasksRouter.post('/:id/dependencies', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { dependsOnTaskId } = req.body;
    if (!dependsOnTaskId) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu dependsOnTaskId' } });
    }
    await permissionService.assertTaskMutation(req.user!, req.params.id);
    await permissionService.assertTaskRead(req.user!, dependsOnTaskId);
    const dep = await tasksService.addDependency(req.params.id, dependsOnTaskId);
    return res.status(201).json({ success: true, data: dep });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
