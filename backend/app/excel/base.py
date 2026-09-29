"""Excel generation boundary.

The workbook layout is specified in AGENTS.md section 7 and is implemented in a
later phase. Only the contract exists now, so the rest of the backend can be
built and tested without a spreadsheet library installed.

An implementation receives confirmed, human-reviewed data and returns the bytes
of a finished ``.xlsx`` file. It must not invent values, and it must never
overwrite existing monitoring data (AGENTS.md section 7).
"""

from typing import Protocol, runtime_checkable

from app.models.quotation import Quotation
from app.models.workbook import ConsolidatedWorkbookRequest


@runtime_checkable
class WorkbookGenerator(Protocol):
    """Turns confirmed quotation data into an Excel workbook."""

    def generate(self, quotation: Quotation) -> bytes:
        """Return the contents of an ``.xlsx`` workbook for a single quotation.

        ``quotation`` is data the user has already reviewed and confirmed. Any
        field left as ``None`` must be written as an empty cell rather than
        filled with a default.
        """
        ...

    def generate_consolidated(self, request: ConsolidatedWorkbookRequest) -> bytes:
        """Return the contents of an ``.xlsx`` workbook for multiple quotations.

        ``request`` contains multiple confirmed quotations, each with its assigned
        sequence number. All line items from each quotation share the same
        sequence number in the output.
        """
        ...
