"""Tests for the openpyxl Excel workbook generator.

Verifies that the generator:
- Creates valid .xlsx workbooks
- Maps quotation fields to the agreed column structure
- Leaves manual operational fields blank
- Writes one row per quotation item
- Applies status formatting when present
- Uses correct sheet name and column order
"""

import inspect
import math
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from app.excel.openpyxl_generator import OpenpyxlWorkbookGenerator
from app.models.monitor import ImportedMonitorRow
from app.models.quotation import Quotation, QuotationItem
from app.models.workbook import ConfirmedQuotation, ConsolidatedWorkbookRequest


def _quotation(
    client: str,
    project: str,
    items: list[tuple[int, str, float, str]],
    number: str = "Q/1",
) -> Quotation:
    return Quotation(
        quotation_number=number,
        client_name=client,
        project_name=project,
        items=[
            # The SR# is an identifier, so it reaches the model as printed text.
            QuotationItem(sr=str(sr), description=desc, quantity=qty, unit=unit)
            for sr, desc, qty, unit in items
        ],
    )


def _consolidated(*pairs: tuple[str, Quotation]) -> ConsolidatedWorkbookRequest:
    return ConsolidatedWorkbookRequest(
        quotations=[ConfirmedQuotation(sequence_number=seq, quotation=q) for seq, q in pairs]
    )


def _summary(xlsx_bytes: bytes):
    return load_workbook(BytesIO(xlsx_bytes))["Summary"]


def test_consolidated_one_quotation_one_item():
    """A single quotation with a single item produces one data row."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(("001", _quotation("Client A", "Project A", [(1, "Item", 10.0, "m2")])))

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 2  # header + 1
    assert sheet.cell(row=2, column=1).value == "001"


def test_consolidated_one_quotation_multiple_items():
    """All items of one quotation are written, each sharing the sequence number."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        (
            "001",
            _quotation(
                "Client A",
                "Project A",
                [(1, "A", 10.0, "m2"), (2, "B", 20.0, "m2"), (3, "C", 30.0, "m2")],
            ),
        )
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 4
    assert [sheet.cell(row=r, column=1).value for r in range(2, 5)] == [
        "001",
        "001",
        "001",
    ]


