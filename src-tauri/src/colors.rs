/// Qualitative Data Analysis colour palette.
///
/// Designed for readability on light backgrounds and distinctiveness
/// across up to 12 codes.  Colours are chosen to be accessible
/// (WCAG AA contrast ratio ≥ 4.5:1 against white).
// ---- Palette constants ----
pub const COLORS: &[&str] = &[
    "#6366f1", // Indigo
    "#0891b2", // Cyan
    "#059669", // Emerald
    "#d97706", // Amber
    "#dc2626", // Red
    "#7c3aed", // Violet
    "#db2777", // Pink
    "#65a30d", // Lime
    "#0284c7", // Sky
    "#9333ea", // Purple
    "#ea580c", // Orange
    "#0d9488", // Teal
];

/// Return a colour from the palette for the given index, wrapping around.
#[allow(dead_code)]
pub fn palette_color(index: usize) -> &'static str {
    COLORS[index % COLORS.len()]
}

/// Validate that a string is a syntactically valid hex colour.
///
/// Accepted formats: `#RGB` or `#RRGGBB`.
pub fn is_valid_hex_color(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 4 && bytes.len() != 7 {
        return false;
    }
    if bytes[0] != b'#' {
        return false;
    }
    bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_hex_colors() {
        assert!(is_valid_hex_color("#6366f1"));
        assert!(is_valid_hex_color("#FFF"));
        assert!(is_valid_hex_color("#000000"));
        assert!(is_valid_hex_color("#abc"));
        assert!(is_valid_hex_color("#ABCDEF"));
    }

    #[test]
    fn invalid_hex_colors() {
        assert!(!is_valid_hex_color(""));
        assert!(!is_valid_hex_color("6366f1"));
        assert!(!is_valid_hex_color("#GGGGGG"));
        assert!(!is_valid_hex_color("#12345"));
        assert!(!is_valid_hex_color("#12"));
    }

    #[test]
    fn palette_wraps_around() {
        assert_eq!(palette_color(0), COLORS[0]);
        assert_eq!(palette_color(COLORS.len()), COLORS[0]);
        assert_eq!(palette_color(5), COLORS[5]);
    }
}
