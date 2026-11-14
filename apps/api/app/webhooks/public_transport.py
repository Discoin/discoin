import ipaddress
import socket
from collections.abc import Callable

import httpx

Resolver = Callable[[str], list[str]]


def resolve_host(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)]


def is_public(address: str) -> bool:
    return ipaddress.ip_address(address.split("%", 1)[0]).is_global


class PublicAddressTransport(httpx.HTTPTransport):
    def __init__(self, resolver: Resolver = resolve_host) -> None:
        super().__init__()
        self.resolver = resolver

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        try:
            addresses = self.resolver(host)
        except OSError as error:
            raise httpx.ConnectError(f"Couldn't resolve {host}: {error}", request=request) from error

        if not addresses or not all(is_public(address) for address in addresses):
            raise httpx.ConnectError(f"Refused to call {host}: it resolves to a private address", request=request)

        return super().handle_request(request)
