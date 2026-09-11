# Giai đoạn 4: Hoàn Thiện Hệ Thống, Tối Ưu Mobile & Sẵn Sàng Bàn Giao Production

Tài liệu chi tiết kỹ thuật cho Mốc 4 theo kế hoạch [plan.md](file:///D:/TOOL_LAMVIEC/plan.md). Đây là **Mốc Bàn Giao Chính Thức Toàn Diện** của sản phẩm.

---

## 1. Mục Tiêu Của Giai Đoạn (Objectives)

1. **Hệ thống Nhắc Việc Thông Minh (Smart Reminder Engine) & Web Push:** Tự động phát hiện và gửi thông báo nhắc việc quan trọng (sắp đến hạn 2h, mới trễ, không cập nhật quá 2 ngày, cảnh báo tắc nghẽn dependency, quá tải workload > 8 task). Hỗ trợ Web Push Notification với chuẩn VAPID và tôn trọng nghiêm ngặt Khung giờ yên lặng (20:00 - 08:00).
2. **Tổng Hợp Báo Cáo Định Kỳ Bằng AI & Xuất Dữ Liệu CSV:** AI định kỳ tổng hợp báo cáo tiến độ theo ngày/tuần dựa trên số liệu truy vấn thực tế kèm hyperlink dẫn đến từng task. Cung cấp tính năng xuất báo cáo công việc và bảng công điểm danh ra định dạng CSV chuẩn UTF-8.
3. **Tối Ưu Hóa Toàn Diện Giao Diện Mobile Web & PWA:** Tối ưu hóa trải nghiệm trên các màn hình điện thoại thực tế (viewport 360px - 430px), thanh điều hướng Bottom Bar 4 nút (`Hôm nay`, `Chat`, `Công việc`, `Thêm`), Task detail mở Full Screen, thao tác vuốt mượt mà, cấu hình Web App Manifest và Service Worker hỗ trợ cài đặt dạng PWA (Add to Home Screen).
4. **Tự Động Hóa Sao Lưu & Phục Hồi Thảm Họa (Disaster Recovery):** Kịch bản tự động sao lưu CSDL PostgreSQL và thư mục file đính kèm hàng ngày, lưu giữ 14 bản sao gần nhất, cùng kịch bản khôi phục (restore script) đã được diễn tập thành công 100%.
5. **Hạ Tầng Production Hoàn Chỉnh Với Caddy & Docker Compose:** Cấu hình Caddy Reverse Proxy tự động cấp phát SSL Let's Encrypt, bảo vệ WebSocket, bảo mật HTTP Headers (HSTS, CSP, X-Frame-Options), cấu hình Multi-stage Dockerfile chạy dưới user non-root an toàn.
6. **Kiểm Thử Tải (Load Testing) & Nghiệm Thu Toàn Diện:** Kiểm thử tải với dữ liệu mô phỏng công ty 100 nhân viên, 10.000 tasks, 100.000 messages và 50 phiên hoạt động đồng thời; đảm bảo thời gian phản hồi p95 < 1s cho API và < 2s cho tìm kiếm. Bàn giao đầy đủ tài liệu Runbook vận hành.

---

## 2. Các Hạng Mục Chi Tiết Cần Làm (What To Do)

### 2.1. Thiết kế Schema CSDL Bổ sung & Thông Báo (Prisma)
- `notifications`: `id`, `org_id`, `user_id`, `type` (`TASK_ASSIGNED`, `TASK_REMINDER`, `AI_ACTION_PROPOSED`, `ATTENDANCE_ALERT`, `SYSTEM`), `title`, `body`, `entity_type`, `entity_id`, `is_read`, `created_at`.
- `notification_preferences`: `id`, `user_id`, `enable_web_push`, `enable_in_app`, `quiet_hours_start` (default `20:00`), `quiet_hours_end` (default `08:00`), `created_at`, `updated_at`.
- `push_subscriptions`: `id`, `user_id`, `endpoint`, `p256dh_key`, `auth_key`, `user_agent`, `created_at`.
- `reminder_deliveries`: `id`, `task_id`, `reminder_type` (`DUE_SOON_2H`, `OVERDUE_ONCE`, `WAITING_STALE_2D`, `INACTIVE_STALE_2D`), `deadline_version`, `sent_at`.
  - **Ràng buộc quan trọng:** Khóa duy nhất `[task_id, reminder_type, deadline_version]` để đảm bảo tuyệt đối không gửi nhắc nhở trùng lặp cho cùng một mốc deadline.

### 2.2. Xây Dựng Smart Reminder Engine (BullMQ Cron Jobs)
- Thiết lập hàng đợi `reminder-queue` với các cron job chạy định kỳ mỗi 5 - 15 phút:
  1. **Nhắc việc sắp đến hạn:** Quét các task có `deadline` nằm trong khoảng từ `now() + 115m` đến `now() + 125m` chưa hoàn thành -> Gửi nhắc nhở cho Assignee.
  2. **Nhắc việc mới trễ hạn:** Quét task vừa quá deadline trong vòng 15 phút qua -> Gửi cảnh báo trễ hạn một lần duy nhất.
  3. **Cảnh báo task bị đình trệ:**
     - Task ở trạng thái `Waiting` quá 2 ngày làm việc không có cập nhật.
     - Task chưa có người phụ trách (Unassigned) quá 4 giờ làm việc.
     - Task đang `In Progress` nhưng không có cập nhật/bình luận nào trong 48 giờ.
  4. **Cảnh báo nghẽn phụ thuộc (Dependency Blocked):** Task A sắp đến hạn trong vòng 24h nhưng task điều kiện B vẫn chưa xong -> Gửi thông báo cho người phụ trách cả 2 task và Lead.
  5. **Cảnh báo quá tải công việc (Workload Overload):** Nhân viên có trên 8 task lá đang mở (`To Do` / `In Progress`) -> Gửi bản tin tóm tắt cho Lead để cân nhắc phân bổ lại việc.
- **Quy tắc Khung giờ yên lặng (Quiet Hours 20:00 - 08:00):**
  - Tin nhắn chat và thông báo giao việc mới: Luôn được lưu vào hộp thư (inbox/notification bell) trong app ngay lập tức.
  - Thông báo Web Push nhắc việc: Nếu rơi vào khung giờ yên lặng, job sẽ đưa vào hàng đợi trì hoãn (delayed queue) và gộp lại để đẩy vào lúc 08:05 sáng hôm sau.

### 2.3. Tích Hợp Web Push Notification (VAPID)
- Sinh cặp khóa VAPID (`web-push generate-vapid-keys`).
- Frontend đăng ký Service Worker `sw.js` lắng nghe sự kiện `push` và `notificationclick`.
- Hiển thị popover xin quyền nhận thông báo trên trình duyệt một cách tế nhị (chỉ hỏi khi user bật toggle trong cài đặt cá nhân hoặc sau khi đăng nhập 3 ngày).

### 2.4. Tính Năng Báo Cáo AI & Xuất File CSV
- **Báo cáo định kỳ bằng Vertex AI:**
  - Định kỳ cuối ngày (17:30) hoặc sáng thứ Hai (08:30), hệ thống truy vấn CSDL để lấy số liệu thực: số việc hoàn thành, việc trễ, việc phát sinh mới theo từng team.
  - Dữ liệu thô được đưa vào Context của Gemini với prompt yêu cầu tóm tắt ngắn gọn, giọng văn chuyên nghiệp, và bắt buộc kèm theo markdown link `[Tên Task](/tasks/:id)`. Tuyệt đối không để AI tự bịa số liệu.
- **Xuất dữ liệu CSV:**
  - Export danh sách Task: ID, Tiêu đề, Người giao, Người làm, Team, Project, Trạng thái, Ngày bắt đầu, Deadline, Ngày xong, Thời gian hoàn thành, Trễ hạn (Có/Không).
  - Export Bảng Điểm danh: Tên nhân viên, Email, Team, Ngày, Giờ vào, Giờ ra, Tổng thời lượng (giờ), Trạng thái (Hợp lệ / Quá 16h / Đã điều chỉnh).
  - Định dạng chuẩn UTF-8 có BOM để mở trên Microsoft Excel tiếng Việt không bị lỗi font.

### 2.5. Tối Ưu Hóa Mobile Web & Ứng Dụng PWA
- Tinh chỉnh CSS Tailwind cho màn hình nhỏ:
  - Loại bỏ hoàn toàn thanh cuộn ngang (No horizontal scrollbar) trên kích thước 360px, 375px, 390px, 412px, 430px.
  - Thay thế Sidebar desktop bằng **Bottom Navigation Bar** gồm 4 tab:
    1. `Hôm nay` (Danh sách việc cần làm, nút In/Out to rõ dễ bấm).
    2. `Chat` (Danh sách hội thoại, mở khung chat gọn).
    3. `Công việc` (Danh sách task dạng thẻ card chạm mở).
    4. `Thêm` (Đội nhóm, Báo cáo, Cài đặt cá nhân, Đăng xuất).
  - Modal chi tiết Task trên Mobile mở toàn màn hình (Full Screen Sheet) có nút đóng góc trên bên trái, thao tác vuốt xuống để đóng.
- Cấu hình Progressive Web App (PWA):
  - File `manifest.json`: Tên app, icons kích thước 192x192, 512x512, màu theme `#0F172A`, `display: standalone`.
  - Service Worker cache static assets (offline fallback khi mất sóng).

### 2.6. Tự Động Hóa Sao Lưu & Khôi Phục (Backup & Disaster Recovery)
- Xây dựng kịch bản `scripts/backup.sh`:
  - Dump CSDL PostgreSQL bằng `pg_dump` nén dạng `.sql.gz`.
  - Nén thư mục lưu trữ file đính kèm `storage/`.
  - Đặt tên file theo định dạng: `backup_YYYYMMDD_HHMMSS.tar.gz`.
  - Tự động xóa các bản sao lưu cũ hơn 14 ngày.
  - Cung cấp hook đẩy bản backup sang lưu trữ ngoài (S3-compatible / NAS / Remote SSH).
- Xây dựng kịch bản `scripts/restore.sh`:
  - Giải nén file backup.
  - Tự động kiểm tra tính toàn vẹn file dump.
  - Restore CSDL vào PostgreSQL và giải nén lại các file đính kèm.

### 2.7. Hạ Tầng Production Hoàn Thiện (Caddy & Docker Compose)
- Viết `Caddyfile` hoàn chỉnh:
  - Tự động lấy chứng chỉ SSL Let's Encrypt cho domain chính.
  - Proxy đường dẫn `/api/*` và `/socket.io/*` tới `api:3001` kèm nâng cấp WebSocket (`websocket;`).
  - Proxy toàn bộ đường dẫn còn lại tới `web:3000`.
  - Cấu hình nén tự động `encode zstd gzip`.
  - Thiết lập Security Headers: `X-Content-Type-Options nosniff`, `X-Frame-Options DENY`, `Strict-Transport-Security "max-age=31536000; includeSubDomains"`.
- Hoàn thiện `Dockerfile` cho `api`, `web`, `worker`:
  - Multi-stage build để thu nhỏ dung lượng image (< 150MB).
  - Thiết lập user không có quyền root (`USER node` / `USER nextjs`) để chống leo thang đặc quyền.

---

## 3. Kế Hoạch Kiểm Thử (What & How To Test)

### 3.1. Kiểm thử Smart Reminder & Giờ Yên Lặng
- **Kịch bản 1: Nhắc trước 2 giờ:**
  - Tạo 1 task có deadline là 14:00.
  - Chỉnh giờ hệ thống giả lập hoặc đợi đến 12:00.
  - Kết quả: Nhân viên nhận được notification thông báo "Task XYZ sắp đến hạn trong 2 giờ tới". Bảng `reminder_deliveries` được ghi nhận. Chạy lại job sau đó 5 phút không gửi lại lần thứ 2.
- **Kịch bản 2: Tuân thủ Giờ yên lặng (Quiet Hours):**
  - Giả lập một task bị quá hạn lúc 23:00 đêm.
  - Kết quả: Hệ thống lưu notification vào app nhưng KHÔNG kích hoạt Web Push ra điện thoại người dùng. Lúc 08:05 sáng hôm sau, worker kích hoạt gửi Web Push tổng hợp các việc cần lưu ý trong ngày.

### 3.2. Kiểm Thử Tải Hệ Thống (Stress & Load Testing)
- **Công cụ:** Dùng kịch bản test tải với `k6` hoặc `autocannon`.
- **Bộ dữ liệu thử nghiệm:**
  - Tạo script seed tạo 100 tài khoản người dùng, 10 team, 10.000 tasks và 100.000 tin nhắn chat.
- **Kịch bản tải:**
  - Mô phỏng 50 phiên làm việc đồng thời (50 concurrent virtual users).
  - Tác vụ: Gửi tin nhắn chat, lấy danh sách task trang Hôm nay, cập nhật trạng thái việc, tìm kiếm universal search.
- **Tiêu chuẩn đạt nghiệm thu:**
  - Tỷ lệ lỗi (Error rate): < 0.1%.
  - Thời gian phản hồi API thông thường (GET/POST task, chat history): p95 < 1.000 ms.
  - Thời gian phản hồi tìm kiếm Universal Search: p95 < 2.000 ms.
  - Mức tiêu thụ tài nguyên máy chủ: CPU < 80%, RAM không bị rò rỉ (memory leak).

### 3.3. Kiểm thử Giao diện Mobile Thực Tế (Playwright Mobile E2E)
- **Thiết bị kiểm thử:** Mô phỏng viewports: iPhone 13 (390x844), Pixel 7 (412x915), iPhone SE (375x667), Galaxy S8 (360x740).
- **Kịch bản test:**
  1. Đăng nhập trên mobile -> Không bị che khuất trường nhập mật khẩu khi bàn phím ảo bật lên.
  2. Bottom Navigation chuyển tab mượt mà, tab đang chọn có highlight rõ nét.
  3. Bấm In/Out điểm danh to rõ ở đầu trang, một chạm phản hồi ngay.
  4. Mở chi tiết task -> Sheet mở toàn màn hình, vuốt cuộn đọc mượt mà, nút Đóng dễ bấm bằng ngón tay cái.
  5. Kiểm tra tràn ngang: Không có phần tử nào có `scrollWidth > clientWidth`.

### 3.4. Diễn Tập Khôi Phục Thảm Họa (Disaster Recovery Drill)
- **Kịch bản test:**
  1. Đang có hệ thống hoạt động bình thường với 50 task và 200 tin nhắn và 10 file upload.
  2. Chạy lệnh backup: `pnpm run backup:prod`.
  3. Giả lập sự cố thảm họa: Xóa sạch container và xóa sạch volume CSDL: `docker-compose down -v && rm -rf ./storage/*`.
  4. Chạy lệnh restore: `pnpm run restore:prod <file_backup.tar.gz>`.
  5. Khởi động lại hệ thống: `docker-compose up -d`.
  6. Kiểm tra lại dữ liệu: Đăng nhập tài khoản, kiểm tra toàn bộ tin nhắn, task, avatar, file đính kèm và lịch sử điểm danh đều nguyên vẹn 100%.

### 3.5. Kiểm Tra Rà Soát Quyền & Độc Lập Mã Nguồn (Code Audit)
- Thực hiện rà soát độc lập toàn bộ codebase:
  - Quét lỗ hổng bảo mật dependency: `pnpm audit`.
  - Kiểm tra không có API nào bị quên Guard phân quyền.
  - Kiểm tra Audit Log ghi nhận đầy đủ khi Admin truy cập vào các phòng chat riêng tư.
  - Kiểm tra các biến môi trường và secret không bị lọt vào frontend bundle hay Docker image.

---

## 4. Tiêu Chí Nghiệm Thu (Acceptance Criteria / DoD - Bàn Giao Toàn Diện)

- [ ] Toàn bộ 5 Mốc (Phase 0 đến Phase 4) đã hoàn thiện và tích hợp chặt chẽ với nhau.
- [ ] Ứng dụng chạy bằng Docker Compose mượt mà, cấu hình Caddy tự động SSL/WSS sẵn sàng cho domain production.
- [ ] Tính năng Nhắc việc thông minh và Web Push hoạt động tin cậy, không gửi trùng lặp, tuân thủ đúng giờ yên lặng.
- [ ] Báo cáo AI định kỳ tổng hợp chính xác số liệu có kèm link task; tính năng xuất CSV mở trên Excel tiếng Việt không lỗi font.
- [ ] Trải nghiệm Mobile Web và PWA đạt chuẩn di động: không tràn ngang, bottom nav tiện lợi, nút bấm thân thiện ngón tay.
- [ ] Vượt qua bài kiểm thử tải 50 phiên đồng thời với 100 users, 10.000 tasks, 100.000 messages (p95 API < 1s, Search < 2s).
- [ ] Kịch bản sao lưu và khôi phục thảm họa được kiểm chứng thực tế thành công 100%.
- [ ] Cung cấp trọn bộ tài liệu Runbook vận hành: Hướng dẫn cài đặt sạch từ máy chủ trắng, cấu hình Google Cloud Vertex AI, khởi tạo tài khoản quản trị đầu tiên, lịch trình bảo trì và quy trình sao lưu định kỳ.
