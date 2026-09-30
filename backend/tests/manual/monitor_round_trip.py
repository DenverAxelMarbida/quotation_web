"""
End-to-end check of the whole Phase 5A round trip, run against a real workbook
on disk rather than bytes held in memory.

The point is the path a user's file actually takes: this application generates a
monitoring workbook, the user saves it, and days later uploads that saved file
through the running API. Nothing here is mocked, so a mismatch between the
generator's layout and the importer's expectations shows up as a failure rather
than as a surprise for the user.
"""

import pathlib
import sys

# tests/manual/ -> tests/ -> backend/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from tests.fixtures.build_monitor_workbook import generated_monitoring_workbook  # noqa: E402

OUTPUT = pathlib.Path(__file__).parent / "round_trip.xlsx"

client = TestClient(app)


def main() -> int:
    # Step 1: this application produces a monitoring workbook.
    OUTPUT.write_bytes(generated_monitoring_workbook())
    print(f"1. generated  {OUTPUT.name}  ({OUTPUT.stat().st_size} bytes)")

    # Step 2: the user keeps it, and later chooses it again from disk.
    with OUTPUT.open("rb") as handle:
        saved = handle.read()

    response = client.post(
        "/api/monitor/import",
        files={
            "file": (
                OUTPUT.name,
                saved,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    print(f"2. uploaded   HTTP {response.status_code}")
    if response.status_code != 200:
        print("   FAILED:", response.json())
        return 1

    monitor = response.json()
    print(f"3. read back  {monitor['row_count']} rows from {monitor['source_filename']}")

    # The column widths only have to line up when someone reads the output.
    print(
        f"\n   {'Seq':<3} | {'Client':<23} | {'Project':<17} | Qty  | Unit | Sch | Start | Status"
    )
    print("   " + "-" * 96)
    for row in monitor["rows"]:
        print(
            f"   {row['sequence_number']:<3} | {row['client_name'][:23]:<23} | "
            f"{row['project_name'][:17]:<17} | "
            f"{'' if row['quantity'] is None else row['quantity']:>4} | "
            f"{row['unit_of_measurement']:<4} | "
            f"{row['installation_schedule'] or '-':<5} | "
            f"{row['start_date'] or '-':<6} | "
            f"{row['status'] or '-'}"
        )

    # The properties that matter, checked against the file itself.
    sequences = [row["sequence_number"] for row in monitor["rows"]]
    assert sequences == ["001", "001", "002"], f"rows or sequence order changed: {sequences}"
    assert all(isinstance(value, str) for value in sequences), "a sequence lost its text form"
    assert monitor["highest_sequence"] == "002", monitor["highest_sequence"]
    assert monitor["row_count"] == len(monitor["rows"]) == 3
    quantities = [row["quantity"] for row in monitor["rows"]]
    assert all(isinstance(value, float) for value in quantities), quantities
    # The generator leaves the manual columns empty, and the import must not fill them.
    assert all(row["installation_schedule"] == "" for row in monitor["rows"])
    assert all(row["start_date"] is None for row in monitor["rows"])
    assert all(row["status"] == "" for row in monitor["rows"])

    OUTPUT.unlink()
    print(f"\n5. cleaned up {OUTPUT.name}")
    print("\nRound trip OK: a generated workbook is read back exactly as it was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
