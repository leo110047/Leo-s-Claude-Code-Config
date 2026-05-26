#!/usr/bin/env python3
"""Move local Codex execpolicy approvals out of the tracked baseline."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


LOCAL_HEADER = """# Machine-local Codex execpolicy rules.
# This file is ignored by git and is linked alongside portable rules.

"""

ALLOW_RULE_RE = re.compile(r'decision\s*=\s*"allow"')


def is_local_approval_line(line: str) -> bool:
    stripped = line.strip()
    return (
        stripped.startswith("prefix_rule(")
        and stripped.endswith(")")
        and ALLOW_RULE_RE.search(stripped) is not None
        and "justification" not in stripped
    )


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(lines), encoding="utf-8")


def collect_existing_local_rules(local_rules: Path) -> set[str]:
    existing_rules: set[str] = set()
    if not local_rules.parent.exists():
        return existing_rules

    for rules_file in sorted(local_rules.parent.glob("*.rules")):
        for line in read_lines(rules_file):
            stripped = line.strip()
            if stripped.startswith("prefix_rule("):
                existing_rules.add(stripped)

    return existing_rules


def migrate(base_rules: Path, local_rules: Path, dry_run: bool) -> int:
    base_lines = read_lines(base_rules)
    kept: list[str] = []
    moved: list[str] = []

    for line in base_lines:
        if is_local_approval_line(line):
            moved.append(line)
        else:
            kept.append(line)

    if not moved:
        print("[OK] no local Codex approvals found in tracked baseline")
        return 0

    existing_text = local_rules.read_text(encoding="utf-8") if local_rules.exists() else ""
    existing_lines = existing_text.splitlines(keepends=True)
    existing_rules = collect_existing_local_rules(local_rules)

    unique_moved = [line for line in moved if line.strip() not in existing_rules]
    skipped = len(moved) - len(unique_moved)

    print(f"[INFO] found {len(moved)} local approval rule(s) in {base_rules}")
    if skipped:
        print(f"[INFO] {skipped} rule(s) already exist in {local_rules.parent}")
    print(f"[INFO] moving {len(unique_moved)} new rule(s) to {local_rules}")

    if dry_run:
        print("[DRY-RUN] no files changed")
        return 0

    write_lines(base_rules, kept)

    if existing_text:
        new_local_lines = existing_lines
        if new_local_lines and not new_local_lines[-1].endswith("\n"):
            new_local_lines[-1] += "\n"
        if new_local_lines and "".join(new_local_lines[-2:]).strip():
            new_local_lines.append("\n")
    else:
        new_local_lines = [LOCAL_HEADER]

    new_local_lines.extend(unique_moved)
    write_lines(local_rules, new_local_lines)

    print("[OK] moved local approvals out of tracked Codex baseline")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-rules", type=Path, required=True)
    parser.add_argument("--local-rules", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.base_rules.exists():
        parser.error(f"base rules file does not exist: {args.base_rules}")

    return migrate(args.base_rules, args.local_rules, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
