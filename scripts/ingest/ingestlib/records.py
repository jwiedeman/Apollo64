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


def _normalize_string_list(values: Optional[List[Any]]) -> List[str]:
    """Return ``values`` as a list of stripped strings."""

    if not values:
        return []
    normalized: List[str] = []
    for value in values:
        text = clean_string(value)
        if text:
            normalized.append(text)
    return normalized


@dataclass
class UiChecklistControlRequirement:
    """Control prerequisite referenced by a UI checklist step."""

    control_id: str
    target_state: Optional[str]
    verification: Optional[str]
    tolerance: Optional[float]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiChecklistControlRequirement":
        return cls(
            control_id=clean_string(payload.get("controlId")) or "",
            target_state=clean_string(payload.get("targetState")),
            verification=clean_string(payload.get("verification")),
            tolerance=safe_float(payload.get("tolerance")) if payload.get("tolerance") is not None else None,
            raw=dict(payload),
        )


@dataclass
class UiChecklistStep:
    """Single interactive step from ``docs/ui/checklists.json``."""

    id: str
    order: int
    callout: str
    panel_id: Optional[str]
    controls: List[UiChecklistControlRequirement]
    dsky_macro: Optional[str]
    manual_only: Optional[bool]
    prerequisites: List[str]
    effects: List[Dict[str, Any]]
    notes: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiChecklistStep":
        controls_payload = payload.get("controls")
        controls: List[UiChecklistControlRequirement] = []
        if isinstance(controls_payload, list):
            for entry in controls_payload:
                if isinstance(entry, dict):
                    controls.append(UiChecklistControlRequirement.from_dict(entry))

        effects_payload = payload.get("effects")
        effects: List[Dict[str, Any]] = []
        if isinstance(effects_payload, list):
            effects = [dict(effect) for effect in effects_payload if isinstance(effect, dict)]

        return cls(
            id=clean_string(payload.get("id")) or "",
            order=safe_int(payload.get("order")) or 0,
            callout=clean_string(payload.get("callout")) or "",
            panel_id=clean_string(payload.get("panel")),
            controls=controls,
            dsky_macro=clean_string(payload.get("dskyMacro")),
            manual_only=safe_bool(payload.get("manualOnly")),
            prerequisites=_normalize_string_list(payload.get("prerequisites")),
            effects=effects,
            notes=clean_string(payload.get("notes")),
            raw=dict(payload),
        )


@dataclass
class UiChecklist:
    """Checklist definition consumed by the UI layer."""

    id: str
    title: str
    phase: Optional[str]
    role: Optional[str]
    nominal_get: Optional[str]
    source: Dict[str, Any]
    steps: List[UiChecklistStep]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiChecklist":
        steps_payload = payload.get("steps")
        steps: List[UiChecklistStep] = []
        if isinstance(steps_payload, list):
            for entry in steps_payload:
                if isinstance(entry, dict):
                    steps.append(UiChecklistStep.from_dict(entry))

        source = payload.get("source")
        source_payload = dict(source) if isinstance(source, dict) else {}

        return cls(
            id=clean_string(payload.get("id")) or "",
            title=clean_string(payload.get("title")) or "",
            phase=clean_string(payload.get("phase")),
            role=clean_string(payload.get("role")),
            nominal_get=clean_string(payload.get("nominalGet")),
            source=source_payload,
            steps=steps,
            raw=dict(payload),
        )


@dataclass
class UiChecklistPack:
    """Top-level container for UI checklist definitions."""

    version: Optional[int]
    checklists: List[UiChecklist]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiChecklistPack":
        checklists_payload = payload.get("checklists")
        checklists: List[UiChecklist] = []
        if isinstance(checklists_payload, list):
            for entry in checklists_payload:
                if isinstance(entry, dict):
                    checklists.append(UiChecklist.from_dict(entry))

        return cls(
            version=safe_int(payload.get("version")),
            checklists=checklists,
            raw=dict(payload),
        )

    def checklist_map(self) -> Dict[str, UiChecklist]:
        return {checklist.id: checklist for checklist in self.checklists}


