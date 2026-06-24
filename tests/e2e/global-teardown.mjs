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
 */

import { execFileSync } from 'node:child_process';

function killHttpServer() {
  const pid = process.env.LENS_E2E_HTTP_PID;
  if (pid) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`[lens-e2e] SIGTERM -> ${pid}`);
      return;
    } catch {
      // Already dead or unowned — fall through to pkill.
    }
  }
  try {
    execFileSync(
      'pkill',
      ['-f', 'http-server.*127\\.0\\.0\\.1.*57599'],
      { stdio: 'ignore' },
    );
    console.log('[lens-e2e] pkill -f http-server (fallback)');
  } catch {
    console.log('[lens-e2e] no http-server process found to kill (already clean)');
  }
}

killHttpServer();
