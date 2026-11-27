# Bot feed: per-event results with retry

A feed bot reports each event as handled or unhandled. Unhandled events come back after a backoff, like webhook deliveries. Later events are never blocked by an earlier one.

## Decisions

- The cursor goes away: `GET /events`, `POST /events/ack`, the `?after=` param and `bot_feeds.acknowledged_event_id` are removed.
- Events are taken with `POST /events/claim`, which leases them. A GET must not change state.
- Backoff reuses the webhook schedule (`app/webhooks/delivery.py` `FIRST_RETRY_DELAY`, `MAX_RETRIES`, `retry_delay`). Import it, do not copy it.
- The 24 h purge (`app/bots/feed.py` `RETENTION`) stays and removes events in every state.

## Storage

New migration `0008_feed_event_results.sql`:

- `bot_events` gains `state text NOT NULL DEFAULT 'pending'` with CHECK in (`pending`, `handled`, `dead`), `attempt int NOT NULL DEFAULT 0`, `next_attempt_at timestamptz NOT NULL` (backfill `created_at`).
- Existing events at or below the bot's `acknowledged_event_id` become `handled`.
- Drop `bot_feeds.acknowledged_event_id` and its check constraint; update `create_bot_feed()` to match.
- Index for claim: `(bot_id, next_attempt_at) WHERE state = 'pending'`.

`add_event` sets `next_attempt_at = now`. `clear_feed` only deletes events.

## `POST /events/claim?limit=N` (bot token, feed bot)

- `limit`: 1..100, default 100, validated like today's `checked_limit`.
- Picks the bot's events with `state = 'pending' AND next_attempt_at <= now`, ordered by `id`, up to `limit`, `FOR UPDATE SKIP LOCKED`.
- For each: `attempt += 1`, `next_attempt_at = now + LEASE + retry_delay(attempt)` (`LEASE = 2 min`). No extra lease column: an unreported event simply becomes due after lease plus backoff, so lease expiry counts as a failed try.
- A due event that already used every try (`attempt - 1 >= MAX_RETRIES`, i.e. it was claimed and never reported on its last try) becomes `dead` in the same claim and is not returned.
- Returns 200 `{"events": [{"id", "attempt", ...payload}]}`.

## `POST /events/{id}/result` (bot token, feed bot)

Body `{"handled": bool}`, strict bool.

- `handled: true` on `pending` or `dead`: state `handled`, 204. On `handled`: 204.
- Reporting an unclaimed event (`attempt = 0`): 409 `Claim this event before reporting it.`
- `handled: false` on `pending`: if `attempt - 1 >= MAX_RETRIES` state `dead`, else `next_attempt_at = now + retry_delay(attempt)`. 204. On `handled` or `dead`: 409 `This event is already finished.`
- Unknown id, another bot's event, or purged: 404.
- Locks the event row for the update.

Both routes keep the 409 for a bot with a webhook URL (`feed_bot_id`).

## Webhook test

`app/webhooks/webhook_tests.py` `state_of` uses `acknowledged_event_id < feed_event_id` for `waiting`. Replace with: `waiting` while the test's feed event has `attempt = 0` (never claimed), else `delivered`. The pass rule (PATCH marks the test) is unchanged.

## Docs

`apps/api/README.md`, `apps/frontend/src/pages/Docs/endpoints.ts` and `index.tsx`, OpenAPI text: describe claim, result, lease, backoff, dead, 24 h purge, the `attempt` field, and that handlers must be idempotent by transaction ID and should check the transaction is still Pending when `attempt > 1`.

## Tests

Replace the cursor tests in `tests/bots/test_events.py` and fix `test_feed_locking.py`, `test_undone.py`, `test_hardening.py`, `test_migrations.py`, `factories.py`, `test_webhook_tests.py`. Cover: claim order and limit, lease hides an event, lease expiry plus backoff, unhandled backoff, dead after max tries, handled is final, 409 and 404 cases, later events not blocked, purge, migration backfill.

## Out of scope

- Any UI for dead events.
- Webhook delivery changes.
