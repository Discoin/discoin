from psycopg import Connection


def seed_first_admins(db: Connection, user_ids: tuple[str, ...]) -> None:
    db.execute(
        """
        INSERT INTO users (id, is_admin)
        SELECT user_id, true FROM unnest(%(user_ids)s::text[]) AS user_id
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
        ON CONFLICT (id) DO UPDATE SET is_admin = true
        """,
        {"user_ids": list(user_ids)},
    )
