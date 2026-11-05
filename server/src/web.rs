//! The web UI, embedded from `../web/dist` at compile time (read from disk in
//! debug builds). Paths outside `/api` are looked up here first; anything not
//! found falls through to the router's "Cannot GET" 404. No single-page
//! fallback: the UI routes with the URL hash.

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../web/dist"]
struct Dist;

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Vite names its build files after their content, so they never change.
fn cache_control(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else if path.starts_with("fonts/") {
        "public, max-age=2592000"
    } else {
        "no-cache"
    }
}

/// The embedded file for a GET or HEAD on `path`, or `None` to let the router
/// answer.
pub fn serve(method: &Method, path: &str, headers: &HeaderMap) -> Option<Response> {
    if method != Method::GET && method != Method::HEAD {
        return None;
    }
    let rel = match path.strip_prefix('/')? {
        "" => "index.html",
        p => p,
    };
    // rust-embed only knows its own files, but in debug builds it reads from
    // disk: never hand it a path that could climb out of the folder.
    if rel.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") || rel.contains('\\') {
        return None;
    }
    let file = Dist::get(rel)?;
    let etag = format!("\"{}\"", hex(&file.metadata.sha256_hash()[..16]));
    let etag = HeaderValue::from_str(&etag).expect("hex etag");
    let fresh = headers.get(header::IF_NONE_MATCH).is_some_and(|v| {
        v.as_bytes()
            .split(|b| *b == b',')
            .any(|t| t.trim_ascii() == etag.as_bytes())
    });

    let mut res = if fresh {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        let mut res = Response::new(Body::from(file.data.into_owned()));
        res.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type(rel)));
        res
    };
    let h = res.headers_mut();
    h.insert(header::ETAG, etag);
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache_control(rel)));
    Some(res)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_and_cache() {
        assert_eq!(content_type("assets/index-3fa2.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("fonts/inter-latin.woff2"), "font/woff2");
        assert_eq!(content_type("LICENSE"), "application/octet-stream");
        assert_eq!(
            cache_control("assets/index-3fa2.js"),
            "public, max-age=31536000, immutable"
        );
        assert_eq!(cache_control("fonts/inter-latin.woff2"), "public, max-age=2592000");
        assert_eq!(cache_control("index.html"), "no-cache");
        assert_eq!(cache_control("js/app.js"), "no-cache");
    }
}
