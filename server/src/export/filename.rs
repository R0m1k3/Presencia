//! `Content-Disposition` of an export, as `attachment()` in export.js: an
//! ASCII fallback plus the exact UTF-8 name (RFC 6266 / 5987).

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use unicode_normalization::UnicodeNormalization;

use crate::validate::js_is_space;

/// What `encodeURIComponent` escapes, plus `'()*`.
const RFC5987: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~');

pub fn attachment(company: &str, year: i32, month: i32, ext: &str) -> String {
    let raw = format!("presences_{company}_{year}-{month:02}.{ext}");
    // `.replace(/\s+/g, '_')`
    let mut base = String::new();
    let mut in_space = false;
    for c in raw.chars() {
        if js_is_space(c) {
            if !in_space {
                base.push('_');
            }
            in_space = true;
        } else {
            base.push(c);
            in_space = false;
        }
    }
    let ascii: String = base
        .nfd()
        .filter(|c| (' '..='~').contains(c))
        .map(|c| if matches!(c, '"' | '\\' | '/' | ';') { '_' } else { c })
        .collect();
    let utf8 = base.replace(['\\', '/'], "_");
    format!(
        "attachment; filename=\"{ascii}\"; filename*=UTF-8''{}",
        utf8_percent_encode(&utf8, RFC5987)
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn ascii_fallback() {
        assert_eq!(
            super::attachment("Société  — Nord/Sud (2)", 2026, 2, "pdf"),
            "attachment; filename=\"presences_Societe__Nord_Sud_(2)_2026-02.pdf\"; \
             filename*=UTF-8''presences_Soci%C3%A9t%C3%A9_%E2%80%94_Nord_Sud_%282%29_2026-02.pdf"
        );
    }
}
