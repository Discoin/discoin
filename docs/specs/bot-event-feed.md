# Bot event feed without webhooks

Changed on 2026-11-22 by the owner's decision: the 410 for expired events and `resumeAfter` were removed. `GET /events` skips expired events without an error.

Status: approved by the owner on 2026-11-22. Not built yet. Build later, as its own change.

## Verified against the code on disk

- `enqueue_webhook` (apps/api/app/webhooks/delivery.py) is called from apps/api/app/transactions/ledger.py (created), apps/api/app/admin/deactivation.py (cancelled), apps/api/app/blocking/service.py (cancelled or reversed, with trigger) and apps/api/app/owners/routes.py `resend_webhook` (sent as `transaction.created`). Today it inserts a delivery only when the to-currency is not removed and its bot has a webhook URL.
- Next free migration: `0005`. Bot auth is `CallingBotId` in apps/api/app/bots/tokens.py (401 for a regenerated or removed bot's old token).
- apps/api/app/owners/routes.py: `send_test_webhook` (POST `/bots/{bot_id}/webhook-test`) answers 400 "Save a webhook URL before sending a test." without a URL and returns `WebhookTestResult(status)`. `resend_webhook` answers 400 "Add a webhook URL before resending. Your bot can still poll for this transaction." without a URL. `set_webhook_url` (PUT `/bots/{bot_id}/webhook-url`) is a single UPDATE; `remove_webhook_url` (DELETE) sets `webhook_url = NULL`. Pending deliveries are failed by the worker with "The webhook URL was removed." until exhausted.
- `resend_webhook` calls `lock_owned_bot` (apps/api/app/owners/access.py), which takes `FOR NO KEY UPDATE` on the bot row first, then `FOR UPDATE OF t` on the transaction. The ledger, deactivation and blocking paths take currency locks and transaction rows first. See Ordering, rule 6.
- `ApiError(status, message, field=None, **extra)` in apps/api/app/core/errors.py is the error helper. Status 409 is already used for "already exists" conflicts (admin/bots.py, admin/routes.py, blocking/service.py, currencies/queries.py), so a 409 for "state conflicts with this request" fits and clashes with nothing. 410 is not used today.
- Amounts in webhook and feed payloads are JSON numbers (`JsonDecimal` in apps/api/app/core/models.py serialises to float), for example `250.0` and `31.75`.
- Lock order: `lock_exchange_sides` / `lock_currencies_first` in apps/api/app/transactions/locking.py and exchange.py. Currency locks come first, in id order.
- Frontend: apps/frontend/src/pages/BotOwner/WebhookForm.tsx (Test button, message "Test sent. Your webhook answered {status}."), PendingWebhooks.tsx, index.test.tsx, apps/frontend/src/mocks/api.ts (`api.testWebhook`).

## What gets built (phase 1)

A per-bot event feed and a polling route. A bot uses either a webhook or the feed, never both. Each event goes to exactly one place, chosen when it is written:

- The receiving bot has a webhook URL at that moment: the event goes to the webhook queue only, exactly as today. No feed row.
- It has no webhook URL at that moment: the event goes to the feed only. No webhook delivery row.

This holds for created, cancelled, reversed, resend and test alike. A bot without a public address authenticates with its normal API token, polls about every 2 seconds, and acknowledges what it handled. No public URL, no secret, no signature check, no tunnel. The webhook worker, retries and signature are unchanged. Webhooks stay the right choice for bots that are web services.

## Behaviour

1. Who gets events: the receiving bot only (the bot that runs the TO currency), as webhooks do today. Sender side events are out of scope, a possible later spec. Event names: `transaction.created`, `transaction.cancelled`, `transaction.reversed`, `transaction.test`. A resend is written as `transaction.created`.
2. One path per event, decided once under the bot's row lock so a concurrent URL change cannot lose or duplicate an event.
3. Feed routes are refused while a URL is set. `GET /events` and `POST /events/ack` (and in phase 2 the stream) answer 409 with `{status: 409, message, field: null}` through `ApiError`:
   `This bot has a webhook URL, so its events go to the webhook. Remove the URL on the Bot owner page to read events here.`
   Order of checks: bad or missing token is 401 first, then this 409, then parameter errors (422), then 410 and the rest. Tests must pin that order (FastAPI validation versus dependency order is the coder's to make hold).
4. Switching feed to webhook: saving a URL, in the same database transaction as the URL change, deletes the bot's stored feed events and sets the cursor to the bot's current counter. Nothing sits unreadable until expiry, and ids are never reused for a bot. The owner is told nothing new at save time and no unread count is shown. Instead the webhook form gets one static help line, for example "With a webhook URL, events are sent to it and the event feed is switched off." Anything the bot had not read is still available through `GET /transactions/pending`; docs say so.
5. Switching webhook to feed: removing the URL makes the feed routes work from that moment, starting empty. Events already queued for the webhook stay on the webhook path; the worker keeps failing them with "The webhook URL was removed." until exhausted. No redesign, nothing is moved into the feed. Docs tell developers to read `GET /transactions/pending` to catch up.
6. Dedupe: no cross-path duplicates exist. Duplicates remain possible within the feed (crash between handling and ack, or a resend), so docs tell feed bots to dedupe on transaction id plus event.
7. Resend (dashboard): for a bot with a URL, unchanged. For a bot without one, it writes a `transaction.created` feed event instead of answering 400; the "Add a webhook URL before resending..." error is removed. Still only Pending transactions.
8. Test button: same rule.
   - URL set: unchanged, synchronous send to the webhook, the owner sees "Test sent. Your webhook answered {status}."
   - No URL: a `transaction.test` event is written to the bot's feed; the route no longer answers 400 for a missing URL. The owner sees a distinct message, for example "Test event added to your event feed. Your bot gets it on its next read." Discoin does not wait for the bot. The response must let the page tell the two cases apart (shape is the coder's).
   - Test payload is today's: a random transaction id, both currency ids the nil UUID, amount 100.0, payout 10.0, status Pending, handledAt null, userId the owner's Discord ID. In the feed it carries the next per-bot event id like any event (a real, stored, acknowledgeable row, unlike the webhook test whose id is 0). It expires like other events.
9. Payload: same envelope as the webhook body: `{"id","event","transaction","triggeredBy"?}`; `transaction` is `WebhookTransaction`, no currency labels (decision of 2026-11-21 stands). `id` is the per-bot feed event id.
10. Acknowledgement: server side cumulative cursor per bot, so a bot with no disk survives a restart.
11. First read of a brand new feed bot: it receives only events written while it had no webhook URL and that are less than 24 hours old, oldest first. Nothing is back-filled from before the feed existed or from periods when it had a URL. A bot that just removed its URL starts empty. For anything older, docs and the library tell developers to read `GET /transactions/pending` when the bot starts, then poll the feed.
12. Retention: 24 hours. Older events are deleted.
13. Cursor older than retained: if events after the bot's cursor expired unread, `GET /events` answers 410 with `resumeAfter` (the id to pass as `after`) in the body. No silent skip. A never-read bot whose events all expired also gets 410 on first call. Docs: on 410, read `GET /transactions/pending`, then resume with `after=<resumeAfter>`.
14. Token regeneration: cursor and unread events are kept. Owner change and bot removal: the bot's events are deleted and the cursor set to the counter (matches dropping pending webhooks today).
15. Dashboard: nothing about the feed beyond the Test, Resend and help line above. A last read time means a write on every poll; left out.

## Ordering (re-checked for one path and for URL switching)

The reader must never receive event N and later see a lower id for the same bot appear. Recommended mechanism, for the coder to verify or replace: number feed events per bot with a counter on the bot row; the row lock held until commit serialises that bot's feed writes, so ids are gapless and commit ordered. Conditions:

1. Only events that go to the feed bump the counter, so webhook bots never touch it.
2. The path decision is read from the bot row after it is locked, so exactly one path writes even if the owner saves or removes the URL at that instant.
3. Bot row locks come after all currency locks, and in bot id order when one operation writes for several bots (deactivation).
4. The Test route holds no currency lock; it takes only the bot row lock, so it cannot form a cycle.
5. Owner change and bot removal take the bot row and delete that bot's events in the same transaction.
6. Real risk to resolve: `resend_webhook` locks the bot row before the transaction row, while ledger, cancel and block paths take the transaction row first and the bot row later. That inversion can deadlock. The coder must fix the order (for example take the transaction row first in resend) and show it with a test.
7. Switch consistency: `set_webhook_url` must take the same bot row lock (check that `OwnedBotForWrite` does) before changing the URL, deleting the feed and moving the cursor, all in one transaction. A concurrent event writer either holds the lock first (its feed row commits before the save, and the save then deletes it) or waits and then reads the new URL under the lock (and goes to the webhook). An event therefore cannot land in the feed after the feed was cleared for a bot that now has a URL. Removing a URL works the same way in reverse: writers after the lock see no URL and write to the feed; ones before it queued a webhook. Concurrent saves and events must be tested with two real connections.

The coder must prove all of this with a two connection test, not by argument alone.

## API contract

Both routes are bot facing: add to `BOT_FACING_ROUTES` in apps/api/app/main.py, Bearer token, 300/min limit applies as is.

`GET /events?after=<id>&limit=<n>`

- `after` optional. Omitted means "after my stored cursor". Given means after that id (does not move the cursor).
- `limit` optional, default 100, max 100. Above max or non numeric is 422, not clamped.
- 200 `{"events":[...]}` in id order; an empty list when nothing is new. A full batch means call again at once.
- 401 bad token. 409 bot has a webhook URL (message above). 410 expired unread events, body includes `resumeAfter`. 422 bad parameters.

`POST /events/ack` body `{"id": <int>}`

- Moves the stored cursor forward to `id`. Idempotent: an id at or below the cursor changes nothing and returns 204.
- 204 on success. 400 when `id` is higher than the newest event for that bot. 401 bad token. 409 bot has a webhook URL.

Worked example (bot without a webhook URL):

```
GET /api/events            Authorization: Bearer dsc_...
200 {"events":[{"id":41,"event":"transaction.created","transaction":{"id":"0190f3b2-...","fromCurrencyId":"0190f3a1-...","toCurrencyId":"0190f3a9-...","amount":250.0,"payout":31.75,"status":"Pending","submittedAt":"2026-11-22T10:00:00Z","handledAt":null,"userId":"123456789012345678"}}]}
POST /api/events/ack       {"id":41}      204
GET /api/events            200 {"events":[]}
```

Same bot after saving a webhook URL:

```
GET /api/events            409 {"status":409,"message":"This bot has a webhook URL, so its events go to the webhook. Remove the URL on the Bot owner page to read events here.","field":null}
```

Check every other place (docs examples, README, tests, mocks) for amounts shown as strings and make them numbers.

## Data model (migration `apps/api/migrations/0005_bot_events.sql`)

- Event table: bot, per bot event id, event name, payload (jsonb), created at. Unique per bot and id; ordered reads by bot and id; cheap deletion by bot and by age.
- Per bot columns: event counter and acknowledged cursor.
- Retention 24 hours, purged by the existing background worker loop (coder picks where).
- `webhook_deliveries`, the worker and signature are unchanged.

## Change list, in build order

1. apps/api/migrations/0005_bot_events.sql.
2. apps/api/app/webhooks/delivery.py: in `enqueue_webhook`, choose the path under the bot row lock: URL set, webhook insert as today; no URL, feed event with the same payload. All four callers get it through that one function. Change a caller only if the lock order needs it.
3. apps/api/app/owners/routes.py: `resend_webhook` (drop the no URL error, fix the lock order, rule 6), `send_test_webhook` (feed path without URL, distinct response), `set_webhook_url` (clear feed and cursor in the same transaction under the bot lock). Build the test payload once and use it on both paths.
4. Owner change and bot removal (apps/api/app/admin/removal.py and the owner change route): delete the bot's events and set the cursor to the counter beside `drop_pending_deliveries`.
5. Retention purge (24 hours) in the worker loop.
6. Models and the two routes in apps/api/app/bots/, registered in `BOT_FACING_ROUTES`, with the 409 check after authentication.
7. Frontend Bot owner page: apps/frontend/src/pages/BotOwner/WebhookForm.tsx (Test message for the feed case, the static help line, an accessible name for Test that stays accurate without a saved URL, WCAG 2.2 AA), PendingWebhooks.tsx (check the resend control is not hidden or disabled without a URL), apps/frontend/src/mocks/api.ts and the API client, apps/frontend/src/pages/BotOwner/index.test.tsx.
8. apps/frontend/src/pages/Docs/endpoints.ts and index.tsx: both routes, errors including 409 and 410, ack, 24 hour retention, "a bot uses a webhook or the feed, not both", switching in both directions, dedupe on transaction id plus event, read `GET /transactions/pending` on startup, polling about every 2 seconds. apps/api/tests/core/test_docs.py fails until this matches.
9. apps/api/README.md bot contract section, same content. No em or en dashes in docs, README or UI text.

## Tests (apps/api/tests, apps/frontend; mirror existing layout)

- Ordering: events come back in id order across created, cancelled, reversed, resend and test.
- Replay after a gap: read without ack returns the same events; after ack none; `after` replays older ones.
- Commit order: two real connections, second commits first; the reader never gets a higher id while a lower one is uncommitted. Also concurrent operations across several bots do not deadlock, including resend against a ledger write for the same bot.
- One path: URL set gives a delivery and no feed row; no URL gives a feed row and no delivery; same for cancelled, reversed, resend and test.
- 409: with a URL set, `GET /events` and `POST /events/ack` answer exactly 409 and the message above; bad token with a URL set is still 401; the routes work again after the URL is removed and start empty.
- Saving a URL deletes unread feed events and sets the cursor to the counter in one transaction; ids are not reused after removing the URL again.
- Concurrent event during a URL save (two real connections, both lock orders): the event ends up on exactly one path, never in the feed after the clear, never both, never neither. Same for removal.
- Removing the URL leaves pending deliveries to the worker with "The webhook URL was removed."
- No leaking: bot B never sees bot A's events through reads, `after` or ack.
- Revoked token: 401 on both routes after regeneration and removal; cursor and events survive regeneration; events deleted on owner change and removal.
- 410 with `resumeAfter` after unread events expired; ack above newest gives 400; ack below cursor is a no op 204.
- Retention: purge removes only events older than 24 hours.
- Test button: URL set, webhook behaviour unchanged; no URL, feed event written with the test payload, owner sees the feed message, no 400. Resend without a URL writes a feed event.
- Webhook path unchanged: all existing webhook tests pass untouched.
- Frontend: BotOwner `index.test.tsx` covers both Test messages and the help line; the axe e2e still passes.

## Checks

`npx nx run-many -t lint test typecheck` for api and frontend (confirm target names with `npx nx show project`), the frontend axe e2e, and `test_docs.py`.

## Phase 2 outline (only if polling volume or latency matters; reuses the table and cursor unchanged)

- Server sent events on one long `GET /events/stream`, `Last-Event-ID` as the cursor, comment ping every 15 s, one live connection per token (a new one replaces the old). Refused with the same 409 when a URL is set.
- Async route that does not hold a pooled connection while streaming; one shared poller per API process fans out to connected bots.
- Close an open stream on token regeneration, bot removal, owner change and when a webhook URL is saved.
- nginx `/api/` location needs buffering off and a long read timeout.
- Test that the `@app.middleware("http")` auth, rate limit and request log behave with a streaming response.
- Chosen over WebSocket because Bearer auth, rate limit and logging already apply to a GET.

## What discoin.py needs from phase 1

- A bot using the library must have no webhook URL set. With a URL, `GET /events` and `POST /events/ack` answer 409. The client must treat that as fatal: do not retry, stop and tell the developer to remove the webhook URL on the Bot owner page (or not use the feed).
- On start: read `GET /transactions/pending` to catch up on anything older than 24 hours or queued before a URL was removed, then poll `GET /events` about every 2 s, process in id order, then `POST /events/ack` with the highest handled id (after handling, not before). A full batch means poll again at once.
- Dedupe on transaction id plus event; duplicates are possible after a crash between handling and ack, and on a dashboard resend.
- On 410, read `GET /transactions/pending`, then resume with `after=<resumeAfter>` and surface the loss to the developer. On 429 wait Retry-After. On 401 stop and tell the developer to regenerate the token.
- `transaction.test` events can arrive from the owner's Test button; hand them to the bot like any event. Amounts are JSON numbers.

## Rules for the coder

- Shortest diff that works. No new abstractions without a second user, no unrelated edits.
- No silent fallbacks: no default values for required data, no catch and continue, no "use X if missing". If something fails, let it fail with the proper error.
- No comments in code unless the code looks wrong but is deliberate (one line of why). No change narration, no TODOs.
- Blank line spacing, every language: a `return` is separated from the code above by a blank line (except a guard return directly under an `if`, or a function whose whole body is one return). Loops and multi-line ifs get a blank line above and below, except where they open or close the enclosing block, or when the value they iterate or test is defined on the line right above (then the blank line goes before that definition).
- No em or en dashes in UI text, docs or README.
- No self attribution anywhere. Do not commit.
- npm, never pnpm. Run tasks through nx with npx.
- Frontend must meet WCAG 2.2 AA.
- Read files as they are on disk; the working tree has uncommitted work.

Open questions: none.
