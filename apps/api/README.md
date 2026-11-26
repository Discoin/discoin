# Discoin API

FastAPI and PostgreSQL. Run every task through nx from the repo root.

| Command | What it does |
| --- | --- |
| `npx nx run api:serve` | API on port 8000, reloading on changes |
| `npx nx run api:worker` | Webhook delivery worker, which also deletes expired feed events and webhook tests |
| `npx nx run api:seed` | Adds five sample currencies with a month of history |
| `npx nx run api:test` | pytest against a real PostgreSQL |
| `npx nx run api:lint` and `api:format-check` | ruff |

## Layout

The code in `app/` is split by feature. Each feature keeps its routes next to its logic, and `tests/` mirrors the same folders.

| Module | Holds |
| --- | --- |
| `core` | Settings, database access, errors, models shared by every feature, validation, logging, migrations, rate limits, OpenAPI and secret encryption |
| `currencies` | The bonding curve, currency reads, history, the quote endpoint and the sample data seed |
| `transactions` | Creating and undoing transactions (`ledger`), exchange checks, paged lists and the public feed |
| `auth` | Discord login and sessions |
| `me` | The logged in user and their transactions |
| `bots` | API tokens, the bot endpoints and the event feed |
| `webhooks` | Signing, the delivery queue, the worker and the public address check |
| `owners` | Owner access and the bot owner settings |
| `blocking` | Owner and admin blocks, previews and reversals |
| `admin` | Currency and bot administration, bot assignment, removal, admins, the first admin seed and deactivation |

`app/main.py` builds the app with `create_app()` and includes each feature's router.

The API applies migrations from `migrations/` when it starts. Migrations are numbered `.sql` files that only move forward. Add a new file for each change and never edit one that has been applied.

## Settings

Every setting is required. The API refuses to start when one is missing or malformed.

| Variable | Used by | Value |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, seed, tests | PostgreSQL connection URL |
| `FIRST_ADMIN_IDS` | API | Comma separated Discord user IDs, like `123456789012345678,234567890123456789`. All of them become admins together, only while no admin exists. Later changes to the list are ignored, so use the Admins page instead |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API | From the Discord developer portal |
| `DISCORD_REDIRECT_URI` | API | The API's `/auth/discord/callback` URL, registered in the portal |
| `FRONTEND_URL` | API | Where the dashboard is served. Its origin is the only one allowed by CORS and for logged in writes |
| `WEBHOOK_SECRET_KEY` | API, worker | 32 random bytes in base64, used to encrypt webhook secrets at rest |
| `SEED_OWNER_ID` | seed | Discord user ID that owns the sample bots, one per sample currency |

Make a key with `python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"`.

For tests, start a throwaway database and point `DATABASE_URL` at it:

```
docker run -d --name discoin-api-test-pg -e POSTGRES_USER=discoin -e POSTGRES_PASSWORD=discoin -e POSTGRES_DB=discoin -p 55432:5432 postgres:latest
DATABASE_URL=postgresql://discoin:discoin@localhost:55432/discoin npx nx run api:test
```

Each test works in its own schema and drops it afterwards.

## Deploying the bots release

Migration `0004_bots.sql` moves owners, API tokens and webhooks from currencies to bots. It invents no bots, so read this before deploying.

1. After the migration the database no longer knows who owned which currency. Every currency has no bot, and every owner loses the Bot owner page and its link until an admin registers their bot and assigns their currencies.
2. Every API token, webhook URL and webhook secret is dropped, and webhooks still waiting to be sent are marked dropped. Every integrated bot stops working until an admin registers the bot, an admin assigns its currencies, and the owner generates a new token and sets a webhook on the Bot owner page.
3. Assigning a bot merges the blocks of its currencies with no warning. A user blocked on one currency becomes blocked on all of that bot's currencies.
4. The database has no bot names or bot Discord IDs. Ask each owner for them before registering their bot.

Before deploying, save who owned what. This is the only record of it after the migration, and the migration has no safety net. Run this read only query against the production database and keep the file:

