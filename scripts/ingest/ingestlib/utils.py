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


def iter_non_null(values: Iterable[Any]):
    """Yield non-empty values from ``values``."""

    for value in values:
        if clean_string(value) is None:
            continue
        yield value
