"""Quotation extraction service.

Orchestrates the pipeline described in AGENTS.md section 1:

    PDF bytes -> PdfTextExtractor -> QuotationParser -> QuotationPreview

Both collaborators are injected as protocols, so the parser can be replaced
without touching this service, the API layer or the data model. That is what the
tests in ``tests/services`` exercise with stub implementations.
"""

from app.models.preview import QuotationPreview, SourceInfo
from app.models.review import ReviewFlag, ReviewReason
from app.parser.base import ExtractedPdf, PdfTextExtractor, QuotationParser
from app.services.errors import EmptyDocumentError


class QuotationExtractionService:
    def __init__(self, extractor: PdfTextExtractor, parser: QuotationParser) -> None:
        self._extractor = extractor
        self._parser = parser

    def build_preview(self, pdf_bytes: bytes, filename: str) -> QuotationPreview:
        """Extract and parse a quotation PDF into reviewable structured data."""
        document = self._extractor.extract(pdf_bytes)
        result = self._parser.parse(document)
        page_warnings = self._page_warnings(document)

        return QuotationPreview(
            quotation=result.quotation,
            review=[*result.review, *page_warnings],
            source=SourceInfo(
                filename=filename,
                page_count=document.page_count,
                warnings=[flag.message for flag in page_warnings],
            ),
        )

    def _page_warnings(self, document: ExtractedPdf) -> list[ReviewFlag]:
        """Report pages that produced no text.

        A blank page usually means a scanned or image-only section, so the user
        is told rather than left with a silently incomplete extraction.
        """
        return [
            ReviewFlag(
                field=f"source.page_{page.number}",
                reason=ReviewReason.MISSING,
                message=(
                    f"Page {page.number} of the PDF contains no readable text. "
                    "Please check the quotation against the original."
                ),
            )
            for page in document.pages
            if not page.has_text
        ]


__all__ = ["EmptyDocumentError", "QuotationExtractionService"]
