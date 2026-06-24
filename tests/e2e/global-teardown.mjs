#!/usr/bin/env node
/**
 * Playwright globalTeardown — kill fixture http-server.
 *
 * Round-78 global-setup.mjs sets `process.env.LENS_E2E_HTTP_PID` after
 * spawning the http-server child. This teardown reads it and sends
 * SIGTERM; falls back to pkill on the fixture command line if the PID
 * is gone or stale.
 *
 * Node 20 LTS .mjs note: ESM-only — use top-level imports, no require().
 * (Round-78 code-reviewer caught a `require('node:child_process')` inside
 * the function body that would have thrown ERR_REQUIRE_ESM at runtime.)
 *
 * Round-79 CI hardening — emits a four-state kill-receipt (PID-SIGTERM /
 * pkill-fallback / no-process / error) to both stdout and the artifact
 * log so CI failures can be triaged from either channel.
 */

import { execFileSync } from 'node:child_process';
import { openSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, '.lens-e2e');
const LOG_FILE = path.join(ARTIFACTS_DIR, 'lens-e2e.log');

let logFd = null;
try {
  logFd = openSync(LOG_FILE, 'a');
} catch {
  // If the artifact dir went missing between setup and teardown the
  // tear-down summary still needs to land on stdout.
}

function ts() {
  return new Date().toISOString();
}

function log(channel, message) {
  const line = `[${ts()}] [${channel}] ${message}\n`;
  process.stdout.write(line);
  if (logFd !== null) {
    try {
      appendFileSync(logFd, line);
    } catch {}
  }
}

function killHttpServer() {
  const pid = process.env.LENS_E2E_HTTP_PID;
  if (pid) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      log('lens-e2e', `SIGTERM -> PID ${pid} OK`);
      return 'pid-sigterm';
    } catch (e) {
      log('lens-e2e', `process.kill(${pid}, SIGTERM) failed: ${e.code ?? e.message}; falling back to pkill`);
    }
  } else {
    log('lens-e2e', 'LENS_E2E_HTTP_PID unset — falling back to pkill');
  }
  try {
    execFileSync(
      'pkill',
      ['-f', 'http-server.*127\\.0\\.0\\.1.*57599'],
      { stdio: 'ignore' },
    );
    log('lens-e2e', 'pkill -f http-server fallback OK');
    return 'pkill-fallback';
  } catch (e) {
    log(
      'lens-e2e',
      `no http-server process found (status=${e.status ?? 'unknown'}, message=${e.message ?? '<empty>'}) — already clean`,
    );
    return 'no-process';
  }
}

function writeKillReceipt(state) {
  // Always append a JSON receipt so scripts/perf-summary.mjs (future)
  // can ingest kill outcomes directly without parsing prose.
  const receiptPath = path.join(ARTIFACTS_DIR, 'kill-receipt.json');
  const receipt = {
    pid: process.env.LENS_E2E_HTTP_PID ?? null,
    kill: state,
    ts: ts(),
  };
  try {
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    log('lens-e2e', `kill-receipt written to ${path.relative(PROJECT_ROOT, receiptPath)} state=${state}`);
  } catch (e) {
    log('lens-e2e', `kill-receipt write failed: ${e.message}`);
  }
}

log('lens-e2e', 'globalTeardown entered');
const state = killHttpServer();
writeKillReceipt(state);
log('lens-e2e', 'globalTeardown complete');
