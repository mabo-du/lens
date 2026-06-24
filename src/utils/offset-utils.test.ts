import { describe, it, expect } from 'vitest';
import { charOffsetToPmPos, pmPosToCharOffset } from './offset-utils';

describe('offset-utils', () => {
  describe('charOffsetToPmPos', () => {
    it('maps char offset 0 to ProseMirror position 2', () => {
      // Schema: doc > paragraph > text
      // Position 0 = before doc
      // Position 1 = before paragraph
      // Position 2 = first character
      expect(charOffsetToPmPos(0)).toBe(2);
    });

    it('increments by 1 for each character offset', () => {
      expect(charOffsetToPmPos(5)).toBe(7);
      expect(charOffsetToPmPos(100)).toBe(102);
    });
  });

  describe('pmPosToCharOffset', () => {
    it('maps ProseMirror position 2 back to char offset 0', () => {
      expect(pmPosToCharOffset(2)).toBe(0);
    });

    it('is the inverse of charOffsetToPmPos for positive values', () => {
      for (let i = 0; i < 100; i++) {
        expect(pmPosToCharOffset(charOffsetToPmPos(i))).toBe(i);
      }
    });

    it('clamps negative results to 0', () => {
      expect(pmPosToCharOffset(0)).toBe(0);
      expect(pmPosToCharOffset(-1)).toBe(0);
    });
  });

  describe('round-trip consistency', () => {
    it('preserves offsets through forward and backward conversion', () => {
      const testOffsets = [0, 1, 5, 10, 42, 100, 1000];
      for (const offset of testOffsets) {
        const pmPos = charOffsetToPmPos(offset);
        const back = pmPosToCharOffset(pmPos);
        expect(back).toBe(offset);
      }
    });
  });
});
