/**
 * Playwright E2E for CodeTree — CRUD operations on codes.
 *
 * Uses the workspace fixture at /workspace.html which renders the CodeTree
 * component with mock IPC handlers for codes_create, codes_update,
 * codes_delete, and codes_get_tree.
 */

import { test, expect, type Page } from '@playwright/test';

const WORKSPACE_URL = 'http://127.0.0.1:57599/workspace.html';

async function gotoWorkspace(page: Page) {
  await page.goto(WORKSPACE_URL);
  // Wait for CodeTree header to render.
  await expect(page.getByRole('heading', { name: 'Codes' })).toBeVisible({ timeout: 10_000 });
  // Reset mock state.
  await page.evaluate(() => {
    (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
    // Also clear codes from project store so CodeTree reflects empty state.
    const store = (window as unknown as {
      useProjectStore: { getState: () => { setCodes: (c: unknown[]) => void } };
    }).useProjectStore?.getState?.();
    if (store?.setCodes) store.setCodes([]);
  });
}

test.describe('CodeTree CRUD', () => {
  test('creates a new code via the New Code button and dialog', async ({ page }) => {
    await gotoWorkspace(page);

    // Should show empty state.
    await expect(page.getByText('No codes yet.')).toBeVisible();

    // Click the New Code (+) button.
    // dispatchEvent bypasses Base UI's data-base-ui-inert click interception.
    await page.getByTitle('New Code').dispatchEvent('click');

    // CodeDialog should open.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });

    // Fill in the name.
    await page.getByLabel('Name').fill('My Code');

    // Click Save Code button.
    await page.getByRole('button', { name: 'Save Code' }).dispatchEvent('click');

    // Dialog closes; code should appear in the tree.
    await expect(page.getByRole('button', { name: 'Select code My Code' })).toBeVisible({ timeout: 5000 });

    // Verify codes_create IPC was called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string; args: unknown }> } })
        .__LENS_TEST__.invocations,
    );
    const createCalls = invocations.filter(i => i.cmd === 'codes_create');
    expect(createCalls.length).toBe(1);
    expect((createCalls[0]!.args as { name: string }).name).toBe('My Code');
  });

  test('deletes a code via right-click context menu', async ({ page }) => {
    await gotoWorkspace(page);

    // Create a code via IPC first.
    await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_create', { projectId: 'proj-1', parentId: null, name: 'DeleteMe', color: '#ff0000' });
    });
    // Refresh tree.
    const codes = await page.evaluate(() => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };
      return w.__TAURI_INTERNALS__.invoke('codes_get_tree', 'proj-1');
    });
    await page.evaluate((c) => {
      const store = (window as unknown as {
        useProjectStore: { getState: () => { setCodes: (c: unknown[]) => void } };
      }).useProjectStore?.getState?.();
      if (store?.setCodes) store.setCodes(c as unknown[]);
    }, codes);

    await expect(page.getByRole('button', { name: 'Select code DeleteMe' })).toBeVisible({ timeout: 5000 });

    // Right-click the code node to open context menu.
    // dispatchEvent('contextmenu') bypasses Base UI's data-base-ui-inert interception.
    await page.getByRole('button', { name: 'Select code DeleteMe' }).dispatchEvent('contextmenu');

    // Register dialog handler BEFORE clicking Delete — the confirm dialog
    // fires synchronously from a React effect after setDeleteNode is called.
    page.once('dialog', dialog => dialog.accept());

    // Click "Delete Code" in the context menu.
    await page.getByText('Delete Code').dispatchEvent('click');

    // Wait for the delete to process — code should disappear.
    // After deletion, tree refreshes and code is gone.
    await expect(page.getByRole('button', { name: 'Select code DeleteMe' })).not.toBeVisible({ timeout: 5000 });

    // Verify codes_delete IPC was called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'codes_delete').length).toBe(1);
  });

  test('empty state shows when no codes exist', async ({ page }) => {
    await gotoWorkspace(page);

    await expect(page.getByText('No codes yet.')).toBeVisible();
  });
});
