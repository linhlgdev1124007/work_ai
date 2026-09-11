# Blueprint: Web app quản lý công việc nhóm với AI làm trung tâm

## 1. Mục tiêu và các quyết định đã chốt

**Sản phẩm:** ứng dụng nội bộ kết hợp chat, giao việc bằng ngôn ngữ tự nhiên, quản lý task, theo dõi công việc, báo cáo và điểm danh.

**Giá trị cốt lõi:** nhắn một câu để giao việc; hệ thống giữ lại người phụ trách, deadline, trạng thái và lịch sử để công việc không bị trôi trong hội thoại.

**Đối tượng:** một công ty tối đa 100 người, có nhiều team như Social, Web, Product, Tool và nhiều project.

**Phạm vi bàn giao:** đầy đủ các nhóm tính năng trong `prompt.txt`, triển khai theo từng mốc kiểm chứng. MVP là mốc kỹ thuật trung gian, không phải điểm kết thúc.

**Quyết định:**

- Chỉ làm desktop web và mobile web/PWA; không làm ứng dụng native.
- Chat độc lập; không tích hợp hoặc nhập lịch sử Zalo.
- Admin tạo tài khoản; đăng nhập email và mật khẩu; chưa làm SSO.
- Deploy bằng Docker Compose trên một máy chủ Linux.
- AI sản phẩm dùng Gemini qua Google Cloud Vertex AI.
- Antigravity/Gemini Flash 3.8 là công cụ triển khai, độc lập với model chạy trong sản phẩm.
- Admin được xem toàn bộ dữ liệu, **bao gồm chat riêng**. Chính sách này phải hiện rõ khi sử dụng.
- AI tự thực hiện lệnh rõ nghĩa nếu người gửi có quyền; trường hợp mơ hồ phải xác nhận.
- Điểm danh linh hoạt, nhiều lượt in/out mỗi ngày; có yêu cầu điều chỉnh và quy trình duyệt.
- Giao diện tiếng Việt; múi giờ mặc định `Asia/Ho_Chi_Minh`; tuần bắt đầu thứ Hai.

**Tình trạng tài liệu:** kế hoạch được lưu tại `D:\TOOL_LAMVIEC\plan.md` để bàn giao cho Antigravity. Tại thời điểm khảo sát, workspace chỉ có `prompt.txt`, chưa có source code hoặc Git repository.

## 2. Thiết kế sản phẩm và hành vi nghiệp vụ

### 2.1. Trải nghiệm và cấu trúc màn hình

Desktop dùng sidebar gọn:

| Mục | Nội dung |
|---|---|
| Hôm nay | Việc của tôi, đang làm, ưu tiên tiếp theo, nút in/out |
| Chat | Hội thoại team, project, nhóm riêng, chat trực tiếp, chat với AI |
| Công việc | Danh sách/Kanban, lọc theo team, project, người, trạng thái |
| Đội nhóm | Ai đang làm gì, số việc còn lại, deadline, task trễ |
| Báo cáo | Tổng quan công việc, workload, báo cáo cá nhân/team |
| Điểm danh | Lượt in/out, tổng giờ, yêu cầu điều chỉnh |
| Quản trị | Thành viên, team, project, cấu hình; hiển thị theo quyền |

Tìm kiếm và thông báo luôn truy cập được từ thanh trên.

- Chat là nơi giao việc chính; form tạo task là phương án bổ sung.
- Desktop mở chi tiết task bằng panel bên phải, giữ nguyên vị trí hội thoại.
- Mobile dùng thanh điều hướng `Hôm nay / Chat / Công việc / Thêm`; task detail mở toàn màn hình.
- Form tạo nhanh chỉ yêu cầu tiêu đề; người phụ trách và deadline không bắt buộc.
- Các trường nâng cao nằm trong phần mở rộng, không xuất hiện đồng loạt.
- Task card hiển thị tên, người phụ trách, trạng thái, deadline và dấu hiệu trễ.
- Có loading, empty state, lỗi và retry; không dùng dữ liệu demo thay cho chức năng thật ở bản nghiệm thu.

### 2.2. Role và permission