```
docker compose exec -T db psql -U discoin -d discoin -c "\copy (SELECT id, abbreviation, name, owner_id FROM currencies ORDER BY abbreviation) TO STDOUT WITH CSV HEADER" > currency-owners-before-bots.csv
```

Use your own `POSTGRES_USER` and `POSTGRES_DB` if they differ from `discoin`. Check that the file has one line per currency before you deploy.

Tell every bot integrator what changes for them:

1. Their old API token stops working. They generate a new one on the Bot owner page, once an admin has registered their bot.
2. `POST /transactions` now needs `fromCurrencyId`, the bot's own currency the user converts from, next to `toCurrencyId`.
3. `GET /transactions/pending` takes an optional `?currencyId=`, the bot's own currency to list. Without it, the list covers all of the bot's currencies.
4. A bot with several currencies uses one token and one webhook for all of them, and names the currency when it creates a transaction.

## Conventions

- Errors are `{status, message, field}`, with `field` set to the input at fault or `null`. Over the daily cap, the 400 also carries `maxAmount`.
- Money is a JSON number with at most 2 decimals.
- A currency code (abbreviation) is exactly 3 or 4 letters A to Z. It is stored in capitals and looked up in any case.
- `GET /auth/discord/login?next=/owner` returns the user to that page after login. `next` must be a path on the dashboard that starts with a single `/`; anything else (`//`, a scheme, backslashes, control characters) is a 400 on `next`.
- `GET /currencies` lists active currencies only. Inactive and removed currencies are never listed, and `GET /currencies/{abbreviation}`, `/currencies/{id}/history` and `/currencies/{id}/transactions` answer 404 for them.
- Every transaction carries `fromCurrency` and `toCurrency`, each `{abbreviation, name, removed}`, next to the two IDs. A removed currency's abbreviation can belong to a newer currency, so show the name for any side with `removed: true`.
- Transaction lists take `limit` (1 to 100, default 50) and `before`, the ID of the last transaction already shown.
- Logged in writes (POST, PUT, PATCH, DELETE with the session cookie) must send the dashboard's `Origin`.
- Requests are limited to 1200 a minute per client address and 300 a minute per credential. Over the limit, the API answers 429 with `Retry-After`.
- The OpenAPI document is at `/openapi.json`, for tooling. The API serves no Swagger UI or Redoc page. The docs for bot developers are a page on the dashboard at `/docs`, written by hand in `apps/frontend/src/pages/Docs/endpoints.ts`. `tests/core/test_docs.py` fails when a public route is missing from that page, or when the page lists a route that no longer exists.

## Bots and owners

A bot is a name, its Discord bot user ID and the Discord ID of its one owner. Admins register bots on the Admin page; Discoin never guesses them. A bot runs zero or more currencies, and an owner can have several bots. The owner of a currency is the owner of its bot, and only that person sees the currency on the Bot owner page.

- Every new currency needs a bot. A currency made before bots existed starts without one, and an admin picks its bot once from the edit form. After that the bot never changes and can't be cleared; the API answers 409 to any try, even with the same bot.
- When a currency gets its bot, the currency's blocks move to the bot. Two currencies with different block lists on one bot merge, so a user blocked on one of them becomes blocked on all of the bot's currencies. If a user is blocked on both, the earliest block stays and the other is closed with `merged_into` pointing at it. Nothing is deleted.
- A currency without a bot still trades. Its transactions are created Pending as usual, with the daily cap and reserves applied, but no webhook is sent because there is no bot to send it to. Once the bot is assigned, they show in the owner's pending list and in `GET /transactions/pending` for that currency. Nothing is sent afterwards for them, since a new bot has no webhook yet.
- Changing a bot's owner clears its API token, webhook URL and webhook secret, drops webhooks still waiting to be sent and deletes its feed events. Blocks stay.
- The API token, the webhook URL, the webhook secret, the blocked users and the pending list belong to the bot, under `/bots/{botId}/...`. The name, the abbreviation and the daily cap belong to each currency, under `/currencies/{currencyId}/...`.
- An owner block covers every currency of the bot. A blocked user can't convert into or out of any of them. Blocking cancels the user's Pending transactions into or out of any of the bot's currencies, and can reverse Completed ones: incoming means into one of the bot's currencies, outgoing means out of one, and both means either.
- A block made on a currency before it had a bot keeps applying to that currency until an admin assigns its bot, and then moves to the bot.

