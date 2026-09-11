# Hardening and Acceptance Report

Date: 2026-09-11. Environment: Windows host, Docker Linux containers, PostgreSQL 16.

## Executed Checks

| Check | Result |
| --- | --- |
| Real HTTP / PostgreSQL / Socket.IO integration | 274 checks passed |
| Service, rule-parser, context, notification and classification tests | 110 passed, 1 live-AI test excluded |
| Playwright desktop and mobile | 47 passed; mobile-only scenario excluded on desktop |
| Service worker simulated push without open tabs / safe click targets | 13 checks passed |
| Real Windows Chrome provider-to-Service-Worker push with site tab closed | Passed; browser running, native OS banner not visually verified |
| Production web build | Passed, Next.js 15.5.24 / React 19 |
| API TypeScript build | Passed |
| Production dependency audit | 0 known advisories reported by pnpm |
| Migrations on an empty database, then repeated | Passed, no pending migrations on repeat |
| Adopt existing db-push database without data reset | Passed after schema comparison |
| Separate Gemini live test | Passed after mounting existing host ADC read-only; authenticated query also returned mode=ai and SAN_SANG |
| Real Vertex classification regression | 7/7 passed after the final prompt fix; read-only live inference plus one targeted repair of the reported message |

## API Coverage

- Classification incident: the reported SEO assignment had a FAILED AiRun containing truncated JSON after `confidence: 0`, despite the model already selecting CREATE_TASK. The Vertex adapter now disables thinking for supported Flash 2.5 names, reserves 2048 output tokens for JSON, retries MAX_TOKENS once at 4096, requires a complete STOP response, and concatenates only non-thought text parts. Six adapter regression tests cover those boundaries. Provider configuration reference: https://cloud.google.com/vertex-ai/generative-ai/docs/thinking.
- Relative dates now use the source message timestamp, not the retry time. The prompt distinguishes future completion requests from completed-work reports, the assignee from the beneficiary, and clear work clauses from accompanying jokes. A date without an hour is proposed as 23:59:59 in Asia/Ho_Chi_Minh, still requiring confirmation. No date means no invented deadline. Invalid classification errors are retained in AiRun for diagnosis.
- The exact reported message was reprocessed with real Vertex and now has one PENDING_CONFIRMATION CREATE_TASK proposal: SEO cho Tuan, assigned to Sang, deadline 2026-09-12T23:59:59+07:00. No task was created or confirmed. The other earlier failed message was not replayed to avoid a second proposal for the same request. Automated integration separately verifies the exact phrase, assignee binding, source-date anchoring and no automatic mutation with controlled model output.
- `scripts/live-classification.cjs` passed all seven live cases on the final deployed image: original assignment, informal variant, assignment mixed with humor, social invitation, negation, completion and progress-query classification. The initial mixed-humor case selected CREATE_TASK but scored 0.8; the final prompt evaluates clarity of the work clause independently from conversational tone, retaining the 0.85 action threshold. The final positive assignment scores were 0.9. Completion/query cases supply a synthetic reference task only in the model input; they do not update production tasks or establish answer quality for all progress questions. Model scores are not calibrated probabilities and this small set is not an exhaustive accuracy guarantee.
- Chat workspace additions: admin-only lead management, member-only assignment scope, removal of lead privileges, cross-room/tenant denial, per-room counts, monotonic read receipts with eight concurrent sends, Socket.IO receipt updates, persisted Markdown replies, semantic duplicate candidate filtering, update-existing vs create-separate decisions, stale versions, concurrent duplicate confirmations and confirmed natural-language completion. Gemini output is controlled in these tests; HTTP, PostgreSQL and mutation services are real.
- Chat is now the login/root landing screen. UI tests cover B6 mentions, safe Markdown/table/code rendering, visible receipts, duplicate decision controls, group task drawers and Mac/Windows-specific permission guidance. All 47 final desktop/mobile scenarios passed in one run. Mac user-agent simulation is not physical Safari push testing.
- The production database has all five migrations applied. Before the latest push migration, `backups/work-ai-before-push-reliability.dump` was created; production data was not reseeded.
- Optional HTTPS Compose/Caddy profiles passed configuration validation with an example hostname, without requesting a public certificate. A real domain and DNS/network access remain prerequisites.

