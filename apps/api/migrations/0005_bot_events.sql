CREATE TABLE bot_feeds (
    bot_id uuid PRIMARY KEY REFERENCES bots (id),
    last_event_id bigint NOT NULL,
    acknowledged_event_id bigint NOT NULL,
    CONSTRAINT bot_feeds_cursor_is_not_ahead CHECK (acknowledged_event_id <= last_event_id)
);

INSERT INTO bot_feeds (bot_id, last_event_id, acknowledged_event_id) SELECT id, 0, 0 FROM bots;

CREATE FUNCTION create_bot_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO bot_feeds (bot_id, last_event_id, acknowledged_event_id) VALUES (NEW.id, 0, 0);

    RETURN NEW;
END
$$;

CREATE TRIGGER bots_get_a_feed AFTER INSERT ON bots FOR EACH ROW EXECUTE FUNCTION create_bot_feed();

CREATE TABLE bot_events (
    bot_id uuid NOT NULL REFERENCES bot_feeds (bot_id),
    id bigint NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (bot_id, id)
);

CREATE INDEX bot_events_created_at ON bot_events (created_at);
