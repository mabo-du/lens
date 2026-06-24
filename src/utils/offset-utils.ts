/**
 * ProseMirror position bridge.
 *
 * LENS uses a schema: doc > paragraph > text
 * ProseMirror positions count the gaps between nodes and characters:
 *   0 = before doc
 *   1 = before paragraph
 *   2 = before first text character
 *   3 = after first text character  (i.e. char offset 1)
 *
 * Therefore:
 *   ProseMirror_pos = char_offset + 2
 *   char_offset     = pm_pos - 2
 */

export function charOffsetToPmPos(charOffset: number): number {
  return charOffset + 2;
}

export function pmPosToCharOffset(pmPos: number): number {
  return Math.max(0, pmPos - 2);
}
