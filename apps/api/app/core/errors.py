import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

VALIDATION_MESSAGES = {
    "missing": "{field} is required.",
    "json_invalid": "The request body is not valid JSON.",
}
INVALID_VALUE_MESSAGE = "{field} is not valid."

logger = logging.getLogger("discoin.errors")


class ApiError(Exception):
    def __init__(self, status: int, message: str, field: str | None = None, **extra: object) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.field = field
        self.extra = extra


def not_found(what: str) -> ApiError:
    return ApiError(404, f"No {what} with that ID.")


def error_response(status: int, message: str, field: str | None, **extra: object) -> JSONResponse:
    return JSONResponse(status_code=status, content={"status": status, "message": message, "field": field, **extra})


def handle_api_error(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, ApiError)

    return error_response(error.status, error.message, error.field, **error.extra)


def handle_http_exception(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, HTTPException)

    return error_response(error.status_code, str(error.detail), None)


def handle_validation_error(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)

    first = error.errors()[0]
    field = field_name(first["loc"])
    template = VALIDATION_MESSAGES.get(first["type"], INVALID_VALUE_MESSAGE)

    return error_response(400, template.format(field=field or "The request"), field)


def field_name(location: tuple[str | int, ...]) -> str | None:
    names = [part for part in location[1:] if isinstance(part, str)]

    return names[-1] if names else None


def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.error("unhandled error", exc_info=error, extra={"method": request.method, "path": request.url.path})

    return error_response(500, "Something went wrong on our side. Try again in a moment.", None)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(Exception, handle_unexpected_error)
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(HTTPException, handle_http_exception)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
