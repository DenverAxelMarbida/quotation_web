"""Regressions for the borderless ERP quotation layout.

One real quotation draws its item grid with horizontal rules only: there are no
vertical dividers, so a parser that reads column boundaries from ruled cells
finds no table at all and returns an empty quotation. The columns exist only in
the alignment of the text, under a header band whose labels start them.

The real document also carries a section heading, a subtotal and a notes block
on the same pages, and its grid runs over a page break with no repeated header.
None of those may become a line item or leak into a description.

The values here are invented; the geometry mirrors the real document. The real
values are recorded in the validation report and in ``UPDATED_DETAILS.md``.
"""

from app.models.review import ReviewReason
from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from tests.fixtures.build_quotation_pdf import borderless_pdf

parse_pdf = DeterministicQuotationParser()
extract = PdfplumberTextExtractor()


def parse(pdf_bytes: bytes):
    return parse_pdf.parse(extract.extract(pdf_bytes))


def test_a_grid_with_no_vertical_rules_is_still_read() -> None:
    # With no ruled cells there is no table to find, so the whole quotation came
    # back empty. The columns have to come from the header labels instead.
    result = parse(borderless_pdf())

    assert [item.sr for item in result.quotation.items] == [
        "1.1",
        "1.64",
        "1.67",
        "2.42",
        "9.133",
        "1.130",
        "7.90",
    ]


def test_the_header_is_read_from_a_borderless_page() -> None:
    result = parse(borderless_pdf())

    assert result.quotation.quotation_number == "SAMPLE/00/000000/Rev0"
    assert result.quotation.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert result.quotation.project_name == "SAMPLE TOWER 001"


def test_the_quantity_comes_from_the_qty_cell_not_the_discount() -> None:
    # Row 1.1 holds 34.00 in its quantity cell and 50.00 in its discount cell.
    # Reading the flattened text stream reports the discount as the quantity.
    result = parse(borderless_pdf())

    assert result.quotation.items[0].quantity == 34.0
    assert result.quotation.items[0].unit == "m2"


def test_quantities_and_units_survive_the_hierarchical_sr_numbers() -> None:
    result = parse(borderless_pdf())

    assert [(item.quantity, item.unit) for item in result.quotation.items] == [
        (34.0, "m2"),
        (33.0, "L.M."),
        (33.0, "L.M."),
        (1897.0, "m2"),
        (31547.0, "m2"),
        (120.0, "L.M."),
        (64.0, "m2"),
    ]


def test_a_hierarchical_sr_is_kept_as_written() -> None:
    result = parse(borderless_pdf())

    assert result.quotation.items[0].sr == "1.1"
    assert result.quotation.items[4].sr == "9.133"


def test_a_trailing_zero_in_an_sr_survives() -> None:
    # The SR# is an ERP identifier, not a number. Read as a number, 1.130 and
    # 7.90 come back as 1.13 and 7.9, which no longer match the document.
    result = parse(borderless_pdf())

    assert result.quotation.items[5].sr == "1.130"
    assert result.quotation.items[6].sr == "7.90"


def test_a_section_heading_is_not_a_line_item() -> None:
    # "1 SECTION ONE GROUP - 33 VILLAS" has a leading integer but no figures, so
    # it must not become a row.
    result = parse(borderless_pdf())

    assert all(item.sr not in ("1", "3") for item in result.quotation.items)
    assert not any("SECTION" in item.description for item in result.quotation.items)


def test_a_subtotal_is_neither_an_item_nor_appended_to_the_row_above() -> None:
    result = parse(borderless_pdf())

    assert len(result.quotation.items) == 7
    assert not any("Total" in item.description for item in result.quotation.items)


def test_a_notes_block_is_not_appended_to_the_last_item() -> None:
    # The notes sit inside the last row's ruled block, so only the size of the
    # gap between the description and the notes keeps them apart.
    result = parse(borderless_pdf())

    description = result.quotation.items[4].description
    assert description == "Self Levelling Up to 2-3mm thickness (Excluding the stairs)"
    assert "NOTE" not in description
    assert "Quantity is provided" not in description


def test_a_description_is_joined_across_its_lines() -> None:
    result = parse(borderless_pdf())

    description = result.quotation.items[0].description
    assert description.startswith("WF-01AR Supply and installation")
    assert "Glue down method" in description
    assert "\n" not in description


def test_a_description_continues_across_the_page_break() -> None:
    # Item 1.67 prints no description on page 1; it finishes at the top of
    # page 2 with no SR# of its own.
    result = parse(borderless_pdf())

    assert result.quotation.items[2].description == (
        "Threshold Supply and installation Threshold Width: 190mm"
    )


def test_the_continuation_lines_are_not_attached_to_the_next_item() -> None:
    result = parse(borderless_pdf())

    assert result.quotation.items[3].description == ("WF-01 W Engineered flooring Glue down method")


def test_a_clean_borderless_quotation_needs_no_review() -> None:
    result = parse(borderless_pdf())

    assert result.review == []
    assert not [flag for flag in result.review if flag.reason is ReviewReason.UNCONFIDENT]