Bots send `Authorization: Bearer <token>`. The token identifies the bot, never a currency, so creating a transaction names the bot's own currency it converts from, even when the bot runs only one. The owner page shows the token once when it is generated, and only its hash is stored.

- `POST /transactions` with `{userId, fromCurrencyId, toCurrencyId, amount}` converts from `fromCurrencyId`, which must be one of the bot's currencies.
- `GET /transactions/pending` lists Pending transactions into any of the bot's currencies. Add `?currencyId=<id>` to list only that currency, which must be one of the bot's currencies.
- `PATCH /transactions/{id}` with `{status: "Completed" | "Refunded"}` settles one whose destination is one of the bot's currencies. A refund runs the payout back through the curve.
- `GET /transactions/undone` lists the undone transactions the bot has not marked handled, and `PUT /transactions/{id}/handled` marks one. See Undone transactions below.
- A missing `fromCurrencyId` or a malformed `currencyId` is a 400 on that field, a currency that doesn't exist or was removed is a 404, and a currency of another bot, or of no bot, is a 403. A PATCH on a transaction into another bot's currency is a 403.
- A removed bot's token fails with the same 401 as an invalid token.

## Undone transactions

A transaction is undone when it becomes Refunded, Cancelled or Reversed. `GET /transactions/undone` is a state list like `/transactions/pending`: it returns every undone transaction the calling bot has not marked handled, on whichever side the bot is on. The bot acts on each one, marks it with `PUT /transactions/{id}/handled`, and it stops being listed.

This list, not the event feed and not webhooks, is how a bot recovers a reversal it missed. It is also the only way a sending bot ever learns that its transaction was refunded, cancelled or reversed, because events only go to the receiving bot.

| Status | Receiving bot (into its currency) | Sending bot (out of its currency) |
| --- | --- | --- |
| Refunded | Not listed, the bot refunded it itself | Listed: give the amount back to the user |
| Cancelled | Listed: stop waiting, the bot never paid | Listed: give the amount back to the user |
| Reversed | Listed: take the payout back from the user | Listed: give the amount back to the user |

- Items are the same shape as in `/transactions/pending`. The bot finds its side by comparing `fromCurrencyId` and `toCurrencyId` with its own currencies. A side belongs to the bot that runs that currency now.
- The list is oldest undone first, by `handledAt` then `id`. `limit` is 1 to 100 and defaults to 50. There is no cursor and no `before`: marking is what moves the list on. A full batch means more can be waiting, so the bot marks the batch and calls again. A transaction that is never marked comes back first on every call, so a bot marks every item, even one it can only log.
- `?currencyId=<id>` keeps only transactions where that currency is the bot's side. It follows the rules of `/transactions/pending`: 400 when malformed, 404 when unknown or removed, 403 when another bot's.
- Transactions of inactive and removed currencies stay listed, with `removed: true` on that side. Since the filter answers 404 for a removed currency, a bot reads them without `currencyId`.
- A bot that runs both currencies of a transaction gets one item, and one mark clears both sides. It does both jobs: take the payout back and give the amount back.
- `PUT /transactions/{id}/handled` takes no body and answers 204. A repeat answers 204 and keeps the first time. It is a 404 for an unknown transaction, a 403 when the bot runs neither currency, and a 400 when the transaction is not undone on the bot's side: still Pending or Completed, or Refunded for a bot that only receives it. The list and the mark use one rule, so anything listed can be marked.
- Each side has its own mark. One bot marking a transaction never hides it from the other bot.
- A delivered webhook and an acknowledged feed event mark nothing. A bot that already acted on a `transaction.cancelled` or `transaction.reversed` event still finds the transaction here, so it keeps its own record of transaction ID and status, moves coins once, then marks.
- A bot reads the list when it starts, next to `/transactions/pending`, and then about once a minute.
- Marks belong to the transaction, not to the token or the owner. A regenerated token, a new owner and a removed bot leave them as they are, so a new owner starts with the old owner's unhandled items.

