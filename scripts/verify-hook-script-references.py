#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HOOK_FILES = [
    ROOT / "hooks" / "hooks.json",
    ROOT / "codex" / "hooks.json",
]
HOOK_ENTRYPOINT_DIRS = [
    ROOT / "hooks" / "scripts" / "hooks",
]


def iter_script_paths(data: dict, hook_file: Path):
    hooks = data.get("hooks", {})
    pattern = re.compile(r'node\s+"([^"]+)"')

    for phase, entries in hooks.items():
        for entry in entries:
            for hook in entry.get("hooks", []):
                for command_key in ("command", "commandWindows"):
                    command = hook.get(command_key, "")
                    if not isinstance(command, str):
                        continue
                    match = pattern.search(command)
                    if not match:
                        continue
                    raw_path = match.group(1)
                    raw_path = raw_path.replace("${HOOKS_DIR}", "hooks")
                    raw_path = raw_path.replace("$HOME/.codex", "codex")
                    raw_path = raw_path.replace("~/.codex", "codex")
                    raw_path = raw_path.replace("$env:USERPROFILE\\.codex", "codex")
                    raw_path = raw_path.replace("%USERPROFILE%\\.codex", "codex")
                    raw_path = raw_path.replace("\\", "/")
                    if raw_path.startswith("/"):
                        continue
                    yield phase, raw_path


def iter_hook_entrypoints():
    for entrypoint_dir in HOOK_ENTRYPOINT_DIRS:
        if not entrypoint_dir.exists():
            continue
        for path in sorted(entrypoint_dir.glob("*.js")):
            yield path.relative_to(ROOT).as_posix()


def main() -> int:
    errors = 0
    referenced_paths = set()
    for hook_file in HOOK_FILES:
        with hook_file.open(encoding="utf-8") as fh:
            data = json.load(fh)

        rel_hook_file = hook_file.relative_to(ROOT)
        for phase, rel_path in iter_script_paths(data, hook_file):
            referenced_paths.add(rel_path)
            path = ROOT / rel_path
            if path.exists():
                print(f"[OK] {rel_hook_file} {phase}: {rel_path}")
            else:
                print(f"[FAIL] {rel_hook_file} {phase}: {rel_path} not found")
                errors += 1

    for rel_path in iter_hook_entrypoints():
        if rel_path not in referenced_paths:
            print(f"[FAIL] orphan hook script: {rel_path} is not referenced by hooks config")
            errors += 1

    if errors:
        print(f"::error::{errors} hook script reference issue(s)")
        return 1

    print("[OK] hook script references verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
