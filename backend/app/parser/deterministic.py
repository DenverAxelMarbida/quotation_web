"""Deterministic quotation parser.

Reads an :class:`~app.parser.base.ExtractedPdf` — positioned text runs plus the
lines the PDF draws — and produces a
:class:`~app.models.review.ParseResult`. No statistics, no guessing, no
inference: whatever cannot be read is reported for human review.

How it works
------------
ERP quotation tables are drawn, not typed. The item grid in the reference
quotation is bounded by real ruled lines, so the parser uses those lines as the
statement of where each column begins and ends, then reads every value out of
its own cell::

    x:  24      40.25 ......... 296      336 ... 364.25 ... 422.75 ... 474.5 ... 524.75 ... 576
        |  SR#  |  DESCRIPTION  |  QTY   | UNIT | PRICE   | DISCOUNT |  NET   |  TOTAL   |
        |   1   |  FF-04 ...    | 34.00  |  m2  | 610.00  |  30.00   | 580.00 | 19,720.00

Columns are named from the labels inside the header band, but the *boundaries*
always come from the rules, never from the label positions. That distinction is
not cosmetic: in the reference quotation the ``DESCRIPTION`` label sits at
x=144 while the description text is written at x=42, so label-based boundaries
would discard every description.

Three details that each produced a wrong answer before they were fixed, and are
therefore load-bearing:

1. Lines are clustered by vertical centre with a tolerance. The left and right
   halves of the header sit on baselines 0.2pt apart, so rounding a coordinate
   to a fixed precision splits one visual line in two.
2. Every coordinate comparison is made with a tolerance. The reference
   quotation's ``QTY`` value has x=300.0 while the header label above it has
   x=300.00000000000006, and the natural test ``300.0 >= 300.00000000000006`` is
   False. Exact comparison silently loses quantities.
3. A ruled table is required. Column boundaries are never guessed from header
   positions, so a quotation without drawn rules yields no line items and a
   review flag rather than invented ones.

Arithmetic consistency
----------------------
Each row's own figures are checked against each other: ``PRICE/UNIT -
DISCOUNT = NET PRICE`` and ``QTY x NET PRICE = TOTAL/AED``. This is a
consistency signal only. A row that fails is flagged for review and its values
are left exactly as read — the check never repairs, adjusts or infers a
quantity (AGENTS.md section 9).

Validation status
-----------------
Checked against four real ERP quotations, which between them contain four
column layouts and two page shapes, and covered by tests against generated
ruled-table fixtures for each of them. A layout that has not been checked against
a real document must not be assumed to work: each of the layouts above was found
by reading a real quotation that the previous version of this parser got wrong
(AGENTS.md section 13).
"""

import re
from dataclasses import dataclass

from app.models.quotation import Quotation, QuotationItem
from app.models.review import ParseResult, ReviewFlag, ReviewReason
from app.parser.base import ExtractedPage, ExtractedPdf, Word

# Slack for every coordinate comparison, in points. See point 2 above.
COORDINATE_TOLERANCE = 0.5

# Two words on the same visual line can differ in vertical centre by this much.
# The header's two columns differ by 0.2pt.
LINE_CLUSTER_TOLERANCE = 3.0

# Slack when comparing money, in the smallest unit of the document.
MONEY_TOLERANCE = 0.011

# A horizontal rule this wide counts as a table-wide divider.
MIN_TABLE_WIDTH = 300.0

# A vertical rule this tall counts as a column divider.
MIN_RULE_LENGTH = 100.0

# Two ':' marks closer than this belong to the same label/value column.
COLUMN_GAP = 12.0

# A plain number, with or without thousands separators: "34.00", "19,720.00", "122".
_NUMBER = re.compile(r"^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$")

# An SR# cell holds a small integer.
_SR_NUMBER = re.compile(r"^\d{1,4}$")

# The canonical column names, as the rest of the parser refers to them.
COLUMN_LABELS = (
    "SR#",
    "DESCRIPTION",
    "QTY",
    "UNIT",
    "PRICE/UNIT",
    "DISCOUNT",
    "NET PRICE",
    "TOTAL/AED",
)

