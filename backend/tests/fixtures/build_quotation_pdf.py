"""Builds a synthetic ERP quotation PDF for the parser tests.

Why a generated PDF instead of a text fixture
---------------------------------------------
The parser reads values out of *ruled cells*, so testing it against a text
fixture would test nothing that matters: text cannot express where a column
starts. A real ERP quotation is confidential, so it cannot be committed either
(AGENTS.md sections 10 and 13). This module therefore writes a small PDF whose
table is drawn with the same real ruled borders as the reference quotation, with
invented client, project and product names.

The geometry mirrors the reference layout, because three separate regressions
came from its real values:

===================================  ==========================
Page geometry                        A4, 595.2756 x 841.8898 pt
Horizontal rules (table-wide)        107.8, 239.8, 266.8, 296.8, 605.95
Vertical rules (column dividers)      40.25, 296.0, 364.25, 422.75, 474.5, 524.75
Table-wide rules (left and right)    24.0, 576.0
Header band / item band               266.8..296.8 / 296.8..605.95
QTY and UNIT share one ruled cell     296.0..364.25
DESCRIPTION label x vs text x         144 vs 42
===================================  ==========================

The quantities and prices are the reference row values, which are already
recorded in AGENTS.md section 4 and are what the regression tests must pin. Every
other string here is invented, including the item codes and product names, so
nothing from the real quotation is reproduced. The real codes and descriptions
are pinned instead by ``tests/parser/test_reference_quotation.py``, which reads
the actual document.
"""

from dataclasses import dataclass, field
from typing import cast

PAGE_WIDTH = 595.2756
PAGE_HEIGHT = 841.8898

LEFT_EDGE = 24.0
RIGHT_EDGE = 576.0
COLUMN_EDGES = (40.25, 296.0, 364.25, 422.75, 474.5, 524.75)

HEADER_TOP = 107.8
HEADER_BOTTOM = 239.8
TABLE_TOP = 266.8
COLUMN_HEADER_BOTTOM = 296.8
TOTALS_TOP = 648.85
FOOTER = 721.65

# Cells are right-aligned, so their text sits left of the rule it belongs to.
SR_VALUE_X = 32.0
QTY_VALUE_X = 300.0
UNIT_VALUE_X = 349.8
PRICE_VALUE_X = 382.0
DISCOUNT_VALUE_X = 432.0
NET_VALUE_X = 487.0
TOTAL_VALUE_X = 536.0

# The description label is centred over its cell while the text is flush left,
# which is why column boundaries cannot come from label positions.
DESCRIPTION_LABEL_X = 144.0
DESCRIPTION_TEXT_X = 42.0

COLUMN_HEADER_BASELINE = 280.0

# The header is a two-column label/value grid. Every ':' in a column is printed
# at the same x whatever the label's length, which is what makes the columns
# detectable; the label itself is what moves.
LEFT_LABEL_X = 24.0
LEFT_COLON_X = 66.0
LEFT_VALUE_X = 78.0
RIGHT_LABEL_X = 354.0
RIGHT_WIDE_LABEL_X = 394.0
RIGHT_COLON_X = 426.0
RIGHT_VALUE_X = 434.0

ITEMS_TOP = 321.0
ROW_HEIGHT = 41.0
CONTINUATION_OFFSET = 11.0

CLIENT_NAME = "SAMPLE CLIENT TRADING L.L.C"
PROJECT_NAME = "SAMPLE TOWER 001"
QUOTATION_NUMBER = "SAMPLE/00/000000/Rev0"
QUOTATION_DATE = "01/01/2026"

# Below the item grid, where a parser that trusts the flattened text stream
# invents rows out of payment terms.
TERMS_LINES = (
    "Payment terms: 30 days from invoice.",
    "Delivery: 4 to 6 weeks from order confirmation.",
    "Validity: 30 days from the quotation date.",
)


@dataclass(frozen=True)
class Row:
    """One item row, as the ERP would print it."""

    sr: int
    description: tuple[str, ...]
    quantity: float | None
    unit: str | None
    price: float | None = None
    discount: float | None = None
    net: float | None = None
    total: float | None = None

    @property
    def baseline(self) -> float:
        return ITEMS_TOP + ROW_HEIGHT * self.sr


def _money(value: float | None) -> str | None:
    return None if value is None else f"{value:.2f}"


