"""Excel workbook generation using openpyxl.

Implements the WorkbookGenerator protocol to produce .xlsx workbooks containing
confirmed quotation data in the Summary format specified in AGENTS.md section 7.

The generator:
- Creates a new workbook with a Summary worksheet
- Maps quotation fields to the agreed column structure
- Supports one quotation, a consolidated set of quotations, or a consolidated
  set added to the rows of a monitoring workbook the user already opened
- Uses the manual Sequence Number when one is supplied, else leaves it blank
- Writes one row per quotation item, existing workbook rows first and unchanged
- Leaves Installation Schedule, Start Date and Completion Date blank on a
  quotation row, and carries them over as found on a row that came from the
  workbook
- Works out Status from those three fields for every row, so the colour of the
  row follows the dates rather than a value somebody typed
- Makes the sheet usable straight away: sized columns, wrapped descriptions,
  a frozen header, an AutoFilter, date-formatted operational cells, dynamic
  Status colours, and a line between each client/project group
- Returns workbook bytes suitable for download

Nothing here ever works out a Sequence Number. One is assigned to a quotation
before generation is asked for, and an existing row already carries its own, so
every sequence is written as the opaque string it is. Numbering lives in the
frontend, in one place, and this module must not grow a second opinion about it.

Nothing is ever inferred for a quotation: Installation Schedule, Start Date and
Completion Date stay empty and are filled in by hand (AGENTS.md sections 6
and 7). A row carried over from a workbook already has them, and keeps them.
Status is the exception, and it is not a value that arrives with a row: it is
derived from the three, so a cell that disagrees with its own dates is rewritten
rather than copied into the next version of the file.
"""

import math
from io import BytesIO

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from app.models.monitor import ImportedMonitorRow, derive_status
from app.models.quotation import Quotation
from app.models.workbook import ConsolidatedWorkbookRequest


