"""Tests for the deterministic quotation parser.

The expected values are the ones recorded in AGENTS.md section 4. They are run
against a generated PDF whose ruled layout matches the reference quotation
exactly, with invented client, project and product names, so no confidential
document is needed to test the parser (AGENTS.md sections 10 and 13).

Every case here is a regression: each one is a way the parser has already given
a wrong answer, and each is pinned so it cannot do so again.
"""

import pytest

from app.models.review import ReviewReason
from app.parser.base import ExtractedPage, ExtractedPdf, Rule, Word
from app.parser.deterministic import (
    DeterministicQuotationParser,
    cluster_lines,
    in_zone,
)
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from tests.fixtures.build_quotation_pdf import (
    Row,
    inconsistent_row_pdf,
    missing_quantity_pdf,
    quotation_pdf,
    reference_pdf,
    unruled_pdf,
)

parse_pdf = DeterministicQuotationParser()
extract = PdfplumberTextExtractor()


def parse(pdf_bytes: bytes):
    return parse_pdf.parse(extract.extract(pdf_bytes))


# ---- the reference quotation -------------------------------------------


def test_reads_header_fields() -> None:
    result = parse(reference_pdf())

    assert result.quotation.quotation_number == "SAMPLE/00/000000/Rev0"
    assert result.quotation.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert result.quotation.project_name == "SAMPLE TOWER 001"


def test_reads_every_line_item_in_order() -> None:
    result = parse(reference_pdf())

    assert [item.sr for item in result.quotation.items] == ["1", "2", "3"]


@pytest.mark.parametrize(
    ("index", "quantity"),
    [
        # The quantities the ruled QTY cells actually hold. The old text-based
        # parser reported 30 and 55 here, which are the DISCOUNT values, and
        # did not flag either.
        (0, 34.0),
        (1, 88.0),
        (2, 122.0),
    ],
)
def test_quantity_is_read_from_the_ruled_qty_cell(index: int, quantity: float) -> None:
    result = parse(reference_pdf())

    assert result.quotation.items[index].quantity == quantity


def test_units_are_read_from_the_ruled_unit_cell() -> None:
    result = parse(reference_pdf())

    assert [item.unit for item in result.quotation.items] == ["m2", "m2", "m2"]


def test_description_keeps_its_item_code_and_joins_continuation_lines() -> None:
    result = parse(reference_pdf())

    first = result.quotation.items[0].description
    assert first.startswith("FF-01 Sample flooring product")
    assert "Glue down method" in first
    assert "\n" not in first
    assert result.quotation.items[2].description == "Levelling compound up to 3mm"


def test_reference_quotation_needs_no_review() -> None:
    # Every value is legible, so nothing should be sent back to the user.
    result = parse(reference_pdf())

    assert result.review == []


# ---- pages that must not become items -----------------------------------


def test_a_page_without_a_ruled_table_produces_no_items() -> None:
    # The terms page carries numbers but draws no grid. A parser that trusts the
    # flattened text stream invents rows out of payment terms.
    result = parse(reference_pdf())

    assert len(result.quotation.items) == 3


def test_columns_are_not_inferred_when_no_borders_are_drawn() -> None:
    result = parse(unruled_pdf())

    # The header is still readable, but with no rules there is nothing that says
    # where a column starts, so no line item may be invented.
    assert result.quotation.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert result.quotation.items == []
    assert any(flag.field == "items" for flag in result.review)


# ---- arithmetic consistency ---------------------------------------------


def test_a_row_whose_figures_disagree_is_flagged() -> None:
    result = parse(inconsistent_row_pdf())

    flags = {flag.field: flag for flag in result.review}
    assert flags["items[0].quantity"].reason is ReviewReason.INCONSISTENT


def test_a_disagreeing_row_is_reported_not_repaired() -> None:
    # 30 is the DISCOUNT value, not the quantity. The check must surface the
    # doubt and leave the value it read alone; correcting it here would be the
    # guessing that AGENTS.md section 9 forbids.
    result = parse(inconsistent_row_pdf())

    assert result.quotation.items[0].quantity == 30.0
    assert [item.quantity for item in result.quotation.items[1:]] == [88.0, 122.0]


def test_consistent_rows_are_not_flagged() -> None:
    result = parse(reference_pdf())

    assert not [flag for flag in result.review if flag.reason is ReviewReason.INCONSISTENT]


# ---- unreadable values ---------------------------------------------------


def test_unreadable_quantity_is_left_empty_and_flagged() -> None:
    result = parse(missing_quantity_pdf())

    second = result.quotation.items[1]
    assert second.quantity is None
    assert second.unit == "m2"

    flags = {flag.field: flag for flag in result.review}
    assert flags["items[1].quantity"].reason is ReviewReason.MISSING


def test_a_missing_quantity_does_not_borrow_from_another_column() -> None:
    # Row 2's QTY cell is blank while its DISCOUNT cell still holds 55.00.
    result = parse(missing_quantity_pdf())

    assert result.quotation.items[1].quantity != 55.0


def test_missing_header_fields_are_reported_not_guessed() -> None:
    result = parse(quotation_pdf(rows=(), header=()))

    assert result.quotation.quotation_number is None
    assert result.quotation.client_name is None
    assert result.quotation.project_name is None
    assert {"quotation_number", "client_name", "project_name"} <= {
        flag.field for flag in result.review
    }