REFERENCE_ROWS = (
    Row(
        sr=1,
        description=("FF-01", "Sample flooring product", "Herringbone pattern", "Glue down method"),
        quantity=34.0,
        unit="m2",
        price=610.0,
        discount=30.0,
        net=580.0,
        total=19720.0,
    ),
    Row(
        sr=2,
        description=(
            "FF-02",
            "Sample flooring product",
            "Straight installation",
            "Glue down method",
        ),
        quantity=88.0,
        unit="m2",
        price=650.0,
        discount=55.0,
        net=595.0,
        total=52360.0,
    ),
    Row(
        sr=3,
        description=("Levelling compound up to 3mm",),
        quantity=122.0,
        unit="m2",
        price=55.0,
        discount=0.0,
        net=55.0,
        total=6710.0,
    ),
)

COLUMN_HEADERS = (
    ("SR#", SR_VALUE_X),
    ("DESCRIPTION", DESCRIPTION_LABEL_X),
    ("QTY", QTY_VALUE_X),
    ("UNIT", 336.0),
    ("PRICE/UNIT", 378.45),
    ("DISCOUNT", DISCOUNT_VALUE_X),
    ("NET PRICE", NET_VALUE_X),
    ("TOTAL/AED", TOTAL_VALUE_X),
)


@dataclass
class PageBuilder:
    """Accumulates PDF drawing operators for one page."""

    width: float = PAGE_WIDTH
    height: float = PAGE_HEIGHT
    operations: list[str] = field(default_factory=list)

    def rule(
        self, x0: float, top: float, x1: float, bottom: float, line_width: float = 0.5
    ) -> None:
        """Draw a straight line, which pdfplumber reports as a table border."""
        self.operations.append(f"{_number(line_width)} w")
        self.operations.append(f"{_number(x0)} {_number(self.height - bottom)} m")
        self.operations.append(f"{_number(x1)} {_number(self.height - top)} l S")

    def horizontal_rule(self, top: float) -> None:
        self.rule(LEFT_EDGE, top, RIGHT_EDGE, top)

    def vertical_rule(self, x: float, top: float, bottom: float) -> None:
        self.rule(x, top, x, bottom)

    def text(self, x: float, top: float, value: str, size: float = 7.0) -> None:
        """Draw one text run whose baseline sits at ``top``."""
        self.operations.append("BT")
        self.operations.append(f"/F1 {_number(size)} Tf")
        self.operations.append(f"{_number(x)} {_number(self.height - top)} Td")
        self.operations.append(f"({_escape(value)}) Tj")
        self.operations.append("ET")

    def stream(self) -> bytes:
        return "\n".join(self.operations).encode("ascii")


def _number(value: float) -> str:
    """Format a coordinate, keeping enough precision to round-trip."""
    return f"{value:.10g}"


def _escape(value: str) -> str:
    """Escape a PDF literal string."""
    return (
        value.replace("\\", r"\\")
        .replace("(", r"\(")
        .replace(")", r"\)")
        .replace("\u00a0", r"\240")
    )


def _header_fields() -> tuple[tuple[str, float, float, float, float, str], ...]:
    return (
        ("Client", LEFT_LABEL_X, LEFT_COLON_X, LEFT_VALUE_X, 121.0, CLIENT_NAME),
        ("VAT #", LEFT_LABEL_X, LEFT_COLON_X, LEFT_VALUE_X, 139.0, "5%"),
        ("Nbr", RIGHT_WIDE_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 121.0, QUOTATION_NUMBER),
        ("From", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 139.0, CLIENT_NAME),
        ("Date", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 157.0, QUOTATION_DATE),
        ("Project", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 175.0, PROJECT_NAME),
        ("Address", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 211.0, "Sample address line"),
    )


