"""End-to-end check of the parser against the real ERP quotation.

This is the only test that touches the actual document. The expectations are the
values recorded in AGENTS.md section 4, and the file is confidential so it is not
committed (AGENTS.md sections 10 and 13); the test skips when it is absent.

It is here because it is the one place where a wrong quantity would otherwise
go unnoticed: the synthetic fixture can only prove the parser matches the
geometry it was built for.
"""

from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from tests.conftest import load_reference_quotation

parse = DeterministicQuotationParser()
extract = PdfplumberTextExtractor()


def test_the_real_quotation_reads_its_header() -> None:
    result = parse.parse(extract.extract(load_reference_quotation()))

    assert result.quotation.quotation_number == "QDXB/25/014094/Rev1"
    assert result.quotation.client_name == "ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C"
    assert result.quotation.project_name == "MBRC 466"


def test_the_real_quotation_reads_all_three_items() -> None:
    result = parse.parse(extract.extract(load_reference_quotation()))

    assert [item.sr for item in result.quotation.items] == ["1", "2", "3"]
    assert [item.unit for item in result.quotation.items] == ["m2", "m2", "m2"]


def test_the_real_quotation_quantities_come_from_the_qty_cells() -> None:
    # 34 and 88 are the values in the ruled QTY cells. The figures this replaced,
    # 30 and 55, are the DISCOUNT cells and do not satisfy the quotation's own
    # arithmetic; these do (see AGENTS.md section 4).
    result = parse.parse(extract.extract(load_reference_quotation()))

    assert [item.quantity for item in result.quotation.items] == [34.0, 88.0, 122.0]


def test_the_real_quotation_descriptions_keep_their_codes() -> None:
    result = parse.parse(extract.extract(load_reference_quotation()))

    assert result.quotation.items[0].description.startswith("FF-04")
    assert result.quotation.items[1].description.startswith("FF-05")
    assert result.quotation.items[2].description == "Self-levelling up to 3mm"


def test_the_real_quotation_needs_no_review() -> None:
    result = parse.parse(extract.extract(load_reference_quotation()))

    assert result.review == []


def test_the_real_quotation_second_page_is_not_read_as_items() -> None:
    result = parse.parse(extract.extract(load_reference_quotation()))

    # The document has two pages; the second holds terms and totals.
    assert len(result.quotation.items) == 3
