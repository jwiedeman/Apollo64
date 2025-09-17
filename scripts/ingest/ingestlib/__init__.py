"""Utility helpers for Apollo 11 mission dataset ingestion notebooks.

This lightweight package exposes the shared helpers referenced in
``docs/data/INGESTION_PIPELINE.md`` so that notebooks and future
headless scripts can normalize GET timestamps, parse the committed CSV
packs, and emit provenance tables without duplicating boilerplate.
"""

from . import time
from .loader import load_mission_data
from .provenance import ProvenanceBuilder
from .records import (
    AutopilotRecord,
    ChecklistEntry,
    EventRecord,
    FailureRecord,
    MissionData,
    PadRecord,
)
from .validation import ValidationIssue, validate_mission_data

__all__ = [
    "time",
    "load_mission_data",
    "ProvenanceBuilder",
    "AutopilotRecord",
    "ChecklistEntry",
    "EventRecord",
    "FailureRecord",
    "MissionData",
    "PadRecord",
    "ValidationIssue",
    "validate_mission_data",
]
