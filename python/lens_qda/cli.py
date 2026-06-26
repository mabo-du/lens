"""Command-line interface for ``lens-qda``.

Mirrors the JSON-envelope contract of the Tauri PDF sidecar
(``src-tauri/sidecars/pdfplumber/extract.py``) so the same Rust parser can
consume output from the ``lens-qda extract --json`` invocation and from the
bundled executable.

Entry point declared in ``python/pyproject.toml``::

    [project.scripts]
    lens-qda = "lens_qda.cli:main"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

from lens_qda import __version__

# Default tolerances must match src-tauri/sidecars/pdfplumber/extract.py
# (the canonical Tauri sidecar) so the two code paths produce identical text.
DEFAULT_X_TOLERANCE = 3
DEFAULT_Y_TOLERANCE = 3


def _extract_pages(
    pdf_path: Path, *, x_tolerance: int, y_tolerance: int
) -> list[str]:
    # Imported lazily so `lens-qda --version` works without pdfplumber installed.
    import pdfplumber  # type: ignore

    chunks: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(
                x_tolerance=x_tolerance, y_tolerance=y_tolerance
            )
            if text is None:
                # Fallback matching the Tauri sidecar's resilience logic.
                text = page.extract_text_simple()
            if text:
                chunks.append(text)
    return chunks


def extract_text(
    pdf_path: Path,
    *,
    x_tolerance: int = DEFAULT_X_TOLERANCE,
    y_tolerance: int = DEFAULT_Y_TOLERANCE,
) -> str:
    """Return plain text extracted from *pdf_path*, pages joined by blank lines."""
    return "\n\n".join(
        _extract_pages(pdf_path, x_tolerance=x_tolerance, y_tolerance=y_tolerance)
    )


def extract_json(
    pdf_path: Path,
    *,
    x_tolerance: int = DEFAULT_X_TOLERANCE,
    y_tolerance: int = DEFAULT_Y_TOLERANCE,
) -> dict[str, object]:
    """Return the JSON envelope the Tauri sidecar contract uses."""
    try:
        return {
            "success": True,
            "text": "\n\n".join(
                _extract_pages(
                    pdf_path,
                    x_tolerance=x_tolerance,
                    y_tolerance=y_tolerance,
                )
            ),
        }
    except Exception as exc:  # noqa: BLE001 — envelope must capture any failure
        return {"success": False, "error": str(exc)}


def _emit(text: str, output: Optional[Path]) -> None:
    # Round-7 fix: terminate BOTH stdout and file paths with a single newline so
    # ``lens-qda version -o foo.txt`` and ``lens-qda version`` produce the same
    # byte sequence (sans the stdout/stderr fds). Without this, downstream
    # tools that concatenate files (or tests that ``assert … endswith("\n")``,
    # e.g. test_cli_version_to_file_writes_string) trip on inconsistent
    # trailing-whitespace contracts.
    if output is None:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = text if text.endswith("\n") else text + "\n"
    output.write_text(payload, encoding="utf-8")


def _emit_envelope(envelope: dict[str, object], output: Optional[Path]) -> None:
    """Emit the {success, text|error} JSON envelope consistently.

    Always rendered with ``ensure_ascii=False`` so non-ASCII PDF text
    round-trips identically in every CLI branch.
    """
    _emit(json.dumps(envelope, ensure_ascii=False), output)


def cmd_extract(args: argparse.Namespace) -> int:
    path = Path(args.path)

    # Distinguish a missing path from a non-regular-file path so the JSON
    # envelope (and the stderr message) actually matches the failure cause.
    if not path.exists():
        msg = f"file not found: {path}"
        if args.json:
            _emit_envelope({"success": False, "error": msg}, args.output)
        else:
            sys.stderr.write(f"lens-qda: {msg}\n")
        return 1
    if not path.is_file():
        msg = f"not a regular file: {path}"
        if args.json:
            _emit_envelope({"success": False, "error": msg}, args.output)
        else:
            sys.stderr.write(f"lens-qda: {msg}\n")
        return 1

    # ``extract_json`` always returns a dict (it catches every pdfplumber
    # failure internally and converts it to ``{"success": False, "error": ...}``)
    # so there is no exception to handle here — only the success-flag branch.
    envelope = extract_json(
        path, x_tolerance=args.x_tolerance, y_tolerance=args.y_tolerance
    )

    if not envelope["success"]:
        if args.json:
            _emit_envelope(envelope, args.output)
        else:
            sys.stderr.write(f"lens-qda: {envelope['error']}\n")
        return 1

    if args.json:
        _emit_envelope(envelope, args.output)
    else:
        _emit(str(envelope["text"]), args.output)
    return 0


def cmd_version(args: argparse.Namespace) -> int:
    # ``args.output`` is only present when the ``version`` *subparser* was used;
    # ``lens-qda --version`` (top-level) does not populate it. ``getattr`` keeps
    # both paths working without crashing on missing attributes.
    _emit(__version__, getattr(args, "output", None))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lens-qda",
        description=(
            "Python utilities for LENS, a local-first qualitative data analysis "
            "(QDA) tool. Currently exposes a PDF text-extraction command that "
            "matches the LENS desktop app's bundled sidecar."
        ),
    )
    parser.add_argument(
        "-V",
        "--version",
        action="store_true",
        help="print the lens-qda version and exit",
    )

    # Top-level defaults ensure `args.output` is always defined on the resulting
    # Namespace so cmd_version / cmd_extract can safely read it regardless of
    # whether the top-level parser or a subparser produced the namespace.
    parser.set_defaults(output=None, version=False)

    sub = parser.add_subparsers(dest="cmd", metavar="COMMAND")

    p_extract = sub.add_parser(
        "extract",
        aliases=["x"],
        help="extract text from a PDF document",
        description=(
            "Extract text from a PDF using pdfplumber, with tolerance settings "
            "matching the LENS desktop sidecar. Print plain text by default; "
            "pass --json to emit the {success, text|error} envelope consumed "
            "by the Tauri Rust layer."
        ),
    )
    p_extract.add_argument("path", help="path to a PDF file")
    p_extract.add_argument(
        "-o",
        "--output",
        type=Path,
        help="write output to this file instead of stdout",
    )
    p_extract.add_argument(
        "-j",
        "--json",
        action="store_true",
        help="emit the JSON envelope {success, text|error} matching the sidecar",
    )
    p_extract.add_argument(
        "--x-tolerance",
        type=int,
        default=DEFAULT_X_TOLERANCE,
        help=f"horizontal text-clustering tolerance (default: {DEFAULT_X_TOLERANCE})",
    )
    p_extract.add_argument(
        "--y-tolerance",
        type=int,
        default=DEFAULT_Y_TOLERANCE,
        help=f"vertical text-clustering tolerance (default: {DEFAULT_Y_TOLERANCE})",
    )
    p_extract.set_defaults(func=cmd_extract)

    p_version = sub.add_parser(
        "version", help="print lens-qda version and exit"
    )
    p_version.add_argument(
        "-o", "--output", type=Path, help="write version to this file instead of stdout"
    )
    p_version.set_defaults(func=cmd_version)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Console-script entry point declared in pyproject.toml."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.version:
        return cmd_version(args)

    func = getattr(args, "func", None)
    if func is None:
        parser.print_help(sys.stderr)
        return 1
    return func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
