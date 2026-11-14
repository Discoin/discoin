import secrets
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse

from app.auth.discord import DiscordLoginError, DiscordOAuth
from app.auth.sessions import SESSION_COOKIE, SESSION_LIFETIME, end_session, start_session
from app.core.database import Database, Now
from app.core.errors import ApiError

STATE_COOKIE = "discoin_login_state"
STATE_LIFETIME_SECONDS = 600
STATE_SEPARATOR = "."
LONGEST_NEXT_PATH = 2000

router = APIRouter(prefix="/auth", tags=["login"])


def discord_oauth(request: Request) -> DiscordOAuth:
    return request.app.state.discord


Discord = Annotated[DiscordOAuth, Depends(discord_oauth)]


@router.get("/discord/login")
def start_login(
    discord: Discord,
    next_path: Annotated[str | None, Query(alias="next")] = None,
) -> RedirectResponse:
    state = secrets.token_urlsafe(32)
    stored = state if next_path is None else state + STATE_SEPARATOR + checked_next_path(next_path)
    response = RedirectResponse(discord.authorize_url(state))
    response.set_cookie(
        STATE_COOKIE, stored, max_age=STATE_LIFETIME_SECONDS, httponly=True, secure=True, samesite="lax"
    )

    return response


@router.get("/discord/callback")
def finish_login(
    request: Request,
    discord: Discord,
    db: Database,
    now: Now,
    state: str,
    code: str,
    stored_state: Annotated[str | None, Cookie(alias=STATE_COOKIE)] = None,
) -> RedirectResponse:
    if stored_state is None:
        raise expired_login()

    expected_state, _, next_path = stored_state.partition(STATE_SEPARATOR)
    if not secrets.compare_digest(state, expected_state):
        raise expired_login()

    try:
        discord_user = discord.fetch_user(code)
    except DiscordLoginError as error:
        raise ApiError(502, "Discord didn't confirm the login. Try again.") from error

    token = start_session(db, discord_user, now)
    response = RedirectResponse(landing_url(request.app.state.settings.frontend_url, next_path), status_code=303)
    response.delete_cookie(STATE_COOKIE, httponly=True, secure=True, samesite="lax")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return response


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    db: Database,
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> None:
    if session is not None:
        end_session(db, session)

    response.delete_cookie(SESSION_COOKIE, httponly=True, secure=True, samesite="lax")


def checked_next_path(next_path: str) -> str:
    if not is_local_path(next_path):
        raise ApiError(400, "After login, Discoin can only return to a page on this site, like /owner.", "next")

    return next_path


def is_local_path(next_path: str) -> bool:
    if len(next_path) > LONGEST_NEXT_PATH:
        return False

    if not next_path.startswith("/") or next_path.startswith("//"):
        return False

    if "\\" in next_path:
        return False

    return all(character.isprintable() for character in next_path)


def landing_url(frontend_url: str, next_path: str) -> str:
    if not next_path:
        return frontend_url

    return frontend_url.rstrip("/") + next_path


def expired_login() -> ApiError:
    return ApiError(400, "This login link has expired. Start the Discord login again.", "state")
