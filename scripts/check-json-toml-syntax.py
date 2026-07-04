#!/usr/bin/env python3
import json
import subprocess
import sys
import tomllib
from pathlib import Path


def main() -> int:
    root = repo_root()
    failures = []
    for file_path in repo_files(root):
        if file_path.suffix == ".json":
            check_json(file_path, failures)
        if file_path.suffix == ".toml":
            check_toml(file_path, failures)

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("[OK] JSON/TOML syntax checks passed")
    return 0


def repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip())


def repo_files(root: Path) -> list[Path]:
    result = subprocess.run(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "*.json",
            "*.toml",
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return [root / line for line in result.stdout.splitlines() if line]


def check_json(file_path: Path, failures: list[str]) -> None:
    try:
        json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as exc:
        failures.append(f"{file_path}: invalid JSON: {exc}")


def check_toml(file_path: Path, failures: list[str]) -> None:
    try:
        tomllib.loads(file_path.read_text(encoding="utf-8"))
    except Exception as exc:
        failures.append(f"{file_path}: invalid TOML: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