class OpenpyxlWorkbookGenerator:
    """Generates Excel workbooks from confirmed quotation data."""

    # Column structure as specified in AGENTS.md section 7. Order is fixed, and
    # Completion Date sits between Start Date and Status because those are the
    # three fields Status is worked out from: reading left to right gives the
    # evidence and then the conclusion.
    COLUMNS = [
        "Sequence Number",
        "Client Name",
        "Project Name",
        "Product Description",
        "Quantity",
        "Unit of Measurement",
        "Installation Schedule",
        "Start Date",
        "Completion Date",
        "Status",
    ]

    # The three fields the Status is derived from, in the order the rule reads
    # them. Nothing else may change a Status.
    OPERATIONAL_FIELDS = ("Installation Schedule", "Start Date", "Completion Date")

    # Practical widths (Excel column-width units). Product Description gets the
    # most room because ERP descriptions are long; Quantity and Unit stay narrow.
    COLUMN_WIDTHS = {
        "Sequence Number": 14,
        "Client Name": 30,
        "Project Name": 26,
        "Product Description": 60,
        "Quantity": 10,
        "Unit of Measurement": 18,
        "Installation Schedule": 20,
        "Start Date": 15,
        "Completion Date": 16,
        "Status": 16,
    }

    # One consistent, human-readable date format for all the date columns.
    DATE_FORMAT = "DD/MM/YYYY"

    # The exact status the derivation rule can produce. Never chosen by a user
    # and never read from a file: this is the list the rule writes.
    STATUS_VALUES = ("On Hold", "Ongoing", "Completed")

    # Fill + font colours used by the dynamic conditional formatting rules.
    STATUS_FILLS = {
        "On Hold": ("FFC7CE", "9C0006"),  # red
        "Ongoing": ("FFD966", "7F6000"),  # orange
        "Completed": ("C6EFCE", "006100"),  # green
    }

    # Validation and conditional formatting extend a buffer of rows below the
    # data so the mother can add rows by hand and keep the colours. Group lines
    # deliberately do not: a line on an empty row would look like a group that
    # is not there yet. These ranges do not create cells, so the data range
    # stays exact.
    BUFFER_ROWS = 100

    # Height of one wrapped line of text, used to size a row so a long Product
    # Description is fully readable as soon as the file is opened.
    #
    # There is deliberately no maximum number of lines. Capping the height would
    # hide the tail of a long description behind a row that is too short, which
    # is worse than a tall row.
    LINE_HEIGHT = 15

    def generate(self, quotation: Quotation) -> bytes:
        """Generate .xlsx workbook bytes from confirmed quotation data.

        Creates a Summary worksheet with one row per quotation item. Manual
        operational fields (Sequence Number, Installation Schedule, Start Date,
        Status) are left blank.

        Args:
            quotation: Confirmed quotation data that the user has reviewed/edited

        Returns:
            Bytes of a complete .xlsx workbook ready for download
        """
        return self._build([(None, quotation)])

    def generate_consolidated(self, request: ConsolidatedWorkbookRequest) -> bytes:
        """Generate .xlsx workbook bytes from existing rows and new quotations.

        Creates a Summary worksheet holding the rows of a monitoring workbook the
        user already opened, followed by one row per line item of every new
        quotation. Each quotation's items share the same sequence number.
        Manual operational fields (Installation Schedule, Start Date, Status)
        are left blank on a quotation row, and written as they stand on a row
        that came from the workbook.

        Args:
            request: The existing rows to carry over, and the confirmed
                    quotations to add, each with its assigned sequence number

        Returns:
            Bytes of a complete .xlsx workbook ready for download
        """
        return self._build(
            [(cq.sequence_number, cq.quotation) for cq in request.quotations],
            existing_rows=request.existing_rows,
        )

    def _build(
        self,
        groups: list[tuple[str | None, Quotation]],
        existing_rows: list[ImportedMonitorRow] | None = None,
    ) -> bytes:
        """Write every existing row and every group item to a fresh Summary sheet.

        Existing rows come first, in the order the workbook held them, followed by
        the groups in order and their items in the order they were quoted. Nothing
        is sorted: a monitoring sheet is arranged by its owner, and reordering it
        would move rows the user placed on purpose. That also means a quotation
        always lands below the workbook it was added to, because its sequence
        number is the highest one in the file.

        Every workbook-level rule -- widths, frozen header, filter, date
        validation, status colours and the group lines -- is applied once, after
        all the data rows exist, so the two sources share one set of ranges and
        a group split across the boundary is still seen as one group.
        """
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Summary"
        sheet.sheet_view.showGridLines = True

        self._write_headers(sheet)

        for row in existing_rows or []:
            self._write_existing_row(sheet, row)

        for sequence_number, quotation in groups:
            for item in quotation.items:
                self._write_item_row(sheet, quotation, item, sequence_number)

        last_row = sheet.max_row
        self._apply_column_widths(sheet)
        sheet.freeze_panes = "A2"
        self._apply_auto_filter(sheet, last_row)
        self._apply_date_validation(sheet, last_row)
        self._apply_status_conditional_formatting(sheet, last_row)
        self._apply_group_borders(sheet, last_row)

        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        return output.getvalue()

    def _write_headers(self, sheet) -> None:
        """Write and format the header row."""
        header_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
        for col_idx, header in enumerate(self.COLUMNS, start=1):
            cell = sheet.cell(row=1, column=col_idx, value=header)
            cell.font = Font(bold=True)
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        sheet.row_dimensions[1].height = 24

    def _write_item_row(
        self, sheet, quotation: Quotation, item, sequence_number: str | None
    ) -> None:
        """Write one quotation item as a data row.

        Maps quotation fields to the agreed column structure. ``sequence_number``
        is the manual group value, or ``None`` for the single-quotation path.
        The operational dates are left blank because they are not derived from
        the quotation PDF, and Status is whatever three blank dates mean.
        """
        self._write_row(
            sheet,
            {
                "Sequence Number": sequence_number,  # Manual field from user input
                "Client Name": quotation.client_name,
                "Project Name": quotation.project_name,
                "Product Description": item.description,
                "Quantity": item.quantity,
                "Unit of Measurement": item.unit,
                "Installation Schedule": None,  # Not in the PDF - leave blank
                "Start Date": None,  # Not in the PDF - leave blank
                "Completion Date": None,  # Not in the PDF - leave blank
                "Status": derive_status(None, None, None),
            },
            item.description,
        )

    def _write_existing_row(self, sheet, row: ImportedMonitorRow) -> None:
        """Write one row of the workbook the user already had, as it stands.

        This is not a quotation and is not unpacked like one. A row read from a
        monitoring workbook is already a finished Summary row: it carries the
        Installation Schedule, Start Date and Completion Date its owner set, and
        those are written through exactly as found. A phrase such as "to be agreed"
        is something the user wrote and is not a date to be tidied, and a blank cell
        is a blank cell rather than a gap to be filled.

        Status is the one column not written through. It follows from the three
        fields above it, so a cell that claims the work is finished while the
        Completion Date is empty is corrected here rather than carried into the
        next version of the file.

        The Sequence Number is an identifier and is written as the string it
        already is, leading zeros and all. Nothing here works out, compares or
        renumbers it; numbering belongs to the application and happened before
        the file was ever asked for.
        """
        self._write_row(
            sheet,
            {
                "Sequence Number": row.sequence_number,
                "Client Name": row.client_name,
                "Project Name": row.project_name,
                "Product Description": row.product_description,
                "Quantity": row.quantity,
                "Unit of Measurement": row.unit_of_measurement,
                "Installation Schedule": row.installation_schedule,
                "Start Date": row.start_date,
                "Completion Date": row.completion_date,
                "Status": derive_status(
                    row.installation_schedule, row.start_date, row.completion_date
                ),
            },
            row.product_description,
        )

    def _write_row(self, sheet, row_data: dict, description: str) -> None:
        """Write one data row and format every cell in it.

        The single place a Summary row is written, so a row carried over from the
        workbook and a row written from a quotation are laid out identically.
        Column order comes from ``COLUMNS`` rather than from the dict, and the
        cells are formatted by name, so neither the order of the mapping nor the
        two callers can drift apart.
        """
        row_idx = sheet.max_row + 1

        for col_idx, column_name in enumerate(self.COLUMNS, start=1):
            cell = sheet.cell(row=row_idx, column=col_idx, value=row_data[column_name])
            self._format_data_cell(cell, column_name)

        height = self._estimate_row_height(description)
        if height is not None:
            sheet.row_dimensions[row_idx].height = height

    def _format_data_cell(self, cell, column_name: str) -> None:
        """Apply the presentation rules for one data cell."""
        if column_name == "Sequence Number":
            # Text format so values like "001" keep their leading zeros.
            cell.number_format = "@"
            cell.alignment = Alignment(horizontal="center", vertical="top")
        elif column_name == "Product Description":
            # Wrap the description across as many lines as it needs, in this one
            # cell. Excel does the wrapping, so the value stays exactly as it was
            # extracted: no truncation, no ellipsis, no inserted line breaks.
            cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        elif column_name == "Quantity":
            cell.alignment = Alignment(horizontal="center", vertical="top")
        elif column_name in self.OPERATIONAL_FIELDS:
            cell.alignment = Alignment(horizontal="center", vertical="top")
            cell.number_format = self.DATE_FORMAT
        elif column_name == "Unit of Measurement":
            cell.alignment = Alignment(horizontal="center", vertical="top")

    def _estimate_row_height(self, description: str) -> float | None:
        """Size the row so every wrapped line of the description is visible.

        Returns ``None`` when the description already fits on one line, leaving
        Excel's own default height in place. The estimate is intentionally
        uncapped: if a description needs ten lines, the row is ten lines tall,
        because a row that is too short hides text rather than revealing it.
        The full value is stored regardless of what this returns.
        """
        if not description:
            return None

        width = self.COLUMN_WIDTHS["Product Description"]
        chars_per_line = max(10, int(width) - 2)

        lines = 0
        for paragraph in description.split("\n"):
            lines += max(1, math.ceil(len(paragraph) / chars_per_line))

        if lines <= 1:
            return None

        return float(self.LINE_HEIGHT * lines)

    def _apply_column_widths(self, sheet) -> None:
        """Set a sensible, fixed width for each Summary column."""
        for col_idx, column_name in enumerate(self.COLUMNS, start=1):
            letter = get_column_letter(col_idx)
            sheet.column_dimensions[letter].width = self.COLUMN_WIDTHS[column_name]

    def _apply_auto_filter(self, sheet, last_row: int) -> None:
        """Add a filter covering the header and every data row."""
        last_col = get_column_letter(len(self.COLUMNS))
        sheet.auto_filter.ref = f"A1:{last_col}{last_row}"

    def _row_range(self, last_row: int) -> str:
        """The full data-row range (A:J), extended for manual rows below the data.

        Status conditional formatting is applied to the whole row so a status
        value colours every cell in that row, not only the Status cell. The
        range does not create cells, so the data range stays exact.
        """
        first_col = get_column_letter(1)
        last_col = get_column_letter(len(self.COLUMNS))
        return f"{first_col}2:{last_col}{last_row + self.BUFFER_ROWS}"

    def _apply_date_validation(self, sheet, last_row: int) -> None:
        """Constrain the three operational columns to real dates.

        There is no validation on Status: it is worked out from these dates
        rather than chosen, so a dropdown offering three answers would only
        invite one that disagrees with them.

        This narrows input to sensible date values. Whether Excel also shows a
        calendar popup depends on the Excel build/version, which openpyxl cannot
        guarantee; the cell format and value are always correct here.
        """
        start_col = get_column_letter(self.COLUMNS.index(self.OPERATIONAL_FIELDS[0]) + 1)
        end_col = get_column_letter(self.COLUMNS.index(self.OPERATIONAL_FIELDS[-1]) + 1)
        ref = f"{start_col}2:{end_col}{last_row + self.BUFFER_ROWS}"

        validation = DataValidation(
            type="date",
            operator="between",
            formula1="DATE(2000,1,1)",
            formula2="DATE(2100,12,31)",
            allow_blank=True,
        )
        validation.error = "Enter a date such as 31/12/2025."
        validation.errorTitle = "Invalid date"
        validation.prompt = "Enter a date (DD/MM/YYYY)."
        validation.promptTitle = "Date"
        sheet.add_data_validation(validation)
        validation.add(ref)

    def _apply_status_conditional_formatting(self, sheet, last_row: int) -> None:
        """Colour the whole data row dynamically from the Status column value.

        Conditional formatting (rather than a static fill) means the row colour
        follows the dates behind it: fill in the Completion Date and the row
        turns green, and clearing it removes the colour. The formula pins the
        Status column with ``$J`` so the rule reads column J while its row
        number moves down the whole A:J range.
        """
        row_range = self._row_range(last_row)
        status_col = get_column_letter(self.COLUMNS.index("Status") + 1)

        for value in self.STATUS_VALUES:
            fill_color, font_color = self.STATUS_FILLS[value]
            sheet.conditional_formatting.add(
                row_range,
                FormulaRule(
                    formula=[f'${status_col}2="{value}"'],
                    fill=PatternFill(
                        start_color=fill_color,
                        end_color=fill_color,
                        fill_type="solid",
                    ),
                    font=Font(color=font_color),
                    stopIfTrue=False,
                ),
            )

    def _apply_group_borders(self, sheet, last_row: int) -> None:
        """Separate the client/project groups with a line across the full row.

        A monitoring sheet is read in groups: several rows belong to one project
        for one client, and the eye should see where one group stops without
        reading the Client and Project cells of every row. A thin line keeps
        rows of the same group together; a thick line marks the boundary.

        The boundary is Client + Project, never Sequence Number: two quotations
        can share a project, and one project can be split across sequences, so
        the sequence says nothing about which rows belong together.

        The first data row gets nothing above it, because there is nothing above
        it to separate from, and only data rows are touched: the buffer rows the
        conditional formatting reaches stay borderless, since a line under empty
        cells would read as a group that is not there. The line spans every
        column so it still divides the row where the Status colour is.
        """
        if last_row < 2:
            return

        thin = Side(style="thin")
        thick = Side(style="thick")
        client_col = self.COLUMNS.index("Client Name") + 1
        project_col = self.COLUMNS.index("Project Name") + 1
        last_col = len(self.COLUMNS)

        def group_of(row: int) -> tuple[str, str]:
            return (
                _group_text(sheet.cell(row=row, column=client_col).value),
                _group_text(sheet.cell(row=row, column=project_col).value),
            )

        previous = group_of(2)
        for row in range(3, last_row + 1):
            current = group_of(row)
            side = thin if current == previous else thick
            for column in range(1, last_col + 1):
                cell = sheet.cell(row=row, column=column)
                cell.border = Border(top=side)
            previous = current


def _group_text(value: object) -> str:
    """One client or project name reduced to what identifies it.

    Leading and trailing spaces and letter case are a typing habit, not a
    different client, so they cannot open a gap between two rows that name the
    same group.
    """
    if value is None:
        return ""
    return str(value).strip().casefold()
