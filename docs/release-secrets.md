# Release Secrets (Tauri + Apple notarisation)

LENS release artefacts are signed + notarised so end users get a verified
download. Keys and credentials live in the repo's
`Settings -> Secrets and variables -> Actions` page; nothing is committed.
They are referenced by `.github/workflows/release.yml` via `secrets.*` and
consumed at GitHub-Actions time only.

## Secrets catalogue

| Secret                                | What it is for                                       | How to obtain                                                                   |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`           | Signs `.updater` bundles so the updater plugin accepts them | `cargo install tauri-cli && cd src-tauri && tauri signer generate -w ~/.tauri/lens.key`. Paste the contents of `~/.tauri/lens.key`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | Decrypts the key above at signing time               | The password chosen at `tauri signer generate`. |
| `APPLE_CERTIFICATE`                   | base64-encoded DeveloperIDApplication.p12           | Export from Keychain Access: Certificates -> Apple Distribution. `base64 -i file.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD`          | Decrypts the .p12                                    | The password set at export time. |
| `APPLE_ID`                            | Apple ID email for notarytool                       | A Developer Program account email. |
| `APPLE_PASSWORD`                      | App-specific password (NOT the Apple ID password)   | `appleid.apple.com -> Sign-In and Security -> App-Specific Passwords`. |
| `APPLE_TEAM_ID`                       | 10-char Apple Developer Team ID                      | `developer.apple.com -> Account -> Membership details`. |

## Scaffolder

`scripts/generate-signing-key.sh <key-path>` runs `tauri signer generate` with
a piped passphrase so it works in CI dry-runs. For developer machines, the
plain `tauri signer generate` flow is interactive and the keys never leave
the developer's `~/.tauri/` directory.

## Rotation

1. Generate a new key pair on a developer machine with `tauri signer generate`.
2. Update `bundle.updater.pubkey` in `src-tauri/tauri.conf.json` (this is the
   PUBLIC half -- safe to commit) with the new `*.key.pub` contents.
3. Paste the new private key into `TAURI_SIGNING_PRIVATE_KEY` and the new
   password into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Delete the old values
   from `Secrets and variables -> Actions`.
4. Push a tag to trigger a fresh release; existing installs will be locked
   to the OLD key until they manually upgrade. New installs will use the new key.

## Dry-run

`scripts/release-dry-run.sh` (or `.github/workflows/release-dry-run.yml` via
`workflow_dispatch`) runs every release step EXCEPT `softprops/action-gh-release`.
Useful for catching sidecar / signing / notarisation failures without
publishing artefacts. Sidecar build is blocking (no `continue-on-error`).
