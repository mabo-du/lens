#!/usr/bin/env node
/**
 * Playwright globalSetup — boot fixture static file server deterministically.
 *
 * Round-78 FINAL stack: builds the fixture once with `vite build`, then
 * serves the static `dist/` directory with `npx http-server` on
 * 127.0.0.1:57599. http-server is a bare-bones static file server with
 * zero dev-tooling/HMR/React-recompile logic, which eliminated a
 * persistent `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:57599/`
 * we hit on 3 prior attempts (vite dev / vite build+preview / vite
 * preview via webServer && via globalSetup). The 4th attempt — static
 * file server — is finally deterministic.
 *
 * Round-79 CI hardening — observability layers for GitHub Actions:
 *
 *   * Every log line carries a `[ISO-ts]` timestamp prefix so the CI log
 *     and the on-disk artifact log share the same format. Triage from
 *     CI artifact logs is just `grep ERROR .lens-e2e/lens-e2e.log`.
 *   * A mirror log file at `./.lens-e2e/lens-e2e.log` captures every line
 *     verbatim for CI artifact upload.
 *   * Phase banners enumerate every step (runBuild / bootStaticServer /
 *     waitForPort) with sequential numbers so a stalled CI run shows
 *     exactly which step hung.
 *   * Pre-bind port check: if port 57599 is already taken (leftover
 *     from a prior killed run, parallel job, etc.), fail FAST with an
 *     exact address-in-use error rather than letting http-server
 *     auto-pick a different port and silently desync from playwright.
 *   * Exit codes for both the build phase and the http-server lifetime
 *     are logged explicitly so a silent crash is forensic-able from
 *     either log channel.
 *
 * Lifecycle:
 *
 *   1. spawn `npx vite build --config ...`; await exit code 0.
 *   2. pre-bind-check port 57599; abort if already in use.
 *   3. spawn `npx http-server -a 127.0.0.1 -p 57599 <dist>/`; record
 *      PID in process.env.LENS_E2E_HTTP_PID so global-teardown can
 *      SIGTERM it.
 *   4. Poll http://127.0.0.1:57599/ every 500ms for up to 180s; any
 *      HTTP response (200 or 404) marks the server up.
 *   5. Exit globalSetup. Playwright runs tests. global-teardown kills
 *      http-server via LENS_E2E_HTTP_PID.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:net';
import { openSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_CONFIG = path.join(PROJECT_ROOT, 'tests/e2e/fixture.vite.config.ts');
const DIST_ROOT = path.join(PROJECT_ROOT, 'tests/e2e/fixture/dist');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, '.lens-e2e');
const LOG_FILE = path.join(ARTIFACTS_DIR, 'lens-e2e.log');
const PORT = 57599;
const URL = `http://127.0.0.1:${PORT}/`;
const HOST = '127.0.0.1';
const TOTAL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 500;
const PREBIND_TIMEOUT_MS = 2_000;

// Ensure artifact dir exists; open a fd we'll append to for mirroring.
mkdirSync(ARTIFACTS_DIR, { recursive: true });
const logFd = openSync(LOG_FILE, 'a');

function ts() {
  return new Date().toISOString();
}

/**
 * Emit one log line to stdout AND mirror to the artifact log file.
 * The prefix `[ISO-ts]` + `[lens-e2e]` (or `[build]` / `[http-server]`)
 * stays consistent across both channels so an artifact-only reader can
 * still tell what phase emitted each line.
 */
