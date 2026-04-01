#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HOOKS_JSON = ROOT / "hooks" / "hooks.json"


def iter_script_paths(data: dict):
    hooks = data.get("hooks", {})
    pattern = re.compile(r'node\s+"([^"]+)"')

    for phase, entries in hooks.items():
        for entry in entries:
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                if not isinstance(command, str):
                    continue
                match = pattern.search(command)
                if not match:
                    continue
                raw_path = match.group(1).replace("${HOOKS_DIR}", "hooks")
                yield phase, raw_path


def main() -> int:
    with HOOKS_JSON.open() as fh:
        data = json.load(fh)

    errors = 0
    for phase, rel_path in iter_script_paths(data):
        path = ROOT / rel_path
        if path.exists():
            print(f"[OK] {phase}: {rel_path}")
        else:
            print(f"[FAIL] {phase}: {rel_path} not found")
            errors += 1

    if errors:
        print(f"::error::{errors} hook script reference(s) missing")
        return 1

    print("[OK] hook script references verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