def test_consolidated_multiple_quotations_multiple_items_row_count():
    """Row count equals the sum of all items across all quotations."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        (
            "001",
            _quotation(
                "Client A",
                "Project A",
                [
                    (1, "A1", 1.0, "m2"),
                    (2, "A2", 2.0, "m2"),
                    (3, "A3", 3.0, "m2"),
                    (4, "A4", 4.0, "m2"),
                ],
            ),
        ),
        ("002", _quotation("Client B", "Project B", [(1, "B1", 5.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 6  # header + 5
    assert [sheet.cell(row=r, column=1).value for r in range(2, 7)] == [
        "001",
        "001",
        "001",
        "001",
        "002",
    ]


def test_consolidated_sequence_number_shared_and_distinct():
    """Every item of one quotation shares its sequence; quotations differ."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        ("001", _quotation("Client A", "Project A", [(1, "A1", 1.0, "m2"), (2, "A2", 2.0, "m2")])),
        ("002", _quotation("Client B", "Project B", [(1, "B1", 3.0, "m2")])),
        ("003", _quotation("Client C", "Project C", [(1, "C1", 4.0, "m2"), (2, "C2", 5.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    sequence_column = [sheet.cell(row=r, column=1).value for r in range(2, sheet.max_row + 1)]
    assert sequence_column == ["001", "001", "002", "003", "003"]


def test_consolidated_preserves_leading_zeroes():
    """A sequence number stays a string, so '001' is not coerced to 1."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(("007", _quotation("Client A", "Project A", [(1, "A", 1.0, "m2")])))

    sheet = _summary(generator.generate_consolidated(request))

    value = sheet.cell(row=2, column=1).value
    assert value == "007"
    assert isinstance(value, str)


def test_consolidated_field_mapping_and_blank_manual_fields():
    """Client/project/description/quantity/unit map; manual columns stay blank."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        (
            "001",
            _quotation(
                "ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C",
                "MBRC 466",
                [(1, "Engineered Oak Flooring", 34.0, "m2")],
            ),
        )
    )

    sheet = _summary(generator.generate_consolidated(request))
    row = [sheet.cell(row=2, column=c).value for c in range(1, 10)]

    assert row[0] == "001"
    assert row[1] == "ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C"
    assert row[2] == "MBRC 466"
    assert row[3] == "Engineered Oak Flooring"
    assert row[4] == 34
    assert row[5] == "m2"
    assert row[6] is None  # Installation Schedule
    assert row[7] is None  # Start Date
    assert row[8] is None  # Status


def test_consolidated_preserves_quotation_and_item_order():
    """Quotations keep add order; items keep SR# order within a quotation."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        ("001", _quotation("First", "P1", [(1, "first-1", 1.0, "m2"), (2, "first-2", 2.0, "m2")])),
        ("002", _quotation("Second", "P2", [(1, "second-1", 3.0, "m2")])),
        ("003", _quotation("Third", "P3", [(1, "third-1", 4.0, "m2"), (2, "third-2", 5.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    clients = [sheet.cell(row=r, column=2).value for r in range(2, sheet.max_row + 1)]
    descriptions = [sheet.cell(row=r, column=4).value for r in range(2, sheet.max_row + 1)]

    assert clients == ["First", "First", "Second", "Third", "Third"]
    assert descriptions == ["first-1", "first-2", "second-1", "third-1", "third-2"]


def test_consolidated_no_item_loss():
    """Every item of every quotation appears exactly once."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(
        (
            "001",
            _quotation(
                "A",
                "P1",
                [
                    (1, "a1", 1.0, "m2"),
                    (2, "a2", 2.0, "m2"),
                    (3, "a3", 3.0, "m2"),
                    (4, "a4", 4.0, "m2"),
                ],
            ),
        ),
        ("002", _quotation("B", "P2", [(1, "b1", 5.0, "m2")])),
        ("003", _quotation("C", "P3", [(1, "c1", 6.0, "m2"), (2, "c2", 7.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    descriptions = [sheet.cell(row=r, column=4).value for r in range(2, sheet.max_row + 1)]
    assert sorted(descriptions) == sorted(["a1", "a2", "a3", "a4", "b1", "c1", "c2"])
    assert len(descriptions) == 7


def test_consolidated_summary_columns_unchanged():
    """The consolidated sheet keeps the exact agreed header order."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(("001", _quotation("A", "P1", [(1, "a1", 1.0, "m2")])))

    summary = _summary(generator.generate_consolidated(request))

    assert summary.title == "Summary"
    assert [cell.value for cell in summary[1]] == [
        "Sequence Number",
        "Client Name",
        "Project Name",
        "Product Description",
        "Quantity",
        "Unit of Measurement",
        "Installation Schedule",
        "Start Date",
        "Completion Date",
        "Status",
    ]


def test_generates_valid_xlsx_workbook():
    """The generator returns valid .xlsx bytes that openpyxl can read."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Test item", quantity=10, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)

    # Should be able to load the workbook
    assert xlsx_bytes
    workbook = load_workbook(BytesIO(xlsx_bytes))
    assert workbook is not None


def test_creates_summary_worksheet():
    """The workbook contains a worksheet named 'Summary'."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Test item", quantity=10, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))

    assert "Summary" in workbook.sheetnames
    assert workbook.active.title == "Summary"


def test_writes_correct_header_row():
    """The Summary sheet has headers in the exact agreed order."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Test item", quantity=10, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Read header row
    headers = [cell.value for cell in sheet[1]]

    expected_headers = [
        "Sequence Number",
        "Client Name",
        "Project Name",
        "Product Description",
        "Quantity",
        "Unit of Measurement",
        "Installation Schedule",
        "Start Date",
        "Completion Date",
        "Status",
    ]

    assert headers == expected_headers


def test_maps_quotation_fields_correctly():
    """Quotation fields map to the correct columns."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="QDXB/25/014094/Rev1",
        client_name="ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C",
        project_name="MBRC 466",
        items=[
            QuotationItem(
                sr="1",
                description="Engineered Oak Flooring 15/4 x 120 x 600mm",
                quantity=34,
                unit="m2",
            )
        ],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Row 2 is the first data row (row 1 is headers)
    row = list(sheet[2])

    assert row[0].value is None  # Sequence Number - blank
    assert row[1].value == "ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C"
    assert row[2].value == "MBRC 466"
    assert row[3].value == "Engineered Oak Flooring 15/4 x 120 x 600mm"
    assert row[4].value == 34
    assert row[5].value == "m2"
    assert row[6].value is None  # Installation Schedule - blank
    assert row[7].value is None  # Start Date - blank
    assert row[8].value is None  # Status - blank


def test_handles_null_fields():
    """Null quotation fields are written as empty cells."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number=None,
        client_name=None,
        project_name=None,
        items=[QuotationItem(sr=None, description="", quantity=None, unit=None)],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    row = list(sheet[2])

    assert row[0].value is None  # Sequence Number
    assert row[1].value is None  # Client Name
    assert row[2].value is None  # Project Name
    # openpyxl writes empty strings as None
    assert row[3].value in ("", None)  # Product Description (empty string)
    assert row[4].value is None  # Quantity
    assert row[5].value is None  # Unit


def test_writes_one_row_per_item_single_item():
    """A single-item quotation produces one data row."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Item 1", quantity=10, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Row 1 is headers, row 2 is data
    assert sheet.max_row == 2


def test_writes_one_row_per_item_multiple_items():
    """A multi-item quotation produces one row per item."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="QDXB/25/014094/Rev1",
        client_name="ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C",
        project_name="MBRC 466",
        items=[
            QuotationItem(sr="1", description="Flooring 15/4", quantity=34, unit="m2"),
            QuotationItem(sr="2", description="Flooring 16/4", quantity=88, unit="m2"),
            QuotationItem(sr="3", description="Self-levelling", quantity=122, unit="m2"),
        ],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Row 1 is headers, rows 2-4 are data
    assert sheet.max_row == 4

    # Verify each item is present
    assert sheet.cell(row=2, column=4).value == "Flooring 15/4"
    assert sheet.cell(row=2, column=5).value == 34

    assert sheet.cell(row=3, column=4).value == "Flooring 16/4"
    assert sheet.cell(row=3, column=5).value == 88

    assert sheet.cell(row=4, column=4).value == "Self-levelling"
    assert sheet.cell(row=4, column=5).value == 122


def test_all_items_share_same_quotation_fields():
    """All rows from one quotation share the same client/project."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Shared Client",
        project_name="Shared Project",
        items=[
            QuotationItem(sr="1", description="Item 1", quantity=10, unit="m2"),
            QuotationItem(sr="2", description="Item 2", quantity=20, unit="m2"),
        ],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Both rows should have the same client and project
    assert sheet.cell(row=2, column=2).value == "Shared Client"
    assert sheet.cell(row=2, column=3).value == "Shared Project"

    assert sheet.cell(row=3, column=2).value == "Shared Client"
    assert sheet.cell(row=3, column=3).value == "Shared Project"


def test_no_items_produces_headers_only():
    """A quotation with no items produces only the header row."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # Only headers, no data rows
    assert sheet.max_row == 1


def _status_rules(sheet):
    """Return every Status conditional-formatting rule as (range, rule) pairs."""
    matches = []
    for rng in sheet.conditional_formatting:
        for rule in rng.rules:
            if rule.type == "expression":
                matches.append((str(rng.sqref), rule))
    return matches


def test_status_conditional_formatting_covers_the_whole_row():
    """Status colours the whole row A:J via dynamic conditional formatting."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Item", quantity=1, unit="m2")],
    )

    workbook = load_workbook(BytesIO(generator.generate(quotation)))
    sheet = workbook["Summary"]

    expected = {
        "On Hold": ("FFC7CE", "9C0006"),
        "Ongoing": ("FFD966", "7F6000"),
        "Completed": ("C6EFCE", "006100"),
    }

    rules = _status_rules(sheet)
    # Exactly one rule for each of the three status values.
    assert len(rules) == 3

    expected_range = f"A2:J{sheet.max_row + OpenpyxlWorkbookGenerator.BUFFER_ROWS}"

    for value, (fill_color, font_color) in expected.items():
        matches = [
            (rng, rule) for rng, rule in rules if any(f'$J2="{value}"' == f for f in rule.formula)
        ]
        assert matches, f"missing conditional rule for {value}"
        rng, rule = matches[0]
        # Applied across the whole row A:J, not only the Status column.
        assert rng == expected_range
        assert rng.startswith("A2:J")
        # The formula pins the Status column with $J and moves down the rows.
        assert rule.formula == [f'$J2="{value}"']
        assert rule.dxf.fill.start_color.rgb.endswith(fill_color)
        assert rule.dxf.font.color.rgb.endswith(font_color)

    # No cell carries a static fill; the colour is the rule's job, so it stays
    # dynamic when the Status changes with the dates.
    for col in range(1, 11):
        assert sheet.cell(row=2, column=col).fill.fgColor.rgb in (None, "00000000")


def test_the_status_column_has_no_dropdown():
    """Status cannot be chosen, because it is not a choice.

    There used to be a list validation here offering On Hold, Ongoing and
    Completed. Status now follows from the three operational fields, so a
    dropdown would let somebody disagree with the dates in the same row -- and
    the value they typed would be overwritten the next time the workbook was
    opened anyway. Only date validation remains.
    """
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Item", quantity=1, unit="m2")],
    )

    workbook = load_workbook(BytesIO(generator.generate(quotation)))
    sheet = workbook["Summary"]

    list_rules = [dv for dv in sheet.data_validations.dataValidation if dv.type == "list"]
    assert list_rules == []
    # Nothing is offered anywhere else either -- no prompt on the Status cells.
    for validation in sheet.data_validations.dataValidation:
        assert str(validation.sqref) != "I2" and not str(validation.sqref).startswith("J2")


def test_preserves_multiline_descriptions():
    """Multi-line descriptions are preserved in Excel cells."""
    generator = OpenpyxlWorkbookGenerator()
    multiline_desc = "Engineered Oak Flooring\n15/4 x 120 x 600mm\nAB grade\nHerringbone Cut"
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description=multiline_desc, quantity=34, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    # The description should preserve newlines
    assert sheet.cell(row=2, column=4).value == multiline_desc


def test_handles_decimal_quantities():
    """Decimal quantities are preserved accurately."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Item", quantity=34.5, unit="m2")],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    assert sheet.cell(row=2, column=5).value == 34.5


def test_handles_special_characters_in_fields():
    """Special characters in quotation fields are handled correctly."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="QDXB/25/014094/Rev1",
        client_name="Client & Co., L.L.C",
        project_name="Project #123 - Phase 1",
        items=[
            QuotationItem(
                sr="1",
                description='Item with "quotes" and & special chars',
                quantity=10,
                unit="m²",  # Unicode character
            )
        ],
    )

    xlsx_bytes = generator.generate(quotation)
    workbook = load_workbook(BytesIO(xlsx_bytes))
    sheet = workbook["Summary"]

    assert sheet.cell(row=2, column=2).value == "Client & Co., L.L.C"
    assert sheet.cell(row=2, column=3).value == "Project #123 - Phase 1"
    assert sheet.cell(row=2, column=4).value == 'Item with "quotes" and & special chars'
    assert sheet.cell(row=2, column=6).value == "m²"


# --- Workbook usability, validation and formatting ---------------------------


@pytest.fixture
def sample_workbook():
    """A one-quotation workbook used by the formatting tests."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description="Item", quantity=2, unit="m2")],
    )
    return load_workbook(BytesIO(generator.generate(quotation)))


def test_column_widths_are_set_for_every_column(sample_workbook):
    sheet = sample_workbook["Summary"]
    for col_idx, column_name in enumerate(OpenpyxlWorkbookGenerator.COLUMNS, start=1):
        letter = get_column_letter(col_idx)
        assert (
            sheet.column_dimensions[letter].width
            == (OpenpyxlWorkbookGenerator.COLUMN_WIDTHS[column_name])
        )


def _lines_for(description: str) -> int:
    """The number of visual lines the generator expects this description to need."""
    width = int(OpenpyxlWorkbookGenerator.COLUMN_WIDTHS["Product Description"])
    chars_per_line = max(10, width - 2)
    return sum(max(1, math.ceil(len(part) / chars_per_line)) for part in description.split("\n"))


def _sheet_for(description: str):
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr="1", description=description, quantity=1, unit="m2")],
    )
    return load_workbook(BytesIO(generator.generate(quotation)))["Summary"]


