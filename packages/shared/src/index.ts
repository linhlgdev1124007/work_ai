import { z } from 'zod';

// ==========================================
// 1. ENUMS
// ==========================================

export enum SystemRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER'
}

export enum TeamMemberRole {
  LEAD = 'LEAD',
  MEMBER = 'MEMBER'
}

export enum ConversationType {
  TEAM = 'TEAM',
  PROJECT = 'PROJECT',
  DIRECT = 'DIRECT',
  GROUP = 'GROUP'
}

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING = 'WAITING',
  REVIEW = 'REVIEW',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED'
}

export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum AttendanceStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED'
}

export enum AttendanceAdjustmentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum AiIntent {
  CREATE_TASK = 'CREATE_TASK',
  UPDATE_ASSIGNEE = 'UPDATE_ASSIGNEE',
  UPDATE_DEADLINE = 'UPDATE_DEADLINE',
  UPDATE_STATUS = 'UPDATE_STATUS',
  CREATE_SUBTASKS = 'CREATE_SUBTASKS',
  SET_CURRENT_WORK = 'SET_CURRENT_WORK',
  QUERY_TASKS = 'QUERY_TASKS',
  SUMMARIZE = 'SUMMARIZE',
  CREATE_USER_NOTE = 'CREATE_USER_NOTE',
  REPORT_TASK_DELAY = 'REPORT_TASK_DELAY',
  NONE = 'NONE'
}

export enum AiActionStatus {
  AUTO_APPLIED = 'AUTO_APPLIED',
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  UNDONE = 'UNDONE',
  EXPIRED = 'EXPIRED'
}

export enum NotificationType {
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_REMINDER = 'TASK_REMINDER',
  AI_ACTION_PROPOSED = 'AI_ACTION_PROPOSED',
  ATTENDANCE_ALERT = 'ATTENDANCE_ALERT',
  SYSTEM = 'SYSTEM'
}

// ==========================================
// 2. SCHEMAS & DTOS
// ==========================================

export const LoginSchema = z.object({
  email: z.string().trim().email({ message: 'Email không đúng định dạng' }).max(254),
  password: z.string().min(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Vui lòng nhập mật khẩu hiện tại' }),
  newPassword: z.string().min(12, { message: 'Mật khẩu mới tối thiểu 12 ký tự' }).max(72)
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1, { message: 'Tiêu đề task không được để trống' }).max(500),
  description: z.string().optional(),
  teamId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  priority: z.nativeEnum(TaskPriority).optional().default(TaskPriority.NORMAL),
  status: z.nativeEnum(TaskStatus).optional().default(TaskStatus.TODO),
  deadline: z.string().datetime().optional().nullable(),
  estimateMinutes: z.number().int().positive().optional().nullable(),
  requiresReview: z.boolean().optional().default(false),
  parentId: z.string().optional().nullable(),
  sourceMessageId: z.string().optional().nullable(),
  sourceConversationId: z.string().optional().nullable()
});

export interface CreateTaskDto {
  title: string;
  description?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  deadline?: string | null;
  estimateMinutes?: number | null;
  requiresReview?: boolean;
  parentId?: string | null;
  sourceMessageId?: string | null;
  sourceConversationId?: string | null;
}

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  deadline: z.string().datetime().optional().nullable(),
  estimateMinutes: z.number().int().positive().optional().nullable(),
  requiresReview: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
  overrideReason: z.string().optional()
});
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;

export const SendMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1, { message: 'Nội dung tin nhắn không được để trống' }).max(20000),
  replyToId: z.string().optional().nullable(),
  clientMessageId: z.string().min(1),
  attachmentIds: z.array(z.string()).optional(),
  mentionIds: z.array(z.string().uuid()).max(30).optional()
});
export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export const AttendanceAdjustmentRequestSchema = z.object({
  sessionId: z.string().optional().nullable(),
  requestedCheckIn: z.string().datetime(),
  requestedCheckOut: z.string().datetime(),
  reason: z.string().min(5, { message: 'Vui lòng cung cấp lý do rõ ràng (ít nhất 5 ký tự)' })
});
export type AttendanceAdjustmentRequestDto = z.infer<typeof AttendanceAdjustmentRequestSchema>;

export const SetCurrentWorkSchema = z.object({
  taskId: z.string().optional().nullable(),
  customStatusText: z.string().optional().nullable()
});
export type SetCurrentWorkDto = z.infer<typeof SetCurrentWorkSchema>;

// ==========================================
// 3. COMMON INTERFACES
// ==========================================

export interface UserSession {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  systemRole: SystemRole;
  orgId: string;
  mustChangePassword?: boolean;
}

export interface AiExtractedAction {
  intent: AiIntent;
  confidence: number;
  requiresConfirmation: boolean;
  ambiguityReason?: string | null;
  evidence: string;
  data: {
    title?: string;
    description?: string;
    assigneeName?: string;
    assigneeId?: string | null;
    deadlineIso?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    taskId?: string | null;
    subtasks?: Array<{ title: string; assigneeName?: string; deadlineIso?: string | null }>;
    currentWorkText?: string;
    targetVersion?: number;
  };
}