# Every spelling of a column label that appears in a real quotation, mapped to
# the canonical column or columns it names. Two shapes matter:
#
# * "PRICE/AED" is the unit price with the currency written into the label.
# * "QTY/UNIT" is one ruled cell holding two values, so it names two columns and
#   the cell has to be split. See :meth:`_resolve_cell`.
COLUMN_ALIASES = {
    "SR#": ("SR#",),
    "DESCRIPTION": ("DESCRIPTION",),
    "QTY": ("QTY",),
    "UNIT": ("UNIT",),
    "QTY/UNIT": ("QTY", "UNIT"),
    "PRICE/UNIT": ("PRICE/UNIT",),
    "PRICE/AED": ("PRICE/UNIT",),
    "DISCOUNT": ("DISCOUNT",),
    "NET PRICE": ("NET PRICE",),
    "TOTAL/AED": ("TOTAL/AED",),
}

REQUIRED_ZONES = ("SR#", "DESCRIPTION", "QTY", "UNIT")

# How many column dividers a page must have before it is taken to hold an item
# grid the parser could not read, and how wide that grid must be. The bar is
# deliberately high: a page with no table at all is an ordinary failure and is
# already reported, and this is only for ruled content that looks like the item
# grid but cannot be read. See :meth:`_looks_like_unreadable_grid`.
MIN_UNREADABLE_DIVIDERS = 4
MIN_UNREADABLE_WIDTH = 300.0

# Header labels that map to a field in the data model. "Date" is absent on
# purpose: the contract has no date field, so it is not extracted. "Nbr" is the
# wording the reference ERP uses for its own quotation number; the longer forms
# cover quotations that spell it out.
HEADER_LABELS = {
    "CLIENT": "client_name",
    "PROJECT": "project_name",
    "NBR": "quotation_number",
    "QUOTATION NBR": "quotation_number",
    "QUOTATION NO": "quotation_number",
    "QUOTATION #": "quotation_number",
    "QUOTATION NUMBER": "quotation_number",
}

MISSING_FIELD_MESSAGES = {
    "quotation_number": "The quotation number was not found. Please type it in.",
    "client_name": "The client name was not found. Please type it in.",
    "project_name": "The project name was not found. Please type it in.",
}


@dataclass(frozen=True)
class ItemTable:
    """The ruled item grid on one page.

    ``is_continuation`` marks a grid that ran off the foot of the previous page
    and carries no column header of its own, so it borrows ``columns`` from the
    page that did. Its ``header_band`` is empty and must not be read.
    """

    columns: tuple[float, ...]
    header_band: tuple[float, float]
    body_band: tuple[float, float]
    is_continuation: bool = False


def cluster_lines(words: tuple[Word, ...]) -> list[list[Word]]:
    """Group words into visual lines, left to right, by vertical centre."""
    ordered = sorted(words, key=lambda word: (word.center_y, word.x0))
    lines: list[list[Word]] = []
    current: list[Word] = []
    anchor: float | None = None
    for word in ordered:
        if anchor is None or word.center_y - anchor <= LINE_CLUSTER_TOLERANCE:
            current.append(word)
            anchor = word.center_y if anchor is None else anchor
        else:
            lines.append(sorted(current, key=lambda item: item.x0))
            current, anchor = [word], word.center_y
    if current:
        lines.append(sorted(current, key=lambda item: item.x0))
    return lines


def in_zone(x: float, zone: tuple[float, float]) -> bool:
    """Whether a horizontal position falls inside a column, tolerantly."""
    return (zone[0] - COORDINATE_TOLERANCE) <= x < (zone[1] - COORDINATE_TOLERANCE)


def in_band(top: float, band: tuple[float, float]) -> bool:
    return (band[0] - COORDINATE_TOLERANCE) <= top <= (band[1] + COORDINATE_TOLERANCE)


def to_float(text: str) -> float | None:
    """Parse a plain number, ignoring thousands separators."""
    if not _NUMBER.match(text.strip()):
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def normalise(text: str) -> str:
    return " ".join(text.split()).upper()


