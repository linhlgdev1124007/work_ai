import { Router, Request, Response } from 'express';
import { attendanceService } from './attendance.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { AttendanceAdjustmentRequestSchema } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';

export const attendanceRouter = Router();

// Lấy trạng thái hiện tại
attendanceRouter.get('/current', authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await attendanceService.getCurrentStatus(req.user!.userId);
    return res.status(200).json({ success: true, data: status });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Check-in vào ca
attendanceRouter.post('/in', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await attendanceService.checkIn(req.user!.userId, req.user!.orgId, req.body.note);
    return res.status(200).json({ success: true, data: session });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Check-out ra ca
attendanceRouter.post('/out', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await attendanceService.checkOut(req.user!.userId, req.body.note);
    return res.status(200).json({ success: true, data: session });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Gửi yêu cầu sửa công
attendanceRouter.post('/adjustments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = AttendanceAdjustmentRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ' }
      });
    }

    const adjustment = await attendanceService.requestAdjustment(req.user!.userId, req.user!.orgId, parseResult.data);
    return res.status(201).json({ success: true, data: adjustment });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Phê duyệt yêu cầu sửa công
attendanceRouter.post('/adjustments/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { isApproved, rejectionReason } = req.body;
    if (typeof isApproved !== 'boolean' || (rejectionReason !== undefined && typeof rejectionReason !== 'string')) return res.status(400).json({ success: false, error: { message: 'Invalid review data' } });
    const adjustment = await attendanceService.getAdjustmentById(req.params.id);
    if (!adjustment) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy yêu cầu điều chỉnh điểm danh.' } });
    }
    await permissionService.assertAttendanceReview(req.user!, adjustment.userId);

    const result = await attendanceService.approveAdjustment(
      req.params.id,
      req.user!.userId,
      !!isApproved,
      rejectionReason
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 400)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});

// Lịch sử điểm danh
attendanceRouter.get('/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const history = await attendanceService.getHistory(req.user!.userId);
    return res.status(200).json({ success: true, data: history });
  } catch (error: any) {
    return res.status(error.statusCode || (error.code === 'P2025' ? 409 : 500)).json({ success: false, error: { message: error.code?.startsWith('P') ? 'Data conflict or invalid reference' : error.message } });
  }
});
