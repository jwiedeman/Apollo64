"""Typed representations of the mission datasets."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .time import parse_get
from .utils import clean_string, parse_json_field, split_multi_value


@dataclass
class EventRecord:
    """Normalized view of a row from ``events.csv``."""

    id: str
    phase: str
    get_open: Optional[str]
    get_close: Optional[str]
    get_open_seconds: Optional[float]
    get_close_seconds: Optional[float]
    craft: Optional[str]
    system: Optional[str]
    prerequisites: List[str]
    autopilot_id: Optional[str]
    checklist_id: Optional[str]
    success_effects: Dict[str, Any]
    failure_effects: Dict[str, Any]
    notes: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "EventRecord":
        autopilot_id = clean_string(
            row.get("autopilot_script") or row.get("autopilot_id")
        )
        return cls(
            id=clean_string(row.get("event_id")) or "",
            phase=clean_string(row.get("phase")) or "",
            get_open=clean_string(row.get("get_open")),
            get_close=clean_string(row.get("get_close")),
            get_open_seconds=parse_get(clean_string(row.get("get_open"))),
            get_close_seconds=parse_get(clean_string(row.get("get_close"))),
            craft=clean_string(row.get("craft")),
            system=clean_string(row.get("system")),
            prerequisites=split_multi_value(row.get("prerequisites")),
            autopilot_id=autopilot_id,
            checklist_id=clean_string(row.get("checklist_id")),
            success_effects=parse_json_field(row.get("success_effects"), default={}),
            failure_effects=parse_json_field(row.get("failure_effects"), default={}),
            notes=clean_string(row.get("notes")),
            raw=dict(row),
        )


@dataclass
class ChecklistEntry:
    """Single checklist step from ``checklists.csv``."""

    checklist_id: str
    title: str
    nominal_get: Optional[str]
    crew_role: Optional[str]
    step_number: int
    action: str
    expected_response: Optional[str]
    reference: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "ChecklistEntry":
        step_number = int(row.get("step_number") or 0)
        return cls(
            checklist_id=clean_string(row.get("checklist_id")) or "",
            title=clean_string(row.get("title")) or "",
            nominal_get=clean_string(row.get("GET_nominal")),
            crew_role=clean_string(row.get("crew_role")),
            step_number=step_number,
            action=clean_string(row.get("action")) or "",
            expected_response=clean_string(row.get("expected_response")),
            reference=clean_string(row.get("reference")),
            raw=dict(row),
        )


@dataclass
class AutopilotRecord:
    """Metadata for automation scripts listed in ``autopilots.csv``."""

    id: str
    description: Optional[str]
    script_path: Path
    entry_conditions: Optional[str]
    termination_conditions: Optional[str]
    tolerances: Dict[str, Any]
    propulsion: Dict[str, Any]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_row(cls, row: Dict[str, Any], base_dir: Path) -> "AutopilotRecord":
        script_fragment = clean_string(row.get("script_path")) or ""
        script_path = (base_dir / script_fragment).resolve()
        return cls(
            id=clean_string(row.get("autopilot_id")) or "",
            description=clean_string(row.get("description")),
            script_path=script_path,
            entry_conditions=clean_string(row.get("entry_conditions")),
            termination_conditions=clean_string(row.get("termination_conditions")),
            tolerances=parse_json_field(row.get("tolerances"), default={}),
            propulsion=parse_json_field(row.get("propulsion"), default={}),
            raw=dict(row),
        )

    def load_script(self) -> Dict[str, Any]:
        """Load the JSON payload referenced by ``script_path``."""

        return parse_json_field(self.script_path.read_text(encoding="utf-8"))


@dataclass
class PadRecord:
    """Structured representation of ``pads.csv`` rows."""

    id: str
    purpose: Optional[str]
    delivery_get: Optional[str]
    valid_until: Optional[str]
    parameters: Dict[str, Any]
    source_ref: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "PadRecord":
        return cls(
            id=clean_string(row.get("pad_id")) or "",
            purpose=clean_string(row.get("purpose")),
            delivery_get=clean_string(row.get("GET_delivery")),
            valid_until=clean_string(row.get("valid_until")),
            parameters=parse_json_field(row.get("parameters"), default={}),
            source_ref=clean_string(row.get("source_ref")),
            raw=dict(row),
        )


@dataclass
class FailureRecord:
    """Failure taxonomy entry from ``failures.csv``."""

    id: str
    classification: str
    trigger: Optional[str]
    immediate_effect: Optional[str]
    ongoing_penalty: Optional[str]
    recovery_actions: Optional[str]
    source_ref: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "FailureRecord":
        return cls(
            id=clean_string(row.get("failure_id")) or "",
            classification=clean_string(row.get("classification")) or "",
            trigger=clean_string(row.get("trigger")),
            immediate_effect=clean_string(row.get("immediate_effect")),
            ongoing_penalty=clean_string(row.get("ongoing_penalty")),
            recovery_actions=clean_string(row.get("recovery_actions")),
            source_ref=clean_string(row.get("source_ref")),
            raw=dict(row),
        )


@dataclass
class MissionData:
    """Container aggregating the parsed mission datasets."""

    events: List[EventRecord]
    checklists: List[ChecklistEntry]
    autopilots: List[AutopilotRecord]
    pads: List[PadRecord]
    failures: List[FailureRecord]
    consumables: Dict[str, Any]
    communications: Dict[str, Any]
    thrusters: Dict[str, Any]

    def event_map(self) -> Dict[str, EventRecord]:
        return {event.id: event for event in self.events}

    def checklist_index(self) -> Dict[str, List[ChecklistEntry]]:
        index: Dict[str, List[ChecklistEntry]] = {}
        for entry in self.checklists:
            index.setdefault(entry.checklist_id, []).append(entry)
        return index

    def autopilot_map(self) -> Dict[str, AutopilotRecord]:
        return {auto.id: auto for auto in self.autopilots}
