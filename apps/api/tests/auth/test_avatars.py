import pytest

from app.auth.avatars import avatar_url

USER_ID = "115269304705875969"
DEFAULT_INDEX = (int(USER_ID) >> 22) % 6


@pytest.mark.parametrize(
    ("avatar_hash", "url"),
    [
        ("abc123", f"https://cdn.discordapp.com/avatars/{USER_ID}/abc123.png?size=64"),
        ("a_abc123", f"https://cdn.discordapp.com/avatars/{USER_ID}/a_abc123.gif?size=64"),
        (None, f"https://cdn.discordapp.com/embed/avatars/{DEFAULT_INDEX}.png"),
    ],
    ids=["custom", "animated", "default"],
)
def test_avatar_url_follows_the_avatar_hash(avatar_hash: str | None, url: str) -> None:
    assert avatar_url(USER_ID, avatar_hash) == url