def _table_page(
    rows: tuple[Row, ...],
    header: tuple[tuple[str, float, float, float, float, str], ...] | None,
) -> PageBuilder:
    """The quotation page: header fields, then the ruled item grid."""
    page = PageBuilder()
    for label, label_x, colon_x, value_x, top, value in (
        header if header is not None else _header_fields()
    ):
        page.text(label_x, top, label)
        page.text(colon_x, top, ":")
        page.text(value_x, top, value)

    items_bottom = (max(row.baseline for row in rows) if rows else ITEMS_TOP) + 30.0
    for top in (TABLE_TOP, COLUMN_HEADER_BOTTOM, items_bottom, TOTALS_TOP, FOOTER):
        page.horizontal_rule(top)
    for x in COLUMN_EDGES:
        page.vertical_rule(x, TABLE_TOP, FOOTER)
    for label, x in COLUMN_HEADERS:
        page.text(x, COLUMN_HEADER_BASELINE, label)

    for row in rows:
        page.text(SR_VALUE_X, row.baseline, str(row.sr))
        for offset, part in enumerate(row.description):
            page.text(DESCRIPTION_TEXT_X, row.baseline + offset * CONTINUATION_OFFSET, part)
        for value, x in (
            (_money(row.quantity), QTY_VALUE_X),
            (row.unit, UNIT_VALUE_X),
            (_money(row.price), PRICE_VALUE_X),
            (_money(row.discount), DISCOUNT_VALUE_X),
            (_money(row.net), NET_VALUE_X),
            (_money(row.total), TOTAL_VALUE_X),
        ):
            if value is not None:
                page.text(x, row.baseline, value)

    page.text(DESCRIPTION_TEXT_X, TOTALS_TOP + 40.0, "Total before VAT")
    return page


def _terms_page() -> PageBuilder:
    """A ruled page with numbers in it but no item table."""
    page = PageBuilder()
    page.horizontal_rule(80.0)
    page.vertical_rule(40.0, 80.0, 200.0)
    page.horizontal_rule(200.0)
    for index, value in enumerate(TERMS_LINES):
        page.text(DESCRIPTION_TEXT_X, 100.0 + index * 20.0, value)
    return page


def _wrap(pages: list[PageBuilder]) -> bytes:
    """Assemble the pages into a minimal, valid PDF."""
    count = len(pages)
    pages_id = 2
    font_id = 3
    page_ids = [4 + index * 2 for index in range(count)]
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {count} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    for index, page in enumerate(pages):
        content_id = page_ids[index] + 1
        objects.append(
            (
                f"<< /Type /Page /Parent {pages_id} 0 R "
                f"/MediaBox [0 0 {_number(page.width)} {_number(page.height)}] "
                f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            ).encode("ascii")
        )
        stream = page.stream()
        objects.append(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode("ascii") + body + b"\nendobj\n"

    xref_offset = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode("ascii")
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    ).encode("ascii")
    return bytes(out)


def quotation_pdf(
    rows: tuple[Row, ...] = REFERENCE_ROWS,
    header: tuple[tuple[str, float, float, float, float, str], ...] | None = None,
    *,
    with_table: bool = True,
    with_terms_page: bool = True,
) -> bytes:
    """A quotation PDF to test against.

    ``with_table=False`` draws the same text with no rules, which is how the
    no-guessing guard is exercised.
    """
    if not with_table:
        # Identical to the ruled page except that no borders are drawn, so the
        # only thing the parser loses is the column structure.
        page = PageBuilder()
        for label, label_x, colon_x, value_x, top, value in (
            header if header is not None else _header_fields()
        ):
            page.text(label_x, top, label)
            page.text(colon_x, top, ":")
            page.text(value_x, top, value)
        for row in rows:
            page.text(SR_VALUE_X, row.baseline, str(row.sr))
            for offset, part in enumerate(row.description):
                page.text(DESCRIPTION_TEXT_X, row.baseline + offset * CONTINUATION_OFFSET, part)
            if row.quantity is not None:
                page.text(QTY_VALUE_X, row.baseline, _money(row.quantity) or "")
            if row.unit is not None:
                page.text(UNIT_VALUE_X, row.baseline, row.unit)
        return _wrap([page])

    pages = [_table_page(rows, header)]
    if with_terms_page:
        pages.append(_terms_page())
    return _wrap(pages)


def reference_pdf() -> bytes:
    """The reference layout: three ruled items, then a terms page with no grid."""
    return quotation_pdf()


def inconsistent_row_pdf() -> bytes:
    """The first row's quantity replaced by the value from its DISCOUNT cell.

    Only the quantity changes, so the row's own figures stop agreeing: 30 x
    580.00 is 17,400.00, not the stated 19,720.00. This is the failure the old
    text-based parser produced silently, so the parser must now flag it.
    """
    rows = (
        Row(1, REFERENCE_ROWS[0].description, 30.0, "m2", 610.0, 30.0, 580.0, 19720.0),
        *REFERENCE_ROWS[1:],
    )
    return quotation_pdf(rows=rows, with_terms_page=False)


