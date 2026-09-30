"""Structured API errors.

AGENTS.md section 9: backend errors must be understandable and actionable rather
than technical. Every failure the user can cause returns the same envelope::

    {"error": {"code": "unsupported_document", "message": "...", "detail": "..."}}

``message`` is safe to show to a non-technical user. ``detail`` is for logs and
is omitted unless it carries information the user needs.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.errors import (
    EmptyDocumentError,
    EmptySummaryError,
    ExtractionError,
    ExtractionFailedError,
    InvalidSequenceNumberError,
    InvalidStatusValueError,
    MissingColumnsError,
    MissingSummarySheetError,
    MonitorImportError,
    NotExcelError,
    UnsupportedDocumentError,
    UploadTooLargeError,
)

logger = logging.getLogger(__name__)


class ApiError(BaseModel):
    code: str
    message: str
    detail: str | None = None


class ApiErrorResponse(BaseModel):
    error: ApiError


# Domain error -> (HTTP status, user-facing message, safe to show detail)
ERROR_CATALOGUE: dict[type[ExtractionError], tuple[int, str, str | None]] = {
    UnsupportedDocumentError: (
        415,
        "This file could not be read as a quotation PDF.",
        "Upload the original quotation PDF exported from the ERP.",
    ),
    EmptyDocumentError: (
        422,
        "No text could be read from this PDF.",
        "Scanned quotations are not supported yet. Export a text-based PDF and try again.",
    ),
    ExtractionFailedError: (
        422,
        "The quotation PDF could not be read.",
        "Try exporting the quotation from the ERP again, then upload the new file.",
    ),
    UploadTooLargeError: (
        413,
        "The uploaded file is too large.",
        "Upload a smaller PDF, or split the quotation and upload it in parts.",
    ),
}


def error_payload(code: str, message: str, detail: str | None) -> dict[str, object]:
    return {"error": {"code": code, "message": message, "detail": detail}}


# A monitoring import failure names the exact problem in its own message, so the
# status and the short headline are looked up here while the exception's message
# becomes the detail the user reads.
MONITOR_IMPORT_CATALOGUE: dict[type[MonitorImportError], tuple[int, str]] = {
    NotExcelError: (
        415,
        "This file could not be opened as an Excel file.",
    ),
    MissingSummarySheetError: (
        422,
        "This Excel file is not a monitoring sheet.",
    ),
    MissingColumnsError: (
        422,
        "This Excel file is not a monitoring sheet.",
    ),
    EmptySummaryError: (
        422,
        "This monitoring sheet has no rows yet.",
    ),
    InvalidSequenceNumberError: (
        422,
        "This monitoring sheet has a row the application cannot read.",
    ),
    InvalidStatusValueError: (
        422,
        "This monitoring sheet has a Status value the application does not use.",
    ),
}


def register_error_handlers(app: FastAPI) -> None:
    """Map domain errors and unexpected failures onto the error envelope."""

    @app.exception_handler(MonitorImportError)
    async def handle_monitor_import_error(
        request: Request, error: MonitorImportError
    ) -> JSONResponse:
        status, message = _resolve_monitor_import(error)
        logger.warning("Monitor import failed on %s: %s", request.url.path, error)
        return JSONResponse(
            status_code=status,
            content=error_payload(_monitor_import_code_for(error), message, str(error)),
        )

    @app.exception_handler(ExtractionError)
    async def handle_extraction_error(request: Request, error: ExtractionError) -> JSONResponse:
        status, message, detail = _resolve(error)
        logger.warning("Extraction failed on %s: %s", request.url.path, error)
        return JSONResponse(
            status_code=status,
            content=error_payload(_code_for(error), message, detail),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content=error_payload(
                "internal_error",
                "Something went wrong while processing the quotation.",
                None,
            ),
        )


def _resolve(error: ExtractionError) -> tuple[int, str, str | None]:
    for error_type, entry in ERROR_CATALOGUE.items():
        if isinstance(error, error_type):
            return entry
    return 422, "The quotation could not be processed.", None


def _code_for(error: ExtractionError) -> str:
    for error_type in ERROR_CATALOGUE:
        if isinstance(error, error_type):
            return error_type.__name__
    return "extraction_error"


def _resolve_monitor_import(error: MonitorImportError) -> tuple[int, str]:
    for error_type, entry in MONITOR_IMPORT_CATALOGUE.items():
        if isinstance(error, error_type):
            return entry
    return 422, "This monitoring sheet could not be read."


def _monitor_import_code_for(error: MonitorImportError) -> str:
    for error_type in MONITOR_IMPORT_CATALOGUE:
        if isinstance(error, error_type):
            return error_type.__name__
    return "MonitorImportError"
