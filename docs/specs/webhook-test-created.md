# Webhook test sends a real created event

The dashboard Test button sends a `transaction.created` event marked `"test": true`, then waits until the bot marks the test transaction Completed or Refunded, and reports success or the step that failed.

Owner decisions:

- The test is a `transaction.created` event, not `transaction.test`. `transaction.test` is removed everywhere.
- Every event, real or test, carries a top-level `"test"` boolean. Real events: `false`. A bot that ignores the flag pays out on a test; the owner accepted that.
- Success means the bot marked the test transaction with `PATCH /transactions/{id}`.

## Event body

Same body on the webhook and the feed:

```json
{
  "event": "transaction.created",
  "test": true,
  "transaction": {
    "id": "<new UUIDv7 per test>",
    "userId": "<owner's Discord ID>",
    "fromCurrencyId": "00000000-0000-0000-0000-000000000000",
    "toCurrencyId": "00000000-0000-0000-0000-000000000000",
    "amount": 100.0,
    "payout": 10.0,
    "status": "Pending",
    "submittedAt": "<now>",
    "handledAt": null
  }
}
```

- `transaction.created`, `transaction.cancelled`, `transaction.reversed` and resends all carry `"test": false`.
- A webhook test is signed like any real delivery.
- discoin.py parses `test` strictly, so an event without it is an error there. A migration adds `"test": false` to every stored payload that lacks it: `bot_events.payload` and `webhook_deliveries.payload`.

## Test records

New table `webhook_tests`, one row per click:

| Column | Meaning |
|---|---|
| `id` uuid PK | The test transaction ID sent in the event |
| `bot_id` uuid | Bot being tested |
| `owner_id` text | Owner who clicked, also the event's `userId` |
| `path` text | `webhook` or `feed` |
| `feed_event_id` bigint, nullable | Feed event number, feed path only |
| `submitted_at` timestamptz | Click time |
| `marked_status` text, nullable | `Completed` or `Refunded` once the bot marks it |
| `marked_at` timestamptz, nullable | When it was marked |

A test lives 10 minutes after `submitted_at`. Past that, every route treats it as unknown (404). The existing feed retention purge also deletes expired test rows.

## Routes

### `POST /bots/{botId}/webhook-test` (owner session, `OwnedBot`)

- Webhook URL set: send now, as today.
  - Unreachable: 502 `Discoin couldn't reach your webhook. <error>`. No test row is kept.
  - Non-2xx: 502 `Your webhook answered <status>. Discoin expects a 2xx answer.` No test row is kept.
  - 2xx: 202 `{"testId": "<id>", "path": "webhook"}`.
- No webhook URL: add the event to the bot's feed, store its event number, 202 `{"testId": "<id>", "path": "feed"}`.

### `GET /bots/{botId}/webhook-test/{testId}` (owner session, `OwnedBot`)

200 `{"state": ..., "path": ..., "markedStatus": ...}`:

| state | When |
|---|---|
| `waiting` | Feed path, the bot's acknowledged cursor is below the event number |
| `delivered` | Webhook answered 2xx, or the feed event is acknowledged, and not marked yet |
| `handled` | Bot marked it; `markedStatus` is `Completed` or `Refunded` |

`markedStatus` is null until handled. Unknown, expired or another bot's test: 404.

### `PATCH /transactions/{id}` (bot token) on a test

- The calling bot must be the test's bot, and the test must not be expired. Otherwise the existing 404 for an unknown transaction.
- `Completed` or `Refunded`: set `marked_status` and `marked_at`, return 200 `BotTransaction` with that status, `handledAt` set, and `fromCurrency` and `toCurrency` both `{"abbreviation": "TEST", "name": "Test", "removed": false}`. No balance, ledger, event or webhook change.
- Already marked: 400 `Only Pending transactions can be marked Completed or Refunded.` with field `status`, same as a real transaction.

Tests never appear in `/transactions/pending`, `/transactions/undone` or the transaction detail routes. `PUT /transactions/{id}/handled` on a test returns 404.

## Dashboard

The Test button:

1. Calls POST. A 502 shows its message as the failure right away.
2. On 202, shows a waiting state and polls GET every 2 seconds.
3. `handled`: success, naming the status the bot chose.
4. After 60 seconds without `handled`, failure:
   - last state `waiting`: `Your bot didn't read its event feed within 60 seconds.`
   - last state `delivered`: `Your bot got the test but didn't mark it Completed or Refunded within 60 seconds.`
5. A failed poll request shows its error and stops.

The waiting and result text must be announced to screen readers (WCAG 2.2 AA, existing axe e2e).

## Docs

The README event contract, the dashboard Docs page and the OpenAPI text drop `transaction.test`, describe `test`, the test flow above, and that a bot must check `test` before paying out.

## Out of scope

- Any change to real transaction flows besides adding `"test": false`.
- discoin.py, which builds against this once it ships.
