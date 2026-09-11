# Assistant context

The `/ai/query` endpoint uses authenticated scope and a 12-request/minute per-user limit.

## Daily context

- Business day is Asia/Ho_Chi_Minh, including the midnight boundary.
- Only conversations the user has joined in their organization are eligible. Admin private-conversation privileges do not implicitly expand assistant context.
- Redis keys include organization, user, membership IDs and date. SHA-256 fingerprints include source content and timestamps. Edits/deletions invalidate the affected daily entry on the next query. Entries expire after seven days and are rebuilt from PostgreSQL.
- Cache failure does not prevent a question. Current task permissions and current work are read on every request, never reused from daily cache.
- The current retrieval window is the latest 2,000 eligible messages, across all dates. Historical context selects 16 relevant/recent excerpts; today's context selects the latest 24; each excerpt is capped at 600 characters. Up to 60 current tasks are included. Responses expose `truncated` when these bounds exclude records.
- These are source excerpts, not generated knowledge summaries. They may omit older decisions and are not a complete organizational memory.

## Statistics

Exact supported Vietnamese intents: `Thống kê công việc`, `Thống kê công việc hôm nay`, `Tổng quan công việc`, `Bao nhiêu công việc quá hạn`, `Công việc của tôi`.

These query all authorized non-archived tasks with database counts, without a model call. "Hôm nay" means a current snapshot, not tasks created today; the answer states this explicitly. Unsupported person/project/date filters are sent to the assistant, which is instructed not to infer global totals from excerpts.

## Token accounting and remaining work

The implementation reduces prompt size through bounded selection and avoids model calls for supported statistics. Redis reuse is application-level caching, not Vertex explicit context caching. No provider cache-token discount or measured savings percentage is claimed. Gemini credentials are required for free-form questions. Provider cachedContent integration, complete historical semantic retrieval, persistent assistant follow-up history, and measured token telemetry remain follow-up work.
