# lens-qda

Python utilities for **[LENS](https://github.com/mabo-du/lens)**, a local-first
qualitative data analysis (QDA) desktop application.

This package bundles the same PDF text-extraction pipeline that the LENS
desktop app uses to ingest PDF documents, exposing it as a small CLI so it can
also be used directly from Python or from shell scripts.

## Install

```bash
pip install lens-qda
```

Requires Python 3.8+ and the prebuilt wheels for `pdfplumber` and its
dependencies (`cryptography`, `pillow`, `pdfminer.six`, ...) on PyPI; no
compiler is needed on supported platforms.

## CLI usage

```bash
# Print plain text extracted from a PDF (one paragraph per page):
lens-qda extract path/to/paper.pdf

# Emit the same JSON envelope the LENS desktop sidecar produces:
lens-qda extract paper.pdf --json

# Save the extracted text to a file:
lens-qda extract paper.pdf -o paper.txt

# Tune pdfplumber's tolerances (defaults match the sidecar):
lens-qda extract paper.pdf --x-tolerance 3 --y-tolerance 3
```

The `--json` schema matches the contract the LENS Tauri sidecar already
implements:

```json
{ "success": true, "text": "...all pages, joined by blank lines..." }
```

On failure:

```json
{ "success": false, "error": "<exception message>" }
```

(the process exits with status 1 in that case).

## Programmatic usage

```python
from pathlib import Path
import json, subprocess

result = subprocess.run(
    ["lens-qda", "extract", "paper.pdf", "--json"],
    capture_output=True, text=True, check=True,
)
envelope = json.loads(result.stdout)
assert envelope["success"], envelope["error"]
corpus = envelope["text"]
```

## License

MIT — same as the parent [LENS](https://github.com/mabo-du/lens) project.
