"""Helpers for emitting provenance tables."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional

from .utils import clean_string


@dataclass
class ProvenanceEntry:
    dataset: str
    row_range: str
    source: str
    notes: Optional[str] = None


@dataclass
class ProvenanceBuilder:
    """Collect provenance entries and emit Markdown tables."""

    entries: List[ProvenanceEntry] = field(default_factory=list)

    def add(self, dataset: str, row_range: str, source: str, *, notes: Optional[str] = None) -> None:
        self.entries.append(
            ProvenanceEntry(
                dataset=dataset,
                row_range=row_range,
                source=source,
                notes=notes,
            )
        )

    def extend(self, entries: Iterable[ProvenanceEntry]) -> None:
        for entry in entries:
            self.entries.append(entry)

    def clear(self) -> None:
        self.entries.clear()

    def to_markdown(self) -> str:
        lines = ["| Dataset | Rows | Source | Notes |", "| --- | --- | --- | --- |"]
        for entry in self.entries:
            dataset = entry.dataset.replace("|", "\|")
            row_range = entry.row_range.replace("|", "\|")
            source = entry.source.replace("|", "\|")
            notes = (entry.notes or "").replace("|", "\|")
            lines.append(f"| {dataset} | {row_range} | {source} | {notes} |")
        return "\n".join(lines)

    def write(self, path: Path, *, heading: Optional[str] = None) -> None:
        path = Path(path)
        content = self.to_markdown()
        if heading:
            heading_line = clean_string(heading)
            if heading_line:
                content = f"{heading_line}\n\n{content}"
        path.write_text(content + "\n", encoding="utf-8")
