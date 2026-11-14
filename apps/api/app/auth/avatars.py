DISCORD_CDN = "https://cdn.discordapp.com"
AVATAR_SIZE = 64
DEFAULT_AVATAR_COUNT = 6
SNOWFLAKE_TIMESTAMP_SHIFT = 22


def avatar_url(user_id: str, avatar_hash: str | None) -> str:
    if avatar_hash is None:
        return default_avatar_url(user_id)

    extension = "gif" if avatar_hash.startswith("a_") else "png"

    return f"{DISCORD_CDN}/avatars/{user_id}/{avatar_hash}.{extension}?size={AVATAR_SIZE}"


def default_avatar_url(user_id: str) -> str:
    index = (int(user_id) >> SNOWFLAKE_TIMESTAMP_SHIFT) % DEFAULT_AVATAR_COUNT

    return f"{DISCORD_CDN}/embed/avatars/{index}.png"
