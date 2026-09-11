# Lộ trình triển khai tổng thể (Roadmap Master)
## Web App Quản Lý Công Việc Nhóm Với AI Làm Trung Tâm

Tài liệu này được xây dựng dựa trên [plan.md](file:///D:/TOOL_LAMVIEC/plan.md) và [prompt.txt](file:///D:/TOOL_LAMVIEC/prompt.txt), phân tách toàn bộ quá trình phát triển thành 5 giai đoạn (Mốc 0 đến Mốc 4) có mục tiêu độc lập, quy trình phát triển rõ ràng và bộ tiêu chí kiểm thử nghiêm ngặt.

---

## 1. Triết lý phát triển & Nguyên tắc cốt lõi

1. **Chat-First & Nhắn là giao việc:** Hội thoại nội bộ là luồng nghiệp vụ chính. AI tự động trích xuất thông tin có cấu trúc (task, assignee, deadline) từ câu chat tiếng Việt tự nhiên mà không bắt người dùng điền form phức tạp.
2. **AI chỉ đề xuất, không tùy tiện phá hủy:** Model chỉ tạo lệnh dự kiến (action proposal), backend kiểm tra quyền và schema. Nếu rõ ràng thì auto-apply; nếu mơ hồ thì yêu cầu xác nhận (confirmation) kèm nút undo.
3. **Mỗi giai đoạn phải chạy được & kiểm thử độc lập:** Hoàn thành mốc nào phải kiểm thử, nghiệm thu và đảm bảo hệ thống chạy ổn định trước khi chuyển sang mốc tiếp theo. **Không dừng lại ở MVP mà hoàn thiện toàn bộ đến Mốc 4.**
4. **Không dùng dữ liệu giả (mock) cho bản nghiệm thu:** Ngoại trừ việc giả lập tạm thời khi thiếu credentials Vertex AI (phải báo cáo minh bạch), mọi tính năng nghiệm thu đều chạy trên database thật và AI thật.

---

## 2. Ma trận 5 giai đoạn triển khai (Phases Matrix)

| Giai đoạn | Tên giai đoạn | File tài liệu chi tiết | Mục tiêu trọng tâm | Đầu ra kiểm chứng (Deliverables) |
|---|---|---|---|---|
| **Phase 0** | **Nền tảng hạ tầng, CSDL & Xác thực Phân quyền** | [phase-0-nen-tang.md](file:///D:/TOOL_LAMVIEC/phase-docs/phase-0-nen-tang.md) | Xây dựng bộ khung Monorepo, Docker Compose, Database Schema cốt lõi, cơ chế Session Auth và RBAC đa cấp. | Khởi động từ máy sạch; tạo tài khoản Admin; đăng nhập bảo mật và kiểm tra quyền truy cập đúng vai trò. |
| **Phase 1** | **Lõi nghiệp vụ: Chat Realtime, Task thủ công & Điểm danh** | [phase-1-loi-nghiep-vu.md](file:///D:/TOOL_LAMVIEC/phase-docs/phase-1-loi-nghiep-vu.md) | Xây dựng phòng chat realtime (Socket.IO), quản lý task thủ công cơ bản, trang Hôm nay và In/Out điểm danh. | 2 người dùng chat realtime, giao task thủ công; In/Out không trùng phiên; dữ liệu tồn tại sau reboot container. |
| **Phase 2** | **AI End-to-End: Context Engine, Vertex AI & Xác nhận** | [phase-2-ai-end-to-end.md](file:///D:/TOOL_LAMVIEC/phase-docs/phase-2-ai-end-to-end.md) | Tích hợp Google Vertex AI, xử lý câu lệnh tiếng Việt tự nhiên, tự tạo task, cơ chế Confirmation, Undo và AI Note. | **Mốc MVP Kỹ thuật:** Đạt bộ test >= 60 tình huống câu lệnh tiếng Việt; AI tự tạo task đúng hạn, phân biệt rõ/mơ hồ. |
| **Phase 3** | **Quản lý công việc nâng cao, Dashboard & Điều chỉnh công** | [phase-3-quan-ly-nang-cao.md](file:///D:/TOOL_LAMVIEC/phase-docs/phase-3-quan-ly-nang-cao.md) | Subtask, Checklist, Dependency chặn vòng lặp, Review flow, "Ai đang làm gì", Universal Search và Duyệt sửa công. | Lead/Admin/Member thao tác đúng phạm vi; số liệu workload chuẩn leaf-task; tìm kiếm tiếng Việt không dấu; duyệt công không đè phiên. |
| **Phase 4** | **Hoàn thiện hệ thống, Tối ưu Mobile & Sẵn sàng Production** | [phase-4-hoan-thien-production.md](file:///D:/TOOL_LAMVIEC/phase-docs/phase-4-hoan-thien-production.md) | Nhắc việc thông minh, Web Push, Báo cáo AI & CSV, tối ưu Mobile/PWA, tự động hóa Backup/Restore và Kiểm thử tải. | **Bàn giao chính thức:** Chạy mượt trên Mobile (360-430px); kiểm thử tải 100 user/10k task/100k message (p95 < 1s); phục hồi thảm họa thành công. |

---

## 3. Kiến trúc kỹ thuật đồng nhất (Tech Stack)

```
[Client Layer]
   ├── Next.js 14+ (App Router, Standalone mode, React, Tailwind CSS, shadcn/ui)
   ├── State Management: TanStack Query + React Hook Form + Zod
   └── PWA & Service Worker (Web Push)
          │
[Reverse Proxy] ── Caddy (Auto HTTPS/WSS, Rate Limit, Reverse Proxy)
          │
[Backend Services]
   ├── API Service: NestJS Modular Monolith (REST / OpenAPI, WebSocket Socket.IO)
   ├── Worker Service: BullMQ + Redis (Asynchronous AI jobs, Reminders, Outbox dispatcher)
   ├── AI Engine: Google Gen AI SDK (@google/genai) via Vertex AI
   └── Storage Adapter: Private filesystem volume
          │
[Database & Cache]
   ├── PostgreSQL (Data source of truth, Full-text Search, unaccent, pg_trgm)
   └── Redis (Cache, BullMQ queues, Socket.IO adapter)
```

---

## 4. Định nghĩa hoàn thành chung (Definition of Done - DoD)

Một giai đoạn chỉ được coi là hoàn thành khi đáp ứng đủ các tiêu chuẩn sau:
1. **Source Code hoàn chỉnh:** Code sạch, có typing TypeScript đầy đủ, không có any tuỳ tiện, không có lint error hoặc crash.
2. **Database Migration an toàn:** Migration script chạy trơn tru, không có hard-reset hay phá hủy dữ liệu cũ.
3. **Automated Tests Pass:** Tất cả unit test, integration test và e2e test quy định cho giai đoạn đều vượt qua 100%.
4. **Bảo mật & Phân quyền:** Các API và WebSocket event đều được bảo vệ bằng guards kiểm tra quyền (Admin / Lead / Member).
5. **Tài liệu & Log nghiệm thu:** Có báo cáo kết quả lệnh test thực tế, danh sách thay đổi và ghi chú vận hành.
