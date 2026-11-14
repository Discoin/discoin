from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

DISCORD_API = "https://discord.com/api/v10"
AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
SCOPE = "identify"


@dataclass(frozen=True)
class DiscordUser:
    id: str
    username: str
    avatar_hash: str | None


class DiscordLoginError(Exception):
    pass


class DiscordOAuth:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, http: httpx.Client) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.http = http

    def authorize_url(self, state: str) -> str:
        query = urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": SCOPE,
                "state": state,
            }
        )

        return f"{AUTHORIZE_URL}?{query}"

    def fetch_user(self, code: str) -> DiscordUser:
        access_token = self.exchange_code(code)
        response = self.http.get(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {access_token}"})
        body = checked_json(response, "read the Discord user")

        return DiscordUser(
            id=body["id"],
            username=body["global_name"] or body["username"],
            avatar_hash=body["avatar"],
        )

    def exchange_code(self, code: str) -> str:
        response = self.http.post(
            f"{DISCORD_API}/oauth2/token",
            data={"grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri},
            auth=(self.client_id, self.client_secret),
        )

        return checked_json(response, "exchange the login code")["access_token"]


def checked_json(response: httpx.Response, action: str) -> dict:
    if response.is_error:
        raise DiscordLoginError(f"Discord refused to {action}: HTTP {response.status_code}")

    return response.json()
