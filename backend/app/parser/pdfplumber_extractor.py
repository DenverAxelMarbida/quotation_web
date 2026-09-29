"""PDF text extraction implementation.

Only place in the codebase that knows which PDF library is used. Swapping the
library means changing this module and nothing else.

Why pdfplumber: the quotation table is *drawn*. The ERP renders the item grid
with real ruled lines, and every value sits inside the cell it belongs to. That
makes the drawn rules a reliable statement of where each column starts, which
is not something a flattened text stream can express. pypdf was used first and
rejected for exactly this reason: it exposes run-level coordinates only, and its
output interleaved the ``DISCOUNT`` column into the position where the quantity
belongs. See ``UPDATED_DETAILS.md`` sections 1 and 5.

The extractor deliberately does no interpretation. It converts pdfplumber's
words and lines into :class:`~app.parser.base.Word` and
:class:`~app.parser.base.Rule` and stops there, so every parsing decision lives
in the parser where it can be tested without a PDF library.
"""

import io
from typing import Any

import pdfplumber

from app.parser.base import ExtractedPage, ExtractedPdf, Rule, Word
from app.services.errors import (
    EmptyDocumentError,
    ExtractionFailedError,
    UnsupportedDocumentError,
)

PDF_MAGIC = b"%PDF"

# Failures pdfplumber/pdfminer raise for a damaged or encrypted file. The exact
# classes differ between versions, so they are matched by name rather than
# imported, which keeps this module working across upgrades. "PdfminerException"
# is the wrapper pdfplumber puts around pdfminer's own errors.
_UNREADABLE = {
    "PdfminerException",
    "PDFSyntaxError",
    "PDFEncryptionError",
    "PDFPasswordIncorrect",
    "PSEOF",
    "PSException",
    "ValueError",
    "TypeError",
    "KeyError",
    "IndexError",
    "AttributeError",
    "FileNotFoundError",
    "OSError",
    "RecursionError",
}


class PdfplumberTextExtractor:
    """Extracts positioned text and drawn rules using pdfplumber."""

    def extract(self, pdf_bytes: bytes) -> ExtractedPdf:
        if not pdf_bytes:
            raise UnsupportedDocumentError("The uploaded file is empty.")

        if pdf_bytes.lstrip()[: len(PDF_MAGIC)] != PDF_MAGIC:
            raise UnsupportedDocumentError(
                "The uploaded file is not a PDF. Please upload the quotation PDF."
            )

        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                pages = tuple(
                    self._read_page(page, index) for index, page in enumerate(pdf.pages, 1)
                )
        except EmptyDocumentError:
            raise
        except Exception as error:  # noqa: BLE001 - library raises many unrelated types
            if type(error).__name__ not in _UNREADABLE:
                raise ExtractionFailedError(
                    "The quotation PDF could not be read. Please try exporting it again."
                ) from error
            raise UnsupportedDocumentError(
                "This PDF could not be opened. It may be damaged or password protected."
            ) from error

        document = ExtractedPdf(pages=pages)
        if not document.has_text:
            raise EmptyDocumentError(
                "No text could be read from this PDF. If it is a scanned document, "
                "please upload a text-based PDF."
            )
        return document

    def _read_page(self, page: Any, index: int) -> ExtractedPage:
        """Convert one page, tolerating a page that cannot be read.

        A single unreadable page must not fail the whole upload, so the failure
        is absorbed here and surfaces later as a review flag on that page.
        """
        try:
            words = tuple(
                Word(
                    text=item["text"],
                    x0=float(item["x0"]),
                    x1=float(item["x1"]),
                    top=float(item["top"]),
                    bottom=float(item["bottom"]),
                )
                for item in page.extract_words()
            )
            rules = tuple(
                Rule(
                    x0=float(item["x0"]),
                    x1=float(item["x1"]),
                    top=float(item["top"]),
                    bottom=float(item["bottom"]),
                )
                for item in page.lines
            )
        except Exception:  # noqa: BLE001 - one bad page must not fail the upload
            return ExtractedPage(number=index)
        return ExtractedPage(number=index, words=words, rules=rules)
