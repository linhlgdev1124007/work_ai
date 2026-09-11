import { Prisma, User } from '@work-ai/database';
import { SystemRole, TaskStatus, TeamMemberRole } from '@work-ai/shared';
import { db } from './db.service';

type SessionUser = {
  userId: string;
  orgId: string;
  systemRole: SystemRole | string;
};

export class ForbiddenError extends Error {
  statusCode = 403;
  code = 'FORBIDDEN';

  constructor(message = 'Bạn không có quyền thực hiện thao tác này') {
    super(message);
  }
}

export class PermissionService {
  isAdmin(user: SessionUser) {
    return user.systemRole === SystemRole.ADMIN;
  }

  async assertConversationAccess(user: SessionUser, conversationId: string, auditReason?: string) {
    if (this.isAdmin(user)) {
      await this.auditAdminPrivateConversationAccess(user, conversationId, auditReason);
      return;
    }

    const membership = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.userId } }
    });

    if (!membership) {
      throw new ForbiddenError('Bạn không có quyền truy cập hội thoại này');
    }
  }

  async getReadableConversationIds(user: SessionUser) {
    if (this.isAdmin(user)) {
      const conversations = await db.conversation.findMany({
        where: { orgId: user.orgId },
        select: { id: true }
      });
      return conversations.map(c => c.id);
    }

    const memberships = await db.conversationMember.findMany({
      where: { userId: user.userId },
      select: { conversationId: true }
    });
    return memberships.map(m => m.conversationId);
  }

  async assertTaskRead(user: SessionUser, taskId: string) {
    const target = await db.task.findFirst({ where: { id: taskId, orgId: user.orgId } });
    if (!target) throw new ForbiddenError('Bạn không có quyền xem công việc này');
    if (this.isAdmin(user)) return;

    const task = await db.task.findFirst({
      where: {
        id: taskId,
        orgId: user.orgId,
        OR: [
          { assigneeId: user.userId },
          { creatorId: user.userId },
          { team: { members: { some: { userId: user.userId } } } },
          { project: { members: { some: { userId: user.userId } } } },
          { sourceConversationId: { in: await this.getReadableConversationIds(user) } }
        ]
      },
      select: { id: true }
    });

    if (!task) {
      throw new ForbiddenError('Bạn không có quyền xem công việc này');
    }
  }

  readableTaskWhere(user: SessionUser): Prisma.TaskWhereInput {
    if (this.isAdmin(user)) {
      return { orgId: user.orgId, isArchived: false };
    }

    return {
      orgId: user.orgId,
      isArchived: false,
      OR: [
        { assigneeId: user.userId },
        { creatorId: user.userId },
        { team: { members: { some: { userId: user.userId } } } },
        { project: { members: { some: { userId: user.userId } } } },
        { sourceConversation: { members: { some: { userId: user.userId } } } }
      ]
    };
  }

  async assertTaskMutation(user: SessionUser, taskId: string, patch?: { assigneeId?: string | null; deadline?: string | null; status?: string; requiresReview?: boolean; overrideReason?: string }) {
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task || task.orgId !== user.orgId) {
      throw new ForbiddenError('Bạn không có quyền cập nhật công việc này');
    }

    if (patch?.assigneeId) {
      const assignee = await db.user.findFirst({ where: { id: patch.assigneeId, orgId: user.orgId, status: 'ACTIVE' } });
      if (!assignee) throw new ForbiddenError('Người được giao không thuộc tổ chức');
    }

    if (this.isAdmin(user)) return;

    const roomLead = task.sourceConversationId ? await this.isConversationLead(user.userId, task.sourceConversationId) : false;
    if (roomLead && patch?.assigneeId && !await db.conversationMember.findFirst({ where: { conversationId: task.sourceConversationId!, userId: patch.assigneeId } })) throw new ForbiddenError('Chỉ phân việc cho thành viên nhóm chat');
    const isLead = roomLead || (task.teamId ? await this.isTeamLead(user.userId, task.teamId) : false);
    const isOwner = task.assigneeId === user.userId || task.creatorId === user.userId;
    if (!isOwner && !isLead) {
      throw new ForbiddenError('Bạn không có quyền cập nhật công việc này');
    }

    if (!isLead && task.creatorId !== user.userId) {
      if (patch?.requiresReview !== undefined || patch?.overrideReason) throw new ForbiddenError('Chỉ người tạo hoặc quản lý được thay đổi yêu cầu duyệt');
      if (patch?.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) {
        throw new ForbiddenError('Thành viên không được tự chuyển công việc cho người khác');
      }
      if (patch?.deadline !== undefined) {
        throw new ForbiddenError('Thành viên không được tự sửa deadline của công việc được giao');
      }
      if (patch?.status === TaskStatus.COMPLETED && task.requiresReview) {
        throw new ForbiddenError('Công việc này cần lead hoặc admin duyệt hoàn thành');
      }
    }
  }

  async assertCanCreateTask(user: SessionUser, dto: { teamId?: string | null; projectId?: string | null; assigneeId?: string | null; sourceConversationId?: string | null }) {
    if (dto.teamId && !await db.team.findFirst({ where: { id: dto.teamId, orgId: user.orgId } })) throw new ForbiddenError();
    if (dto.projectId && !await db.project.findFirst({ where: { id: dto.projectId, orgId: user.orgId, ...(dto.teamId ? { teamId: dto.teamId } : {}) } })) throw new ForbiddenError();
    if (dto.assigneeId && !await db.user.findFirst({ where: { id: dto.assigneeId, orgId: user.orgId, status: 'ACTIVE' } })) throw new ForbiddenError();
    if (this.isAdmin(user)) return;

    if (dto.sourceConversationId && await this.isConversationLead(user.userId, dto.sourceConversationId)) {
      const room = await db.conversation.findFirst({ where: { id: dto.sourceConversationId, orgId: user.orgId } });
      if (!room || (dto.teamId && room.teamId !== dto.teamId) || (dto.projectId && room.projectId !== dto.projectId)) throw new ForbiddenError();
      if (dto.assigneeId && !await db.conversationMember.findFirst({ where: { conversationId: room.id, userId: dto.assigneeId } })) throw new ForbiddenError('Chỉ phân việc cho thành viên nhóm chat');
      return;
    }

    if (dto.projectId) {
      const projectMember = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: dto.projectId, userId: user.userId } }
      });
      if (!projectMember) throw new ForbiddenError('Bạn không có quyền tạo công việc trong dự án này');
    }

    if (dto.teamId) {
      const teamMember = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: dto.teamId, userId: user.userId } }
      });
      if (!teamMember) throw new ForbiddenError('Bạn không có quyền tạo công việc trong team này');
    }

    if (dto.assigneeId && dto.assigneeId !== user.userId) {
      const canAssign = dto.teamId ? await this.isTeamLead(user.userId, dto.teamId) : false;
      if (!canAssign) throw new ForbiddenError('Thành viên chỉ được tạo công việc cho chính mình');
    }
  }

  async assertAttendanceReview(user: SessionUser, adjustmentUserId: string) {
    if (!await db.user.findFirst({ where: { id: adjustmentUserId, orgId: user.orgId } })) throw new ForbiddenError();
    if (this.isAdmin(user)) return;

    const sharedLeadTeam = await db.teamMember.findFirst({
      where: {
        userId: user.userId,
        role: TeamMemberRole.LEAD,
        team: { members: { some: { userId: adjustmentUserId } } }
      }
    });

    if (!sharedLeadTeam) {
      throw new ForbiddenError('Bạn không có quyền duyệt yêu cầu điều chỉnh công này');
    }
  }

  async scopedUsers(user: SessionUser): Promise<User[]> {
    if (this.isAdmin(user)) {
      return db.user.findMany({ where: { orgId: user.orgId, status: 'ACTIVE' } });
    }

    const leadTeams = await db.teamMember.findMany({
      where: { userId: user.userId, role: TeamMemberRole.LEAD },
      select: { teamId: true }
    });

    if (leadTeams.length === 0) {
      return db.user.findMany({ where: { id: user.userId, status: 'ACTIVE' } });
    }

    return db.user.findMany({
      where: {
        orgId: user.orgId,
        status: 'ACTIVE',
        teamMemberships: { some: { teamId: { in: leadTeams.map(t => t.teamId) } } }
      }
    });
  }

  async isTeamLead(userId: string, teamId: string) {
    const membership = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    return membership?.role === TeamMemberRole.LEAD;
  }

  async isConversationLead(userId: string, conversationId: string) {
    return !!await db.conversationMember.findFirst({ where: { userId, conversationId, role: 'LEAD' } });
  }

  private async auditAdminPrivateConversationAccess(user: SessionUser, conversationId: string, reason?: string) {
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { members: true }
    });

    if (!conversation || conversation.orgId !== user.orgId) {
      throw new ForbiddenError('Bạn không có quyền truy cập hội thoại này');
    }

    const isParticipant = conversation.members.some(m => m.userId === user.userId);
    if (!isParticipant && ['DIRECT', 'GROUP'].includes(conversation.type)) {
      await db.auditEvent.create({
        data: {
          orgId: user.orgId,
          actorId: user.userId,
          action: 'ADMIN_READ_PRIVATE_CONVERSATION',
          entityType: 'CONVERSATION',
          entityId: conversationId,
          metadata: JSON.stringify({ reason: reason || 'admin_access' })
        }
      });
    }
  }
}

export const permissionService = new PermissionService();
