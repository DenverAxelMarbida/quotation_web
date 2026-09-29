"""Shared test helpers."""

import pathlib

import pytest

from app.parser.base import ExtractedPdf

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

# The reference ERP quotation is confidential and deliberately not committed
# (AGENTS.md sections 10 and 13). Tests that use it are skipped when it is
# absent, so the suite still runs in CI without it. Point this at a local copy
# to check the parser against the real document.
REAL_QUOTATION = pathlib.Path(__file__).resolve().parents[2] / (
    "SAMPLE_VRP_Quotation - 2026-07-21T155726.357.pdf"
)


def load_reference_quotation() -> bytes:
    """The real quotation's bytes, skipping the test when it is not present."""
    if not REAL_QUOTATION.exists():
        pytest.skip(f"reference quotation not available at {REAL_QUOTATION}")
    return REAL_QUOTATION.read_bytes()


def empty_document() -> ExtractedPdf:
    return ExtractedPdf()