@dataclass
class UiPanelControlState:
    """Enumerated state for a UI panel control."""

    id: str
    label: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiPanelControlState":
        return cls(
            id=clean_string(payload.get("id")) or "",
            label=clean_string(payload.get("label")),
            raw=dict(payload),
        )


@dataclass
class UiPanelControl:
    """Interactive control on a panel schematic."""

    id: str
    type: Optional[str]
    label: Optional[str]
    default_state: Optional[str]
    states: List[UiPanelControlState]
    dependencies: List[Dict[str, Any]]
    telemetry: Dict[str, Any]
    effects: List[Dict[str, Any]]
    notes: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiPanelControl":
        states_payload = payload.get("states")
        states: List[UiPanelControlState] = []
        if isinstance(states_payload, list):
            for entry in states_payload:
                if isinstance(entry, dict):
                    states.append(UiPanelControlState.from_dict(entry))

        dependencies_payload = payload.get("dependencies")
        dependencies: List[Dict[str, Any]] = []
        if isinstance(dependencies_payload, list):
            dependencies = [dict(entry) for entry in dependencies_payload if isinstance(entry, dict)]

        effects_payload = payload.get("effects")
        effects: List[Dict[str, Any]] = []
        if isinstance(effects_payload, list):
            effects = [dict(entry) for entry in effects_payload if isinstance(entry, dict)]

        telemetry_payload = payload.get("telemetry")
        telemetry = dict(telemetry_payload) if isinstance(telemetry_payload, dict) else {}

        return cls(
            id=clean_string(payload.get("id")) or "",
            type=clean_string(payload.get("type")),
            label=clean_string(payload.get("label")),
            default_state=clean_string(payload.get("defaultState")),
            states=states,
            dependencies=dependencies,
            telemetry=telemetry,
            effects=effects,
            notes=clean_string(payload.get("notes")),
            raw=dict(payload),
        )


