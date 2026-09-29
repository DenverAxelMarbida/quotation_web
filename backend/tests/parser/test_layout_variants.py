"""Regressions for the ERP quotation layouts found by validating real documents.

The reference layout in ``test_deterministic.py`` is the one the parser was built
against. Reading four real quotations turned up column layouts and page shapes it
had never seen, and each of them produced a wrong answer rather than an error:

* one ruled cell holding a quantity and a unit under a single ``QTY/UNIT`` label
* a price column called ``PRICE/AED`` rather than ``PRICE/UNIT``
* a grid carrying on over the top of the next page with no repeated column header
* a description that runs over a page break
* a ruled item grid whose column names the parser cannot map

The first four are cases the parser should simply handle. The last is a case it
cannot handle, and the one thing it must never do is return an empty quotation
with nothing to show: the grid is plainly there, so it has to be reported for
review.

The real values behind each of these are in the validation report and in
``UPDATED_DETAILS.md``. The fixtures here are generated, with invented strings, so
none of this needs a confidential document to be tested.
"""

from app.models.review import ReviewReason
from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from tests.fixtures.build_quotation_pdf import (
    combined_qty_unit_pdf,
    continuation_pdf,
    mismatched_columns_pdf,
    six_column_pdf,
    unmappable_grid_pdf,
)

parse_pdf = DeterministicQuotationParser()
extract = PdfplumberTextExtractor()


def parse(pdf_bytes: bytes):
    return parse_pdf.parse(extract.extract(pdf_bytes))


def flags_for(result, field: str) -> list:
    return [flag for flag in result.review if flag.field == field]


# ---- a quantity and a unit under one combined label -----------------------


def test_a_combined_qty_unit_header_is_recognised_as_the_item_table() -> None:
    # The single "QTY/UNIT" token matched no known column, so the whole table was
    # passed over and the quotation came back empty.
    result = parse(combined_qty_unit_pdf())

    assert len(result.quotation.items) == 2
    assert [item.sr for item in result.quotation.items] == ["1", "2"]
    assert not flags_for(result, "items")


def test_the_shared_cell_splits_into_a_quantity_and_a_unit() -> None:
    # The cell is ruled once but holds two values, the quantity left of the label's
    # centre and the unit right of it. The count is checked first so this cannot
    # pass by iterating over nothing.
    result = parse(combined_qty_unit_pdf())

    assert len(result.quotation.items) == 2
    for item in result.quotation.items:
        assert item.quantity == 200.0
        assert item.unit == "m2"


def test_a_layout_with_no_total_column_reports_no_arithmetic_problem() -> None:
    # There is no TOTAL column in this layout, so the quantity-times-net-price
    # check has nothing to check and must stand down rather than complain.
    result = parse(combined_qty_unit_pdf())

    assert not [flag for flag in result.review if flag.reason is ReviewReason.INCONSISTENT]


def test_price_aed_is_read_as_the_price_column() -> None:
    # Making the net price disagree with price-minus-discount is the only way to
    # see that "PRICE/AED" was understood: if it were not mapped, no check would
    # run and no flag would appear.
    result = parse(combined_qty_unit_pdf(net_prices=("3900.00", "2500.00")))

    assert [flag.field for flag in result.review if flag.reason is ReviewReason.INCONSISTENT] == [
        "items[0].quantity"
    ]


# ---- a header that does not depend on the item table ---------------------


def test_the_header_is_read_when_the_item_table_cannot_be_found() -> None:
    # Header fields and the item table are separate blocks of the page. A table
    # the parser cannot read must not cost the header as well.
    result = parse(unmappable_grid_pdf())

    assert result.quotation.quotation_number == "SAMPLE/00/000000/Rev0"
    assert result.quotation.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert not flags_for(result, "quotation_number")
    assert not flags_for(result, "client_name")


def test_a_genuinely_absent_header_field_stays_null_and_flagged() -> None:
    # This document has no project, and none may be invented for it.
    result = parse(unmappable_grid_pdf())

    assert result.quotation.project_name is None
    assert [flag.reason for flag in flags_for(result, "project_name")] == [ReviewReason.MISSING]


