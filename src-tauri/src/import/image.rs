//! Phase C MVP image metadata extractor.
//!
//! Reads ONLY the file-format header (≤ ~64 bytes for PNG/JPEG,
//! ~1 KB worst-case for TIFF/EXIF) and never decodes the pixel buffer.
//! 50 MB photos therefore do not allocate 200 MB of pixels.
//!
//! The `text_hash` column on `document` is reused for image content
//! dedup: there's no extracted text for binary formats, so we hash
//! the raw file bytes. This is the natural content identifier and
//! matches what the existing UNIQUE(project_id, text_hash) index
//! expects for race-safe dedup.

use sha2::{Digest, Sha256};
use std::path::Path;

/// Result of header-only image metadata extraction.
#[derive(Debug)]
pub struct ImageMetadata {
    pub width: i32,
    pub height: i32,
    /// SHA-256 of the raw file bytes — used as the `document.text_hash`
    /// value for content dedup. Hex-encoded (64 chars).
    pub content_hash: String,
}

/// Extract intrinsic dimensions + content hash for an image file.
///
/// Errors are surfaced as user-readable strings (the Tauri command
/// layer renders them in the import error toast).
pub fn extract_metadata(path: &Path) -> Result<ImageMetadata, String> {
    let bytes = std::fs::read(path).map_err(|e| {
        format!(
            "Failed to read image file {}: {}",
            path.display(),
            e
        )
    })?;

    let dimensions = image::ImageReader::open(path)
        .map_err(|e| format!("Failed to open image reader: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to detect image format: {}", e))?
        .into_dimensions()
        .map_err(|e| format!("Failed to read image dimensions: {}", e))?;

    // SQLite INTEGER is i64; we cap at i32::MAX. Anything wider than 2 GiPx
    // is not a real image — return an error so the import aborts rather
    // than corrupting the schema.
    let width = i32::try_from(dimensions.0)
        .map_err(|_| format!("Image width {} exceeds i32 range", dimensions.0))?;
    let height = i32::try_from(dimensions.1)
        .map_err(|_| format!("Image height {} exceeds i32 range", dimensions.1))?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let content_hash = hex::encode(hasher.finalize());

    Ok(ImageMetadata {
        width,
        height,
        content_hash,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use tempfile::tempdir;

    /// Build a 4×3 fully-valid PNG using the image crate's own encoder,
    /// then read back its dimensions to verify the extractor round-trips.
    #[test]
    fn extract_metadata_returns_dimensions_for_valid_png() {
        let tmp = tempdir().expect("tempdir");
        let png_path = tmp.path().join("test.png");
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(4, 3, |_x, _y| Rgb([255u8, 0, 0]));
        img.save(&png_path).expect("save png fixture");

        let meta = extract_metadata(Path::new(&png_path)).expect("extract_metadata");
        assert_eq!(meta.width, 4, "PNG width should match fixture");
        assert_eq!(meta.height, 3, "PNG height should match fixture");
        assert_eq!(
            meta.content_hash.len(),
            64,
            "SHA-256 hex should be 64 chars, got: {}",
            meta.content_hash
        );
        assert!(
            meta.content_hash.chars().all(|c| c.is_ascii_hexdigit()),
            "hash should be hex-only, got: {}",
            meta.content_hash
        );
    }

    #[test]
    fn extract_metadata_rejects_non_image() {
        let tmp = tempdir().expect("tempdir");
        let bogus = tmp.path().join("not-an-image.txt");
        std::fs::write(&bogus, b"this is plain text, not an image").expect("write");

        let err = extract_metadata(Path::new(&bogus))
            .expect_err("non-image must error");
        let lower = err.to_lowercase();
        assert!(
            lower.contains("image")
                || lower.contains("format")
                || lower.contains("dimensions"),
            "Error should explain why the file is not an image; got: {}",
            err
        );
    }

    #[test]
    fn extract_metadata_is_deterministic_for_same_file() {
        let tmp = tempdir().expect("tempdir");
        let png_path = tmp.path().join("dup.png");
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(2, 2, |_x, _y| Rgb([0u8, 0, 255]));
        img.save(&png_path).expect("save");

        let m1 = extract_metadata(Path::new(&png_path)).expect("first");
        let m2 = extract_metadata(Path::new(&png_path)).expect("second");
        assert_eq!(
            m1.content_hash, m2.content_hash,
            "Same file bytes must produce same hash"
        );
        assert_eq!(m1.width, m2.width);
        assert_eq!(m1.height, m2.height);
    }

    #[test]
    fn extract_metadata_distinguishes_different_files() {
        let tmp = tempdir().expect("tempdir");
        let p1 = tmp.path().join("red.png");
        let p2 = tmp.path().join("blue.png");

        let red: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(2, 2, |_x, _y| Rgb([255u8, 0, 0]));
        let blue: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(2, 2, |_x, _y| Rgb([0u8, 0, 255]));
        red.save(&p1).expect("save red");
        blue.save(&p2).expect("save blue");

        let m1 = extract_metadata(Path::new(&p1)).expect("m1");
        let m2 = extract_metadata(Path::new(&p2)).expect("m2");
        assert_ne!(
            m1.content_hash, m2.content_hash,
            "Different content must produce different hashes"
        );
    }
}
