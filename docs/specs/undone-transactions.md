# Bot route for undone transactions

Status: approved by the owner on 2026-11-22.

**My reading of your answers:** `GET /transactions/undone` is a state list like `/transactions/pending`, not a time based one. It returns every undone transaction the bot has not yet marked handled, on the side the bot is on. The bot acts, marks it handled, and the item stops being listed. There is no `since`, no window and no cursor.

## What gets built
Two bot routes under `/transactions`:
- `GET /transactions/undone`: everything the bot still has to deal with after a transaction was undone. For a receiving bot, take the coins back. For a sending bot, give the user's coins back.
- `PUT /transactions/{transactionId}/handled`: the bot says it dealt with one item.

This is the catch up path for bots with a webhook and bots on the feed, and the only way any bot learns about a missed reversal or, on the sending side, about any refund, cancellation or reversal.

## Verified facts
- `undo_transaction` (apps/api/app/transactions/ledger.py) moves the reserves back, then sets `status`, `handled_at` and `block_id`. It is the only path to Refunded, Cancelled or Reversed. Pending becomes Cancelled and Completed becomes Reversed (`UNDO_STEPS` in apps/api/app/blocking/service.py). Currency deactivation also cancels (apps/api/app/admin/deactivation.py). Refunded comes only from the receiving bot's `PATCH /transactions/{id}`.
- Meaning per side, from the code (the coder confirms against README wording):
  - Receiving side: the bot pays the user the payout only when it marks Completed. Cancelled means the bot never paid, so there is nothing to claw back, but it must stop waiting. Reversed means it paid, so it takes the payout back.
  - Sending side: the bot takes the amount from its user before submitting. Refunded, Cancelled and Reversed all unwind the exchange, so the amount goes back to the user.
- Today only the receiving bot ever gets events and only about its own currency. The sending bot has no way to read a non pending transaction.
- No rule stops one bot running both currencies of a transaction (I found no check in app/transactions).
- Migrations on disk: 0001 to 0004 committed, `0005_bot_events.sql` uncommitted. The new one is `0006`.
- `handled_at` today holds the settle time. For undone rows it is the undo time (overwritten by `undo_transaction`), which is a usable ordering key.
- Amounts are JSON numbers (`JsonDecimal`, apps/api/app/core/models.py). The feed and webhook state (8 attempts, 1 to 64 minute waits, `/events` no longer 410) comes from your message; I did not need to depend on it. Nothing here touches delivery.
- Public `GET /transactions` and `GET /currencies/{id}/transactions` live in apps/api/app/transactions/routes.py. A single transaction GET lives in detail.py. `/undone` is one literal segment, `/{id}/handled` is two, so neither can be mistaken for `PATCH /{transaction_id}`, `/pending` or the public routes. The coder checks route order for `GET /undone` against any `GET /transactions/{id}`.

## Decisions (recommended)
- **Both sides in one list.** Which rows appear:

| Status | Receiving bot (into its currency) | Sending bot (from its currency) |
|---|---|---|
| Refunded | not listed (it set it itself) | listed: give the amount back to the user |
| Cancelled | listed: stop waiting, nothing to take back | listed: give the amount back |
| Reversed | listed: take the payout back from the user | listed: give the amount back |

