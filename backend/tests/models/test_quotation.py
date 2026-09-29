"""Data model tests.

These encode the boundaries AGENTS.md puts around the quotation model: nothing
may be invented, and no business decision may be carried in the extracted data.
"""

import pytest
from pydantic import ValidationError

from app.models.quotation import Quotation, QuotationItem


def test_a_minimal_quotation_is_valid_and_empty() -> None:
    quotation = Quotation()

    assert quotation.quotation_number is None
    assert quotation.client_name is None
    assert quotation.project_name is None
    assert quotation.items == []


def test_unreadable_fields_stay_none_rather_than_being_defaulted() -> None:
    quotation = Quotation(client_name="ACME")

    assert quotation.project_name is None
    assert quotation.quotation_number is None


def test_sequence_schedule_start_date_and_status_are_not_part_of_the_model() -> None:
    # These are human-controlled values (AGENTS.md section 6). If the model ever
    # grows them, extraction could start filling them in, so guard it here.
    forbidden = {"sequence_number", "installation_schedule", "start_date", "status"}

    assert forbidden.isdisjoint(Quotation.model_fields)
    assert forbidden.isdisjoint(QuotationItem.model_fields)


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        Quotation(unexpected="value")


def test_units_are_free_text() -> None:
    # An unfamiliar unit must be representable instead of rejected.
    assert QuotationItem(sr="1", unit="roll").unit == "roll"
    assert QuotationItem(sr="1", unit="m²").unit == "m²"


def test_decimal_quantities_are_preserved() -> None:
    assert QuotationItem(sr="1", quantity=7.5).quantity == 7.5


def test_missing_sr_is_allowed_because_it_is_never_invented() -> None:
    assert QuotationItem(description="something").sr is None


def test_a_quotation_holds_many_items_sharing_one_header() -> None:
    quotation = Quotation(
        quotation_number="Q1",
        client_name="ACME",
        project_name="P1",
        items=[QuotationItem(sr="1"), QuotationItem(sr="2"), QuotationItem(sr="3")],
    )

    assert len(quotation.items) == 3
    assert {quotation.quotation_number} == {"Q1"}