Quyền được kiểm tra ở backend cho REST, realtime, tìm kiếm, file, export và AI.

| Vai trò | Quyền |
|---|---|
| Admin | Quản lý toàn hệ thống; đọc mọi hội thoại, kể cả chat riêng; quản lý công và báo cáo |
| Team Lead/PIC | Quản lý team được phân công, giao/chuyển việc, duyệt task và điều chỉnh công trong phạm vi |
| Member | Xem task trong phạm vi tham gia; tạo việc cho mình; cập nhật việc được giao; điểm danh và gửi yêu cầu điều chỉnh |

Quy tắc bổ sung:

- Lead là quyền theo team, không phải quyền toàn công ty.
- Project thuộc một team; có danh sách thành viên tham gia.
- Lead quản lý các project thuộc team; member chỉ đọc chat/project đã tham gia.
- Member không tự chuyển task cho người khác hoặc sửa deadline do quản lý giao.
- Member được sửa nội dung, checklist, bình luận, trạng thái của task mình phụ trách; task yêu cầu review phải qua lead/admin để hoàn thành.
- Trong chat riêng, chỉ người tham gia và admin được đọc; lead không mặc nhiên có quyền đọc.
- Task trong chat riêng chỉ được chia sẻ cho người vốn có quyền đọc hội thoại đó. Không tự mở rộng quyền khi AI tạo task.
- Tài khoản bị vô hiệu hóa mất quyền truy cập ngay; task còn lại được đưa vào danh sách cần phân công lại.
- Người gửi yêu cầu sửa công không được duyệt yêu cầu của chính mình.
- Ghi audit khi admin truy cập hội thoại riêng mà mình không tham gia.

### 2.3. Chat và các flow chính

Hỗ trợ:

- Tin nhắn văn bản, ảnh, file, link, mention và reply.
- Hội thoại team/project, nhóm riêng và trực tiếp.
- Phân trang lịch sử, unread count, read marker, sửa/xóa mềm tin nhắn.
- AI note liên kết đến task và thao tác xác nhận/hủy/hoàn tác.
- Nút “Tạo task từ tin nhắn” dùng khi AI bỏ sót.
- Khi thao tác chưa gửi thành công, giữ nội dung để người dùng retry.

**Giao việc:**

1. Lead gửi: “Sang làm banner Jeminise, trước 17h ngày mai.”
2. Tin nhắn được lưu và hiển thị ngay.
3. AI phân tích bất đồng bộ.
4. Backend kiểm tra người gửi, Sang, hội thoại và deadline.
5. Tạo task, lưu nguồn, ghi lịch sử và gửi thông báo.
6. Hiện AI note với deadline tuyệt đối và liên kết đến task.

**Thay đổi công việc:**

- Reply vào task hoặc tin nhắn nguồn để đổi người, deadline, trạng thái.
- Nếu “việc này” trỏ đến nhiều task hợp lý, AI hiển thị lựa chọn.
- Lệnh thay đổi nhiều task luôn cần xem trước và xác nhận.
- Sửa hoặc xóa tin nhắn nguồn không tự đảo ngược task đã tạo; chỉnh sửa được phân tích thành đề xuất thay đổi mới.

**Cập nhật đang làm:**

- Người dùng bấm “Bắt đầu” hoặc nhắn “Tôi đang làm video Wrydeco”.
- Nếu nhận diện được task duy nhất và có quyền, cập nhật current work và trạng thái.
- Nếu không có task phù hợp, cho phép lưu dòng trạng thái tự do; không tự tạo task chỉ vì thông báo đang làm.
- Mỗi người có một current work tại một thời điểm, nhưng có thể có nhiều task `In Progress`.
- Chuyển current work không tự đánh dấu task trước là hoàn thành.
- Khi out, current work được kết thúc; trạng thái task không tự thay đổi.

### 2.4. Task management

Task gồm:

- Tiêu đề, mô tả, người phụ trách, người giao, team, project.
- Priority: Low, Normal, High, Urgent.
- Status, ngày bắt đầu, deadline, estimate theo phút.
- Checklist, subtask một cấp, dependency.
- File, ảnh, link, bình luận, tin nhắn nguồn.
- Người tạo, nguồn tạo AI/manual, ngày hoàn thành, lịch sử thay đổi.
- Cờ yêu cầu review và người review mặc định là người giao nếu có quyền; nếu không thì lead của team.