- **Handled record, per transaction and per side:** two nullable timestamps on the transactions row, one for the receiving side and one for the sending side. Smallest storage that lets each bot handle the same transaction independently. Alternative rejected: a separate table, more moving parts for two flags.
- **Item:** `BotTransaction` unchanged. The bot sees which side it is on from `fromCurrencyId` and `toCurrencyId`, because it knows its own currencies. No `side` field.
- **One bot on both sides (a transfer between two of its own currencies):** listed once, as one item. One mark clears both sides. A single `side` field would force the bot to mark twice for one decision. The cost: the bot must do both jobs for that item (take payout back and give amount back), which the docs state.
- **Mark route:** `PUT /transactions/{transactionId}/handled`, 204 empty, idempotent. Alternative rejected: add a status to `PATCH /transactions/{id}`. That route is receiving side only, Pending only, and means "settle this", so a new meaning there confuses it. Another alternative, a body `POST /transactions/handled` with a list of ids, saves calls but adds batch rules; we can add it later.
- **Delivery counts as handled:** no. The list ignores webhook delivery and feed acks. Same as pending, and "delivered" does not mean "the bot acted". There are no sending side events, so automatic handling could only ever half work.
- **Inactive and removed currencies:** still listed. The labels carry the existing `removed` flag. The bot may still owe users coins.
- **Size:** `limit` 1 to 100, default 50, oldest undone first (`handledAt` then `id`). Marking handled is what moves the list on. A full batch means "handle these, then call again". A bot that never marks an item sees it first every call. The docs say: always mark every item you received, even if you can only log it. There is deliberately no cursor.

## Contract
Auth on both: Bearer bot token, existing 300 a minute per token.

