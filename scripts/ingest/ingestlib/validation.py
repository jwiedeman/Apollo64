"""Lightweight validation for ingestion outputs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .records import MissionData
from .time import parse_get

_ALLOWED_FAILURE_CLASSES = {"Recoverable", "Hard", "Technical"}


@dataclass
class ValidationIssue:
    level: str  # "error" or "warning"
    category: str
    message: str
    context: Dict[str, Any]

    def __lt__(self, other: "ValidationIssue") -> bool:
        return (self.level, self.category, self.message) < (
            other.level,
            other.category,
            other.message,
        )


def validate_mission_data(mission_data: MissionData) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    event_map = mission_data.event_map()
    checklist_index = mission_data.checklist_index()
    autopilot_map = mission_data.autopilot_map()
    failure_ids = {failure.id for failure in mission_data.failures}

    # Events
    for event in mission_data.events:
        if event.get_open_seconds is not None and event.get_close_seconds is not None:
            if event.get_close_seconds < event.get_open_seconds:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="events",
                        message="Event window closes before it opens",
                        context={"event_id": event.id},
                    )
                )

        for prereq in event.prerequisites:
            if prereq not in event_map:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="events",
                        message="Missing prerequisite reference",
                        context={"event_id": event.id, "missing": prereq},
                    )
                )

        if event.autopilot_id and event.autopilot_id not in autopilot_map:
            issues.append(
                ValidationIssue(
                    level="error",
                    category="events",
                    message="Unknown autopilot reference",
                    context={"event_id": event.id, "autopilot_id": event.autopilot_id},
                )
            )

        if event.checklist_id and event.checklist_id not in checklist_index:
            issues.append(
                ValidationIssue(
                    level="error",
                    category="events",
                    message="Unknown checklist reference",
                    context={"event_id": event.id, "checklist_id": event.checklist_id},
                )
            )

        referenced_failure = _extract_failure_id(event.failure_effects)
        if referenced_failure and referenced_failure not in failure_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    category="events",
                    message="Unknown failure reference",
                    context={"event_id": event.id, "failure_id": referenced_failure},
                )
            )

    # Checklists
    for checklist_id, steps in checklist_index.items():
        numbers = sorted(step.step_number for step in steps)
        for index, step_number in enumerate(numbers, start=1):
            if step_number != index:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="checklists",
                        message="Checklist step numbers are not sequential",
                        context={"checklist_id": checklist_id, "expected": index, "found": step_number},
                    )
                )
                break

    # Autopilots
    for autopilot in mission_data.autopilots:
        if not autopilot.script_path.is_file():
            issues.append(
                ValidationIssue(
                    level="error",
                    category="autopilots",
                    message="Autopilot script file is missing",
                    context={"autopilot_id": autopilot.id, "path": str(autopilot.script_path)},
                )
            )
            continue

        try:
            payload = autopilot.load_script()
        except Exception as exc:  # pylint: disable=broad-except
            issues.append(
                ValidationIssue(
                    level="error",
                    category="autopilots",
                    message="Failed to parse autopilot script JSON",
                    context={"autopilot_id": autopilot.id, "error": str(exc)},
                )
            )
            continue

        sequence = payload.get("sequence")
        if isinstance(sequence, list):
            previous = None
            for entry in sequence:
                time_value = entry.get("time") if isinstance(entry, dict) else None
                if time_value is None:
                    continue
                try:
                    numeric = float(time_value)
                except (TypeError, ValueError):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="autopilots",
                            message="Invalid command time value",
                            context={"autopilot_id": autopilot.id, "command": entry},
                        )
                    )
                    continue
                if previous is not None and numeric < previous:
                    issues.append(
                        ValidationIssue(
                            level="warning",
                            category="autopilots",
                            message="Autopilot commands are not sorted by time",
                            context={"autopilot_id": autopilot.id},
                        )
                    )
                    break
                previous = numeric

    # PADs
    for pad in mission_data.pads:
        for field_name, value in (
            ("GET_delivery", pad.delivery_get),
            ("valid_until", pad.valid_until),
        ):
            if value is None:
                continue
            try:
                parse_get(value)
            except Exception as exc:  # pylint: disable=broad-except
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="pads",
                        message=f"Invalid GET string in {field_name}",
                        context={"pad_id": pad.id, "value": value, "error": str(exc)},
                    )
                )

    # Failures
    for failure in mission_data.failures:
        if failure.classification not in _ALLOWED_FAILURE_CLASSES:
            issues.append(
                ValidationIssue(
                    level="warning",
                    category="failures",
                    message="Unknown failure classification",
                    context={"failure_id": failure.id, "classification": failure.classification},
                )
            )

    issues.sort()
    return issues


def _extract_failure_id(effect: Any) -> Optional[str]:
    if isinstance(effect, dict):
        if "failure_id" in effect:
            value = effect.get("failure_id")
            return str(value) if value is not None else None
        for nested in effect.values():
            candidate = _extract_failure_id(nested)
            if candidate:
                return candidate
    return None


__all__ = ["ValidationIssue", "validate_mission_data"]
