from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from psycopg import Connection
from psycopg.rows import DictRow


def open_transaction(request: Request) -> Iterator[Connection[DictRow]]:
    with request.app.state.db_pool.connection() as connection:
        yield connection


def current_time() -> datetime:
    return datetime.now(UTC)


Database = Annotated[Connection[DictRow], Depends(open_transaction, scope="function")]
Now = Annotated[datetime, Depends(current_time)]