The marks are two nullable columns on `transactions`, `receiver_handled_at` and `sender_handled_at`. Marking is one row update that only fills an empty column, so it takes no currency lock and two racing marks keep the first time.

## Removing bots and currencies

Admins can remove a currency, or a bot together with all of its currencies. Removal can't be undone and there is no restore.

- Pending transactions into or out of the removed currencies are cancelled and refunded in the same database transaction as the removal. If any step fails, nothing is removed.
- Nothing is deleted. The rows are marked removed, so transactions, history and blocks stay exact. Any request about a removed bot or currency answers 404, and a removed bot's token stops working at once.
- A removed currency's abbreviation, and a removed bot's Discord ID, can be used again. The feeds tell the two apart through `fromCurrency` and `toCurrency`.
- Removing one currency still delivers its `transaction.cancelled` webhooks to its bot, along with any already waiting. Removing a bot clears its token and webhook, drops its waiting webhooks and deletes its feed events. Its blocks stay as history and stop applying.

## Webhooks

Each bot has one webhook URL and one secret. The worker posts each event to the webhook of the receiving currency's bot, so events for all of a bot's currencies go to the same URL; `fromCurrencyId` and `toCurrencyId` in the transaction tell them apart. The body is `{id, event, test, transaction, triggeredBy?}`, where `event` is `transaction.created`, `transaction.cancelled` or `transaction.reversed`, and `test` is `false` on every real event and `true` only on a test sent from the Bot owner page. A bot must check `test` before paying out. On events caused by a block, `triggeredBy` is `{kind: "admins"}` or `{kind: "owner", botId}`, naming the bot whose owner blocked the user.

Each request carries `Discoin-Signature: <hex>`. The hex is the HMAC SHA256 of the raw body with the bot's webhook secret. Check it before trusting the request.

Resending a Pending transaction's webhook is open to the owner of the bot that receives it. For a bot with no webhook URL, Resend writes the event to its event feed instead.

## Webhook test

The Test button on the Bot owner page checks the whole round trip: the bot gets a `transaction.created` event with `"test": true`, and the test passes once the bot marks the test transaction with `PATCH /transactions/{id}`.

- The event has the body of a real one, signed the same way on a webhook. Its transaction is made up: a new ID for each test, the owner's Discord ID as `userId`, the nil UUID `00000000-0000-0000-0000-000000000000` as `fromCurrencyId` and `toCurrencyId`, amount 100, payout 10, status Pending. On a webhook, its delivery `id` is 0.
- A bot that ignores `test` pays out on a test. No coins move on Discoin's side, so the bot would be giving its own coins away.
- `POST /bots/{botId}/webhook-test` answers 202 `{testId, path}`. With a webhook URL, `path` is `webhook` and the event is sent before the route answers. An unreachable webhook or an answer that is not 2xx is a 502 with the reason, and no test is kept. Without a webhook URL, `path` is `feed` and the event is added to the bot's event feed.
- `GET /bots/{botId}/webhook-test/{testId}` answers `{state, path, markedStatus}`. `state` is `waiting` while a feed test's event is above the bot's acknowledged cursor, `delivered` once the webhook answered 2xx or the feed event is acknowledged, and `handled` once the bot marked the test. `markedStatus` is `Completed` or `Refunded` once handled, and null before.
- `PATCH /transactions/{id}` on a test, by the tested bot, answers 200 with the test as a transaction: the chosen status, `handledAt` set, and `fromCurrency` and `toCurrency` both `{abbreviation: "TEST", name: "Test", removed: false}`. Balances, the ledger, events and webhooks are left alone. A second PATCH is the usual 400 on `status`.
- A test lives 10 minutes. After that, and for any other bot, both routes answer 404, the same as for an unknown ID.
- A test is never a transaction: it is not in `/transactions/pending`, `/transactions/undone` or the transaction detail routes, and `PUT /transactions/{id}/handled` answers 404 for it.
- The dashboard polls the GET route every 2 seconds for 60 seconds, then reports the step that failed: the bot never read its feed, or it got the test and never marked it.

