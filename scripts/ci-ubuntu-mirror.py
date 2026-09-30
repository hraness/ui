#!/usr/bin/env python3
"""Use Ubuntu's HTTPS archive for the runner's Azure mirror entries only."""

from pathlib import Path
import re


AZURE_URI = re.compile(r"(?<!\S)https?://azure\.archive\.ubuntu\.com/ubuntu/?(?=\s|$)")
ARCHIVE_URI = "https://archive.ubuntu.com/ubuntu"
RUNNER_MIRROR_URI = "mirror+file:/etc/apt/apt-mirrors.txt"


def stanza_disabled(values: list[str]) -> bool:
    # APT uses StringToBool: these words and C base-0 numeric zeros are false.
    value = " ".join(values).lower()
    return value in {"no", "false", "without", "off", "disable"} or re.fullmatch(r"[+-]?(?:0+|0x0+)", value) is not None


def source_uri_spans(content: str, suffix: str) -> list[tuple[int, int]]:
    """Locate enabled URI values without treating options or comments as URIs."""
    if suffix not in {".list", ".sources"}:
        raise ValueError("Unsupported APT source format")
    spans = []
    stanza_spans = []
    enabled_values = []
    field = None
    offset = 0
    for line in content.splitlines(keepends=True):
        if not line.strip():
            if not stanza_disabled(enabled_values):
                spans.extend(stanza_spans)
            stanza_spans = []
            enabled_values = []
            field = None
        elif line.lstrip().startswith("#"):
            pass
        elif suffix == ".list":
            entry = re.match(r"^[ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?(\S+)", line)
            if entry:
                spans.append((offset + entry.start(1), offset + entry.end(1)))
        else:
            if line and not line[0].isspace():
                header = re.match(r"^([^:\s]+):", line)
                field = header.group(1).lower() if header else None
                value_start = header.end() if header else 0
            else:
                value_start = 0
            if field in {"uris", "enabled"}:
                for value in re.finditer(r"\S+", line[value_start:]):
                    if value.group().startswith("#"):
                        break
                    if field == "uris":
                        stanza_spans.append((offset + value_start + value.start(), offset + value_start + value.end()))
                    else:
                        enabled_values.append(value.group())
        offset += len(line)
    if not stanza_disabled(enabled_values):
        spans.extend(stanza_spans)
    return spans


def rewrite_source(content: str, suffix: str) -> tuple[str, int]:
    spans = [(start, end) for start, end in source_uri_spans(content, suffix) if AZURE_URI.fullmatch(content[start:end])]
    for start, end in reversed(spans):
        content = content[:start] + ARCHIVE_URI + content[end:]
    return content, len(spans)


def rewrite_mirror_list(content: str) -> tuple[str, int]:
    output = []
    replacements = 0
    for line in content.splitlines(keepends=True):
        entry = re.match(r"^[ \t]*(\S+)", line)
        if entry and AZURE_URI.fullmatch(entry.group(1)):
            uri = ARCHIVE_URI + ("/" if entry.group(1).endswith("/") else "")
            line = line[:entry.start(1)] + uri + line[entry.end(1):]
            replacements += 1
        output.append(line)
    return "".join(output), replacements


def read_apt_file(path: Path, required: bool = False) -> str | None:
    if path.is_symlink():
        raise ValueError(f"APT configuration must not be a symlink: {path.name}")
    if not path.exists() and not required:
        return None
    if not path.is_file():
        raise ValueError(f"APT configuration must be an ordinary file: {path.name}")
    return path.read_bytes().decode("utf-8")


def plan_sources(directory: Path) -> list[tuple[Path, str, int]]:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("APT configuration must be an ordinary directory")
    source_directory = directory / "sources.list.d"
    if source_directory.is_symlink() or (source_directory.exists() and not source_directory.is_dir()):
        raise ValueError("APT source directory must be an ordinary directory")
    candidates = [directory / "sources.list"]
    for suffix in ("*.list", "*.sources"):
        candidates.extend(sorted(source_directory.glob(suffix)))
    planned = []
    runner_mirror_referenced = False
    for path in candidates:
        original = read_apt_file(path)
        if original is None:
            continue
        runner_mirror_referenced |= any(original[start:end] == RUNNER_MIRROR_URI for start, end in source_uri_spans(original, path.suffix))
        content, count = rewrite_source(original, path.suffix)
        if count:
            planned.append((path, content, count))
    if runner_mirror_referenced:
        # Only this runner-owned path is supported. Never follow arbitrary file URIs.
        path = directory / "apt-mirrors.txt"
        content, count = rewrite_mirror_list(read_apt_file(path, required=True))
        if count:
            planned.append((path, content, count))
    return planned


if __name__ == "__main__":
    # Plan every edit first. Suites, components, keys, and other providers stay intact.
    planned = plan_sources(Path("/etc/apt"))
    for path, content, count in planned:
        path.write_bytes(content.encode("utf-8"))
        print(f"{path.name}: switched {count} Azure mirror URI(s) to {ARCHIVE_URI}")
    print(f"Updated {len(planned)} APT source or mirror file(s); signature verification is unchanged.")
