# CI verification runbook — round-79

This document is the on-call reference for verifying that the LENS
release-candidate pipeline is fully canonicalized.

The pipeline is in `.github/workflows/ci.yml`. The Playwright E2E +
perf bench job (`playwright-e2e`) is what round-79 focuses on because
a long-standing connection-refused bug confounded local execution; CI
is the canonical execution environment.

## Workflow jobs

The CI workflow has **four** jobs, all of which gate the Tauri binary
being releasable. Job ordering is by `needs:`.

| Job              | `needs`        | Approx. cold wall time | What it proves                                       |
| ---------------- | -------------- | ---------------------- | ---------------------------------------------------- |
| `typescript`     | (none)         | ~3 min                 | TS compile, vitest unit + immutability suite are green |
| `rust`           | (none)         | ~5 min                 | Rust unit tests pass for the LENS core               |
| `playwright-e2e` | [typescript, rust] | ~6 min              | Static http-server fixture + Playwright tests pass   |
| `linux-build`    | [typescript, rust] | ~9 min              | Tauri 2 binary compiles on Ubuntu + sidecar builds   |

`typescript` and `rust` start in parallel; `playwright-e2e` and
`linux-build` both wait for them.

## Step sequence — `playwright-e2e`

This is the job most likely to need debugging. Steps in order:

1. `actions/checkout@v4` — fetches branch + LFS
2. `actions/setup-node@v4` (node 20 LTS, npm cache keyed on package-lock.json)
3. `npm ci` — strict install from lockfile (drops devDependencies that
   are not in lockfile; ensures deterministic version pins)
4. `npx playwright install --with-deps chromium` — installs the
   chromium binary + the OS-level GTK / font / nss deps it needs to
   render pages on a headless Ubuntu runner
5. `npx tsc --noEmit` — early fail if type drift sneaks in between
   `typescript` job and now
6. `npx playwright test --reporter=list` — this triggers
   `globalSetup`, which builds the fixture + boots http-server + polls
   the URL, then runs every `tests/e2e/*.spec.ts` + the perf bench

If step 4 fails on the runner, the rest of the job cannot proceed;
expect `apt-get` errors if a system dep is missing.

## Lifecycle inside `npx playwright test`

```
global-setup.mjs (1) vite build         →  ~5s
                (1.5) pre-bind port     →  <100ms
                (2)   http-server       →  <500ms
                (2.5) poll 127.0.0.1    →  ~200-300ms
                (TOTAL) bootstrap       →  ~6s

playwright spec files (run in parallel, up to CI workers):
  - tests/e2e/image-viewer.spec.ts (4 tests, round-78 fixtures)
  - tools/perf/perf-bench.spec.ts     (writes tools/perf/results.json)

global-teardown.mjs:
  - SIGTERM the http-server PID
  - write .lens-e2e/kill-receipt.json
```

## Artifacts

After the job completes, even on failure, the following paths exist:

| Path                                              | Where it goes                          | What to do if it has content                |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| `playwright-report/`                              | CI: `playwright-report/index.html`     | Open in browser to see full test timeline  |
| `test-results/`                                   | CI: per-test JSON traces + screenshots | Look for `errorContext` for the failing test |
| `tools/perf/results.json`                         | Captured **only if** perf bench passes | Copy into `docs/research-papers/v0.2-konva-perf-baseline.md` after a green run |
| `.lens-e2e/lens-e2e.log`                          | Mirror of every boot line timestamped  | `grep -E '(FAIL\|ERROR\|exited code=)'`     |
| `.lens-e2e/kill-receipt.json`                     | JSON state of the SIGTERM attempt      | Confirm `kill: 'pid-sigterm'` on success   |

The CI YAML uploaded-artifact rules (round-79, this doc's commit):
- `playwright-report` → always
- `test-results` → always (even on failure)
- `tools/perf/results.json` → always (if present)
- `.lens-e2e/`, retained for 7 days

## Running the exact CI sequence locally

The CI uses `ubuntu-latest` + Node 20. To simulate:

```bash
# 1. Playwright deps are CI-installed via `playwright install --with-deps`
npx playwright install --with-deps chromium

# 2. Build the fixture + run the suite (globalSetup handles boot)
npx playwright test --reporter=list
```

Everything except `--with-deps` (which requires `sudo` + `apt-get`)
runs identically in a local clone.

## Failure triage

### Symptom: `Error: page.goto: net::ERR_CONNECTION_REFUSED`

This was the round-77 → round-78 cascading bug. After round-78's
http-server swap, the symptom should NOT recur. If it does:

1. **Check the artifact log** — `.lens-e2e/lens-e2e.log`. Look for:
   - `(1.5) pre-bind port 57599 ... pre-bind FAILED` → port already
     in use (leftover http-server from a prior killed job). Fix: add
     `pkill -f 'http-server.*57599'` to the start of step 6.
   - `(2) http-server — ...` then no polling entries → http-server
     exited before bind. Check `code=` in the exit log; usually a
     `EADDRINUSE`.
   - `(2.5) polling ... never responded within 180000ms` → took >3
     minutes to come up. Likely http-server issuing at the wrong
     address; check `(2)` log line printed the right HOST:PORT.

2. **Re-run with verbose flag** — set `DEBUG=pw:webserver` env var on
   step 6 to surface Playwright's webServer readiness logic (note:
   round-78 no longer uses webServer — only globalSetup — so this flag
   is a no-op now, but logs server readiness anyway).

### Symptom: build fails BEFORE playwright tests

vite build logs dump inline to stdout and are mirrored to the
artifact log. Look for:
- Type error → run `npx tsc --noEmit` locally first
- Fixture import resolution → check `tests/e2e/fixture.vite.config.ts`
  alias `@` → `src/`

### Symptom: one specific test fails

Check `test-results/<test-name>-chromium/error-context.md` — Playwright
captures a readable summary of the failure including the URL, the
DOM snapshot, and the trace timing.

### Symptom: perf bench fails but the rest pass

The perf bench is the most numerically sensitive test. If thresholds
are too tight for the runner's hardware, edit `tools/perf/perf-page.html`
CIEM thresholds (current values captured in
`docs/research-papers/v0.2-konva-perf-baseline.md`).

## What CANNOT be verified locally

Connection-refused on Linux + Playwright + chromium binding via
localhost cannot be reproduced reliably outside CI. The round-78
debug recipe (4 failed attempts) is in `CHANGELOG.md` for context.
If you are blocked locally, route the verification through this
workflow — do not attempt a fifth round of "fix the local config."

## When this doc needs to be updated

- A new CI job is added to `ci.yml` → update the table
- A new artifact path is captured → update the artifacts table
- A new failure mode surfaces → add a triage bullet
- The `playwright-e2e` step sequence changes → update step list
