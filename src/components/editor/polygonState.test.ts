import { describe, it, expect } from 'vitest';
import {
  pushVertex,
  canCommit,
  isSnapToClose,
  snappedCursor,
  livePreviewPoints,
  draftLinePoints,
  draftShouldClose,
  modeSwitchReset,
  MIN_POLYGON_VERTICES,
  MAX_POLYGON_VERTICES,
  SNAP_RADIUS_PX,
  type Vertex,
} from './polygonState';

// Convenience: build a small triangle at known coords.
const TRIANGLE: Vertex[] = [
  { x: 100, y: 50 },
  { x: 200, y: 200 },
  { x: 50, y: 200 },
];

describe('polygonState', () => {
  describe('constants', () => {
    it('exposes the expected constants', () => {
      expect(MIN_POLYGON_VERTICES).toBe(3);
      expect(MAX_POLYGON_VERTICES).toBe(64);
      expect(SNAP_RADIUS_PX).toBe(12);
    });
  });

  describe('pushVertex', () => {
    it('appends to the end of the array', () => {
      const out = pushVertex([{ x: 1, y: 2 }], { x: 3, y: 4 });
      expect(out).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    });

    it('does not mutate the input array', () => {
      const input: Vertex[] = [{ x: 1, y: 2 }];
      const inputRef = input;
      pushVertex(input, { x: 3, y: 4 });
      expect(input).toBe(inputRef);
      expect(input.length).toBe(1);
    });

    it('returns a new array (different reference)', () => {
      const input: Vertex[] = [];
      const out = pushVertex(input, { x: 0, y: 0 });
      expect(out).not.toBe(input);
    });
  });

  describe('canCommit', () => {
    it('rejects 0, 1, 2 vertices', () => {
      expect(canCommit([])).toBe(false);
      expect(canCommit([{ x: 0, y: 0 }])).toBe(false);
      expect(canCommit([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    });

    it('accepts exactly 3 vertices (boundary)', () => {
      expect(canCommit(TRIANGLE)).toBe(true);
    });

    it('accepts up to and including MAX_POLYGON_VERTICES', () => {
      const up = 64;
      expect(canCommit(Array.from({ length: up }, () => ({ x: 1, y: 1 })))).toBe(true);
    });

    it('rejects MAX_POLYGON_VERTICES + 1', () => {
      expect(canCommit(Array.from({ length: 65 }, () => ({ x: 1, y: 1 })))).toBe(false);
    });
  });

  describe('isSnapToClose', () => {
    it('returns false when fewer than MIN_POLYGON_VERTICES placed', () => {
      expect(isSnapToClose([], { x: 100, y: 50 })).toBe(false);
      expect(isSnapToClose([TRIANGLE[0]], { x: 100, y: 50 })).toBe(false);
      expect(isSnapToClose([TRIANGLE[0], TRIANGLE[1]], { x: 100, y: 50 })).toBe(false);
    });

    it('returns false when cursor is null', () => {
      expect(isSnapToClose(TRIANGLE, null)).toBe(false);
    });

    it('returns false when cursor is more than SNAP_RADIUS_PX away from v0', () => {
      // v0 = (100, 50). Cursor at (130, 50) is 30 px away when the radius is 12.
      expect(isSnapToClose(TRIANGLE, { x: 130, y: 50 })).toBe(false);
    });

    it('returns true at exactly the snap radius (distance = SNAP_RADIUS_PX)', () => {
      // v0 = (100, 50). Cursor at (100, 62) is sqrt(0 + 144) = 12 px.
      expect(isSnapToClose(TRIANGLE, { x: 100, y: 62 })).toBe(true);
    });

    it('returns true just inside the snap zone (distance < SNAP_RADIUS_PX)', () => {
      // v0 = (100, 50). Cursor at (100, 60) is 10 px.
      expect(isSnapToClose(TRIANGLE, { x: 100, y: 60 })).toBe(true);
    });

    it('returns false just outside the snap zone (distance > SNAP_RADIUS_PX by 1 px)', () => {
      // v0 = (100, 50). Cursor at (100, 63) is 13 px (12 + 1).
      expect(isSnapToClose(TRIANGLE, { x: 100, y: 63 })).toBe(false);
    });

    it('uses squared distance correctly (off-axis)', () => {
      // v0 = (100, 50). Pyt of 8 right + 8 down = sqrt(64 + 64) = sqrt(128) ≈ 11.31, inside zone.
      expect(isSnapToClose(TRIANGLE, { x: 108, y: 58 })).toBe(true);
      // 9 right + 9 down = sqrt(81 + 81) = sqrt(162) ≈ 12.73, outside.
      expect(isSnapToClose(TRIANGLE, { x: 109, y: 59 })).toBe(false);
    });
  });

  describe('snappedCursor', () => {
    it('returns null when no vertices placed', () => {
      expect(snappedCursor([], { x: 1, y: 1 })).toBe(null);
    });

    it('returns null when cursor is null', () => {
      expect(snappedCursor(TRIANGLE, null)).toBe(null);
    });

    it('returns vertices[0] when snap zone is active', () => {
      expect(snappedCursor(TRIANGLE, { x: 100, y: 62 })).toEqual({ x: 100, y: 50 });
    });

    it('returns the raw cursor when snap is not active', () => {
      expect(snappedCursor(TRIANGLE, { x: 200, y: 200 })).toEqual({ x: 200, y: 200 });
    });
  });

  describe('livePreviewPoints', () => {
    it('returns null when no vertices placed', () => {
      expect(livePreviewPoints([], { x: 1, y: 1 })).toBe(null);
    });

    it('returns null when cursor is null', () => {
      expect(livePreviewPoints(TRIANGLE, null)).toBe(null);
    });

    it('returns a flat array spanning last vertex to cursor when snap is inactive', () => {
      // last vertex of TRIANGLE is (50, 200). Cursor at (200, 200), 150 px away.
      expect(livePreviewPoints(TRIANGLE, { x: 200, y: 200 })).toEqual([
        50, 200, 200, 200,
      ]);
    });

    it('snaps to v0 when snap zone is active', () => {
      // last vertex (50, 200); cursor at (100, 62) snaps to v0 = (100, 50).
      expect(livePreviewPoints(TRIANGLE, { x: 100, y: 62 })).toEqual([
        50, 200, 100, 50,
      ]);
    });
  });

  describe('draftLinePoints', () => {
    it('returns null for 0 vertices', () => {
      expect(draftLinePoints([])).toBe(null);
    });

    it('returns null for 1 vertex', () => {
      expect(draftLinePoints([{ x: 1, y: 2 }])).toBe(null);
    });

    it('flattens 2+ vertices', () => {
      expect(draftLinePoints([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([1, 2, 3, 4]);
      expect(draftLinePoints(TRIANGLE)).toEqual([100, 50, 200, 200, 50, 200]);
    });
  });

  describe('draftShouldClose', () => {
    it('returns false at 0, 1, 2 vertices', () => {
      expect(draftShouldClose([])).toBe(false);
      expect(draftShouldClose([{ x: 0, y: 0 }])).toBe(false);
      expect(draftShouldClose([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    });

    it('returns true at the boundary (3 vertices)', () => {
      expect(draftShouldClose(TRIANGLE)).toBe(true);
    });
  });

  describe('modeSwitchReset', () => {
    it('returns the canonical empty-mode state', () => {
      expect(modeSwitchReset()).toEqual({
        draftRect: null,
        draftVertices: [],
        cursorPos: null,
      });
    });

    it('produces a fresh object each call (no shared references)', () => {
      const a = modeSwitchReset();
      const b = modeSwitchReset();
      expect(a.draftVertices).not.toBe(b.draftVertices);
      // Both should be independently empty arrays.
      a.draftVertices.push({ x: 1, y: 1 });
      expect(b.draftVertices).toEqual([]);
    });
  });
});
