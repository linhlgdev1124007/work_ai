import { Router, Request, Response } from 'express';
import { reportsService } from './reports.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/auth.middleware';

export const reportsRouter = Router();

// Thống kê KPI Dashboard
reportsRouter.get('/summary', authMiddleware, async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    const summary = await reportsService.getDashboardSummary(req.user!, teamId);
    return res.status(200).json({ success: true, data: summary });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Xuất CSV danh sách tasks
reportsRouter.get('/export/tasks', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const csvData = await reportsService.exportTasksToCsv(req.user!.orgId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks_report.csv"');
    return res.send(csvData);
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Xuất CSV bảng điểm danh
reportsRouter.get('/export/attendance', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const csvData = await reportsService.exportAttendanceToCsv(req.user!.orgId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
    return res.send(csvData);
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
