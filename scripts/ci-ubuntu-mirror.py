#!/usr/bin/env python3
"""Use Ubuntu's HTTPS archive for the runner's Azure mirror entries only."""

from pathlib import Path
import re


AZURE_URI = re.compile(r"(?<!\S)https?://azure\.archive\.ubuntu\.com/ubuntu/?(?=\s|$)")
ARCHIVE_URI = "https://archive.ubuntu.com/ubuntu"


def rewrite_source(content: str, suffix: str) -> tuple[str, int]:
    if suffix not in {".list", ".sources"}:
        raise ValueError("Unsupported APT source format")
    output = []
    replacements = 0
    uris_field = False
    for line in content.splitlines(keepends=True):
        if not line.strip():
            uris_field = False
        if line.lstrip().startswith("#"):
            output.append(line)
            continue
        if suffix == ".list":
            entry = re.match(r"^[ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?(\S+)", line)
            if entry and AZURE_URI.fullmatch(entry.group(1)):
                line = line[:entry.start(1)] + ARCHIVE_URI + line[entry.end(1):]
                replacements += 1
        else:
            if line and not line[0].isspace():
                header = re.match(r"(?i)^URIs:", line)
                uris_field = header is not None
                value_start = header.end() if header else 0
            else:
                value_start = 0
            if uris_field:
                value, count = AZURE_URI.subn(ARCHIVE_URI, line[value_start:])
                line = line[:value_start] + value
                replacements += count
        output.append(line)
    return "".join(output), replacements


def plan_sources(directory: Path) -> list[tuple[Path, str, int]]:
    if not directory.is_dir():
        raise ValueError("APT configuration directory is missing")
    candidates = [directory / "sources.list"]
    for suffix in ("*.list", "*.sources"):
        candidates.extend(sorted((directory / "sources.list.d").glob(suffix)))
    planned = []
    for path in candidates:
        if path.is_symlink():
            raise ValueError(f"APT source must not be a symlink: {path.name}")
        if not path.exists():
            continue
        if not path.is_file():
            raise ValueError(f"APT source must be an ordinary file: {path.name}")
        content, count = rewrite_source(path.read_bytes().decode("utf-8"), path.suffix)
        if count:
            planned.append((path, content, count))
    return planned


if __name__ == "__main__":
    # Plan every edit first. Suites, components, keys, and other providers stay intact.
    planned = plan_sources(Path("/etc/apt"))
    for path, content, count in planned:
        path.write_bytes(content.encode("utf-8"))
        print(f"{path.name}: switched {count} Azure mirror URI(s) to {ARCHIVE_URI}")
    print(f"Updated {len(planned)} APT source file(s); signature verification is unchanged.")
