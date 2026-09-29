"""Parser interfaces.

This module is the seam that keeps the rest of the backend independent of any
particular PDF library or parsing strategy:

    PDF bytes ──[PdfTextExtractor]──▶ ExtractedPdf ──[QuotationParser]──▶ ParseResult

Both steps are :class:`typing.Protocol` definitions, so an alternative
implementation (a different PDF library, a layout-aware parser, a fixture-based
stub in tests) only has to satisfy the shape. Nothing in the API layer imports a
concrete implementation, which is what keeps the API contract stable when the
parser is replaced.

Why positions, not text
-----------------------
ERP quotation tables put the quantity, the unit and the prices in ruled cells.
A flattened text stream interleaves those columns, and in the reference
quotation the ``DISCOUNT`` value then reads as if it were the quantity. The
extractor therefore hands the parser *positions* — text runs and the lines the
PDF actually draws — and the parser reads each value from its own cell. See
``deterministic.py`` for the rules and ``UPDATED_DETAILS.md`` section 1 for the
evidence that made this change necessary.

The data model returned by a parser contains only extracted fields. Sequence
number, installation schedule, start date and status are never produced here.
"""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.models.review import ParseResult

# A drawn line thinner/thinner than this many points is treated as horizontal or
# vertical rather than as a line of some angle.
RULE_EPSILON = 1.0


@dataclass(frozen=True)
class Word:
    """A text run with its position on the page, in PDF points from the top left."""

    text: str
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def center_y(self) -> float:
        return (self.top + self.bottom) / 2.0


@dataclass(frozen=True)
class Rule:
    """A straight line drawn on the page, typically a table border.

    Rules are the ground truth for where a column starts and ends. Header labels
    cannot be used for this: in the reference quotation the ``DESCRIPTION``
    label sits at x=144 while the description text is written at x=42.
    """

    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def is_horizontal(self) -> bool:
        return abs(self.bottom - self.top) <= RULE_EPSILON

    @property
    def is_vertical(self) -> bool:
        return abs(self.x1 - self.x0) <= RULE_EPSILON

    @property
    def width(self) -> float:
        return abs(self.x1 - self.x0)

    @property
    def height(self) -> float:
        return abs(self.bottom - self.top)


@dataclass(frozen=True)
class ExtractedPage:
    """One page as positioned text runs plus the lines drawn on it."""

    number: int
    words: tuple[Word, ...] = ()
    rules: tuple[Rule, ...] = ()

    @property
    def has_text(self) -> bool:
        return any(word.text.strip() for word in self.words)


@dataclass(frozen=True)
class ExtractedPdf:
    """The result of turning PDF bytes into positioned text and drawn rules."""

    pages: tuple[ExtractedPage, ...] = field(default_factory=tuple)

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def has_text(self) -> bool:
        return any(page.has_text for page in self.pages)


@runtime_checkable
class PdfTextExtractor(Protocol):
    """Turns raw PDF bytes into positioned text and rules."""

    def extract(self, pdf_bytes: bytes) -> ExtractedPdf:
        """Extract a PDF.

        Raises:
            app.services.errors.UnsupportedDocumentError: the bytes are not a
                readable PDF.
            app.services.errors.EmptyDocumentError: the PDF opened but holds no
                text, e.g. a scan.
            app.services.errors.ExtractionFailedError: the PDF could not be read.
        """
        ...


@runtime_checkable
class QuotationParser(Protocol):
    """Turns an extracted document into structured quotation data."""

    def parse(self, document: ExtractedPdf) -> ParseResult:
        """Parse an extracted document.

        Implementations must not raise on unexpected content. A quotation that
        cannot be understood comes back with empty fields and review flags, so
        the user is asked to fill it in rather than being given a wrong value.
        """
        ...
