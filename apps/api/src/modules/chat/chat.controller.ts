import { Router, Request, Response } from 'express';
import { chatService } from './chat.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { SendMessageSchema } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';
import { db } from '../../services/db.service';

export const chatRouter = Router();

// Lấy danh sách hội thoại của người dùng
chatRouter.get('/conversations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const list = await chatService.getUserConversations(req.user!);
    return res.status(200).json({ success: true, data: list });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Lấy tin nhắn trong hội thoại
chatRouter.get('/conversations/:id/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const data = await chatService.getMessages(req.user!, req.params.id, limit, cursor);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Gửi tin nhắn mới
chatRouter.post('/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = SendMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ' }
      });
    }

    const io = (req.app as any).get('socketio');
    const msg = await chatService.sendMessage(req.user!, parseResult.data, io);
    return res.status(201).json({ success: true, data: msg });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Đánh dấu đã đọc
chatRouter.post('/conversations/:id/read', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { messageId } = req.body;
    await permissionService.assertConversationAccess(req.user!, req.params.id, 'mark_read');
    await chatService.markAsRead(req.params.id, req.user!.userId, messageId);
    req.app.get('socketio')?.to(`conv_${req.params.id}`).emit('conversation.read', { conversationId: req.params.id, receipts: await chatService.getReceipts(req.params.id) });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

chatRouter.patch('/conversations/:id/lead', authMiddleware, async (req, res) => {
  try {
    if (req.body.userId !== null && typeof req.body.userId !== 'string') return res.status(400).json({ success: false, error: { message: 'Invalid userId' } });
    const data = await chatService.setLead(req.user!, req.params.id, req.body.userId);
    req.app.get('socketio')?.to(`conv_${req.params.id}`).emit('conversation.updated', { conversationId: req.params.id });
    return res.json({ success: true, data });
  } catch (e: any) { return res.status(e.statusCode || 400).json({ success: false, error: { message: e.message } }); }
});

chatRouter.get('/conversations/:id/tasks', authMiddleware, async (req, res) => {
  try {
    await permissionService.assertConversationAccess(req.user!, req.params.id, 'room_tasks');
    const where = { orgId: req.user!.orgId, sourceConversationId: req.params.id, isArchived: false };
    const tasks = await db.task.findMany({ where, orderBy: [{ status: 'asc' }, { deadline: 'asc' }, { id: 'asc' }], take: 200, include: { assignee: { select: { id: true, fullName: true } } } });
    const counts = await db.task.groupBy({ by: ['status'], where, _count: true });
    return res.json({ success: true, data: { tasks, counts, total: counts.reduce((sum, row) => sum + row._count, 0), asOf: new Date().toISOString() } });
  } catch (e: any) { return res.status(e.statusCode || 400).json({ success: false, error: { message: e.message } }); }
});
