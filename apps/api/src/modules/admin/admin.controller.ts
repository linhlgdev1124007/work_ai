import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { adminService } from './admin.service';
import { permissionService } from '../../services/permission.service';
import { z } from 'zod';

export const adminRouter = Router();

adminRouter.use(authMiddleware);

function requireSystemAdmin(req: Request, res: Response) {
  if (permissionService.isAdmin(req.user!)) return true;
  res.status(403).json({ success: false, error: { message: 'Chỉ quản trị viên hệ thống có quyền thực hiện thao tác này' } });
  return false;
}

async function requireTeamManager(req: Request, res: Response, teamId: string) {
  if (permissionService.isAdmin(req.user!) || await permissionService.isTeamLead(req.user!.userId, teamId)) return true;
  res.status(403).json({ success: false, error: { message: 'Chỉ lead của team mới có quyền thực hiện thao tác này' } });
  return false;
}

adminRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const data = await adminService.getOverview(req.user!.orgId, req.user!.userId, permissionService.isAdmin(req.user!));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/users', async (req: Request, res: Response) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
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
    if (!requireSystemAdmin(req, res)) return;
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
    if (!requireSystemAdmin(req, res)) return;
    const data = await adminService.resetPassword(req.user!.orgId, req.params.id, req.body.temporaryPassword);
    req.app.get('socketio')?.in(`user_${req.params.id}`).disconnectSockets(true);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.post('/teams', async (req: Request, res: Response) => {
  try {
    if (!requireSystemAdmin(req, res)) return;
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
    const { teamId, name, code } = req.body;
    if (!teamId || !name || !code) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu team, tên hoặc mã dự án' } });
    }
    if (!await requireTeamManager(req, res, teamId)) return;
    const data = await adminService.createProject(req.user!.orgId, { teamId, name, code, description: req.body.description });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.put('/teams/:teamId/members/:userId', async (req: Request, res: Response) => {
  try {
    if (!await requireTeamManager(req, res, req.params.teamId)) return;
    const role = z.enum(['LEAD', 'MEMBER']).parse(req.body.role);
    const data = await adminService.setTeamMember(req.user!.orgId, req.params.teamId, req.params.userId, role);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

adminRouter.delete('/teams/:teamId/members/:userId', async (req: Request, res: Response) => {
  try {
    if (!await requireTeamManager(req, res, req.params.teamId)) return;
    await adminService.removeTeamMember(req.user!.orgId, req.params.teamId, req.params.userId);
    return res.status(204).send();
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({ success: false, error: { message: error.message } });
  }
});
