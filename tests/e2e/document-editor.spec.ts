/**
 * Playwright E2E for DocumentEditor — ProseMirror text selection + code assignment.
 *
 * Uses the workspace fixture at /workspace.html which seeds a text document
 * ("Test Interview Transcript"), renders the DocumentEditor with ProseMirror,
 * and provides mock IPC handlers for annotations and codes.
 */

import { test, expect, type Page } from '@playwright/test';

const WORKSPACE_URL = 'http://127.0.0.1:57599/workspace.html';

async function gotoWorkspace(page: Page) {
  await page.goto(WORKSPACE_URL);
  // Wait for the document title to render (confirms DocumentEditor mounted).
  await expect(page.getByText('Test Interview Transcript')).toBeVisible({ timeout: 10_000 });
  // Reset mock state.
  await page.evaluate(() => {
    (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
  });
}

test.describe('DocumentEditor text coding', () => {
  test('assigns a code to selected text via code tree click', async ({ page }) => {
    await gotoWorkspace(page);

    // Create a code via IPC.
    await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_create', { projectId: 'proj-1', parentId: null, name: 'Test Code', color: '#ff0000' });
    });

    // Refresh the code tree so CodeTree renders the new code.
    const codes = await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_get_tree', 'proj-1');
    });
    await page.evaluate((c) => {
      const storeGet = (window as unknown as { useProjectStore?: { getState: () => { setCodes: (c: unknown[]) => void } } }).useProjectStore?.getState?.();
      if (storeGet) storeGet.setCodes(c as unknown[]);
    }, codes);

    // Wait for the code to appear in the tree.
    await expect(page.getByRole('button', { name: 'Select code Test Code' })).toBeVisible({ timeout: 5000 });

    // Inject a text selection via the Zustand uiStore — this is more robust
    // than fragile mouse-drag coordinates on ProseMirror's rendered text.
    // The CodeTree's handleClick reads uiStore.textSelection to decide
    // whether to assign a code or open the code view.
    await page.evaluate(() => {
      const storeGet = (window as unknown as { useUiStore?: { getState: () => { setTextSelection: (s: { startChar: number; endChar: number }) => void } } }).useUiStore?.getState?.();
      if (storeGet) storeGet.setTextSelection({ startChar: 0, endChar: 50 });
    });

    // Click the code tree node — with an active text selection, this assigns
    // the code to the selected range via annotationsIpc.create.
    await page.getByRole('button', { name: 'Select code Test Code' }).click();

    // Verify annotations_create IPC was called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string; args: unknown }> } })
        .__LENS_TEST__.invocations,
    );
    const createCalls = invocations.filter(i => i.cmd === 'annotations_create');
    expect(createCalls.length, 'annotations_create IPC count').toBe(1);

    const args = createCalls[0]!.args as { documentId: string; codeId: string; startChar: number; endChar: number };
    expect(args.documentId).toBe('doc-text-1');
    expect(args.startChar).toBe(0);
    expect(args.endChar).toBe(50);
  });

  test('document renders with ProseMirror content visible', async ({ page }) => {
    await gotoWorkspace(page);

    // Document title is visible.
    await expect(page.getByText('Test Interview Transcript')).toBeVisible();

    // ProseMirror editor is mounted.
    await expect(page.locator('.ProseMirror')).toBeVisible();

    // The seeded document text content should be visible.
    await expect(page.getByText('sample interview transcript')).toBeVisible({ timeout: 5000 });
  });

  test('clicking code without text selection opens code view', async ({ page }) => {
    await gotoWorkspace(page);

    // Create a code and refresh the tree.
    await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_create', { projectId: 'proj-1', parentId: null, name: 'ViewCode', color: '#0000ff' });
    });
    const codes = await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_get_tree', 'proj-1');
    });
    await page.evaluate((c) => {
      const storeGet = (window as unknown as { useProjectStore?: { getState: () => { setCodes: (c: unknown[]) => void } } }).useProjectStore?.getState?.();
      if (storeGet) storeGet.setCodes(c as unknown[]);
    }, codes);

    await expect(page.getByRole('button', { name: 'Select code ViewCode' })).toBeVisible({ timeout: 5000 });

    // Ensure NO text selection is active (reset clears it, but let's be explicit).
    await page.evaluate(() => {
      const storeGet = (window as unknown as { useUiStore?: { getState: () => { clearTextSelection: () => void } } }).useUiStore?.getState?.();
      if (storeGet) storeGet.clearTextSelection();
    });

    // Click the code — without text selection, this opens the code view.
    await page.getByRole('button', { name: 'Select code ViewCode' }).click();

    // No annotations_create IPC should have been called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'annotations_create').length).toBe(0);
  });
});
