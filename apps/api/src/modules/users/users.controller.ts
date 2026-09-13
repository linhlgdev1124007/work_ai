import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { db } from '../../services/db.service';
import { permissionService } from '../../services/permission.service';

export const usersRouter = Router();
usersRouter.use(authMiddleware);

usersRouter.get('/:id/notes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const notes = await db.userNote.findMany({
      where: { userId: id, orgId: req.user!.orgId },
      include: {
        creator: { select: { fullName: true, avatarUrl: true } },
        sourceMessage: { select: { content: true, conversationId: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return res.status(200).json({ success: true, data: notes });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message } });
  }
});
