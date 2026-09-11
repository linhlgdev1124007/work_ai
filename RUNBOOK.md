# Work Management AI - Runbook

## Stack

TypeScript monorepo: Next.js 15 / React 19, Express, Prisma 5, PostgreSQL 16,
Socket.IO, Redis / BullMQ, Google Vertex AI. Docker Compose publishes the app
through Caddy at http://localhost:8080.

## Run

```bash
docker compose up -d --build
docker compose ps
```

The browser uses same-origin /api/v1 and Socket.IO through Caddy. NEXT_PUBLIC_*
values are compiled into the frontend, not read at container startup.
Docker derives its database URL from POSTGRES_USER, POSTGRES_PASSWORD and
POSTGRES_DB; DOCKER_DATABASE_URL overrides it for an external PostgreSQL server.
A SQLite DATABASE_URL in a local .env no longer overrides the Docker database.

API startup runs scripts/migrate.cjs and prisma migrate deploy. Existing
db-push installations are adopted only after the schema matches the baseline.
Schema mismatch stops deployment without resetting or deleting data.
New databases receive the baseline and PostgreSQL unaccent extension.
The database account needs permission to install that extension.

GET /healthz checks the process. GET /readyz checks PostgreSQL connectivity.
Readiness does not certify Redis or Vertex AI availability.

## Tests

```bash
npm test
npm run test:e2e
npx --yes pnpm@12.3.4 audit --prod
```

npm test builds a separate Docker Compose project (work-ai-tests), with
PostgreSQL in tmpfs and no production volumes or credentials. It runs migration
twice, real HTTP/Socket.IO integration tests, then the existing service/parser
tests against demo fixtures in the disposable database.

The integration runner requires the database name work_ai_test. Do not run the
legacy attendance tests directly against business data: they clear fixture
attendance records.

E2E tests require the running web app and Chromium:
```bash
npx --yes pnpm@12.3.4 --filter @work-ai/web exec playwright install chromium
npm run test:e2e
```

E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD override the local demo defaults.
HTML results and screenshots are in apps/web/playwright-report and
apps/web/test-results. These tests exercise desktop/mobile navigation, actual
login, API rendering, expired sessions and recovery from an injected API outage.

## Demo Data

```bash
docker compose exec -T api pnpm --filter @work-ai/database run seed
```

Seed runs only when the TECHCORP organization does not already exist.
It skips existing demo organizations to avoid duplicate teams and projects.
Demo login: admin@techcorp.vn / Admin@123456.
Do not use demo accounts or passwords for an Internet-facing installation.
The login page no longer pre-fills the demo password or shows demo shortcuts
unless explicitly built with NEXT_PUBLIC_DEMO_MODE=true.

New users receive a temporary password and must change it before accessing
business APIs. Password changes, resets and suspensions revoke sessions.
Failed login attempts are limited per IP (20 / 15 minutes); this limit is
process-local and should use a shared store before scaling API replicas.

## Vertex AI

Set GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GEMINI_MODEL and
GOOGLE_APPLICATION_CREDENTIALS. The credentials file must exist INSIDE the
container, mounted read-only through a deployment-specific Compose override.
Never commit the credentials or bake them into images.

For this local workstation, `docker-compose.override.yml` is loaded automatically
by `docker compose`. It mounts only the ADC file read-only at the path above;
set `GOOGLE_ADC_HOST_PATH` in `.env` to its absolute host path. Missing source
files fail deployment rather than creating an empty directory. On Windows the
usual file is `%APPDATA%/gcloud/application_default_credentials.json`; on
Mac/Linux it is `$HOME/.config/gcloud/application_default_credentials.json`.
If absent, run `gcloud auth application-default login` interactively on the host.
`gcloud auth login` alone is separate from application credentials. Restart the
API with `docker compose up -d --no-build --no-deps api` after configuration changes.
Explicit `-f` deployments do not load this override automatically: include
`-f docker-compose.override.yml` for local ADC use. On a production server,
prefer a dedicated workload identity with least privilege over personal ADC.
Do not copy the host credential file into this repository or a Docker image.

Verified on 2026-09-11 after mounting the existing workstation ADC: the live
Gemini smoke test passed and authenticated `POST /api/v1/ai/query` returned
`success: true`, `mode: ai`, and `SAN_SANG`. The app retains its configured
`gemini-image-benchmark` project and `gemini-2.5-flash` model; the CLI's active
project is independent. This verifies connectivity, not all classification cases.

AI_ENABLED=false disables message analysis. AI actions require confirmation by
default; AI_AUTO_APPLY=true is an explicit opt-in. Supported confirmations:
create task, change assignee/deadline/status and set current work. Unsupported
actions return an error. Undo is restricted to task creation within 24 hours.
Automatic message classification does not fall back to the legacy rule parser
when Vertex is unavailable. Direct questions return 503 in that case.

Run the separate live test after supplying credentials:
```bash
docker compose exec -T -e TEST_LIVE_AI=true api pnpm --filter @work-ai/api exec vitest run src/modules/ai/ai.spec.ts -t "Live Smoke"
```

For the Vietnamese SEO assignment regression, use a plain existing message in
a room containing Nguyen Van Sang. This opt-in test calls real Vertex seven
times using the actual classifier prompt and scoped room context. It blocks the
analysis transaction in its own isolated process and never confirms/creates tasks:

```bash
docker compose exec -T -e TEST_LIVE_AI=true -e TEST_CLASSIFICATION_MESSAGE_ID=<message-id> api node scripts/live-classification.cjs
```

The cases distinguish assignments (including informal/mixed social wording),
social invitations, negation, completion reports and progress questions. This
small live regression is not a guarantee of model accuracy for every message.

## Task Assignment

The Tasks page supports manual creation with an assignee, optional managed group,
description, deadline, priority and completion review. Use the group and assignee
filters to inspect work. Admins see organization-wide tasks. Leads see tasks in
their accessible managed groups/teams, not unrelated private member tasks. A
lead must select the managed group to assign another member; standalone personal
assignments to others are administrator-only. Ordinary members can create their
own personal tasks. Group task visibility for existing members is unchanged.
View-only details hide save/checklist mutation controls; API authorization is
still enforced independently of the interface.

New AI CREATE_TASK proposals have a context-aware title editing step after
extraction. The editor cannot alter assignment, deadline or intent. The user can
edit the proposed title before confirmation. Existing tasks and pending proposals
are not renamed automatically. If title editing is unavailable, the validated
extracted title is retained. The extra context is bounded; it is not a claim
that the model has read every historical task.

## Deployment Checks

Use HTTPS and COOKIE_SECURE=true outside localhost. Set WEB_URL and CORS_ORIGINS
to the public origin. Change demo/default database passwords before creating a
new production volume; changing POSTGRES_PASSWORD does not change an existing
PostgreSQL role password automatically.

Back up PostgreSQL and private storage before migrations. The existing Bash
backup/restore scripts are operational helpers, not a verified disaster-recovery
procedure. Rehearse restoration on a separate database before relying on them.
A pre-upgrade database dump from this session is stored at
backups/work-ai-before-hardening.dump.

## Acceptance Limits

See TEST_REPORT.md for executed checks and remaining gaps. Attachments, web
push, AI-generated subtasks and full disaster recovery are not accepted features
of this pass. The included latency checks use small fixtures and are not a
large-scale capacity certification.
