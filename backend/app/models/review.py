"""Extraction uncertainty reporting.

AGENTS.md section 9 requires visible review over silent guessing: when a field
cannot be read with confidence, the system must say so instead of presenting a
plausible-looking value. Every flag here is surfaced in the review screen so the
user can correct it.
"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.models.quotation import Quotation


class ReviewReason(StrEnum):
    """Why a value needs a human to look at it."""

    MISSING = "missing"
    """The field was not found in the document at all."""

    UNCONFIDENT = "unconfident"
    """A value was found but the layout made it ambiguous."""

    INCONSISTENT = "inconsistent"
    """A value was read, but the row's own figures do not agree with each other.

    Raised when the numbers a quotation row reports cannot all be correct at
    once, e.g. the price less the discount is not the stated net. The values are
    still shown exactly as read; the flag asks a person to check the source
    rather than reporting a corrected number.
    """


class ReviewFlag(BaseModel):
    """A single call for human attention.

    ``field`` uses dotted/indexed paths so the frontend can point at the exact
    input that needs attention, e.g. ``client_name`` or ``items[2].quantity``.
    """

    model_config = ConfigDict(extra="forbid")

    field: str = Field(description="Path of the field that needs review.")
    reason: ReviewReason = Field(description="Why the field needs review.")
    message: str = Field(description="Plain-language explanation for a non-technical user.")


class ParseResult(BaseModel):
    """Output of a quotation parser: the data plus what still needs review.

    This is the return type of every :class:`~app.parser.base.QuotationParser`
    implementation, which is what makes the parser swappable.
    """

    model_config = ConfigDict(extra="forbid")

    quotation: Quotation
    review: list[ReviewFlag] = Field(default_factory=list)
