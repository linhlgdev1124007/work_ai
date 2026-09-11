# Web Push and automatic chat classification

## Behavior

- Workspace requires notification permission AND a subscription saved successfully by the API. Login, password change and logout remain reachable. The browser permission prompt is only requested by a user click.
- Assignment notifications go to the assignee (or creator for an unassigned new task). Reassignment notifies the new assignee.
- Chat notifications go to other active members, never the sender. Mention IDs are validated against the room and visible tagged names. A mention replaces the ordinary message notification for that recipient.
- Due-soon reminders cover the next two hours; overdue reminders cover unfinished overdue tasks. Scan interval is five minutes. Deduplication keys include task, assignee, exact deadline and reminder type, not unrelated task version changes.
- Notification creation shares the transaction with task/message writes. A PostgreSQL-backed dispatcher polls every 15 seconds, claims a five-minute lease, retries pending sends with backoff capped at one hour for seven days, and deletes 404/410 endpoints. Missing registrations remain pending instead of being marked processed. Per-subscription provider acceptance is stored so an already-accepted device is skipped when another fails. A crash between provider acceptance and the database write can still cause a repeat; delivery is at-least-once and browser tags collapse duplicates.
- Provider TTL is 24 hours, subject to provider limits. Important mentions, assignments and test notifications request high urgency, which cannot override operating-system settings. Provider acceptance is not confirmation of display or of a human reading the notice.
- Each browser endpoint is bound to a login session. Logout/session deletion cascades the registration; expired or suspended accounts cannot receive new sends. Content is generic on the lock screen; details stay behind authenticated, scoped links. Already-dispatched provider messages cannot be recalled.
- The inbox shows up to 100 recent authorized notifications. New pending events up to seven days old can be sent after a valid device is registered; read notices and inaccessible/stale reminders are excluded. Older events remain in the database without automatic push retry. Previously processed events from before this migration are not replayed.
- The browser revalidates registration on focus, online recovery and periodic checks (network registration at most once per minute per tab, except online events). Lost subscriptions are recreated and re-saved to the API. No background worker can recreate an expired login session without the member signing in again.
- Open the notification bell and select `Gửi thông báo thử`. This enqueues a notification to the current account's active registered devices, rate-limited to three per minute. The UI says queued, not delivered. Confirm the notification appears in the OS on each Mac/Windows device, including with the tab closed.

## Automatic AI classification

There is one composer, not a manual task/chat switch. Every message is offered to the AI queue. The classifier evaluates the newest message using room context, including jokes, negation, quotes, casual language and mixed social/work messages. Merely mentioning a name or the words "work", "done" or "deadline" is not an instruction.

Only validated model responses indicating a clear work instruction with confidence >= 0.85 create a pending proposal. No automatic task mutation occurs. Social messages create no AI action. Ambiguous classifications create no task; invalid/unavailable model responses leave the message UNCLASSIFIED. The old keyword parser is not used as a fallback in this workflow. Model confidence is not a calibrated guarantee; user confirmation is still required. Gemini credentials are required to verify real-language classification quality.

## Deployment

- External access requires HTTPS. localhost is suitable for development; an HTTP LAN IP is not a secure context.
- Mac Safari requires macOS Ventura 13+ / Safari 16.1+ for standards-based Web Push, without Home Screen installation. Check Safari website permission, macOS Notifications and Focus. The gate now gives platform-specific guidance. See [WebKit Safari 16.1](https://webkit.org/blog/13399/webkit-features-in-safari-16-1/).
- On Windows, check site permission in Edge/Chrome/Firefox, Settings > System > Notifications for that browser, Do not disturb and background browser operation. See [Microsoft notification settings](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows).
- `docker-compose.https.yml` and `Caddyfile.https` provide an optional domain-based deployment. Set `PUBLIC_DOMAIN`, DNS and ports first. The profile was configuration-validated, not publicly deployed. Full steps and real-Mac acceptance checks are in [CHAT_WORKSPACE.md](CHAT_WORKSPACE.md).
- On iOS/iPadOS, use a supported version and add the app to the Home Screen, then open the installed app and grant permission. Local PNG manifest icons are included.
- Closing a tab does not stop standards-based Web Push. Force-quitting a browser, disabling background activity, OS notification settings, offline devices or battery restrictions can delay/prevent delivery. No website can override those restrictions.
- Stable VAPID keys are generated once in `storage/web-push-keys.json`; Docker persists this via `app_storage`. Back up this file securely. Never delete/rotate it casually: browser subscriptions depend on the public key.
- Alternatively configure both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Configure `VAPID_SUBJECT=mailto:your-real-admin@example.com`. `PUSH_KEY_DIRECTORY` changes the key directory. `PUSH_REQUIRED=false` is an explicit administrator escape hatch; default is required. `PUSH_ENABLED=false` disables the dispatcher for isolated tests, not the inbox.
- Push endpoints are restricted to known FCM, Mozilla, Apple and Windows push hosts to prevent SSRF. Unsupported providers require an audited allowlist update.

References: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Verification on 2026-09-11

Production build and non-destructive migration passed. The latest pass completed 266 HTTP/database integration checks, 104 backend tests, 47 desktop/mobile tests and 13 simulated Service Worker checks. One live-AI suite case and one desktop-inapplicable mobile case were skipped. A separate live Gemini call initially failed with missing ADC (503); after mounting host ADC read-only, the live smoke test and authenticated AI query both passed.

An additional real Windows Chrome smoke test used an isolated persistent profile, registered with the live API/provider, queued a test notification, closed the website tab, and observed that notification through the running Service Worker's getNotifications(). The browser process stayed running. Native OS banner visibility in headless mode and physical Mac Safari delivery are not verified. Incognito registration was rejected by Chrome; the persistent-profile test passed. Reproduce with `node scripts/live-push-browser.cjs`; it logs out and removes its temporary profile afterward.

The production permission gate is enabled. No permanent member devices were registered during verification; each member must sign in and enable notifications on each device. Automated UI/provider mocks are separate from the real Chrome smoke test. See TEST_REPORT.md for detailed scope.
