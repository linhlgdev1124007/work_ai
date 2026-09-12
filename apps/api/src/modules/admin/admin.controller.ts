import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware';
import { adminService } from './admin.service';
import { z } from 'zod';

export const adminRouter = Router();

adminRouter.use(authMiddleware, requireAdmin);

adminRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const data = await adminService.getOverview(req.user!.orgId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, fullName, password, systemRole } = z.object({
      email: z.string().trim().email().max(254), fullName: z.string().trim().min(1).max(200),
      password: z.string().min(12).max(72).optional(), systemRole: z.enum(['ADMIN', 'MEMBER']).optional()
    }).parse(req.body);
    if (!email || !fullName) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu email hoặc họ tên' } });
    }
    const data = await adminService.createUser(req.user!.orgId, { email, fullName, password, systemRole });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.patch('/users/:id/status', async (req: Request, res: Response) => {
  try {
    const status = z.enum(['ACTIVE', 'SUSPENDED']).parse(req.body.status);
    if (req.params.id === req.user!.userId && status === 'SUSPENDED') return res.status(400).json({ success: false, error: { message: 'Cannot suspend your own account' } });
    const data = await adminService.updateUserStatus(req.user!.orgId, req.params.id, status);
    if (status === 'SUSPENDED') req.app.get('socketio')?.in(`user_${req.params.id}`).disconnectSockets(true);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const data = await adminService.resetPassword(req.user!.orgId, req.params.id, req.body.temporaryPassword);
    req.app.get('socketio')?.in(`user_${req.params.id}`).disconnectSockets(true);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/teams', async (req: Request, res: Response) => {
  try {
    if (!req.body.name) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu tên team' } });
    }
    const data = await adminService.createTeam(req.user!.orgId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/projects', async (req: Request, res: Response) => {
  try {
    const { teamId, name, code, leadIds } = req.body;
    if (!teamId || !name || !code) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu team, tên hoặc mã dự án' } });
    }
    if (leadIds !== undefined && (!Array.isArray(leadIds) || leadIds.some(id => typeof id !== 'string'))) return res.status(400).json({ success: false, error: { message: 'Danh sách lead không hợp lệ' } });
    const data = await adminService.createProject(req.user!.orgId, { ...req.body, leadIds });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.put('/projects/:projectId/members/:userId', async (req: Request, res: Response) => {
  try {
    const role = z.enum(['LEAD', 'MEMBER']).parse(req.body.role);
    const data = await adminService.setProjectMember(req.user!.orgId, req.params.projectId, req.params.userId, role);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({ success: false, error: { message: error.message } });
  }
});

adminRouter.put('/teams/:teamId/members/:userId', async (req: Request, res: Response) => {
  try {
    const role = z.enum(['LEAD', 'MEMBER']).parse(req.body.role);
    const data = await adminService.setTeamMember(req.user!.orgId, req.params.teamId, req.params.userId, role);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
