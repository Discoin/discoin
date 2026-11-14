import pytest

from app.core.config import InvalidSettingError, MissingSettingError, Settings

VALID_ENVIRONMENT = {
    "DATABASE_URL": "postgresql://example/discoin",
    "FIRST_ADMIN_ID": "100000000000000001",
    "DISCORD_CLIENT_ID": "client",
    "DISCORD_CLIENT_SECRET": "secret",
    "DISCORD_REDIRECT_URI": "https://api.example.com/auth/discord/callback",
    "FRONTEND_URL": "https://discoin.example.com/",
    "WEBHOOK_SECRET_KEY": "a2V5",
}


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name, value in VALID_ENVIRONMENT.items():
        monkeypatch.setenv(name, value)

    return monkeypatch


def test_reads_every_setting(environment: pytest.MonkeyPatch) -> None:
    assert Settings.from_environment() == Settings(
        database_url="postgresql://example/discoin",
        first_admin_id="100000000000000001",
        discord_client_id="client",
        discord_client_secret="secret",
        discord_redirect_uri="https://api.example.com/auth/discord/callback",
        frontend_url="https://discoin.example.com/",
        webhook_secret_key="a2V5",
    )


@pytest.mark.parametrize("name", VALID_ENVIRONMENT)
def test_every_setting_is_required(environment: pytest.MonkeyPatch, name: str) -> None:
    environment.delenv(name)

    with pytest.raises(MissingSettingError, match=name):
        Settings.from_environment()


def test_empty_setting_counts_as_missing(environment: pytest.MonkeyPatch) -> None:
    environment.setenv("DATABASE_URL", "")

    with pytest.raises(MissingSettingError, match="DATABASE_URL"):
        Settings.from_environment()


@pytest.mark.parametrize(
    ("name", "value"),
    [("FIRST_ADMIN_ID", "12"), ("FRONTEND_URL", "discoin.example.com"), ("DISCORD_REDIRECT_URI", "/callback")],
)
def test_malformed_setting_is_rejected(environment: pytest.MonkeyPatch, name: str, value: str) -> None:
    environment.setenv(name, value)

    with pytest.raises(InvalidSettingError, match=name):
        Settings.from_environment()
