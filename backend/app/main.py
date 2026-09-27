"""FastAPI application entrypoint.

Scope note: this module intentionally exposes only a health endpoint.
PDF parsing, preview and Excel generation endpoints are added in the later
phases described in AGENTS.md section 16. Nothing here guesses business values.
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.version import API_VERSION

load_dotenv()

DEFAULT_DEV_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", DEFAULT_DEV_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="Quotation-to-Excel Automation System",
    version=API_VERSION,
    description="Extract quotation data from ERP quotation PDFs for human review.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
