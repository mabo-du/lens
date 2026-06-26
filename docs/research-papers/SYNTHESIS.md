# SYNTHESIS — LENS v2+ Deep Research Reports

Four deep-research reports reviewed 2026-06-26, cross-referenced against the
6 positions in `~/Documents/DRPQ.md`. Three positions overturned by report
evidence; three affirmed. Three unanimous implementation steps unblocked.

## Reports reviewed

| # | Title | Engine |
|---|---|---|
| 1 | LENS Multilingual UI Implementation.md | LinguiJS-favouring |
| 2 | From Hand-Rolled `t()` to Production i18n: A Blueprint for Multilingual Support in LENS.md | i18next-favouring |
| 3 | LENS Audio Transcription Technical Report.md | whisper.cpp/whisper-rs-favouring |
| 4 | A Risk-Averse Technical Blueprint for Integrating Offline Speech-to-Text and Waveform Synchronization in LENS.md | faster-whisper/PyInstaller-favouring |

## Disposition against DRPQ.md

| DRPQ position | Reports | Verdict | Rationale (one sentence) |
|---|---|---|---|
| A1 — faster-whisper via PyInstaller | #3 ❌ · #4 ✅ | **OVERTURNED → whisper.cpp via whisper-rs (Rust crate)** | PyInstaller + PyTorch + CUDA = ~1.5 GB bundle, which exceeds the artifact limits that previously stalled the release matrix; whisper-rs is 10–20 MB and integrates into the Cargo workspace. |
| A2 — precomputed per-doc interval index | #3 ✅ · #4 ✅ | **AFFIRMED** | Both reports converge on flat array + binary search (O(log n)); per-transcript memory is bounded. |
| A3 — Tauri channel architecture with audio-specific events | #3 ✅ · #4 ✅ | **AFFIRMED** | Both recommend two-channel async IPC; #3 specifies `tauri::ipc::Channel` streaming, #4 specifies `listen()` events. |
| B1 — i18next + react-i18next | #1 ❌ · #2 ✅ | **OVERTURNED → LinguiJS v6** | Compile-time SWC extraction shrinks runtime to ~3 KB; native `.po` output retains CLDR plural metadata (`msgstr[0]–[5]`) required for Arabic 6-form plurals — JSON cannot encode this natively. |
| B2 — per-component RTL opt-in | #1 ❌ · #2 ✅ | **OVERTURNED → global `dir="rtl"` + Tailwind v4 logical properties + per-surface remediation** | Tailwind v4's `ms-4`/`pe-2` logical properties auto-mirror on a global `dir` cascade; only Konva canvas coordinates, ProseMirror bidi chrome, journal timestamps, and lucide icons need explicit `dir="ltr"` or `unicode-bidi: plaintext` overrides. |
| B3 — JSON dicts + Weblate | #1 partially ❌ · #2 ✅ | **REFINED → `.po` files (Lingui-native) + Weblate + CI lint** | `.po` is the superior open-source translation container (plural arrays, context comments); JSON remains acceptable as a compatibility bridge but `.po` is the target format. |

## Unanimous implementation steps (unblocked across all reports)

1. **Precompute flat transcript index on document-open.** Map `start_ms` / `end_ms` / `char_offset` / `word` into a sorted array; binary-search for click-to-seek and region-highlighting. No library dependency — O(log n) in vanilla JS/TS. All 4 reports reference this pattern; #3 and #4 provide implementation sketches.

2. **Two-channel Tauri IPC for transcription progress.** Spawn sidecar via `audio_transcribe_start` (returns `jobId` immediately), stream progress via `tauri::ipc::Channel<TranscribeProgress>`, commit results on `done` event. #3 specifies the exact Rust API; #4 specifies the JSONL envelope contract. Both agree the synchronous single-invoke pattern freezes the renderer.

3. **Extract strings + CI lint for missing translation keys.** Migrate the existing ~30 hand-rolled `t()` strings to dictionary files; add `lingui extract --strict` (or `i18next-parser`) to `ci.yml` so any PR introducing a new `t()` call without a corresponding dictionary entry fails CI. Reports #1 and #2 both recommend this; the CI guard is format-agnostic.

## Revised V2+ implementation order

Based on the consensus steps above plus a clean stack order (infrastructure before surface):

- **Phase 6x — finish Phase 6 analytics polish (co-occurrence UI, freq bars, status bar)** — continue current Phase 6 work
- **Phase 7.1b — minimal ICR UI surface** — wire the tested Cohen's kappa math into AnalyticsWorkspace
- **Phase 8a — audio import scaffolding** — register wavesurfer.js v7, build `<WaveSurferContainer>`, asset copy + document row (no transcription yet)
- **Phase 9a — i18n infrastructure** — install LinguiJS, configure SWC/Vite plugins, migrate 30 hand-rolled strings to `.po`, wrap App in `<I18nProvider>`
- **Phase 8b — whisper-rs sidecar** — integrate whisper-rs into Cargo workspace, implement IPC envelope contract, wire `audio_transcribe_start` / progress / commit
- **Phase 9b — RTL cascade** — global `dir="rtl"` + Tailwind v4 logical property audit + Konva/ProseMirror/Icon remediation
- **Phase 8c — player + transcript sync** — `<AudioPlayer>`, `<AudioTranscript>`, dual-binary-search sync, media-selection IPC
- **Phase 9c — locale picker + translator workflow** — `RadioGroup` in SettingsDialog, Weblate CI integration

## Cross-references

- `~/Documents/DRPQ.md` — original positions (some overturned above; treat overturned positions as stale)
- Phase 8 (audio/video) and Phase 9 (multilingual) as scoped in the project plan

---

*Synthesised 2026-06-26. This document is the binding plan; the 4 research reports are the evidence base. If implementation discovers a conflict between a research verdict and the codebase, flag it here as an addendum.*