**`GET /transactions/undone`**
- Query: `currencyId` (optional, one of the bot's own currencies, same rules and errors as `/pending`, matches either side), `limit` (optional, 1 to 100, default 50).
- Response 200: array of `BotTransaction`, oldest undone first. Empty array when nothing is owed. Never contains a transaction where the caller's bot is neither side.
- Errors: 401 bad or missing token. 400 bad `limit` or `currencyId`. 403 or the error `/pending` gives for a currency not run by this bot.

**`PUT /transactions/{transactionId}/handled`**
- No body. 204 on success, and 204 again on a repeat.
- 401 bad token. 404 unknown transaction. 403 the bot is neither side of it. 400 the transaction is not in an undone state for the bot's side (for example still Pending or Completed, or Refunded where the bot is only the receiver). The same 400 rule as for the list. Validation errors are 400, matching the rest of the API.

**Receiving bot example**
```
GET /transactions/undone
200
[{"id":"9f1c...","userId":"123456789012345678","fromCurrencyId":"1a...","toCurrencyId":"2b...","amount":100.0,"payout":92.4,"status":"Reversed","submittedAt":"2026-11-21T08:00:00Z","handledAt":"2026-11-21T09:30:00Z","fromCurrency":{...},"toCurrency":{...}}]
```
`toCurrencyId` is the bot's own: take 92.4 back from the user, then `PUT /transactions/9f1c.../handled`.

**Sending bot example**
```
GET /transactions/undone?currencyId=1a...
200
[{"id":"a2b7...","userId":"123456789012345678","fromCurrencyId":"1a...","toCurrencyId":"3c...","amount":50.0,"payout":47.1,"status":"Refunded","submittedAt":"2026-11-21T08:10:00Z","handledAt":"2026-11-21T08:12:00Z","fromCurrency":{...},"toCurrency":{...}}]
```
`fromCurrencyId` is the bot's own: give 50.0 back to the user, then `PUT /transactions/a2b7.../handled`.

## Data model and migration
`apps/api/migrations/0006_undone_handled.sql`: two nullable timestamptz columns on `transactions`, one per side, and whatever index keeps the "undone and not handled" lookup cheap (coder's call). The owner says no undone transactions exist yet, so the migration adds the columns only and does no backfill.

## File by file, in build order
1. apps/api/migrations/0006_undone_handled.sql.
2. apps/api/app/transactions/queries.py: list function reusing `TRANSACTION_COLUMNS_WITH_USER` and `CURRENCY_JOINS`, like the pending list.
3. apps/api/app/bots/routes.py: both routes, reusing `require_bot_currency` for `currencyId`. Pay attention to route order and the lock used by `lock_pending`.
4. apps/api/tests (below), including apps/api/tests/core/test_migrations.py if it lists migrations.
5. apps/frontend/src/pages/Docs/endpoints.ts and index.tsx: both routes, the table above, and the loop (read, act, mark). `apps/api/tests/core/test_docs.py` must pass.
6. apps/api/README.md: bot contract and the catch up guidance.
7. apps/frontend/src/mocks/api.ts and tests, only if the docs page needs them.

No UI beyond the docs page. WCAG 2.2 AA applies to anything added there.

## Tests (apps/api/tests/bots)
- Receiving: Cancelled and Reversed listed; Refunded, Completed and Pending not.
- Sending: Refunded, Cancelled and Reversed listed; Completed and Pending not.
- One bot on both sides: item listed once, one mark clears it for both.
- Two bots: each marks its own side independently; one marking does not hide the item from the other.
- A bot never sees or marks a transaction it is not on (403 on mark, absent from list).
- `PUT` idempotent; 400 for a transaction not undone on the caller's side; 404 unknown; 403 foreign.
- Handled items disappear; order is oldest first; `limit` and the "call again after a full batch" loop drain the list.
- `currencyId` filter on either side; foreign and unknown currency errors same as `/pending`.
- Inactive or removed currency still listed with `removed` flag.
- Same behaviour for a bot with a webhook and a bot on the feed; an acked or delivered event does not hide the item.
- Migration: the migration adds the two columns as nullable and leaves existing rows untouched.
- Route order: `/pending`, `/undone`, public `/transactions` and `/transactions/{id}` and `PATCH /{id}` still resolve.

## Checks (run in a Haiku subagent, through nx with npx, never pnpm)
API lint and tests, frontend lint and tests, the docs drift test. Frontend e2e only if the docs page changes need it.

## What discoin.py needs
- `get_undone_transactions(currency_id=None, limit=None)` and `mark_transaction_handled(transaction_id)`.
- Call on start next to `GET /transactions/pending`, then on the same polling timer (about once a minute is enough while webhook or feed delivery is healthy). On a full batch, handle it and call again straight away.
- Pay only once per item: take the transaction id from `fromCurrencyId` and `toCurrencyId` to find your side. Do the money move, persist that you did it, then `PUT .../handled`. Marking is idempotent, so a crash between the two is safe as long as the bot checks its own record before moving money again. Always mark items you cannot act on, or the list will keep returning them.
- Webhook and feed events for the same transaction still arrive. Dedupe on transaction id plus status, with the same record as above.

## Rules to pass to the coder
- Shortest diff that works. No new abstractions without a second user; reuse the pending list query code. No unrelated edits.
- No silent fallbacks: no default values for required data, no catch and continue, no "use X if missing". If something fails, let it fail with the proper error.
- No comments unless the code looks wrong but is deliberate (one line of why). No change narration, no TODOs.
- Blank line spacing in every language: a `return` is separated from code above by a blank line (except a guard return directly under an `if`, or a function whose whole body is one return). Loops and multi line ifs get a blank line above and below, except where they open or close the enclosing block, or when the value they iterate or test is defined on the line right above (then the blank line goes before that definition).
- No em or en dashes in UI text, docs or README.
- No self attribution anywhere. Do not commit.
- npm, never pnpm. Run tasks through nx with npx.
- Frontend must meet WCAG 2.2 AA.

## Decisions by the owner
1. Existing undone rows when this ships: asked what the migration should do with transactions that were already Refunded, Cancelled or Reversed, the owner answered "theres none". The migration only adds the two per side handled timestamps and the index the lookup needs. It does no backfill, no data update and has no cutoff.
2. A delivered webhook or an acknowledged feed event does not count as handled. The list ignores delivery, and the bot marks each item handled itself.
3. One bot on both sides of a transaction gets one item in the list, and one mark clears both sides.
4. The mark route takes one transaction id per call, `PUT /transactions/{transactionId}/handled`. There is no batch form.
5. On owner change and bot removal, unhandled items are kept. Nothing marks them handled on owner change or removal, and token regeneration keeps them too. The other bot's side is never touched by any of this.