@dataclass
class UiPanelAlert:
    """Alert definition attached to a panel."""

    id: str
    severity: Optional[str]
    trigger: Dict[str, Any]
    message: Optional[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiPanelAlert":
        trigger_payload = payload.get("trigger")
        trigger = dict(trigger_payload) if isinstance(trigger_payload, dict) else {}
        return cls(
            id=clean_string(payload.get("id")) or "",
            severity=clean_string(payload.get("severity")),
            trigger=trigger,
            message=clean_string(payload.get("message")),
            raw=dict(payload),
        )


@dataclass
class UiPanel:
    """Panel schematic definition consumed by the UI layer."""

    id: str
    name: Optional[str]
    craft: Optional[str]
    layout: Dict[str, Any]
    controls: List[UiPanelControl]
    alerts: List[UiPanelAlert]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiPanel":
        layout_payload = payload.get("layout")
        layout = dict(layout_payload) if isinstance(layout_payload, dict) else {}

        controls_payload = payload.get("controls")
        controls: List[UiPanelControl] = []
        if isinstance(controls_payload, list):
            for entry in controls_payload:
                if isinstance(entry, dict):
                    controls.append(UiPanelControl.from_dict(entry))

        alerts_payload = payload.get("alerts")
        alerts: List[UiPanelAlert] = []
        if isinstance(alerts_payload, list):
            for entry in alerts_payload:
                if isinstance(entry, dict):
                    alerts.append(UiPanelAlert.from_dict(entry))

        return cls(
            id=clean_string(payload.get("id")) or "",
            name=clean_string(payload.get("name")),
            craft=clean_string(payload.get("craft")),
            layout=layout,
            controls=controls,
            alerts=alerts,
            raw=dict(payload),
        )

    def control_map(self) -> Dict[str, UiPanelControl]:
        return {control.id: control for control in self.controls}


@dataclass
class UiPanelPack:
    """Top-level container for panel schematics."""

    version: Optional[int]
    panels: List[UiPanel]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiPanelPack":
        panels_payload = payload.get("panels")
        panels: List[UiPanel] = []
        if isinstance(panels_payload, list):
            for entry in panels_payload:
                if isinstance(entry, dict):
                    panels.append(UiPanel.from_dict(entry))

        return cls(
            version=safe_int(payload.get("version")),
            panels=panels,
            raw=dict(payload),
        )

    def panel_map(self) -> Dict[str, UiPanel]:
        return {panel.id: panel for panel in self.panels}


@dataclass
class UiWorkspaceTile:
    """Tile definition within a workspace preset."""

    id: str
    window: Optional[str]
    x: Optional[float]
    y: Optional[float]
    width: Optional[float]
    height: Optional[float]
    constraints: Dict[str, Any]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiWorkspaceTile":
        constraints_payload = payload.get("constraints")
        constraints = dict(constraints_payload) if isinstance(constraints_payload, dict) else {}
        return cls(
            id=clean_string(payload.get("id")) or "",
            window=clean_string(payload.get("window")),
            x=safe_float(payload.get("x")) if payload.get("x") is not None else None,
            y=safe_float(payload.get("y")) if payload.get("y") is not None else None,
            width=safe_float(payload.get("width")) if payload.get("width") is not None else None,
            height=safe_float(payload.get("height")) if payload.get("height") is not None else None,
            constraints=constraints,
            raw=dict(payload),
        )


@dataclass
class UiWorkspace:
    """Workspace layout preset for tile mode."""

    id: str
    name: Optional[str]
    description: Optional[str]
    viewport: Dict[str, Any]
    tiles: List[UiWorkspaceTile]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiWorkspace":
        viewport_payload = payload.get("viewport")
        viewport = dict(viewport_payload) if isinstance(viewport_payload, dict) else {}

        tiles_payload = payload.get("tiles")
        tiles: List[UiWorkspaceTile] = []
        if isinstance(tiles_payload, list):
            for entry in tiles_payload:
                if isinstance(entry, dict):
                    tiles.append(UiWorkspaceTile.from_dict(entry))

        return cls(
            id=clean_string(payload.get("id")) or "",
            name=clean_string(payload.get("name")),
            description=clean_string(payload.get("description")),
            viewport=viewport,
            tiles=tiles,
            raw=dict(payload),
        )


@dataclass
class UiWorkspacePack:
    """Collection of workspace presets."""

    version: Optional[int]
    presets: List[UiWorkspace]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "UiWorkspacePack":
        presets_payload = payload.get("presets")
        presets: List[UiWorkspace] = []
        if isinstance(presets_payload, list):
            for entry in presets_payload:
                if isinstance(entry, dict):
                    presets.append(UiWorkspace.from_dict(entry))

        return cls(
            version=safe_int(payload.get("version")),
            presets=presets,
            raw=dict(payload),
        )

    def preset_map(self) -> Dict[str, UiWorkspace]:
        return {workspace.id: workspace for workspace in self.presets}


@dataclass
class DockingGate:
    """Single braking gate definition from ``docking_gates.json``."""

    id: str
    label: Optional[str]
    range_meters: Optional[float]
    target_rate_mps: Optional[float]
    tolerance_plus: Optional[float]
    tolerance_minus: Optional[float]
    activation_progress: Optional[float]
    completion_progress: Optional[float]
    checklist_id: Optional[str]
    deadline_get: Optional[str]
    deadline_seconds: Optional[float]
    deadline_offset_seconds: Optional[float]
    notes: Optional[str]
    sources: List[str]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "DockingGate":
        tolerance_payload = payload.get("tolerance") or {}
        tolerance_plus = safe_float(tolerance_payload.get("plus") or tolerance_payload.get("max"))
        tolerance_minus = safe_float(tolerance_payload.get("minus") or tolerance_payload.get("min"))

        activation = safe_float(
            payload.get("activationProgress") or payload.get("activation_progress")
        )
        completion = safe_float(
            payload.get("completionProgress") or payload.get("completion_progress")
        )

        deadline_get = clean_string(payload.get("deadlineGet") or payload.get("deadline_get"))
        deadline_seconds = safe_float(
            payload.get("deadlineSeconds") or payload.get("deadline_seconds")
        )
        if deadline_seconds is None and deadline_get:
            deadline_seconds = parse_get(deadline_get)

        deadline_offset = safe_float(
            payload.get("deadlineOffsetSeconds") or payload.get("deadline_offset_seconds")
        )

        sources: List[str] = []
        raw_sources = payload.get("sources")
        if isinstance(raw_sources, list):
            for entry in raw_sources:
                source_value = clean_string(entry)
                if source_value:
                    sources.append(source_value)

        return cls(
            id=clean_string(payload.get("id")) or "",
            label=clean_string(payload.get("label")),
            range_meters=safe_float(
                payload.get("rangeMeters")
                or payload.get("range_meters")
                or payload.get("range")
            ),
            target_rate_mps=safe_float(
                payload.get("targetRateMps")
                or payload.get("target_rate_mps")
                or payload.get("targetRate")
                or payload.get("target_rate")
            ),
            tolerance_plus=tolerance_plus,
            tolerance_minus=tolerance_minus,
            activation_progress=activation,
            completion_progress=completion,
            checklist_id=clean_string(payload.get("checklistId") or payload.get("checklist_id")),
            deadline_get=deadline_get,
            deadline_seconds=deadline_seconds,
            deadline_offset_seconds=deadline_offset,
            notes=clean_string(payload.get("notes")),
            sources=sources,
            raw=dict(payload),
        )


@dataclass
class DockingGateConfig:
    """Normalized docking overlay configuration."""

    version: Optional[int]
    event_id: Optional[str]
    start_range_meters: Optional[float]
    end_range_meters: Optional[float]
    notes: Optional[str]
    gates: List[DockingGate]
    raw: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "DockingGateConfig":
        gates_payload = payload.get("gates")
        gates: List[DockingGate] = []
        if isinstance(gates_payload, list):
            for entry in gates_payload:
                if isinstance(entry, dict):
                    gates.append(DockingGate.from_dict(entry))

        return cls(
            version=safe_int(payload.get("version")),
            event_id=clean_string(payload.get("eventId") or payload.get("event_id")),
            start_range_meters=safe_float(
                payload.get("startRangeMeters")
                or payload.get("start_range_meters")
                or payload.get("startRange")
            ),
            end_range_meters=safe_float(
                payload.get("endRangeMeters")
                or payload.get("end_range_meters")
                or payload.get("endRange")
            ),
            notes=clean_string(payload.get("notes")),
            gates=gates,
            raw=dict(payload),
        )

    def gate_map(self) -> Dict[str, DockingGate]:
        return {gate.id: gate for gate in self.gates}


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
    ui_checklists: Optional[UiChecklistPack] = None
    ui_panels: Optional[UiPanelPack] = None
    ui_workspaces: Optional[UiWorkspacePack] = None
    docking_gates: Optional[DockingGateConfig] = None

    def event_map(self) -> Dict[str, EventRecord]:
        return {event.id: event for event in self.events}

    def checklist_index(self) -> Dict[str, List[ChecklistEntry]]:
        index: Dict[str, List[ChecklistEntry]] = {}
        for entry in self.checklists:
            index.setdefault(entry.checklist_id, []).append(entry)
        return index

    def autopilot_map(self) -> Dict[str, AutopilotRecord]:
        return {auto.id: auto for auto in self.autopilots}

    def ui_panel_map(self) -> Dict[str, UiPanel]:
        if not self.ui_panels:
            return {}
        return self.ui_panels.panel_map()

    def ui_checklist_map(self) -> Dict[str, UiChecklist]:
        if not self.ui_checklists:
            return {}
        return self.ui_checklists.checklist_map()
