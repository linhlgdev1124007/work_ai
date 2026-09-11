# Giai đoạn 3: Quản Lý Công Việc Nâng Cao, Dashboard Toàn Diện & Điều Chỉnh Điểm Danh

Tài liệu chi tiết kỹ thuật cho Mốc 3 theo kế hoạch [plan.md](file:///D:/TOOL_LAMVIEC/plan.md).

---

## 1. Mục Tiêu Của Giai Đoạn (Objectives)

1. **Quản trị cấu trúc Task chuyên sâu (Advanced Task Structures):** Bổ sung Subtask (1 cấp), Checklist items có thể tích chọn, và quan hệ phụ thuộc (Task Dependencies) với thuật toán ngăn chặn tạo vòng lặp vô tận (Cycle Detection).
2. **Quy tắc Kiểm soát Hoàn thành & Quy trình Review:** Chặn hoàn thành task cha nếu còn subtask chưa xong hoặc task phụ thuộc chưa hoàn thành (chỉ Lead/Admin được phép override có lý do). Triển khai luồng Review: Member gửi yêu cầu duyệt, Lead/Admin nghiệm thu trước khi chuyển sang `Completed`.
3. **Cơ chế "Tôi đang làm gì" & Màn hình "Ai đang làm gì" (Work Status Engine):** Cho phép nhân viên cập nhật công việc hiện tại bằng 1 chạm hoặc câu chat AI. Xây dựng màn hình trực quan cho Quản lý theo dõi toàn bộ nhân sự theo thời gian thực (ai đang làm gì, số việc còn lại, deadline gần nhất, số việc trễ).
4. **Hệ thống Dashboard & Báo cáo Quản trị Toàn diện:** Thống kê theo Team, Project, Thành viên với các chỉ số chuẩn xác: Workload (chỉ tính task lá), Tỷ lệ hoàn thành đúng hạn (dựa trên snapshot deadline tại lúc hoàn thành), Thời gian hoàn thành trung bình.
5. **Universal Search Engine (Tìm kiếm vạn năng):** Tìm kiếm tức thì tin nhắn, task, file, thành viên bằng PostgreSQL Full-Text Search, hỗ trợ tiếng Việt có dấu/không dấu (`unaccent`), tìm kiếm mờ (`pg_trgm`) và tích hợp AI phân giải câu hỏi tự nhiên thành bộ lọc có cấu trúc. Phân quyền lọc dữ liệu trước khi trả về.
6. **Quy trình Yêu cầu & Phê duyệt Điều chỉnh Điểm danh:** Cho phép nhân viên gửi đơn điều chỉnh giờ vào/ra khi quên chấm công. Lead duyệt nhân viên thuộc team, Admin duyệt toàn hệ thống; cấm người tạo tự duyệt; thuật toán kiểm tra nghiêm ngặt không cho phép các phiên làm việc chồng chéo lên nhau.

---

## 2. Các Hạng Mục Chi Tiết Cần Làm (What To Do)

### 2.1. Thiết kế Schema CSDL Bổ sung (Prisma)
- **Cấu trúc Task nâng cao:**
  - `task_checklist_items`: `id`, `task_id`, `title`, `is_completed`, `position`, `completed_by_id` (nullable), `completed_at` (nullable).
  - `task_dependencies`: `id`, `task_id` (task bị phụ thuộc), `depends_on_task_id` (task điều kiện tiên quyết), `created_at`. Unique `[task_id, depends_on_task_id]`.
  - Cập nhật bảng `tasks`: Thêm cờ `requires_review` (boolean, default false), `reviewer_id` (nullable).
- **Trạng thái Đang làm (Current Work):**
  - `current_work`: `id`, `user_id` (unique), `task_id` (nullable), `custom_status_text` (nullable), `started_at`, `updated_at`.
  - `work_status_events`: `id`, `user_id`, `task_id` (nullable), `status_text`, `action` (`START`, `SWITCH`, `STOP`), `created_at`.
- **Điều chỉnh Điểm danh:**
  - `attendance_adjustments`: `id`, `org_id`, `user_id`, `session_id` (nullable, nếu sửa phiên có sẵn), `type` (`NEW_SESSION`, `EDIT_SESSION`), `requested_check_in`, `requested_check_out`, `reason`, `status` (`PENDING`, `APPROVED`, `REJECTED`), `approver_id` (nullable), `approved_at` (nullable), `rejection_reason` (nullable), `created_at`, `updated_at`.
  - `attendance_events`: `id`, `session_id`, `actor_id`, `event_type`, `old_value` (JSONB), `new_value` (JSONB), `reason`, `created_at`.

### 2.2. Xử lý Logic Nghiệp Vụ Backend
- **Kiểm soát Phụ thuộc Task (Dependency Engine):**
  - Khi thêm dependency: Chạy thuật toán phát hiện chu trình (Directed Acyclic Graph - Cycle Detection bằng DFS/BFS). Nếu phát hiện A phụ thuộc B và B phụ thuộc A (hoặc qua chuỗi dài hơn) -> Lập tức từ chối và trả lỗi HTTP 400.
  - Khi hoàn thành task: Kiểm tra điều kiện:
    1. Tất cả `task_checklist_items` của task phải có `is_completed = true`.
    2. Tất cả subtasks trực tiếp phải có `status = COMPLETED`.
    3. Tất cả `depends_on_task_id` phải có `status = COMPLETED`.
    - Nếu không thỏa mãn: Chặn hoàn thành. Trừ trường hợp người thực hiện là Lead/Admin có truyền cờ `override = true` kèm lý do giải trình bắt buộc (ghi vào `task_events`).
- **Luồng Review Task:**
  - Khi Member bấm hoàn thành task có `requires_review = true` -> Trạng thái chuyển thành `Review`.
  - Reviewer mặc định: Người giao việc (nếu có quyền) hoặc Lead của Team.
  - Reviewer có thể bấm `[Duyệt hoàn thành]` -> Task chuyển sang `Completed` (lưu `completed_at = now()`), hoặc `[Yêu cầu sửa lại]` kèm bình luận -> Task quay lại `In Progress`.
- **Module Current Work ("Tôi đang làm gì"):**
  - Mỗi nhân viên chỉ có duy nhất 1 bản ghi trong bảng `current_work`.
  - Cho phép chọn 1 task cụ thể hoặc nhập trạng thái tự do ("Đang họp với đối tác").
  - Nếu chuyển sang task khác: Tự động kết thúc mốc thời gian task cũ, bắt đầu task mới; **không tự ý đánh dấu task cũ là Completed**.
  - Tích hợp với Điểm danh: Khi nhân viên thực hiện **Check-out**, hệ thống tự động gọi hàm kết thúc phiên `current_work` hiện tại (trạng thái task giữ nguyên).
- **Universal Search Engine:**
  - Tạo chỉ mục PostgreSQL Full-Text Search:
    - `ALTER TABLE tasks ADD COLUMN search_vector tsvector;`
    - Cập nhật trigger tự động sinh `search_vector` kết hợp `title`, `description`, sử dụng từ điển `vietnamese` / `unaccent`.
    - Tạo `GIN` index trên `search_vector` và `pg_trgm` index trên tiêu đề task, nội dung tin nhắn.
  - Xử lý tìm kiếm bằng AI: Nhận câu hỏi tự nhiên từ người dùng (ví dụ: *"Tìm task banner Sang làm tuần trước"*), AI Context Engine trích xuất các bộ lọc: `{ assignee: "Sang", keyword: "banner", time_range: "last_week" }` và kết hợp với câu lệnh SQL query tối ưu.
  - **Bảo mật tìm kiếm:** Luôn lọc theo quyền của user trước khi thực thi query (Member không bao giờ tìm thấy tin nhắn hoặc file thuộc room riêng tư của người khác).
- **Module Điều chỉnh Điểm danh (Attendance Adjustments):**
  - Nhân viên gửi đơn yêu cầu bổ sung/sửa giờ vào ra.
  - Phân quyền duyệt: Lead duyệt thành viên thuộc team quản lý; Admin duyệt toàn bộ.
  - **Chặn tự duyệt:** Người tạo đơn không bao giờ được phép duyệt đơn của chính mình (kể cả Lead hay Admin).
  - **Kiểm tra Chồng chéo (Overlap Check Transaction):** Khi duyệt, hệ thống kiểm tra khoảng thời gian `[requested_check_in, requested_check_out]` có trùng đè lên bất kỳ phiên nào khác của user đó không:
    `WHERE check_out_time > requested_check_in AND check_in_time < requested_check_out`
    Nếu trùng -> Từ chối duyệt và trả thông báo lỗi chi tiết.

### 2.3. Thiết kế Màn Hình Giao Diện (Frontend Next.js)
- **Màn hình "Đội nhóm / Ai đang làm gì" (Team Workload Dashboard):**
  - Bảng danh sách trực quan toàn bộ thành viên:
    - Cột 1: Thành viên (Avatar, Tên, Team, Trạng thái In/Out).
    - Cột 2: Đang làm gì (Tên task đang làm hoặc text tự do; nếu không có thì hiển thị xám: *"Chưa cập nhật"* - tuyệt đối không hiển thị "Đang rảnh").
    - Cột 3: Task còn lại (Chỉ tính task lá chưa hoàn thành).
    - Cột 4: Deadline gần nhất.
    - Cột 5: Số task bị trễ.
  - Bộ lọc theo Team, Project, hoặc tìm theo tên thành viên.
- **Màn hình Báo cáo Quản lý (Analytics Dashboard):**
  - Bộ thẻ KPI tổng quan: Tổng số việc, Đang làm, Chờ duyệt (Review), Đã xong, Việc trễ, Chưa có người phụ trách.
  - Biểu đồ phân bổ Workload theo từng thành viên trong team.
  - Tỷ lệ đúng hạn (On-time Delivery Rate): Tính bằng `Task hoàn thành đúng hạn / Task hoàn thành có deadline`.
  - Bộ lọc thời gian: Hôm nay, Tuần này, Tháng này, hoặc Tùy chọn khoảng ngày.
- **Thanh Universal Search Toàn Hệ Thống (Command Palette - Ctrl/Cmd + K):**
  - Hộp tìm kiếm mở nhanh bằng phím tắt.
  - Kết quả phân nhóm rõ ràng: Tabs `Tất cả`, `Tasks`, `Tin nhắn`, `Files`, `Thành viên`.
  - Tìm kiếm tiếng Việt không dấu: Gõ "thiet ke banner" vẫn tìm ra "Thiết kế banner".
- **Giao diện Quản lý Điểm danh & Duyệt Đơn (Attendance Management):**
  - Bảng tổng hợp công nhân viên theo tháng: Giờ làm từng ngày, tổng giờ trong tuần/tháng, các phiên thiếu out (quá 16h chưa out được đánh dấu vàng cần kiểm tra).
  - Tab "Yêu cầu điều chỉnh": Danh sách đơn chờ duyệt, hiển thị thời gian xin sửa, lý do, nút `[Chấp thuận]` / `[Từ chối]` (kèm lý do từ chối).

---

## 3. Kế Hoạch Kiểm Thử (What & How To Test)

### 3.1. Kiểm thử Cấu trúc Task Nâng Cao & Ràng Buộc
- **Kịch bản 1: Phát hiện chu trình Dependency (Cycle Detection):**
  - Tạo Task A và Task B.
  - Thiết lập Task B phụ thuộc Task A (B depends on A) -> Thành công.
  - Thử thiết lập Task A phụ thuộc Task B (A depends on B) -> Hệ thống lập tức chặn với HTTP 400 "Phát hiện vòng lặp phụ thuộc công việc".
  - Thử vòng tròn dài hơn: A -> B -> C -> A -> Bị chặn chính xác.
- **Kịch bản 2: Chặn hoàn thành task khi chưa đủ điều kiện:**
  - Task A có 3 checklist items (mới tích 2) và 1 task con B đang `In Progress`.
  - Member bấm "Hoàn thành Task A" -> Hệ thống từ chối, hiển thị modal thông báo: "Không thể hoàn thành do còn 1 mục checklist và 1 task con chưa xong".
  - Lead đăng nhập, bấm Hoàn thành kèm chọn `Override` và nhập lý do "Khách hàng chốt sớm, các mục con bỏ qua" -> Hệ thống ghi nhận Completed và lưu lý do vào `task_events`.
- **Kịch bản 3: Quy trình Review:**
  - Member hoàn thành task -> Task nhảy sang cột `Review`.
  - Lead bấm `[Yêu cầu sửa lại]` -> Task quay lại `In Progress`, Member nhận thông báo realtime.

### 3.2. Kiểm thử Cơ chế Current Work
- **Kịch bản 1: Cập nhật công việc hiện tại:**
  - Nhân viên bấm "Bắt đầu làm" Task 1 -> Current Work hiển thị "Task 1".
  - Nhân viên bấm "Bắt đầu làm" Task 2 -> Current Work chuyển sang "Task 2". Task 1 vẫn giữ nguyên trạng thái `In Progress` (không tự đóng Task 1).
- **Kịch bản 2: Tự động dọn dẹp khi Check-out:**
  - Nhân viên đang có Current Work là Task 2.
  - Nhân viên bấm "Check Out" điểm danh -> Bản ghi trong bảng `current_work` được giải phóng, màn hình "Ai đang làm gì" chuyển sang hiển thị user đã out.

### 3.3. Kiểm thử Tính Toán Chỉ Số Báo Cáo
- **Kịch bản 1: Workload chỉ đếm Task lá:**
  - Tạo Task Cha có 3 Subtasks con.
  - Kiểm tra thống kê workload của thành viên -> Hệ thống chỉ đếm 3 task con, không đếm thành 4 task.
- **Kịch bản 2: Độ chính xác của Tỷ lệ Đúng Hạn:**
  - Task có deadline 10:00. Nhân viên hoàn thành lúc 09:50 -> Ghi nhận đúng hạn.
  - Sau đó Admin sửa deadline của task về 09:00 -> Tỷ lệ đúng hạn của kỳ trước vẫn không bị thay đổi vì đã lưu snapshot `completion_deadline`.

### 3.4. Kiểm thử Universal Search & Bảo Mật Dữ Liệu
- **Kịch bản 1: Tìm kiếm tiếng Việt không dấu & sai chính tả nhẹ:**
  - Tìm kiếm từ khóa "bao cao thang" -> Tìm thấy task "Báo cáo doanh số tháng 10".
  - Tìm kiếm "Wrydecco" -> Nhờ `pg_trgm` vẫn gợi ý đúng task "Video Wrydeco".
- **Kịch bản 2: Bảo mật phân quyền tìm kiếm (Data Leaks Prevention):**
  - Admin và Lead A chat trong một cuộc trò chuyện nhóm kín về "Kế hoạch nhân sự bí mật".
  - Member B (không tham gia nhóm kín đó) gõ tìm kiếm từ khóa "nhân sự" hoặc "kế hoạch".
  - Kết quả: Tuyệt đối không xuất hiện tin nhắn hoặc file của nhóm kín trong kết quả trả về của Member B.

### 3.5. Kiểm thử Duyệt Điều Chỉnh Điểm Danh
- **Kịch bản 1: Chống tự duyệt (No Self-Approval):**
  - Lead gửi đơn xin điều chỉnh giờ làm của chính mình.
  - Lead vào trang duyệt đơn -> Nút duyệt của đơn này bị vô hiệu hóa (disabled), API từ chối nếu cố tình gọi với mã lỗi 403 "Không thể tự duyệt đơn của chính mình".
- **Kịch bản 2: Chống trùng đè thời gian (Overlap Validation):**
  - Nhân viên đã có phiên làm việc từ 08:00 đến 12:00.
  - Nhân viên gửi đơn bổ sung phiên từ 11:30 đến 14:00 (bị chồng 30 phút).
  - Lead bấm duyệt -> Backend transaction rollback, trả thông báo lỗi: "Khoảng thời gian yêu cầu trùng lặp với phiên làm việc đã có từ 08:00 đến 12:00".

---

## 4. Tiêu Chí Nghiệm Thu (Acceptance Criteria / DoD)

- [ ] Phụ thuộc task (Dependency) hoạt động hoàn hảo, thuật toán chặn 100% các trường hợp lặp chu trình.
- [ ] Task chỉ được hoàn thành khi thỏa mãn toàn bộ checklist và subtasks (hoặc có sự can thiệp override hợp lệ từ quản lý).
- [ ] Luồng Review task minh bạch, thông báo tức thì cho người liên quan.
- [ ] Trạng thái "Tôi đang làm gì" cập nhật tức thì, tự động kết thúc khi check-out; màn hình "Ai đang làm gì" phản ánh đúng thực tế nhân sự.
- [ ] Dashboard báo cáo phân bổ workload chính xác theo nguyên tắc chỉ đếm task lá; tỷ lệ đúng hạn không bị sai lệch lịch sử.
- [ ] Universal Search tìm kiếm nhanh dưới 1 giây, hỗ trợ tiếng Việt không dấu và tuyệt đối tuân thủ phân quyền bảo mật phòng chat riêng.
- [ ] Quy trình xin sửa công và duyệt công hoạt động an toàn, chống tự duyệt và chống hoàn toàn việc chồng chéo giờ làm việc.
