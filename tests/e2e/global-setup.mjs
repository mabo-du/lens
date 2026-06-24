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
 * Lifecycle:
 *
 *   1. spawn `npx vite build --config ...`; await exit code 0.
 *   2. spawn `npx http-server -a 127.0.0.1 -p 57599 <dist>/`; record PID
 *      in process.env.LENS_E2E_HTTP_PID so global-teardown can SIGTERM it.
 *   3. Poll http://127.0.0.1:57599/ every 500ms for up to 180s; any HTTP
 *      response (200 or 404) marks the server up.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_CONFIG = path.join(PROJECT_ROOT, 'tests/e2e/fixture.vite.config.ts');
const DIST_ROOT = path.join(PROJECT_ROOT, 'tests/e2e/fixture/dist');
const PORT = 57599;
const URL = `http://127.0.0.1:${PORT}/`;
const TOTAL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 500;

function pipeLines(prefix, child) {
  child.stdout?.on('data', (d) =>
    process.stdout.write(`[${prefix}] ${d.toString().replace(/\n$/, '\n')}`),
  );
  child.stderr?.on('data', (d) =>
    process.stderr.write(`[${prefix}:err] ${d.toString().replace(/\n$/, '\n')}`),
  );
}

async function runBuild() {
  console.log('\n[lens-e2e] (1/2) vite build — fixture compile + React/Konva bundle\n');
  const child = spawn(
    'npx',
    ['vite', 'build', '--config', VITE_CONFIG],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  pipeLines('build', child);
  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  if (exitCode !== 0) {
    throw new Error(`vite build exited with code ${exitCode}`);
  }
  console.log('\n[lens-e2e] build OK\n');
}

async function bootStaticServer() {
  console.log('\n[lens-e2e] (2/2) http-server — bind 127.0.0.1:57599 + serve dist/\n');
  const child = spawn(
    'npx',
    ['http-server', '-a', '127.0.0.1', '-p', '57599', DIST_ROOT, '--silent'],
    { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: false },
  );
  pipeLines('http-server', child);
  process.env.LENS_E2E_HTTP_PID = String(child.pid);
  console.log(`[lens-e2e] http-server PID=${child.pid}`);
  child.on('exit', (code) =>
    console.log(`[lens-e2e] http-server child exited code=${code}`),
  );
  return child;
}

async function waitForPort() {
  const start = Date.now();
  while (Date.now() - start < TOTAL_TIMEOUT_MS) {
    try {
      const r = await fetch(URL, { signal: AbortSignal.timeout(2000) });
      // Any response (200 OK on a routed path, 404 on unknown) means the
      // server is bound and accepting connections.
      console.log(`[lens-e2e] ${URL} responded ${r.status} after ${Date.now() - start}ms`);
      return true;
    } catch {
      // Not yet — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`[lens-e2e] ${URL} never responded within ${TOTAL_TIMEOUT_MS}ms`);
}

async function main() {
  const overallStart = Date.now();
  await runBuild();
  await bootStaticServer();
  await waitForPort();
  console.log(`\n[lens-e2e] fixture up (total ${Date.now() - overallStart}ms)\n`);
}

main().catch((e) => {
  console.error('[lens-e2e] global-setup FAILED:', e);
  process.exit(1);
});
