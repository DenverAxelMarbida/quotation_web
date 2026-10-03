"""Tests for reading a monitoring workbook back in.

The point of the feature is that the Excel file is the portable work state: a
workbook this application generated on one day has to be readable on the next.
The first test therefore uses the real generator's output rather than a
hand-built imitation.

Two rules from the requirement drive most of these tests:

- A Sequence Number is an identifier, not a number, so "001" and "007" must come
  back exactly as the workbook stored them. Only the highest-sequence
  calculation is numeric.
- A cell the user left blank stays blank. Nothing is invented to fill a gap.
"""

from datetime import datetime

import pytest

from app.services.errors import (
    EmptySummaryError,
    InvalidSequenceNumberError,
    MissingColumnsError,
    MissingSummarySheetError,
    NotExcelError,
)
from app.services.monitor_import_service import MonitorImportService
from tests.fixtures.build_monitor_workbook import (
    SUMMARY_COLUMNS,
    combined_monitoring_workbook,
    damaged_workbook_bytes,
    generated_monitoring_workbook,
    row,
    summary_workbook,
    truncated_workbook_bytes,
)

service = MonitorImportService()


def test_a_generated_monitoring_workbook_imports() -> None:
    # The round trip the feature exists for: what the generator writes must be
    # readable again.
    monitor = service.import_monitor(generated_monitoring_workbook(), "monitoring_sheet.xlsx")

    assert monitor.source_filename == "monitoring_sheet.xlsx"
    assert monitor.row_count == 3
    assert [item.sequence_number for item in monitor.rows] == ["001", "001", "002"]


def test_a_workbook_built_from_an_existing_file_imports() -> None:
    # The round trip for the workflow this feature enables. The user opens the
    # monitoring workbook they already share, adds a quotation to it and downloads
    # the result. That file has to read back as one sheet: the rows they were
    # maintaining, then the new quotation, in that order.
    monitor = service.import_monitor(combined_monitoring_workbook(), "monitoring_sheet.xlsx")

    assert monitor.row_count == 3
    assert [item.sequence_number for item in monitor.rows] == ["007", "003", "008"]


def test_an_existing_row_keeps_its_operational_fields_across_the_round_trip() -> None:
    # The whole point of writing the existing rows out unchanged. A schedule, a
    # date and a status the user set by hand in Excel must survive being taken
    # out and put back, or the file they share loses their own work.
    monitor = service.import_monitor(combined_monitoring_workbook(), "monitoring_sheet.xlsx")

    carried = monitor.rows[0]
    assert carried.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert carried.project_name == "MARINA BAY TOWER"
    assert carried.product_description == "Sample skirting profile"
    assert carried.quantity == 18.0
    assert carried.unit_of_measurement == "L.M."
    assert carried.installation_schedule == "15-20 Nov 2026"
    assert carried.start_date == "2026-11-15"
    assert carried.status == "Ongoing"


def test_a_new_quotation_is_appended_after_the_existing_rows() -> None:
    monitor = service.import_monitor(combined_monitoring_workbook(), "monitoring_sheet.xlsx")

    new = monitor.rows[2]
    assert new.sequence_number == "008"
    assert new.project_name == "CREEK VILLA"
    assert new.product_description == "Sample engineered oak flooring"
    assert new.quantity == 34.0
    assert new.unit_of_measurement == "m2"
    # A quotation never supplies these, so they stay empty for the user to fill
    # in by hand (AGENTS.md section 6). Nothing is set, so the row reports the
    # one status that follows from nothing being set.
    assert new.installation_schedule == ""
    assert new.start_date is None
    assert new.completion_date is None
    assert new.status == "On Hold"


def test_the_highest_sequence_is_read_from_the_combined_workbook() -> None:
    # Numbering continues from the whole file, so the new quotation's own number
    # has to be visible to the import even though it is written by the generator
    # rather than inherited from the file.
    monitor = service.import_monitor(combined_monitoring_workbook(), "monitoring_sheet.xlsx")

    assert monitor.highest_sequence == "008"


