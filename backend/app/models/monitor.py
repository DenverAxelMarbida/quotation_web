"""Data model for a monitoring workbook that already exists.

The Excel file is the portable work state: it can be downloaded, kept in OneDrive
and reopened later, so it has to be readable back into the application. This
module describes what one read produces.

Two properties of the model matter more than its shape:

- ``sequence_number`` is a string on purpose. ``"001"`` and ``"007"`` are
  identifiers, and reading them as numbers would lose the leading zeros. Only
  ``highest_sequence`` is derived by comparing them numerically, which is what
  makes "the next number" the right answer even when the file skipped a value.
- The manually controlled columns are preserved exactly as they are found. A
  blank cell stays blank; nothing is invented to fill it.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# The same three values the Excel Status dropdown offers, plus the blank a row
# has before the user chooses one.
MonitorStatus = Literal["On Hold", "Ongoing", "Completed", ""]

MONITOR_STATUS_VALUES = ("On Hold", "Ongoing", "Completed")


class ImportedMonitorRow(BaseModel):
    """One line of the Summary sheet, exactly as the workbook stored it."""

    model_config = ConfigDict(extra="forbid")

    sequence_number: str = Field(description="Sequence Number exactly as written, e.g. '007'.")
    client_name: str = ""
    project_name: str = ""
    product_description: str = ""
    quantity: float | None = Field(
        default=None,
        description="Quantity per line item, or None when the cell is empty.",
    )
    unit_of_measurement: str = ""
    installation_schedule: str = Field(
        default="",
        description="Installation Schedule, or '' when the cell is empty.",
    )
    start_date: str | None = Field(
        default=None,
        description="Start Date as the workbook displays it, or None when empty.",
    )
    status: MonitorStatus = Field(
        default="",
        description="One of the dropdown values, or '' when the user has not set one.",
    )


class ImportedMonitor(BaseModel):
    """The rows read from a monitoring workbook, plus what a later step needs."""

    model_config = ConfigDict(extra="forbid")

    rows: list[ImportedMonitorRow]
    highest_sequence: str | None = Field(
        default=None,
        description=(
            "The Sequence Number of the numerically largest row, or None when the "
            "workbook holds no rows."
        ),
    )
    row_count: int = Field(ge=0)
    source_filename: str
