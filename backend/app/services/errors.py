"""Domain errors for the extraction pipeline.

Kept separate from the API layer so the parser and service can raise plain
domain errors, and the API can translate them into structured responses without
the service knowing anything about HTTP.
"""


class ExtractionError(Exception):
    """Base class for every extraction failure."""


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


MAX_UPLOAD_BYTES = 20 * 1024 * 1024
