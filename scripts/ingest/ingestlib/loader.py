"""File loaders for the committed mission datasets."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List

from .records import (
    AutopilotRecord,
    AudioCuePack,
    ChecklistEntry,
    EventRecord,
    FailureRecord,
    MissionData,
    PadRecord,
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


def load_mission_data(data_dir: Path) -> MissionData:
    base = Path(data_dir).resolve()
    events = load_events(base / _DATA_FILES["events"])
    checklists = load_checklists(base / _DATA_FILES["checklists"])
    autopilots = load_autopilots(base / _DATA_FILES["autopilots"], base)
    pads = load_pads(base / _DATA_FILES["pads"])
    failures = load_failures(base / _DATA_FILES["failures"])

    consumables = _read_json(base / _DATA_FILES["consumables"])
    communications = _read_json(base / _DATA_FILES["communications"])
    thrusters = _read_json(base / _DATA_FILES["thrusters"])
    audio_cues = load_audio_cues(base / _DATA_FILES["audio_cues"])

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
    )


def available_datasets() -> Iterable[str]:
    """Return the dataset keys known to the loader."""

    return tuple(_DATA_FILES.keys())


__all__ = [
    "load_events",
    "load_checklists",
    "load_autopilots",
    "load_pads",
    "load_failures",
    "load_audio_cues",
    "load_mission_data",
    "available_datasets",
]
