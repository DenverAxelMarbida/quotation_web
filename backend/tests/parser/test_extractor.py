"""Tests for the PDF extractor and the parser protocols."""

import io

import pdfplumber
import pytest

from app.parser import pdfplumber_extractor
from app.parser.base import PdfTextExtractor, QuotationParser
from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from app.services.errors import EmptyDocumentError, UnsupportedDocumentError
from tests.fixtures.build_quotation_pdf import reference_pdf, unruled_pdf


def test_concrete_implementations_satisfy_the_protocols() -> None:
    # This is the guarantee that makes the parser replaceable: the API layer
    # only ever sees the protocol.
    assert isinstance(PdfplumberTextExtractor(), PdfTextExtractor)
    assert isinstance(DeterministicQuotationParser(), QuotationParser)


def test_empty_upload_is_rejected() -> None:
    with pytest.raises(UnsupportedDocumentError):
        PdfplumberTextExtractor().extract(b"")


def test_non_pdf_upload_is_rejected() -> None:
    with pytest.raises(UnsupportedDocumentError):
        PdfplumberTextExtractor().extract(b"this is a text file, not a PDF")


def test_damaged_pdf_is_rejected() -> None:
    with pytest.raises(UnsupportedDocumentError):
        PdfplumberTextExtractor().extract(b"%PDF-1.4\nthis is truncated garbage")


def test_a_pdf_without_text_is_reported_as_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    # A scanned quotation opens fine but yields no words. The user must be told,
    # not left with an empty result that looks like a parsing success.
    class BlankPage:
        lines: list = []
        rects: list = []

        def extract_words(self, *args: object, **kwargs: object) -> list:
            return []

    class BlankDocument:
        pages = [BlankPage()]

        def __enter__(self) -> "BlankDocument":
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(pdfplumber_extractor.pdfplumber, "open", lambda *_: BlankDocument())

    with pytest.raises(EmptyDocumentError):
        PdfplumberTextExtractor().extract(b"%PDF-1.4 pretend this is valid")


def test_an_unreadable_page_does_not_lose_the_other_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    class GoodPage:
        lines: list = []
        rects: list = []

        def extract_words(self, *args: object, **kwargs: object) -> list:
            return [{"text": "Client", "x0": 24.0, "x1": 40.0, "top": 121.0, "bottom": 129.0}]

    class BrokenPage:
        lines: list = []
        rects: list = []

        def extract_words(self, *args: object, **kwargs: object) -> list:
            raise ValueError("unreadable glyphs")

    class MixedDocument:
        pages = [GoodPage(), BrokenPage()]

        def __enter__(self) -> "MixedDocument":
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(pdfplumber_extractor.pdfplumber, "open", lambda *_: MixedDocument())

    document = PdfplumberTextExtractor().extract(b"%PDF-1.4 pretend this is valid")

    assert document.page_count == 2
    assert [word.text for word in document.pages[0].words] == ["Client"]
    # The page that could not be read is empty rather than absent, so the user is
    # still told about it.
    assert document.pages[1].words == ()
    assert document.pages[1].has_text is False


def test_text_is_extracted_with_its_position() -> None:
    document = PdfplumberTextExtractor().extract(reference_pdf())

    page = document.pages[0]
    assert page.number == 1
    assert page.has_text
    quantity = next(word for word in page.words if word.text == "34.00")
    assert quantity.x0 == pytest.approx(300.0, abs=0.001)
    assert quantity.top > 0


def test_drawn_rules_are_extracted() -> None:
    # The table's borders are what say where each column starts, so the extractor
    # has to hand them on rather than flattening them away.
    document = PdfplumberTextExtractor().extract(reference_pdf())

    rules = document.pages[0].rules
    horizontal = {rule.top for rule in rules if rule.is_horizontal}
    vertical = {round(rule.x0, 2) for rule in rules if rule.is_vertical}
    assert 266.8 in {round(top, 2) for top in horizontal}
    assert 296.8 in {round(top, 2) for top in horizontal}
    assert 40.25 in vertical
    assert 296.0 in vertical
    assert 364.25 in vertical


def test_a_page_without_rules_yields_none() -> None:
    document = PdfplumberTextExtractor().extract(unruled_pdf())

    assert document.pages[0].rules == ()


def test_a_pdf_with_no_borders_still_extracts_its_text() -> None:
    document = PdfplumberTextExtractor().extract(unruled_pdf())

    assert document.has_text


def test_the_generated_fixture_really_draws_a_table() -> None:
    # Guards the fixture itself: if the generated PDF stopped producing rules,
    # every parser test would pass for the wrong reason.
    with pdfplumber.open(io.BytesIO(reference_pdf())) as pdf:
        quotation_page, terms_page = pdf.pages

        # The quotation page is divided into columns; the terms page is not, which
        # is what stops numbers on it being read as line items.
        assert (
            len({round(line["x0"], 2) for line in quotation_page.lines if line["x1"] == line["x0"]})
            >= 4
        )
        assert len({line["x0"] for line in terms_page.lines if line["x1"] == line["x0"]}) < 4