# A real description from the ERP sample, kept verbatim as the reference case.
ERP_DESCRIPTION = (
    "FF-04 Supply and installation FL/1000217 Engineered Oak Flooring, "
    "Dimensions: 15/4 x 120 x 600mm, AB grade, micro beveled 4 sides "
    "Herringbone Cut. Color to match the approved sample "
    "Glue down method Including wastage."
)


def test_product_description_wraps_left_and_top_aligned():
    sheet = _sheet_for(ERP_DESCRIPTION)
    cell = sheet.cell(row=2, column=4)
    assert cell.alignment.wrap_text is True
    assert cell.alignment.horizontal == "left"
    assert cell.alignment.vertical == "top"


def test_product_description_value_round_trips_exactly():
    """The stored value is the extracted text, untouched, for Excel to wrap.

    No truncation, no ellipsis, no substring, and no newline is inserted into
    the value for the sake of looks: wrapping is Excel's job, not ours.
    """
    sheet = _sheet_for(ERP_DESCRIPTION)
    assert sheet.cell(row=2, column=4).value == ERP_DESCRIPTION
    assert len(sheet.cell(row=2, column=4).value) == len(ERP_DESCRIPTION)


def test_erp_description_row_is_tall_enough_to_show_every_line():
    sheet = _sheet_for(ERP_DESCRIPTION)
    cell = sheet.cell(row=2, column=4)
    assert cell.alignment.wrap_text is True
    assert _lines_for(ERP_DESCRIPTION) > 1
    assert sheet.row_dimensions[2].height == (
        OpenpyxlWorkbookGenerator.LINE_HEIGHT * _lines_for(ERP_DESCRIPTION)
    )


