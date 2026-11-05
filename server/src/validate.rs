//! Input checks, with the JavaScript semantics the Node API relied on
//! (`String(v)`, `parseInt`, `trim`, UTF-16 lengths, truthiness).
//! A field is `Option<&Value>`: `None` stands for `undefined`.

use chrono::NaiveDate;
use serde_json::Value;

pub const MAX_INT: i64 = 2_147_483_647;
pub const MIN_PASSWORD: usize = 8;

/// A field of a parsed JSON body or query: `undefined` unless the value is
/// an object with that key (arrays and scalars have none of our keys).
pub fn field<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_object().and_then(|o| o.get(key))
}

/// JavaScript `WhiteSpace` and `LineTerminator` (`\s`, `trim`, `parseInt`).
pub fn js_is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(js_is_space)
}

/// `String.prototype.length` (UTF-16 code units).
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `Number.prototype.toString()`.
pub fn js_number(f: f64) -> String {
    if f == 0.0 {
        return "0".into();
    }
    if f.fract() == 0.0 && f.abs() < 1e21 {
        return format!("{f:.0}");
    }
    if f.abs() >= 1e21 || f.abs() < 1e-6 {
        let s = format!("{f:e}");
        return match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        };
    }
    format!("{f}")
}

/// `String(v)`.
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_number(n.as_f64().unwrap_or(0.0)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|e| match e {
                Value::Null => String::new(),
                e => js_string(Some(e)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// Canonical decimal id: `^[1-9]\d{0,9}$` and at most 2^31-1.
pub fn is_id_str(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 10
        && (b'1'..=b'9').contains(&b[0])
        && b.iter().all(u8::is_ascii_digit)
        && s.parse::<i64>().is_ok_and(|n| n <= MAX_INT)
}

/// `isId(v)`: a positive integer number, or a canonical decimal string.
pub fn is_id(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Number(n)) => n
            .as_f64()
            .is_some_and(|f| f.fract() == 0.0 && f > 0.0 && f <= MAX_INT as f64),
        Some(Value::String(s)) => is_id_str(s),
        _ => false,
    }
}

/// An id the Node API checked with `isId(String(v))` and then sent to `pg`:
/// `None` when the check fails; `Some(Err(()))` when it passes but `pg` would
/// send a value Postgres rejects (an array becomes the literal `{...}`, 22P02).
pub fn js_id(v: Option<&Value>) -> Option<Result<i32, ()>> {
    if !is_id_str(&js_string(v)) {
        return None;
    }
    Some(match v {
        Some(Value::Number(n)) => Ok(n.as_f64().unwrap_or(0.0) as i32),
        Some(Value::String(s)) => s.parse().map_err(|_| ()),
        _ => Err(()),
    })
}

/// `js_id` as a request check: `invalid` (400) when the check fails,
/// « Valeur invalide » (400) for what Postgres would reject.
pub fn checked_id(v: Option<&Value>, invalid: &str) -> Result<i32, crate::error::ApiError> {
    match js_id(v) {
        None => crate::error::fail(400, invalid),
        Some(Err(())) => crate::error::fail(400, "Valeur invalide"),
        Some(Ok(id)) => Ok(id),
    }
}

/// `parseInt(v, 10)`; `None` is NaN.
pub fn parse_int(v: Option<&Value>) -> Option<f64> {
    let s = js_string(v);
    let s = s.trim_start_matches(js_is_space);
    let (neg, digits) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let digits: &str = &digits[..digits.bytes().take_while(u8::is_ascii_digit).count()];
    if digits.is_empty() {
        return None;
    }
    let n = digits.bytes().fold(0f64, |acc, d| acc * 10.0 + f64::from(d - b'0'));
    Some(if neg { -n } else { n })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct YearMonth {
    pub year: i32,
    pub month: i32,
}

pub fn parse_year_month(year: Option<&Value>, month: Option<&Value>) -> Option<YearMonth> {
    let y = parse_int(year)?;
    let m = parse_int(month)?;
    if !(2000.0..=2100.0).contains(&y) || !(1.0..=12.0).contains(&m) {
        return None;
    }
    Some(YearMonth {
        year: y as i32,
        month: m as i32,
    })
}

pub fn month_start(ym: YearMonth) -> String {
    format!("{}-{:02}-01", ym.year, ym.month)
}

/// `YYYY-MM-DD` and a real calendar date.
pub fn is_date(v: Option<&Value>) -> bool {
    let Some(Value::String(s)) = v else { return false };
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let (y, m, d) = (
        s[0..4].parse().unwrap(),
        s[5..7].parse().unwrap(),
        s[8..10].parse().unwrap(),
    );
    NaiveDate::from_ymd_opt(y, m, d).is_some()
}

/// `^[^\s@]+@[^\s@]+\.[^\s@]+$`, at most 255 UTF-16 units.
pub fn is_email(s: &str) -> bool {
    if js_len(s) > 255 || s.chars().any(js_is_space) {
        return false;
    }
    let mut parts = s.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty()
        && domain
            .char_indices()
            .any(|(i, c)| c == '.' && i > 0 && i + 1 < domain.len())
}

pub fn is_name(v: Option<&Value>) -> bool {
    match v {
        Some(Value::String(s)) => {
            let n = js_len(js_trim(s));
            n > 0 && n <= 255
        }
        _ => false,
    }
}

pub fn password_error(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(p)) if js_len(p) >= MIN_PASSWORD => {
            // bcrypt ignores everything past 72 bytes.
            (p.len() > 72).then(|| "Mot de passe trop long (72 octets maximum)".to_string())
        }
        _ => Some(format!("Mot de passe trop court ({MIN_PASSWORD} caractères minimum)")),
    }
}

/// The value as a non-empty string (`typeof v === 'string' && v`).
pub fn non_empty_str(v: Option<&Value>) -> Option<&str> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn js_semantics() {
        assert_eq!(js_string(Some(&json!(5.0))), "5");
        assert_eq!(js_string(Some(&json!([2026, null, [1]]))), "2026,,1");
        assert_eq!(js_number(1e21), "1e+21");
        assert_eq!(parse_int(Some(&json!(" 12abc"))), Some(12.0));
        assert_eq!(parse_int(Some(&json!(2026.7))), Some(2026.0));
        assert_eq!(parse_int(Some(&json!(true))), None);
        assert_eq!(parse_int(Some(&json!(["2026"]))), Some(2026.0));
        assert!(is_id(Some(&json!(5.0))) && is_id(Some(&json!("7"))));
        assert!(!is_id(Some(&json!("07"))) && !is_id(Some(&json!("2147483648"))) && !is_id(Some(&json!(true))));
        assert!(is_date(Some(&json!("2024-02-29"))) && !is_date(Some(&json!("2026-02-29"))));
        assert!(is_date(Some(&json!("0000-01-01"))));
        assert!(
            is_email("a@b.c")
                && is_email("a.b@c.d.e")
                && !is_email("a@.c")
                && !is_email("a@b.")
                && !is_email("a@b@c.d")
        );
        assert!(is_email("a@b..") && !is_email("a b@c.d"));
        assert!(!is_name(Some(&json!("  "))) && is_name(Some(&json!(" x "))));
        assert!(
            password_error(Some(&json!("1234567"))).is_some() && password_error(Some(&json!("12345678"))).is_none()
        );
    }
}