def test_the_summary_sheet_is_required() -> None:
    data = summary_workbook([row()], sheet_name="Sheet1")

    with pytest.raises(MissingSummarySheetError) as failure:
        service.import_monitor(data, "monitoring_sheet.xlsx")

    assert "Summary" in str(failure.value)


def test_every_required_column_is_required() -> None:
    # A sheet that lost the Status column is not a monitoring sheet.
    shortened = [name for name in SUMMARY_COLUMNS if name != "Status"]
    data = summary_workbook([row()], columns=shortened)

    with pytest.raises(MissingColumnsError) as failure:
        service.import_monitor(data, "monitoring_sheet.xlsx")

    assert "Status" in str(failure.value)


def test_the_error_names_every_missing_column() -> None:
    data = summary_workbook(
        [row()], columns=["Sequence Number", "Client Name", "Project Name", "Status"]
    )

    with pytest.raises(MissingColumnsError) as failure:
        service.import_monitor(data, "monitoring_sheet.xlsx")

    message = str(failure.value)
    for missing in ("Product Description", "Quantity", "Unit of Measurement"):
        assert missing in message


def test_an_empty_summary_is_rejected() -> None:
    data = summary_workbook([])

    with pytest.raises(EmptySummaryError):
        service.import_monitor(data, "monitoring_sheet.xlsx")


def test_a_file_that_is_not_a_workbook_is_rejected() -> None:
    with pytest.raises(NotExcelError):
        service.import_monitor(damaged_workbook_bytes(), "monitoring_sheet.xlsx")


def test_a_truncated_workbook_is_rejected() -> None:
    # It begins with the .xlsx signature, so only opening it reveals the damage.
    with pytest.raises(NotExcelError):
        service.import_monitor(truncated_workbook_bytes(), "monitoring_sheet.xlsx")


def test_an_empty_file_is_rejected() -> None:
    with pytest.raises(NotExcelError):
        service.import_monitor(b"", "monitoring_sheet.xlsx")


def test_a_sequence_number_stays_a_string() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(sequence_number="001")]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].sequence_number == "001"
    assert isinstance(monitor.rows[0].sequence_number, str)


def test_a_leading_zero_sequence_number_is_not_lost() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(sequence_number="007")]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].sequence_number == "007"


