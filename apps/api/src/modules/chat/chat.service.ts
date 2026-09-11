import { db } from '../../services/db.service';
import { SendMessageDto, ConversationType } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';
import { aiQueueService } from '../queue/ai-queue.service';
import { publicData } from '../../services/public-data';

export class ChatService {
  /**
   * Lấy danh sách hội thoại mà user tham gia
   */
  async getUserConversations(user: { userId: string; orgId: string; systemRole: string }) {
    const conversationWhere = permissionService.isAdmin(user)
      ? { orgId: user.orgId }
      : { members: { some: { userId: user.userId } } };

    const conversations = await db.conversation.findMany({
      where: conversationWhere,
      include: {
        team: true,
        project: true,
        members: { include: { user: true } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    return conversations.map(conv => {
      const lastMsg = conv.messages[0];
      const me = conv.members.find(m => m.userId === user.userId);
      return {
        id: conv.id,
        type: conv.type,
        name: conv.name,
        teamName: conv.team?.name,
        projectName: conv.project?.name,
        unreadCount: me?.unreadCount || 0,
        lastMessage: lastMsg ? {
          content: lastMsg.content,
          senderName: lastMsg.sender.fullName,
          createdAt: lastMsg.createdAt
        } : null,
        members: conv.members.map(mb => ({
          id: mb.user.id,
          role: mb.role,
          lastReadMessageId: mb.lastReadMessageId,
          fullName: mb.user.fullName,
          avatarUrl: mb.user.avatarUrl
        }))
      };
    });
  }

  /**
   * Lấy tin nhắn trong một hội thoại (Cursor pagination)
   */
  async getMessages(user: { userId: string; orgId: string; systemRole: string }, conversationId: string, limit = 30, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('limit must be between 1 and 100'), { statusCode: 400 });
    await permissionService.assertConversationAccess(user, conversationId, 'read_messages');

    const messages = await db.message.findMany({
      where: { conversationId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        aiActions: true,
        tasksCreated: true
      }
    });

    return {
      receipts: await this.getReceipts(conversationId),
      messages: messages.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null
    };
  }

  /**
   * Gửi tin nhắn mới
   * Tự động trigger luồng AI xử lý bất đồng bộ
   */
  async sendMessage(user: { userId: string; orgId: string; systemRole: string }, dto: SendMessageDto, io?: any) {
    await permissionService.assertConversationAccess(user, dto.conversationId, 'send_message');

    const message = await db.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${dto.conversationId} FOR UPDATE`;
    const mentionIds = [...new Set(dto.mentionIds || [])].sort();
    const duplicate = await db.message.findUnique({ where: { clientMessageId: dto.clientMessageId }, include: { sender: true, replyTo: { include: { sender: true } } } });
    if (duplicate) {
      if (JSON.stringify([...duplicate.mentionIds].sort()) !== JSON.stringify(mentionIds)) throw new Error('clientMessageId already used with different mentions');
      if (duplicate.senderId !== user.userId || duplicate.conversationId !== dto.conversationId || duplicate.content !== dto.content || duplicate.replyToId !== (dto.replyToId || null)) throw new Error('clientMessageId already used');
      return { record: duplicate, created: false };
    }
    if (dto.replyToId && !await db.message.findFirst({ where: { id: dto.replyToId, conversationId: dto.conversationId } })) throw new Error('Invalid reply message');
    if (dto.attachmentIds?.length) throw new Error('Attachments are not supported yet');
    const recipients = await db.conversationMember.findMany({ where: { conversationId: dto.conversationId, user: { orgId: user.orgId, status: 'ACTIVE' } }, include: { user: { select: { fullName: true } } } });
    if (mentionIds.some(id => !recipients.some(r => r.userId === id && dto.content.includes('@' + r.user.fullName)))) throw Object.assign(new Error('Chỉ tag thành viên trong hội thoại và giữ tên tag trong tin nhắn'), { statusCode: 400 });

    // A room-locked logical timestamp keeps read watermarks ordered during concurrent sends.
    const room = await db.conversation.findUniqueOrThrow({ where: { id: dto.conversationId }, select: { lastMessageAt: true } });
    const sentAt = new Date(Math.max(Date.now(), room.lastMessageAt.getTime() + 1));

    // 1. Lưu tin nhắn vào CSDL
    const message = await db.message.create({
      data: {
        conversationId: dto.conversationId,
        senderId: user.userId,
        content: dto.content,
        createdAt: sentAt,
        mentionIds,
        kind: process.env.AI_ENABLED === 'false' ? 'UNCLASSIFIED' : 'ANALYZING',
        assistantReply: process.env.AI_ENABLED === 'false' && /(^|\s)@b6(?=\s|$)/i.test(dto.content) ? 'B6 đang được tắt bởi quản trị viên. Chưa có thao tác nào được thực hiện.' : null,
        replyToId: dto.replyToId || null,
        clientMessageId: dto.clientMessageId
      },
      include: {
        sender: true,
        replyTo: { include: { sender: true } }
      }
    });

    // 2. Cập nhật thời điểm tin nhắn cuối của hội thoại
    await db.conversation.update({
      where: { id: dto.conversationId },
      data: { lastMessageAt: sentAt }
    });

    // 3. Tăng unreadCount cho các thành viên khác
    await db.conversationMember.updateMany({
      where: {
        conversationId: dto.conversationId,
        userId: { not: user.userId }
      },
      data: { unreadCount: { increment: 1 } }
    });
    await db.notification.createMany({ data: recipients.filter(r => r.userId !== user.userId).map(r => ({ orgId: user.orgId, userId: r.userId, type: mentionIds.includes(r.userId) ? 'MENTION' : 'MESSAGE', title: mentionIds.includes(r.userId) ? `${message.sender.fullName} đã nhắc đến bạn` : `${message.sender.fullName} gửi tin nhắn`, body: Array.from(dto.content).slice(0, 240).join(''), entityType: 'CONVERSATION', entityId: dto.conversationId, eventKey: `message:${message.id}:${r.userId}` })), skipDuplicates: true });
    return { record: message, created: true };
    });
    if (!message.created) return publicData(message.record);

    // 4. Phát sự kiện Realtime qua Socket.IO ngay lập tức
    if (io) {
      io.to(`conv_${dto.conversationId}`).emit('message.created', publicData(message.record));
    }

    // 5. Xử lý AI qua queue khi có Redis; fallback local giữ dev flow không bị gãy.
    void aiQueueService.enqueueIncomingMessage({
      messageId: message.record.id,
      conversationId: dto.conversationId,
      senderId: user.userId,
      content: dto.content,
      orgId: user.orgId
    }, io).catch(error => console.error('AI enqueue failed', error));

    return publicData(message.record);
  }

  /**
   * Đánh dấu đã đọc tin nhắn
   */
  async markAsRead(conversationId: string, userId: string, messageId: string) {
    if (typeof messageId !== 'string') throw Object.assign(new Error('Invalid messageId'), { statusCode: 400 });
    return db.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const message = await db.message.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw Object.assign(new Error('Invalid messageId'), { statusCode: 400 });
    const member = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) return { success: true };
    const previous = member.lastReadMessageId ? await db.message.findUnique({ where: { id: member.lastReadMessageId } }) : null;
    if (previous && (previous.createdAt > message.createdAt || (+previous.createdAt === +message.createdAt && previous.id >= message.id))) return { success: true };
    await db.readMarker.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: { lastReadId: messageId, updatedAt: new Date() },
      create: { conversationId, userId, lastReadId: messageId }
    });

    await db.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadMessageId: message.id, unreadCount: await db.message.count({ where: { conversationId, senderId: { not: userId }, OR: [{ createdAt: { gt: message.createdAt } }, { createdAt: message.createdAt, id: { gt: message.id } }] } }) }
    });

    return { success: true };
    });
  }

  async getReceipts(conversationId: string) {
    const members = await db.conversationMember.findMany({ where: { conversationId, lastReadMessageId: { not: null } }, select: { userId: true, lastReadMessageId: true, user: { select: { fullName: true } } } });
    const messages = await db.message.findMany({ where: { conversationId, id: { in: members.map(m => m.lastReadMessageId!) } }, select: { id: true, createdAt: true } });
    return members.flatMap(m => { const message = messages.find(t => t.id === m.lastReadMessageId); return message ? [{ userId: m.userId, fullName: m.user.fullName, messageId: message.id, createdAt: message.createdAt }] : []; });
  }

  async setLead(user: { userId: string; orgId: string; systemRole: string }, conversationId: string, userId: string | null) {
    await permissionService.assertConversationAccess(user, conversationId, 'manage_lead');
    if (!permissionService.isAdmin(user)) throw Object.assign(new Error('Chỉ admin được chỉ định lead nhóm chat'), { statusCode: 403 });
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const room = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (room?.type === 'DIRECT') throw Object.assign(new Error('Chat trực tiếp không có lead'), { statusCode: 400 });
      if (userId && !await tx.conversationMember.findFirst({ where: { conversationId, userId, user: { orgId: user.orgId, status: 'ACTIVE' } } })) throw Object.assign(new Error('Lead phải là thành viên đang hoạt động của nhóm'), { statusCode: 400 });
      await tx.conversationMember.updateMany({ where: { conversationId, role: 'LEAD' }, data: { role: 'MEMBER' } });
      if (userId) await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { role: 'LEAD' } });
      await tx.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'SET_CONVERSATION_LEAD', entityType: 'CONVERSATION', entityId: conversationId, metadata: JSON.stringify({ userId }) } });
      return { userId };
    });
  }
}

export const chatService = new ChatService();
