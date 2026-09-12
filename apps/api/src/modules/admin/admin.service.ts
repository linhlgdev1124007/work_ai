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
        include: { team: { include: { members: { include: { user: true } } } }, members: { include: { user: true } } },
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

  async createProject(orgId: string, dto: { teamId: string; name: string; code: string; description?: string; leadIds?: string[] }) {
    if (typeof dto.name !== 'string' || !dto.name.trim() || typeof dto.code !== 'string' || !dto.code.trim() || (dto.description !== undefined && typeof dto.description !== 'string')) throw new Error('Invalid project data');
    const leadIds = [...new Set(dto.leadIds || [])];
    if (leadIds.length > 2) throw new Error('Mỗi dự án chỉ có tối đa 2 lead');
    const team = await db.team.findFirst({
      where: { id: dto.teamId, orgId },
      include: { members: { where: { user: { status: 'ACTIVE' } }, select: { userId: true } } }
    });
    if (!team) throw new Error('Team không tồn tại');
    const memberIds = team.members.map(member => member.userId);
    if (leadIds.some(userId => !memberIds.includes(userId))) throw new Error('Lead phải là thành viên đang hoạt động của team');

    return db.$transaction(async tx => {
      const project = await tx.project.create({
        data: {
          orgId,
          teamId: dto.teamId,
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          description: dto.description?.trim() || null
        }
      });
      const members = memberIds.map(userId => ({ projectId: project.id, userId, role: leadIds.includes(userId) ? 'LEAD' : 'MEMBER' }));
      if (members.length) await tx.projectMember.createMany({ data: members });
      const conversation = await tx.conversation.create({
        data: { orgId, teamId: dto.teamId, projectId: project.id, type: 'PROJECT', name: project.name }
      });
      if (members.length) await tx.conversationMember.createMany({ data: members.map(member => ({ conversationId: conversation.id, userId: member.userId, role: member.role })) });
      return { project, conversation };
    });
  }

  async setProjectMember(orgId: string, projectId: string, userId: string, role: 'LEAD' | 'MEMBER') {
    const project = await db.project.findFirst({ where: { id: projectId, orgId } });
    if (!project) throw new Error('Dự án không tồn tại');
    const teamMember = await db.teamMember.findFirst({ where: { teamId: project.teamId, userId, user: { orgId, status: 'ACTIVE' } } });
    if (!teamMember) throw new Error('Người dùng phải là thành viên đang hoạt động của team dự án');
    if (role === 'LEAD') {
      const existingLeads = await db.projectMember.count({ where: { projectId, role: 'LEAD', userId: { not: userId } } });
      if (existingLeads >= 2) throw new Error('Mỗi dự án chỉ có tối đa 2 lead');
    }
    return db.$transaction(async tx => {
      const member = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: { role },
        create: { projectId, userId, role }
      });
      const conversation = await tx.conversation.findFirst({ where: { projectId, orgId, type: 'PROJECT' } });
      if (conversation) await tx.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: conversation.id, userId } },
        update: { role },
        create: { conversationId: conversation.id, userId, role }
      });
      return member;
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