def test_a_numeric_sequence_number_is_stored_as_the_workbook_shows_it() -> None:
    # A hand-typed cell holds a real number, and Excel would display it without
    # padding, so it must not acquire leading zeros the file never had.
    monitor = service.import_monitor(
        summary_workbook([row(sequence_number=7)]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].sequence_number == "7"


def test_the_highest_sequence_is_calculated_numerically() -> None:
    data = summary_workbook(
        [
            row(sequence_number="001", product_description="first"),
            row(sequence_number="002", product_description="second"),
            row(sequence_number="007", product_description="after the gap"),
        ]
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    # 007 wins over 001, so a later phase would offer 008 and not reuse 003.
    assert monitor.highest_sequence == "007"


def test_the_highest_sequence_is_the_last_one_when_they_are_ordered() -> None:
    data = summary_workbook(
        [row(sequence_number="001"), row(sequence_number="002"), row(sequence_number="003")]
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.highest_sequence == "003"


def test_every_row_is_kept_in_workbook_order() -> None:
    data = summary_workbook(
        [
            row(sequence_number="001", product_description="FF-01 flooring"),
            row(sequence_number="001", product_description="FF-02 threshold"),
            row(sequence_number="002", product_description="Levelling compound"),
        ]
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.row_count == 3
    assert [item.product_description for item in monitor.rows] == [
        "FF-01 flooring",
        "FF-02 threshold",
        "Levelling compound",
    ]


def test_rows_sharing_one_sequence_stay_separate() -> None:
    # One quotation is several rows, and the quantity is per line item.
    data = summary_workbook(
        [
            row(sequence_number="001", product_description="Flooring 15/4", quantity=34.0),
            row(sequence_number="001", product_description="Flooring 16/4", quantity=88.0),
        ]
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.row_count == 2
    assert [item.quantity for item in monitor.rows] == [34.0, 88.0]


def test_a_blank_installation_schedule_stays_blank() -> None:
    monitor = service.import_monitor(summary_workbook([row()]), "monitoring_sheet.xlsx")

    assert monitor.rows[0].installation_schedule == ""


def test_an_installation_schedule_is_preserved() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(installation_schedule=datetime(2026, 3, 14))]),
        "monitoring_sheet.xlsx",
    )

    assert monitor.rows[0].installation_schedule == "14/03/2026"


def test_a_blank_start_date_stays_blank() -> None:
    monitor = service.import_monitor(summary_workbook([row()]), "monitoring_sheet.xlsx")

    assert monitor.rows[0].start_date is None


def test_a_start_date_is_preserved_as_the_workbook_displays_it() -> None:
    # No guessing and no reformatting into another convention: the workbook's own
    # DD/MM/YYYY format is what the user already reads in Excel.
    monitor = service.import_monitor(
        summary_workbook([row(start_date=datetime(2026, 1, 5))]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].start_date == "05/01/2026"


def test_a_start_date_typed_as_text_is_left_alone() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(start_date="to be agreed")]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].start_date == "to be agreed"


def test_a_row_with_no_dates_at_all_is_on_hold() -> None:
    # The blank workbook is the normal "nothing has been agreed" state. It used
    # to arrive as an unset Status the user would then have to choose; there is
    # nothing to choose now, so the row says what its dates say.
    monitor = service.import_monitor(summary_workbook([row()]), "monitoring_sheet.xlsx")

    assert monitor.rows[0].status == "On Hold"


def test_an_imported_status_is_recalculated_rather_than_trusted() -> None:
    # The most important rule in this feature. A workbook carries a Status column
    # because older versions of this application let people choose one, and what
    # they chose may be wrong, stale, or impossible. The three operational fields
    # are the evidence, so they are what gets read.
    monitor = service.import_monitor(
        summary_workbook(
            [
                row(
                    installation_schedule="October 2026",
                    start_date="01/10/2026",
                    completion_date=None,
                    status="Completed",
                )
            ]
        ),
        "monitoring_sheet.xlsx",
    )

    assert monitor.rows[0].status == "Ongoing"


def test_a_status_this_application_does_not_know_is_replaced_not_rejected() -> None:
    # Once the dropdown is gone, anything can be in that cell -- a workbook
    # edited by hand, or by another team's tool. Refusing the whole file would
    # stop the user getting her rows back, and the value was never evidence.
    monitor = service.import_monitor(
        summary_workbook([row(status="Paused")]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].status == "On Hold"


def test_a_completion_date_makes_the_row_completed_on_import() -> None:
    # Completion outranks everything else, including a workbook that never
    # caught up.
    monitor = service.import_monitor(
        summary_workbook(
            [
                row(
                    installation_schedule="",
                    start_date=None,
                    completion_date="15/10/2026",
                    status="On Hold",
                )
            ]
        ),
        "monitoring_sheet.xlsx",
    )

    assert monitor.rows[0].completion_date == "15/10/2026"
    assert monitor.rows[0].status == "Completed"


def test_an_empty_completion_date_does_not_make_the_row_completed() -> None:
    # The exact cell the rule has to be careful about: filled-in schedule and
    # start date, and nothing else. That is Ongoing, not Completed.
    monitor = service.import_monitor(
        summary_workbook(
            [
                row(
                    installation_schedule="October 2026",
                    start_date="01/10/2026",
                    completion_date=None,
                )
            ]
        ),
        "monitoring_sheet.xlsx",
    )

    assert monitor.rows[0].completion_date is None
    assert monitor.rows[0].status == "Ongoing"


def test_a_completion_date_is_read_as_the_workbook_displays_it() -> None:
    # A date cell is stored as a real date and formatted in the workbook, so the
    # import shows the same DD/MM/YYYY the user sees in Excel.
    monitor = service.import_monitor(
        summary_workbook([row(completion_date=datetime(2026, 10, 15))]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].completion_date == "15/10/2026"
    assert monitor.rows[0].status == "Completed"


def test_a_completion_date_typed_as_text_is_left_alone() -> None:
    # A phrase such as "to be agreed" is something the user wrote and is not a
    # date to be tidied -- the same rule Start Date follows.
    monitor = service.import_monitor(
        summary_workbook([row(completion_date="week 42")]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].completion_date == "week 42"


def test_an_older_workbook_without_a_completion_date_column_still_imports() -> None:
    # Deliberate backwards compatibility, not an accident. Workbooks written
    # before this column existed are still the files the user shares, and
    # refusing them would strand her on the old version forever. The missing
    # column is simply no completion date.
    older = [name for name in SUMMARY_COLUMNS if name != "Completion Date"]
    data = summary_workbook(
        [
            row(
                installation_schedule="October 2026",
                start_date="01/10/2026",
                status="Completed",
            )
        ],
        columns=older,
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.rows[0].completion_date is None


def test_an_older_workbook_does_not_inherit_a_completed_status() -> None:
    # The important half of the compatibility rule. That workbook says
    # "Completed", and there is no Completion Date to support the claim, so the
    # row is reported as the unfinished work it may well still be. Inferring a
    # completion date from an old status would be inventing a fact.
    older = [name for name in SUMMARY_COLUMNS if name != "Completion Date"]
    data = summary_workbook(
        [
            row(
                installation_schedule="October 2026",
                start_date="01/10/2026",
                status="Completed",
            )
        ],
        columns=older,
    )

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.rows[0].status == "Ongoing"


def test_an_older_workbook_with_nothing_agreed_is_on_hold() -> None:
    # The other branch of the same rule: without a Completion Date column, a
    # row is Completed only if it never claimed to be anyway.
    older = [name for name in SUMMARY_COLUMNS if name != "Completion Date"]
    data = summary_workbook([row(status="Completed")], columns=older)

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.rows[0].status == "On Hold"


def test_a_missing_completion_date_column_is_the_only_optional_one() -> None:
    # Every other column is still required. This pins the compatibility exception
    # to exactly one column, so it cannot quietly spread.
    shortened = [name for name in SUMMARY_COLUMNS if name != "Start Date"]
    data = summary_workbook([row()], columns=shortened)

    with pytest.raises(MissingColumnsError) as failure:
        service.import_monitor(data, "monitoring_sheet.xlsx")

    assert "Start Date" in str(failure.value)


def test_a_quantity_stays_numeric() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(quantity=34.0), row(sequence_number="002", quantity=7.5)]),
        "monitoring_sheet.xlsx",
    )

    assert [item.quantity for item in monitor.rows] == [34.0, 7.5]


def test_a_blank_quantity_stays_empty() -> None:
    monitor = service.import_monitor(
        summary_workbook([row(quantity=None)]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].quantity is None


def test_a_long_product_description_is_preserved_whole() -> None:
    description = "Engineered Oak Flooring 15/4 x 120 x 600mm AB grade Glue down method"
    monitor = service.import_monitor(
        summary_workbook([row(product_description=description)]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].product_description == description


def test_client_and_project_names_are_preserved() -> None:
    monitor = service.import_monitor(
        summary_workbook(
            [row(client_name="SAMPLE CLIENT TRADING L.L.C", project_name="Serenity Mansions")]
        ),
        "monitoring_sheet.xlsx",
    )

    assert monitor.rows[0].client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert monitor.rows[0].project_name == "Serenity Mansions"


def test_a_completely_unrelated_workbook_is_rejected() -> None:
    # A sheet that is not the monitoring layout at all must not be read as one.
    data = summary_workbook(
        [{"Name": "widget", "Price": 3.5}],
        columns=["Name", "Price"],
    )

    with pytest.raises(MissingColumnsError):
        service.import_monitor(data, "monitoring_sheet.xlsx")


def test_an_invalid_sequence_number_is_rejected() -> None:
    with pytest.raises(InvalidSequenceNumberError) as failure:
        service.import_monitor(
            summary_workbook([row(sequence_number="N/A")]), "monitoring_sheet.xlsx"
        )

    assert "N/A" in str(failure.value)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("001", "001"),
        ("007", "007"),
        (1, "1"),
        (7, "7"),
    ],
)
def test_a_whole_number_sequence_number_comes_back_as_the_sheet_shows_it(
    value: object, expected: str
) -> None:
    # The whole-number Sequence Numbers a monitoring sheet is meant to hold. A
    # text cell keeps its zeros; a hand-typed number does not gain any.
    monitor = service.import_monitor(
        summary_workbook([row(sequence_number=value)]), "monitoring_sheet.xlsx"
    )

    assert monitor.rows[0].sequence_number == expected


@pytest.mark.parametrize("value", ["1.130", "7.90", "007.90", "N/A", None, ""])
def test_a_sequence_number_that_is_not_a_whole_number_is_refused(value: object) -> None:
    # A dotted value is a quotation's line-item number, not the number its rows are
    # grouped under, so it has no meaning in this column.
    with pytest.raises(InvalidSequenceNumberError):
        service.import_monitor(
            summary_workbook([row(sequence_number=value)]), "monitoring_sheet.xlsx"
        )


class _SequenceValidatorRelaxed(MonitorImportService):
    """A stand-in for a future relaxation of the row-level Sequence Number check.

    The row validator refuses a dotted Sequence Number long before the ordering
    calculation sees one, so the calculation's own guard is otherwise
    unreachable. Subclassing here lets a dotted value through it, which is how the
    guard is shown to hold.
    """

    def _sequence_number(self, value, line: int) -> str:
        return str(value).strip() if value not in (None, "") else ""


@pytest.mark.parametrize("value", ["1.130", "7.90", "007.90", "N/A"])
def test_a_dotted_sequence_number_cannot_reach_the_ordering_calculation(value: str) -> None:
    # The ordering is the one place a value that is not a whole number would
    # raise a ValueError from int(). It must be a message about the user's file
    # instead.
    with pytest.raises(InvalidSequenceNumberError) as failure:
        _SequenceValidatorRelaxed().import_monitor(
            summary_workbook([row(sequence_number=value)]), "monitoring_sheet.xlsx"
        )

    assert value in str(failure.value)


def test_the_ordering_still_finds_the_highest_whole_number() -> None:
    # The guard must not cost the calculation what it is there to provide.
    monitor = _SequenceValidatorRelaxed().import_monitor(
        summary_workbook(
            [
                row(sequence_number="007", product_description="after the gap"),
                row(sequence_number="001", product_description="first"),
                row(sequence_number="002", product_description="second"),
            ]
        ),
        "monitoring_sheet.xlsx",
    )

    assert monitor.highest_sequence == "007"


def test_a_blank_sequence_number_is_rejected() -> None:
    # Every row in a monitoring sheet belongs to a numbered quotation.
    with pytest.raises(InvalidSequenceNumberError):
        service.import_monitor(
            summary_workbook([row(sequence_number=None)]), "monitoring_sheet.xlsx"
        )


def test_a_row_added_below_the_data_is_ignored() -> None:
    # The generator leaves validation ranges below the data; they hold no cells,
    # and a file saved from Excel can carry an empty trailing row.
    data = summary_workbook([row()]) + b""

    monitor = service.import_monitor(data, "monitoring_sheet.xlsx")

    assert monitor.row_count == 1


def test_the_quotation_row_of_a_generated_workbook_keeps_its_values() -> None:
    monitor = service.import_monitor(generated_monitoring_workbook(), "monitoring_sheet.xlsx")

    first = monitor.rows[0]
    assert first.sequence_number == "001"
    assert first.client_name == "SAMPLE CLIENT TRADING L.L.C"
    assert first.project_name == "MBRC 466"
    assert first.product_description == "Sample flooring product"
    assert first.quantity == 34.0
    assert first.unit_of_measurement == "m2"
    # The generator leaves the operational columns empty, and so must the import.
    # With nothing set, the row's status is On Hold rather than a blank the user
    # would otherwise have to fill in herself.
    assert first.installation_schedule == ""
    assert first.start_date is None
    assert first.completion_date is None
    assert first.status == "On Hold"
