/**
 * ProseMirror position bridge.
 *
 * LENS uses a schema: doc > paragraph > text
 * ProseMirror positions count the gaps between nodes and characters:
 *   0 = before doc
 *   1 = before first text character (i.e., char offset 0)
 *   2 = after first text character  (i.e., char offset 1)
 *
 * Therefore:
 *   ProseMirror_pos = char_offset + 1
 *   char_offset     = pm_pos - 1
 *
 * Verified via TextSelection.create() round-trip test at
 * src/utils/offset-utils.test.ts.
 */

export function charOffsetToPmPos(charOffset: number): number {
  return charOffset + 1;
}

export function pmPosToCharOffset(pmPos: number): number {
  return Math.max(0, pmPos - 1);
}