def missing_quantity_pdf() -> bytes:
    """The second row with its quantity cell left blank.

    The line item still exists, so it must still be produced, with the quantity
    empty and flagged rather than filled in from a neighbouring column.
    """
    rows = (REFERENCE_ROWS[0], Row(2, REFERENCE_ROWS[1].description, None, "m2"), REFERENCE_ROWS[2])
    return quotation_pdf(rows=rows, with_terms_page=False)


def unruled_pdf() -> bytes:
    """The same text with no drawn table borders at all."""
    return quotation_pdf(with_table=False)


# ---------------------------------------------------------------------------
# Layout variants found by validating four real ERP quotations
# ---------------------------------------------------------------------------
#
# Validating the parser against real quotations turned up four column layouts
# and two page shapes that the reference layout does not contain. Each is built
# here as a synthetic PDF, with invented strings, so the behaviour is pinned in
# CI without any confidential document. The real values that pinned each of
# these live in ``UPDATED_DETAILS.md`` and in the validation report; nothing
# below reproduces a real client, project or product.

HeaderField = tuple[str, float, float, float, float, str]
"""(label, label_x, colon_x, value_x, top, value) for one header field."""


@dataclass(frozen=True)
class Cell:
    """One ruled column: its borders, its header label, and where its value sits.

    ``second_value_x`` is for the layouts where one ruled cell holds two values
    under a single combined label, as ``QTY/UNIT`` does. It is ``None`` for the
    ordinary layouts, where each cell holds one value.
    """

    left: float
    right: float
    label: str
    label_x: float
    value_x: float
    second_value_x: float | None = None


@dataclass(frozen=True)
class VariantRow:
    """One row of a variant layout.

    ``sr`` is the text written in the first column. ``lines`` are the description
    lines, written one per row. ``cells`` maps a column index to the text written
    in that column; a two-element value is drawn as the two values one cell can
    hold under a combined label, at ``value_x`` then ``second_value_x``.
    """

    sr: str | None
    lines: tuple[str, ...]
    cells: tuple[tuple[int, str | tuple[str, str]], ...] = ()


def _variant_header(with_project: bool) -> tuple[HeaderField, ...]:
    """The two-column label/value header block, optionally without a project."""
    fields: list[HeaderField] = [
        ("Client", LEFT_LABEL_X, LEFT_COLON_X, LEFT_VALUE_X, 121.0, CLIENT_NAME),
        ("VAT #", LEFT_LABEL_X, LEFT_COLON_X, LEFT_VALUE_X, 139.0, "5%"),
        ("Nbr", RIGHT_WIDE_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 121.0, QUOTATION_NUMBER),
        ("From", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 139.0, CLIENT_NAME),
        ("Date", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 157.0, QUOTATION_DATE),
    ]
    if with_project:
        fields.append(("Project", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 175.0, PROJECT_NAME))
    fields.append(
        ("Address", RIGHT_LABEL_X, RIGHT_COLON_X, RIGHT_VALUE_X, 211.0, "Sample address line")
    )
    return tuple(fields)


def _draw_header(page: PageBuilder, fields: tuple[HeaderField, ...]) -> None:
    for label, label_x, colon_x, value_x, top, value in fields:
        page.text(label_x, top, label)
        page.text(colon_x, top, ":")
        page.text(value_x, top, value)


def _draw_variant_rows(
    page: PageBuilder, cells: tuple[Cell, ...], rows: tuple[VariantRow, ...], first_top: float
) -> None:
    description = cells[1]
    for offset, row in enumerate(rows):
        baseline = first_top + ROW_HEIGHT * offset
        if row.sr is not None:
            page.text(cells[0].value_x, baseline, row.sr)
        for position, line in enumerate(row.lines):
            page.text(description.value_x, baseline + position * CONTINUATION_OFFSET, line)
        for index, value in row.cells:
            cell = cells[index]
            if isinstance(value, tuple):
                # One ruled cell holding two values, e.g. QTY and UNIT.
                page.text(cell.value_x, baseline, value[0])
                page.text(cast(float, cell.second_value_x), baseline, value[1])
            else:
                page.text(cell.value_x, baseline, value)


