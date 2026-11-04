//! `express.json({ limit: '100kb' })`: runs before routing, so a malformed
//! JSON body is a 400 even on an unknown route or without a session.

use axum::{body::Body, http::HeaderMap, http::header};
use serde_json::{Map, Value};

use crate::error::ApiError;

pub const LIMIT: usize = 100 * 1024;

fn invalid() -> ApiError {
    ApiError::new(400, "Corps de requête JSON invalide")
}

fn too_large() -> ApiError {
    ApiError::new(413, "Requête trop volumineuse")
}

/// `{}` unless the request carries a JSON body.
pub async fn read_json(headers: &HeaderMap, body: Body) -> Result<Value, ApiError> {
    let empty = Value::Object(Map::new());
    let length = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok());
    let has_body = headers.contains_key(header::TRANSFER_ENCODING) || length.is_some();
    if !has_body {
        return Ok(empty);
    }
    let Some(ct) = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) else {
        return Ok(empty);
    };
    let mut params = ct.split(';');
    if !params
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("application/json")
    {
        return Ok(empty);
    }
    for p in params {
        if let Some((k, v)) = p.split_once('=')
            && k.trim().eq_ignore_ascii_case("charset")
        {
            let cs = v.trim().trim_matches('"').to_ascii_lowercase();
            if !cs.starts_with("utf-") {
                // body-parser answers 415, which the Express error handler turns into a 500.
                return Err(ApiError::Internal(format!(
                    "unsupported charset \"{}\"",
                    cs.to_uppercase()
                )));
            }
        }
    }
    if length
        .and_then(|l| l.trim().parse::<u64>().ok())
        .is_some_and(|l| l > LIMIT as u64)
    {
        return Err(too_large());
    }
    let bytes = axum::body::to_bytes(body, LIMIT).await.map_err(|_| too_large())?;
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
    if text.is_empty() {
        return Ok(empty);
    }
    // strict: the root must be an object or an array.
    match text.trim_start_matches([' ', '\t', '\n', '\r']).chars().next() {
        Some('{' | '[') => serde_json::from_str(text).map_err(|_| invalid()),
        _ => Err(invalid()),
    }
}
