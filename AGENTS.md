# LENS — Qualitative Data Analysis (QDA) Desktop App

**Stack:** Tauri 2 (Rust + React 19/TypeScript 5), SQLite via sqlx, TailwindCSS 4, Zustand 5, ProseMirror.

## Verification

```bash
npx tsc --noEmit && (cd src-tauri && cargo test && cargo build)
```

## Off-Limits

- Do NOT modify `.gitnexus/`, `.ctx/`, `.beads/`, `.charter/`, or `.claude/`.
- Do NOT modify `src-tauri/src/db/migrations/` or `schemas/` without approval.
- Do NOT modify `.github/workflows/`, CI/CD, or deploy scripts.
- Do NOT install global packages or modify system configuration.
- Do NOT push, force-push, or rewrite published branches.
- Do NOT touch `.env*` files; use `.env.example` for reference.

## Rules

- Run `gitnexus_impact` before editing symbols. Warn on HIGH/CRITICAL risk.
- Run `gitnexus_detect_changes()` before committing.
- Use `gitnexus_query` for concepts, `gitnexus_context` for symbols.
- Never rename with find-and-replace; use `gitnexus_rename`.
- Always verify before claiming completion: `npx tsc --noEmit && (cd src-tauri && cargo test && cargo build)`.

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/` | React frontend |
| `src-tauri/` | Rust backend |
| `src-tauri/src/db/migrations/` | SQLite migrations (off-limits) |
| `schemas/` | REFI-QDA XML schemas (off-limits) |

## Hooks

```bash
git config core.hooksPath .githooks && chmod +x .githooks/pre-commit
```

- `.githooks/pre-commit` runs `npx tsc --noEmit` + `cargo test`.
- CI: `.github/workflows/ci.yml` (TS build + Rust matrix ubuntu/windows/macos).
- `.github/workflows/charter.yaml` runs Charter on PRs + pushes to main.
- See `.claude/skills/gitnexus/` for impact analysis, refactoring, and debugging.

<!-- gitnexus:start -->
<!-- gitnexus:end -->

## Release Secrets

LENS release artefacts are signed + notarised so end users get a verified
download. Keys and credentials live in the repo's
`Settings -> Secrets and variables -> Actions` page; nothing here is
committed. They are referenced by `.github/workflows/release.yml` via
`secrets.*` and consumed at GitHub-Actions time only.

| Secret                                | What it is for                                       | How to obtain                                                                   |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`           | Signs `.updater` bundles so the updater plugin accepts them | `cargo install tauri-cli && cd src-tauri && tauri signer generate -w ~/.tauri/lens.key`. Paste the contents of `~/.tauri/lens.key`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | Decrypts the key above at signing time               | The password chosen at `tauri signer generate`. |
| `APPLE_CERTIFICATE`                   | base64-encoded DeveloperIDApplication.p12           | Export from Keychain Access: Certificates -> Apple Distribution. `base64 -i file.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD`          | Decrypts the .p12                                    | The password set at export time. |
| `APPLE_ID`                            | Apple ID email for notarytool                       | A Developer Program account email. |
| `APPLE_PASSWORD`                      | App-specific password (NOT the Apple ID password)   | `appleid.apple.com -> Sign-In and Security -> App-Specific Passwords`. |
| `APPLE_TEAM_ID`                       | 10-char Apple Developer Team ID                      | `developer.apple.com -> Account -> Membership details`. |

### Rotation

1. Generate a new key pair on a developer machine with `tauri signer generate`.
2. Update `bundle.updater.pubkey` in `src-tauri/tauri.conf.json` (this is the
   PUBLIC half -- safe to commit) with the new `*.key.pub` contents.
3. Paste the new private key into `TAURI_SIGNING_PRIVATE_KEY` and the new
   password into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Delete the old values
   from `Secrets and variables -> Actions`.
4. Push a tag to trigger a fresh release; existing installs will be locked
   to the OLD key until they manually upgrade. New installs will use the new key.

Sidecar builds (`scripts/build-sidecar.sh` for `pdfplumber-*`) were
promoted from `continue-on-error: true` to blocking in `release.yml` -- a
sidecar build that fails now breaks the release rather than shipping a
LENS installer without the pdfplumber sidecar.
