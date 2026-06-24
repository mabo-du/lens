# Third-Party Notices

LENS depends on the following upstream open-source libraries. Their
respective licences remain in force for those components — only the
LENS-authored source under `src/` and `src-tauri/src/` is covered by the
project's [MIT License](LICENSE).

Direct-dependency summary (grouped by upstream family). For transitive
(Nth-degree) dependencies, regenerate this table from the locked manifests
using `cargo about` (Rust) and `npx license-checker --production` (npm)
before tagging any release; the table below was drawn from memory of
upstream `LICENSE` files and may drift if any upstream changes its terms.

## Runtime — Node / TypeScript (frontend)

| Family | Key packages | Licence |
|---|---|---|
| **Tauri JS API + plugins** | `@tauri-apps/api` 2 · `@tauri-apps/plugin-dialog` · `-fs` · `-opener` · `-shell` · `-store` · `-updater` | Apache-2.0 OR MIT (dual) |
| **React** | `react` 19 · `react-dom` 19 | MIT |
| **ProseMirror editor stack** | `prosemirror-model` · `prosemirror-state` · `prosemirror-transform` · `prosemirror-view` | MIT |
| **State + UI utilities** | `zustand` · `react-resizable-panels` · `react-arborist` · `sonner` · `cmdk` · `clsx` · `tailwind-merge` · `class-variance-authority` | MIT (cva: Apache-2.0 OR MIT dual) |
| **Headless UI primitives** | `@base-ui/react` 1 | MIT |
| **Icons + themes** | `lucide-react` · `next-themes` | lucide: ISC; next-themes: MIT |
| **File / data utilities** | `handlebars` 4 · `jszip` 3 · `@xmldom/xmldom` | MIT (all) |
| **Geist variable font** | `@fontsource-variable/geist` 5 | SIL OFL-1.1 (font licence) |

## Runtime — Rust (backend, inside `src-tauri`)

| Family | Key packages | Licence |
|---|---|---|
| **Tauri shell + plugin crates** | `tauri` 2 · `tauri-build` 2 · `tauri-plugin-dialog` · `-fs` · `-shell` · `-store` · `-updater` | Apache-2.0 OR MIT (dual) |
| **Async + DB** | `tokio` 1 · `sqlx` 0.9 (SQLite) | tokio: MIT; sqlx: Apache-2.0 OR MIT (dual) |
| **Serialization + IDs** | `serde` 1 · `serde_json` 1 · `uuid` 1 | Apache-2.0 OR MIT (dual) |
| **Cryptographic primitives** | `sha2` 0.10 · `hex` 0.4 | Apache-2.0 OR MIT (dual) |
| **Text + format parsing** | `unicode-normalization` 0.1 · `roxmltree` 0.20 · `zip` 2 | unicode-normalization: Apache-2.0 OR MIT; roxmltree: Apache-2.0 OR MIT; zip: MIT |
| **Test helpers (dev-only)** | `tempfile` 3 | Apache-2.0 OR MIT (dual) |

## Runtime — Python (PDF sidecar)

The Tauri sidecar at `src-tauri/sidecars/pdfplumber/` runs a small Python
script via a frozen executable. Distribution channels:

| Component | Licence |
|---|---|
| `pdfplumber` | MIT |
| `pdfminer.six` (transitive PDF parser) | MIT |
| PyInstaller (build-time freezer for the sidecar binary) | GPL-2.0 with the PyInstaller bootloader-exception — only PyInstaller's own bootloader source is GPL; the bundled application output is not. See <https://www.pyinstaller.org/license.html>. |

## Build / dev tools (dev-only — not shipped in prebuilt binaries)

