"""PDF extraction and quotation parsing.

`base` holds the protocols every implementation satisfies; the concrete
extractor and parser live in sibling modules and are re-exported here for
convenience. Nothing outside this package should import a PDF library.
"""

from app.parser.base import (
    ExtractedPage,
    ExtractedPdf,
    PdfTextExtractor,
    QuotationParser,
    Rule,
    Word,
)
from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor

__all__ = [
    "DeterministicQuotationParser",
    "ExtractedPage",
    "ExtractedPdf",
    "PdfTextExtractor",
    "PdfplumberTextExtractor",
    "QuotationParser",
    "Rule",
    "Word",
]
