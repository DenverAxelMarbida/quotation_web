"""Service tests.

The extractor and parser are replaced with stubs, which is the practical proof
that the pipeline is decoupled: no PDF library and no parsing rules are involved.
"""

from app.models.quotation import Quotation, QuotationItem
from app.models.review import ParseResult, ReviewFlag, ReviewReason
from app.parser.base import (
    ExtractedPage,
    ExtractedPdf,
    PdfTextExtractor,
    QuotationParser,
    Word,
)
from app.services.quotation_service import QuotationExtractionService

FIRST_PAGE_WORDS = (
    Word("Client", 24.0, 40.0, 121.0, 129.0),
    Word("STUB", 78.0, 96.0, 121.0, 129.0),
)


class StubExtractor:
    """Stands in for any PDF library."""

    def extract(self, pdf_bytes: bytes) -> ExtractedPdf:
        # The second page is deliberately empty, as a scanned page would be.
        return ExtractedPdf(
            pages=(
                ExtractedPage(number=1, words=FIRST_PAGE_WORDS),
                ExtractedPage(number=2),
            )
        )


class StubParser:
    """Stands in for any parsing strategy."""

    def parse(self, document: ExtractedPdf) -> ParseResult:
        return ParseResult(
            quotation=Quotation(
                quotation_number="STUB-1",
                client_name="STUB CLIENT",
                project_name=None,
                items=[QuotationItem(sr="1", description="stub", quantity=1.0, unit="m2")],
            ),
            review=[
                ReviewFlag(
                    field="project_name",
                    reason=ReviewReason.MISSING,
                    message="not found",
                )
            ],
        )


def service() -> QuotationExtractionService:
    return QuotationExtractionService(extractor=StubExtractor(), parser=StubParser())


def test_stub_implementations_satisfy_the_protocols() -> None:
    assert isinstance(StubExtractor(), PdfTextExtractor)
    assert isinstance(StubParser(), QuotationParser)


def test_preview_is_built_from_the_stub_pipeline() -> None:
    preview = service().build_preview(b"%PDF-1.4 fake", filename="quote.pdf")

    assert preview.quotation.quotation_number == "STUB-1"
    assert preview.quotation.project_name is None
    assert preview.source.filename == "quote.pdf"
    assert preview.source.page_count == 2


def test_blank_pages_are_reported_to_the_user() -> None:
    preview = service().build_preview(b"%PDF-1.4 fake", filename="quote.pdf")

    assert [flag.field for flag in preview.review if flag.field.startswith("source.page_")] == [
        "source.page_2"
    ]
    assert preview.source.warnings


def test_parser_review_flags_are_passed_through() -> None:
    preview = service().build_preview(b"%PDF-1.4 fake", filename="quote.pdf")

    assert "project_name" in {flag.field for flag in preview.review}
