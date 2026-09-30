"""Tests for the consolidated workbook request.

One request carries two kinds of row, and which of them has to be present is the
only rule this module decides. Everything else about them is deliberately left
alone: the quotations are the ones added in this session, the existing rows are
the Summary rows of a workbook the user already opened, and the two are never
merged.

Three of the four combinations are real work the user asked for:

- quotations only, the original case: build a fresh workbook from this session
- existing rows only: re-export the workbook she just corrected
- both: add a quotation to the workbook she already shares

The fourth -- neither -- has nothing to write. The generator would happily build
a header-only spreadsheet, so this is the one rule here that exists to stop a
degenerate file being handed to a user as if it were her monitoring sheet.
"""

import pytest
from pydantic import ValidationError

from app.models.workbook import ConfirmedQuotation, ConsolidatedWorkbookRequest
from tests.fixtures.build_monitor_workbook import existing_monitor_rows


def quotation(sequence_number: str = "001") -> dict:
    return {
        "sequence_number": sequence_number,
        "quotation": {
            "quotation_number": "QDXB/25/014094/Rev1",
            "client_name": "SAMPLE CLIENT TRADING L.L.C",
            "project_name": "MBRC 466",
            "items": [{"sr": "1", "description": "Sample flooring", "quantity": 34, "unit": "m2"}],
        },
    }


def test_quotations_alone_are_enough_to_generate() -> None:
    # The original workflow, and the one that must behave exactly as it did.
    request = ConsolidatedWorkbookRequest(quotations=[quotation("001")])

    assert len(request.quotations) == 1
    assert request.existing_rows == []


def test_existing_rows_alone_are_enough_to_generate() -> None:
    # The monitor-only workflow. She opened the workbook, corrected a row and
    # wants the corrected file back without having to invent a quotation to make
    # the export happen.
    request = ConsolidatedWorkbookRequest(existing_rows=existing_monitor_rows())

    assert request.quotations == []
    assert [row.sequence_number for row in request.existing_rows] == ["007", "003"]


def test_both_together_are_valid() -> None:
    # Adding a quotation to the workbook she already shares.
    request = ConsolidatedWorkbookRequest(
        quotations=[quotation("008")],
        existing_rows=existing_monitor_rows(),
    )

    assert len(request.quotations) == 1
    assert len(request.existing_rows) == 2


def test_existing_rows_default_to_empty_rather_than_being_required() -> None:
    # A request that never mentions the field is a quotations-only request. This
    # is what every caller sent before the field existed, and it stays valid.
    request = ConsolidatedWorkbookRequest.model_validate({"quotations": [quotation("001")]})

    assert request.existing_rows == []


def test_a_request_with_nothing_to_write_is_rejected() -> None:
    with pytest.raises(ValidationError) as failure:
        ConsolidatedWorkbookRequest(quotations=[], existing_rows=[])

    assert "existing_rows" in str(failure.value)


def test_a_completely_empty_request_is_rejected_too() -> None:
    # Both fields omitted is the same as both empty, and must not slip through
    # the default.
    with pytest.raises(ValidationError) as failure:
        ConsolidatedWorkbookRequest.model_validate({})

    assert "existing_rows" in str(failure.value)


def test_the_error_names_both_sources_a_workbook_can_come_from() -> None:
    # The two are the only ways a workbook gets built, so an error that named
    # neither would not tell the user what to do next.
    with pytest.raises(ValidationError) as failure:
        ConsolidatedWorkbookRequest(quotations=[])

    message = str(failure.value)
    assert "quotations" in message
    assert "existing_rows" in message


def test_the_rejection_is_a_validation_error_not_a_missing_field() -> None:
    # Both fields are individually allowed to be empty; it is the combination
    # that is refused. A field-level complaint would point at the wrong thing.
    with pytest.raises(ValidationError) as failure:
        ConsolidatedWorkbookRequest(quotations=[], existing_rows=[])

    assert not failure.value.errors()[0]["type"].startswith("missing")


def test_an_empty_sequence_number_is_still_rejected() -> None:
    # A quotation with no number is a different mistake from a request with
    # nothing in it, and must not be satisfied by loosening the rule above.
    with pytest.raises(ValidationError):
        ConsolidatedWorkbookRequest.model_validate(
            {"quotations": [{"sequence_number": "", "quotation": {"items": []}}]}
        )


def test_the_two_kinds_of_row_are_never_merged() -> None:
    # An existing row is a finished Summary row and a quotation is a list of
    # items. Folding one into the other would need a client, a project and a
    # status invented for every row the user maintains.
    request = ConsolidatedWorkbookRequest(
        quotations=[quotation("008")],
        existing_rows=existing_monitor_rows(),
    )

    assert [row.sequence_number for row in request.existing_rows] == ["007", "003"]
    assert [entry.sequence_number for entry in request.quotations] == ["008"]


def test_a_sequence_number_keeps_its_leading_zero() -> None:
    # A sequence is an identifier. `007` read as a number is `7`, and a project
    # is quietly renumbered.
    request = ConsolidatedWorkbookRequest(existing_rows=existing_monitor_rows())

    assert request.existing_rows[0].sequence_number == "007"
    assert isinstance(request.existing_rows[0].sequence_number, str)


def test_unknown_fields_are_still_refused() -> None:
    # The model forbids extras, which is what let the frontend be certain that
    # dropping `fingerprint` and `source` mattered.
    with pytest.raises(ValidationError):
        ConsolidatedWorkbookRequest.model_validate(
            {
                "quotations": [quotation("001")],
                "existingRows": existing_monitor_rows(),
            }
        )


def test_a_confirmed_quotation_keeps_its_own_boundaries() -> None:
    # The nested model is unchanged by any of this: a quotation still needs a
    # number, and unknown properties inside it are still refused.
    with pytest.raises(ValidationError):
        ConfirmedQuotation(sequence_number="001", quotation={"items": [], "fingerprint": "x"})
