# Giai đoạn 0: Nền Tảng Hạ Tầng, Cơ Sở Dữ Liệu & Xác Thực Phân Quyền

Tài liệu chi tiết kỹ thuật cho Mốc 0 theo kế hoạch [plan.md](file:///D:/TOOL_LAMVIEC/plan.md).

---

## 1. Mục Tiêu Của Giai Đoạn (Objectives)

1. **Thiết lập kiến trúc Monorepo tiêu chuẩn:** Khởi tạo cấu trúc dự án monorepo với `pnpm workspace`, chuẩn hóa cấu hình TypeScript, ESLint, Prettier, Shared Types và Vitest.
2. **Container hóa toàn bộ môi trường (Dockerized Environment):** Thiết lập môi trường chạy với Docker Compose (gồm `postgres`, `redis`, `api`, `web`, `worker`, `proxy`), sẵn sàng khởi chạy từ một máy tính trắng (clean machine).
3. **Database Schema & Migration cốt lõi:** Thiết kế và chạy migration khởi tạo CSDL PostgreSQL bằng Prisma ORM, bao gồm các bảng: Organization, User, Team, Project, Session, Audit Log và Settings.
4. **Hệ thống Authentication bảo mật cao:** Đăng nhập bằng Email/Password (mã hóa Argon2id), quản lý Session phía server với Cookie HttpOnly/Secure/SameSite, chống tấn công CSRF, chống brute-force đăng nhập và cơ chế buộc đổi mật khẩu tạm.
5. **Hệ thống Phân quyền Role-Based (RBAC) & Context Policy:** Xây dựng Middleware / Guards phân quyền 3 cấp độ: `Admin`, `Team Lead / PIC`, `Member`. Thiết lập audit log cho các thao tác nhạy cảm.
6. **Bộ khung Giao diện (Base UI Layout):** Khởi tạo ứng dụng Next.js (App Router), cài đặt Tailwind CSS, shadcn/ui, thiết lập layout Desktop Sidebar và Mobile Navigation bar, chuẩn hóa Theme và i18n tiếng Việt cơ bản.

---

## 2. Các Hạng Mục Chi Tiết Cần Làm (What To Do)

### 2.1. Cấu trúc Monorepo & Quản lý Dependencies
- Khởi tạo thư mục gốc với `pnpm-workspace.yaml`:
  - `apps/web`: Ứng dụng Next.js 14+ (React, Tailwind CSS, shadcn/ui, TanStack Query).
  - `apps/api`: Ứng dụng NestJS (REST API, OpenAPI Swagger, Guards, Interceptors).
  - `apps/worker`: Ứng dụng NestJS / Node.js worker xử lý background jobs với BullMQ.
  - `packages/database`: Prisma schema, migrations, seed script và Prisma Client export.
  - `packages/shared`: Shared DTOs, Zod schemas, Enums, TypeScript interfaces, Error codes.
  - `packages/config`: Shared ESLint, Prettier, TypeScript configurations (`tsconfig.base.json`).
- Khóa toàn bộ phiên bản thư viện trong `pnpm-lock.yaml`, nghiêm cấm sử dụng tag `latest`.

### 2.2. Hạ tầng Docker & Môi trường phát triển
- Tạo file `docker-compose.yml` phục vụ môi trường phát triển cục bộ và production:
  - `postgres`: PostgreSQL 16 Alpine, cấu hình volume lưu trữ bền vững, kích hoạt extensions `unaccent`, `pg_trgm`.
  - `redis`: Redis 7 Alpine, mật khẩu bảo vệ, volume lưu RDB/AOF.
  - `api`: NestJS runtime, expose port nội bộ, kết nối postgres & redis.
  - `web`: Next.js chạy chế độ standalone.
  - `worker`: BullMQ worker service.
  - `proxy`: Caddy server làm reverse proxy, định tuyến `/api` sang backend và `/` sang Next.js.
- Chuẩn hóa file `.env.example` với đầy đủ các biến môi trường:
  - `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `APP_PORT`, `APP_ENV`, `TIMEZONE=Asia/Ho_Chi_Minh`.
- Tạo kịch bản khởi động: `docker-compose up -d --build`.

### 2.3. Thiết kế CSDL Cốt lõi & Prisma Schema
Thiết lập schema cho các bảng nền tảng:
- `organizations`: `id`, `name`, `code`, `settings`, `created_at`, `updated_at`.
- `users`: `id`, `org_id`, `email` (unique), `password_hash`, `full_name`, `avatar_url`, `system_role` (`ADMIN`, `MEMBER`), `status` (`ACTIVE`, `SUSPENDED`), `must_change_password` (boolean), `version`, `created_at`, `updated_at`.
- `teams`: `id`, `org_id`, `name`, `description`, `created_at`, `updated_at`.
- `team_members`: `id`, `team_id`, `user_id`, `role` (`LEAD`, `MEMBER`), `joined_at` (Unique `[team_id, user_id]`).
- `projects`: `id`, `team_id`, `org_id`, `name`, `code`, `created_at`, `updated_at`.
- `project_members`: `id`, `project_id`, `user_id`, `joined_at` (Unique `[project_id, user_id]`).
- `sessions`: `id`, `user_id`, `token_hash`, `ip_address`, `user_agent`, `expires_at`, `created_at`.
- `password_reset_tokens`: `id`, `user_id`, `token_hash`, `used_at`, `expires_at`, `created_at`.
- `audit_events`: `id`, `org_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata` (JSONB), `created_at`.
- `outbox_events`: `id`, `event_type`, `payload` (JSONB), `status` (`PENDING`, `PROCESSED`, `FAILED`), `retry_count`, `created_at`.

### 2.4. Module Xác Thực (Authentication) & Bảo Mật
- Triển khai thuật toán băm mật khẩu với **Argon2id**.
- Cơ chế quản lý phiên:
  - Tạo session trong DB, lưu cookie session token dạng `HttpOnly`, `Secure` (khi HTTPS), `SameSite=Lax`.
  - Rate limiting đăng nhập với Redis (ví dụ: tối đa 5 lần thử sai trong 15 phút cho một IP/Email).
  - Không cung cấp tài khoản production mặc định trong mã nguồn. Cung cấp lệnh CLI khởi tạo Admin đầu tiên: `pnpm run seed:admin` với mật khẩu ngẫu nhiên hoặc yêu cầu đổi khi đăng nhập lần đầu.
  - Endpoint `/api/v1/auth/login`, `/api/v1/auth/logout`, `/api/v1/auth/me`, `/api/v1/auth/change-password`.
  - Endpoint Admin cấp lại mật khẩu cho nhân viên: sinh reset token dùng 1 lần, không bắt buộc tích hợp SMTP ở mốc này.

### 2.5. Phân Quyền (Authorization - RBAC)
- Triển khai `RolesGuard` và `PermissionsGuard` trong NestJS:
  - `Admin`: Toàn quyền quản trị hệ thống, quản lý tài khoản, cấu hình tổ chức, xem audit log.
  - `Team Lead`: Quyền quản trị trong phạm vi team được gán (quản lý project của team, thành viên trong team).
  - `Member`: Quyền truy cập các tài nguyên mình tham gia.
- Chặn lập tức các request nếu tài khoản có cờ `status = SUSPENDED`.

### 2.6. Base UI Frontend (Next.js & Design System)
- Khởi tạo cấu trúc thư mục Next.js App Router:
  - `(auth)/login`: Màn hình đăng nhập sạch sẽ, form validation với Zod & React Hook Form.
  - `(auth)/change-password`: Màn hình bắt buộc đổi mật khẩu khi `must_change_password = true`.
  - `(dashboard)/layout`: Khung giao diện desktop với Sidebar trái (Hôm nay, Chat, Công việc, Đội nhóm, Báo cáo, Điểm danh, Quản trị).
  - Header với avatar người dùng, nút đổi mật khẩu, đăng xuất và trạng thái kết nối mạng.
  - Bottom navigation bar cho giao diện mobile.
  - Cài đặt hệ thống thông báo Toast (Sonner / React Hot Toast), Modal confirmation, Theme Provider.

---

## 3. Kế Hoạch Kiểm Thử (What & How To Test)

### 3.1. Kiểm thử khởi động sạch (Clean Start Verification)
- **Mục tiêu:** Đảm bảo hệ thống có thể chạy trên bất kỳ máy nào mà không cần cài đặt thủ công các phụ thuộc phức tạp ngoài Docker và pnpm.
- **Kịch bản test:**
  1. Xóa toàn bộ volume và container cũ: `docker-compose down -v`.
  2. Tạo file `.env` từ `.env.example`.
  3. Khởi chạy toàn bộ hệ thống: `docker-compose up -d --build`.
  4. Chạy migration: `pnpm run db:migrate`.
  5. Chạy seed tạo tổ chức và tài khoản Admin mẫu: `pnpm run seed:admin`.
- **Kết quả mong đợi:** Tất cả các container (`postgres`, `redis`, `api`, `web`, `worker`, `proxy`) đều đạt trạng thái `healthy`, không có container nào restart lặp vòng.

### 3.2. Kiểm thử Authentication & Session
- **Kịch bản 1: Đăng nhập thành công:**
  - Nhập email và password hợp lệ của Admin.
  - Kết quả: Nhận HTTP 200, cookie `session_id` được set với cờ `HttpOnly`, chuyển hướng vào màn hình Dashboard.
- **Kịch bản 2: Đăng nhập sai mật khẩu:**
  - Nhập sai mật khẩu liên tiếp 5 lần.
  - Kết quả: Hệ thống kích hoạt rate limit, trả về lỗi HTTP 429 Too Many Requests kèm thông báo thời gian mở khóa.
- **Kịch bản 3: Buộc đổi mật khẩu tạm:**
  - Admin tạo user mới với mật khẩu tạm thời (`must_change_password = true`).
  - User đăng nhập lần đầu.
  - Kết quả: Hệ thống chặn truy cập các route khác, bắt buộc redirect đến màn hình `/change-password`. Sau khi đổi mật khẩu thành công mới được vào Dashboard.
- **Kịch bản 4: Vô hiệu hóa tài khoản:**
  - Admin set `status = SUSPENDED` cho một user đang đăng nhập.
  - User thực hiện request bất kỳ.
  - Kết quả: Backend lập tức trả về HTTP 401/403, hủy session và đá user về trang Login.

### 3.3. Kiểm thử Phân quyền (RBAC Tests)
- **Kịch bản 1: Quyền Admin:**
  - Gọi API `/api/v1/admin/users`, `/api/v1/admin/settings`.
  - Kết quả: Admin được phép truy cập (HTTP 200).
- **Kịch bản 2: Quyền Member:**
  - Đăng nhập với tài khoản Member, gọi thử API `/api/v1/admin/users`.
  - Kết quả: Bị chặn với HTTP 403 Forbidden.
- **Kịch bản 3: Quyền Team Lead:**
  - Đăng nhập tài khoản Lead Team A, thử quản lý cấu hình Team B.
  - Kết quả: Bị chặn với HTTP 403 Forbidden.

### 3.4. Kiểm thử Tích hợp & Unit Tests Tự động
- Chạy bộ test tự động: `pnpm test`.
- Phạm vi kiểm tra:
  - Hashing Argon2id và verify password.
  - Session validation service.
  - Guard phân quyền và Decorator `@Roles()`.
  - Prisma client queries và constraints (Unique email, Unique team_member).

---

## 4. Tiêu Chí Nghiệm Thu (Acceptance Criteria / DoD)

- [ ] Dự án khởi động thành công từ môi trường sạch bằng Docker Compose chỉ với 1-2 lệnh.
- [ ] Database PostgreSQL chạy migration thành công, có đủ các bảng hạ tầng cốt lõi và schema constraints.
- [ ] Lệnh tạo Admin đầu tiên hoạt động hoàn hảo, sinh tài khoản an toàn.
- [ ] Màn hình đăng nhập, đăng xuất, đổi mật khẩu hoạt động trơn tru trên cả trình duyệt máy tính và điện thoại.
- [ ] Cookie session bảo mật, chống được tấn công brute-force và CSRF.
- [ ] Phân quyền chặt chẽ: Admin, Team Lead, Member không thể truy cập trái phép API của nhau.
- [ ] Layout UI cơ bản sẵn sàng với sidebar, header, navigation bar tiếng Việt, responsive không tràn ngang.
- [ ] Toàn bộ unit/integration test của Phase 0 pass 100%.
