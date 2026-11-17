from fastapi.routing import APIRoute
from starlette.datastructures import MutableHeaders
from starlette.types import Message, Receive, Scope, Send


class PerViewerRoute(APIRoute):
    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_per_viewer(message: Message) -> None:
            if message["type"] == "http.response.start":
                mark_per_viewer(MutableHeaders(scope=message))

            await send(message)

        await super().handle(scope, receive, send_per_viewer)


def is_per_viewer(scope: Scope) -> bool:
    return isinstance(scope.get("route"), PerViewerRoute)


def mark_per_viewer(headers: MutableHeaders) -> None:
    headers["Cache-Control"] = "private"
    headers.add_vary_header("Cookie")
