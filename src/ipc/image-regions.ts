import { invoke } from '@tauri-apps/api/core';

/**
 * Rectangular image-region annotation. Coordinates are stored as
 * proportional 0.0–1.0 values (relative to the document's intrinsic
 * width/height) so the same record renders correctly at any zoom
 * level. Bounds checks live on the Rust side (image_regions.rs
 * validate_bbox prevents NaN / out-of-range / zero-area).
 */
export interface ImageRegionRecord {
  id: string;
  documentId: string;
  codeId: string;
  regionType: 'bbox';
  /** JSON object {left, top, right, bottom} mirroring bbox_* columns. */
  regionData: string;
  bboxLeft: number;
  bboxTop: number;
  bboxRight: number;
  bboxBottom: number;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateImageRegionPayload {
  documentId: string;
  codeId: string;
  bboxLeft: number;
  bboxTop: number;
  bboxRight: number;
  bboxBottom: number;
}

export const imageRegionsIpc = {
  create: (p: CreateImageRegionPayload) =>
    invoke<ImageRegionRecord>('image_selection_create', { ...p }),
  listByDocument: (documentId: string) =>
    invoke<ImageRegionRecord[]>('image_selection_list_by_document', { documentId }),
  delete: (id: string) =>
    invoke<void>('image_selection_delete', { id }),
};
