import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import httpx
import psycopg
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.admin import routes as admin_routes
from app.admin.first_admin import seed_first_admins
from app.auth import routes as auth_routes
from app.auth.discord import DiscordOAuth
from app.auth.sessions import SESSION_COOKIE, hash_secret
from app.blocking import routes as blocking_routes
from app.bots import routes as bot_routes
from app.core.config import Settings
from app.core.errors import error_response, install_error_handlers
from app.core.logs import configure_logging
from app.core.migrations import MIGRATIONS_DIRECTORY, apply_migrations
from app.core.openapi import install_openapi
from app.core.rate_limit import RateLimiter
from app.core.secret_box import SecretBox
from app.currencies import routes as currency_routes
from app.me import routes as me_routes
from app.owners import routes as owner_routes
from app.transactions import detail as transaction_detail_routes
from app.transactions import routes as transaction_routes
from app.webhooks.delivery import WebhookSender
from app.webhooks.public_transport import PublicAddressTransport

OUTBOUND_TIMEOUT_SECONDS = 10
CREDENTIAL_REQUESTS_PER_MINUTE = 300
ADDRESS_REQUESTS_PER_MINUTE = 1200
RATE_WINDOW_SECONDS = 60
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
UNLIMITED_PATHS = {"/health"}

BOT_FACING_ROUTES = (
    currency_routes,
    transaction_routes,
    bot_routes,
)
DASHBOARD_ROUTES = (
    auth_routes,
    me_routes,
    owner_routes,
    blocking_routes,
    admin_routes,
    transaction_detail_routes,
)

NextHandler = Callable[[Request], Awaitable[Response]]
request_logger = logging.getLogger("discoin.http")


def create_app() -> FastAPI:
    configure_logging()
    settings = Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        prepare_database(settings)

        pool = ConnectionPool(conninfo=settings.database_url, kwargs={"row_factory": dict_row}, open=False)
        with (
            httpx.Client(timeout=OUTBOUND_TIMEOUT_SECONDS) as http,
            httpx.Client(
                transport=PublicAddressTransport(), timeout=OUTBOUND_TIMEOUT_SECONDS, follow_redirects=False
            ) as webhook_http,
        ):
            try:
                pool.open(wait=True)
                app.state.db_pool = pool
                app.state.webhook_sender = WebhookSender(webhook_http, app.state.secret_box)
                app.state.discord = DiscordOAuth(
                    settings.discord_client_id, settings.discord_client_secret, settings.discord_redirect_uri, http
                )
                yield
            finally:
                pool.close()

    app = FastAPI(title="Discoin API", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.secret_box = SecretBox.from_base64(settings.webhook_secret_key)
    app.state.credential_limiter = RateLimiter(CREDENTIAL_REQUESTS_PER_MINUTE, RATE_WINDOW_SECONDS)
    app.state.address_limiter = RateLimiter(ADDRESS_REQUESTS_PER_MINUTE, RATE_WINDOW_SECONDS)
    install_error_handlers(app)
    install_routes(app)
    install_openapi(app)
    install_middleware(app, settings)

    return app


def prepare_database(settings: Settings) -> None:
    with psycopg.connect(settings.database_url, autocommit=True) as connection:
        apply_migrations(connection, MIGRATIONS_DIRECTORY)
        seed_first_admins(connection, settings.first_admin_ids)


def install_routes(app: FastAPI) -> None:
    for module in BOT_FACING_ROUTES:
        app.include_router(module.router)

    for module in DASHBOARD_ROUTES:
        app.include_router(module.router, include_in_schema=False)

    @app.api_route("/health", methods=["GET", "HEAD"], include_in_schema=False)
    def read_health(request: Request) -> dict[str, str]:
        with request.app.state.db_pool.connection() as connection:
            connection.execute("SELECT 1").fetchone()

        return {"status": "ok"}


def install_middleware(app: FastAPI, settings: Settings) -> None:
    @app.middleware("http")
    async def check_origin(request: Request, call_next: NextHandler) -> Response:
        if is_cross_site_session_write(request, settings.frontend_origin):
            return error_response(403, "This request must come from the Discoin dashboard.", None)

        return await call_next(request)

    @app.middleware("http")
    async def limit_rate(request: Request, call_next: NextHandler) -> Response:
        if route_path(request) in UNLIMITED_PATHS or within_rate_limits(request):
            return await call_next(request)

        response = error_response(429, "Too many requests. Wait a minute and try again.", None)
        response.headers["Retry-After"] = str(RATE_WINDOW_SECONDS)

        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=sorted(UNSAFE_METHODS | {"GET"}),
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def log_request(request: Request, call_next: NextHandler) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log_request_line(request, 500, started)
            raise

        log_request_line(request, response.status_code, started)

        return response


def log_request_line(request: Request, status: int, started: float) -> None:
    request_logger.info(
        "request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status": status,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        },
    )


def is_cross_site_session_write(request: Request, allowed_origin: str) -> bool:
    if request.method not in UNSAFE_METHODS or SESSION_COOKIE not in request.cookies:
        return False

    return request.headers.get("origin") != allowed_origin


def route_path(request: Request) -> str:
    return request.scope["path"].removeprefix(request.scope["root_path"])


def within_rate_limits(request: Request) -> bool:
    if request.client is None:
        raise RuntimeError("The request has no client address to rate limit by")

    if not request.app.state.address_limiter.admit(request.client.host):
        return False

    credential = request.headers.get("authorization") or request.cookies.get(SESSION_COOKIE)

    return credential is None or request.app.state.credential_limiter.admit(hash_secret(credential))