**Status:** `To Do`, `In Progress`, `Waiting`, `Review`, `Completed`, `Paused`.

**Overdue là thuộc tính tính toán**, không phải status:

- Task chưa hoàn thành và đã qua deadline được đánh dấu trễ, kể cả Waiting/Paused.
- Task hoàn thành sau deadline ghi nhận hoàn thành trễ.
- Không có deadline thì không tính trễ.
- Hoàn thành task có subtask chưa xong hoặc dependency chưa hoàn thành bị chặn; lead/admin có thể override với lý do.
- Dependency không được tạo vòng lặp.
- Mỗi task có một người chịu trách nhiệm chính. “Sang làm ảnh, Lợi làm video” tạo task cha và hai subtask nếu đó là lệnh giao việc rõ ràng.
- Archive dùng để loại task khỏi danh sách hoạt động; không hard-delete lịch sử.
- Mở lại task đã hoàn thành phải lưu sự kiện và lý do; chỉ lead/admin thực hiện.

### 2.5. Dashboard và báo cáo

**Member — Hôm nay:**

- Đang làm.
- Việc trễ.
- Việc đến hạn hôm nay.
- Việc sắp tới.
- Việc không deadline.
- Việc đã hoàn thành.

Gợi ý tiếp theo sắp theo: trễ → đến hạn hôm nay → priority → deadline gần nhất. Không tự thay đổi priority.

**Lead/Admin:**

- Tổng task, chưa làm, đang làm, Waiting, Review, hoàn thành.
- Trễ, đến hạn trong 24 giờ, chưa có người phụ trách.
- Bộ lọc hôm nay/tuần/tháng/khoảng ngày, team, project, thành viên.
- Màn hình “Ai đang làm gì” hiển thị current work, cập nhật gần nhất, số việc còn lại, estimate còn lại nếu có, deadline gần nhất và số việc trễ.
- Không kết luận “đang rảnh” chỉ vì thiếu cập nhật; hiển thị “Chưa cập nhật”.
- Thống kê workload để hỗ trợ phân công, không tạo bảng xếp hạng năng suất.

**Định nghĩa chỉ số:**

- Việc còn lại: task chưa Completed và chưa archive.
- Khi cộng workload, chỉ tính task lá; không đếm cả task cha và subtask.
- Tỷ lệ đúng hạn: task hoàn thành đúng hạn / task hoàn thành có deadline.
- Lưu deadline tại thời điểm hoàn thành để thay đổi sau này không làm sai số liệu.
- Thời gian hoàn thành: từ lúc tạo đến hoàn thành; hiển thị rõ đây không phải giờ lao động.
- Báo cáo theo kỳ gồm task tạo/giao/hoàn thành trong kỳ; số việc còn lại và trễ phản ánh tại thời điểm cuối kỳ bằng lịch sử sự kiện.
- Xuất CSV cho báo cáo task và điểm danh.
- Báo cáo ngày/tuần do AI tóm tắt phải dựa trên số liệu truy vấn và kèm liên kết task.

### 2.6. Điểm danh

- Dùng giờ server; lưu UTC; chia ngày báo cáo theo múi giờ công ty.
- Mỗi người chỉ có một phiên in đang mở.
- Bấm in/out lặp, nhiều tab hoặc nhiều thiết bị không tạo phiên trùng.
- Out khi không có phiên mở trả thông báo rõ ràng.
- Một ngày có thể có nhiều phiên; tổng giờ bằng tổng thời lượng phiên hợp lệ.
- Phiên qua đêm được chia thời lượng theo ngày để báo cáo.
- Phiên chưa out hiển thị “Đang mở”; giờ tạm tính tách khỏi giờ đã xác nhận.
- Sau 16 giờ chưa out thì nhắc một lần, đánh dấu cần kiểm tra; không tự ghi giờ out.
- Nhân viên gửi yêu cầu thêm/sửa lượt công với thời gian và lý do.
- Lead duyệt thành viên thuộc team; admin duyệt toàn bộ. Khi duyệt kiểm tra lại xung đột và không cho phiên chồng nhau.
- Lưu dữ liệu trước/sau, người yêu cầu, người duyệt và lý do.
- Thống kê lượt công, giờ theo ngày/tuần/tháng, phiên thiếu out, trạng thái điều chỉnh.
- Không làm tính lương, GPS, chụp ảnh, ca làm hoặc đi trễ/về sớm.

