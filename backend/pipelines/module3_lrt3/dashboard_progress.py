"""Record and verify the local Step 5 implementation checkpoints."""

import argparse
import json
import os

from run_equity import OUTPUT, ROOT, load, now, sha
from run_network_equity import git_outside


FRONTEND = ROOT / "frontend/src/modules/module3_drivers_forecast"


def folder():
    return sorted((OUTPUT / "step5_recovery").glob("*/baseline.json"))[-1].parent


def verify_preservation():
    checkpoint = load(folder() / "baseline.json")
    for relative, expected in checkpoint["protected_backend"].items():
        if sha(ROOT / relative) != expected:
            raise ValueError(f"Protected artifact checksum changed: {relative}")
    outside = {key: value for key, value in git_outside().items() if not key.startswith(FRONTEND.relative_to(ROOT).as_posix() + "/")}
    if outside != checkpoint["outside_git_before"]:
        raise ValueError("Git status or existing changes outside the authorized Module 3 directories differ")
    return len(checkpoint["protected_backend"])


def record(stage, paths=(), **details):
    hashes = {p.relative_to(ROOT).as_posix(): sha(p) for p in paths}
    event = {"checkpoint": stage, "time": now().isoformat(), "files": hashes, **details}
    with (folder() / "progress.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage")
    parser.add_argument("files", nargs="*")
    args = parser.parse_args()
    if args.stage == "verify_preservation":
        count = verify_preservation()
        record(args.stage, protected_backend_files=count)
        print(f"{count} protected backend hashes and outside Git baseline matched")
    else:
        record(args.stage, [FRONTEND / name for name in args.files])
