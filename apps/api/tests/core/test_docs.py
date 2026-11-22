import re
from pathlib import Path

from fastapi.testclient import TestClient

DOCS_ENDPOINTS = Path(__file__).resolve().parents[3] / "frontend" / "src" / "pages" / "Docs" / "endpoints.ts"
DOCUMENTED_ROUTE = re.compile(r'method: "([A-Z]+)",\s*path: "([^"]+)"')
PATH_PARAMETER = re.compile(r"\{[^}]+\}")
LEFT_OUT_OF_DOCS = {
    ("GET", "/transactions"),
    ("GET", "/currencies/{currency_id}/transactions"),
    ("GET", "/currencies/{currency_id}/history"),
}

Route = tuple[str, str]


def test_no_api_docs_ui_is_served(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").json()["info"]["title"] == "Discoin API"


def test_every_public_route_is_documented(client: TestClient) -> None:
    undocumented = public_routes(client) - documented_routes() - normalized(LEFT_OUT_OF_DOCS)

    assert undocumented == set(), f"Public routes missing from {DOCS_ENDPOINTS}: {sorted(undocumented)}"


def test_every_documented_route_exists(client: TestClient) -> None:
    missing = documented_routes() - public_routes(client)

    assert missing == set(), f"{DOCS_ENDPOINTS} documents routes the API no longer has: {sorted(missing)}"


def public_routes(client: TestClient) -> set[Route]:
    paths = client.get("/openapi.json").json()["paths"]

    return normalized({(method.upper(), path) for path, operations in paths.items() for method in operations})


def documented_routes() -> set[Route]:
    routes = DOCUMENTED_ROUTE.findall(DOCS_ENDPOINTS.read_text(encoding="utf-8"))
    if not routes:
        raise AssertionError(f"Found no documented routes in {DOCS_ENDPOINTS}")

    return normalized(set(routes))


def normalized(routes: set[Route]) -> set[Route]:
    return {(method, PATH_PARAMETER.sub("{}", path)) for method, path in routes}
