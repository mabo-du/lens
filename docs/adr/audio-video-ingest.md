# Audio & Video Ingest — Architecture Decision

**Status:** decided, not yet implemented · **Date:** 2026-06-25 · **Scope:** v2 multimedia axis #1

## Decision

Use the **`ffmpeg-next` crate** (Rust-side, zero-copy) as the primary decode engine. Shell-out to the system `ffmpeg` binary is the **fallback path** for less-common codecs (e.g. AV1, WavPack).

## Rationale

- **`ffmpeg-next` (Rust bindings, ~2 MiB footprint):** most common research audio formats (mp3, m4a/aac, wav, flac, ogg-opus) are decoded with a single `Decoder::new(path)?.decode()` call. The Rust bindings exit cleanly — no orphan `ffmpeg` processes.
- **Shell-out `ffmpeg -i path.json`:** the `ffprobe` JSON output can be parsed for duration, channel count, sample rate. Encoding the waveform PNG (256×64 grayscale) via `ffmpeg -filter_complex 'showwavespic=s=256x64:colors=gray' frames:v 1 -update 1` is fast.

## Timeline

| Phase | When | Scope |
|-------|------|-------|
| **1** | v0.2.0 | mp3/wav/m4a decode + `ffprobe` JSON metadata extraction. `transcript_segment` table already exists. |
| **2** | v0.2.1 | waveform preview (256px PNG) + MP4/video (first frame only, no audio track decode within video). |
| **3** | v0.3.0 | Full video decode (H.264/H.265) inside the `ffmpeg-next` pipeline; chapter markers; caption extraction. |
| **4** | v1.0   | WavPack/FLAC/AV1 fallback via shell-out `ffmpeg` |

## Implementation notes

1. `ffmpeg-next` depends on `libavcodec` / `libavformat` (system or bundled). Tauri sidecars `ffmpeg` and `ffprobe` are already available for PDF extraction — no new sidecar added.
2. The `transcript_segment` table (`01_initial_schema.sql`) is the pre-existing forward-looking schema for audio ASR transcripts (start/finish + text). No new migration needed.
3. Test fixture: a 1-chunk 5-second silence WAV (generated via `sox` or `ffmpeg` at test time) — lightweight and deterministic.
