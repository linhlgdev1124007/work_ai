import { db } from '../../services/db.service';
import { permissionService } from '../../services/permission.service';
import { Prisma } from '@work-ai/database';

export function removeVietnameseTones(str: string): string {
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
  str = str.replace(/đ/g, 'd');
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
  str = str.replace(/Đ/g, 'D');
  return str.toLowerCase().trim();
}

export class SearchService {
  /**
   * Universal Search: Tìm kiếm đa bảng (Tasks, Messages, Files, Users)
   * Tuân thủ phân quyền và hỗ trợ tiếng Việt không dấu
   */
  async universalSearch(query: string, user: { userId: string; orgId: string; systemRole: string }) {
    if (!query || query.trim().length === 0) {
      return { tasks: [], messages: [], users: [] };
    }

    const cleanQuery = query.trim();
    const queryNoTones = removeVietnameseTones(cleanQuery);
    const taskMatches = await db.$queryRaw<Array<{ id: string }>>`
      SELECT t.id FROM "Task" t LEFT JOIN "User" u ON t."assigneeId" = u.id
      WHERE t."orgId" = ${user.orgId} AND NOT t."isArchived"
      AND position(unaccent(lower(${cleanQuery})) in unaccent(lower(concat_ws(' ', t.title, t.description, u."fullName")))) > 0`;

    // 1. Tìm Tasks
    const allTasks = await db.task.findMany({
      where: {
        ...permissionService.readableTaskWhere(user),
        id: { in: taskMatches.map(task => task.id) }
      },
      include: {
        assignee: true,
        team: true,
        project: true
      },
      take: 10,
      orderBy: { updatedAt: 'desc' }
    });

    const matchedTasks = allTasks.filter(t => {
      const titleMatch = removeVietnameseTones(t.title).includes(queryNoTones);
      const descMatch = t.description ? removeVietnameseTones(t.description).includes(queryNoTones) : false;
      const assigneeMatch = t.assignee ? removeVietnameseTones(t.assignee.fullName).includes(queryNoTones) : false;
      return titleMatch || descMatch || assigneeMatch;
    }).slice(0, 10);

    // 2. Tìm Messages (Chỉ tìm trong những hội thoại mà user có quyền truy cập)
    const myConversations = await db.conversationMember.findMany({
      where: permissionService.isAdmin(user) ? { conversation: { orgId: user.orgId } } : { userId: user.userId },
      select: { conversationId: true }
    });
    const convIds = myConversations.map(c => c.conversationId);
    const messageMatches = convIds.length ? await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Message" WHERE "conversationId" IN (${Prisma.join(convIds)}) AND NOT "isDeleted"
      AND position(unaccent(lower(${cleanQuery})) in unaccent(lower(content))) > 0
      ORDER BY "createdAt" DESC LIMIT 10` : [];

    const allMessages = await db.message.findMany({
      where: {
        conversationId: { in: convIds },
        id: { in: messageMatches.map(message => message.id) },
        isDeleted: false
      },
      include: {
        sender: true,
        conversation: true
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    const matchedMessages = allMessages.filter(m => {
      return removeVietnameseTones(m.content).includes(queryNoTones);
    }).slice(0, 10);

    // 3. Tìm Thành viên (Users)
    const userMatches = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "User" WHERE "orgId" = ${user.orgId} AND status = 'ACTIVE'
      AND position(unaccent(lower(${cleanQuery})) in unaccent(lower(concat_ws(' ', "fullName", email)))) > 0
      ORDER BY "fullName" LIMIT 5`;
    const allUsers = await db.user.findMany({
      where: { orgId: user.orgId, status: 'ACTIVE', id: { in: userMatches.map(member => member.id) } },
      take: 5
    });

    const matchedUsers = allUsers.filter(u => {
      return removeVietnameseTones(u.fullName).includes(queryNoTones) || u.email.includes(cleanQuery.toLowerCase());
    }).slice(0, 5);

    return {
      tasks: matchedTasks,
      messages: matchedMessages,
      users: matchedUsers
    };
  }
}

export const searchService = new SearchService();