def test_short_description_leaves_the_row_at_excel_default_height():
    sheet = _sheet_for("Self-levelling up to 3mm")
    assert sheet.cell(row=2, column=4).alignment.wrap_text is True
    assert sheet.row_dimensions[2].height is None


def test_embedded_newlines_are_preserved_verbatim_and_still_wrap():
    """Newlines the parser already produced are kept, and each one is its own line."""
    description = "Supply and installation\nEngineered Oak Flooring\nHerringbone Cut"
    sheet = _sheet_for(description)
    cell = sheet.cell(row=2, column=4)

    assert cell.value == description
    assert cell.value.count("\n") == 2
    assert cell.alignment.wrap_text is True
    assert sheet.row_dimensions[2].height == (OpenpyxlWorkbookGenerator.LINE_HEIGHT * 3)


def test_very_long_description_row_height_is_not_capped():
    """A description needing many lines must not be cut off at an arbitrary cap.

    The whole point of the row height is that the full text stays readable, so
    the height has to grow with the description rather than stop at some ceiling.
    """
    long_desc = "Engineered Oak Flooring " * 60
    lines = _lines_for(long_desc)
    assert lines > 8, "fixture must need more lines than a small cap would allow"

    sheet = _sheet_for(long_desc)
    assert sheet.cell(row=2, column=4).value == long_desc
    assert sheet.row_dimensions[2].height == (OpenpyxlWorkbookGenerator.LINE_HEIGHT * lines)
    assert sheet.row_dimensions[2].height > OpenpyxlWorkbookGenerator.LINE_HEIGHT * 8


def test_freeze_panes_locks_the_header(sample_workbook):
    assert sample_workbook["Summary"].freeze_panes == "A2"


def test_auto_filter_covers_header_and_data(sample_workbook):
    assert sample_workbook["Summary"].auto_filter.ref == "A1:J2"


