import { db } from '../../services/db.service';
import { AttendanceAdjustmentRequestDto } from '@work-ai/shared';

export class AttendanceService {
  async getAdjustmentById(adjustmentId: string) {
    return db.attendanceAdjustment.findUnique({ where: { id: adjustmentId } });
  }

  /**
   * Lấy trạng thái điểm danh hiện tại của User
   */
  async getCurrentStatus(userId: string) {
    const openSession = await db.attendanceSession.findFirst({
      where: {
        userId,
        status: 'OPEN'
      }
    });

    return {
      hasOpenSession: !!openSession,
      currentSession: openSession
    };
  }

  /**
   * Điểm danh vào ca (Check In)
   * Sử dụng giờ server (UTC), đảm bảo mỗi user chỉ có duy nhất 1 phiên OPEN
   */
  async checkIn(userId: string, orgId: string, note?: string) {
    return db.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    // 1. Kiểm tra xem user có phiên nào đang mở không
    const existingOpen = await db.attendanceSession.findFirst({
      where: {
        userId,
        status: 'OPEN'
      }
    });

    if (existingOpen) {
      throw new Error('Bạn đang có một phiên làm việc đang mở. Vui lòng Check-out trước khi bắt đầu phiên mới.');
    }

    // 2. Tạo phiên mới với giờ server hiện tại
    const session = await db.attendanceSession.create({
      data: {
        orgId,
        userId,
        checkInTime: new Date(),
        status: 'OPEN',
        note: note || null
      }
    });

    return session;
    });
  }

  /**
   * Điểm danh ra ca (Check Out)
   * Đóng phiên hiện tại, tự động kết thúc Current Work của user
   */
  async checkOut(userId: string, note?: string) {
    return db.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    // 1. Tìm phiên đang mở
    const openSession = await db.attendanceSession.findFirst({
      where: {
        userId,
        status: 'OPEN'
      }
    });

    if (!openSession) {
      throw new Error('Không tìm thấy phiên làm việc đang mở để Check-out.');
    }

    const checkOutTime = new Date();

    // 2. Cập nhật đóng phiên
    const closedSession = await db.attendanceSession.update({
      where: { id: openSession.id },
      data: {
        checkOutTime,
        status: 'CLOSED',
        note: note ? (openSession.note ? `${openSession.note} | ${note}` : note) : openSession.note
      }
    });

    // 3. Nghiệp vụ: Tự động kết thúc Current Work khi Check-out
    await db.currentWork.deleteMany({
      where: { userId }
    }).catch(() => {});

    // Ghi nhận sự kiện kết thúc làm việc
    await db.workStatusEvent.create({
      data: {
        userId,
        action: 'STOP',
        statusText: 'Đã kết thúc ca làm việc (Check-out)'
      }
    }).catch(() => {});

    return closedSession;
    });
  }

  /**
   * Gửi yêu cầu điều chỉnh điểm danh
   */
  async requestAdjustment(userId: string, orgId: string, dto: AttendanceAdjustmentRequestDto) {
    if (dto.sessionId && !await db.attendanceSession.findFirst({ where: { id: dto.sessionId, userId, orgId } })) {
      throw new Error('Phiên điểm danh không thuộc tài khoản của bạn.');
    }
    const requestedIn = new Date(dto.requestedCheckIn);
    const requestedOut = new Date(dto.requestedCheckOut);

    if (requestedIn >= requestedOut) {
      throw new Error('Thời gian Check-in phải trước thời gian Check-out.');
    }

    return await db.attendanceAdjustment.create({
      data: {
        orgId,
        userId,
        sessionId: dto.sessionId || null,
        type: dto.sessionId ? 'EDIT_SESSION' : 'NEW_SESSION',
        requestedCheckIn: requestedIn,
        requestedCheckOut: requestedOut,
        reason: dto.reason,
        status: 'PENDING'
      }
    });
  }

  /**
   * Phê duyệt yêu cầu điều chỉnh điểm danh
   * Kiểm tra: Chống tự duyệt + Kiểm tra không chồng chéo phiên (Overlap Check)
   */
  async approveAdjustment(adjustmentId: string, approverId: string, isApproved: boolean, rejectionReason?: string) {
    return db.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adjustmentId} FOR UPDATE`;
    const adjustment = await db.attendanceAdjustment.findUnique({
      where: { id: adjustmentId }
    });

    if (!adjustment) {
      throw new Error('Không tìm thấy yêu cầu điều chỉnh điểm danh.');
    }
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${adjustment.userId} FOR UPDATE`;

    if (adjustment.status !== 'PENDING') {
      throw new Error('Yêu cầu này đã được xử lý trước đó.');
    }

    // 1. Chống tự duyệt
    if (adjustment.userId === approverId) {
      throw new Error('Không được phép tự phê duyệt yêu cầu điều chỉnh công của chính mình.');
    }

    if (!isApproved) {
      return await db.attendanceAdjustment.update({
        where: { id: adjustmentId },
        data: {
          status: 'REJECTED',
          approverId,
          approvedAt: new Date(),
          rejectionReason: rejectionReason || 'Quản lý từ chối yêu cầu.'
        }
      });
    }

    // 2. Kiểm tra không chồng chéo phiên (Overlap Check Transaction)
    const overlappingSession = await db.attendanceSession.findFirst({
      where: {
        userId: adjustment.userId,
        id: adjustment.sessionId ? { not: adjustment.sessionId } : undefined,
        AND: [
          { checkInTime: { lt: adjustment.requestedCheckOut } },
          { OR: [{ checkOutTime: null }, { checkOutTime: { gt: adjustment.requestedCheckIn } }] }
        ]
      }
    });

    if (overlappingSession) {
      throw new Error('Khoảng thời gian yêu cầu trùng đè lên một phiên làm việc đã có sẵn trong hệ thống.');
    }

    // 3. Cập nhật hoặc tạo mới phiên điểm danh
    if (adjustment.type === 'EDIT_SESSION' && adjustment.sessionId) {
      await db.attendanceSession.update({
        where: { id: adjustment.sessionId },
        data: {
          checkInTime: adjustment.requestedCheckIn,
          checkOutTime: adjustment.requestedCheckOut,
          status: 'CLOSED',
          note: `Đã điều chỉnh theo đơn: ${adjustment.reason}`
        }
      });
    } else {
      await db.attendanceSession.create({
        data: {
          orgId: adjustment.orgId,
          userId: adjustment.userId,
          checkInTime: adjustment.requestedCheckIn,
          checkOutTime: adjustment.requestedCheckOut,
          status: 'CLOSED',
          note: `Bổ sung theo đơn duyệt: ${adjustment.reason}`
        }
      });
    }

    // Đánh dấu đơn đã duyệt
    return await db.attendanceAdjustment.update({
      where: { id: adjustmentId },
      data: {
        status: 'APPROVED',
        approverId,
        approvedAt: new Date()
      }
    });
    });
  }

  /**
   * Lấy lịch sử điểm danh của User trong khoảng thời gian
   */
  async getHistory(userId: string, startDate?: Date, endDate?: Date) {
    return await db.attendanceSession.findMany({
      where: {
        userId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { checkInTime: 'desc' }
    });
  }
}

export const attendanceService = new AttendanceService();