| Family | Key packages | Licence |
|---|---|---|
| **Vite + plugin** | `vite` 7 · `@vitejs/plugin-react` 4 · `@tailwindcss/vite` 4 · `@vitejs/plugin-react` 4 | MIT (all) |
| **Styling animation share** | `tw-animate-css` 1 · `tailwindcss` 4 | MIT |
| **TypeScript** | `typescript` 5.8 | Apache-2.0 |
| **Tests** | `vitest` 4 · `@vitest/ui` 4 | MIT |
| **shadcn CLI** | `shadcn` 4 | MIT |
| **Tauri CLI** | `@tauri-apps/cli` 2 | Apache-2.0 OR MIT (dual) |
| **Type-only annotation metadata** | `@types/handlebars` · `@types/prosemirror-*` · `@types/xmldom` · `@types/node` · `@types/react` · `@types/react-dom` | MIT (DefinitelyTyped convention) |

## Notes on specific licences

The table above keeps licence tags terse so adjacent columns stay
readable on small screens. Where a licence has clauses that specifically
affect LENS's redistribution posture, they're spelled out here.

### `lucide-react` (ISC)

lucide-react is ISC-licensed in recent releases, but pre-`0.4xx` versions
were MIT. The ISC switch is post-fork-and-version-jump, so attribution for
older lockfiles may still expect MIT. Verify the actual licence of the
pinned version before tagging any release:

```bash
npx license-checker --markdown | grep lucide-react
```

### Geist variable font (SIL OFL-1.1)

`@fontsource-variable/geist` ships under the SIL Open Font License 1.1,
a **font** licence (not a software licence) — see
<https://scripts.sil.org/OFL> for the authoritative redistribution
terms. The clauses most likely to bite LENS's redistributors, in plain
language:

- Bundling the font into a software distribution is permitted.
- The font may not be sold standalone.
- Derivative fonts cannot use "Geist" as a name (**Reserved Font Name**).
- Derivative fonts must themselves remain OFL-licensed unless the
  entire superset font collection is relicensed freely.

For binary distributions the font `LICENSE.txt` should be bundled
alongside the executable per the OFL redistribution clause. For
verifying a font's Reserved Font Name clause before bundling, see the
OFL FAQ at <https://scripts.sil.org/OFL-FAQ>.

## Pre-release verification

> **Always regenerate this table from the locked manifests before tagging**
> any release. Recommended commands:
>
> ```bash
> # Rust side
> cargo install cargo-about
> cargo about generate about.hbs -o THIRD_PARTY_NOTICES_RUST.md
>
> # npm side (production deps only, omit dev deps)
> npx license-checker --production --csv > THIRD_PARTY_NOTICES_NPM.csv
> ```
>
> Diff the regenerated output against the table above; cite any new
> dependencies whose licences are not yet reflected here.

## Redistributing prebuilt binaries

When shipping prebuilt binaries (`.dmg`, `.msi`, `.AppImage`, `.deb` from
`npm run tauri build`), bundle the upstream `LICENSE` files alongside the
binary so redistribution stays compliant:- **MIT**, **ISC**: only the upstream permission notice must be preserved.
- **Apache-2.0 (Tauri 2 / sqlx / TypeScript / cva)**: must include the licence text **and** any `NOTICE` file. This is the most-overlooked clause in binary redistribution — Apache-2.0's NOTICE-file requirement (where present upstream) is what breaks down most often.
- **GPL-2.0 (PyInstaller only, via the sidecar bootloader-exception)**: PyInstaller's bootloader-exception clause keeps the application output permissive; no end-user GPL obligation is incurred by shipping the resulting `.AppImage` / `.dmg`. Only PyInstaller's own bootloader source remains GPL. See <https://www.pyinstaller.org/license.html>.
- **OFL-1.1 (Geist font)**: must ship the font licence alongside the binary, refrain from selling the font standalone, and reserve the "Geist" name from derivative fonts.

The `npm run tauri build` pipeline should copy these upstream licence texts
into `src-tauri/binaries/legal/` (or equivalent) prior to packaging; the
Tauri bundler can include an additional-resources manifest for this.
