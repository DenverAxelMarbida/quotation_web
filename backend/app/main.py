"""FastAPI application entrypoint.

Wires the API router, CORS and structured error handling. All quotation logic
lives behind the service and parser layers; this module only assembles the
application.

Scope note: the Excel generation endpoint is not registered yet. The workbook
contract exists in `app.excel.base` and the endpoint is added in the phase that
implements it (AGENTS.md sections 7 and 16).
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.version import API_VERSION

load_dotenv()

DEFAULT_DEV_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", DEFAULT_DEV_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app() -> FastAPI:
    application = FastAPI(
        title="Quotation-to-Excel Automation System",
        version=API_VERSION,
        description="Extract quotation data from ERP quotation PDFs for human review.",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    register_error_handlers(application)
    application.include_router(api_router, prefix="/api")
    return application


app = create_app()
