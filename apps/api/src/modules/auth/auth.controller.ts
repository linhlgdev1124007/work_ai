import { Router, Request, Response } from 'express';
import { authService } from './auth.service';
import { LoginSchema, ChangePasswordSchema } from '@work-ai/shared';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getBearerToken } from '../../services/security.service';
import { rateLimit } from 'express-rate-limit';

export const authRouter = Router();
authRouter.use('/login', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau.' } }
}));

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const parseResult = LoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ'
        }
      });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authService.login(parseResult.data, ipAddress, userAgent);

    // Lưu Cookie HttpOnly an toàn
    res.cookie('work_session', result.token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 ngày
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_FAILED', message: error.message }
    });
  }
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.['work_session'] || getBearerToken(req.headers.authorization);
    if (token) {
      const sessionId = await authService.logout(token);
      if (sessionId) req.app.get('socketio')?.in(`session_${sessionId}`).disconnectSockets(true);
    }
    res.clearCookie('work_session');
    return res.status(200).json({ success: true, message: 'Đăng xuất thành công' });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: { code: 'LOGOUT_ERROR', message: error.message }
    });
  }
});

authRouter.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const profile = await authService.getMe(req.user!.userId);
    return res.status(200).json({ success: true, data: profile });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: error.message }
    });
  }
});

authRouter.get('/me/bootstrap', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = await authService.getBootstrap(req.user!.userId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: error.message }
    });
  }
});

authRouter.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parseResult = ChangePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'Dữ liệu không hợp lệ'
        }
      });
    }

    const result = await authService.changePassword(req.user!.userId, parseResult.data);
    req.app.get('socketio')?.in(`user_${req.user!.userId}`).disconnectSockets(true);
    res.clearCookie('work_session');
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: { code: 'CHANGE_PASSWORD_FAILED', message: error.message }
    });
  }
});
