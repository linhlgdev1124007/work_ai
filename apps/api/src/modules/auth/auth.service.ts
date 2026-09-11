import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../services/db.service';
import { LoginDto, ChangePasswordDto, SystemRole } from '@work-ai/shared';
import { hashSessionToken } from '../../services/security.service';

export class AuthService {
  /**
   * Đăng nhập người dùng bằng email và mật khẩu
   */
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await db.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() }
    });

    if (!user) {
      throw new Error('Email hoặc mật khẩu không chính xác');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Tài khoản đã bị tạm khóa bởi Quản trị viên');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Email hoặc mật khẩu không chính xác');
    }

    // Tạo phiên đăng nhập (Session) - tồn tại 30 ngày
    const token = uuidv4() + '-' + uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const session = await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt
      }
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        systemRole: user.systemRole,
        orgId: user.orgId,
        mustChangePassword: user.mustChangePassword
      }
    };
  }

  /**
   * Đăng xuất và thu hồi session
   */
  async logout(token: string) {
    if (!token) return;
    const session = await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    await db.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) }
    });
    return session?.id;
  }

  /**
   * Đổi mật khẩu
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('Không tìm thấy tài khoản');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new Error('Mật khẩu hiện tại không đúng');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    await db.$transaction(async db => {
    await db.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        version: { increment: 1 }
      }
    });
    await db.session.deleteMany({ where: { userId } });
    });

    return { success: true, message: 'Đổi mật khẩu thành công' };
  }

  /**
   * Lấy thông tin user hiện tại kèm các team và project
   */
  async getMe(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        teamMemberships: {
          include: { team: true }
        },
        projectMemberships: {
          include: { project: true }
        },
        organization: true
      }
    });

    if (!user) {
      throw new Error('Không tìm thấy tài khoản');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      systemRole: user.systemRole,
      orgId: user.orgId,
      organizationName: user.organization.name,
      mustChangePassword: user.mustChangePassword,
      teams: user.teamMemberships.map(m => ({
        id: m.team.id,
        name: m.team.name,
        role: m.role
      })),
      projects: user.projectMemberships.map(p => ({
        id: p.project.id,
        name: p.project.name,
        code: p.project.code
      }))
    };
  }

  async getBootstrap(userId: string) {
    const profile = await this.getMe(userId);
    const [unreadConversations, unreadNotifications] = await Promise.all([
      db.conversationMember.count({ where: { userId, unreadCount: { gt: 0 } } }),
      db.notification.count({ where: { userId, isRead: false } })
    ]);

    return {
      user: profile,
      permissions: {
        isAdmin: profile.systemRole === SystemRole.ADMIN,
        leadTeamIds: profile.teams.filter(team => team.role === 'LEAD').map(team => team.id)
      },
      counters: {
        unreadConversations,
        unreadNotifications
      },
      featureFlags: {
        realtime: true,
        aiAssistant: true,
        attendance: true,
        adminConsole: profile.systemRole === SystemRole.ADMIN
      }
    };
  }
}

export const authService = new AuthService();
