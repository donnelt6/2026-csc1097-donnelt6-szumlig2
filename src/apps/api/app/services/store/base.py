"""StoreBase: shared constructor and compatibility exports used by the composed store."""

from .internals import ConflictError, SupabaseStore as _InternalSupabaseStore, logger


class StoreBase:
    """Base class that preserves the original store constructor."""

    # Reuse the original store constructor so every mixin instance gets the same shared clients and settings.
    __init__ = _InternalSupabaseStore.__init__
