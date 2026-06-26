/**
 * Inter-coder reliability (ICR) — vitest coverage.
 *
 * Mirrors the spec in `src/utils/icr.ts` doc-comment:
 *   1. Expand each coder's spans into a binary character-level vector.
 *   2. Marginal coverage pA, pB.
 *   3. Observed agreement pO.
 *   4. Expected-by-chance pE = pA*pB + (1-pA)*(1-pB).
 *   5. kappa = (pO - pE) / (1 - pE), clipped to [-1, 1].
 *
 * Boundary semantics follow the implementation exactly: zero-length
 * spans are filtered out, out-of-bounds offsets are clamped, both
 * 0% and 100% symmetric coverage yield `null` (denominator collapses).
 */

import { describe, expect, it } from 'vitest';
import {
  annotationToBinaryVector,
  cohensKappa,
  disagreementSpans,
  kappaLabel,
  type IRAnnotation,
} from './icr';

/** Compact IRAnnotation builder so tests stay readable. */
const ann = (
  start: number,
  end: number,
  opts: Partial<Omit<IRAnnotation, 'startChar' | 'endChar'>> = {},
): IRAnnotation => ({
  codeId: opts.codeId ?? 'c1',
  documentId: opts.documentId ?? 'd1',
  startChar: start,
  endChar: end,
  createdBy: opts.createdBy ?? 'A',
});

/** Pretty-print a byte vector as a string of 1s and 0s for assertions. */
const bits = (v: Uint8Array): string =>
  Array.from(v, (b) => (b ? '1' : '0')).join('');

// ---------------------------------------------------------------------------
// annotationToBinaryVector
// ---------------------------------------------------------------------------

