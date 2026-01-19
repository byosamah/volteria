"""
Timestamp Alignment Utilities

Provides functions for aligning timestamps to interval boundaries.
Used by logging service to ensure correlated data has identical timestamps.

Example:
    Two registers polled at slightly different times (10.050s and 10.150s)
    both get aligned to 10.000s when using a 1-second interval.
    This makes cross-device correlation trivial.
"""

from datetime import datetime, timezone


def align_timestamp(ts: datetime, interval_seconds: float) -> datetime:
    """
    Align timestamp to the nearest interval boundary.

    Rounds DOWN to the previous interval boundary. This ensures:
    - All readings within the same interval share identical timestamps
    - Timestamps are deterministic (same input = same output)
    - Sub-second intervals (0.5s) are supported
    - Hour+ intervals (3600s+) work correctly

    Args:
        ts: The timestamp to align (timezone-aware recommended)
        interval_seconds: The interval in seconds (0.5 to 3600+)

    Returns:
        Aligned datetime, preserving the original timezone

    Examples:
        # Sub-second (0.5s interval):
        # 14:30:17.234 with 0.5s → 14:30:17.000
        # 14:30:17.678 with 0.5s → 14:30:17.500

        # Seconds:
        # 14:30:17 with 10s  → 14:30:10
        # 14:30:45 with 30s  → 14:30:30
        # 14:30:17 with 60s  → 14:30:00

        # Hours:
        # 14:30:17 with 3600s → 14:00:00
        # 15:45:00 with 7200s → 14:00:00 (2-hour boundary)
    """
    if interval_seconds <= 0:
        return ts

    # Convert to epoch seconds for precise arithmetic
    epoch = ts.timestamp()

    # Round down to interval boundary
    aligned_epoch = (epoch // interval_seconds) * interval_seconds

    # Convert back to datetime, preserving timezone
    tz = ts.tzinfo or timezone.utc
    return datetime.fromtimestamp(aligned_epoch, tz)


def align_timestamp_iso(ts_iso: str, interval_seconds: float) -> str:
    """
    Align an ISO timestamp string and return an aligned ISO string.

    Convenience wrapper for align_timestamp that works with ISO strings.

    Args:
        ts_iso: ISO format timestamp (e.g., "2024-01-15T10:30:17.234Z")
        interval_seconds: The interval in seconds

    Returns:
        Aligned timestamp as ISO string
    """
    if not ts_iso or interval_seconds <= 0:
        return ts_iso

    try:
        # Parse ISO timestamp
        ts_clean = ts_iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_clean)

        # Align and return
        aligned = align_timestamp(dt, interval_seconds)
        return aligned.isoformat()
    except (ValueError, TypeError):
        # Return original if parsing fails
        return ts_iso


def get_aligned_now(interval_seconds: float) -> datetime:
    """
    Get current UTC time aligned to interval boundary.

    Convenience function for getting an aligned "now" timestamp.

    Args:
        interval_seconds: The interval in seconds

    Returns:
        Current UTC time aligned to interval boundary
    """
    now = datetime.now(timezone.utc)
    return align_timestamp(now, interval_seconds)


def get_aligned_now_iso(interval_seconds: float) -> str:
    """
    Get current UTC time aligned to interval boundary as ISO string.

    Args:
        interval_seconds: The interval in seconds

    Returns:
        Current aligned UTC time as ISO string
    """
    return get_aligned_now(interval_seconds).isoformat()
