"""Shared safety helpers for provider-owned profile file mutations."""

from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def backup_files(workspace: str, paths: Iterable[str]) -> tuple[str, list[str]]:
    """Copy existing provider files into a workspace-local revision directory."""
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    root = os.path.join(os.path.abspath(workspace), ".vw-provider-backups", backup_id)
    copied: list[str] = []
    for index, raw_path in enumerate(paths):
        path = os.path.abspath(os.path.expanduser(str(raw_path or "")))
        if not os.path.isfile(path):
            continue
        safe_name = f"{index:02d}-{Path(path).name}"
        target = os.path.join(root, safe_name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(path, target)
        copied.append(target)
    return (backup_id if copied else ""), copied
