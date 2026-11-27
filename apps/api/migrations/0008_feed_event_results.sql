ALTER TABLE bot_events
    ADD COLUMN state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'handled', 'dead')),
    ADD COLUMN attempt int NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at timestamptz;

UPDATE bot_events SET next_attempt_at = created_at;

ALTER TABLE bot_events ALTER COLUMN next_attempt_at SET NOT NULL;

UPDATE bot_events e SET state = 'handled'
FROM bot_feeds f
WHERE f.bot_id = e.bot_id AND e.id <= f.acknowledged_event_id;

ALTER TABLE bot_feeds
    DROP CONSTRAINT bot_feeds_cursor_is_not_ahead,
    DROP COLUMN acknowledged_event_id;

CREATE OR REPLACE FUNCTION create_bot_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO bot_feeds (bot_id, last_event_id) VALUES (NEW.id, 0);

    RETURN NEW;
END
$$;

CREATE INDEX bot_events_due ON bot_events (bot_id, next_attempt_at) WHERE state = 'pending';
