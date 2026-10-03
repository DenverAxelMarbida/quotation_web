"""Data model for a monitoring workbook that already exists.

The Excel file is the portable work state: it can be downloaded, kept in OneDrive
and reopened later, so it has to be readable back into the application. This
module describes what one read produces.

Two properties of the model matter more than its shape:

- ``sequence_number`` is a string on purpose. ``"001"`` and ``"007"`` are
  identifiers, and reading them as numbers would lose the leading zeros. Only
  ``highest_sequence`` is derived by comparing them numerically, which is what
  makes "the next number" the right answer even when the file skipped a value.
- The columns a person controls are preserved exactly as they are found. A
  blank cell stays blank; nothing is invented to fill it. Status is the one
  exception, and it is not a column a person controls: it is worked out from
  Installation Schedule, Start Date and Completion Date by :func:`derive_status`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# The same three values the Excel Status column can show. Status is worked out
# from the operational fields, so this list describes what the rule produces
# rather than what a user is offered.
MonitorStatus = Literal["On Hold", "Ongoing", "Completed", ""]

MONITOR_STATUS_VALUES = ("On Hold", "Ongoing", "Completed")


def _is_set(value: str | None) -> bool:
    """Whether an operational field holds anything worth acting on.

    An empty cell and a dash both mean "not set". The dash is a thing people
    write into a spreadsheet to say a value is not applicable yet, and treating
    it as a value would report work as started when nothing has been agreed. The
    dash is only ignored for this decision: it stays in the cell exactly as it
    was typed, so the file still says what its owner wrote.
    """
    if value is None:
        return False
    text = str(value).strip()
    return text != "" and text != "-"


def derive_status(
    installation_schedule: str | None,
    start_date: str | None,
    completion_date: str | None,
) -> str:
    """Work out a row's Status from the three fields that describe the job.

    Status is a consequence, not a decision. The rule is fixed and has a
    priority order, because two of the three questions can be answered at once
    and one answer outranks the other:

    1. Finished?  Completion Date is filled -> Completed. A completion date is
       the most specific fact available, so it wins even when the other two are
       empty: work that was completed was completed.
    2. Moving?    Installation Schedule and Start Date are both filled, with no
       completion date -> Ongoing. Scheduled and started, nobody has said it is
       finished.
    3. Otherwise  -> On Hold.

    Every value is read through :func:`_is_set`, so ``None``, ``''``, whitespace
    and ``'-'`` are all "not set". The caller's own value is untouched; this only
    decides what it means.
    """
    if _is_set(completion_date):
        return "Completed"
    if _is_set(installation_schedule) and _is_set(start_date):
        return "Ongoing"
    return "On Hold"


class ImportedMonitorRow(BaseModel):
    """One line of the Summary sheet, and the Status that follows from it.

    The operational fields -- Installation Schedule, Start Date and Completion
    Date -- are the only parts a person controls. ``status`` is deliberately not
    one of them: it is worked out from those three on the way in, so the value a
    file happens to carry is overwritten rather than believed. A workbook whose
    Status cell disagrees with its own dates is corrected on import, and a
    Status this application has never heard of is replaced instead of refused.
    """

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
    completion_date: str | None = Field(
        default=None,
        description=(
            "Completion Date as the workbook displays it, or None when empty. "
            "Older workbooks do not have this column and arrive with None, "
            "which is also what an unfinished job looks like."
        ),
    )
    status: MonitorStatus = Field(
        default="",
        description=(
            "On Hold, Ongoing or Completed, derived from the three operational "
            "fields. Not user input: whatever the cell held is overwritten."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _derive_status_from_the_operational_fields(cls, data):
        """Set Status from the three fields before anything reads it.

        Running before field validation is what lets a workbook with a Status
        this application does not recognise still be imported: the unusable
        value is replaced here, so the literal check below never sees it. The
        three operational fields are read straight from the raw input, and
        anything that is not a mapping is handed back unchanged for pydantic to
        report in its own words.
        """
        if not isinstance(data, dict):
            return data
        data = dict(data)
        data["status"] = derive_status(
            data.get("installation_schedule"),
            data.get("start_date"),
            data.get("completion_date"),
        )
        return data


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
