"""File loaders for the committed mission datasets."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .records import (
    AutopilotRecord,
    AudioCuePack,
    ChecklistEntry,
    DockingGateConfig,
    EventRecord,
    FailureRecord,
    MissionData,
    PadRecord,
    UiChecklistPack,
    UiDskyMacroPack,
    UiPanelPack,
    UiWorkspacePack,
)

_DATA_FILES = {
    "events": "events.csv",
    "checklists": "checklists.csv",
    "autopilots": "autopilots.csv",
    "pads": "pads.csv",
    "failures": "failures.csv",
    "consumables": "consumables.json",
    "communications": "communications_trends.json",
    "thrusters": "thrusters.json",
    "audio_cues": "audio_cues.json",
}

_UI_FILES = {
    "ui_checklists": "checklists.json",
    "ui_panels": "panels.json",
    "ui_workspaces": "workspaces.json",
    "docking_gates": "docking_gates.json",
    "ui_dsky_macros": "dsky_macros.json",
}


def _read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, escapechar='\\')
        return [dict(row) for row in reader]


def _read_json(path: Path) -> Dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_events(path: Path) -> List[EventRecord]:
    return [EventRecord.from_row(row) for row in _read_csv(path)]


def load_checklists(path: Path) -> List[ChecklistEntry]:
    return [ChecklistEntry.from_row(row) for row in _read_csv(path)]


def load_autopilots(path: Path, data_dir: Path) -> List[AutopilotRecord]:
    return [AutopilotRecord.from_row(row, data_dir) for row in _read_csv(path)]


def load_pads(path: Path) -> List[PadRecord]:
    return [PadRecord.from_row(row) for row in _read_csv(path)]


def load_failures(path: Path) -> List[FailureRecord]:
    return [FailureRecord.from_row(row) for row in _read_csv(path)]


def load_audio_cues(path: Path) -> AudioCuePack:
    return AudioCuePack.from_dict(_read_json(path))


def load_docking_gates(path: Path) -> Optional[DockingGateConfig]:
    if not path.is_file():
        return None
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return None
    return DockingGateConfig.from_dict(payload)


def load_mission_data(data_dir: Path, ui_dir: Optional[Path] = None) -> MissionData:
    base = Path(data_dir).resolve()
    ui_base = Path(ui_dir).resolve() if ui_dir is not None else base.parent / "ui"

    events = load_events(base / _DATA_FILES["events"])
    checklists = load_checklists(base / _DATA_FILES["checklists"])
    autopilots = load_autopilots(base / _DATA_FILES["autopilots"], base)
    pads = load_pads(base / _DATA_FILES["pads"])
    failures = load_failures(base / _DATA_FILES["failures"])

    consumables = _read_json(base / _DATA_FILES["consumables"])
    communications = _read_json(base / _DATA_FILES["communications"])
    thrusters = _read_json(base / _DATA_FILES["thrusters"])
    audio_cues = load_audio_cues(base / _DATA_FILES["audio_cues"])

    ui_checklists = load_ui_checklists(ui_base / _UI_FILES["ui_checklists"])
    ui_panels = load_ui_panels(ui_base / _UI_FILES["ui_panels"])
    ui_workspaces = load_ui_workspaces(ui_base / _UI_FILES["ui_workspaces"])
    ui_dsky_macros = load_ui_dsky_macros(ui_base / _UI_FILES["ui_dsky_macros"])
    docking_gates = load_docking_gates(ui_base / _UI_FILES["docking_gates"])

    return MissionData(
        events=events,
        checklists=checklists,
        autopilots=autopilots,
        pads=pads,
        failures=failures,
        consumables=consumables,
        communications=communications,
        thrusters=thrusters,
        audio_cues=audio_cues,
        ui_checklists=ui_checklists,
        ui_panels=ui_panels,
        ui_workspaces=ui_workspaces,
        ui_dsky_macros=ui_dsky_macros,
        docking_gates=docking_gates,
    )


def available_datasets() -> Iterable[str]:
    """Return the dataset keys known to the loader."""

    return tuple({**_DATA_FILES, **_UI_FILES}.keys())


def load_ui_checklists(path: Path) -> Optional[UiChecklistPack]:
    if not path.is_file():
        return None
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return None
    return UiChecklistPack.from_dict(payload)


def load_ui_panels(path: Path) -> Optional[UiPanelPack]:
    if not path.is_file():
        return None
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return None
    return UiPanelPack.from_dict(payload)


def load_ui_workspaces(path: Path) -> Optional[UiWorkspacePack]:
    if not path.is_file():
        return None
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return None
    return UiWorkspacePack.from_dict(payload)


def load_ui_dsky_macros(path: Path) -> Optional[UiDskyMacroPack]:
    if not path.is_file():
        return None
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return None
    return UiDskyMacroPack.from_dict(payload)


__all__ = [
    "load_events",
    "load_checklists",
    "load_autopilots",
    "load_pads",
    "load_failures",
    "load_audio_cues",
    "load_docking_gates",
    "load_mission_data",
    "load_ui_checklists",
    "load_ui_panels",
    "load_ui_workspaces",
    "load_ui_dsky_macros",
    "available_datasets",
]