describe('annotationToBinaryVector', () => {
  it('returns all zeros for an empty annotation list', () => {
    const v = annotationToBinaryVector([], 'c1', 'd1', 10);
    expect(bits(v)).toBe('0000000000');
    expect(v.length).toBe(10);
  });

  it('produces the expected bit pattern for a single mid-document span', () => {
    const v = annotationToBinaryVector([ann(2, 5)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00111000');
  });

  it('handles a span starting at the document head', () => {
    const v = annotationToBinaryVector([ann(0, 3)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('11100000');
  });

  it('handles a span ending at the document tail', () => {
    const v = annotationToBinaryVector([ann(5, 8)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00000111');
  });

  it('UNION-merges two overlapping spans on the same code+document', () => {
    // Without dedup, two overlapping spans could double-set; we want OR.
    // A [2,6) covers positions 2..5; B [4,9) covers positions 4..8;
    // sort-then-sweep fills positions 2..8 with 1 (end-exclusive fills).
    const v = annotationToBinaryVector(
      [ann(2, 6), ann(4, 9)],
      'c1',
      'd1',
      12,
    );
    expect(bits(v)).toBe('001111111000');
  });

  it('respects disjoint vs. overlapping ordering: yields the union', () => {
    const v = annotationToBinaryVector(
      [ann(0, 3), ann(6, 9)],
      'c1',
      'd1',
      12,
    );
    expect(bits(v)).toBe('111000111000');
  });

  it('ignores annotations on a different codeId', () => {
    const v = annotationToBinaryVector([ann(2, 5, { codeId: 'other' })], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00000000');
  });

  it('ignores annotations on a different documentId', () => {
    const v = annotationToBinaryVector([ann(2, 5, { documentId: 'other' })], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00000000');
  });

  it('clamps negative startChar to 0', () => {
    const v = annotationToBinaryVector([ann(-3, 3)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('11100000');
  });

  it('clamps endChar above docLength to docLength', () => {
    const v = annotationToBinaryVector([ann(5, 12)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00000111');
  });

  it('drops zero-length spans (start === end)', () => {
    const v = annotationToBinaryVector([ann(3, 3), ann(4, 6)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00001100');
  });

  it('drops inverted spans (end < start)', () => {
    const v = annotationToBinaryVector([ann(6, 4), ann(2, 4)], 'c1', 'd1', 8);
    expect(bits(v)).toBe('00110000');
  });

  it('uses a sort-then-sweep so out-of-order input still yields the sorted union', () => {
    const v = annotationToBinaryVector(
      [ann(7, 10), ann(2, 4), ann(4, 7)],
      'c1',
      'd1',
      12,
    );
    expect(bits(v)).toBe('001111111100');
  });
});

// ---------------------------------------------------------------------------
// cohensKappa
// ---------------------------------------------------------------------------

describe('cohensKappa', () => {
  it('returns null when both coders cover 0% of the document', () => {
    const result = cohensKappa([], [], 'c1', 'd1', 10);
    expect(result).toBeNull();
  });

  it('returns null when both coders cover 100% of the document', () => {
    const result = cohensKappa([ann(0, 10)], [ann(0, 10)], 'c1', 'd1', 10);
    expect(result).toBeNull();
  });

  it('reports kappa = 1 when both coders produce identical spans', () => {
    // Identical 3-char spans on docLength=10: pA = pB = 0.3.
    //   pE = 0.3*0.3 + 0.7*0.7 = 0.09 + 0.49 = 0.58.
    //   agreement is total (same spans), so pO = 1.0; kappa = 1.
    const result = cohensKappa(
      [ann(2, 5)],
      [ann(2, 5)],
      'c1',
      'd1',
      10,
    );
    expect(result).not.toBeNull();
    expect(result!.kappa).toBeCloseTo(1.0, 9);
    expect(result!.labelled).toBe('almost perfect');
    expect(result!.coverageA).toBe(3);
    expect(result!.coverageB).toBe(3);
    expect(result!.expected).toBeCloseTo(0.3 * 0.3 + 0.7 * 0.7, 9);
  });

  it('reports a partial-overlap kappa with the textbook formula', () => {
    // docLength=10. A covers [0,5] (50%), B covers [3,8] (50%).
    //   - agree: positions 3,4 (both 1); positions 8,9 (both 0) = 4 agreements.
    //   - pO = 0.4, pA = pB = 0.5, pE = 0.5.
    //   - kappa = (0.4 - 0.5) / (1 - 0.5) = -0.2 — and since k < 0,
    //     Landis & Koch bucket is "poor".
    const result = cohensKappa(
      [ann(0, 5)],
      [ann(3, 8)],
      'c1',
      'd1',
      10,
    );
    expect(result).not.toBeNull();
    expect(result!.kappa).toBeCloseTo(-0.2, 9);
    expect(result!.labelled).toBe('poor');
    expect(result!.coverageA).toBe(5);
    expect(result!.coverageB).toBe(5);
    expect(result!.agreement).toBeCloseTo(0.4, 9);
    expect(result!.expected).toBeCloseTo(0.5, 9);
  });

  it('reports a positive kappa for substantial agreement', () => {
    // docLength=20. A [0,8] (40%), B [2,12] (50%).
    //   - agree: positions 2..7 (6 chars, both 1). positions 12..19 (8 chars, both 0). = 14.
    //   - pO = 14/20 = 0.7; pA = 0.4; pB = 0.5.
    //   - pE = 0.4*0.5 + 0.6*0.5 = 0.2 + 0.3 = 0.5.
    //   - kappa = (0.7 - 0.5) / 0.5 = 0.4.
    const result = cohensKappa(
      [ann(0, 8)],
      [ann(2, 12)],
      'c1',
      'd1',
      20,
    );
    expect(result!.kappa).toBeCloseTo(0.4, 9);
    expect(result!.labelled).toBe('fair');
  });

  it('clamps kappa into [-1, 1] even when internal arithmetic overshoots', () => {
    // Force a constructed case where the WHOLE doc disagrees but that's impossible
    // inside the helper; here we just verify the API never returns >1 or <-1.
    const result = cohensKappa(
      [ann(0, 5)],
      [ann(5, 10)],
      'c1',
      'd1',
      10,
    );
    expect(result).not.toBeNull();
    expect(result!.kappa).toBeGreaterThanOrEqual(-1);
    expect(result!.kappa).toBeLessThanOrEqual(1);
  });

  it('counts coverage per coder independently of overlap', () => {
    // A coverage 4, B coverage 6, overlap 2.
    const result = cohensKappa(
      [ann(0, 4)],
      [ann(2, 8)],
      'c1',
      'd1',
      10,
    );
    expect(result!.coverageA).toBe(4);
    expect(result!.coverageB).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// kappaLabel
// ---------------------------------------------------------------------------

describe('kappaLabel (Landis & Koch 1977 buckets)', () => {
  it('classifies strictly negative kappa as "poor"', () => {
    expect(kappaLabel(-0.5)).toBe('poor');
    expect(kappaLabel(-1)).toBe('poor');
  });

  it('classifies 0..0.20 inclusive as "slight"', () => {
    expect(kappaLabel(0)).toBe('slight');
    expect(kappaLabel(0.1)).toBe('slight');
    expect(kappaLabel(0.2)).toBe('slight');
  });

  it('classifies 0.21..0.40 as "fair"', () => {
    expect(kappaLabel(0.21)).toBe('fair');
    expect(kappaLabel(0.4)).toBe('fair');
  });

  it('classifies 0.41..0.60 as "moderate"', () => {
    expect(kappaLabel(0.41)).toBe('moderate');
    expect(kappaLabel(0.6)).toBe('moderate');
  });

  it('classifies 0.61..0.80 as "substantial"', () => {
    expect(kappaLabel(0.61)).toBe('substantial');
    expect(kappaLabel(0.8)).toBe('substantial');
  });

  it('classifies 0.81..1.00 inclusive as "almost perfect"', () => {
    expect(kappaLabel(0.81)).toBe('almost perfect');
    expect(kappaLabel(1)).toBe('almost perfect');
  });
});

// ---------------------------------------------------------------------------
// disagreementSpans
// ---------------------------------------------------------------------------

describe('disagreementSpans', () => {
  it('returns an empty array when both coders have no annotations', () => {
    expect(disagreementSpans([], [], 'c1', 'd1', 10)).toEqual([]);
  });

  it('returns no ranges when both coders produce identical spans', () => {
    expect(
      disagreementSpans([ann(2, 5)], [ann(2, 5)], 'c1', 'd1', 10),
    ).toEqual([]);
  });

  it('returns one range for a single disagreement region', () => {
    // A [0,3] covered; B [3,6] covered.
    //   disagree positions: 0..2 (a=1,b=0), 3 (a=0,b=1)... = 0..6 inclusive-exclusive.
    expect(
      disagreementSpans([ann(0, 3)], [ann(3, 6)], 'c1', 'd1', 10),
    ).toEqual([[0, 6]]);
  });

  it('returns disjoint ranges for two disjoint disagreement regions', () => {
    // A covers nothing; B covers [3,5] and [7,9] on docLength=10.
    //   - agree: positions 0..2, 5..6, 9.
    //   - disagree regions: positions 3..4 and 7..8.
    expect(
      disagreementSpans([], [ann(3, 5), ann(7, 9)], 'c1', 'd1', 10),
    ).toEqual([[3, 5], [7, 9]]);
  });

  it('closes the trailing DISAGREE-on-the-tail region at docLength', () => {
    // A covers nothing; B covers last 3 chars.
    //   disagree: positions 7..9 = [7, 10].
    expect(
      disagreementSpans([], [ann(7, 10)], 'c1', 'd1', 10),
    ).toEqual([[7, 10]]);
  });

  it('produces one full-doc range when the coders fully disagree', () => {
    // A covers everything; B covers nothing.
    expect(
      disagreementSpans([ann(0, 10)], [], 'c1', 'd1', 10),
    ).toEqual([[0, 10]]);
  });
});
