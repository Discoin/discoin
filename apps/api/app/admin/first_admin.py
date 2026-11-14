from psycopg import Connection


def seed_first_admin(db: Connection, user_id: str) -> None:
    db.execute(
        """
        INSERT INTO users (id, is_admin)
        SELECT %(user_id)s, true
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
        ON CONFLICT (id) DO UPDATE SET is_admin = true
        """,
        {"user_id": user_id},
    )
