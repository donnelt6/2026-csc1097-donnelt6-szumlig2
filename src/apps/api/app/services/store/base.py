"""StoreBase: shared constructor and compatibility exports used by the composed store."""

from .internals import ConflictError, SupabaseStore as _InternalSupabaseStore, logger


class StoreBase(_InternalSupabaseStore):
    """Base class that preserves the original store constructor."""

    # Keep constructor chaining explicit so future mixins can safely participate via super().
    def __init__(self) -> None:
        super().__init__()
