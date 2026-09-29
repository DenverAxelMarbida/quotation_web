"""Quotation routes.

Small API on purpose (AGENTS.md section 3). Each route delegates to a service;
no parsing or business logic lives here.
"""

from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from fastapi.responses import Response

from app.api.errors import ApiErrorResponse
from app.dependencies import ExcelGenerator, ExtractionService
from app.excel.base import WorkbookGenerator
from app.models.preview import QuotationPreview
from app.models.quotation import Quotation
from app.models.workbook import ConsolidatedWorkbookRequest
from app.services.errors import (
    MAX_UPLOAD_BYTES,
    UnsupportedDocumentError,
    UploadTooLargeError,
)
from app.services.quotation_service import QuotationExtractionService

router = APIRouter(prefix="/quotations", tags=["quotations"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _safe_filename_part(value: str | None) -> str:
    """Keep only characters that are safe in a download filename."""
    if not value:
        return ""
    return "".join(c for c in value if c.isalnum() or c in ("-", "_"))


def _xlsx_response(content: bytes, filename_base: str) -> Response:
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'},
    )


@router.post(
    "/parse",
    response_model=QuotationPreview,
    status_code=status.HTTP_200_OK,
    summary="Extract structured quotation data from a PDF",
    responses={
        413: {"model": ApiErrorResponse, "description": "File too large"},
        415: {"model": ApiErrorResponse, "description": "Not a readable PDF"},
        422: {"model": ApiErrorResponse, "description": "No readable text"},
    },
)
async def parse_quotation(
    service: Annotated[QuotationExtractionService, ExtractionService],
    file: Annotated[UploadFile, File(description="The ERP quotation PDF")],
) -> QuotationPreview:
    """Return structured quotation data plus a list of fields needing review.

    The response is a preview, never a finished result: the user edits it and
    confirms before anything is written to Excel.
    """
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise UnsupportedDocumentError("The uploaded file is empty.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise UploadTooLargeError(
            f"The uploaded file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )
    return service.build_preview(pdf_bytes, filename=file.filename or "quotation.pdf")


@router.post(
    "/generate-excel",
    status_code=status.HTTP_200_OK,
    summary="Generate Excel workbook from confirmed quotation data",
    response_class=Response,
    responses={
        200: {
            "content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}},
            "description": "Excel workbook (.xlsx) file",
        },
    },
)
async def generate_excel(
    quotation: Quotation,
    generator: Annotated[WorkbookGenerator, ExcelGenerator],
) -> Response:
    """Generate and return an Excel workbook from confirmed quotation data.

    The quotation data has already been reviewed and edited by the user. This
    endpoint generates a Summary worksheet with one row per quotation item,
    following the structure specified in AGENTS.md section 7.

    Returns:
        Excel workbook as downloadable .xlsx file
    """
    xlsx_bytes = generator.generate(quotation)

    safe_number = _safe_filename_part(quotation.quotation_number)
    filename_base = f"quotation_{safe_number}" if safe_number else "quotation"

    return _xlsx_response(xlsx_bytes, filename_base)


@router.post(
    "/generate-consolidated-excel",
    status_code=status.HTTP_200_OK,
    summary="Generate consolidated Excel workbook from multiple confirmed quotations",
    response_class=Response,
    responses={
        200: {
            "content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}},
            "description": "Consolidated Excel workbook (.xlsx) file",
        },
    },
)
async def generate_consolidated_excel(
    request: ConsolidatedWorkbookRequest,
    generator: Annotated[WorkbookGenerator, ExcelGenerator],
) -> Response:
    """Generate and return a consolidated Excel workbook from multiple confirmed quotations.

    Each quotation in the request contributes its line items to the Excel workbook,
    with all items from a single quotation sharing the same sequence number.
    The quotation data has already been reviewed and edited by the user.

    Returns:
        Consolidated Excel workbook as downloadable .xlsx file
    """
    xlsx_bytes = generator.generate_consolidated(request)

    first_number = request.quotations[0].quotation.quotation_number if request.quotations else None
    safe_number = _safe_filename_part(first_number)
    filename_base = f"consolidated_{safe_number}" if safe_number else "consolidated_quotations"

    return _xlsx_response(xlsx_bytes, filename_base)