def _labelled_table_page(
    cells: tuple[Cell, ...],
    rows: tuple[VariantRow, ...],
    *,
    with_project: bool = True,
) -> PageBuilder:
    """A quotation page whose ruled grid is described by explicit cells."""
    page = PageBuilder()
    _draw_header(page, _variant_header(with_project))

    for top in (HEADER_TOP, HEADER_BOTTOM, TABLE_TOP, COLUMN_HEADER_BOTTOM, TOTALS_TOP, FOOTER):
        page.horizontal_rule(top)
    for cell in cells:
        page.vertical_rule(cell.left, TABLE_TOP, TOTALS_TOP)
    for cell in cells:
        if cell.label:
            page.text(cell.label_x, COLUMN_HEADER_BASELINE, cell.label)
    _draw_variant_rows(page, cells, rows, ITEMS_TOP)
    page.text(DESCRIPTION_TEXT_X, TOTALS_TOP + 40.0, "Total before VAT")
    return page


# The combined-label layout: QTY and UNIT share one ruled cell under a single
# "QTY/UNIT" label, the price column is "PRICE/AED", and there is no total column.
# The x positions are the ones the real document uses, so the shared cell is
# split the same way: the quantity sits at 312.0 and the unit at 379.8, either
# side of the label's centre at 356.98.
COMBINED_CELLS = (
    Cell(24.0, 41.0, "SR#", 24.0, 28.0),
    Cell(41.0, 306.5, "DESCRIPTION", 149.5, 42.0),
    Cell(306.5, 394.25, "QTY/UNIT", 339.55, 312.0, 379.8),
    Cell(394.25, 460.25, "PRICE/AED", 406.6, 412.0),
    Cell(460.25, 520.25, "DISCOUNT", 470.35, 474.2),
    # The real document prints this cell's label as two words, "NET" then
    # "PRICE"; joined, it is the same label the reference layout uses.
    Cell(520.25, 576.0, "NET PRICE", 537.8, 535.0),
)


def combined_qty_unit_pdf(*, net_prices: tuple[str, str] = ("3850.00", "2500.00")) -> bytes:
    """A ruled quotation whose QTY and UNIT share one cell under a combined label.

    Five ruled cells hold the quantity, the unit, the price, the discount and the
    net price, and there is no total column at all, so the arithmetic check has
    only one of its two relationships available. ``net_prices`` is a parameter so
    a caller can make the figures disagree, which is the only way to see that
    ``PRICE/AED`` was recognised as a price column at all.
    """
    rows = (
        VariantRow(
            sr="1",
            lines=("Option 1", "Sample first product", "Glue down method"),
            cells=((2, ("200.00", "m2")), (3, "4000.00"), (4, "150.00"), (5, net_prices[0])),
        ),
        VariantRow(
            sr="2",
            lines=("Option 2", "Sample second product", "Straight installation"),
            cells=((2, ("200.00", "m2")), (3, "2750.00"), (4, "250.00"), (5, net_prices[1])),
        ),
    )
    return _wrap([_labelled_table_page(COMBINED_CELLS, rows)])


# Six columns, QTY and UNIT in cells of their own, and no price, discount or net
# column beyond the unit price and the row total.
SIX_COLUMN_CELLS = (
    Cell(24.0, 39.5, "SR#", 24.0, 28.7),
    Cell(39.5, 352.25, "DESCRIPTION", 185.5, 210.0),
    Cell(352.25, 406.25, "QTY", 370.4, 369.0),
    Cell(406.25, 443.0, "UNIT", 414.2, 417.9),
    Cell(443.0, 506.75, "PRICE/UNIT", 462.4, 482.0),
    Cell(506.75, 576.0, "TOTAL/AED", 522.2, 544.0),
)


def six_column_pdf() -> bytes:
    """A ruled quotation with no DISCOUNT or NET PRICE column.

    The arithmetic check has to stand down here rather than invent the missing
    figures, and the single item must still be read.
    """
    rows = (
        VariantRow(
            sr="1",
            lines=(
                "Supply only",
                "Sample flooring product",
                "Colour reference: 100000000",
                "Lead time: 25-30 working days",
            ),
            cells=((2, "46.00"), (3, "m2"), (4, "950.00"), (5, "43700.00")),
        ),
    )
    return _wrap([_labelled_table_page(SIX_COLUMN_CELLS, rows)])