### 2.7. Reminder, search và file

**Reminder:**

- Nhắc task còn 2 giờ đến hạn, mới trễ, Waiting quá 2 ngày, chưa có assignee quá 4 giờ làm việc, không cập nhật quá 2 ngày.
- Cảnh báo dependency chưa hoàn thành khi task phụ thuộc gần đến hạn.
- Tổng hợp workload khi một người có trên 8 task lá chưa hoàn thành; đây là ngưỡng cấu hình, không phải đánh giá năng suất.
- Mặc định gửi trong app; Web Push tùy chọn khi người dùng cho phép và trình duyệt hỗ trợ.
- Không gửi lặp cho cùng task, loại nhắc và phiên bản deadline.
- Giờ yên lặng mặc định 20:00–08:00; nhắc công việc được gộp và gửi sau đó.
- Mention/giao việc vẫn được lưu tức thì vào inbox; push tuân thủ giờ yên lặng.

**Search:**

- Tìm task, tin nhắn, tên file/ảnh, link, project, người.
- Hỗ trợ tiếng Việt có/không dấu, lỗi gõ nhẹ và bộ lọc.
- AI chuyển câu hỏi tự nhiên thành bộ lọc có cấu trúc kết hợp từ khóa; trả kết quả có nguồn.
- Áp quyền trước khi trả dữ liệu, kể cả snippet, số lượng kết quả và nội dung AI nhận.
- Phạm vi này tìm file/ảnh theo metadata, caption và hội thoại liên quan; OCR và tìm kiếm nội dung hình ảnh thuộc phần mở rộng.

**File:**

- Lưu file private, kiểm tra quyền trước mọi lượt tải.
- Giới hạn mặc định 25 MB/file; kiểm tra loại file và tên file.
- Preview ảnh, download file, liên kết attachment với message/task.
- Không thực thi hoặc render trực tiếp HTML/SVG người dùng tải lên.
- AI không tự đọc toàn bộ file hoặc truy cập URL được gửi; chỉ dùng metadata và nội dung người dùng cung cấp trực tiếp.
- Có quota dung lượng, dọn upload chưa được gắn sau 24 giờ và quy trình backup.

## 3. Kiến trúc kỹ thuật và AI

### 3.1. Technology stack

Chọn monorepo TypeScript với pnpm:

| Thành phần | Lựa chọn |
|---|---|
| Frontend | Next.js, React, Tailwind CSS, shadcn/ui |
| Server state/form | TanStack Query, React Hook Form, Zod |
| Backend | NestJS modular monolith, REST/OpenAPI |
| Realtime | Socket.IO |
| Database | PostgreSQL, Prisma; migration SQL cho index/constraint đặc thù |
| Search | PostgreSQL full-text, `unaccent`, `pg_trgm` |
| Background jobs | Redis, BullMQ |
| AI | Google Gen AI SDK `@google/genai`, Vertex AI |
| File | Private filesystem volume qua storage adapter |
| Reverse proxy | Caddy, HTTPS và WebSocket proxy |
| Test | Vitest, backend integration, Playwright |
| Deploy | Docker Compose |

Dùng các phiên bản stable tương thích tại lúc bắt đầu; khóa phiên bản trong lockfile và image tag. Không dùng dependency/image `latest`.

