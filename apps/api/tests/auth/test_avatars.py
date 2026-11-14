from app.auth.avatars import avatar_url

USER_ID = "115269304705875969"


def test_custom_avatar_uses_the_cdn() -> None:
    assert avatar_url(USER_ID, "abc123") == f"https://cdn.discordapp.com/avatars/{USER_ID}/abc123.png?size=64"


def test_animated_avatar_is_a_gif() -> None:
    assert avatar_url(USER_ID, "a_abc123").endswith("/a_abc123.gif?size=64")


def test_no_avatar_uses_discords_default_for_that_user() -> None:
    index = (int(USER_ID) >> 22) % 6

    assert avatar_url(USER_ID, None) == f"https://cdn.discordapp.com/embed/avatars/{index}.png"
