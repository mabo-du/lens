use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// Normalizes text according to the LENS specification:
/// 1. Strips UTF-8 BOM
/// 2. Unicode NFC normalisation
/// 3. Soft hyphen removal
/// 4. Ligature expansion
/// 5. Line ending normalisation to `\n`
/// 6. Collapse runs of 3+ consecutive newlines to exactly 2
/// 7. Strip leading/trailing whitespace
pub fn normalise_text(raw_text: &str) -> String {
    // 1. Strip UTF-8 BOM
    let text = raw_text.strip_prefix('\u{FEFF}').unwrap_or(raw_text);

    // 2. Unicode NFC normalisation
    let nfc_text: String = text.nfc().collect();

    // 3 & 4. Soft hyphen removal & Ligature expansion
    let replaced_text = nfc_text
        .replace('\u{00AD}', "") // soft hyphen
        .replace("ﬁ", "fi")
        .replace("ﬀ", "ff")
        .replace("ﬃ", "ffi")
        .replace("ﬄ", "ffl")
        .replace("ﬅ", "st") // st ligature (long s)
        .replace("ﬆ", "st");

    // 5. Line ending normalisation
    let no_cr = replaced_text.replace("\r\n", "\n").replace('\r', "\n");

    // 6. Collapse runs of 3+ newlines to exactly 2
    // We can do this efficiently by iterating and keeping state, or regex.
    // For simplicity, we can do a manual fold or split.
    let mut collapsed = String::with_capacity(no_cr.len());
    let mut consecutive_newlines = 0;

    for c in no_cr.chars() {
        if c == '\n' {
            consecutive_newlines += 1;
            if consecutive_newlines <= 2 {
                collapsed.push(c);
            }
        } else {
            consecutive_newlines = 0;
            collapsed.push(c);
        }
    }

    // 7. Strip leading/trailing whitespace
    collapsed.trim().to_string()
}

pub fn compute_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn compute_word_count(text: &str) -> i32 {
    text.split_whitespace().count() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalise_text_strips_bom() {
        let raw = "\u{FEFF}Hello world";
        let result = normalise_text(raw);
        assert!(!result.starts_with('\u{FEFF}'));
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_normalise_text_line_endings() {
        let raw = "Line 1\r\nLine 2\rLine 3";
        let result = normalise_text(raw);
        assert!(!result.contains('\r'));
        assert_eq!(result, "Line 1\nLine 2\nLine 3");
    }

    #[test]
    fn test_normalise_text_collapse_newlines() {
        let raw = "a\n\n\n\nb";
        let result = normalise_text(raw);
        assert_eq!(result, "a\n\nb");
    }

    /// **Regression:** assert that the ligature-expansion branch in
    /// `normalise_text` step 4 actually fires. The previous edition
    /// of this test passed non-ligature input, so it was a no-op
    /// pass-through. This edition feeds the actual Latin ligature
    /// codepoints U+FB01 / U+FB03 / U+FB04 / U+FB05 / U+FB06.
    #[test]
    fn test_normalise_text_ligatures() {
        // U+FB01..FB06 encoded as hex-escaped byte strings so the
        // test file itself stays pure ASCII.
        let raw = [
            std::str::from_utf8(b"\xEF\xAC\x81").unwrap(), // U+FB01 fi
            std::str::from_utf8(b"\xEF\xAC\x83").unwrap(), // U+FB03 ffi
            std::str::from_utf8(b"\xEF\xAC\x84").unwrap(), // U+FB04 ffl
            std::str::from_utf8(b"\xEF\xAC\x85").unwrap(), // U+FB05 st
            std::str::from_utf8(b"\xEF\xAC\x86").unwrap(), // U+FB06 st
        ].concat();
        let result = normalise_text(&raw);
        assert_eq!(
            result, "fiffifflstst",
            "ligature expansion must produce fi+ffi+ffl+st+st, got: {:?}",
            result
        );
    }

    /// Soft-hyphen strip (step 3 in `normalise_text`).
    #[test]
    fn test_normalise_text_strips_soft_hyphen() {
        // U+00AD used as a soft hyphen between "hy" and "phen".
        let raw = format!("hy{}phen", std::str::from_utf8(b"\xC2\xAD").unwrap());
        let result = normalise_text(&raw);
        assert_eq!(result, "hyphen");
    }

    /// **Pipeline order lock-in.** Mixed-input test exercising the
    /// full 7-step normalise pipeline in a single call so a future
    /// refactor that re-orders the steps (e.g. trim-before-collapse)
    /// is caught immediately. Input: NFC-decomposable char + U+FB01
    /// ligature + CRLF + 4 consecutive newlines + leading/trailing
    /// whitespace.
    #[test]
    fn test_normalise_text_combined_pipeline_integrity() {
        // U+0065 + U+0301 = NFD form of U+00E9.
        let nfd_e_acute = std::str::from_utf8(b"e\xCC\x81").unwrap();
        let lig = std::str::from_utf8(b"\xEF\xAC\x81").unwrap();
        let raw = format!(
            "   \r\ncafe{} {} \n\n\n\n end   ",
            nfd_e_acute, lig
        );
        let result = normalise_text(&raw);
        // After all 7 steps the result must be:
        //   - NFC: input was "cafe" + nfd_e_acute -> "cafe" + U+00E9
        //     (NB: the prefix "cafe" is preserved verbatim; only the
        //      prefix NFD sequences get NFC-composed. So expected
        //      starts with four letters "cafe" not three "caf".)
        //   - ligature U+FB01 -> "fi"
        //   - CRLF -> LF; 4 interior newlines collapsed to 2
        //   - trim() only strips ABSOLUTE leading/trailing whitespace;
        //     it does not trim spaces around interior newlines.
        //     So a single space survives on either side of "\n\n".
        let expected = "cafe\u{00E9} fi \n\n end";
        assert_eq!(
            result, expected,
            "full pipeline order integrity, got: {:?}",
            result
        );
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = compute_hash("Hello");
        let h2 = compute_hash("Hello");
        let h3 = compute_hash("hello");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_compute_word_count() {
        assert_eq!(compute_word_count("Hello world"), 2);
        assert_eq!(compute_word_count("  a  b  c  "), 3);
        assert_eq!(compute_word_count(""), 0);
    }
}
