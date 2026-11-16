CREATE TABLE bots (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    discord_id text NOT NULL CHECK (discord_id ~ '^[0-9]{17,20}$'),
    owner_id text NOT NULL CHECK (owner_id ~ '^[0-9]{17,20}$'),
    api_token_hash text UNIQUE,
    webhook_url text,
    webhook_secret_sealed text,
    removed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bots_removed_have_no_credentials
        CHECK (removed_at IS NULL OR (api_token_hash IS NULL AND webhook_url IS NULL AND webhook_secret_sealed IS NULL))
);

CREATE UNIQUE INDEX bots_discord_id ON bots (discord_id) WHERE removed_at IS NULL;

ALTER TABLE currencies
    ADD COLUMN bot_id uuid REFERENCES bots (id),
    ADD COLUMN removed_at timestamptz,
    ADD CONSTRAINT currencies_removed_are_inactive CHECK (removed_at IS NULL OR NOT active),
    DROP COLUMN owner_id,
    DROP COLUMN webhook_url,
    DROP COLUMN webhook_secret_sealed,
    DROP COLUMN api_token_hash;

CREATE INDEX currencies_bot ON currencies (bot_id);

DROP INDEX currencies_abbreviation;
CREATE UNIQUE INDEX currencies_abbreviation ON currencies (abbreviation) WHERE removed_at IS NULL;

ALTER TABLE blocks
    ADD COLUMN bot_id uuid REFERENCES bots (id),
    ADD COLUMN merged_into bigint REFERENCES blocks (id),
    ADD CONSTRAINT blocks_one_scope CHECK (currency_id IS NULL OR bot_id IS NULL),
    ADD CONSTRAINT blocks_merged_are_closed CHECK (merged_into IS NULL OR unblocked_at IS NOT NULL);

DROP INDEX blocks_active_global;
CREATE UNIQUE INDEX blocks_active_global ON blocks (user_id)
    WHERE currency_id IS NULL AND bot_id IS NULL AND unblocked_at IS NULL;

CREATE UNIQUE INDEX blocks_active_bot ON blocks (user_id, bot_id)
    WHERE bot_id IS NOT NULL AND unblocked_at IS NULL;

ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_state_check;
ALTER TABLE webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_state_check CHECK (state IN ('pending', 'delivered', 'exhausted', 'dropped'));

UPDATE webhook_deliveries SET state = 'dropped', last_error = 'The currency webhook was removed when bots took over webhooks.'
WHERE state = 'pending';