- Notification/tag additions: cross-tenant and room membership isolation, deduplicated message notifications, explicit mention validation, read ownership, subscription SSRF rejection and ownership, reminders keyed by actual deadlines, and stale-reminder filtering.
- Automatic classifier integration uses controlled model responses for social/assignment/provider-failure cases. Social messages create no AI action; assignments require confirmation; provider failure creates no task. This is not a measurement of live model language accuracy.
- Push delivery retry, lease ownership, expired endpoints and revoked/suspended accounts have mocked sender tests. Additional cases cover missing endpoints remaining pending, retry beyond eight attempts, Apple/Windows provider endpoints and skipping a previously accepted device when another fails. Browser tests simulate permission states, online registration recovery and the queued-only test-button confirmation. Service Worker tests cover malformed payloads and closed-window click fallback.
- A real Chrome incognito registration was denied. A subsequent isolated persistent Chrome profile passed real provider delivery on Windows: after closing the website tab, the running Service Worker reported the exact test notification via getNotifications(). No API/provider mocks were used. Native OS toast visibility, a fully quit browser and physical Mac Safari delivery remain unverified. `node scripts/live-push-browser.cjs` reproduces this smoke test and cleans up its session/profile. The two successful smoke notices remain in the admin inbox; no permanent member device registrations were present during verification.
- Pending push retries now last up to seven days, with per-device provider acceptance checkpoints and a 24-hour provider TTL. Acceptance does not prove OS display. Permission, HTTPS outside localhost, a valid session and OS/browser settings remain prerequisites; there is no unconditional delivery guarantee.
- VAPID keys persisted in the production storage volume. The new database migration was applied without resetting data after a backup to `backups/work-ai-before-push-20260911.dump`.
- The earlier live Gemini call returned 503 because Application Default Credentials were unavailable in the API container. A subsequent configuration fix mounted the existing host ADC read-only through the automatic local Compose override. The live Gemini smoke test and authenticated production query then both returned SAN_SANG (query mode=ai). No model/project change or credentials copied into the repository was needed. This is a connectivity check, not a comprehensive live-language evaluation.
- Emoji preview truncation is tested at the boundary of a supplementary Unicode character. An earlier browser run overlapped deployment and a login page failed to hydrate; final validation was run after deployment completed. Test locators were also scoped to avoid Next.js's route announcer being mistaken for an application error.

- Authentication: cookie flags, missing/invalid credentials, invalid sessions,
  logout, temporary-password restrictions, password changes, suspension and
  failed-login rate limiting.
- Authorization: member/admin boundaries and cross-organization attempts for
  tasks, assignments, parent tasks, teams, projects, conversations, attendance
  adjustments and AI actions.
- Tasks: input validation, create/read/update, review restrictions, checklist
  booleans, completion/reopening, recorded completion deadline, estimate edits,
  dependencies, cycle rejection and simultaneous optimistic updates.
- Attendance: in/out lifecycle, simultaneous check-ins, current-work cleanup,
  foreign session references, self-approval rejection, role restrictions,
  duplicate approval and overlapping periods.
- Chat: input validation, page-size bounds, duplicate clientMessageId handling,
  concurrent retries, unread counts, foreign reply/read references and realtime
  delivery without password hashes.
- Socket.IO: valid/invalid authentication, permitted/denied room joins,
  malformed typing event and disconnection after session revocation.
- AI actions: permissions, concurrent confirmation creates only one task,
  cancellation restrictions, supported state changes, current-work updates,
  expiry and restricted undo.
- Reports/search: role-restricted CSV exports, formula escaping, dashboard
  reads and accent-insensitive search beyond the former 50-task cutoff.
- HTTP errors: malformed JSON and unknown endpoints return JSON errors.

## Main Fixes

The browser crash was reproduced as requests to localhost:3001 failing,
followed by a null dueToday dereference. Docker now builds the browser with
same-origin API URLs. Loading failures have recovery UI and an error boundary.

HTTP and realtime payloads strip nested password/session hashes. Tenant checks
apply to administrator task reads and referenced entities. Task history writes,
attendance operations and AI confirmation use transactions. Chat retries are
idempotent. Room cleanup prevents messages from an old conversation appearing
in the currently selected chat.

Mobile navigation exposes all pages and logout. Mobile chat can select a room;
channel search and older-message loading now have working handlers. The login
form no longer pre-fills a public demo password.

Docker uses the lockfile, excludes environment files from images, separates
Docker/local database settings and deploys versioned Prisma migrations. A
pre-upgrade PostgreSQL dump is in backups/work-ai-before-hardening.dump.

Next.js and related runtime dependencies were updated after the dependency
audit. Upgrade guidance was checked against the official documentation:
https://nextjs.org/docs/app/guides/upgrading/version-15

## Reproduction

Run `npm test` for the isolated API suite. It uses its own Compose project,
temporary database and generated fixtures; it does not mount production data.
Run `npm run test:e2e` against the app at http://localhost:8080.
See RUNBOOK.md for credentials, environment overrides and the separate live-AI
command. Browser screenshots/traces are under apps/web/test-results and the
HTML report is under apps/web/playwright-report.

## Limits

These results cover the implemented flows, not a guarantee of zero defects or
a security penetration test. Gemini cannot be accepted until valid credentials
are mounted and its live test passes. Direct AI queries report unavailability
instead of silently pretending the rule parser is Gemini.

Attachments and AI-generated subtasks are not accepted features in this pass.
Web Push is implemented and tested with mocked provider delivery, but physical
Mac/background delivery is not accepted yet. Backup creation was performed;
full restoration was not rehearsed.
Redis error handling was improved, but a Redis-failure/recovery drill was not
run. The latency tests use small fixtures, not production-scale data. TLS,
real accounts/passwords, monitoring and backup scheduling remain deployment
configuration tasks. The rate limiter is process-local for the single API
container and needs a shared store before horizontal scaling.
