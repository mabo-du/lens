/**
 * useAssetBlobUrl — reusable hook for loading a document asset as a blob URL.
 *
 * Fetches the asset via `documentsIpc.getAsset(documentId)`, converts the
 * base64 payload to a Blob, creates a blob URL, and returns it. The blob URL
 * is automatically revoked on unmount or when `documentId` changes.
 *
 * Usage:
 *   const blobUrl = useAssetBlobUrl(documentId);
 *   // Pass blobUrl as `src` to an <img>, <audio>, <video>, or WaveSurfer.
 *
 * Returns `undefined` while loading or when the asset is unavailable.
 */
import { useEffect, useState } from 'react';
import { documentsIpc } from '@/ipc/documents';

export function useAssetBlobUrl(documentId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!documentId) {
      setUrl(undefined);
      return;
    }

    let cancelled = false;
    let blobUrl: string | undefined;

    documentsIpc
      .getAsset(documentId)
      .then((asset) => {
        if (cancelled) return;
        const blob = new Blob(
          [Uint8Array.from(atob(asset.b64), (c) => c.charCodeAt(0))],
          { type: asset.mime },
        );
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      })
      .catch(() => {
        // Asset unavailable — leave url undefined.
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [documentId]);

  return url;
}
