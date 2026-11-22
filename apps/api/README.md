# Discoin API

FastAPI and PostgreSQL. Run every task through nx from the repo root.

| Command | What it does |
| --- | --- |
| `npx nx run api:serve` | API on port 8000, reloading on changes |
| `npx nx run api:worker` | Webhook delivery worker |
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
| `bots` | API tokens and the bot endpoints |
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
- Changing a bot's owner clears its API token, webhook URL and webhook secret, and drops webhooks still waiting to be sent. Blocks stay.
- The API token, the webhook URL, the webhook secret, the blocked users and the pending list belong to the bot, under `/bots/{botId}/...`. The name, the abbreviation and the daily cap belong to each currency, under `/currencies/{currencyId}/...`.
- An owner block covers every currency of the bot. A blocked user can't convert into or out of any of them. Blocking cancels the user's Pending transactions into or out of any of the bot's currencies, and can reverse Completed ones: incoming means into one of the bot's currencies, outgoing means out of one, and both means either.
- A block made on a currency before it had a bot keeps applying to that currency until an admin assigns its bot, and then moves to the bot.

Bots send `Authorization: Bearer <token>`. The token identifies the bot, never a currency, so creating a transaction names the bot's own currency it converts from, even when the bot runs only one. The owner page shows the token once when it is generated, and only its hash is stored.

- `POST /transactions` with `{userId, fromCurrencyId, toCurrencyId, amount}` converts from `fromCurrencyId`, which must be one of the bot's currencies.
- `GET /transactions/pending` lists Pending transactions into any of the bot's currencies. Add `?currencyId=<id>` to list only that currency, which must be one of the bot's currencies.
- `PATCH /transactions/{id}` with `{status: "Completed" | "Refunded"}` settles one whose destination is one of the bot's currencies. A refund runs the payout back through the curve.
- A missing `fromCurrencyId` or a malformed `currencyId` is a 400 on that field, a currency that doesn't exist or was removed is a 404, and a currency of another bot, or of no bot, is a 403. A PATCH on a transaction into another bot's currency is a 403.
- A removed bot's token fails with the same 401 as an invalid token.

## Removing bots and currencies

Admins can remove a currency, or a bot together with all of its currencies. Removal can't be undone and there is no restore.

- Pending transactions into or out of the removed currencies are cancelled and refunded in the same database transaction as the removal. If any step fails, nothing is removed.
- Nothing is deleted. The rows are marked removed, so transactions, history and blocks stay exact. Any request about a removed bot or currency answers 404, and a removed bot's token stops working at once.
- A removed currency's abbreviation, and a removed bot's Discord ID, can be used again. The feeds tell the two apart through `fromCurrency` and `toCurrency`.
- Removing one currency still delivers its `transaction.cancelled` webhooks to its bot, along with any already waiting. Removing a bot clears its token and webhook and drops its waiting webhooks. Its blocks stay as history and stop applying.

## Webhooks

Each bot has one webhook URL and one secret. The worker posts each event to the webhook of the receiving currency's bot, so events for all of a bot's currencies go to the same URL; `fromCurrencyId` and `toCurrencyId` in the transaction tell them apart. The body is `{id, event, transaction, triggeredBy?}`, where `event` is `transaction.created`, `transaction.cancelled` or `transaction.reversed`. On events caused by a block, `triggeredBy` is `{kind: "admins"}` or `{kind: "owner", botId}`, naming the bot whose owner blocked the user.

Each request carries `Discoin-Signature: <hex>`. The hex is the HMAC SHA256 of the raw body with the bot's webhook secret. Check it before trusting the request.

The bot owner page has a Test button that sends one `transaction.test` event to the bot's saved URL, signed like a real one, with a made up transaction whose `fromCurrencyId` and `toCurrencyId` are both the nil UUID `00000000-0000-0000-0000-000000000000`. Nothing is saved and no coins move, so bots should check the signature and then ignore it. Resending a Pending transaction's webhook is open to the owner of the bot that receives it.

A failed delivery is retried up to 10 times, waiting 10 seconds and doubling each time, capped at 1 hour (about 2.4 hours in total). Then it stops, and the transaction stays as it is for the bot to poll. Webhooks only go to public https addresses.

## Known limits

- The rate limit lives in each API process. Behind the dashboard's nginx, every visitor shares nginx's address. To limit per visitor, start uvicorn with `--proxy-headers` and set `FORWARDED_ALLOW_IPS` to the proxy's address.
- The worker checks a webhook host's addresses before connecting, but DNS could change between the check and the connection.
- The worker sends one webhook at a time.
- Rotating `WEBHOOK_SECRET_KEY` makes every stored webhook secret unreadable, so owners would need to generate new ones.
- Two identical requests racing for the same block can hit a unique index and get a 500 instead of a 409. A race for the same abbreviation or bot Discord ID gets the usual 409 field error.
- If someone declines on Discord's consent screen, the callback answers 400 because `code` is missing.
