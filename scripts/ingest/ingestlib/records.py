"""Typed representations of the mission datasets."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .time import parse_get
from .utils import clean_string, parse_json_field, safe_bool, safe_float, safe_int, split_multi_value


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
class AudioDuckingRule:
    """Cross-bus ducking instruction for an audio bus."""

    target: str
    gain_db: float
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "AudioDuckingRule":
        target = clean_string(payload.get("target")) or ""
        gain = safe_float(payload.get("gainDb"))
        return cls(target=target, gain_db=gain if gain is not None else 0.0, raw=dict(payload))


@dataclass
class AudioBus:
    """Logical routing bus used by the audio dispatcher."""

    id: str
    name: Optional[str]
    description: Optional[str]
    max_concurrent: Optional[int]
    ducking: List[AudioDuckingRule]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "AudioBus":
        ducking_rules = []
        for rule in payload.get("ducking", []) or []:
            try:
                ducking_rules.append(AudioDuckingRule.from_dict(rule))
            except ValueError:
                continue
        max_concurrent = None
        if payload.get("maxConcurrent") is not None:
            max_concurrent = safe_int(payload.get("maxConcurrent"))
        return cls(
            id=clean_string(payload.get("id")) or "",
            name=clean_string(payload.get("name")),
            description=clean_string(payload.get("description")),
            max_concurrent=max_concurrent,
            ducking=ducking_rules,
            raw=dict(payload),
        )


@dataclass
class AudioCategory:
    """Category metadata that maps cues to buses and priorities."""

    id: str
    name: Optional[str]
    bus: Optional[str]
    default_priority: Optional[int]
    cooldown_seconds: Optional[float]
    description: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "AudioCategory":
        return cls(
            id=clean_string(payload.get("id")) or "",
            name=clean_string(payload.get("name")),
            bus=clean_string(payload.get("bus")),
            default_priority=safe_int(payload.get("defaultPriority")),
            cooldown_seconds=safe_float(payload.get("cooldownSeconds")),
            description=clean_string(payload.get("description")),
            raw=dict(payload),
        )


@dataclass
class AudioCue:
    """Individual cue definition with routing and asset metadata."""

    id: str
    name: Optional[str]
    category: Optional[str]
    priority: Optional[int]
    length_seconds: Optional[float]
    loop: Optional[bool]
    cooldown_seconds: Optional[float]
    loudness_lufs: Optional[float]
    assets: Dict[str, str]
    subtitle: Optional[str]
    tags: List[str]
    source: Optional[str]
    notes: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "AudioCue":
        loop_value = payload.get("loop")
        loop = None
        if isinstance(loop_value, bool):
            loop = loop_value
        elif loop_value is not None:
            loop = safe_bool(loop_value)

        assets_raw = payload.get("assets") or {}
        assets: Dict[str, str] = {}
        if isinstance(assets_raw, dict):
            for key, value in assets_raw.items():
                text = clean_string(value)
                if text:
                    assets[str(key)] = text

        tags = []
        if isinstance(payload.get("tags"), (list, tuple, set)):
            tags = [clean_string(tag) or "" for tag in payload.get("tags") if clean_string(tag)]

        return cls(
            id=clean_string(payload.get("id")) or "",
            name=clean_string(payload.get("name")),
            category=clean_string(payload.get("category")),
            priority=safe_int(payload.get("priority")),
            length_seconds=safe_float(payload.get("lengthSeconds")),
            loop=loop,
            cooldown_seconds=safe_float(payload.get("cooldownSeconds")),
            loudness_lufs=safe_float(payload.get("loudnessLufs")),
            assets=assets,
            subtitle=clean_string(payload.get("subtitle")),
            tags=tags,
            source=clean_string(payload.get("source")),
            notes=clean_string(payload.get("notes")),
            raw=dict(payload),
        )


@dataclass
class AudioCuePack:
    """Container for the audio cue catalog JSON."""

    version: Optional[int]
    description: Optional[str]
    buses: List[AudioBus]
    categories: List[AudioCategory]
    cues: List[AudioCue]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "AudioCuePack":
        buses = [AudioBus.from_dict(entry) for entry in payload.get("buses", []) or []]
        categories = [
            AudioCategory.from_dict(entry) for entry in payload.get("categories", []) or []
        ]
        cues = [AudioCue.from_dict(entry) for entry in payload.get("cues", []) or []]
        version = safe_int(payload.get("version"))
        return cls(
            version=version,
            description=clean_string(payload.get("description")),
            buses=buses,
            categories=categories,
            cues=cues,
            raw=dict(payload),
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
    audio_cues: AudioCuePack

    def event_map(self) -> Dict[str, EventRecord]:
        return {event.id: event for event in self.events}

    def checklist_index(self) -> Dict[str, List[ChecklistEntry]]:
        index: Dict[str, List[ChecklistEntry]] = {}
        for entry in self.checklists:
            index.setdefault(entry.checklist_id, []).append(entry)
        return index

    def autopilot_map(self) -> Dict[str, AutopilotRecord]:
        return {auto.id: auto for auto in self.autopilots}
