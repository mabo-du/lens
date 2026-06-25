/**
 * Inter-coder reliability (ICR) — character-level Cohen's kappa.
 *
 * Driven by the LENS_Implementation_Plan §7.1 spec. The library is
 * dependency-free (no Kappa or stats libs in package.json yet) and
 * works on per-code, per-document (coderA, coderB) annotation lists.
 *
 * The algorithm:
 *   1. Expand each coder's spans into a binary character-level vector
 *      over the document's `plainText`.
 *   2. Compute the two marginals pA and pB (fraction of characters each
 *      coder covered).
 *   3. Compute the observed agreement pO (characters both coded or both
 *      uncoded).
 *   4. Compute expected-by-chance pE = pA*pB + (1-pA)*(1-pB).
 *   5. Return kappa = (pO - pE) / (1 - pE), clipped to [-1, 1].
 *
 * Interpretation guide (Landis & Koch 1977):
 *     < 0       poor
 *     0.00-0.20 slight
 *     0.21-0.40 fair
 *     0.41-0.60 moderate
 *     0.61-0.80 substantial
 *     0.81-1.00 almost perfect
 */

/** A code annotation with mandatory char offsets and document context. */
export interface IRAnnotation {
  codeId: string;
  documentId: string;
  startChar: number;
  endChar: number;
  createdBy: string;
}

export interface IRResult {
  coverageA: number; // chars coded by A
  coverageB: number; // chars coded by B
  agreement: number; // pO (0..1)
  expected: number; // pE (0..1), chance agreement
  kappa: number; // coefficient
  labelled: string; // Landis & Koch label
}

/**
 * Project an annotation list to a binary vector of length `docLength`
 * where 1 = this character is covered by any annotation for the given code.
 *
 * O(n + docLength) sort-then-sweep; no quadratic loops.
 */
export function annotationToBinaryVector(
  annotations: IRAnnotation[],
  codeId: string,
  documentId: string,
  docLength: number,
): Uint8Array {
  const out = new Uint8Array(docLength);
  const spans = annotations
    .filter((a) => a.codeId === codeId && a.documentId === documentId)
    .map((a) => ({ start: Math.max(0, a.startChar), end: Math.min(docLength, a.endChar) }))
    .filter((s) => s.end > s.start)
    .sort((x, y) => x.start - y.start);

  let cursor = 0;
  for (const span of spans) {
    cursor = Math.max(cursor, span.start);
    if (cursor < span.end) {
      out.fill(1, cursor, span.end);
      cursor = span.end;
    }
  }
  return out;
}

/**
 * Compute Cohen's kappa for a single (code, document) pair across two
 * coders' annotation lists.
 *
 * Returns null when the denominator collapses (both coders covered
 * exactly the same fraction AND that fraction is 0 or 1 — the situation
 * is conventionally undefined).
 */
export function cohensKappa(
  spansA: IRAnnotation[],
  spansB: IRAnnotation[],
  codeId: string,
  documentId: string,
  docLength: number,
): IRResult | null {
  const a = annotationToBinaryVector(spansA, codeId, documentId, docLength);
  const b = annotationToBinaryVector(spansB, codeId, documentId, docLength);

  let coveredA = 0;
  let coveredB = 0;
  let agreement = 0;
  for (let i = 0; i < docLength; i++) {
    const av = a[i];
    const bv = b[i];
    coveredA += av;
    coveredB += bv;
    agreement += av === bv ? 1 : 0;
  }
  const pO = agreement / docLength;
  const pA = coveredA / docLength;
  const pB = coveredB / docLength;
  const pE = pA * pB + (1 - pA) * (1 - pB);
  const denom = 1 - pE;
  if (denom <= 1e-9) return null;
  const k = (pO - pE) / denom;
  return {
    coverageA: coveredA,
    coverageB: coveredB,
    agreement: pO,
    expected: pE,
    kappa: Math.max(-1, Math.min(1, k)),
    labelled: kappaLabel(Math.max(-1, Math.min(1, k))),
  };
}

/** Landis & Koch (1977) interpretation buckets. */
export function kappaLabel(k: number): string {
  if (k < 0) return 'poor';
  if (k <= 0.2) return 'slight';
  if (k <= 0.4) return 'fair';
  if (k <= 0.6) return 'moderate';
  if (k <= 0.8) return 'substantial';
  return 'almost perfect';
}

/**
 * Baton-pass conflict cost — returns characters on which the two
 * coders disagree. Range algebra on the binary vectors is
 * `~((a XOR b) MASK = (a != b))` so we just XOR.
 */
export function disagreementSpans(
  spansA: IRAnnotation[],
  spansB: IRAnnotation[],
  codeId: string,
  documentId: string,
  docLength: number,
): Array<[number, number]> {
  const a = annotationToBinaryVector(spansA, codeId, documentId, docLength);
  const b = annotationToBinaryVector(spansB, codeId, documentId, docLength);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < docLength; i++) {
    const disagree = a[i] !== b[i];
    if (disagree && start === null) start = i;
    if (!disagree && start !== null) {
      out.push([start, i]);
      start = null;
    }
  }
  if (start !== null) out.push([start, docLength]);
  return out;
}
