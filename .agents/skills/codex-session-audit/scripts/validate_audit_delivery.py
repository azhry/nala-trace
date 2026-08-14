#!/usr/bin/env python3
"""Validate that a complete audit is delivered in a PR body, not the repository."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

from validate_audit_report import validate


REPORT_HEADING_RE = re.compile(r"^## Complete audit report\s*$", re.MULTILINE)
REPO_REPORT_PATH_RE = re.compile(r"(?<![\w/-])(?:\./)?audit/[^\s)`]+\.md\b", re.IGNORECASE)


def read_body(path: Path) -> str:
    if path == Path("-"):
        return sys.stdin.read()
    return path.read_text(encoding="utf-8")


def tracked_audit_reports(repo_root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "--", "audit/*.md"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git ls-files failed")
    return [line for line in result.stdout.splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr-body", required=True, type=Path, help="saved PR body Markdown, or '-' for stdin")
    parser.add_argument("--repo-root", required=True, type=Path, help="repository root to inspect for tracked audit reports")
    args = parser.parse_args()

    try:
        body = read_body(args.pr_body)
        errors = validate(body)
        report_heading = REPORT_HEADING_RE.search(body)
        if not report_heading:
            errors.append("PR body is missing the exact '## Complete audit report' heading")
        elif REPO_REPORT_PATH_RE.search(body[: report_heading.start()]):
            errors.append("PR body preamble references a repository audit Markdown path; include the report text instead")
        tracked = tracked_audit_reports(args.repo_root)
        if tracked:
            errors.append("repository tracks audit report file(s): " + ", ".join(tracked))
    except (OSError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1

    print("PASS: PR body contains the complete audit and repository tracks no audit/*.md report")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
