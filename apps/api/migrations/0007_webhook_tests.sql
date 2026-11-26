CREATE TABLE webhook_tests (
    id uuid PRIMARY KEY,
    bot_id uuid NOT NULL REFERENCES bots (id),
    owner_id text NOT NULL,
    path text NOT NULL CHECK (path IN ('webhook', 'feed')),
    feed_event_id bigint,
    submitted_at timestamptz NOT NULL,
    marked_status text CHECK (marked_status IN ('Completed', 'Refunded')),
    marked_at timestamptz,
    CONSTRAINT webhook_tests_feed_path_has_an_event CHECK ((path = 'feed') = (feed_event_id IS NOT NULL)),
    CONSTRAINT webhook_tests_mark_has_a_time CHECK ((marked_status IS NULL) = (marked_at IS NULL))
);

CREATE INDEX webhook_tests_submitted_at ON webhook_tests (submitted_at);

UPDATE bot_events SET payload = payload || '{"test": false}' WHERE payload -> 'test' IS NULL;
UPDATE webhook_deliveries SET payload = payload || '{"test": false}' WHERE payload -> 'test' IS NULL;
