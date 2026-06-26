"""End-to-end CLI tests for the installed ``lens-qda`` package.

These tests invoke the console-script entry point (``lens-qda``) via
subprocess so the actual ``argparse`` parsing, ``sys.stdout``/``sys.stderr``
routing, JSON envelope shape, and exit-code contract are exercised exactly
as ``pip install lens-qda`` users hit them — not merely as in-process
Python function calls (which is what the round-5 release.yml smoke-test
heredoc already does; this pytest suite is the durable, PR-blocking
equivalent that will catch a future regression on push, not only on
release-time tag push).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Callable

import pytest


def test_cli_top_level_help_lists_subcommands(
    cli_runner: Callable[..., subprocess.CompletedProcess],
) -> None:
    """``lens-qda --help`` exits 0 and mentions both subcommands."""
    result = cli_runner("--help")
    assert result.returncode == 0, (
        f"lens-qda --help exit code = {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert "extract" in result.stdout, f"--help stdout missing 'extract':\n{result.stdout}"
    assert "version" in result.stdout, f"--help stdout missing 'version':\n{result.stdout}"


def test_cli_version_to_file_writes_string(
    cli_runner: Callable[..., subprocess.CompletedProcess],
    tmp_path: Path,
) -> None:
    """``lens-qda version -o <path>`` writes the literal version string."""
    out = tmp_path / "v.txt"
    result = cli_runner("version", "-o", str(out))
    assert result.returncode == 0, (
        f"lens-qda version -o exit code = {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    written = out.read_text(encoding="utf-8")
    assert written.strip(), f"Expected non-empty version, got: {written!r}"
    assert written.endswith("\n"), "version writer must terminate with a newline"


def test_cli_extract_missing_file_emits_error_envelope(
    cli_runner: Callable[..., subprocess.CompletedProcess],
) -> None:
    """Missing file → exit 1 + ``{"success": false, "error": "..."}`` JSON."""
    result = cli_runner(
        "extract", "/does/not/exist/lens-qda-test.pdf", "--json"
    )
    assert result.returncode == 1, (
        f"Expected exit 1 for missing file, got {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    envelope = json.loads(result.stdout)
    assert envelope["success"] is False
    assert isinstance(envelope.get("error"), str) and envelope["error"]
    # Match either phrasing (file-not-found or not-a-regular-file).
    low = envelope["error"].lower()
    assert (
        "not found" in low or "no such" in low or "not a regular file" in low
    ), envelope


def test_cli_extract_happy_path(
    cli_runner: Callable[..., subprocess.CompletedProcess],
    fixture_pdf: Path,
) -> None:
    """Synthetic 2-page PDF → exit 0 + ``{"success": true, "text": "..."}``.

    Locks in pdfplumber's x_tolerance=3 / y_tolerance=3 round-trip AND the
    {text|error} JSON envelope shape that the LENS Rust sidecar also
    consumes. The two per-page markers must BOTH appear in the joined text
    — proves the per-page join-into-blank-lines glue in
    ``lens_qda.extract_text`` works.
    """
    result = cli_runner("extract", str(fixture_pdf), "--json")
    assert result.returncode == 0, (
        f"Expected exit 0 for valid PDF, got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    envelope = json.loads(result.stdout)
    assert envelope["success"] is True
    text = envelope["text"]
    assert "Page One Marker Token" in text, f"page 1 marker missing:\n{text}"
    assert "Page Two Marker Token" in text, f"page 2 marker missing:\n{text}"
