ALTER TABLE transactions ADD COLUMN receiver_handled_at timestamptz;
ALTER TABLE transactions ADD COLUMN sender_handled_at timestamptz;

CREATE INDEX transactions_undone_unhandled ON transactions (handled_at, id)
WHERE (status IN ('Cancelled', 'Reversed') AND receiver_handled_at IS NULL)
    OR (status IN ('Refunded', 'Cancelled', 'Reversed') AND sender_handled_at IS NULL);