Next.js đóng gói standalone, đặt sau reverse proxy theo [hướng dẫn self-hosting](https://nextjs.org/docs/app/guides/self-hosting) và [Docker](https://docs.docker.com/guides/nextjs/).

**Docker services:** `proxy`, `web`, `api`, `worker`, `postgres`, `redis`, cùng job migration chạy một lần.

- Chỉ proxy public; database/Redis nằm trong mạng nội bộ.
- PostgreSQL là nguồn dữ liệu chuẩn; Redis không giữ dữ liệu duy nhất.
- Private file volume dùng chung giữa API/worker khi cần.
- Production chạy image đã build; không dùng dev server.
- Healthcheck, restart policy, graceful shutdown, log rotation.
- Backup PostgreSQL và file hằng ngày sang vị trí ngoài máy chủ; giữ 14 bản gần nhất và có lệnh restore.
- Migration chạy trước phiên bản ứng dụng mới; không tự reset database.
- Không dùng Kubernetes, microservices hoặc Elasticsearch ở quy mô này.

### 3.2. Database schema tối thiểu

Mọi entity nghiệp vụ có ID, thời điểm tạo/cập nhật; bảng cần cạnh tranh cập nhật có `version`.

| Nhóm | Bảng chính và ý nghĩa |
|---|---|
| Tổ chức | `organizations`, `users`, `teams`, `team_members`, `projects`, `project_members` |
| Xác thực | `sessions`, `password_reset_tokens` |
| Chat | `conversations`, `conversation_members`, `messages`, `message_revisions`, `message_mentions`, `read_markers` |
| Task | `tasks`, `task_checklist_items`, `task_dependencies`, `task_message_links`, `task_comments`, `task_events` |
| Đang làm | `current_work`, `work_status_events` |
| File | `attachments`, `message_attachments`, `task_attachments`, `links` |
| AI | `ai_runs`, `ai_actions`, `ai_action_items`, `ai_confirmations` |
| Điểm danh | `attendance_sessions`, `attendance_adjustments`, `attendance_events` |
| Thông báo | `notifications`, `notification_preferences`, `push_subscriptions`, `reminder_deliveries` |
| Hạ tầng | `outbox_events`, `audit_events`, `organization_settings` |

Quan hệ quan trọng:

- Task có `parent_id` nullable, `assignee_id` nullable, `source_message_id`, `source_conversation_id`, `completed_at`, `completion_deadline`, `version`.
- Task dùng cùng visibility scope với nguồn khi tạo từ chat; task thủ công chọn team/project hoặc cá nhân.
- Attachment lưu storage key; không lưu đường dẫn public.
- AI action lưu người khởi tạo, message revision, thao tác dự kiến, lý do, target version và kết quả.
- Task event/audit lưu actor thật, AI run liên quan, giá trị trước/sau và thời gian.
- Attendance dùng partial unique index để mỗi người chỉ có một phiên mở; kiểm tra overlap trong transaction.
- Unique constraint trên action idempotency key và client message ID.
- Index theo conversation/thời gian, assignee/status/deadline, team/project, user/thời gian điểm danh.
- Có trường tổ chức để nhất quán dữ liệu; chưa xây SaaS nhiều tenant.

### 3.3. Backend, API và realtime

Các module: Auth, Organization, Chat, Tasks, CurrentWork, Attendance, AI, Search, Notifications, Reports, Files, Audit.

API version `/api/v1`, nhóm route:

- `/auth`, `/users`, `/teams`, `/projects`
- `/conversations`, `/messages`
- `/tasks`, `/tasks/:id/events`, `/current-work`
- `/ai/query`, `/ai/actions/:id/confirm`, `/ai/actions/:id/cancel`, `/ai/actions/:id/undo`
- `/attendance/in`, `/attendance/out`, `/attendance/adjustments`
- `/search`, `/reports`, `/notifications`, `/files`

Hợp đồng:

- DTO runtime validation; OpenAPI sinh API client cho frontend.
- Cursor pagination cho tin nhắn/lịch sử.
- Gửi tin nhắn nhận client-generated idempotency key.
- Cập nhật task và xác nhận AI kèm expected version; dữ liệu đã thay đổi trả conflict để xem lại.
- Xác thực bằng session lưu phía server, cookie HttpOnly/Secure/SameSite; chống CSRF cho mutation.
- Mật khẩu Argon2id, rate-limit đăng nhập, buộc đổi mật khẩu tạm; admin cấp reset token dùng một lần, không phụ thuộc email server.
- Không có tài khoản production mặc định hoặc mật khẩu nằm trong source.

Realtime phát các sự kiện `message.created`, `message.updated`, `task.updated`, `ai.action.updated`, `current_work.updated`, `notification.created`, `attendance.updated`.

- Kiểm tra quyền khi join room và khi quyền thay đổi.
- Lưu DB trước khi báo thành công; transaction ghi outbox cùng mutation.
- Client reconnect truy vấn sự kiện/tin nhắn bị lỡ; không phụ thuộc socket để giữ lịch sử.
- Hàng đợi có thể giao job nhiều lần; DB phải chống thực hiện trùng theo nguyên tắc [idempotent jobs của BullMQ](https://docs.bullmq.io/patterns/idempotent-jobs).

### 3.4. Vertex AI và Context Engine

Tích hợp qua Google Gen AI SDK theo [Vertex AI quickstart](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart).

Cấu hình server:

- Google Cloud project, location, model ID.
- Giới hạn token/request, concurrency, timeout và ngân sách sử dụng.
- Authentication bằng Application Default Credentials; production mount credentials dạng secret hoặc dùng workload identity khi hạ tầng hỗ trợ.
- Không đưa credentials ra frontend, Git hoặc Docker image.
- Model ID là cấu hình triển khai bắt buộc, phải kiểm tra có quyền truy cập tại region đã chọn; không mặc định coi tên model dùng viết code là model Vertex tồn tại.

**Luồng xử lý:**

1. Lưu message và outbox event.
2. Worker nhận job, kiểm tra sender còn quyền.
3. Lấy nội dung message, reply chain, tối đa 30 tin gần nhất và task liên quan trong phạm vi được đọc.
4. Với câu hỏi, tìm candidate qua dữ liệu có quyền rồi mới đưa vào context.
5. Gemini trả intent và dữ liệu có cấu trúc.
6. Backend validate schema, entity, quyền, thời gian và version.
7. Policy quyết định auto-apply, confirm, ask hoặc ignore.
8. Ghi mutation, audit, notification và AI note.
9. Realtime cập nhật UI.

Intent tối thiểu:

`CREATE_TASK`, `UPDATE_ASSIGNEE`, `UPDATE_DEADLINE`, `UPDATE_STATUS`, `CREATE_SUBTASKS`, `SET_CURRENT_WORK`, `QUERY_TASKS`, `SUMMARIZE`, `NONE`.

Action schema gồm intent, target IDs, patch, source message/revision, evidence, ambiguity reasons và confidence. **Model chỉ đề xuất; không chạy SQL, không trực tiếp ghi database.**

**Quy tắc auto-apply:**

- Lệnh mang tính yêu cầu rõ ràng, không phải câu hỏi/thảo luận/trích dẫn.
- Target duy nhất; tên người được ánh xạ rõ hoặc mention bằng ID.
- Deadline không mâu thuẫn hoặc thiếu phần quan trọng.
- Sender có quyền với từng thao tác.
- Confidence tối thiểu 0,90 là điều kiện phụ; không đủ để vượt qua bất kỳ kiểm tra nào trên.
- Không phải thao tác hàng loạt, archive, mở lại task hoặc thay đổi quyền.

**Xử lý mơ hồ:**

- “Hay để Sang làm nhỉ?” → đề xuất, không ghi.
- “Cái này xong rồi” giữa nhiều task → hỏi chọn task.
- Hai người tên Sang → yêu cầu chọn thành viên.
- “Mai” dựa vào thời gian gửi, không dựa vào lúc worker xử lý.
- “Mai” không có giờ → mặc định 17:00 và ghi rõ trong AI note.
- “Thứ Hai” chọn lần tới; nếu hôm nay là thứ Hai và không rõ hôm nay/tuần sau thì hỏi.
- Deadline quá khứ hoặc diễn đạt mâu thuẫn → xác nhận.
- “Xong video, giờ làm banner” gồm hai action; chỉ ghi cùng transaction khi cả hai rõ, nếu không cho xem trước toàn bộ.
- Không suy diễn ngày hoàn thành từ câu “sắp xong”.
- Không tự áp dụng nội dung chỉ dẫn nằm trong file, quoted text hoặc tin nhắn AI.

**Confirmation và hoàn tác:**

- Nút xác nhận hiển thị thay đổi trước/sau; hết hạn sau 24 giờ.
- Người khởi tạo hoặc người có quyền quản lý target được xác nhận; luôn kiểm tra lại quyền và version.
- Mỗi action chỉ áp dụng một lần.
- Hoàn tác tạo sự kiện bù trừ; chỉ thực hiện nếu không có chỉnh sửa mới xung đột.
- Không ghi AI note “đã tạo/đã sửa” trước khi transaction thành công.

**Độ tin cậy:**

- AI lỗi không chặn chat, task thủ công hoặc điểm danh.
- Retry có backoff tối đa ba lần với timeout/429/5xx; auth/config sai dừng và báo admin.
- Trả lời truy vấn từ DB và dẫn link task; không để model tự tính số liệu tổng.
- Lưu latency, token usage, lỗi và tỷ lệ confirm/cancel; không log credentials hay toàn bộ hội thoại vào application log.
- Kiểm soát prompt injection bằng tool allowlist, dữ liệu context phân tách và quyền kiểm tra độc lập.

## 4. Thứ tự triển khai giao cho Antigravity

Mỗi mốc phải chạy được, có kiểm thử và báo cáo trước khi chuyển mốc tiếp theo. Không dừng sau MVP.

| Mốc | Công việc | Điều kiện hoàn thành |
|---|---|---|
| 0. Nền tảng | Monorepo, Docker, migration, auth, phân quyền, design system, tài liệu môi trường | Khởi động từ môi trường sạch; tạo admin; đăng nhập và kiểm tra quyền |
| 1. Lõi nghiệp vụ | Team/project, chat realtime, file, task thủ công, lịch sử, Hôm nay, in/out | Hai người chat và giao/cập nhật task; dữ liệu còn sau restart; công không trùng |
| 2. AI end-to-end | Vertex, context, intents, confirmation, undo, truy vấn task | Toàn bộ ví dụ chính trong prompt chạy qua AI thật và có audit |
| 3. Quản lý đầy đủ | Subtask, checklist, dependency, review, current work, dashboard, search, điều chỉnh công | Lead/admin/member dùng đúng phạm vi; báo cáo khớp dữ liệu |
| 4. Hoàn thiện | Reminder, Web Push, báo cáo AI, CSV, mobile/PWA, backup/restore, tối ưu và kiểm thử tải | Đạt toàn bộ tiêu chí nghiệm thu; có runbook deploy và phục hồi |

**MVP kỹ thuật là hết mốc 2.** Không ưu tiên làm biểu đồ đẹp, OCR, semantic vector search hoặc tùy chỉnh workflow trong mốc này.

**Sau bản đầy đủ đã yêu cầu:**

- Phase 2 mở rộng: OCR, tìm kiếm ngữ nghĩa, task lặp, lịch tích hợp, SSO, webhook.
- Phase 3 mở rộng: SaaS nhiều công ty, workflow tùy chỉnh, tự động hóa liên hệ thống và hạ tầng nhiều máy chủ.
- Không đưa các mở rộng này vào phạm vi bàn giao hiện tại.

**Yêu cầu bàn giao của Antigravity:**

- Source hoàn chỉnh, Dockerfile/Compose, lockfile, migration và `.env.example`.
- Seed demo riêng, không tự chạy trên production.
- Hướng dẫn cấu hình Vertex, khởi tạo admin, deploy, backup, restore và nâng cấp.
- Test suite, kết quả lệnh đã chạy, danh sách file thay đổi và hạn chế còn lại.
- Bảng đối chiếu yêu cầu `prompt.txt` với chức năng và test tương ứng.
- Thiếu Google Cloud credentials thì hoàn thành mock integration và báo rõ live AI chưa được nghiệm thu; không tuyên bố đã chạy AI thật.
- Không thay thế chức năng thật bằng mock mà không ghi rõ.
- Sau bàn giao, Codex review độc lập code, permission, AI mutation, attendance và kết quả kiểm thử.

## 5. Kiểm thử, nghiệm thu và rủi ro

### Kiểm thử bắt buộc

**AI và task:**

- Bộ ít nhất 60 tình huống tiếng Việt: lệnh rõ, mơ hồ, phủ định, trích dẫn, sai tên, nhiều task, ngày tương đối, thay đổi đồng thời và vượt quyền.
- Bao phủ tất cả ví dụ giao việc/chuyển người/đổi deadline/hoàn thành/tạm dừng/chia subtask trong prompt.
- Không tự mutation trong các tình huống mơ hồ hoặc không có quyền của bộ đánh giá.
- Gửi lại job, confirm hai lần và timeout sau commit không tạo task trùng.
- Deadline và metric hoàn thành đúng sau thay đổi deadline, reopen và archive.
- Có cả test AI output giả lập để kiểm tra backend và live smoke test Vertex để kiểm tra tích hợp.

**Quyền và riêng tư:**

- Member không đọc được chat/file/search/report ngoài phạm vi.
- Lead không đọc chat riêng không tham gia.
- Admin đọc được chat riêng và hành động được audit.
- Thu hồi quyền có hiệu lực cả với REST, socket, tải file và AI job đang chờ.
- Nội dung độc hại trong message không khiến AI vượt quyền hoặc đọc dữ liệu ngoài context cho phép.

**Realtime và file:**

- Hai trình duyệt chat, reply, mention, nhận cập nhật task.
- Mất mạng rồi reconnect không mất hoặc nhân đôi tin nhắn.
- Upload quá giới hạn, file sai loại, file không có quyền và file không tồn tại.
- Tải lại trang và restart container không mất dữ liệu.

**Điểm danh:**

- In hai lần đồng thời; out hai lần; out khi chưa in.
- Nhiều lượt/ngày, qua nửa đêm, quên out.
- Sửa công bị chồng thời gian hoặc duyệt đồng thời bị từ chối đúng.
- Không tự duyệt; người ngoài phạm vi không duyệt được.
- CSV và dashboard cộng giờ khớp cùng một tập dữ liệu.

**Deploy và UX:**

- Docker build, migration trên DB mới và nâng cấp DB có dữ liệu.
- Backup rồi restore đủ message, task, file và attendance.
- E2E trên desktop và viewport mobile 360–430 px; không có tràn ngang.
- Loading, lỗi, empty state và retry hoạt động ở các màn hình chính.
- Với bộ dữ liệu 100 thành viên, 10.000 task và 100.000 message: kiểm tra 50 phiên hoạt động đồng thời; mục tiêu p95 dưới 1 giây cho API thường và dưới 2 giây cho search trên máy kiểm thử được ghi cấu hình.
- Chat hiển thị ngay, không chờ Gemini; AI có trạng thái đang xử lý và thông báo lỗi nếu vượt timeout.

### Rủi ro và biện pháp

| Rủi ro | Biện pháp bắt buộc |
|---|---|
| AI hiểu sai gây mất niềm tin | Policy chặt, confirmation, nguồn chứng cứ, audit và undo |
| Scope quá lớn với một lượt sinh code | Chia mốc, mỗi mốc chạy/test/self-review trước khi tiếp tục |
| Đếm task thành đánh giá con người | Không xếp hạng năng suất; hiển thị giới hạn của số task/estimate |
| Lộ dữ liệu qua AI/search/file | Dùng chung permission service và kiểm thử phủ định |
| Chạy lại job gây ghi trùng | DB idempotency, transaction, outbox và version check |
| Mất dữ liệu trên một máy chủ | Backup ngoài máy chủ và diễn tập restore |
| Chi phí/độ trễ Vertex tăng | Context giới hạn, queue, concurrency limit và usage dashboard |
| UI dần trở nên quá phức tạp | Giữ ba hành động chính: nhắn giao việc, xem việc hôm nay, cập nhật đang làm/xong |

**Hoàn thành khi:** toàn bộ mốc 0–4 đạt nghiệm thu, ứng dụng chạy bằng Docker với dữ liệu thật, Vertex được kiểm tra trực tiếp, quyền được kiểm thử và backup có thể phục hồi. Thông tin triển khai còn cần cung cấp là domain, máy chủ và Google Cloud project/location/model/credentials; chúng là cấu hình môi trường, không làm thay đổi thiết kế.
