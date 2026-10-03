"""Tests for the monitoring row model and its automatic Status.

Status is not a value anyone types. It is worked out from the three fields that
describe the actual state of the job -- Installation Schedule, Start Date and
Completion Date -- so a workbook that disagrees with itself gets the answer the
three fields support rather than the answer somebody once picked from a list.

That also means a Status arriving from a file is evidence, not an instruction:
an old workbook that says "Completed" while its Completion Date is empty is
wrong about itself, and the row says so.
"""

import pytest
from pydantic import ValidationError

from app.models.monitor import ImportedMonitorRow, derive_status


def row(**overrides) -> ImportedMonitorRow:
    """A minimal row. Only the three operational fields are usually set."""
    fields = {"sequence_number": "001"}
    fields.update(overrides)
    return ImportedMonitorRow(**fields)


@pytest.mark.parametrize(
    ("schedule", "start", "completion", "expected"),
    [
        # Nothing is known about the job, so it is not moving.
        ("", "", "", "On Hold"),
        # A dash means "not set yet" for status purposes, even though the cell
        # is not empty and stays as "-" in the file.
        ("-", "01/10/2026", "", "On Hold"),
        ("October 2026", "-", "", "On Hold"),
        # Scheduled and started, but nobody has said it is finished.
        ("October 2026", "01/10/2026", "", "Ongoing"),
        ("October 2026", "01/10/2026", "-", "Ongoing"),
        # Completion wins over everything.
        ("October 2026", "01/10/2026", "15/10/2026", "Completed"),
        ("-", "-", "15/10/2026", "Completed"),
        ("", "", "15/10/2026", "Completed"),
        ("October 2026", "", "15/10/2026", "Completed"),
        # Whitespace around a value is not part of the value.
        ("  ", "   ", " ", "On Hold"),
        ("  ", "  01/10/2026  ", "", "On Hold"),
        (" October 2026 ", " 01/10/2026 ", "  ", "Ongoing"),
        # A dash with padding is still a dash.
        (" - ", "01/10/2026", "", "On Hold"),
    ],
    ids=[
        "empty-all",
        "dash-schedule",
        "dash-start",
        "scheduled-and-started",
        "dash-completion",
        "completed",
        "completion-without-schedule",
        "completion-only",
        "completion-without-start",
        "whitespace-only",
        "whitespace-schedule",
        "whitespace-around-values",
        "padded-dash",
    ],
)
def test_status_is_worked_out_from_the_three_operational_fields(
    schedule: str, start: str, completion: str, expected: str
) -> None:
    assert derive_status(schedule, start, completion) == expected


def test_a_none_field_counts_as_empty() -> None:
    # An empty date cell is None in the model, and an empty schedule is ''.
    # Both are "not set".
    assert derive_status(None, None, None) == "On Hold"
    assert derive_status("", None, None) == "On Hold"
    assert derive_status(None, "01/10/2026", None) == "On Hold"
    assert derive_status(None, None, "15/10/2026") == "Completed"


def test_completion_date_is_a_field_of_its_own() -> None:
    completed = row(
        installation_schedule="October 2026",
        start_date="01/10/2026",
        completion_date="15/10/2026",
    )

    assert completed.completion_date == "15/10/2026"
    assert completed.status == "Completed"


def test_completion_date_is_empty_until_someone_fills_it_in() -> None:
    # No default is invented. An old workbook that has no Completion Date at all
    # simply arrives without one.
    assert row().completion_date is None


def test_a_status_that_arrives_with_the_row_is_not_trusted() -> None:
    # The old workbook says the work is finished; its own Completion Date is
    # empty. The three fields win, because they are the ones the user maintains
    # and the Status column is now their consequence.
    stale = row(status="Completed", installation_schedule="October 2026", start_date="01/10/2026")

    assert stale.status == "Ongoing"


def test_a_status_that_cannot_be_right_is_not_trusted_either() -> None:
    # Anything can be in a Status cell once the dropdown is gone -- including a
    # value this application has never heard of. It is replaced, not rejected,
    # because refusing the file would stop the user getting her rows back.
    made_up = row(status="Paused")

    assert made_up.status == "On Hold"


def test_an_empty_status_becomes_the_derived_one() -> None:
    # A blank Status used to mean "the user has not chosen yet". There is
    # nothing to choose now, so the row says what its dates say.
    assert row(status="", installation_schedule="October 2026", start_date="01/10/2026").status == (
        "Ongoing"
    )


def test_the_derived_status_is_always_one_of_the_three() -> None:
    # The Excel colours and the tests that read them depend on exactly these
    # three words. Nothing else can come out of the rule.
    for schedule in ("", "-", "October 2026"):
        for start in ("", "-", "01/10/2026"):
            for completion in ("", "-", "15/10/2026"):
                assert derive_status(schedule, start, completion) in (
                    "On Hold",
                    "Ongoing",
                    "Completed",
                )


def test_a_row_still_needs_a_sequence_number() -> None:
    # Adding a field must not quietly weaken the one that was already required.
    with pytest.raises(ValidationError):
        ImportedMonitorRow()


def test_a_row_still_refuses_unknown_fields() -> None:
    # The frontend and the workbook have to agree on the shape, and a typo'd
    # field must not vanish silently.
    with pytest.raises(ValidationError):
        ImportedMonitorRow(sequence_number="001", completion_day="15/10/2026")
