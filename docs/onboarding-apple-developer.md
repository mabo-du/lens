# Apple Developer onboarding

End-to-end walkthrough for completing Apple Developer Program enrolment,
exporting the code-signing certificate, and provisioning the seven
GitHub-Actions secrets required to ship notarised LENS macOS releases via
`release.yml`. **Audience: a new contributor doing this for the first time, on
their own Mac, outside of CI.** If you only need a refresher on secret rotation
or panic-mode debugging, see `docs/release-secrets.md` instead.

## Prerequisites

| What | Cost | Lead time |
|------|------|-----------|
| A working Mac running macOS 13 or later (Xcode 15+ ships the current `xcrun notarytool`). | — | — |
| A paid Apple Developer Program enrolment ($99 USD/year, individual **or** organisation). Individual is fastest; organisation needs a D-U-N-S number and longer approval. | $99 USD/year | Individual: 24–48 h. Organisation: 5–10 days. |
| An Apple ID with two-factor authentication enabled. | free | minutes. |
| A GitHub repo admin (or write+secrets scope) on the upstream `heritage-tech/lens` repository. | — | — |
| ~30 minutes for the procedure end-to-end after enrolment approval. | — | ~30 min. |

> **Note:** LENS currently distributes a *developer-id-notarised* `.app` bundle (Tauri defaults, no Mac App Store). If we later move to App Store distribution, the certificate type changes (`Apple Distribution` instead of `Developer ID Application`); see `docs/release-secrets.md` and the `### Apple notarisation` subsection for the rotation impact.

## Step 1 — Create / verify Apple ID

If you don't already have an Apple ID tied to a real email address (not your
work alias), create one at https://appleid.apple.com. **Enable two-factor
authentication immediately** — Apple Developer Program enrolment requires it.

Once you have your Apple ID, **do not** use its password directly with
`xcrun notarytool`. You must generate an *app-specific password* later in
step 5. Mixing these up is the #1 onboarding failure mode (see Pitfalls
below).

## Step 2 — Enrol in Apple Developer Program

1. Go to https://developer.apple.com/programs/enroll.
2. Sign in with your Apple ID.
3. Choose **Individual** (faster) or **Organisation** (requires D-U-N-S + business docs).
4. Submit your legal name, address, phone (verification call/SMS).
5. Pay $99 USD with your Apple ID payment method.

Approval is typically:

- **Individual:** 24–48 hours, sometimes instant.
- **Organisation:** 5–10 days.

Until approval is granted, you can still complete steps 3–6 below (the cert
will sign but the .app will fail notarisation if Apple hasn't yet linked your
team). Don't tag a v0.1.0 release until enrolment is active.

## Step 3 — Create the Developer ID Application certificate

