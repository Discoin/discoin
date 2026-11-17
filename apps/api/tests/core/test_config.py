import pytest

from app.core.config import InvalidSettingError, MissingSettingError, Settings

FIRST_ID = "100000000000000001"
SECOND_ID = "100000000000000002"

VALID_ENVIRONMENT = {
    "DATABASE_URL": "postgresql://example/discoin",
    "FIRST_ADMIN_IDS": FIRST_ID,
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
        first_admin_ids=(FIRST_ID,),
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


@pytest.mark.parametrize("name", ["DATABASE_URL", "FIRST_ADMIN_IDS"])
def test_empty_setting_counts_as_missing(environment: pytest.MonkeyPatch, name: str) -> None:
    environment.setenv(name, "")

    with pytest.raises(MissingSettingError, match=name):
        Settings.from_environment()


@pytest.mark.parametrize(
    ("name", "value"),
    [("FRONTEND_URL", "discoin.example.com"), ("DISCORD_REDIRECT_URI", "/callback")],
)
def test_malformed_setting_is_rejected(environment: pytest.MonkeyPatch, name: str, value: str) -> None:
    environment.setenv(name, value)

    with pytest.raises(InvalidSettingError, match=name):
        Settings.from_environment()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (FIRST_ID, (FIRST_ID,)),
        (f"{SECOND_ID},{FIRST_ID}", (SECOND_ID, FIRST_ID)),
        (f" {FIRST_ID} ,\t{SECOND_ID}\t", (FIRST_ID, SECOND_ID)),
    ],
)
def test_first_admin_ids_are_read_in_order(
    environment: pytest.MonkeyPatch, value: str, expected: tuple[str, ...]
) -> None:
    environment.setenv("FIRST_ADMIN_IDS", value)

    assert Settings.from_environment().first_admin_ids == expected


@pytest.mark.parametrize(
    ("value", "problem"),
    [
        ("   ", "entry 1 is empty"),
        (f",{FIRST_ID}", "entry 1 is empty"),
        (f"{FIRST_ID},", "entry 2 is empty"),
        (f"{FIRST_ID}, \t,{SECOND_ID}", "entry 2 is empty"),
        (f"{FIRST_ID},not-a-snowflake", "entry 2 ('not-a-snowflake') is not one"),
        ("12", "entry 1 ('12') is not one"),
        ("1" * 21, f"entry 1 ('{'1' * 21}') is not one"),
        ("100000000 000000001", "entry 1 ('100000000 000000001') is not one"),
        (f"{FIRST_ID}\n", f"entry 1 ('{FIRST_ID}\\n') is not one"),
        (f"{FIRST_ID};{SECOND_ID}", f"entry 1 ('{FIRST_ID};{SECOND_ID}') is not one"),
        (f"{FIRST_ID}, {FIRST_ID}\t", f"entry 2 repeats {FIRST_ID}"),
    ],
)
def test_malformed_first_admin_ids_are_rejected(environment: pytest.MonkeyPatch, value: str, problem: str) -> None:
    environment.setenv("FIRST_ADMIN_IDS", value)

    with pytest.raises(InvalidSettingError, match="FIRST_ADMIN_IDS") as raised:
        Settings.from_environment()

    assert str(raised.value).endswith(f", but {problem}")
