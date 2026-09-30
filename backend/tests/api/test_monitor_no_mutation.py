"""The monitoring workbook is read, never written.

Phase 5B lets the user correct an imported workbook in the browser. The edits are
held in memory and are lost on reload, on purpose: a later phase decides how they
should be persisted, and that decision is not made by accident here.

These tests pin the boundary. The only thing the backend offers for a monitoring
workbook is the import endpoint that reads one. If a write, update or save route
ever appears, it was added on purpose and these tests should be revisited at the
same time, rather than being quietly satisfied by an endpoint nobody reviewed.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def monitor_routes() -> dict[str, set[str]]:
    """Every path under /api/monitor, mapped to the methods it answers."""
    schema = app.openapi()
    routes: dict[str, set[str]] = {}
    for path, operations in schema["paths"].items():
        if not path.startswith("/api/monitor"):
            continue
        routes[path] = {method.upper() for method in operations}
    return routes


def test_the_import_endpoint_exists() -> None:
    assert monitor_routes() == {"/api/monitor/import": {"POST"}}


def test_nothing_else_accepts_a_workbook() -> None:
    """No save, update, write-back or delete route for a monitoring workbook."""
    assert [path for path in monitor_routes() if path != "/api/monitor/import"] == []


def test_the_import_endpoint_only_reads() -> None:
    """The one route that exists does nothing but read a file."""
    (methods,) = monitor_routes().values()

    assert not methods & {"PUT", "PATCH", "DELETE"}


def test_saving_from_the_browser_reaches_no_endpoint() -> None:
    """There is nowhere for an edit to be posted, so nothing can be persisted."""
    for method in ("PUT", "PATCH", "DELETE"):
        response = client.request(method, "/api/monitor/import")

        assert response.status_code == 405, (
            f"{method} /api/monitor/import answered {response.status_code}"
        )