1. After enrolment approval, visit https://developer.apple.com/account/resources/certificates/list.
2. Click **+** (Create a certificate).
3. Under **Production**, choose **Developer ID Application** (G2 sub-CA on the modern Apple root CA — Tauri's `tauri build` will reject a `Apple Development` cert here).
4. Follow the on-screen instructions to create a **Certificate Signing Request (CSR)** via Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority. Save it as `*.certSigningRequest`.
5. Upload the CSR. Apple returns a `.cer` file. Download it.
6. **Double-click the `.cer`** to install it into your Mac's Keychain (`login` keychain, default).

> **Common mistake:** selecting "Developer ID Installer" instead of "Developer ID Application". The former is for `.pkg` installers; Tauri builds `.app` bundles, not `.pkg`. The wrong cert type silently fails `codesign --verify` later.

> **Best practice:** Always fill in the **Common Name** field explicitly when the CSR wizard asks for it. Modern macOS Keychain Access (Sonoma / 14.x) often pre-fills CN with the system user's full name + email, but the resulting cert has been rejected by Apple where the wizard-derived CN did not match the Apple ID's enrolled name. Filling CN explicitly (e.g. your name or your team's name) avoids this. A cert bound to a CSR with empty Common Name is rejected by Apple with a vague "Invalid certificate request" error.

## Step 4 — Export the certificate as a password-protected .p12

The CI runner needs the cert + key as a base64-encoded `.p12` blob (a portable
password-protected archive of your cert + private key).

1. Open **Keychain Access** → **login** keychain → **My Certificates** tab.
2. Find **Developer ID Application: <your name> (<team ID>)**.
3. **Right-click → Export…** (not "Export Items…" the simpler way).
4. Save as `lens-dev-id.p12` somewhere temporary (e.g. `~/Desktop/`).
5. Set a memorable password (e.g. 20+ chars; you'll paste this into
   `APPLE_CERTIFICATE_PASSWORD` later, so make it recoverable).
6. Confirm export with the password.

You now have `lens-dev-id.p12` containing the cert + private key.

### Capture the signing identity (for `APPLE_SIGNING_IDENTITY`)

In Terminal:

```sh
security find-identity -v -p codesigning
```

Output looks like:

```
  1) ABC123DEF456... "Developer ID Application: Your Name (TEAMID1234)"
  2) ...
```

Copy the entire quoted string (including the colon and parens) — that's
`APPLE_SIGNING_IDENTITY`.

### Convert the .p12 to a base64-encoded single line (for `APPLE_CERTIFICATE`)

```sh
base64 -i ~/Desktop/lens-dev-id.p12 -o ~/Desktop/lens-dev-id.p12.b64
# IMPORTANT: -w 0 (GNU) or omit -w flag entirely (BSD/macOS native base64).
# Confirm the output is ONE line:
wc -l ~/Desktop/lens-dev-id.p12.b64
# Should print: 1 ~/Desktop/lens-dev-id.p12.b64
```

Securely shred the cleartext copies after provisioning:

```sh
rm -P ~/Desktop/lens-dev-id.p12 ~/Desktop/lens-dev-id.p12.b64
```

`rm -P` is a 3-pass overwrite — required on SSDs as a best-effort only; on
modern APFS volumes with the `Secure Empty Trash` flag, even `-P` is not
cryptographically guaranteed. **The .p12 password is your real security here.**

## Step 5 — Generate an app-specific password for `APPLE_PASSWORD`

`xcrun notarytool` requires an **app-specific password**, not your Apple ID
password. Using the regular password always fails with `Authentication
failed: invalid username/password`.

1. Go to https://appleid.apple.com → **App-Specific Passwords** (sign-in + 2FA required).
2. Click **+** (Generate an app-specific password).
3. Label: `LENS CI notarisation` (this is just a recall-friendly mnemonic).
4. Copy the generated 16-character `xxxx-xxxx-xxxx-xxxx` password.
5. **This is the value of `APPLE_PASSWORD`**.

## Step 6 — Provision the seven GitHub-Actions secrets

For each of the following secrets, open https://github.com/heritage-tech/lens/settings/secrets/actions
(the repo need not be public-rated for this page), click **New repository
secret**, paste the value, save. Do not commit any of these values.

| GH secret | Value |
|-----------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | stdout of `scripts/generate-signing-key.sh` (the `*.key` file's contents). See `docs/release-secrets.md`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the passphrase used when you ran the scaffolder |
| `APPLE_CERTIFICATE` | full single-line contents of `lens-dev-id.p12.b64` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password you set in Step 4 |
| `APPLE_SIGNING_IDENTITY` | the full `security find-identity` quoted string |
| `APPLE_ID` | your Apple Developer Program primary email |
| `APPLE_PASSWORD` | the app-specific password from Step 5 |

Run `gh secret list -R heritage-tech/lens` to validate all seven are present
without leaking their contents. *Note: `gh secret list` only confirms the
names exist -- it does not confirm the values are correct.* For a value
round-trip, smoke-test by triggering **`.github/workflows/release-dry-run.yml`**
via `workflow_dispatch`; bad cert keys / mismatched passphrases surface as
immediate `xcrun notarytool` authentication failures or `tauri-action`
sign-failures during the macOS job.

## Step 7 — Validate end-to-end with the dry-run workflow

Before tagging a v0.1.0 release, run the dry-run to verify the full pipeline
sans the actual GitHub Release.

### Option A — local dry-run (fastest)

```sh
cd /path/to/LENS
bash scripts/release-dry-run.sh
```

This runs `tsc --noEmit`, vitest, cargo test, builds the pdfplumber sidecar,
the vite build, and a `tauri build --bundles app --no-bundle`. **Without a
valid Apple Developer ID cert on the local Mac, codesign/notarisation will
fail;** that is expected and not blocking — the goal is to catch compile,
type-check, and test failures before consuming CI minutes.

Expected on a clean macOS dev box with a real Developer ID cert present:

```
[release-dry-run] step 1/4: type-check + unit tests
  - tsc: clean
... vitest passes ...
(cd src-tauri && cargo test) ... 43 passed ...
[release-dry-run] step 2/4: build pdfplumber sidecar (BLOCKING)
... pyinstaller succeeds ...
[release-dry-run] step 3/4: build front-end
... vite build succeeds ...
[release-dry-run] step 4/4: build Tauri installer for current host
... tauri build --bundles app --no-bundle succeeds ...
[release-dry-run] DONE
```

Expected on a Linux dev box (no Apple tools, no signing identity): Step 4
will fail with `error: tauri build failed with no available bundle targets`
or similar — that is acceptable; Steps 1–3 should still pass.

### Option B — GH Actions dry-run workflow

Visit https://github.com/heritage-tech/lens/actions/workflows/release-dry-run.yml
and click **Run workflow** (any branch). It runs the same six steps plus
artefact upload, on `ubuntu-latest`. This is the canonical "all 7 secrets
work" check — it cannot exercise macOS-specific signing/notarisation (those
need a `macos-latest` runner), but it will catch references to missing env
vars, expired certs, or broken scaffolders fast.

## Step 8 — Tag the first release

Once steps 1–7 succeed:

```sh
git tag v0.1.0
git push --tags
```

`release.yml` will pick up the tag and run the full build matrix (Linux,
Windows, macOS Intel, macOS Apple Silicon). macOS jobs will:
1. Decode `APPLE_CERTIFICATE` → temp `.p12`.
2. `security import` into a throwaway CI keychain.
3. `tauri build --target ${{ matrix.target }}` with the cert identity.
4. `xcrun notarytool submit ... --apple-id $APPLE_ID --password $APPLE_PASSWORD`.
5. `xcrun stapler staple` to attach the notarisation ticket.
6. Upload `.dmg` + `.app.tar.gz` to the draft GitHub Release.
7. Mark the release as `prerelease: false` (publishes it).

## Pitfalls (encountered in the wild)

1. **Using the Apple ID password instead of an app-specific password.**
   Symptom: `xcrun notarytool` complains
   `Error: HTTP Error 403: Authentication failed` or
   `invalid username/password`. **Fix:** use the app-specific password from
   Step 5. Always.

2. **Wrong certificate type.** Selecting "Apple Development" or "Developer
   ID Installer" in Certificate Manager silently signs but fails Apple
   validation. Confirm with
   `security find-identity -v -p codesigning | grep "Developer ID Application"` —
   if that grep finds no match, you don't have the right cert installed.

3. **Multi-line base64 secret.** If `APPLE_CERTIFICATE` contains line breaks,
   `echo "$APPLE_CERTIFICATE" | base64 --decode` will fail with
   `base64: invalid input`. On Linux GNU base64 use `base64 -w 0`; on
   macOS use plain `base64 -i file -o file.b64` (no `-w`).

4. **Team ID mismatch.** The cert subject must include the **team ID**
   you're enrolled under (10-char alphanumeric, e.g. `ABCDE12345`). If you
   belong to multiple teams and accidentally export from the wrong
   keychain entry, codesign succeeds but Apple notarisation rejects the
   `.app` with `ITMS-9000: Invalid Bundle` (varies).

5. **Cert rotated but GH secret not.** Symptom: signed releases in
   `Releases/` fail signature verification for previously-installed users.
   **Fix:** see `### Apple notarisation` in `docs/release-secrets.md` — the
   Apple cert rotation workflow is *separate* from the Tauri signing key
   rotation; track both with `gh secret list -R heritage-tech/lens`.

6. **Keychain locked during CI.** GitHub Actions runners don't have a
   default keychain; you must `security create-keychain` a temp keychain,
   `unlock-keychain` it, `security import` the `.p12` into it, then
   `set-keychain-settings -lut 21600` so it auto-locks after 6 hours.
   This is what `tauri-action@v0` does internally, but if you bypass
   `tauri-action` and roll your own signing step, replicate this pattern.

7. **Multi-Apple-ID cache ambiguity.** `xcrun notarytool` (and `tauri-action` when no `--apple-id` / `--password` flags are forwarded) caches Apple ID + password in your login keychain. If you routinely use more than one Apple ID (personal + work, etc.), an older cached credential may be used instead of the current `APPLE_ID` / `APPLE_PASSWORD` env. Symptom: `Authentication failed: invalid username/password` even though the env vars are provably correct (verify with `gh secret get APPLE_ID`).

   **Workaround (preferred):** always pass `--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD"` explicitly to `notarytool` invocations so the credential cache is bypassed entirely. Set this as a default in any `release.yml` / `release-dry-run.yml` step that calls notarytool.

   **Last-resort local cleanup:** if you must purge the keychain entry, first discover the actual service name Apple stored it under. The literal `com.apple.notarytool` is an educated guess, not a documented Apple constant. Two reliable discovery paths (try in order):

   ```sh
   # 1. Search by keychain label (most reliable on modern macOS):
   security find-generic-password -l notary
   # 2. Or enumerate all keychains and grep:
   security list-keychains | xargs -I{} sh -c 'security dump-keychain {} 2>/dev/null | grep -i notary'
   # then, with the discovered service name:
   security delete-generic-password -s "<that-name>" -a "<apple-id>"
   ```

   CI runners always start with an empty keychain, so this entire pitfall only bites on local dev-box notarisations.

## See also

- **`docs/release-secrets.md`** — full secrets catalogue + rotation runbook
  (sister document).
- **`scripts/generate-signing-key.sh`** — non-interactive Tauri signer
  scaffolder (CI/dry-run variant only; for local interactive use, run
  `cargo install tauri-cli --version "^2" && tauri signer generate` directly).
- **`scripts/release-dry-run.sh`** — local-first dry-run of the full
  release pipeline minus notarisations + GH Release upload.
- **`.github/workflows/release.yml`** — actual release pipeline.
- **`.github/workflows/release-dry-run.yml`** — `workflow_dispatch`-able
  dry-run on `ubuntu-latest`.
- **`src-tauri/tauri.conf.json`** — `plugins.updater.pubkey` (Tauri-side,
  not Apple-side; see Pitfalls #5).
- **`tauri-action` README** — https://github.com/tauri-apps/tauri-action
  (full `tauri-action` env-var list, edge cases).
- **Apple's notarytool docs** —
  https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
  (any error messages you don't recognise, this is the canonical reference).
