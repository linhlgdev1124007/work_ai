import { Request, Response, NextFunction } from 'express';
import { db } from '../services/db.service';
import { SystemRole, UserSession } from '@work-ai/shared';
import { getBearerToken, hashSessionToken } from '../services/security.service';

// Mở rộng Request type của Express để lưu user session
declare global {
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // 1. Lấy token từ Cookie hoặc Authorization Header
    const token = req.cookies?.['work_session'] || getBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập để truy cập tài nguyên này' }
      });
    }

    // 2. Tìm session trong CSDL
    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SESSION', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' }
      });
    }

    // Kiểm tra thời gian hết hạn
    if (new Date() > session.expiresAt) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      return res.status(401).json({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' }
      });
    }

    // Kiểm tra tài khoản có bị khóa không
    if (session.user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: 'Tài khoản của bạn đã bị tạm khóa bởi Quản trị viên' }
      });
    }

    // Gắn thông tin người dùng vào Request
    req.user = {
      id: session.id,
      userId: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      avatarUrl: session.user.avatarUrl,
      systemRole: session.user.systemRole as SystemRole,
      orgId: session.user.orgId,
      mustChangePassword: session.user.mustChangePassword
    };

    if (session.user.mustChangePassword && !['/api/v1/auth/me', '/api/v1/auth/me/bootstrap', '/api/v1/auth/change-password'].includes(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ success: false, error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Vui lòng đổi mật khẩu trước khi tiếp tục' } });
    }
    next();
  } catch (error: any) {
    console.error('Lỗi authMiddleware:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Lỗi xác thực người dùng' }
    });
  }
}

// Guard yêu cầu quyền Admin
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.systemRole !== SystemRole.ADMIN) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Chức năng này chỉ dành riêng cho Quản trị viên (Admin)' }
    });
  }
  next();
}

// Guard kiểm tra quyền Team Lead
export async function requireTeamLead(teamId: string, userId: string): Promise<boolean> {
  const membership = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } }
  });
  return membership?.role === 'LEAD';
}
