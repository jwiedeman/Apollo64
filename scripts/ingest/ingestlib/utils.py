"""Shared parsing helpers for ingestion notebooks."""

from __future__ import annotations

import json
import math
from typing import Any, Iterable, List, Optional

_SEPARATORS = (',', ';', '|')


def clean_string(value: Optional[Any]) -> Optional[str]:
    """Return ``value`` as a stripped string or ``None`` if blank."""

    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return str(value).strip() or None


def parse_json_field(value: Any, default: Any = None) -> Any:
    """Parse a JSON fragment stored in a CSV cell.

    Empty strings resolve to ``default`` (which defaults to ``None``).
    Exceptions bubble up so notebooks surface malformed input early.
    """

    text = clean_string(value)
    if text is None:
        return default

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        normalized = text.replace('\"', '"')
        if normalized != text:
            try:
                return json.loads(normalized)
            except json.JSONDecodeError:
                pass
        raise ValueError(f"Invalid JSON payload: {text!r}") from exc


def split_multi_value(value: Any) -> List[str]:
    """Split a multi-value cell into a list of identifiers."""

    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [item.strip() for item in value if clean_string(item)]

    text = str(value).strip()
    if not text:
        return []

    for separator in _SEPARATORS:
        text = text.replace(separator, ' ')
    return [token for token in text.split() if token]


def safe_float(value: Any) -> Optional[float]:
    """Convert ``value`` to ``float`` while ignoring blanks."""

    text = clean_string(value)
    if text is None:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid numeric value: {value!r}") from exc
    if math.isnan(number) or math.isinf(number):
        raise ValueError(f"Non-finite numeric value: {value!r}")
    return number


def safe_int(value: Any) -> Optional[int]:
    """Convert ``value`` to ``int`` while ignoring blanks."""

    number = safe_float(value)
    if number is None:
        return None
    rounded = round(number)
    if abs(number - rounded) > 1e-6:
        raise ValueError(f"Non-integer value: {value!r}")
    return int(rounded)


def safe_bool(value: Any) -> Optional[bool]:
    """Convert ``value`` to ``bool`` while accepting common string forms."""

    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if abs(value) < 1e-6:
            return False
        if abs(value - 1) < 1e-6:
            return True
    text = clean_string(value)
    if text is None:
        return None
    lowered = text.lower()
    if lowered in {"true", "t", "1", "yes", "y", "on"}:
        return True
    if lowered in {"false", "f", "0", "no", "n", "off"}:
        return False
    raise ValueError(f"Invalid boolean value: {value!r}")


def iter_non_null(values: Iterable[Any]):
    """Yield non-empty values from ``values``."""

    for value in values:
        if clean_string(value) is None:
            continue
        yield value
