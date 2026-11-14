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
| `admin` | Currency administration, admins, the first admin seed and deactivation |

`app/main.py` builds the app with `create_app()` and includes each feature's router.

The API applies migrations from `migrations/` when it starts. Migrations are numbered `.sql` files that only move forward. Add a new file for each change and never edit one that has been applied.

## Settings

Every setting is required. The API refuses to start when one is missing or malformed.

| Variable | Used by | Value |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, seed, tests | PostgreSQL connection URL |
| `FIRST_ADMIN_ID` | API | Discord user ID made admin when no admin exists |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API | From the Discord developer portal |
| `DISCORD_REDIRECT_URI` | API | The API's `/auth/discord/callback` URL, registered in the portal |
| `FRONTEND_URL` | API | Where the dashboard is served. Its origin is the only one allowed by CORS and for logged in writes |
| `WEBHOOK_SECRET_KEY` | API, worker | 32 random bytes in base64, used to encrypt webhook secrets at rest |
| `SEED_OWNER_ID` | seed | Discord user ID that owns the sample currencies |

Make a key with `python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"`.

For tests, start a throwaway database and point `DATABASE_URL` at it:

```
docker run -d --name discoin-api-test-pg -e POSTGRES_USER=discoin -e POSTGRES_PASSWORD=discoin -e POSTGRES_DB=discoin -p 55432:5432 postgres:latest
DATABASE_URL=postgresql://discoin:discoin@localhost:55432/discoin npx nx run api:test
```

Each test works in its own schema and drops it afterwards.

## Conventions

- Errors are `{status, message, field}`, with `field` set to the input at fault or `null`. Over the daily cap, the 400 also carries `maxAmount`.
- Money is a JSON number with at most 2 decimals.
- A currency code (abbreviation) is exactly 3 or 4 letters A to Z. It is stored in capitals and looked up in any case.
- `GET /auth/discord/login?next=/owner` returns the user to that page after login. `next` must be a path on the dashboard that starts with a single `/`; anything else (`//`, a scheme, backslashes, control characters) is a 400 on `next`.
- `GET /currencies` lists active currencies. Add `?includeInactive=true` to get every currency, for naming the currencies in old transactions.
- Transaction lists take `limit` (1 to 100, default 50) and `before`, the ID of the last transaction already shown.
- Logged in writes (POST, PUT, PATCH, DELETE with the session cookie) must send the dashboard's `Origin`.
- Requests are limited to 1200 a minute per client address and 300 a minute per credential. Over the limit, the API answers 429 with `Retry-After`.
- The OpenAPI document is at `/openapi.json` and the docs at `/docs`.

## Bots

Bots send `Authorization: Bearer <token>`. The owner page shows the token once when it is generated, and only its hash is stored.

- `POST /transactions` with `{userId, toCurrencyId, amount}` converts from the bot's currency.
- `GET /transactions/pending` lists Pending transactions into the bot's currency.
- `PATCH /transactions/{id}` with `{status: "Completed" | "Refunded"}` settles one. A refund runs the payout back through the curve.

## Webhooks

The worker posts each event to the receiving currency's webhook URL. The body is `{id, event, transaction, triggeredBy?}`, where `event` is `transaction.created`, `transaction.cancelled` or `transaction.reversed`, and `triggeredBy` says whether Discoin admins or a currency's owner caused a block.

Each request carries `Discoin-Signature: t=<unix seconds>,v1=<hex>`. The hex is the HMAC SHA256 of `<t>.<raw body>` with the currency's webhook secret. Check it, and reject old timestamps.

The bot owner page has a Test button that sends one `transaction.test` event to the saved URL, signed like a real one, with a made up transaction. Nothing is saved and no coins move, so bots should check the signature and then ignore it.

A failed delivery is retried up to 10 times, waiting 10 seconds and doubling each time, capped at 1 hour (about 2.4 hours in total). Then it stops, and the transaction stays as it is for the bot to poll. Webhooks only go to public https addresses.

## Known limits

- The rate limit lives in each API process. Behind the dashboard's nginx, every visitor shares nginx's address. To limit per visitor, start uvicorn with `--proxy-headers` and set `FORWARDED_ALLOW_IPS` to the proxy's address.
- The worker checks a webhook host's addresses before connecting, but DNS could change between the check and the connection.
- The worker sends one webhook at a time.
- Rotating `WEBHOOK_SECRET_KEY` makes every stored webhook secret unreadable, so owners would need to generate new ones.
- Two identical requests racing (same abbreviation, same block) can hit a unique index and get a 500 instead of a 409.
- If someone declines on Discord's consent screen, the callback answers 400 because `code` is missing.
