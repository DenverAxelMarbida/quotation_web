"""Models for consolidated Excel workbook generation.

This module defines the data structure for requesting Excel generation
from multiple confirmed quotations, each with its own sequence number.

A request can also carry the rows of a monitoring workbook the user already
has, so that a new quotation is added to that file rather than starting a
fresh one. Those rows are a different kind of thing from a quotation and are
modelled separately: see :class:`ConsolidatedWorkbookRequest`.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.models.monitor import ImportedMonitorRow
from app.models.quotation import Quotation


class ConfirmedQuotation(BaseModel):
    """A confirmed quotation with its manually assigned sequence number.

    This represents a quotation that has been reviewed by the user
    and assigned a sequence number for grouping in the Excel workbook.
    """

    model_config = ConfigDict(extra="forbid")

    sequence_number: str = Field(
        description="Manual sequence number assigned by the user (e.g., '001', '002'). "
        "Preserves leading zeros and is used for grouping in Excel.",
        min_length=1,
    )
    quotation: Quotation = Field(
        description="The confirmed quotation data that the user has reviewed/edited."
    )


class ConsolidatedWorkbookRequest(BaseModel):
    """Request to generate a consolidated Excel workbook from multiple quotations.

    Each quotation in the list contributes its line items to the Excel workbook,
    with all items from a single quotation sharing the same sequence number.

    ``existing_rows`` carries the rows of a monitoring workbook the user opened
    earlier. They are written first, exactly as they stand, so the generated file
    is that workbook plus the new quotations rather than a replacement for it.

    The two lists stay separate on purpose. An existing row is a finished Summary
    row the user owns, complete with the schedule, date and status they set in
    Excel; a quotation is a list of items still to be unpacked. Folding one into
    the other would mean inventing a client, a project and a blank status for
    every existing row, and losing the three fields that matter most.

    Optional and defaulting to empty, so a request that only carries quotations
    behaves exactly as it did before this field existed.
    """

    model_config = ConfigDict(extra="forbid")

    quotations: list[ConfirmedQuotation] = Field(
        description="List of confirmed quotations, each with its assigned sequence number.",
        min_length=1,
    )
    existing_rows: list[ImportedMonitorRow] = Field(
        default_factory=list,
        description="Rows already in the monitoring workbook the user opened. "
        "Written as they stand, before any new quotation.",
    )
