"""API tests for the monitoring workbook import endpoint.

The real import service is used here rather than a stub: this endpoint has no
other moving parts, and the behaviour worth protecting is the HTTP contract over
a real workbook (the response shape, the status codes, and that a failure reads
like a sentence rather than a traceback).
"""

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_monitor_import_service
from app.main import app
from app.services.monitor_import_service import MonitorImportService
from tests.fixtures.build_monitor_workbook import (
    SUMMARY_COLUMNS,
    damaged_workbook_bytes,
    generated_monitoring_workbook,
    row,
    summary_workbook,
)

client = TestClient(app)

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def upload(
    content: bytes,
    filename: str = "monitoring_sheet.xlsx",
    content_type: str = XLSX_MIME,
):
    return client.post(
        "/api/monitor/import",
        files={"file": (filename, content, content_type)},
    )


def test_a_generated_workbook_is_returned_as_json() -> None:
    response = upload(generated_monitoring_workbook())

    assert response.status_code == 200
    body = response.json()
    assert body["row_count"] == 3
    assert body["highest_sequence"] == "002"
    assert body["source_filename"] == "monitoring_sheet.xlsx"
    assert len(body["rows"]) == 3


def test_the_response_carries_every_monitored_field() -> None:
    response = upload(generated_monitoring_workbook())

    first = response.json()["rows"][0]
    assert first == {
        "sequence_number": "001",
        "client_name": "SAMPLE CLIENT TRADING L.L.C",
        "project_name": "MBRC 466",
        "product_description": "Sample flooring product",
        "quantity": 34.0,
        "unit_of_measurement": "m2",
        "installation_schedule": "",
        "start_date": None,
        "status": "",
    }


def test_a_sequence_number_is_returned_as_a_string() -> None:
    response = upload(summary_workbook([row(sequence_number="007")]))

    assert response.json()["rows"][0]["sequence_number"] == "007"


def test_a_workbook_without_a_summary_sheet_is_rejected() -> None:
    response = upload(summary_workbook([row()], sheet_name="Sheet1"))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "MissingSummarySheetError"
    assert "Summary" in error["detail"]


def test_a_workbook_missing_a_column_is_rejected() -> None:
    response = upload(summary_workbook([row()], columns=["Sequence Number", "Status"]))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MissingColumnsError"


def test_an_empty_workbook_is_rejected() -> None:
    response = upload(summary_workbook([]))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EmptySummaryError"


def test_a_file_that_is_not_excel_is_rejected() -> None:
    response = upload(damaged_workbook_bytes())

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "NotExcelError"


def test_an_excel_named_file_that_is_not_excel_is_rejected() -> None:
    # The extension alone is not trusted; the bytes are opened.
    response = upload(b"not a spreadsheet", filename="monitoring_sheet.xlsx")

    assert response.status_code == 415


def test_an_invalid_sequence_number_is_rejected() -> None:
    response = upload(summary_workbook([row(sequence_number="N/A")]))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "InvalidSequenceNumberError"


def test_an_unknown_status_is_rejected() -> None:
    response = upload(summary_workbook([row(status="Paused")]))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "InvalidStatusValueError"


def test_a_missing_file_is_rejected_without_a_server_error() -> None:
    # FastAPI rejects a request carrying no file part before the route runs, so it
    # answers with its own validation shape rather than this app's error envelope.
    # What matters here is that it is a clean 422 and never a 500.
    response = client.post("/api/monitor/import")

    assert response.status_code == 422
    assert "traceback" not in str(response.json()).lower()


@pytest.mark.parametrize("column", SUMMARY_COLUMNS)
def test_every_generator_column_is_required(column: str) -> None:
    # Proves the endpoint's required set is the generator's real header list, one
    # column at a time, so the two cannot drift apart unnoticed.
    columns = [name for name in SUMMARY_COLUMNS if name != column]
    response = upload(summary_workbook([row()], columns=columns))

    assert response.status_code == 422
    assert column in response.json()["error"]["detail"]


def test_the_existing_routes_are_unchanged() -> None:
    # The import feature must not disturb the routes that already existed.
    assert client.get("/api/health").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/quotations/parse" in paths
    assert "/api/monitor/import" in paths


class _SequenceValidatorRelaxed(MonitorImportService):
    """Lets a dotted Sequence Number past the row-level check.

    The real validator refuses one, so this stands in for a future relaxation and
    shows that the endpoint still answers with a clean error rather than a server
    failure if a dotted value ever gets that far.
    """

    def _sequence_number(self, value, line: int) -> str:
        return str(value).strip() if value not in (None, "") else ""


@pytest.mark.parametrize("value", ["1.130", "7.90", "007.90"])
def test_a_dotted_sequence_number_answers_with_a_monitor_error_not_a_server_error(
    value: str,
) -> None:
    app.dependency_overrides[get_monitor_import_service] = _SequenceValidatorRelaxed
    try:
        response = upload(summary_workbook([row(sequence_number=value)]))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "InvalidSequenceNumberError"
    assert value in body["error"]["detail"]
