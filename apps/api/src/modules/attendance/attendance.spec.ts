import { describe, it, expect, beforeAll } from 'vitest';
import { attendanceService } from './attendance.service';
import { db } from '../../services/db.service';

describe('Kiểm thử Điểm Danh In/Out & Điều Chỉnh Giờ Làm (Attendance System Tests)', () => {
  let orgId: string;
  let sangUser: any;
  let adminUser: any;

  beforeAll(async () => {
    const org = await db.organization.findFirst();
    sangUser = await db.user.findFirst({ where: { email: 'sang@techcorp.vn' } });
    adminUser = await db.user.findFirst({ where: { email: 'admin@techcorp.vn' } });
    orgId = org!.id;

    // Dọn dẹp session điểm danh cũ của sangUser trước khi test
    await db.attendanceSession.deleteMany({ where: { userId: sangUser.id } });
    await db.attendanceAdjustment.deleteMany({ where: { userId: sangUser.id } });
  });

  it('1. Check In thành công: Trả về phiên OPEN', async () => {
    const session = await attendanceService.checkIn(sangUser.id, orgId, 'Bắt đầu ca sáng');
    expect(session).toBeDefined();
    expect(session.status).toBe('OPEN');
    expect(session.checkOutTime).toBeNull();
  });

  it('2. Chống trùng phiên (Double In): Cố tình Check In lần 2 khi chưa Check Out -> Phải ném lỗi', async () => {
    await expect(
      attendanceService.checkIn(sangUser.id, orgId, 'Cố tình checkin lần 2')
    ).rejects.toThrow('Bạn đang có một phiên làm việc đang mở. Vui lòng Check-out trước khi bắt đầu phiên mới.');
  });

  it('3. Check Out thành công: Đóng phiên và chuyển status sang CLOSED', async () => {
    const closed = await attendanceService.checkOut(sangUser.id, 'Kết thúc ca sáng');
    expect(closed.status).toBe('CLOSED');
    expect(closed.checkOutTime).toBeDefined();
  });

  it('4. Check Out khi chưa Check In -> Phải ném lỗi rõ ràng', async () => {
    await expect(
      attendanceService.checkOut(sangUser.id, 'Lại checkout khi ko có phiên')
    ).rejects.toThrow('Không tìm thấy phiên làm việc đang mở để Check-out.');
  });

  it('5. Chống tự phê duyệt đơn điều chỉnh công (No Self-Approval)', async () => {
    const adj = await attendanceService.requestAdjustment(sangUser.id, orgId, {
      requestedCheckIn: '2026-10-10T08:00:00.000Z',
      requestedCheckOut: '2026-10-10T12:00:00.000Z',
      reason: 'Quên chấm công ca sáng'
    });

    // sangUser cố tình tự duyệt đơn của chính mình
    await expect(
      attendanceService.approveAdjustment(adj.id, sangUser.id, true)
    ).rejects.toThrow('Không được phép tự phê duyệt yêu cầu điều chỉnh công của chính mình.');
  });

  it('6. Quản lý phê duyệt đơn hợp lệ thành công', async () => {
    const adj = await db.attendanceAdjustment.findFirst({
      where: { userId: sangUser.id, status: 'PENDING' }
    });

    // Admin duyệt
    const result = await attendanceService.approveAdjustment(adj!.id, adminUser.id, true);
    expect(result.status).toBe('APPROVED');
    expect(result.approverId).toBe(adminUser.id);
  });

  it('7. Chống chồng chéo phiên làm việc (Overlap Prevention)', async () => {
    // Tạo đơn thứ 2 có thời gian chồng lấn từ 11:00 đến 14:00 (bị đè 1 tiếng với phiên 8h-12h vừa duyệt)
    const adj2 = await attendanceService.requestAdjustment(sangUser.id, orgId, {
      requestedCheckIn: '2026-10-10T11:00:00.000Z',
      requestedCheckOut: '2026-10-10T14:00:00.000Z',
      reason: 'Xin bù thêm giờ trưa'
    });

    // Admin duyệt đơn trùng này -> Phải bị từ chối do trùng đè
    await expect(
      attendanceService.approveAdjustment(adj2.id, adminUser.id, true)
    ).rejects.toThrow('Khoảng thời gian yêu cầu trùng đè lên một phiên làm việc đã có sẵn trong hệ thống.');
  });
});
