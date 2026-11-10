import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from psycopg_pool import ConnectionPool


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = ConnectionPool(conninfo=os.environ["DATABASE_URL"], open=False)
    try:
        pool.open(wait=True)
        app.state.db_pool = pool
        yield
    finally:
        pool.close()


app = FastAPI(title="Discoin API", lifespan=lifespan)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"name": "Discoin API"}


@app.api_route("/health", methods=["GET", "HEAD"])
def read_health(request: Request) -> dict[str, str]:
    with request.app.state.db_pool.connection() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok"}
