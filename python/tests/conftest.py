"""Shared fixtures for the lens-qda pytest suite.

Provides:
  * ``fixture_pdf`` - a session-scoped 2-page synthetic PDF that exercises
    pdfplumber's per-page extraction + the {text|error} JSON envelope shape
    LENS desktop already parses. Generated lazily via reportlab (an optional
    test-only dependency), so the suite is skipped gracefully when reportlab
    is not installed.
  * ``cli_runner`` - subprocess wrapper that invokes the installed
    ``lens-qda`` console-script entry point, so the test exercises the same
    argv-parsing, stderr routing, and exit-code contract that ``pip install``
    users actually hit.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

import pytest


@pytest.fixture(scope="session")
def fixture_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Generate a minimal 2-page PDF using reportlab at session start.

    The chosen marker tokens are short ASCII so pdfplumber's layout-aware
    extraction (x_tolerance=3, y_tolerance=3 — matching the Tauri sidecar)
    round-trips them verbatim. The 2-page split ensures the per-page
    join-with-blank-lines glue inside ``lens_qda.extract_text`` runs.
    """
    try:
        from reportlab.pdfgen import canvas  # type: ignore
    except ImportError:
        pytest.skip(
            "reportlab is required to synthesise a fixture PDF for "
            "test_cli_extract_happy_path; install via 'pip install -e .[test]'."
        )

    out = tmp_path_factory.mktemp("fixture") / "two_page.pdf"
    c = canvas.Canvas(str(out))
    c.drawString(100, 700, "Page One Marker Token")
    c.showPage()
    c.drawString(100, 700, "Page Two Marker Token")
    c.save()
    assert out.is_file() and out.stat().st_size > 0
    return out


@pytest.fixture
def cli_runner() -> Callable[..., subprocess.CompletedProcess]:
    """Invoke the installed ``lens-qda`` entry point via subprocess.

    Returns a function ``runner(*argv, **kwargs) -> CompletedProcess`` that
    captures stdout/stderr and never raises (returns ``check=False``).
    Calling without first installing the entry point triggers ``pytest.skip``
    so the suite degrades gracefully for week-old venvs that have lost the
    console script.
    """
    if shutil.which("lens-qda") is None:
        pytest.skip("lens-qda entry point not on PATH; run 'pip install -e .' first.")

    def _run(*argv: str, **kwargs) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["lens-qda", *argv],
            capture_output=True,
            text=True,
            check=False,
            **kwargs,
        )

    return _run
