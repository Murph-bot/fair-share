"""Domain-specific exceptions for fair-share."""


class FairShareError(Exception):
    """Base class for all fair-share errors."""


class ValidationError(FairShareError):
    """Raised when user input fails validation."""


class UnknownPersonError(FairShareError):
    """Raised when a referenced person has not been added."""


class StorageError(FairShareError):
    """Raised for file I/O or schema errors."""


class ExpenseNotFoundError(FairShareError):
    """Raised when an expense ID does not exist."""