# A grid whose header band does not name the columns the parser knows. The
# geometry is a real item grid; only the wording is unfamiliar, which is exactly
# the case that used to be returned as an empty quotation with nothing to show.
UNMAPPABLE_CELLS = (
    Cell(24.0, 41.0, "LINE", 24.0, 28.0),
    Cell(41.0, 306.5, "DETAILS", 149.5, 42.0),
    Cell(306.5, 394.25, "QUANTITY", 320.0, 312.0),
    Cell(394.25, 460.25, "AMOUNT", 406.6, 412.0),
    Cell(460.25, 520.25, "REDUCED", 470.35, 474.2),
    Cell(520.25, 576.0, "AMOUNT", 537.8, 535.0),
)


def unmappable_grid_pdf() -> bytes:
    """A real-looking ruled item grid whose column names the parser cannot map.

    Nothing here may become a line item, and the page must not be reported as
    simply having no table: the grid is plainly there and has to be reviewed.
    """
    rows = (
        VariantRow(
            sr="1",
            lines=("Sample product one",),
            cells=((2, "10.00"), (3, "500.00"), (4, "0.00"), (5, "500.00")),
        ),
        VariantRow(
            sr="2",
            lines=("Sample product two",),
            cells=((2, "5.00"), (3, "500.00"), (4, "0.00"), (5, "500.00")),
        ),
    )
    return _wrap([_labelled_table_page(UNMAPPABLE_CELLS, rows, with_project=False)])


# A quotation whose item grid runs off the foot of the page and carries on over
# the top of the next one, with no repeated column header. The description of the
# last row on page 1 also runs over, which is the other half of the same problem.
CONTINUATION_CELLS = (
    Cell(24.0, 40.25, "SR#", 24.0, 32.0),
    Cell(40.25, 296.0, "DESCRIPTION", 144.0, 42.0),
    Cell(296.0, 336.0, "QTY", 300.0, 300.0),
    Cell(336.0, 364.25, "UNIT", 336.0, 349.8),
    Cell(364.25, 422.75, "PRICE/UNIT", 378.5, 382.0),
    Cell(422.75, 474.5, "DISCOUNT", 426.0, 432.0),
    Cell(474.5, 524.75, "NET PRICE", 483.8, 487.0),
    Cell(524.75, 576.0, "TOTAL/AED", 531.2, 536.0),
)

CONTINUATION_FIRST_PAGE_ROWS = (
    VariantRow(
        sr="1",
        lines=("Sample first product", "Straight installation"),
        cells=(
            (2, "153.00"),
            (3, "m2"),
            (4, "300.00"),
            (5, "25.00"),
            (6, "275.00"),
            (7, "42075.00"),
        ),
    ),
    VariantRow(
        sr="2",
        lines=("Steps", "Sample second product", "Glue down method"),
        cells=(
            (2, "18.00"),
            (3, "STEP"),
            (4, "1950.00"),
            (5, "150.00"),
            (6, "1800.00"),
            (7, "32400.00"),
        ),
    ),
    VariantRow(
        sr="3",
        lines=("Landing", "Sample third product"),
        cells=((2, "3.00"), (3, "m2"), (4, "625.00"), (5, "30.00"), (6, "595.00"), (7, "1785.00")),
    ),
)

# The page 1 grid is closed by a rule at its foot, and the page 2 grid by one that
# sits above the totals block, so neither page can borrow the other's body. The
# page 2 grid has no top rule: it ran off the foot of page 1, so its columns start
# at the top of the ruled area.
CONTINUATION_FIRST_PAGE_BOTTOM = 420.0
CONTINUATION_SECOND_PAGE_TOP = 11.25
CONTINUATION_SECOND_PAGE_BOTTOM = 286.1

# The four lines that finish item 3, printed at the top of page 2 with no SR#.
CONTINUATION_TAIL_LINES = (
    "Lengths are random",
    "Colour to match the approved sample",
    "Straight installation",
    "Glue down method",
)

# PageBuilder writes a baseline, and a word's top sits 5.55pt above it. The
# baselines below are chosen so the words land on the tops the real continuation
# page uses, which puts the first line just inside the top of the grid's own
# vertical rules rather than above them.
TAIL_FIRST_BASELINE = 19.53
FOURTH_ROW_BASELINE = 83.65
TOTALS_BASELINE = 299.75


