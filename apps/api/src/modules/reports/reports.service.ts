import { db } from '../../services/db.service';
import { TaskStatus } from '@work-ai/shared';
import { permissionService } from '../../services/permission.service';

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export class ReportsService {
  /**
   * Lấy số liệu thống kê tổng quan (Dashboard KPIs)
   */
  async getDashboardSummary(user: { userId: string; orgId: string; systemRole: string }, teamId?: string) {
    const tasks = await db.task.findMany({
      where: {
        AND: [
          permissionService.readableTaskWhere(user),
          { teamId: teamId || undefined }
        ]
      }
    });

    const now = new Date();
    let totalTasks = tasks.length;
    let inProgressTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    let onTimeCompleted = 0;
    let completedWithDeadline = 0;

    for (const t of tasks) {
      if (t.status === TaskStatus.IN_PROGRESS) inProgressTasks++;
      if (t.status === TaskStatus.COMPLETED) {
        completedTasks++;
        const deadline = t.completionDeadline || t.deadline;
        if (deadline) {
          completedWithDeadline++;
          if (t.completedAt && t.completedAt <= deadline) {
            onTimeCompleted++;
          }
        }
      } else {
        if (t.deadline && now > t.deadline) {
          overdueTasks++;
        }
      }
    }

    const onTimeDeliveryRate = completedWithDeadline > 0
      ? Math.round((onTimeCompleted / completedWithDeadline) * 100)
      : 100;

    const rooms = await db.conversation.findMany({ where: { id: { in: await permissionService.getReadableConversationIds(user) }, orgId: user.orgId }, select: { id: true, name: true } });
    const byConversation = rooms.map(room => {
      const items = tasks.filter(t => t.sourceConversationId === room.id);
      return { ...room, total: items.length, completed: items.filter(t => t.status === TaskStatus.COMPLETED).length, inProgress: items.filter(t => t.status === TaskStatus.IN_PROGRESS).length, overdue: items.filter(t => t.status !== TaskStatus.COMPLETED && t.deadline && t.deadline < now).length };
    });

    return {
      byConversation,
      totalTasks,
      inProgressTasks,
      completedTasks,
      overdueTasks,
      onTimeDeliveryRate: `${onTimeDeliveryRate}%`
    };
  }

  /**
   * Xuất danh sách Task ra CSV (chuẩn UTF-8 có BOM để mở Excel tiếng Việt không lỗi font)
   */
  async exportTasksToCsv(orgId: string): Promise<string> {
    const tasks = await db.task.findMany({
      where: { orgId, isArchived: false },
      include: {
        assignee: true,
        creator: true,
        team: true,
        project: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Thêm BOM (Byte Order Mark) cho UTF-8
    const BOM = '\uFEFF';
    let csv = BOM + 'ID,Tiêu đề,Người giao,Người phụ trách,Team,Dự án,Mức ưu tiên,Trạng thái,Deadline,Ngày hoàn thành\n';

    for (const t of tasks) {
      const title = `"${(t.title || '').replace(/"/g, '""')}"`;
      const creator = t.creator?.fullName || '';
      const assignee = t.assignee?.fullName || 'Chưa gán';
      const team = t.team?.name || '';
      const project = t.project?.name || '';
      const deadline = t.deadline ? t.deadline.toISOString() : '';
      const completedAt = t.completedAt ? t.completedAt.toISOString() : '';

      csv += [t.id, t.title, creator, assignee, team, project, t.priority, t.status, deadline, completedAt].map(csvCell).join(',') + '\n';
    }

    return csv;
  }

  /**
   * Xuất bảng công điểm danh ra CSV
   */
  async exportAttendanceToCsv(orgId: string): Promise<string> {
    const sessions = await db.attendanceSession.findMany({
      where: { orgId },
      include: { user: true },
      orderBy: { checkInTime: 'desc' }
    });

    const BOM = '\uFEFF';
    let csv = BOM + 'Nhân viên,Email,Giờ Check-in,Giờ Check-out,Thời lượng (giờ),Trạng thái,Ghi chú\n';

    for (const s of sessions) {
      const name = s.user.fullName;
      const email = s.user.email;
      const inTime = s.checkInTime ? s.checkInTime.toLocaleString('vi-VN') : '';
      const outTime = s.checkOutTime ? s.checkOutTime.toLocaleString('vi-VN') : 'Đang mở';

      let durationHours = 0;
      if (s.checkInTime && s.checkOutTime) {
        durationHours = Number(((s.checkOutTime.getTime() - s.checkInTime.getTime()) / (1000 * 60 * 60)).toFixed(2));
      }

      const note = `"${(s.note || '').replace(/"/g, '""')}"`;
      csv += [name, email, inTime, outTime, durationHours, s.status, s.note].map(csvCell).join(',') + '\n';
    }

    return csv;
  }
}

export const reportsService = new ReportsService();