Tests are rows in `webhook_tests`, which the worker deletes once they expire. On the webhook path the row is committed before the request is sent, so a bot that marks the test while it handles the webhook finds it, and the row is deleted again when the delivery fails. Marking a test locks only its own row, never a currency or a feed.

A delivery gets 8 attempts: the first one and up to 7 retries, waiting 1 minute and doubling each time (1, 2, 4, 8, 16, 32 and 64 minutes, about 2 hours in total). Then it stops, and the transaction stays as it is for the bot to poll with `GET /transactions/pending` and `GET /transactions/undone`. Webhooks only go to public https addresses.

## Event feed

A bot with no public address polls for its events instead. A bot uses a webhook or the event feed, never both. Each event is written to one place, chosen when it happens: the webhook queue if the receiving bot has a webhook URL at that moment, the bot's feed if it has none. That holds for `transaction.created`, `transaction.cancelled`, `transaction.reversed`, a resend and a test.

- `GET /events?after=<id>&limit=<n>` answers `{events: [...]}` in `id` order. Each event has the webhook body, `{id, event, test, transaction, triggeredBy?}`, where `id` counts up per bot. Without `after`, the list starts after the bot's acknowledged cursor; `after` never moves the cursor. `limit` is 1 to 100 and defaults to 100. A full batch means more are waiting.
- `POST /events/ack` with `{id}` moves the cursor forward to `id` and answers 204. An `id` at or below the cursor changes nothing. An `id` above the bot's newest event is a 400.
- While the bot has a webhook URL, both routes answer 409: `This bot has a webhook URL, so its events go to the webhook. Remove the URL on the Bot owner page to read events here.` A client should stop instead of retrying.
- Checks run in this order: 401 for the token, 409 for the webhook URL, then 422 for `after` or `limit`.
- Events are kept for 24 hours, then the worker deletes them, read or not. There is no error for that: `GET /events` returns whatever is still stored after the starting point. A bot that was offline for more than 24 hours gets no notice that older events are gone, so it reads `GET /transactions/pending` and `GET /transactions/undone` when it starts to catch up. Acknowledging the ID of a deleted event still works.
- Saving a webhook URL deletes the bot's stored events and moves the cursor to its newest event ID, in the same database transaction. The deleted events are not sent to the webhook. IDs are never used twice for a bot.
- Removing the webhook URL makes the feed work again, starting empty. Events already queued for the webhook stay there and fail with `The webhook URL was removed.` until they run out of retries.
- In both directions, `GET /transactions/pending` and `GET /transactions/undone` are how a bot catches up.
- A bot can get an event twice, after stopping between handling and acknowledging, or after a resend. Bots should skip a transaction ID and event name they already handled.
- A bot should poll about every 2 seconds, handle events in order, then acknowledge the highest ID it handled. On start it reads `GET /transactions/pending` and `GET /transactions/undone` first, since the feed only goes back 24 hours.
- A regenerated API token keeps the cursor and the unread events. Changing the bot's owner or removing the bot deletes its events.

Each bot has one row in `bot_feeds` holding its event counter and cursor. Every event write for a bot locks that row until its transaction commits, after all currency and transaction row locks, and in bot ID order when one request writes for several bots. A reader therefore never sees an event before one with a lower ID. The webhook URL is read under the same lock, so an event racing a URL change still takes one path.

## Known limits

- The rate limit lives in each API process. Behind the dashboard's nginx, every visitor shares nginx's address. To limit per visitor, start uvicorn with `--proxy-headers` and set `FORWARDED_ALLOW_IPS` to the proxy's address.
- The worker checks a webhook host's addresses before connecting, but DNS could change between the check and the connection.
- The worker sends one webhook at a time.
- Rotating `WEBHOOK_SECRET_KEY` makes every stored webhook secret unreadable, so owners would need to generate new ones.
- Two identical requests racing for the same block can hit a unique index and get a 500 instead of a 409. A race for the same abbreviation or bot Discord ID gets the usual 409 field error.
- If someone declines on Discord's consent screen, the callback answers 400 because `code` is missing.