def _continuation_second_page() -> PageBuilder:
    """The page the grid carries on to: same columns, no repeated header."""
    page = PageBuilder()
    for cell in CONTINUATION_CELLS:
        page.vertical_rule(cell.left, CONTINUATION_SECOND_PAGE_TOP, CONTINUATION_SECOND_PAGE_BOTTOM)
    for top in (CONTINUATION_SECOND_PAGE_BOTTOM, 329.0, FOOTER):
        page.horizontal_rule(top)

    description = CONTINUATION_CELLS[1]
    for position, line in enumerate(CONTINUATION_TAIL_LINES):
        page.text(description.value_x, TAIL_FIRST_BASELINE + position * 12.0, line)

    page.text(CONTINUATION_CELLS[0].value_x, FOURTH_ROW_BASELINE, "4")
    for position, line in enumerate(
        ("L-shape steps", "Sample fourth product", "Glue down method"),
    ):
        page.text(description.value_x, FOURTH_ROW_BASELINE + position * CONTINUATION_OFFSET, line)
    for index, value in (
        (2, "3.00"),
        (3, "STEP"),
        (4, "3150.00"),
        (5, "300.00"),
        (6, "2850.00"),
        (7, "8550.00"),
    ):
        page.text(CONTINUATION_CELLS[index].value_x, FOURTH_ROW_BASELINE, value)

    # Below the grid: the totals block, which must never be read as an item.
    page.text(294.0, TOTALS_BASELINE, "Net Before VAT:")
    page.text(381.1, TOTALS_BASELINE, "81610.00")
    page.text(24.0, TOTALS_BASELINE + 18.0, "VAT(%):")
    return page


def continuation_pdf() -> bytes:
    """A three-page quotation whose item grid continues onto page 2.

    Page 2 repeats no column header, the last row on page 1 is unfinished, and
    page 3 is an ordinary terms page that must stay out of the result entirely.
    """
    first = PageBuilder()
    _draw_header(first, _variant_header(with_project=True))
    for top in (
        HEADER_TOP,
        HEADER_BOTTOM,
        TABLE_TOP,
        COLUMN_HEADER_BOTTOM,
        CONTINUATION_FIRST_PAGE_BOTTOM,
        FOOTER,
    ):
        first.horizontal_rule(top)
    for cell in CONTINUATION_CELLS:
        first.vertical_rule(cell.left, TABLE_TOP, CONTINUATION_FIRST_PAGE_BOTTOM)
    for cell in CONTINUATION_CELLS:
        if cell.label:
            first.text(cell.label_x, COLUMN_HEADER_BASELINE, cell.label)
    _draw_variant_rows(first, CONTINUATION_CELLS, CONTINUATION_FIRST_PAGE_ROWS, ITEMS_TOP)
    return _wrap([first, _continuation_second_page(), _terms_page()])


# A page whose grid has the right shape but the wrong columns, so it must not be
# read as a continuation of the quotation table on the page before.
MISMATCHED_CELLS = (
    Cell(60.0, 200.0, "SOMETHING", 90.0, 100.0),
    Cell(200.0, 300.0, "ELSE", 210.0, 210.0),
    Cell(300.0, 400.0, "OTHER", 310.0, 310.0),
    Cell(400.0, 500.0, "THING", 410.0, 410.0),
    Cell(500.0, 560.0, "EXTRA", 505.0, 505.0),
)


def mismatched_columns_pdf() -> bytes:
    """A second page ruled into columns that do not match the first page."""
    page = PageBuilder()
    for cell in MISMATCHED_CELLS:
        page.vertical_rule(cell.left, 11.0, 200.0)
    page.horizontal_rule(200.0)
    page.horizontal_rule(FOOTER)
    page.text(100.0, 40.0, "1")
    page.text(100.0, 60.0, "Some unrelated ruled content")
    page.text(100.0, 80.0, "2")
    page.text(100.0, 100.0, "More unrelated ruled content")
    first = _labelled_table_page(CONTINUATION_CELLS, CONTINUATION_FIRST_PAGE_ROWS)
    return _wrap([first, page])


__all__ = [
    "Row",
    "combined_qty_unit_pdf",
    "continuation_pdf",
    "inconsistent_row_pdf",
    "mismatched_columns_pdf",
    "missing_quantity_pdf",
    "quotation_pdf",
    "reference_pdf",
    "six_column_pdf",
    "unmappable_grid_pdf",
    "unruled_pdf",
]