def test_sequence_number_is_stored_and_formatted_as_text():
    generator = OpenpyxlWorkbookGenerator()
    request = ConsolidatedWorkbookRequest(
        quotations=[
            ConfirmedQuotation(
                sequence_number="001",
                quotation=Quotation(
                    quotation_number="TEST/001",
                    client_name="Test Client",
                    project_name="Test Project",
                    items=[QuotationItem(sr="1", description="Item", quantity=1, unit="m2")],
                ),
            )
        ]
    )

    sheet = load_workbook(BytesIO(generator.generate_consolidated(request)))["Summary"]
    cell = sheet.cell(row=2, column=1)
    assert cell.value == "001"
    assert cell.number_format == "@"


def test_date_columns_use_the_agreed_format(sample_workbook):
    sheet = sample_workbook["Summary"]
    expected = OpenpyxlWorkbookGenerator.DATE_FORMAT
    # Installation Schedule, Start Date, Completion Date. Completion Date follows
    # Start Date exactly: same format, same alignment, same blank start.
    for col in (7, 8, 9):
        cell = sheet.cell(row=2, column=col)
        assert cell.number_format == expected
        assert cell.value is None


def test_date_cells_have_date_data_validation(sample_workbook):
    sheet = sample_workbook["Summary"]
    date_rules = [dv for dv in sheet.data_validations.dataValidation if dv.type == "date"]
    assert len(date_rules) == 1
    rule = date_rules[0]
    assert rule.allow_blank is True
    ref = str(rule.sqref)
    # All three operational columns are constrained: G, H and I as one range.
    assert ref.startswith("G2:I"), ref
    # And Status, in column J, is not one of them.
    assert "J" not in ref


def test_the_operational_dates_remain_blank_on_a_new_row(sample_workbook):
    """A quotation supplies no dates, so none is invented for it."""
    sheet = sample_workbook["Summary"]
    for col in (7, 8, 9):  # Installation Schedule, Start Date, Completion Date
        assert sheet.cell(row=2, column=col).value is None


def test_a_new_row_reports_the_status_that_follows_from_blank_dates(sample_workbook):
    """Three empty operational fields mean one thing: the work is on hold.

    The Status column used to be left blank for the user to choose from a
    dropdown. Nothing is left to choose now, and a blank row would read as
    "not yet decided" when the honest answer is already known.
    """
    sheet = sample_workbook["Summary"]
    assert sheet.cell(row=2, column=10).value == "On Hold"


# ---------------------------------------------------------------------------
# Phase 5C-B1: a workbook the user already opened, plus new quotations.
#
# The mother keeps the monitoring file in OneDrive and comes back to it later.
# Opening it shows the rows it holds, and a new quotation is then added to that
# same file rather than starting a fresh one. So generation has to write both:
# the rows that were already there, unchanged, and then the new ones.
#
# The two are deliberately not made to look alike. An existing row is a finished
# Summary row the user owns; a quotation is a list of items that has to be
# unpacked. Turning one into the other would invent a client, a project and a
# blank status, so each is written from its own model and the two share only the
# column list and the cell formatting.
# ---------------------------------------------------------------------------


def _existing(**overrides) -> ImportedMonitorRow:
    """A row as the import service returns it, with every field spelled out.

    The Status is what its dates support, because that is what the import hands
    over: a cell claiming something else would already have been corrected.
    """
    fields = {
        "sequence_number": "001",
        "client_name": "EXISTING CLIENT",
        "project_name": "EXISTING PROJECT",
        "product_description": "Existing product description",
        "quantity": 12.5,
        "unit_of_measurement": "m2",
        "installation_schedule": "",
        "start_date": None,
        "completion_date": None,
        "status": "On Hold",
    }
    fields.update(overrides)
    return ImportedMonitorRow(**fields)


def _combined(existing: list[ImportedMonitorRow], *pairs: tuple[str, Quotation]):
    """A request holding existing rows and new quotations together."""
    return ConsolidatedWorkbookRequest(
        existing_rows=existing,
        quotations=[ConfirmedQuotation(sequence_number=seq, quotation=q) for seq, q in pairs],
    )


def _sequences(sheet) -> list:
    """The Sequence Number of every populated data row, top to bottom."""
    return [sheet.cell(row=r, column=1).value for r in range(2, sheet.max_row + 1)]


