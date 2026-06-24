/**
 * Pure helpers extracted from `ImageViewer`'s polygon mode.
 *
 * The polygon mode state machine inlines a lot of pure array / geometry
 * math (vertex accumulation, snap-to-close calculation, draft-line / live
 * preview point emission, commit guard). These helpers are extracted so
 * they can be unit-tested in vitest's node environment without mounting
 * Konva or pulling in jsdom, while keeping `ImageViewer.tsx` focused on
 * React rendering, IPC, and event wiring.
 *
 * Conventions:
 *   - Vertices are in pixel space (the same units Konva uses for its
 *     `Stage` `width`/`height`). The IPC layer normalises them to
 *     0..1 proportional coords just before calling
 *     `imagePolygonsIpc.create`.
 *   - `snappedCursor` returns the effective cursor position used by
 *     the live-preview line: the literal cursor pos when outside the
 *     snap zone, or `v0` (vertex 0) when inside — so the preview line
 *     visually completes the loop back to v[0].
 */

export interface Vertex {
  x: number;
  y: number;
}

/** Minimum vertex count for a commit-able polygon (matches Rust-side `validate_polygon`). */
export const MIN_POLYGON_VERTICES = 3;

/** Maximum vertex count (matches Rust-side upper bound). */
export const MAX_POLYGON_VERTICES = 64;

/** Snap-to-close radius (px from vertex 0). */
export const SNAP_RADIUS_PX = 12;

/** Push a vertex onto the existing draft. Pure / immutable. */
export function pushVertex(vertices: Vertex[], v: Vertex): Vertex[] {
  return [...vertices, v];
}

/** Commit guard: returns true if a polygon with N vertices may commit via IPC. */
export function canCommit(vertices: Vertex[]): boolean {
  return vertices.length >= MIN_POLYGON_VERTICES && vertices.length <= MAX_POLYGON_VERTICES;
}

/**
 * Snap-to-close test: returns true iff `vertices` has at least
 * `MIN_POLYGON_VERTICES` AND `cursor` is within `SNAP_RADIUS_PX` of
 * vertex 0 (using squared-distance comparison to avoid sqrt).
 */
export function isSnapToClose(
  vertices: Vertex[],
  cursor: Vertex | null,
): boolean {
  if (vertices.length < MIN_POLYGON_VERTICES) return false;
  if (!cursor) return false;
  const v0 = vertices[0];
  const dx = cursor.x - v0.x;
  const dy = cursor.y - v0.y;
  return dx * dx + dy * dy <= SNAP_RADIUS_PX * SNAP_RADIUS_PX;
}

/**
 * Returns the effective cursor used to draw the live-preview line.
 * - `null` when no cursor is active OR no vertices have been placed.
 * - `vertices[0]` when the snap zone is active (closes the visual loop).
 * - `cursor` otherwise.
 */
export function snappedCursor(
  vertices: Vertex[],
  cursor: Vertex | null,
): Vertex | null {
  if (vertices.length === 0) return null;
  if (!cursor) return null;
  if (isSnapToClose(vertices, cursor)) return vertices[0];
  return cursor;
}

/**
 * `Line` `points` payload for the live preview: the flat `[x1, y1,
 * x2, y2]` array from the LAST placed vertex to the effective cursor.
 * Returns null when no live preview line should render (no vertices,
 * or no cursor).
 */
export function livePreviewPoints(
  vertices: Vertex[],
  cursor: Vertex | null,
): number[] | null {
  if (vertices.length === 0) return null;
  const c = snappedCursor(vertices, cursor);
  if (!c) return null;
  const last = vertices[vertices.length - 1];
  return [last.x, last.y, c.x, c.y];
}

/**
 * `Line` `points` payload for the in-flight draft outline (closed
 * when there are >= MIN_POLYGON_VERTICES vertices). Returns null for
 * < 2 vertices (no outline to render yet).
 */
export function draftLinePoints(vertices: Vertex[]): number[] | null {
  if (vertices.length < 2) return null;
  return vertices.flatMap(v => [v.x, v.y]);
}

/**
 * Should the draft polygon be rendered closed (true once it has at
 * least `MIN_POLYGON_VERTICES` vertices)? Mirrors the React computed
 * value used to set the `<Line closed={...}>` prop.
 */
export function draftShouldClose(vertices: Vertex[]): boolean {
  return vertices.length >= MIN_POLYGON_VERTICES;
}

/**
 * Mode-switch reset shape — used to clear any in-flight draft of the
 * other mode when the researcher toggles Rectangle <-> Polygon.
 * Returned as a plain object so callers can spread it into state.
 */
export function modeSwitchReset(): {
  draftRect: null;
  draftVertices: Vertex[];
  cursorPos: Vertex | null;
} {
  return { draftRect: null, draftVertices: [], cursorPos: null };
}
