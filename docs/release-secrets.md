# Release secrets

Catalogue of every GitHub-Actions secret (and local developer secret) required to
ship a signed, notarised LENS build via `release.yml`. **Internal docs only --
do not commit any secret value.**

| Secret | Purpose | Where to obtain |
|--------|---------|-----------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri auto-updater signing key (age) | `scripts/generate-signing-key.sh` (passphrase piped via stdin) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passphrase for the above | Same script (prompts on local machine; paste output into GH secret) |
| `APPLE_CERTIFICATE` | base64 of `lens-dev-id.p12` | `p12-export.txt` from Keychain Access after exporting Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | Passphrase protecting the .p12 | Whatever you set when exporting from Keychain |
| `APPLE_SIGNING_IDENTITY` | Apple Developer ID common name | `security find-identity -v -p codesigning` |
| `APPLE_ID` | Apple Developer account email | Apple Developer Program enrollment |
| `APPLE_PASSWORD` | App-specific password for notarisation | https://appleid.apple.com -> App-Specific Passwords |

See `tauri.conf.json` field `plugins.updater.pubkey` for the **public** half of
the Tauri signing key that must match the private half in `TAURI_SIGNING_PRIVATE_KEY`.

## Scaffolder

`scripts/generate-signing-key.sh` wraps `tauri signer generate` and feeds the
passphrase via stdin so the dry-run variant works headlessly. **Run this once
per rotation.** The script writes the public key to stdout -- paste that into
`plugins.updater.pubkey` in `tauri.conf.json`.

## Rotation-during-release

`plugins.updater.pubkey` is baked at *compile* time. Risks:

- **No collision**: an in-flight release using the OLD key remains installable
  via the OLD key. A subsequent release using the NEW key serves via the NEW
  pubkey baked into that build. Tauri's updater downloads `latest.json` from
  the current GitHub Releases endpoint -- the pubkey required to validate is
  whatever was current at the moment that `latest.json` was uploaded.
- **Compile-baked caveat**: the pubkey is baked into the *shell binary* at
  compile time. Auto-update does NOT migrate pubkey -- a user on Shell A
  (pubkey A baked in) keeps pubkey A regardless of which signed releases they
  update *to*. Rotation requires shipping a *new shell build* via canonical
  installer, not just a new signed release.
- **Parallel cohorts**: after rotation, the old-shell cohort (pubkey O) and
  the new-shell cohort (pubkey N) continue receiving releases on *parallel
  codepaths* indefinitely -- old-shell users update to releases signed with O,
  new-shell users update to releases signed with N. Tauri's updater accepts
  exactly one pubkey per shell build (no fallback key list). **Plan a sunset
  date for the old-shell cohort** before rotating, otherwise that cohort is
  stranded on whatever final release you last signed with the OLD key.
  Tauri 2.x has no built-in mechanism for forcing old-shell-to-new-shell
  migration -- no upgrade prompt for a new pubkey, no `force_update` flag,
  no `migration_required` hook. Sunset must be driven from the shell UI
  (in-app banner announcing Shell-N is available), by attrition, or by
  macOS-side forcing if the Apple notarisation cert expires (forces
  re-install on next launch via Gatekeeper pressure).
- **URL-endpoint caveat**: do NOT swap the `Releases/latest.json` URL endpoint
  at the same time as a pubkey rotation. Sequence them.
- **Rollback**: if a partial rollout fails half-way (signing server error mid
  publish), users who have installed the new-pubkey shell cannot auto-update
  back to OLD-pubkey-signed releases without manual install of the old shell.
  Old-pubkey-signed releases stay valid *for old shells only* -- they don't
  help users who have already installed a new-pubkey shell. Keep at least one
  signed release per pubkey in `Releases/` indefinitely so the matching shell
  cohort still has a downgrade path.

**Example** *(illustrative; substitute your actual rotation dates)*. Rotating on 2026-07-01 = publish Shell-N (pubkey N baked in).
Users on Shell-O (pubkey O baked in) keep receiving releases signed with O on a
parallel codepath. Pre-rotation milestone (e.g. 2026-08-15) = publish final
Shell-O release so the O cohort has a known-good final version; post-2026-08-15
the Shell-O cohort is technically still updateable within its sign-set, but
new feature work only targets Shell-N.

## Rotation

Two independent rotation lifecycles -- trigger them separately, do not assume
they rotate together:

### Tauri signing key (age)

1. Run `scripts/generate-signing-key.sh` locally.
2. Paste the old pubkey aside, copy the new pubkey into `plugins.updater.pubkey`
   in `tauri.conf.json`.
3. Update `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   in GitHub repo settings.
4. Trigger `release.yml` against the next tag. The new build embeds the new
   pubkey; old-shell installs continue receiving releases signed with the old
   key on the parallel codepath described above.

### Apple notarisation

1. Regenerate the `.p12` (Keychain Access -> export Developer ID Application).
2. Update `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` +
   `APPLE_SIGNING_IDENTITY` in GitHub repo settings.
3. `APPLE_ID` + `APPLE_PASSWORD` (app-specific) only need rotation if your
   Apple ID itself rotates (rare; tied to enrollment, not the cert).

Unlike Tauri signing keys, Apple notarisation cert rotation does NOT require
shipping a new shell build (the cert that signed/notarised the bundle is
recorded in the `.app`'s signing chain; macOS Gatekeeper accepts a current
notarisation at install time -- it does not perform ongoing update
verification).

> For CI-token rotation (GitHub Actions OIDC, PATs used for `softprops/action-gh-release`,
> npm provenance tokens, etc.) see repo Settings → Secrets and variables →
> Actions. CI tokens are independent of the release-signing secrets catalogued
> above and have their own rotation lifecycles.
