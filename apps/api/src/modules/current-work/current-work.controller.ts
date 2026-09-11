import { Router, Request, Response } from 'express';
import { currentWorkService } from './current-work.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { SetCurrentWorkSchema } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';

export const currentWorkRouter = Router();

// Lấy current work của chính user
currentWorkRouter.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const work = await currentWorkService.getUserCurrentWork(req.user!.userId);
    return res.status(200).json({ success: true, data: work });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Cập nhật current work
currentWorkRouter.post('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = SetCurrentWorkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ' }
      });
    }

    if (parseResult.data.taskId) {
      await permissionService.assertTaskMutation(req.user!, parseResult.data.taskId);
    }
    const updated = await currentWorkService.setCurrentWork(req.user!.userId, parseResult.data);
    const io = (req.app as any).get('socketio');
    io?.to(`user_${req.user!.userId}`).emit('current_work.updated', updated);
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Màn hình "Ai đang làm gì" cho Quản lý & Đội nhóm
currentWorkRouter.get('/who-is-doing-what', authMiddleware, async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    const list = await currentWorkService.getWhoIsDoingWhat(req.user!, teamId);
    return res.status(200).json({ success: true, data: list });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
