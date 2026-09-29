"""Domain models for quotation data.

These models are the stable contract between the parser, the API and the Excel
generator. They are intentionally free of business rules.

Two rules from AGENTS.md shape this module:

1. Never invent a value. A field the parser could not read stays ``None`` and is
   reported for human review instead of being guessed.
2. Never infer business decisions. Sequence number, installation schedule, start
   date and status are absent from these models on purpose. They are never
   extracted, never derived, and they belong to the human who reviews the
   quotation. See AGENTS.md section 6.
"""

from pydantic import BaseModel, ConfigDict, Field


class QuotationItem(BaseModel):
    """A single SR#/line item row of the quotation table."""

    model_config = ConfigDict(extra="forbid")

    sr: str | None = Field(
        default=None,
        description="SR# line number exactly as printed in the quotation, kept as text because it "
        "is an ERP identifier rather than a quantity: hierarchical numbers such as '1.1' or "
        "'9.133' keep their trailing zeros ('1.130' stays '1.130'). None when not legible.",
    )
    description: str = Field(
        default="",
        description="Full multi-line product description, joined into one string.",
    )
    quantity: float | None = Field(
        default=None,
        description="Quantity. None when not legible.",
    )
    unit: str | None = Field(
        default=None,
        description="Unit of measurement exactly as printed, e.g. 'm2'. Never mapped to a "
        "closed enum so that unfamiliar units stay visible instead of being rejected.",
    )


class Quotation(BaseModel):
    """Header fields plus every line item of one quotation.

    All rows of a quotation share this header. Sequence number is not part of
    this model: it is a human-assigned grouping value, not extracted data.
    """

    model_config = ConfigDict(extra="forbid")

    quotation_number: str | None = Field(
        default=None,
        description="ERP quotation identifier, e.g. 'QDXB/25/014094/Rev1'.",
    )
    client_name: str | None = Field(
        default=None,
        description="Client the quotation is addressed to.",
    )
    project_name: str | None = Field(
        default=None,
        description="Project name or code as printed on the quotation.",
    )
    items: list[QuotationItem] = Field(
        default_factory=list,
        description="Line items in the order they appear in the quotation table.",
    )
