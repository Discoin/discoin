CREATE TABLE users (
    id text PRIMARY KEY CHECK (id ~ '^[0-9]{17,20}$'),
    username text,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE currencies (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    abbreviation text NOT NULL CHECK (abbreviation ~ '^[A-Z]{3,4}$'),
    owner_id text NOT NULL CHECK (owner_id ~ '^[0-9]{17,20}$'),
    worth numeric(16, 2) NOT NULL DEFAULT 100000 CHECK (worth > 0),
    reserve numeric(16, 2) NOT NULL CHECK (reserve > 0),
    weekly_median numeric(16, 2) NOT NULL CHECK (weekly_median > 0),
    daily_cap numeric(16, 2) CHECK (daily_cap > 0),
    webhook_url text,
    webhook_secret_sealed text,
    api_token_hash text UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX currencies_abbreviation ON currencies (abbreviation);

CREATE TABLE currency_history (
    id bigserial PRIMARY KEY,
    currency_id uuid NOT NULL REFERENCES currencies (id),
    reserve numeric(16, 2) NOT NULL CHECK (reserve > 0),
    value numeric NOT NULL,
    recorded_at timestamptz NOT NULL
);

CREATE INDEX currency_history_currency_recorded_at ON currency_history (currency_id, recorded_at);

CREATE TABLE blocks (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL CHECK (user_id ~ '^[0-9]{17,20}$'),
    currency_id uuid REFERENCES currencies (id),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    blocked_by text NOT NULL,
    blocked_at timestamptz NOT NULL,
    unblocked_by text,
    unblocked_at timestamptz,
    CHECK ((unblocked_by IS NULL) = (unblocked_at IS NULL))
);

CREATE UNIQUE INDEX blocks_active_currency ON blocks (user_id, currency_id)
    WHERE currency_id IS NOT NULL AND unblocked_at IS NULL;

CREATE UNIQUE INDEX blocks_active_global ON blocks (user_id)
    WHERE currency_id IS NULL AND unblocked_at IS NULL;

CREATE TABLE transactions (
    id uuid PRIMARY KEY,
    user_id text NOT NULL CHECK (user_id ~ '^[0-9]{17,20}$'),
    from_currency_id uuid NOT NULL REFERENCES currencies (id),
    to_currency_id uuid NOT NULL REFERENCES currencies (id),
    amount numeric(16, 2) NOT NULL CHECK (amount > 0),
    payout numeric(16, 2) NOT NULL CHECK (payout > 0),
    status text NOT NULL CHECK (status IN ('Pending', 'Completed', 'Cancelled', 'Refunded', 'Reversed')),
    submitted_at timestamptz NOT NULL,
    handled_at timestamptz,
    block_id bigint REFERENCES blocks (id),
    CHECK (from_currency_id <> to_currency_id),
    CHECK ((status = 'Pending') = (handled_at IS NULL))
);

CREATE INDEX transactions_submitted_at ON transactions (submitted_at DESC);
CREATE INDEX transactions_user_submitted_at ON transactions (user_id, submitted_at DESC);
CREATE INDEX transactions_from_currency ON transactions (from_currency_id, submitted_at DESC);
CREATE INDEX transactions_to_currency ON transactions (to_currency_id, status, submitted_at DESC);

CREATE TABLE webhook_deliveries (
    id bigserial PRIMARY KEY,
    transaction_id uuid NOT NULL REFERENCES transactions (id),
    currency_id uuid NOT NULL REFERENCES currencies (id),
    event text NOT NULL CHECK (event IN ('created', 'cancelled', 'reversed', 'resend')),
    payload jsonb NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'exhausted')),
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    last_status integer,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);

CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE state = 'pending';
