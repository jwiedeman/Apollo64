"""Lightweight validation for mission datasets produced by ingestion."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

from .records import (
    MissionData,
    UiChecklist,
    UiChecklistPack,
    UiPanel,
    UiPanelControl,
    UiPanelPack,
    UiWorkspacePack,
)
from .time import parse_get
from .utils import clean_string

_ALLOWED_FAILURE_CLASSES = {"Recoverable", "Hard", "Technical"}
_UI_PHASES = {"Launch", "Translunar", "LunarOrbit", "Surface", "Transearth", "Entry"}
_UI_ROLES = {"CDR", "CMP", "LMP", "Joint"}
_UI_CONTROL_TYPES = {"toggle", "enum", "rotary", "momentary", "analog"}


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

    issues.extend(_validate_communications_schedule(mission_data.communications))
    issues.extend(_validate_consumables_pack(mission_data.consumables))
    issues.extend(_validate_ui_packs(mission_data))

    audio_pack = mission_data.audio_cues
    if audio_pack:
        bus_ids: Set[str] = set()
        for bus in audio_pack.buses:
            if not bus.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio bus is missing an id",
                        context={"bus": bus.raw},
                    )
                )
                continue
            if bus.id in bus_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Duplicate audio bus id",
                        context={"bus_id": bus.id},
                    )
                )
            bus_ids.add(bus.id)
            if bus.max_concurrent is not None and bus.max_concurrent <= 0:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="audio",
                        message="Audio bus maxConcurrent should be positive",
                        context={"bus_id": bus.id, "value": bus.max_concurrent},
                    )
                )

        known_bus_ids = set(bus_ids)
        for bus in audio_pack.buses:
            for rule in bus.ducking:
                if rule.target and rule.target not in known_bus_ids:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="audio",
                            message="Audio bus ducking references unknown target",
                            context={"bus_id": bus.id, "target": rule.target},
                        )
                    )

        category_ids: Set[str] = set()
        for category in audio_pack.categories:
            if not category.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio category is missing an id",
                        context={"category": category.raw},
                    )
                )
                continue
            if category.id in category_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Duplicate audio category id",
                        context={"category_id": category.id},
                    )
                )
            category_ids.add(category.id)
            if category.bus and category.bus not in known_bus_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio category references unknown bus",
                        context={"category_id": category.id, "bus": category.bus},
                    )
                )

        cue_ids: Set[str] = set()
        for cue in audio_pack.cues:
            if not cue.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio cue is missing an id",
                        context={"cue": cue.raw},
                    )
                )
                continue
            if cue.id in cue_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Duplicate audio cue id",
                        context={"cue_id": cue.id},
                    )
                )
            cue_ids.add(cue.id)
            if cue.category and cue.category not in category_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio cue references unknown category",
                        context={"cue_id": cue.id, "category": cue.category},
                    )
                )
            if cue.length_seconds is not None and cue.length_seconds <= 0:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="audio",
                        message="Audio cue lengthSeconds should be positive",
                        context={"cue_id": cue.id, "lengthSeconds": cue.length_seconds},
                    )
                )
            if cue.cooldown_seconds is not None and cue.cooldown_seconds < 0:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="audio",
                        message="Audio cue cooldownSeconds should not be negative",
                        context={"cue_id": cue.id, "cooldownSeconds": cue.cooldown_seconds},
                    )
                )
            if not cue.assets:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="audio",
                        message="Audio cue must define at least one asset path",
                        context={"cue_id": cue.id},
                    )
                )
            if not cue.source:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="audio",
                        message="Audio cue is missing a source citation",
                        context={"cue_id": cue.id},
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


def _validate_communications_schedule(raw: Any) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    entries = _normalize_communications_entries(raw)
    if entries is None:
        issues.append(
            ValidationIssue(
                level="error",
                category="communications",
                message="Communications dataset must be a list or dict",
                context={"type": type(raw).__name__},
            )
        )
        return issues

    seen_ids = set()
    previous_open = None

    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            issues.append(
                ValidationIssue(
                    level="error",
                    category="communications",
                    message="Communications entry must be an object",
                    context={"index": index, "type": type(entry).__name__},
                )
            )
            continue

        entry_id = clean_string(entry.get("id") or entry.get("pass_id"))
        if entry_id:
            if entry_id in seen_ids:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="communications",
                        message="Duplicate communications pass identifier",
                        context={"pass_id": entry_id},
                    )
                )
            else:
                seen_ids.add(entry_id)
        else:
            issues.append(
                ValidationIssue(
                    level="warning",
                    category="communications",
                    message="Communications pass is missing an identifier",
                    context={"index": index},
                )
            )

        open_seconds = _parse_get_field(
            entry.get("get_open"),
            issues,
            field_name="get_open",
            entry_id=entry_id,
        )
        close_seconds = _parse_get_field(
            entry.get("get_close"),
            issues,
            field_name="get_close",
            entry_id=entry_id,
        )

        if (
            open_seconds is not None
            and close_seconds is not None
            and close_seconds < open_seconds
        ):
            issues.append(
                ValidationIssue(
                    level="error",
                    category="communications",
                    message="Communications window closes before it opens",
                    context={
                        "pass_id": entry_id,
                        "get_open": entry.get("get_open"),
                        "get_close": entry.get("get_close"),
                    },
                )
            )

        if (
            open_seconds is not None
            and previous_open is not None
            and open_seconds < previous_open
        ):
            issues.append(
                ValidationIssue(
                    level="warning",
                    category="communications",
                    message="Communications windows are not sorted by GET",
                    context={
                        "pass_id": entry_id,
                        "previous_open_seconds": previous_open,
                        "current_open_seconds": open_seconds,
                    },
                )
            )

        if open_seconds is not None:
            previous_open = open_seconds

        station = clean_string(entry.get("station"))
        if not station:
            issues.append(
                ValidationIssue(
                    level="warning",
                    category="communications",
                    message="Communications pass missing station name",
                    context={"pass_id": entry_id, "index": index},
                )
            )

    return issues


def _validate_consumables_pack(raw: Any) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    if raw is None:
        return issues
    if not isinstance(raw, dict):
        issues.append(
            ValidationIssue(
                level="error",
                category="consumables",
                message="Consumables dataset must be an object",
                context={"type": type(raw).__name__},
            )
        )
        return issues

    for category, payload in raw.items():
        if category in {"power", "propellant", "life_support"}:
            if not isinstance(payload, dict):
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="consumables",
                        message="Consumables category must map to an object",
                        context={"category": category, "type": type(payload).__name__},
                    )
                )
                continue
            for resource_id, resource in payload.items():
                if not isinstance(resource, dict):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="consumables",
                            message="Consumable entry must be an object",
                            context={
                                "category": category,
                                "resource_id": resource_id,
                                "type": type(resource).__name__,
                            },
                        )
                    )
                    continue
                for field_name, value in resource.items():
                    if _looks_numeric_field(field_name):
                        if value is None:
                            continue
                        if not _is_finite_number(value):
                            issues.append(
                                ValidationIssue(
                                    level="error",
                                    category="consumables",
                                    message="Consumable numeric field must be finite",
                                    context={
                                        "category": category,
                                        "resource_id": resource_id,
                                        "field": field_name,
                                        "value": value,
                                    },
                                )
                            )
                        elif value < 0:
                            issues.append(
                                ValidationIssue(
                                    level="warning",
                                    category="consumables",
                                    message="Consumable numeric field is negative",
                                    context={
                                        "category": category,
                                        "resource_id": resource_id,
                                        "field": field_name,
                                        "value": value,
                                    },
                                )
                            )
        elif category == "communications":
            if not isinstance(payload, dict):
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="consumables",
                        message="Communications metadata must be an object",
                        context={"category": category, "type": type(payload).__name__},
                    )
                )
                continue
            shift_hours = payload.get("dsn_shift_hours")
            if shift_hours is not None:
                if not (
                    isinstance(shift_hours, list)
                    and all(_is_finite_number(value) for value in shift_hours)
                ):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="consumables",
                            message="DSN shift hours must be a list of numbers",
                            context={"value": shift_hours},
                        )
                    )

    return issues


def _normalize_communications_entries(raw: Any) -> Optional[List[Dict[str, Any]]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [entry for entry in raw if isinstance(entry, dict)]
    if isinstance(raw, dict):
        for key in ("passes", "schedule", "entries"):
            maybe = raw.get(key)
            if isinstance(maybe, list):
                return [entry for entry in maybe if isinstance(entry, dict)]
        return []
    return None


def _parse_get_field(
    value: Any,
    issues: List[ValidationIssue],
    *,
    field_name: str,
    entry_id: Optional[str],
) -> Optional[float]:
    if value is None:
        issues.append(
            ValidationIssue(
                level="error",
                category="communications",
                message=f"Communications pass missing {field_name}",
                context={"pass_id": entry_id},
            )
        )
        return None
    try:
        seconds = parse_get(value)
    except Exception as exc:  # pylint: disable=broad-except
        issues.append(
            ValidationIssue(
                level="error",
                category="communications",
                message=f"Invalid GET string for {field_name}",
                context={"pass_id": entry_id, "value": value, "error": str(exc)},
            )
        )
        return None
    return seconds




def _validate_ui_packs(mission_data: MissionData) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    panel_pack: Optional[UiPanelPack] = mission_data.ui_panels
    panel_map: Dict[str, UiPanel] = {}
    control_maps: Dict[str, Dict[str, UiPanelControl]] = {}
    if panel_pack:
        for panel in panel_pack.panels:
            if not panel.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_panels",
                        message="Panel entry is missing an id",
                        context={"panel": panel.raw},
                    )
                )
                continue
            if panel.id in panel_map:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_panels",
                        message="Duplicate panel id",
                        context={"panel_id": panel.id},
                    )
                )
                continue
            panel_map[panel.id] = panel

            seen_controls: Set[str] = set()
            for control in panel.controls:
                if not control.id:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="ui_panels",
                            message="Panel control missing id",
                            context={"panel_id": panel.id, "control": control.raw},
                        )
                    )
                    continue
                if control.id in seen_controls:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="ui_panels",
                            message="Duplicate control id within panel",
                            context={"panel_id": panel.id, "control_id": control.id},
                        )
                    )
                seen_controls.add(control.id)
                if control.type and control.type not in _UI_CONTROL_TYPES:
                    issues.append(
                        ValidationIssue(
                            level="warning",
                            category="ui_panels",
                            message="Unknown panel control type",
                            context={"panel_id": panel.id, "control_id": control.id, "type": control.type},
                        )
                    )

            control_maps[panel.id] = panel.control_map()

    checklist_pack: Optional[UiChecklistPack] = mission_data.ui_checklists
    if checklist_pack:
        seen_checklists: Set[str] = set()
        for checklist in checklist_pack.checklists:
            if not checklist.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_checklists",
                        message="Checklist entry missing id",
                        context={"checklist": checklist.raw},
                    )
                )
                continue
            if checklist.id in seen_checklists:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_checklists",
                        message="Duplicate checklist id",
                        context={"checklist_id": checklist.id},
                    )
                )
            seen_checklists.add(checklist.id)

            if checklist.phase and checklist.phase not in _UI_PHASES:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="ui_checklists",
                        message="Checklist references unknown phase",
                        context={"checklist_id": checklist.id, "phase": checklist.phase},
                    )
                )
            if checklist.role and checklist.role not in _UI_ROLES:
                issues.append(
                    ValidationIssue(
                        level="warning",
                        category="ui_checklists",
                        message="Checklist references unknown crew role",
                        context={"checklist_id": checklist.id, "role": checklist.role},
                    )
                )

            for step in checklist.steps:
                panel_id = step.panel_id
                control_map = control_maps.get(panel_id) if panel_id else {}
                if panel_id and panel_id not in panel_map:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="ui_checklists",
                            message="Checklist step references unknown panel",
                            context={"checklist_id": checklist.id, "step_id": step.id, "panel_id": panel_id},
                        )
                    )

                for requirement in step.controls:
                    if not requirement.control_id:
                        issues.append(
                            ValidationIssue(
                                level="warning",
                                category="ui_checklists",
                                message="Checklist control requirement missing controlId",
                                context={"checklist_id": checklist.id, "step_id": step.id},
                            )
                        )
                        continue
                    if control_map and requirement.control_id not in control_map:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                category="ui_checklists",
                                message="Checklist references unknown panel control",
                                context={
                                    "checklist_id": checklist.id,
                                    "step_id": step.id,
                                    "panel_id": panel_id,
                                    "control_id": requirement.control_id,
                                },
                            )
                        )

    workspace_pack: Optional[UiWorkspacePack] = mission_data.ui_workspaces
    if workspace_pack:
        seen_workspaces: Set[str] = set()
        for workspace in workspace_pack.presets:
            if not workspace.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_workspaces",
                        message="Workspace preset missing id",
                        context={"workspace": workspace.raw},
                    )
                )
                continue
            if workspace.id in seen_workspaces:
                issues.append(
                    ValidationIssue(
                        level="error",
                        category="ui_workspaces",
                        message="Duplicate workspace id",
                        context={"workspace_id": workspace.id},
                    )
                )
                continue
            seen_workspaces.add(workspace.id)

            seen_tiles: Set[str] = set()
            for tile in workspace.tiles:
                if not tile.id:
                    issues.append(
                        ValidationIssue(
                            level="warning",
                            category="ui_workspaces",
                            message="Workspace tile missing id",
                            context={"workspace_id": workspace.id, "tile": tile.raw},
                        )
                    )
                    continue
                if tile.id in seen_tiles:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            category="ui_workspaces",
                            message="Duplicate tile id within workspace",
                            context={"workspace_id": workspace.id, "tile_id": tile.id},
                        )
                    )
                seen_tiles.add(tile.id)

    return issues

def _looks_numeric_field(name: str) -> bool:
    numeric_suffixes = (
        "_kg",
        "_kw",
        "_minutes",
        "_mps",
        "_ah",
        "_pct",
    )
    if any(name.endswith(suffix) for suffix in numeric_suffixes):
        return True
    return name in {"canisters"}


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)