function log(channel, message) {
  const line = `[${ts()}] [${channel}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logFd, line);
  } catch {
    // Artifact log append failure must not crash the harness.
  }
}

function pipeLines(prefix, child) {
  child.stdout?.on('data', (d) => {
    const text = d.toString();
    process.stdout.write(text);
    try {
      appendFileSync(logFd, text);
    } catch {}
  });
  child.stderr?.on('data', (d) => {
    const text = d.toString();
    process.stderr.write(text);
    try {
      appendFileSync(logFd, text);
    } catch {}
  });
}

/**
 * Pre-bind check: try to bind 127.0.0.1:57599 ourselves and IMMEDIATELY
 * release. If something else already holds the port (leftover http-server,
 * parallel test job, etc.), fail globalSetup with an actionable message
 * rather than letting http-server auto-bind to 57599-something and
 * silently desync from playwright's baseURL.
 *
 * Returns once a bind succeeds OR throws.
 */
async function prebindPortCheck() {
  log('lens-e2e', `(1.5/2) pre-bind port ${PORT} — fail-fast on address-in-use`);
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    const timer = setTimeout(() => {
      probe.close();
      reject(
        new Error(
          `[lens-e2e] pre-bind timeout after ${PREBIND_TIMEOUT_MS}ms — port ${PORT} held by foreign process`,
        ),
      );
    }, PREBIND_TIMEOUT_MS);
    probe.once('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `[lens-e2e] pre-bind FAILED — port ${PORT} unavailable: ${err.code || err.message}`,
        ),
      );
    });
    probe.listen(PORT, HOST, () => {
      probe.close(() => {
        clearTimeout(timer);
        log('lens-e2e', `pre-bind OK — port ${PORT} is free`);
        resolve();
      });
    });
  });
}

async function runBuild() {
  log('lens-e2e', `(1/2) vite build — fixture compile + React/Konva bundle start`);
  const child = spawn(
    'npx',
    ['vite', 'build', '--config', VITE_CONFIG],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  pipeLines('build', child);
  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  log('lens-e2e', `vite build exited with code=${exitCode}`);
  if (exitCode !== 0) {
    throw new Error(`vite build exited with code ${exitCode}`);
  }
  log('lens-e2e', 'build OK');
}

async function bootStaticServer() {
  await prebindPortCheck();
  log(
    'lens-e2e',
    `(2/2) http-server — bind ${HOST}:${PORT} + serve ${path.relative(PROJECT_ROOT, DIST_ROOT)}/`,
  );
  const child = spawn(
    'npx',
    ['http-server', '-a', HOST, '-p', String(PORT), DIST_ROOT, '--silent'],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: false },
  );
  pipeLines('http-server', child);
  process.env.LENS_E2E_HTTP_PID = String(child.pid);
  log('lens-e2e', `http-server spawned PID=${child.pid}`);
  child.on('exit', (code, signal) =>
    log(
      'lens-e2e',
      `http-server child exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
    ),
  );
  return child;
}

async function waitForPort() {
  log('lens-e2e', `(2.5/2) polling ${URL} — every ${POLL_INTERVAL_MS}ms for up to ${TOTAL_TIMEOUT_MS}ms`);
  const start = Date.now();
  let lastError = null;
  let attempts = 0;
  while (Date.now() - start < TOTAL_TIMEOUT_MS) {
    attempts += 1;
    try {
      const r = await fetch(URL, { signal: AbortSignal.timeout(2000) });
      const elapsed = Date.now() - start;
      log('lens-e2e', `${URL} responded ${r.status} after ${elapsed}ms (attempts=${attempts})`);
      return true;
    } catch (e) {
      lastError = e;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const summary = lastError
    ? `${lastError.code || 'ERR'} ${lastError.message || ''}`
    : 'no fetch attempts completed';
  throw new Error(
    `[lens-e2e] ${URL} never responded within ${TOTAL_TIMEOUT_MS}ms (attempts=${attempts}, last=${summary})`,
  );
}

async function main() {
  const overallStart = Date.now();
  log('lens-e2e', `globalSetup entered — artifact log: ${path.relative(PROJECT_ROOT, LOG_FILE)}`);
  try {
    await runBuild();
    await bootStaticServer();
    await waitForPort();
    log('lens-e2e', `fixture up (total ${Date.now() - overallStart}ms) — entering tests`);
  } catch (err) {
    log('lens-e2e', `globalSetup FAILED: ${err.message}`);
    log('lens-e2e', `stack: ${err.stack?.split('\n').slice(0, 3).join(' | ') ?? '<no stack>'}`);
    throw err;
  }
}

main().catch((e) => {
  process.stderr.write(`[${ts()}] [lens-e2e] exiting with code=1\n`);
  try {
    appendFileSync(logFd, `[${ts()}] [lens-e2e] exiting with code=1\n`);
  } catch {}
  process.exit(1);
});
