"""
In-process CLI tests (no subprocess fork cost) complement the subprocess tests
in ``test_cli.py``. The ``subprocess`` tests in test_cli.py catch argv + exit-code
contract regressions; these catch argparse edge cases the wrapper masks.
"""
import pytest
from lens_qda.cli import build_parser, main


def test_build_parser_returns_argumentparser():
    # build_parser() side-effect: registers all subparsers + default args
    parser = build_parser()
    assert parser is not None
    assert any(action.dest == 'command' for action in parser._actions), (
        "expected positional 'command' on the top-level parser"
    )


def test_main_help_in_process_exits_clean():
    # main(['--help']) invokes argparse which calls sys.exit(0) — catch it.
    with pytest.raises(SystemExit) as excinfo:
        main(['--help'])
    assert excinfo.value.code in (0, None), (
        f"--help must exit cleanly; got code={excinfo.value.code}"
    )


def test_main_extract_help_in_process_exits_clean():
    with pytest.raises(SystemExit) as excinfo:
        main(['extract', '--help'])
    assert excinfo.value.code in (0, None), (
        f"extract --help must exit cleanly; got code={excinfo.value.code}"
    )
