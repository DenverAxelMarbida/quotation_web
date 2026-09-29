"""Dependency wiring.

This is the only module that binds concrete implementations to the application.
Tests override these functions to inject stub implementations.

- `get_extraction_service`: Binds the PDF parser implementation
- `get_excel_generator`: Binds the Excel workbook generator implementation
"""

from fastapi import Depends

from app.excel.base import WorkbookGenerator
from app.excel.openpyxl_generator import OpenpyxlWorkbookGenerator
from app.parser.deterministic import DeterministicQuotationParser
from app.parser.pdfplumber_extractor import PdfplumberTextExtractor
from app.services.quotation_service import QuotationExtractionService


def get_extraction_service() -> QuotationExtractionService:
    return QuotationExtractionService(
        extractor=PdfplumberTextExtractor(),
        parser=DeterministicQuotationParser(),
    )


def get_excel_generator() -> WorkbookGenerator:
    return OpenpyxlWorkbookGenerator()


ExtractionService = Depends(get_extraction_service)
ExcelGenerator = Depends(get_excel_generator)
