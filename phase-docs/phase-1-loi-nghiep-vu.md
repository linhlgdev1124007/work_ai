# Giai đoạn 1: Lõi Nghiệp Vụ - Chat Realtime, Quản Lý Task Thủ Công & Điểm Danh

Tài liệu chi tiết kỹ thuật cho Mốc 1 theo kế hoạch [plan.md](file:///D:/TOOL_LAMVIEC/plan.md).

---

## 1. Mục Tiêu Của Giai Đoạn (Objectives)

1. **Xây dựng cấu trúc Tổ chức & Dự án (Team & Project Management):** Cho phép tạo các Team (Social, Web, Product, Tool...), Project trực thuộc Team, phân công Team Lead/PIC và gán thành viên tham gia.
2. **Hệ thống Chat Realtime độc lập, mượt mà:** Xây dựng phòng chat thời gian thực qua WebSocket (Socket.IO): hỗ trợ chat Team, chat Project, nhóm riêng và chat trực tiếp 1-1 (Direct Message). Đầy đủ tính năng: gửi tin nhắn văn bản, ảnh, file, link, mention (@user), reply tin nhắn, phân trang cursor, đánh dấu đã đọc (read marker) và sửa/xóa mềm tin nhắn.
3. **Quản lý File & Attachment an toàn (Private Storage):** Hỗ trợ đính kèm file trong chat và task, lưu trữ bảo mật trong volume nội bộ qua Storage Adapter, giới hạn 25 MB/file, kiểm tra quyền truy cập nghiêm ngặt trước khi cho phép tải về hoặc xem ảnh.
4. **Hệ thống Quản lý Task thủ công cơ bản:** Cung cấp trải nghiệm tạo task tiện lợi qua form nhanh (chỉ cần tiêu đề) và modal chi tiết. Quản lý trạng thái (`To Do`, `In Progress`, `Waiting`, `Review`, `Completed`, `Paused`), mức độ ưu tiên (`Low`, `Normal`, `High`, `Urgent`), deadline, người phụ trách, cùng lịch sử hoạt động chi tiết (`task_events`). Thuộc tính `Overdue` được tính toán tự động.
5. **Màn hình "Hôm nay" (Personal Today View):** Màn hình trọng tâm giúp nhân viên mở app là biết ngay việc cần làm: Đang làm, Việc trễ, Việc đến hạn hôm nay, Việc sắp tới, Việc không deadline, Việc đã hoàn thành.
6. **Module Điểm danh In/Out cơ bản:** Nút bấm 1 chạm Check-in / Check-out ở thanh điều hướng trên cùng. Sử dụng giờ server (UTC) quy đổi về múi giờ `Asia/Ho_Chi_Minh`. Ràng buộc chặt chẽ CSDL để mỗi nhân viên chỉ có duy nhất một phiên làm việc đang mở tại một thời điểm, chống trùng lặp phiên do click đúp hoặc mở nhiều tab.

---

## 2. Các Hạng Mục Chi Tiết Cần Làm (What To Do)

### 2.1. Thiết kế Schema CSDL Bổ sung (Prisma)
- **Nhóm Chat:**
  - `conversations`: `id`, `org_id`, `type` (`TEAM`, `PROJECT`, `DIRECT`, `GROUP`), `name`, `team_id` (nullable), `project_id` (nullable), `last_message_at`, `created_at`, `updated_at`.
  - `conversation_members`: `id`, `conversation_id`, `user_id`, `role` (`ADMIN`, `MEMBER`), `joined_at`, `last_read_message_id`, `unread_count`.
  - `messages`: `id`, `conversation_id`, `sender_id`, `reply_to_id`, `content`, `is_deleted` (boolean), `client_message_id` (idempotency), `version`, `created_at`, `updated_at`.
  - `message_revisions`: `id`, `message_id`, `old_content`, `edited_by`, `created_at`.
  - `message_mentions`: `id`, `message_id`, `user_id`, `created_at`.
  - `read_markers`: `id`, `conversation_id`, `user_id`, `last_read_message_id`, `updated_at`.
- **Nhóm Task:**
  - `tasks`: `id`, `org_id`, `team_id`, `project_id`, `parent_id` (nullable), `title`, `description`, `assignee_id` (nullable), `creator_id`, `priority` (`LOW`, `NORMAL`, `HIGH`, `URGENT`), `status` (`TODO`, `IN_PROGRESS`, `WAITING`, `REVIEW`, `COMPLETED`, `PAUSED`), `start_date`, `deadline`, `completion_deadline`, `completed_at`, `estimate_minutes`, `source_message_id` (nullable), `source_conversation_id` (nullable), `is_archived` (boolean), `version`, `created_at`, `updated_at`.
  - `task_events`: `id`, `task_id`, `actor_id`, `action_type`, `field_changed`, `old_value`, `new_value`, `metadata` (JSONB), `created_at`.
- **Nhóm File:**
  - `attachments`: `id`, `org_id`, `uploader_id`, `file_name`, `file_size`, `mime_type`, `storage_key`, `created_at`.
  - `message_attachments`: `id`, `message_id`, `attachment_id`.
  - `task_attachments`: `id`, `task_id`, `attachment_id`.
- **Nhóm Điểm danh cơ bản:**
  - `attendance_sessions`: `id`, `org_id`, `user_id`, `check_in_time`, `check_out_time` (nullable), `status` (`OPEN`, `CLOSED`), `note`, `created_at`, `updated_at`.
  - **Ràng buộc quan trọng:** Partial Unique Index trên PostgreSQL:
    `CREATE UNIQUE INDEX unique_open_attendance_session ON attendance_sessions (user_id) WHERE check_out_time IS NULL;`
    Đảm bảo ở tầng CSDL không thể tồn tại 2 phiên mở cùng lúc cho 1 user.

### 2.2. Backend Modules & API Hợp đồng
- **Chat Gateway (WebSocket - Socket.IO):**
  - Xác thực handshake bằng Session token.
  - Room management: Client tự động join vào các room `org_{orgId}`, `conv_{convId}`, `user_{userId}` tương ứng với quyền.
  - Events lắng nghe: `client.message.send`, `client.message.read`, `client.typing`.
  - Events phát ra: `message.created`, `message.updated`, `message.deleted`, `user.typing`.
  - Chống gửi lặp bằng `client_message_id` (idempotency key).
  - Phân trang tin nhắn: Cursor-based pagination (`/api/v1/conversations/:id/messages?cursor=...&limit=30`).
- **Tasks Module:**
  - CRUD Task cơ bản: `POST /api/v1/tasks`, `GET /api/v1/tasks`, `GET /api/v1/tasks/:id`, `PATCH /api/v1/tasks/:id`, `GET /api/v1/tasks/:id/events`.
  - Quyền cập nhật:
    - Member chỉ được sửa task mình phụ trách (nội dung, status chuyển `In Progress`, `Waiting`, hoặc `Review`).
    - Lead/Admin được giao việc, đổi assignee, dời deadline, duyệt hoàn thành (`Completed`).
  - Lịch sử thay đổi: Tự động ghi bản ghi `task_events` trong cùng database transaction khi có cập nhật.
  - Tính toán thuộc tính `is_overdue`:
    - Nếu task chưa Completed và hiện tại > deadline -> `is_overdue = true`.
    - Nếu task đã Completed và `completed_at > deadline` -> `is_overdue = true` (hoàn thành trễ).
    - Lưu `completion_deadline` tại thời điểm hoàn thành để dời deadline sau này không làm sai lệch số liệu lịch sử.
- **Files Module:**
  - `POST /api/v1/files/upload`: Validate kích thước (max 25MB), chặn các đuôi file nguy hiểm (`.exe`, `.sh`, `.bat`, `.html`, `.svg` chứa script).
  - Lưu file vào thư mục private volume với UUID key.
  - `GET /api/v1/files/:id/download` & `/api/v1/files/:id/preview`: Kiểm tra quyền truy cập vào message hoặc task chứa file trước khi pipe stream dữ liệu cho client.
- **Attendance Module:**
  - `POST /api/v1/attendance/in`: Lấy giờ server hiện tại (UTC), mở transaction kiểm tra phiên mở, tạo bản ghi `attendance_sessions`. Bắt lỗi partial unique index nếu đã có phiên mở.
  - `POST /api/v1/attendance/out`: Tìm phiên đang mở của user. Nếu không có phiên nào -> trả HTTP 400 kèm thông báo rõ ràng "Bạn chưa Check-in phiên nào". Nếu có -> ghi nhận `check_out_time = now()`, cập nhật `status = CLOSED`.
  - `GET /api/v1/attendance/current`: Trả về trạng thái phiên hiện tại (đang In hay đang Out, giờ bắt đầu, số phút đã làm).

### 2.3. Giao Diện Người Dùng (Frontend Next.js)
- **Màn hình Chat chính:**
  - Cột danh sách hội thoại: Tab Team, Project, Nhóm riêng, Direct Messages. Hiển thị unread badge và preview tin nhắn mới nhất.
  - Khung hội thoại: Danh sách tin nhắn cuộn mượt, bong bóng tin nhắn, hỗ trợ reply preview, highlight @mention, ảnh preview thumbnail, file download button.
  - Khung nhập tin nhắn: Input linh hoạt, nút gửi file/ảnh, gợi ý mention danh sách thành viên khi gõ `@`.
  - Nút "Tạo task từ tin nhắn": Nằm trên menu chuột phải / hover của tin nhắn, mở form tạo task điền sẵn tiêu đề từ nội dung tin nhắn và gắn link nguồn `source_message_id`.
  - Right Panel chi tiết Task: Khi bấm vào một task trong chat hoặc danh sách, mở thanh bên phải (drawer) mà không làm mất ngữ cảnh đang chat.
- **Màn hình "Hôm nay" (Today View cho Member):**
  - Section 1: **Đang làm** (Task đang thực hiện).
  - Section 2: **Việc trễ** (Cảnh báo đỏ, badge trễ bao nhiêu giờ/ngày).
  - Section 3: **Việc đến hạn hôm nay** (Deadline trước 23:59 hôm nay).
  - Section 4: **Việc sắp tới** (Deadline trong 7 ngày tới).
  - Section 5: **Việc không có deadline**.
  - Section 6: **Việc đã hoàn thành hôm nay**.
  - Nút chuyển nhanh trạng thái (ví dụ: Bắt đầu làm -> In Progress, Hoàn thành -> Review/Completed).
- **Màn hình "Công việc" (Task Board & List):**
  - Chế độ xem Danh sách (List) và Kanban cơ bản (Cột theo trạng thái).
  - Bộ lọc: Theo Team, Project, Assignee, Trạng thái, Mức độ ưu tiên.
- **Widget Điểm danh trên Header:**
  - Hiển thị nút "Check In" màu xanh lá khi chưa vào ca.
  - Khi đã Check-in: Chuyển thành nút "Check Out" màu cam kèm đồng hồ đếm thời gian làm việc trong phiên: `Đã làm: 03h 45m`.

---

## 3. Kế Hoạch Kiểm Thử (What & How To Test)

### 3.1. Kiểm thử Chat Realtime đa người dùng
- **Công cụ:** Mở 2 cửa sổ trình duyệt (User A và User B) đăng nhập 2 tài khoản khác nhau.
- **Kịch bản 1: Nhắn tin 1-1 và Group Chat:**
  - User A nhắn "Xin chào B" trong hội thoại chung của Team Social.
  - Kết quả: User B nhận được tin nhắn tức thì qua Socket.IO mà không cần tải lại trang.
  - User B thấy badge tin nhắn chưa đọc tăng lên 1; khi User B cuộn tới tin nhắn đó, read marker được gửi lên và unread count chuyển về 0.
- **Kịch bản 2: Reply và Mention:**
  - User B gõ `@` và chọn User A, kèm nội dung reply tin nhắn của A.
  - Kết quả: User A nhận được âm thanh / notification mention, tin nhắn hiển thị khung trích dẫn tin nhắn gốc rõ ràng.
- **Kịch bản 3: Sửa và xóa mềm tin nhắn:**
  - User A bấm sửa tin nhắn vừa gửi.
  - Kết quả: Nội dung cập nhật tức thì trên màn hình User B, hiển thị nhãn `(Đã chỉnh sửa)`. Bảng `message_revisions` lưu lại bản sửa.
  - User A xóa tin nhắn -> Màn hình hiển thị "Tin nhắn đã bị thu hồi", không hard-delete khỏi CSDL.
- **Kịch bản 4: Mất mạng và Reconnect:**
  - User A ngắt mạng 5 giây rồi kết nối lại.
  - Kết quả: Socket.IO tự động reconnect, đồng bộ các tin nhắn bị lỡ qua cursor query, không bị trùng lặp hay mất tin.

### 3.2. Kiểm thử Quản lý Task thủ công
- **Kịch bản 1: Tạo task từ tin nhắn:**
  - Lead hover vào tin nhắn của mình trong nhóm: "Làm slide giới thiệu dự án trước 17h thứ Sáu". Bấm "Tạo task từ tin nhắn".
  - Kết quả: Form mở ra, tiêu đề tự điền nội dung tin nhắn, gán `source_message_id`. Lead chọn Assignee là Member A và ấn Tạo.
  - Task xuất hiện ngay trong danh sách việc của Member A và trong hội thoại hiện liên kết đến task.
- **Kịch bản 2: Cập nhật trạng thái và Phân quyền:**
  - Member A bấm "Bắt đầu làm" -> Trạng thái task chuyển thành `In Progress`.
  - Member A thử dời deadline hoặc chuyển task cho Member B -> Backend chặn với lỗi 403 (Member không có quyền đổi người hoặc dời deadline do Lead giao).
  - Member A bấm "Gửi review" -> Trạng thái chuyển thành `Review`.
  - Lead vào duyệt hoàn thành -> Trạng thái chuyển thành `Completed`, ghi nhận `completed_at = now()`.
- **Kịch bản 3: Kiểm tra Lịch sử Task (`task_events`):**
  - Mở panel chi tiết task.
  - Kết quả: Tab Lịch sử hiển thị đầy đủ dòng thời gian: ai tạo task, ai chuyển trạng thái, ai đổi deadline, thời điểm chính xác đến từng phút.

### 3.3. Kiểm thử Điểm danh (Attendance Testing)
- **Kịch bản 1: Check-in / Check-out bình thường:**
  - User bấm "Check In" lúc 08:30.
  - Kết quả: Nút chuyển sang "Check Out", CSDL lưu `check_in_time` đúng múi giờ `Asia/Ho_Chi_Minh`.
  - Lúc 12:00 bấm "Check Out" -> Phiên đóng thành công, tính tổng thời gian làm việc = 3.5 giờ.
  - Lúc 13:00 bấm "Check In" ca chiều -> Tạo thành công phiên thứ 2 trong cùng 1 ngày.
- **Kịch bản 2: Chống Double-Click & Chống Trùng Phiên (Race Condition):**
  - Mở 2 tab trên trình duyệt của cùng 1 user. Bấm "Check In" ở tab 1 và đồng thời bấm "Check In" ở tab 2.
  - Kết quả: 1 request thành công tạo phiên, request thứ 2 bị chặn bởi database partial unique index, trả về thông báo lỗi thân thiện "Bạn đang có một phiên làm việc đang mở".
- **Kịch bản 3: Check-out khi chưa Check-in:**
  - Gửi request `POST /api/v1/attendance/out` khi chưa có phiên mở.
  - Kết quả: Nhận HTTP 400 với thông điệp rõ ràng "Không tìm thấy phiên làm việc đang mở để Check-out".

### 3.4. Kiểm thử Upload & Tải File
- **Kịch bản 1: File hợp lệ:** Upload ảnh PNG 5MB vào chat -> Hiển thị thumbnail preview mượt mà, bấm xem full size được.
- **Kịch bản 2: File vượt giới hạn:** Upload file video 35MB -> Nhận thông báo lỗi "Kích thước file vượt quá giới hạn 25MB".
- **Kịch bản 3: Chặn file độc:** Upload file `script.html` hoặc `test.exe` -> Hệ thống từ chối nhận file, ghi log cảnh báo.
- **Kịch bản 4: Quyền tải file:** User C (không thuộc Team A) cố tình copy link tải file nội bộ của Team A -> Nhận lỗi HTTP 403 Forbidden.

### 3.5. Kiểm thử Tính bền vững dữ liệu (Persistence Test)
- Nhắn 10 tin nhắn, tạo 3 task, thực hiện 1 lượt điểm danh.
- Chạy lệnh khởi động lại container: `docker-compose restart`.
- Tải lại trình duyệt: Toàn bộ tin nhắn, trạng thái task và phiên điểm danh vẫn nguyên vẹn 100%.

---

## 4. Tiêu Chí Nghiệm Thu (Acceptance Criteria / DoD)

- [ ] Hai người dùng có thể chat realtime với nhau trong các nhóm và chat 1-1, nhận tin tức thì không cần reload.
- [ ] Gửi được ảnh và file tài liệu dưới 25MB an toàn, preview ảnh nhanh chóng, bảo mật quyền tải file.
- [ ] Tạo được task thủ công và tạo task nhanh từ tin nhắn chat, liên kết ngược lại tin nhắn nguồn chuẩn xác.
- [ ] Toàn bộ vòng đời task (`To Do` -> `In Progress` -> `Review` -> `Completed`) hoạt động trơn tru; lịch sử `task_events` ghi nhận chi tiết từng thay đổi.
- [ ] Trang "Hôm nay" hiển thị đúng các nhóm công việc của từng thành viên, tự động gắn cờ trễ hạn (Overdue) khi quá deadline.
- [ ] Nút In/Out điểm danh hoạt động chính xác theo giờ server, tuyệt đối không bị trùng lặp phiên khi mở nhiều tab hay click đúp.
- [ ] Dữ liệu không bị mất sau khi khởi động lại dịch vụ hoặc máy chủ.
- [ ] Bộ automated tests cho Chat, Task và Attendance pass 100%.
