"""Tests for the openpyxl Excel workbook generator.

Verifies that the generator:
- Creates valid .xlsx workbooks
- Maps quotation fields to the agreed column structure
- Leaves manual operational fields blank
- Writes one row per quotation item
- Applies status formatting when present
- Uses correct sheet name and column order
"""

from io import BytesIO

import math

import pytest
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from app.excel.openpyxl_generator import OpenpyxlWorkbookGenerator
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
            QuotationItem(sr=sr, description=desc, quantity=qty, unit=unit)
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
        "Status",
    ]


def test_generates_valid_xlsx_workbook():
    """The generator returns valid .xlsx bytes that openpyxl can read."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr=1, description="Test item", quantity=10, unit="m2")],
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
        items=[QuotationItem(sr=1, description="Test item", quantity=10, unit="m2")],
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
        items=[QuotationItem(sr=1, description="Test item", quantity=10, unit="m2")],
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
                sr=1,
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
        items=[QuotationItem(sr=1, description="Item 1", quantity=10, unit="m2")],
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
            QuotationItem(sr=1, description="Flooring 15/4", quantity=34, unit="m2"),
            QuotationItem(sr=2, description="Flooring 16/4", quantity=88, unit="m2"),
            QuotationItem(sr=3, description="Self-levelling", quantity=122, unit="m2"),
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
            QuotationItem(sr=1, description="Item 1", quantity=10, unit="m2"),
            QuotationItem(sr=2, description="Item 2", quantity=20, unit="m2"),
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
    """Status colours the whole row A:I via dynamic conditional formatting."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr=1, description="Item", quantity=1, unit="m2")],
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

    expected_range = f"A2:I{sheet.max_row + OpenpyxlWorkbookGenerator.BUFFER_ROWS}"

    for value, (fill_color, font_color) in expected.items():
        matches = [
            (rng, rule) for rng, rule in rules if any(f'$I2="{value}"' == f for f in rule.formula)
        ]
        assert matches, f"missing conditional rule for {value}"
        rng, rule = matches[0]
        # Applied across the whole row A:I, not only the Status column.
        assert rng == expected_range
        assert rng.startswith("A2:I")
        # The formula pins the Status column with $I and moves down the rows.
        assert rule.formula == [f'$I2="{value}"']
        assert rule.dxf.fill.start_color.rgb.endswith(fill_color)
        assert rule.dxf.font.color.rgb.endswith(font_color)

    # No cell carries a static fill; the colour is the rule's job, so it stays
    # dynamic when the dropdown value changes.
    for col in range(1, 10):
        assert sheet.cell(row=2, column=col).fill.fgColor.rgb in (None, "00000000")


def test_status_data_validation_offers_exact_options():
    """The Status column has a real list dropdown with the three statuses."""
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr=1, description="Item", quantity=1, unit="m2")],
    )

    workbook = load_workbook(BytesIO(generator.generate(quotation)))
    sheet = workbook["Summary"]

    list_rules = [dv for dv in sheet.data_validations.dataValidation if dv.type == "list"]
    assert len(list_rules) == 1
    rule = list_rules[0]
    assert rule.formula1 == '"On Hold,Ongoing,Completed"'
    assert rule.allow_blank is True
    # The dropdown must be shown, so showDropDown must not be forced on.
    assert rule.showDropDown is not True
    assert "I2" in str(rule.sqref)


def test_preserves_multiline_descriptions():
    """Multi-line descriptions are preserved in Excel cells."""
    generator = OpenpyxlWorkbookGenerator()
    multiline_desc = "Engineered Oak Flooring\n15/4 x 120 x 600mm\nAB grade\nHerringbone Cut"
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr=1, description=multiline_desc, quantity=34, unit="m2")],
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
        items=[QuotationItem(sr=1, description="Item", quantity=34.5, unit="m2")],
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
                sr=1,
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
        items=[QuotationItem(sr=1, description="Item", quantity=2, unit="m2")],
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
    return sum(
        max(1, math.ceil(len(part) / chars_per_line))
        for part in description.split("\n")
    )


def _sheet_for(description: str):
    generator = OpenpyxlWorkbookGenerator()
    quotation = Quotation(
        quotation_number="TEST/001",
        client_name="Test Client",
        project_name="Test Project",
        items=[QuotationItem(sr=1, description=description, quantity=1, unit="m2")],
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
    assert sheet.row_dimensions[2].height == (
        OpenpyxlWorkbookGenerator.LINE_HEIGHT * 3
    )


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
    assert sheet.row_dimensions[2].height == (
        OpenpyxlWorkbookGenerator.LINE_HEIGHT * lines
    )
    assert sheet.row_dimensions[2].height > OpenpyxlWorkbookGenerator.LINE_HEIGHT * 8


def test_freeze_panes_locks_the_header(sample_workbook):
    assert sample_workbook["Summary"].freeze_panes == "A2"


def test_auto_filter_covers_header_and_data(sample_workbook):
    assert sample_workbook["Summary"].auto_filter.ref == "A1:I2"


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
                    items=[QuotationItem(sr=1, description="Item", quantity=1, unit="m2")],
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
    for col in (7, 8):  # Installation Schedule, Start Date
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
    assert "G2" in ref and "H" in ref


def test_status_and_dates_remain_blank(sample_workbook):
    """No manual operational field is ever auto-filled."""
    sheet = sample_workbook["Summary"]
    for col in (7, 8, 9):
        assert sheet.cell(row=2, column=col).value is None
