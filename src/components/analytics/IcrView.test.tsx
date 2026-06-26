/**
 * IcrView.test.tsx — unit tests for MatrixView sort/filter logic.
 *
 * Tests the exported sortMatrixRows / filterMatrixByMinKappa functions
 * from IcrView.tsx. No DOM rendering required — pure function tests.
 */
import { describe, it, expect } from 'vitest';
import type { IcrResultRow } from '@/ipc/analytics';
import {
  sortMatrixRows,
  filterMatrixByMinKappa,
  MATRIX_LABEL_RANK,
  type MatrixSortCol,
} from './IcrView';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function row(overrides: Partial<IcrResultRow> = {}): IcrResultRow {
  return {
    coderA: 'coder-a',
    coderB: 'coder-b',
    codeId: 'code-1',
    documentId: 'doc-1',
    result: { coverageA: 10, coverageB: 10, agreement: 0.8, expected: 0.5, kappa: 0.6, labelled: 'moderate' },
    ...overrides,
  };
}

function rows(
  count: number,
  fn: (i: number) => Partial<IcrResultRow> = () => ({}),
): IcrResultRow[] {
  return Array.from({ length: count }, (_, i) => row(fn(i)));
}

// ---------------------------------------------------------------------------
// Sort tests
// ---------------------------------------------------------------------------

describe('sortMatrixRows', () => {
  it('returns unsorted copy when col/dir is null', () => {
    const input = rows(3, (i) => ({ codeId: `c${3 - i}` }));
    const output = sortMatrixRows(input, null as unknown as MatrixSortCol, null, (id) => id, (id) => id);
    expect(output[0].codeId).toBe('c3');
    expect(output[1].codeId).toBe('c2');
    expect(output[2].codeId).toBe('c1');
  });

  it('sorts by kappa descending', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.2, labelled: 'slight' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.7, expected: 0.3, kappa: 0.5, labelled: 'moderate' } }),
    ];
    const output = sortMatrixRows(input, 'kappa', 'desc', (id) => id, (id) => id);
    expect(output[0].result!.kappa).toBe(0.8);
    expect(output[1].result!.kappa).toBe(0.5);
    expect(output[2].result!.kappa).toBe(0.2);
  });

  it('sorts by kappa ascending', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.2, labelled: 'slight' } }),
    ];
    const output = sortMatrixRows(input, 'kappa', 'asc', (id) => id, (id) => id);
    expect(output[0].result!.kappa).toBe(0.2);
    expect(output[1].result!.kappa).toBe(0.8);
  });

  it('sorts by coderA lexicographically', () => {
    const input = [
      row({ coderA: 'zeta' }),
      row({ coderA: 'alpha' }),
      row({ coderA: 'beta' }),
    ];
    const output = sortMatrixRows(input, 'coderA', 'asc', (id) => id, (id) => id);
    expect(output[0].coderA).toBe('alpha');
    expect(output[1].coderA).toBe('beta');
    expect(output[2].coderA).toBe('zeta');
  });

  it('sorts by codeId using name lookup', () => {
    const names: Record<string, string> = { c3: 'Zebra', c1: 'Alpha', c2: 'Beta' };
    const input = rows(3, (i) => ({ codeId: `c${3 - i}` }));
    const output = sortMatrixRows(input, 'codeId', 'asc', (id) => names[id] ?? id, (id) => id);
    expect(output[0].codeId).toBe('c1');
    expect(output[1].codeId).toBe('c2');
    expect(output[2].codeId).toBe('c3');
  });

  it('sorts by label rank correctly', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.3, expected: 0.3, kappa: 0.0, labelled: 'slight' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.3, labelled: 'fair' } }),
    ];
    const output = sortMatrixRows(input, 'labelled', 'asc', (id) => id, (id) => id);
    expect(output[0].result!.labelled).toBe('slight');
    expect(output[1].result!.labelled).toBe('fair');
    expect(output[2].result!.labelled).toBe('almost perfect');
  });

  it('handles null results (undefined kappa) at the bottom when sorting desc', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: null }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.2, labelled: 'slight' } }),
    ];
    const output = sortMatrixRows(input, 'kappa', 'desc', (id) => id, (id) => id);
    expect(output[0].result!.kappa).toBe(0.8);
    expect(output[1].result!.kappa).toBe(0.2);
    expect(output[2].result).toBeNull();
  });

  it('handles null results with label sort (no NaN)', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: null }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.3, expected: 0.3, kappa: 0.0, labelled: 'slight' } }),
    ];
    // Should not throw — just verify the sort produces a result
    const output = sortMatrixRows(input, 'labelled', 'asc', (id) => id, (id) => id);
    // Null-result rows should sort first (rank 0 via MATRIX_LABEL_RANK[''] ?? 0)
    expect(output[0].result).toBeNull();
    expect(output[1].result!.labelled).toBe('slight');
    expect(output[2].result!.labelled).toBe('almost perfect');
  });

  it('uses MATRIX_LABEL_RANK for label sorting', () => {
    // Verify the rank constant is accessible and matches expectations.
    expect(MATRIX_LABEL_RANK['poor']).toBe(1);
    expect(MATRIX_LABEL_RANK['almost perfect']).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Filter tests
// ---------------------------------------------------------------------------

describe('filterMatrixByMinKappa', () => {
  it('shows all rows when threshold is -1', () => {
    const input = rows(5, (i) => ({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: -0.3 + i * 0.3, labelled: 'slight' } }));
    expect(filterMatrixByMinKappa(input, -1)).toHaveLength(5);
  });

  it('filters out rows below threshold', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.2, labelled: 'slight' } }),
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.7, expected: 0.3, kappa: 0.5, labelled: 'moderate' } }),
    ];
    const filtered = filterMatrixByMinKappa(input, 0.5);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.result!.kappa >= 0.5)).toBe(true);
  });

  it('excludes null-result rows when threshold is >0', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: null }),
    ];
    const filtered = filterMatrixByMinKappa(input, 0.3);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].result).not.toBeNull();
  });

  it('includes null-result rows when threshold is 0', () => {
    const input = [
      row({ result: { coverageA: 1, coverageB: 1, agreement: 0.9, expected: 0.3, kappa: 0.8, labelled: 'almost perfect' } }),
      row({ result: null }),
    ];
    const filtered = filterMatrixByMinKappa(input, 0);
    expect(filtered).toHaveLength(2);
  });

  it('returns empty array when all rows are below threshold', () => {
    const input = rows(3, () => ({ result: { coverageA: 1, coverageB: 1, agreement: 0.5, expected: 0.3, kappa: 0.1, labelled: 'slight' } }));
    const filtered = filterMatrixByMinKappa(input, 0.9);
    expect(filtered).toHaveLength(0);
  });
});
