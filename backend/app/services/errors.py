"""Domain errors for the extraction pipeline.

Kept separate from the API layer so the parser and service can raise plain
domain errors, and the API can translate them into structured responses without
the service knowing anything about HTTP.
"""


class ExtractionError(Exception):
    """Base class for every failure the user can cause in this application.

    The name predates the monitoring import, which is not an extraction. The
    class is kept as the base so both features translate into the same
    structured error envelope instead of adding a second response shape.
    """


class UploadTooLargeError(ExtractionError):
    """The uploaded file exceeds the accepted size."""


class UnsupportedDocumentError(ExtractionError):
    """The uploaded bytes are not a PDF this system can read."""


class ExtractionFailedError(ExtractionError):
    """The document is a PDF but its text could not be extracted."""


class EmptyDocumentError(ExtractionError):
    """The PDF was readable but contained no extractable text.

    This is common for scanned quotations. The user is told to upload a
    text-based PDF instead of the system attempting OCR or guessing.
    """


class MonitorImportError(ExtractionError):
    """Base class for every reason a monitoring workbook cannot be imported.

    The message is written for the user and is shown to them, so each subclass
    says what is wrong with their file and nothing about Python.
    """


class NotExcelError(MonitorImportError):
    """The uploaded bytes are not a readable Excel workbook."""


class MissingSummarySheetError(MonitorImportError):
    """The workbook is readable but has no Summary worksheet."""


class MissingColumnsError(MonitorImportError):
    """The Summary worksheet is missing one or more required columns."""


class EmptySummaryError(MonitorImportError):
    """The Summary worksheet is correctly shaped but holds no rows."""


class InvalidSequenceNumberError(MonitorImportError):
    """A row's Sequence Number is not a number the application can use."""


class InvalidStatusValueError(MonitorImportError):
    """A row's Status is not one of the values the dropdown offers."""


MAX_UPLOAD_BYTES = 20 * 1024 * 1024
