from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from psycopg import Connection
from psycopg.errors import UniqueViolation
from psycopg.rows import DictRow

from app.core.errors import ApiError


def open_transaction(request: Request) -> Iterator[Connection[DictRow]]:
    with request.app.state.db_pool.connection() as connection:
        yield connection


def current_time() -> datetime:
    return datetime.now(UTC)


@contextmanager
def unique_as_field_error(index: str, error: ApiError) -> Iterator[None]:
    try:
        yield
    except UniqueViolation as violation:
        if violation.diag.constraint_name != index:
            raise

        raise error from violation


Database = Annotated[Connection[DictRow], Depends(open_transaction, scope="function")]
Now = Annotated[datetime, Depends(current_time)]