def split_colons(line: list[Word]) -> list[Word]:
    """Split a token such as ``Client:`` into ``Client`` and ``:``.

    Some layouts print the colon against the label, others leave a space. Both
    are handled by making the two spellings look the same before the header is
    read, so the rest of the parser only ever sees a bare ':' token.
    """
    result: list[Word] = []
    for word in line:
        if word.text.endswith(":") and len(word.text) > 1:
            middle = word.x0 + (word.x1 - word.x0) * 0.9
            result.append(Word(word.text[:-1], word.x0, middle, word.top, word.bottom))
            result.append(Word(":", middle, word.x1, word.top, word.bottom))
        else:
            result.append(word)
    return result


class DeterministicQuotationParser:
    """Rule-and-column based parser for ruled ERP quotation tables."""

    def parse(self, document: ExtractedPdf) -> ParseResult:
        """Read the header and every line item, in page order.

        The header and the item table are separate blocks of the page, so a table
        that cannot be read does not cost the header. The page that states its
        columns is the authority for the pages that follow it, which is how a grid
        carrying on over a page break is read without a repeated column header.
        """
        review: list[ReviewFlag] = []
        items: list[QuotationItem] = []
        header: dict[str, str] = {}
        unreadable: list[int] = []

        columns: tuple[float, ...] | None = None
        zones: dict[str, tuple[float, float]] = {}

        for page in document.pages:
            table = self._find_item_table(page)
            if table is not None:
                found = self._zones(table, page)
                if all(zone in found for zone in REQUIRED_ZONES):
                    columns, zones = table.columns, found
                else:
                    table = None

            if table is None and columns is not None:
                table = self._find_continuation_table(page, columns)

            if table is not None and table.is_continuation:
                self._carry_description_over(items, page, table, zones)

            for field, value in self._parse_header(page, table).items():
                header.setdefault(field, value)

            page_items, page_review = self._parse_items(page, table, zones)
            items.extend(page_items)
            review.extend(page_review)

            if table is None and self._looks_like_unreadable_grid(page):
                unreadable.append(page.number)

        if not header or any(field not in header for field in HEADER_LABELS.values()):
            review.extend(self._review_missing_header(header))
        if not items:
            review.append(self._review_no_items(unreadable))

        quotation = Quotation(
            quotation_number=header.get("quotation_number"),
            client_name=header.get("client_name"),
            project_name=header.get("project_name"),
            items=items,
        )
        return ParseResult(quotation=quotation, review=review)

    def _review_no_items(self, unreadable: list[int]) -> ReviewFlag:
        """Ask for the line items, saying whether a table was found and unread.

        A ruled table that was found but not understood is a different situation
        from no table at all, and saying so is the difference between the person
        reviewing it knowing the PDF was read and knowing it was not.
        """
        if not unreadable:
            return ReviewFlag(
                field="items",
                reason=ReviewReason.MISSING,
                message="No line items were found in this quotation. Please add them by hand.",
            )
        pages = " and ".join(str(number) for number in unreadable)
        noun = "page" if len(unreadable) == 1 else "pages"
        return ReviewFlag(
            field="items",
            reason=ReviewReason.UNCONFIDENT,
            message=(
                f"A ruled table on {noun} {pages} was found but could not be read, "
                "so no line items were taken from it. Please add the line items by hand."
            ),
        )

    # ---- locating the ruled table ---------------------------------------

    def _find_item_table(self, page: ExtractedPage) -> ItemTable | None:
        """Find the band whose header names SR# and QTY, and the band below it.

        The bands come from table-wide horizontal rules and the columns from the
        vertical rules between them. A page with no such grid is not guessed at.
        """
        lines = cluster_lines(page.words)
        horizontal = sorted(
            {
                round(rule.top, 2)
                for rule in page.rules
                if rule.is_horizontal and rule.width >= MIN_TABLE_WIDTH
            }
        )
        vertical = [
            rule for rule in page.rules if rule.is_vertical and rule.height >= MIN_RULE_LENGTH
        ]
        if len(horizontal) < 3 or not vertical:
            return None

        left = min(rule.x0 for rule in page.rules if rule.is_horizontal)
        right = max(rule.x1 for rule in page.rules if rule.is_horizontal)

        for index in range(len(horizontal) - 2):
            header_band = (horizontal[index], horizontal[index + 1])
            dividers = sorted(
                {
                    round(rule.x0, 2)
                    for rule in vertical
                    if rule.bottom > header_band[0] - COORDINATE_TOLERANCE
                    and rule.top < header_band[1] + COORDINATE_TOLERANCE
                }
            )
            if len(dividers) < 4:
                continue
            named = self._named_columns(lines, header_band)
            if "SR#" not in named or "QTY" not in named:
                continue
            return ItemTable(
                columns=(left, *dividers, right),
                header_band=header_band,
                body_band=(horizontal[index + 1], horizontal[index + 2]),
            )
        return None

    def _named_columns(self, lines: list[list[Word]], band: tuple[float, float]) -> set[str]:
        """The canonical columns the words inside a band name."""
        named: set[str] = set()
        for line in lines:
            if not in_band(min(item.top for item in line), band):
                continue
            for word in line:
                named.update(COLUMN_ALIASES.get(normalise(word.text), ()))
        return named

    def _find_continuation_table(
        self, page: ExtractedPage, columns: tuple[float, ...]
    ) -> ItemTable | None:
        """Find a grid that carries on from the page before, with no header of its own.

        The page has to rule the same columns as the page that stated them.
        Matching on "this page has vertical rules" alone would turn any ruled
        content that happened to follow the table into line items, so every
        divider the earlier page established has to appear again here.
        """
        vertical = [
            rule for rule in page.rules if rule.is_vertical and rule.height >= MIN_RULE_LENGTH
        ]
        dividers = {round(rule.x0, 2) for rule in vertical}
        expected = columns[1:-1]
        if len(expected) < 3 or not vertical:
            return None
        if not all(
            any(abs(x - other) <= COORDINATE_TOLERANCE for other in dividers) for x in expected
        ):
            return None

        top = min(rule.top for rule in vertical)
        horizontal = sorted(
            {
                round(rule.top, 2)
                for rule in page.rules
                if rule.is_horizontal
                and rule.width >= MIN_TABLE_WIDTH
                and rule.top > top + COORDINATE_TOLERANCE
            }
        )
        if not horizontal:
            return None
        return ItemTable(
            columns=columns,
            header_band=(top, top),
            body_band=(top, horizontal[0]),
            is_continuation=True,
        )

    def _looks_like_unreadable_grid(self, page: ExtractedPage) -> bool:
        """Whether a page holds a ruled item grid whose columns cannot be read.

        A quotation is only reported this way when no items were read at all, so
        this is about the one failure that would otherwise be silent: a grid that
        is plainly there, with its column names in a wording the parser does not
        know, returning an empty quotation with nothing to show.
        """
        vertical = [
            rule for rule in page.rules if rule.is_vertical and rule.height >= MIN_RULE_LENGTH
        ]
        if len({round(rule.x0, 2) for rule in vertical}) < MIN_UNREADABLE_DIVIDERS:
            return False
        horizontal = [
            rule for rule in page.rules if rule.is_horizontal and rule.width >= MIN_UNREADABLE_WIDTH
        ]
        if len(horizontal) < 2:
            return False
        left = min(rule.x0 for rule in horizontal)
        right = max(rule.x1 for rule in horizontal)
        top = min(rule.top for rule in vertical)
        bottom = max(rule.bottom for rule in vertical)
        return any(
            left - COORDINATE_TOLERANCE <= word.x0 <= right + COORDINATE_TOLERANCE
            and top - COORDINATE_TOLERANCE <= word.top <= bottom + COORDINATE_TOLERANCE
            for word in page.words
        )

    def _zones(self, table: ItemTable, page: ExtractedPage) -> dict[str, tuple[float, float]]:
        """Map column labels to the ruled cells they name.

        Only a table that states its own columns is resolved here; a continuation
        borrows the zones of the page it continues.
        """
        if table.is_continuation:
            return {}
        lines = cluster_lines(page.words)
        header_lines = [
            line for line in lines if in_band(min(item.top for item in line), table.header_band)
        ]
        zones: dict[str, tuple[float, float]] = {}
        for index in range(len(table.columns) - 1):
            left, right = table.columns[index], table.columns[index + 1]
            words = [
                word for line in header_lines for word in line if in_zone(word.x0, (left, right))
            ]
            for name, zone in self._resolve_cell(words, left, right):
                zones.setdefault(name, zone)
        return zones

    def _resolve_cell(
        self, words: list[Word], left: float, right: float
    ) -> list[tuple[str, tuple[float, float]]]:
        """The canonical columns one ruled cell names, and the x range of each.

        Three shapes appear in real quotations:

        * one label over one cell, which takes the whole cell;
        * two labels sharing one cell, such as the ``QTY`` and ``UNIT`` between
          x=296 and x=364, split at the second label's left edge;
        * one label naming two columns, such as ``QTY/UNIT``, split at the centre
          of the label. The centre of the label is where its separator falls, so
          the two values the cell holds sit either side of it — in the real
          document the quantity is at x=312.0 and the unit at x=379.8, either side
          of a label centred at x=357.0.
        """
        words = sorted(words, key=lambda word: word.x0)
        if not words:
            return []
        named = COLUMN_ALIASES.get(normalise(" ".join(word.text for word in words)))
        if named is not None:
            if len(named) == 1:
                return [(named[0], (left, right))]
            centre = (words[0].x0 + words[-1].x1) / 2
            edges = [left, centre, right]
            return [
                (name, (edges[position], edges[position + 1]))
                for position, name in enumerate(named)
            ]

        # A cell the PDF happens to space a two-word label out into, such as
        # "NET PRICE", is read as one label; a cell holding two separate labels
        # is split between them.
        inside = sorted(
            (word.x0, normalise(word.text))
            for word in words
            if normalise(word.text) in COLUMN_LABELS
        )
        if not inside:
            return []
        if len(inside) == 1:
            return [(inside[0][1], (left, right))]
        edges = [left, *(x for x, _ in inside[1:]), right]
        return [
            (label, (edges[position], edges[position + 1]))
            for position, (_, label) in enumerate(inside)
        ]

    # ---- header ---------------------------------------------------------

    def _parse_header(self, page: ExtractedPage, table: ItemTable | None) -> dict[str, str]:
        """Read ``label : value`` pairs from the block above the table.

        The block's columns are found by clustering the ':' marks, and each
        column's left edge is the leftmost label seen before that column's
        colon. Values are long enough to run under the next column's label, so
        splitting at the midpoint between colons would misread them.
        """
        lines = [split_colons(line) for line in cluster_lines(page.words)]
        block = self._header_block(page, table)
        if block is not None:
            lines = [line for line in lines if in_band(min(item.top for item in line), block)]
        if not lines:
            return {}

        clusters = self._colon_clusters(lines)
        if len(clusters) < 2:
            return {}
        edges = [float("-inf"), *clusters[1:], float("inf")]

        found: dict[str, str] = {}
        for line in lines:
            for index in range(len(edges) - 1):
                segment = [
                    word for word in line if in_zone(word.x0, (edges[index], edges[index + 1]))
                ]
                colons = [position for position, word in enumerate(segment) if word.text == ":"]
                if not colons:
                    continue
                position = colons[0]
                label = normalise(" ".join(word.text for word in segment[:position]))
                value = " ".join(word.text for word in segment[position + 1 :]).strip()
                field = HEADER_LABELS.get(label)
                if field and value and field not in found:
                    found[field] = value
        return found

    def _header_block(
        self, page: ExtractedPage, table: ItemTable | None
    ) -> tuple[float, float] | None:
        """The band of horizontal rules that encloses the header fields.

        Above a found table this is every wide rule above it. With no table found
        the header still has to be read, because it is a separate block of the
        page: the first two wide rules bound the letterhead the fields sit in.
        """
        wide = sorted(
            {
                round(rule.top, 2)
                for rule in page.rules
                if rule.is_horizontal and rule.width >= MIN_TABLE_WIDTH
            }
        )
        if table is None:
            return (wide[0], wide[1]) if len(wide) >= 2 else None
        above = [top for top in wide if top < table.header_band[0]]
        if not above:
            return None
        return (min(above), max(above))

    def _colon_clusters(self, lines: list[list[Word]]) -> list[float]:
        """One x per label/value column, from the clustered ':' positions."""
        positions = sorted(
            {round(word.x0, 1) for line in lines for word in line if word.text == ":"}
        )
        clusters: list[list[float]] = []
        for x in positions:
            if clusters and x - clusters[-1][-1] <= COLUMN_GAP:
                clusters[-1].append(x)
            else:
                clusters.append([x])

        starts: list[float] = []
        for cluster in clusters:
            anchor = min(cluster)
            best: float | None = None
            for line in lines:
                for position, word in enumerate(line):
                    matches = any(abs(word.x0 - other) <= COLUMN_GAP for other in cluster)
                    if (
                        word.text == ":"
                        and matches
                        and position > 0
                        and (best is None or line[position - 1].x0 < best)
                    ):
                        best = line[position - 1].x0
            starts.append(best if best is not None else anchor)
        return sorted({round(value, 1) for value in starts})

    def _review_missing_header(self, header: dict[str, str]) -> list[ReviewFlag]:
        return [
            ReviewFlag(
                field=field,
                reason=ReviewReason.MISSING,
                message=MISSING_FIELD_MESSAGES.get(
                    field, f"{field} was not found. Please check it."
                ),
            )
            for field in sorted(set(HEADER_LABELS.values()))
            if field not in header
        ]

    # ---- line items -----------------------------------------------------

    def _rows(
        self, page: ExtractedPage, table: ItemTable, zones: dict[str, tuple[float, float]]
    ) -> list[tuple[float, int, list[Word]]]:
        """The body lines that start a row, as (top, SR#, whole line)."""
        rows: list[tuple[float, int, list[Word]]] = []
        for line in cluster_lines(page.words):
            top = min(item.top for item in line)
            if not in_band(top, table.body_band):
                continue
            serials = [
                word
                for word in line
                if in_zone(word.x0, zones["SR#"]) and _SR_NUMBER.match(word.text)
            ]
            if serials:
                rows.append((top, int(serials[0].text), line))
        return rows

    def _carry_description_over(
        self,
        items: list[QuotationItem],
        page: ExtractedPage,
        table: ItemTable,
        zones: dict[str, tuple[float, float]],
    ) -> None:
        """Attach a continuation page's leading description lines to the row above.

        When a grid runs off the foot of a page, the last row's description
        carries on under the top of the next page with no SR# of its own. Those
        lines finish the row above them; they must not start, or join, a row of
        their own.
        """
        if not items or "DESCRIPTION" not in zones:
            return
        description = zones["DESCRIPTION"]
        rows = self._rows(page, table, zones)
        limit = rows[0][0] if rows else table.body_band[1]
        tail = " ".join(
            self._cell_text(line, description)
            for line in cluster_lines(page.words)
            if in_band(min(item.top for item in line), table.body_band)
            and min(item.top for item in line) < limit
        ).strip()
        if not tail:
            return
        last = items[-1]
        items[-1] = last.model_copy(
            update={"description": " ".join(f"{last.description} {tail}".split())}
        )

    def _parse_items(
        self,
        page: ExtractedPage,
        table: ItemTable | None,
        zones: dict[str, tuple[float, float]],
    ) -> tuple[list[QuotationItem], list[ReviewFlag]]:
        if table is None or any(zone not in zones for zone in REQUIRED_ZONES):
            return [], []

        rows = self._rows(page, table, zones)
        lines = cluster_lines(page.words)
        items: list[QuotationItem] = []
        review: list[ReviewFlag] = []
        for index, (top, serial, line) in enumerate(rows):
            stop = rows[index + 1][0] if index + 1 < len(rows) else table.body_band[1]
            description = self._cell_text(line, zones["DESCRIPTION"])
            for continuation in lines:
                continuation_top = min(item.top for item in continuation)
                if top < continuation_top < stop:
                    extra = self._cell_text(continuation, zones["DESCRIPTION"])
                    description = f"{description} {extra}".strip()

            quantity = self._quantity(line, zones["QTY"])
            unit = self._cell_text(line, zones["UNIT"]) or None
            position = len(items)
            items.append(
                QuotationItem(
                    sr=serial,
                    description=" ".join(description.split()),
                    quantity=quantity,
                    unit=unit,
                )
            )
            review.extend(self._review_item(position, quantity, unit, description))
            review.extend(self._review_arithmetic(position, line, zones, quantity))
        return items, review

    def _cell_text(self, line: list[Word], zone: tuple[float, float]) -> str:
        return " ".join(word.text for word in line if in_zone(word.x0, zone)).strip()

    def _quantity(self, line: list[Word], zone: tuple[float, float]) -> float | None:
        """Read the quantity from the ruled QTY cell.

        A zero is treated as a failure to read, not a value: a quotation line
        never legitimately has a quantity of zero, so a zero means the cell was
        not identified and the field is sent for review instead of written out
        wrong.
        """
        for word in line:
            if not in_zone(word.x0, zone):
                continue
            value = to_float(word.text)
            if value is not None:
                return value if value > 0 else None
        return None

    def _first_number(self, line: list[Word], zone: tuple[float, float] | None) -> float | None:
        if zone is None:
            return None
        for word in line:
            if in_zone(word.x0, zone):
                value = to_float(word.text)
                if value is not None:
                    return value
        return None

    def _review_item(
        self,
        position: int,
        quantity: float | None,
        unit: str | None,
        description: str,
    ) -> list[ReviewFlag]:
        review: list[ReviewFlag] = []
        line_number = position + 1
        if quantity is None:
            review.append(
                ReviewFlag(
                    field=f"items[{position}].quantity",
                    reason=ReviewReason.MISSING,
                    message=(
                        f"Line {line_number}: the quantity was not readable. Please type it in."
                    ),
                )
            )
        if unit is None:
            review.append(
                ReviewFlag(
                    field=f"items[{position}].unit",
                    reason=ReviewReason.MISSING,
                    message=f"Line {line_number}: the unit was not readable. Please check it.",
                )
            )
        if not description.strip():
            review.append(
                ReviewFlag(
                    field=f"items[{position}].description",
                    reason=ReviewReason.MISSING,
                    message=(
                        f"Line {line_number}: the description is missing from the PDF. "
                        "Please type it in."
                    ),
                )
            )
        return review

    def _review_arithmetic(
        self,
        position: int,
        line: list[Word],
        zones: dict[str, tuple[float, float]],
        quantity: float | None,
    ) -> list[ReviewFlag]:
        """Flag a row whose own figures do not agree.

        ``PRICE/UNIT - DISCOUNT = NET PRICE`` and ``QTY x NET PRICE = TOTAL/AED``.
        A failure means the row was probably read from the wrong cell, so a
        person has to check it. The values are reported exactly as read: this
        check never repairs a quantity.
        """
        if all(zone not in zones for zone in ("PRICE/UNIT", "DISCOUNT", "NET PRICE", "TOTAL/AED")):
            return []

        price = self._first_number(line, zones.get("PRICE/UNIT"))
        discount = self._first_number(line, zones.get("DISCOUNT"))
        net = self._first_number(line, zones.get("NET PRICE"))
        total = self._first_number(line, zones.get("TOTAL/AED"))

        problems: list[str] = []
        if (
            price is not None
            and discount is not None
            and net is not None
            and abs((price - discount) - net) > MONEY_TOLERANCE
        ):
            problems.append(
                f"price {price:,.2f} less discount {discount:,.2f} is not the net {net:,.2f}"
            )
        if (
            quantity is not None
            and net is not None
            and total is not None
            and abs((quantity * net) - total) > MONEY_TOLERANCE
        ):
            problems.append(
                f"quantity {quantity:,.2f} times net {net:,.2f} is not the total {total:,.2f}"
            )
        if not problems:
            return []
        return [
            ReviewFlag(
                field=f"items[{position}].quantity",
                reason=ReviewReason.INCONSISTENT,
                message=(
                    f"Line {position + 1}: the figures in this row do not add up "
                    f"({' and '.join(problems)}). Please check the quotation."
                ),
            )
        ]