# ---- a grid that carries on over the next page ----------------------------


def test_a_table_that_continues_onto_the_next_page_is_read_in_full() -> None:
    # Page 2 repeats no column header, so the columns had to be carried across
    # from page 1. Without that the page returned nothing and item 4 was lost.
    result = parse(continuation_pdf())

    assert [item.sr for item in result.quotation.items] == ["1", "2", "3", "4"]


def test_the_continuation_page_reads_quantities_and_units_from_the_same_columns() -> None:
    result = parse(continuation_pdf())

    assert [(item.quantity, item.unit) for item in result.quotation.items] == [
        (153.0, "m2"),
        (18.0, "STEP"),
        (3.0, "m2"),
        (3.0, "STEP"),
    ]


def test_an_ordinary_terms_page_adds_nothing() -> None:
    # Page 3 is a terms page with one rule. It must not be read as more of the
    # table, and it must not be reported as a grid in need of review either.
    result = parse(continuation_pdf())

    assert len(result.quotation.items) == 4
    assert not flags_for(result, "items")


def test_a_grid_whose_columns_do_not_match_is_not_read_as_a_continuation() -> None:
    # Matching on "this page has vertical rules" alone would invent items out of
    # any ruled content that happened to follow the table.
    result = parse(mismatched_columns_pdf())

    assert [item.sr for item in result.quotation.items] == ["1", "2", "3"]
    assert "Some unrelated ruled content" not in " ".join(
        item.description for item in result.quotation.items
    )


def test_ruled_content_after_a_read_table_raises_no_warning() -> None:
    # The unreadable-grid report is for the one failure that would otherwise be
    # silent: a grid there, read as nothing. A quotation that did read its items
    # must not be sent for review over a signature block further down the page.
    result = parse(mismatched_columns_pdf())

    assert result.quotation.items
    assert not flags_for(result, "items")


# ---- a description that runs over a page break ---------------------------


def test_a_description_continues_across_the_page_break() -> None:
    # Item 3's description was cut off mid-sentence at the foot of page 1 and
    # finished at the top of page 2 with no SR# of its own.
    result = parse(continuation_pdf())

    assert result.quotation.items[2].description == (
        "Landing Sample third product Lengths are random "
        "Colour to match the approved sample Straight installation Glue down method"
    )


def test_the_continuation_lines_are_not_attached_to_the_next_item() -> None:
    # The carry-over belongs to the row above it, not to the row that follows.
    result = parse(continuation_pdf())

    assert result.quotation.items[3].description == (
        "L-shape steps Sample fourth product Glue down method"
    )


# ---- a grid the parser cannot read ---------------------------------------


def test_an_unreadable_grid_is_reported_rather_than_passed_over() -> None:
    # The quiet failure this replaces returned an empty quotation and nothing
    # else, so the person reviewing it could not tell the document had been read.
    result = parse(unmappable_grid_pdf())

    assert result.quotation.items == []
    assert [flag.reason for flag in flags_for(result, "items")] == [ReviewReason.UNCONFIDENT]
    assert "page 1" in flags_for(result, "items")[0].message


def test_an_unreadable_grid_does_not_stop_the_header_being_reported() -> None:
    result = parse(unmappable_grid_pdf())

    assert result.quotation.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert result.quotation.quotation_number == "SAMPLE/00/000000/Rev0"


# ---- a layout with fewer columns -----------------------------------------


def test_a_layout_without_a_discount_or_net_price_column_reads_without_flags() -> None:
    # This layout has a unit price and a row total and nothing else to check the
    # figures against, which is the case that once produced a false alarm.
    result = parse(six_column_pdf())

    assert [(item.sr, item.quantity, item.unit) for item in result.quotation.items] == [
        ("1", 46.0, "m2")
    ]
    assert not [flag for flag in result.review if flag.reason is ReviewReason.INCONSISTENT]
