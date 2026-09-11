import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { db } from '../../services/db.service';

export class AdminService {
  async getOverview(orgId: string) {
    const [users, teams, projects, pendingAdjustments] = await Promise.all([
      db.user.findMany({
        where: { orgId },
        select: {
          id: true,
          email: true,
          fullName: true,
          systemRole: true,
          status: true,
          mustChangePassword: true,
          teamMemberships: { include: { team: true } },
          projectMemberships: { include: { project: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      db.team.findMany({
        where: { orgId },
        include: { members: { include: { user: true } }, projects: true },
        orderBy: { createdAt: 'desc' }
      }),
      db.project.findMany({
        where: { orgId },
        include: { team: true, members: { include: { user: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      db.attendanceAdjustment.count({ where: { orgId, status: 'PENDING' } })
    ]);

    const usage = await db.aiTokenUsage.aggregate({ where: { orgId }, _sum: { inputTokens: true, cachedInputTokens: true, outputTokens: true }, _count: true, _min: { createdAt: true } });
    return { users, teams, projects, pendingAdjustments, tokenUsage: { ...usage._sum, requests: usage._count, since: usage._min.createdAt } };
  }

  async createUser(orgId: string, dto: { email: string; fullName: string; password?: string; systemRole?: string }) {
    const password = dto.password || randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: {
        orgId,
        email: dto.email.toLowerCase().trim(),
        fullName: dto.fullName.trim(),
        passwordHash,
        systemRole: dto.systemRole === 'ADMIN' ? 'ADMIN' : 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: true
      }
    });

    return { user, temporaryPassword: password };
  }

  async updateUserStatus(orgId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const user = await db.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new Error('Không tìm thấy người dùng');

    const updated = await db.user.update({
      where: { id: userId },
      data: { status, version: { increment: 1 } }
    });

    if (status === 'SUSPENDED') {
      await db.session.deleteMany({ where: { userId } });
    }

    return updated;
  }

  async resetPassword(orgId: string, userId: string, temporaryPassword = randomBytes(18).toString('base64url')) {
    if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 12 || temporaryPassword.length > 72) throw new Error('Password must contain 12-72 characters');
    const user = await db.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new Error('Không tìm thấy người dùng');

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await db.session.deleteMany({ where: { userId } });
    const updated = await db.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, version: { increment: 1 } }
    });

    return { user: updated, temporaryPassword };
  }

  async createTeam(orgId: string, dto: { name: string; description?: string }) {
    if (typeof dto.name !== 'string' || !dto.name.trim() || dto.name.length > 200 || (dto.description !== undefined && typeof dto.description !== 'string')) throw new Error('Invalid team data');
    return db.team.create({
      data: {
        orgId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null
      }
    });
  }

  async createProject(orgId: string, dto: { teamId: string; name: string; code: string; description?: string }) {
    if (typeof dto.name !== 'string' || !dto.name.trim() || typeof dto.code !== 'string' || !dto.code.trim() || (dto.description !== undefined && typeof dto.description !== 'string')) throw new Error('Invalid project data');
    const team = await db.team.findFirst({ where: { id: dto.teamId, orgId } });
    if (!team) throw new Error('Team không tồn tại');

    return db.project.create({
      data: {
        orgId,
        teamId: dto.teamId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        description: dto.description?.trim() || null
      }
    });
  }

  async setTeamMember(orgId: string, teamId: string, userId: string, role: 'LEAD' | 'MEMBER') {
    const [team, user] = await Promise.all([
      db.team.findFirst({ where: { id: teamId, orgId } }),
      db.user.findFirst({ where: { id: userId, orgId } })
    ]);
    if (!team || !user) throw new Error('Team hoặc người dùng không tồn tại');

    return db.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      update: { role },
      create: { teamId, userId, role }
    });
  }
}

export const adminService = new AdminService();