def test_an_empty_document_does_not_raise() -> None:
    result = parse_pdf.parse(ExtractedPdf())

    assert result.quotation.items == []
    assert result.review


def test_a_page_with_no_words_produces_no_items_and_says_so() -> None:
    document = ExtractedPdf(pages=(ExtractedPage(number=1),))

    result = parse_pdf.parse(document)

    assert result.quotation.items == []
    assert any(flag.field == "items" for flag in result.review)


# ---- quantities and units in general -------------------------------------


def test_a_single_item_quotation_is_read() -> None:
    result = parse(
        quotation_pdf(rows=(Row(1, ("Single item",), 12.5, "pcs"),), with_terms_page=False)
    )

    assert len(result.quotation.items) == 1
    assert result.quotation.items[0].quantity == 12.5
    assert result.quotation.items[0].unit == "pcs"


def test_a_decimal_quantity_is_preserved() -> None:
    result = parse(quotation_pdf(rows=(Row(1, ("Fractional",), 7.5, "m2"),), with_terms_page=False))

    assert result.quotation.items[0].quantity == 7.5


def test_an_unfamiliar_unit_is_kept_verbatim() -> None:
    # Units are not restricted to a closed list: an unfamiliar one must survive
    # rather than be rejected or replaced with a guess.
    result = parse(quotation_pdf(rows=(Row(1, ("Odd unit",), 3.0, "sqm"),), with_terms_page=False))

    assert result.quotation.items[0].unit == "sqm"


def test_a_zero_quantity_is_treated_as_unreadable() -> None:
    # A quotation line never legitimately has a zero quantity, so a zero means
    # the cell was not identified and is sent for review instead of written out.
    result = parse(quotation_pdf(rows=(Row(1, ("Nothing",), 0.0, "m2"),), with_terms_page=False))

    assert result.quotation.items[0].quantity is None
    assert any(flag.field == "items[0].quantity" for flag in result.review)


def test_an_empty_description_is_flagged() -> None:
    result = parse(quotation_pdf(rows=(Row(1, (), 4.0, "m2"),), with_terms_page=False))

    assert result.quotation.items[0].description == ""
    assert any(flag.field == "items[0].description" for flag in result.review)


def test_duplicate_sr_numbers_are_preserved_not_merged() -> None:
    rows = (Row(1, ("First item",), 5.0, "m2"), Row(2, ("Second item",), 6.0, "m2"))
    result = parse(quotation_pdf(rows=rows, with_terms_page=False))

    # Both rows are kept, in order, and neither swallows the other.
    assert [item.description for item in result.quotation.items] == [
        "First item",
        "Second item",
    ]


def test_a_description_line_starting_with_a_number_is_not_a_new_item() -> None:
    rows = (Row(1, ("(900mm to 3000mm)", "Boards"), 12.0, "m2"),)
    result = parse(quotation_pdf(rows=rows, with_terms_page=False))

    assert len(result.quotation.items) == 1
    assert "900mm to 3000mm" in result.quotation.items[0].description


# ---- the tolerances the real document forces -----------------------------


def test_a_column_boundary_is_compared_with_a_tolerance() -> None:
    # In the reference quotation the QTY value sits at x=300.0 while the QTY cell
    # begins at 300.00000000000006. The natural test 300.0 >= 300.00000000000006
    # is False, so an exact comparison silently loses quantities.
    edge = 300.00000000000006

    assert not edge <= 300.0, "the exact comparison this guards against is False"
    assert in_zone(300.0, (edge, 364.0))


def test_a_value_just_outside_a_cell_is_not_claimed() -> None:
    assert not in_zone(290.0, (300.0, 364.0))


def test_words_a_fraction_of_a_point_apart_stay_on_one_line() -> None:
    # The left and right halves of the real header sit on baselines 0.2pt apart.
    words = (
        Word("Project", 354.0, 380.0, 121.0, 129.0),
        Word("Nbr", 394.0, 412.0, 121.2, 129.2),
    )

    assert len(cluster_lines(words)) == 1


def test_words_on_different_rows_stay_on_different_lines() -> None:
    words = (
        Word("first", 42.0, 60.0, 121.0, 129.0),
        Word("second", 42.0, 60.0, 162.0, 170.0),
    )

    assert len(cluster_lines(words)) == 2


def test_a_table_is_found_when_its_rules_start_at_the_band_edge() -> None:
    # The reference quotation's vertical rules begin exactly on the header band's
    # top edge, so a strict "starts above the band" test finds no table at all.
    rules = (
        Rule(24.0, 576.0, 266.8, 266.8),
        Rule(24.0, 576.0, 296.8, 296.8),
        Rule(24.0, 576.0, 605.95, 605.95),
        Rule(40.25, 40.25, 296.8, 605.95),
        Rule(296.0, 296.0, 296.8, 605.95),
        Rule(364.25, 364.25, 296.8, 605.95),
        Rule(422.75, 422.75, 296.8, 605.95),
    )
    words = (
        Word("SR#", 32.0, 40.0, 274.0, 282.0),
        Word("DESCRIPTION", 144.0, 210.0, 274.0, 282.0),
        Word("QTY", 300.0, 316.0, 274.0, 282.0),
        Word("UNIT", 336.0, 356.0, 274.0, 282.0),
    )
    document = ExtractedPdf(pages=(ExtractedPage(number=1, words=words, rules=rules),))

    table = parse_pdf._find_item_table(document.pages[0])

    assert table is not None
    assert table.body_band == (296.8, 605.95)
