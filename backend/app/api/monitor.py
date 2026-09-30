"""Monitoring routes.

The user keeps the Excel file in OneDrive and comes back to it days later. This
route opens that file and returns its rows as JSON so the upload screen can show
what was found.

It only reads. Nothing is merged into the current session, no row is written
back, and the existing quotation routes are untouched.
"""

from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status

from app.api.errors import ApiErrorResponse
from app.dependencies import MonitorImport
from app.models.monitor import ImportedMonitor
from app.services.errors import MAX_UPLOAD_BYTES, UploadTooLargeError
from app.services.monitor_import_service import MonitorImportService

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.post(
    "/import",
    response_model=ImportedMonitor,
    status_code=status.HTTP_200_OK,
    summary="Read an existing monitoring workbook",
    responses={
        413: {"model": ApiErrorResponse, "description": "File too large"},
        415: {"model": ApiErrorResponse, "description": "Not a readable .xlsx file"},
        422: {"model": ApiErrorResponse, "description": "Not a monitoring sheet"},
    },
)
async def import_monitor(
    service: Annotated[MonitorImportService, MonitorImport],
    file: Annotated[UploadFile, File(description="The monitoring .xlsx file")],
) -> ImportedMonitor:
    """Return the rows found in an uploaded monitoring workbook.

    The response is a read-only preview of what is already in the file. It does
    not change the workbook, and it does not become part of the current
    quotation session.
    """
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadTooLargeError(
            f"The uploaded file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )
    return service.import_monitor(content, filename=file.filename or "monitoring_sheet.xlsx")