def test_existing_rows_are_written_before_new_quotations():
    """The workbook reads in order: what was already there, then what is new."""
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [
            _existing(sequence_number="001", product_description="first"),
            _existing(sequence_number="001", product_description="second"),
            _existing(sequence_number="007", product_description="third"),
        ],
        ("008", _quotation("New Client", "New Project", [(1, "new-1", 4.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 5
    assert _sequences(sheet) == ["001", "001", "007", "008"]
    assert [sheet.cell(row=r, column=4).value for r in range(2, 6)] == [
        "first",
        "second",
        "third",
        "new-1",
    ]


def test_existing_rows_keep_the_order_they_were_found_in():
    """No sorting. The workbook's own row order is the user's own arrangement."""
    generator = OpenpyxlWorkbookGenerator()
    # Deliberately not in numeric order, which is the only way to tell a
    # preserved order apart from a sorted one.
    request = _combined(
        [_existing(sequence_number=seq) for seq in ("007", "002", "001")],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert _sequences(sheet) == ["007", "002", "001", "008"]


def test_an_existing_row_preserves_all_ten_fields():
    """Nothing is normalised, inferred or dropped on the way back out.

    Completion Date is now one of them: it is the field that decides whether a
    job is finished, so losing it would turn finished work back into unfinished
    work the next time the file was opened.
    """
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [
            _existing(
                sequence_number="007",
                client_name="EXISTING CLIENT",
                project_name="EXISTING PROJECT",
                product_description="Existing product description",
                quantity=12.5,
                unit_of_measurement="m2",
                installation_schedule="15-20 Nov 2026",
                start_date="to be agreed",
                completion_date="20/11/2026",
            )
        ],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert [sheet.cell(row=2, column=c).value for c in range(1, 11)] == [
        "007",
        "EXISTING CLIENT",
        "EXISTING PROJECT",
        "Existing product description",
        12.5,
        "m2",
        "15-20 Nov 2026",
        "to be agreed",
        "20/11/2026",
        "Completed",
    ]


def test_an_existing_sequence_number_stays_text_with_its_leading_zero():
    """'007' is an identifier, so it must not come back as the number 7."""
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [_existing(sequence_number="007")],
        ("008", _quotation("N", "P", [(1, "n", 1.0, "m2")])),
    )

    cell = _summary(generator.generate_consolidated(request)).cell(row=2, column=1)

    assert cell.value == "007"
    assert isinstance(cell.value, str)
    assert cell.number_format == "@"


def test_an_existing_row_keeps_its_dates_exactly_as_they_were():
    """A schedule and a date the user set are never second-guessed.

    'to be agreed' is a phrase the user wrote, not a malformed date, so it is
    written through untouched rather than blanked or reformatted. The same is
    true of the empty Completion Date: an unfinished job has no completion date
    and is not given one.
    """
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [
            _existing(
                installation_schedule="15-20 Nov 2026",
                start_date="to be agreed",
                completion_date=None,
            )
        ],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.cell(row=2, column=7).value == "15-20 Nov 2026"
    assert sheet.cell(row=2, column=8).value == "to be agreed"
    assert sheet.cell(row=2, column=9).value is None
    # Scheduled and started, nothing completed: the row says Ongoing whatever
    # the cell it came from used to say.
    assert sheet.cell(row=2, column=10).value == "Ongoing"


def test_a_status_that_disagrees_with_the_dates_is_rewritten_on_the_way_out():
    """The file is not the source of the Status; its dates are.

    A workbook may still hold a Status somebody chose before this rule existed.
    Writing it through would reproduce the mistake in every new export.
    """
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [
            _existing(
                installation_schedule="October 2026",
                start_date="01/10/2026",
                completion_date=None,
                status="Completed",
            )
        ],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.cell(row=2, column=10).value == "Ongoing"


def test_a_blank_operational_field_on_an_existing_row_stays_blank():
    """An empty cell round-trips as an empty cell, not as an invented value."""
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [_existing(installation_schedule="", start_date=None, completion_date=None)],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    for col in (7, 8, 9):
        assert sheet.cell(row=2, column=col).value in (None, "")
    # Nothing set anywhere, so the row reports the one status that means that.
    assert sheet.cell(row=2, column=10).value == "On Hold"


def test_new_quotation_rows_start_with_no_dates_and_the_status_that_means_it():
    """The rule from AGENTS.md section 6 is unchanged by any of this.

    A quotation is never a source for Installation Schedule, Start Date or
    Completion Date -- they are not in the PDF and are not guessed from it --
    so those cells stay empty. The Status that follows from three empty fields
    is written for her rather than left blank, because there is no dropdown left
    to choose one from.
    """
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [_existing(sequence_number="007")],
        ("008", _quotation("New Client", "New Project", [(1, "new-1", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    for col in (7, 8, 9):
        assert sheet.cell(row=3, column=col).value is None
    assert sheet.cell(row=3, column=10).value == "On Hold"


def test_an_existing_row_with_a_long_description_gets_a_tall_row():
    """A description read out of the workbook is wrapped and sized like any other.

    Without this the row would use Excel's default height and the tail of a long
    product description would be hidden, simply because the row came from the
    imported side rather than from a quotation.
    """
    generator = OpenpyxlWorkbookGenerator()
    description = "Engineered Oak Flooring " * 60
    request = _combined(
        [_existing(product_description=description)],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))
    cell = sheet.cell(row=2, column=4)

    assert cell.value == description
    assert cell.alignment.wrap_text is True
    assert _lines_for(description) > 8
    assert sheet.row_dimensions[2].height == (
        OpenpyxlWorkbookGenerator.LINE_HEIGHT * _lines_for(description)
    )


def test_an_existing_row_with_a_short_description_keeps_the_default_row_height():
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [_existing(product_description="Self-levelling up to 3mm")],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.row_dimensions[2].height is None


def test_an_existing_row_is_formatted_like_a_quotation_row():
    """One set of column rules, not one per source."""
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [
            _existing(
                sequence_number="007",
                product_description="Existing product description",
                installation_schedule="15-20 Nov 2026",
            )
        ],
        ("008", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )

    sheet = _summary(generator.generate_consolidated(request))
    existing = [sheet.cell(row=2, column=c) for c in range(1, 10)]
    new = [sheet.cell(row=3, column=c) for c in range(1, 10)]

    # Sequence Number: text format, centred, so the zeros survive.
    assert existing[0].number_format == new[0].number_format == "@"
    assert existing[0].alignment.horizontal == new[0].alignment.horizontal == "center"
    # Product Description: wrapped, left and top aligned.
    assert existing[3].alignment.wrap_text is True
    assert existing[3].alignment.horizontal == new[3].alignment.horizontal == "left"
    assert existing[3].alignment.vertical == new[3].alignment.vertical == "top"
    # Quantity: centred.
    assert existing[4].alignment.horizontal == new[4].alignment.horizontal == "center"
    # Both date columns carry the agreed format whether or not they are set.
    expected_date = OpenpyxlWorkbookGenerator.DATE_FORMAT
    assert existing[6].number_format == existing[7].number_format == expected_date
    assert new[6].number_format == new[7].number_format == expected_date


def test_workbook_level_formatting_covers_existing_and_new_rows_together():
    """One range for the whole file, not one per source.

    Four existing rows and three quotation rows occupy rows 2 to 8, and the
    dropdown, colours and filter reach all of them while still extending past
    the data for rows the user adds by hand in Excel.
    """
    generator = OpenpyxlWorkbookGenerator()
    request = _combined(
        [_existing(sequence_number=f"00{n}") for n in (1, 2, 3, 4)],
        (
            "008",
            _quotation("New", "P", [(1, "a", 1.0, "m2"), (2, "b", 2.0, "m2"), (3, "c", 3.0, "m2")]),
        ),
    )

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 8
    # The filter covers the header and every populated row, and no more.
    assert sheet.auto_filter.ref == "A1:J8"
    assert sheet.freeze_panes == "A2"

    # The buffer below the data is still there, and creates no rows of its own.
    buffered = sheet.max_row + OpenpyxlWorkbookGenerator.BUFFER_ROWS

    # No dropdown anywhere: Status is derived, so there is nothing to choose.
    status_rules = [dv for dv in sheet.data_validations.dataValidation if dv.type == "list"]
    assert status_rules == []

    date_rules = [dv for dv in sheet.data_validations.dataValidation if dv.type == "date"]
    assert len(date_rules) == 1
    assert str(date_rules[0].sqref) == f"G2:I{buffered}"

    # One rule per status, each covering the whole combined data range.
    rules = _status_rules(sheet)
    assert len(rules) == len(OpenpyxlWorkbookGenerator.STATUS_VALUES)
    assert {sqref for sqref, _ in rules} == {f"A2:J{buffered}"}
    # Those ranges must not have created cells: the data range stays exact.
    assert sheet.max_row == 8


def test_no_existing_rows_generates_exactly_what_it_did_before():
    """With nothing imported, the workbook is the one this application always made."""
    generator = OpenpyxlWorkbookGenerator()
    request = _consolidated(("001", _quotation("Client", "Project", [(1, "item", 2.0, "m2")])))

    # The field defaults to empty rather than being required.
    assert request.existing_rows == []

    sheet = _summary(generator.generate_consolidated(request))

    assert sheet.max_row == 2
    assert _sequences(sheet) == ["001"]
    assert sheet.cell(row=2, column=4).value == "item"


def test_the_generator_never_works_out_a_sequence_number():
    """Sequence Numbers are written, never calculated.

    Numbering belongs to the application, in one place. If the generator ever
    began comparing, incrementing or tidying these strings, a dotted value could
    reach an int() here the same way it once reached one in the import service,
    and a workbook that reads perfectly well in Excel would be refused.

    The check covers the code that writes a Sequence Number and the code that
    decides row order. It deliberately stops before the layout helpers, which
    legitimately do arithmetic on a column width.
    """
    module = Path(inspect.getfile(OpenpyxlWorkbookGenerator)).read_text(encoding="utf-8")
    row_writing = module.split("def generate_consolidated", 1)[1]
    row_writing = row_writing.split("def _format_data_cell", 1)[0]

    for forbidden in ("int(", "float(", "max(", "min(", "sort(", "zfill", "rjust", "ljust"):
        assert forbidden not in row_writing, f"the generator must not use {forbidden}"

    # And the values it is handed are written through untouched, in the order it
    # was given them: unsorted, unpadded, and with a value that would look
    # out of order to anything trying to be clever with them.
    request = _combined(
        [_existing(sequence_number=s) for s in ("100", "009", "007")],
        ("1000", _quotation("New", "P", [(1, "new", 1.0, "m2")])),
    )
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _sequences(sheet) == ["100", "009", "007", "1000"]


# ---------------------------------------------------------------------------
# Grouping borders.
#
# A monitoring sheet is read in groups: several line items belong to one project
# for one client, and the eye needs to see where one group stops and the next
# begins without reading the Client and Project cells of every row. A thin line
# keeps rows of the same group together; a thick line marks the boundary.
#
# The boundary is Client + Project, never Sequence Number: two quotations can
# share a project, and one project can be split across sequences, so the
# sequence says nothing about which rows belong together.
# ---------------------------------------------------------------------------


def _top_border_style(sheet, row: int, column: int = 1) -> str | None:
    """The top-border style of one cell, or None when it has no top border."""
    return sheet.cell(row=row, column=column).border.top.style


def _data_row_borders(sheet) -> list[str | None]:
    """The top-border style of each data row, header excluded."""
    return [_top_border_style(sheet, row) for row in range(2, sheet.max_row + 1)]


def _grouped(*groups: tuple[str, str, int]) -> list[ImportedMonitorRow]:
    """Existing rows for several client/project groups, in the order given.

    ``groups`` is a sequence of ``(client, project, rows)``. Each group gets its
    own sequence numbers, so a test about borders is not also a test about
    numbering.
    """
    rows: list[ImportedMonitorRow] = []
    for client, project, count in groups:
        for _ in range(count):
            rows.append(
                _existing(
                    sequence_number=f"{len(rows) + 1:03d}",
                    client_name=client,
                    project_name=project,
                )
            )
    return rows


def test_rows_of_one_client_and_project_are_kept_apart_by_thin_lines():
    """Rows in the same group are separated, but the group is not broken up."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 3)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    # No line above the first row: there is nothing above it to separate from.
    assert _data_row_borders(sheet) == [None, "thin", "thin"]


def test_a_new_client_starts_a_new_group_with_a_thick_line():
    """The boundary between two clients is the strongest one on the sheet."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 2), ("CLIENT B", "PROJECT Y", 2)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None, "thin", "thick", "thin"]


def test_a_new_project_under_the_same_client_is_equally_a_boundary():
    """The rule is client AND project, so the client being unchanged is not enough."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 2), ("CLIENT A", "PROJECT Y", 2)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None, "thin", "thick", "thin"]


def test_two_changes_at_once_are_still_one_thick_line():
    """A boundary is a boundary whether one of the two changed or both did."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 2), ("CLIENT B", "PROJECT X", 2)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None, "thin", "thick", "thin"]


def test_several_groups_in_a_row_each_start_with_a_thick_line():
    """The rule holds all the way down, not just for the first pair."""
    request = _combined(
        _grouped(
            ("CLIENT A", "PROJECT X", 2),
            ("CLIENT B", "PROJECT Y", 2),
            ("CLIENT C", "PROJECT Z", 2),
        )
    )
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [
        None,  # A/X
        "thin",  # A/X again
        "thick",  # B/Y starts
        "thin",  # B/Y again
        "thick",  # C/Z starts
        "thin",  # C/Z again
    ]


def test_the_grouping_is_by_value_not_by_where_the_rows_come_from():
    """Two blocks naming the same client and project are one group.

    The comparison is on the names, so nothing else -- not the order they were
    written in, not which of them came from a quotation -- can split them.
    """
    rows = [
        _existing(sequence_number="001", client_name="CLIENT A", project_name="PROJECT X"),
        _existing(sequence_number="002", client_name="CLIENT B", project_name="PROJECT Y"),
        _existing(sequence_number="003", client_name="CLIENT A", project_name="PROJECT X"),
    ]
    request = _combined(rows)
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None, "thick", "thick"]


def test_the_separator_reaches_across_the_whole_data_row():
    """A line that stops in the middle of the row is not a separator."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 1), ("CLIENT B", "PROJECT Y", 1)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    # The second data row is the first row of a new group.
    assert [_top_border_style(sheet, 3, column) for column in range(1, 11)] == ["thick"] * 10


def test_no_thick_line_appears_between_rows_of_the_same_group():
    """A thick line inside a group would say the group ended when it did not."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 4)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    for column in range(1, 11):
        for row in (3, 4, 5):
            assert _top_border_style(sheet, row, column) != "thick"


def test_the_comparison_ignores_case_and_surrounding_spaces():
    """'ALPAGO' and '  alpago  ' are the same client, so there is no boundary."""
    rows = [
        _existing(sequence_number="001", client_name="ALPAGO", project_name="MBRC 466"),
        _existing(sequence_number="002", client_name="  alpago ", project_name="mbrc 466"),
    ]
    request = _combined(rows)
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None, "thin"]


def test_a_one_row_group_gets_no_border_at_all():
    """There is nothing inside it to separate, and nothing after it either."""
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 1)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert _data_row_borders(sheet) == [None]


def test_the_rows_the_filter_adds_below_the_data_are_left_alone():
    """Conditional formatting reaches them; borders do not create them.

    A border on a row that has no data would look like an empty group, and the
    buffer rows exist only so the colours follow rows added by hand later.
    """
    request = _combined(_grouped(("CLIENT A", "PROJECT X", 2), ("CLIENT B", "PROJECT Y", 1)))
    sheet = _summary(OpenpyxlWorkbookGenerator().generate_consolidated(request))

    assert sheet.max_row == 4
    assert _top_border_style(sheet, sheet.max_row + 1) is None
