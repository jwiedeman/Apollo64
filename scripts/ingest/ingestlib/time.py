"""Ground Elapsed Time helpers used across ingestion notebooks.

The mission datasets rely on Apollo-style Ground Elapsed Time (GET)
strings in ``HHH:MM:SS`` form. Notebooks and helper scripts repeatedly
convert between strings, numeric seconds, and :class:`datetime.timedelta`
values; keeping that logic in one place prevents subtle drift between
the ingestion flow and the runtime simulator.
"""

from __future__ import annotations

from datetime import timedelta
import math
import re
from typing import Iterable, Optional, Union

_GET_PATTERN = re.compile(
    r"^(?P<hours>\d+):(?P<minutes>[0-5]?\d):(?P<seconds>[0-5]?\d)(?:\.(?P<fraction>\d{1,3}))?$"
)

NumericLike = Union[int, float]
GetLike = Union[str, NumericLike, timedelta]


def parse_get(value: Optional[GetLike]) -> Optional[float]:
    """Return the number of seconds represented by ``value``."""

    if value is None:
        return None

    if isinstance(value, timedelta):
        return float(value.total_seconds())

    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"Non-finite GET seconds value: {value!r}")
        return float(value)

    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None

        match = _GET_PATTERN.match(trimmed)
        if not match:
            raise ValueError(f"Invalid GET string: {value!r}")

        hours = int(match.group("hours"))
        minutes = int(match.group("minutes"))
        seconds = int(match.group("seconds"))
        fraction = match.group("fraction")
        fractional_seconds = int(fraction) / (10 ** len(fraction)) if fraction else 0.0
        return float(hours * 3600 + minutes * 60 + seconds + fractional_seconds)

    raise TypeError(f"Unsupported GET type: {type(value)!r}")


def format_get(
    seconds: Optional[NumericLike],
    *,
    precision: int = 0,
    zero_pad_hours: int = 3,
) -> Optional[str]:
    """Return a canonical ``HHH:MM:SS`` representation for ``seconds``."""

    if seconds is None:
        return None

    value = float(seconds)
    if not math.isfinite(value):
        raise ValueError(f"Non-finite GET value: {seconds!r}")

    sign = "-" if value < 0 else ""
    total = abs(value)

    hours = int(total // 3600)
    remaining = total - hours * 3600
    minutes = int(remaining // 60)
    remaining -= minutes * 60

    if precision <= 0:
        sec = int(round(remaining))
        if sec >= 60:
            minutes += 1
            sec -= 60
        if minutes >= 60:
            hours += 1
            minutes -= 60
        return f"{sign}{hours:0{zero_pad_hours}d}:{minutes:02d}:{sec:02d}"

    scale = 10**precision
    sec = round(remaining * scale) / scale
    if sec >= 60:
        minutes += 1
        sec -= 60
    if minutes >= 60:
        hours += 1
        minutes -= 60

    second_str = f"{sec:0{2 + (1 if precision else 0) + precision}.{precision}f}".zfill(2 + 1 + precision)
    if precision > 0 and second_str.find(".") == 1:
        second_str = f"0{second_str}"

    return f"{sign}{hours:0{zero_pad_hours}d}:{minutes:02d}:{second_str}"


def normalize_get(value: Optional[GetLike], *, precision: int = 0) -> Optional[str]:
    """Coerce ``value`` into a canonical GET string or ``None``."""

    seconds = parse_get(value)
    if seconds is None:
        return None
    return format_get(seconds, precision=precision)


def ensure_monotonic(get_values: Iterable[Optional[GetLike]]) -> bool:
    """Return ``True`` if the GET sequence is strictly non-decreasing."""

    previous = None
    for raw in get_values:
        current = parse_get(raw)
        if current is None:
            continue
        if previous is not None and current < previous:
            return False
        previous = current
    return True


def to_timedelta(value: Optional[GetLike]) -> Optional[timedelta]:
    """Return ``value`` as :class:`datetime.timedelta` if possible."""

    seconds = parse_get(value)
    if seconds is None:
        return None
    return timedelta(seconds=seconds)


def add_seconds(value: Optional[GetLike], delta_seconds: NumericLike) -> Optional[str]:
    """Add ``delta_seconds`` to ``value`` and return a canonical string."""

    base = parse_get(value)
    if base is None:
        return None
    return format_get(base + float(delta_seconds))
