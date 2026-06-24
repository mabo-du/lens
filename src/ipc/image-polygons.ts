import { invoke } from '@tauri-apps/api/core';

/**
 * Image polygon annotation. Vertices are stored as proportional 0..1
 * values (relative to the document's intrinsic width/height), so the
 * same record renders correctly at any zoom level. Bounds checks live
 * on the Rust side (`image_polygons::validate_polygon` enforces
 * 3..64 vertices, finite values in [0,1]²).
 *
 * `vertices` is typed (`number[][]`); the Rust IPC parses the JSON
 * string column on read so the FE does not need to `JSON.parse` here.
 */
export interface ImagePolygonRecord {
  id: string;
  documentId: string;
  codeId: string;
  /** `[ [x0, y0], [x1, y1], ... ]` — each pair in [0, 1]. */
  vertices: number[][];
  createdBy: string | null;
  createdAt: string;
}

export interface CreateImagePolygonPayload {
  documentId: string;
  codeId: string;
  /** JSON-serialised on the wire; the FE caller hands in a typed array. */
  vertices: number[][];
}

/**
 * Wire-format args for `image_polygon_create` — matches the Rust arg
 * names exactly. `vertices` is collapsed into `verticesJson` before
 * invoke so the Rust side parses it once.
 */
type WireArgs = {
  documentId: string;
  codeId: string;
  verticesJson: string;
};

export const imagePolygonsIpc = {
  create: (p: CreateImagePolygonPayload) => {
    const wireArgs: WireArgs = {
      documentId: p.documentId,
      codeId: p.codeId,
      verticesJson: JSON.stringify(p.vertices),
    };
    return invoke<ImagePolygonRecord>('image_polygon_create', wireArgs);
  },
  listByDocument: (documentId: string) =>
    invoke<ImagePolygonRecord[]>('image_polygon_list_by_document', { documentId }),
  delete: (id: string) => invoke<void>('image_polygon_delete', { id }),
};
