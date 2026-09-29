"""Models for consolidated Excel workbook generation.

This module defines the data structure for requesting Excel generation
from multiple confirmed quotations, each with its own sequence number.
"""

from pydantic import BaseModel, ConfigDict, Field

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
    """

    model_config = ConfigDict(extra="forbid")

    quotations: list[ConfirmedQuotation] = Field(
        description="List of confirmed quotations, each with its assigned sequence number.",
        min_length=1,
    )
