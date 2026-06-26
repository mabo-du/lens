/**
 * Vitest contract coverage for `src/hooks/useAssetBlobUrl.ts`.
 *
 * Follows the project's source-inspection pattern (same approach as
 * ImageViewer.test.ts and DocumentList.test.ts): regex-level assertions
 * on the source file verify the hook's shape, imports, and lifecycle
 * contract without needing a DOM environment (jsdom).
 *
 * The hook's runtime behaviour (fetch→blob→URL→revoke) is exercised
 * through the Playwright workspace fixture where real Tauri IPC handles
 * asset delivery end-to-end.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('useAssetBlobUrl contract', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, './useAssetBlobUrl.ts'),
    'utf8',
  );

  it('is exported by name (catches rename)', () => {
    expect(src).toMatch(/export function useAssetBlobUrl\b/);
  });

  it('imports documentsIpc for asset fetching', () => {
    expect(src).toMatch(/import \{ documentsIpc \} from ['"]@\/ipc\/documents['"]/);
  });

  it('uses useEffect for side-effect orchestration', () => {
    expect(src).toMatch(/useEffect\(/);
  });

  it('uses useState for url tracking', () => {
    expect(src).toMatch(/useState<string \| undefined>\(undefined\)/);
  });

  it('calls documentsIpc.getAsset with documentId', () => {
    expect(src).toMatch(/documentsIpc\s*\.\s*getAsset\s*\(\s*documentId\s*\)/);
  });

  it('returns undefined when documentId is falsy', () => {
    expect(src).toMatch(/if \(\s*!\s*documentId\s*\)\s*\{/);
    expect(src).toMatch(/setUrl\(undefined\)/);
  });

  it('converts base64 payload to a Blob via Uint8Array', () => {
    expect(src).toMatch(/atob\(asset\.b64\)/);
    expect(src).toMatch(/Uint8Array\.from\(/);
    expect(src).toMatch(/URL\.createObjectURL\(blob\)/);
  });

  it('revokes blob URL on cleanup (useEffect return)', () => {
    // Must have cleanup that revokes the blob URL — either via
    // a local `blobUrl` captured in closure, or via the url state.
    expect(src).toMatch(/URL\.revokeObjectURL\(/);
  });

  it('handles cancellation via boolean flag', () => {
    // The cancelled flag prevents setUrl after unmount/id-change.
    expect(src).toMatch(/let cancelled = false/);
    expect(src).toMatch(/cancelled = true/);
  });

  it('catches errors silently (no crash on missing asset)', () => {
    // The .catch handler must not re-throw.
    expect(src).toMatch(/\.catch\(/);
  });

  it('uses [documentId] as the sole useEffect dependency', () => {
    // The dependency array should only contain documentId.
    expect(src).toMatch(/\}\s*,\s*\[\s*documentId\s*\]\s*\)/);
  });

  it('accepts string | undefined as documentId parameter', () => {
    expect(src).toMatch(
      /documentId:\s*string\s*\|\s*undefined/,
    );
  });

  it('returns string | undefined', () => {
    expect(src).toMatch(
      /:\s*string\s*\|\s*undefined\s*\{/,
    );
  });
});
