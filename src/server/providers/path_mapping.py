"""Cross-platform host/container path helpers.

My Virtual World runs inside a Linux container even when Docker Desktop runs
on Windows.  Host paths must therefore be interpreted with the host's path
rules before they are mapped into the container filesystem.
"""

from __future__ import annotations

import ntpath
import os
import posixpath
import re
from typing import Iterable


_WINDOWS_DRIVE_ABS = re.compile(r"^[A-Za-z]:[\\/]")


def is_windows_absolute(path: str | None) -> bool:
    text = str(path or "").strip()
    return bool(_WINDOWS_DRIVE_ABS.match(text) or text.startswith("\\\\") or text.startswith("//"))


def normalize_host_path(path: str | None) -> str:
    text = str(path or "").strip()
    if not text:
        return ""
    if is_windows_absolute(text):
        return ntpath.normpath(text)
    return os.path.abspath(os.path.expanduser(text))


def join_host_path(root: str | None, *parts: str) -> str:
    base = str(root or "").strip()
    if is_windows_absolute(base):
        return ntpath.normpath(ntpath.join(base, *parts))
    return os.path.normpath(os.path.join(os.path.expanduser(base), *parts))


def _safe_relative(relative: str, module) -> str:
    normalized = module.normpath(str(relative or ""))
    if normalized in ("", "."):
        return ""
    if normalized == module.pardir or normalized.startswith(module.pardir + module.sep):
        return ""
    if module is ntpath and ntpath.splitdrive(normalized)[0]:
        return ""
    parts = [part for part in re.split(r"[\\/]", normalized) if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        return ""
    return posixpath.join(*parts)


def _relative_to_host_root(path: str, host_root: str | None) -> str:
    root = str(host_root or "").strip()
    if not root:
        return ""
    if is_windows_absolute(path) and is_windows_absolute(root):
        try:
            if ntpath.normcase(ntpath.normpath(path)) == ntpath.normcase(ntpath.normpath(root)):
                return "."
            path_drive = ntpath.splitdrive(path)[0].lower()
            root_drive = ntpath.splitdrive(root)[0].lower()
            if path_drive != root_drive:
                return ""
            return _safe_relative(ntpath.relpath(ntpath.normpath(path), ntpath.normpath(root)), ntpath)
        except ValueError:
            return ""
    if not is_windows_absolute(path) and not is_windows_absolute(root):
        try:
            if os.path.abspath(path) == os.path.abspath(root):
                return "."
            return _safe_relative(os.path.relpath(os.path.abspath(path), os.path.abspath(root)), os.path)
        except ValueError:
            return ""
    return ""


def _relative_after_marker(path: str, markers: Iterable[str]) -> str:
    parts = [part for part in re.split(r"[\\/]", str(path or "")) if part]
    lowered = [part.lower() for part in parts]
    wanted = {str(marker).lower() for marker in markers}
    indexes = [index for index, part in enumerate(lowered) if part in wanted]
    if not indexes:
        return ""
    suffix = parts[indexes[-1] + 1:]
    if not suffix or any(part in (".", "..") for part in suffix):
        return ""
    return posixpath.join(*suffix)


def map_host_path_to_container(
    path: str | None,
    *,
    host_root: str | None,
    container_root: str,
    markers: Iterable[str] = (".openclaw",),
) -> str:
    """Map a host-visible path to its mounted Linux container path.

    Unmappable Windows paths return an empty string.  They must never be fed
    to POSIX ``abspath`` because that produces malformed paths such as
    ``/app/C:\\Users\\...``.
    """
    raw = str(path or "").strip()
    if not raw:
        return ""
    container = os.path.abspath(os.path.expanduser(str(container_root or "/")))

    if not is_windows_absolute(raw):
        normalized = os.path.abspath(os.path.expanduser(raw))
        if normalized == container or normalized.startswith(container + os.sep):
            return normalized
        relative = _relative_to_host_root(normalized, host_root)
        if relative:
            return os.path.abspath(os.path.join(container, relative))
        # A POSIX path may refer to another explicitly mounted provider root.
        return normalized

    relative = _relative_to_host_root(raw, host_root)
    if relative == ".":
        return container
    if not relative:
        relative = _relative_after_marker(raw, markers)
    if not relative:
        return ""
    return os.path.abspath(os.path.join(container, *relative.split("/")))


def infer_openclaw_host_home(configured_agents: Iterable[dict]) -> str:
    """Infer a host OpenClaw home from configured agent workspace paths."""
    rows = [row for row in configured_agents if isinstance(row, dict)]
    rows.sort(key=lambda row: 0 if str(row.get("id") or "") == "main" else 1)
    for row in rows:
        workspace = str(row.get("workspace") or "").strip()
        if not workspace:
            continue
        if is_windows_absolute(workspace):
            normalized = ntpath.normpath(workspace)
            cursor = normalized
            while cursor and ntpath.dirname(cursor) != cursor:
                if ntpath.basename(cursor).lower() == ".openclaw":
                    return cursor
                cursor = ntpath.dirname(cursor)
            basename = ntpath.basename(normalized)
            if basename == "workspace" or basename.startswith("workspace-"):
                return ntpath.dirname(normalized)
        elif os.path.isabs(workspace):
            basename = os.path.basename(os.path.normpath(workspace))
            if basename == "workspace" or basename.startswith("workspace-"):
                return os.path.dirname(os.path.normpath(workspace))
    return ""
