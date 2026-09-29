"""API-facing envelope for an extraction result."""

from pydantic import BaseModel, ConfigDict, Field

from app.models.quotation import Quotation
from app.models.review import ReviewFlag


class SourceInfo(BaseModel):
    """Where the data came from. Carries no business meaning."""

    model_config = ConfigDict(extra="forbid")

    filename: str = Field(description="Original uploaded filename, for display only.")
    page_count: int = Field(ge=0, description="Number of pages read from the PDF.")
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal extraction warnings, e.g. empty pages or unreadable text.",
    )


class QuotationPreview(BaseModel):
    """Structured quotation data plus everything the user must verify.

    This is the response body of the parse endpoint and the exact shape the
    review screen edits before the user confirms.
    """

    model_config = ConfigDict(extra="forbid")

    quotation: Quotation
    review: list[ReviewFlag] = Field(default_factory=list)
    source: SourceInfo
