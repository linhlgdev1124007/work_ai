# Chat workspace

## Usage

- Login and the root URL open `/chat`. Messages lead the navigation.
- Use `@b6` in a message or choose b6 from the mention menu. Replies are stored with their source message and support Markdown, tables and code. Raw HTML, unsafe URL schemes and remote images are not rendered.
- `@b6 thong ke cong viec nhom` (Vietnamese accents also supported) returns live room status counts without a model call. Other questions and natural-language work instructions require working Vertex credentials. B6 never uses the sender's private, cross-room assistant context to answer publicly.
- Chat headers have a group icon opening lead management and group tasks. Only organization admins appoint/remove the single chat lead. Leads can assign room tasks to active room members; they do not become organization admins.
- Tasks can be grouped by status or assignee in the group drawer. Reports include per-chat-group totals. Old tasks without a source conversation remain ungrouped; no inferred reassignment was performed.
- Read receipts record the last visible message when the document is visible and focused. Server watermarks are monotonic and retain unread messages newer than the submitted marker. Receipt events are scoped to the room.
- AI instructions are proposals, never automatic writes. Confirmation, cancellation and undo states appear below the source message and sync through Socket.IO. Existing task updates use optimistic versions.
- Potential duplicates show update-existing, create-separate and skip choices. Existing-task updates cannot be undone by archiving that existing task. Concurrent same-title proposals require another confirmation after refreshing duplicate candidates.

## Boundaries

- Model context contains up to 80 recently updated room tasks and 30 messages up to the source time, each excerpt capped at 600 characters. Status totals are full database aggregates, not estimated from that sample. Semantic duplicates outside the sample can be missed; confirmation rechecks exact normalized titles across all non-archived room tasks.
- Semantic classification tests inject model output into real HTTP/database flows; they do not establish Gemini language accuracy. A live API query still returned 503 on 2026-09-11 because Google ADC is unavailable. Configure/mount credentials before accepting AI in production.
- The existing daily context cache for the separate assistant is unchanged. B6 uses bounded room context, not a provider-side cached prompt.
- Read receipts indicate visibility, not proof a person understood a message. Push delivery is OS/provider-dependent and cannot be guaranteed by a website.

## Mac and HTTPS

Safari Web Push is supported on macOS Ventura 13+ with Safari 16.1+. It does not require iOS-style Home Screen installation. Permit the site in Safari Settings > Websites > Notifications and in macOS System Settings > Notifications; check Focus. Apple supports delivery when Safari is not running, but offline state, denied OS permission and Focus can affect delivery. See [WebKit Safari 16.1](https://webkit.org/blog/13399/webkit-features-in-safari-16-1/) and [Meet Web Push](https://webkit.org/blog/12945/meet-web-push/).

Local access remains `http://localhost:8080`. An HTTP LAN IP is not sufficient for Web Push on another computer. An optional HTTPS profile is included but is not activated without a real domain:

1. Set `PUBLIC_DOMAIN` in `.env` to the DNS hostname, without protocol or path. Point its A/AAAA records to this server and expose TCP 80/443. Set real passwords and VAPID contact details before exposing the service publicly.
2. Run `docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --no-build`.
3. Open `https://YOUR_DOMAIN`, log in and grant notification permission separately on each browser/device. A new origin requires a new subscription. Keep the persistent Caddy and application storage volumes.
4. On a real Mac, close all site tabs (also test Safari quit), send a message/tag and create assigned, due-soon and overdue tasks from another account. Verify notifications and authenticated deep links. Repeat with Focus disabled and after logout to check session revocation.

The profile enables Caddy certificate automation and secure cookies; actual TLS issuance requires working DNS/networking and has not been exercised here. See [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https).

## Data safety

Migration `20260911000300_chat_workspace` adds assistant replies, the task-to-conversation relation and query indexes. A pre-migration production backup is at `backups/work-ai-before-chat-workspace.dump`. Existing accounts/messages/tasks were not reseeded. Automated API fixtures use the isolated `work_ai_test` database.
