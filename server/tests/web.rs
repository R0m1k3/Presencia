//! The embedded UI: in debug builds rust-embed reads ../web/dist from disk
//! (absent in CI: web.rs then serves its placeholder at /).

mod common;

use common::*;

#[tokio::test]
async fn ui_and_api_boundary() {
    let t = setup("web").await;

    let r = t.call("GET", "/", None, None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.header("content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(r.header("cache-control").as_deref(), Some("no-cache"));
    assert!(
        r.header("content-security-policy")
            .unwrap()
            .contains("default-src 'self'")
    );
    assert_eq!(
        r.header("permissions-policy").as_deref(),
        Some("camera=(), microphone=(), geolocation=()")
    );
    assert_eq!(r.header("x-frame-options").as_deref(), Some("DENY"));
    let etag = r.header("etag").expect("etag");
    let same = t.call("GET", "/index.html", None, None).await;
    assert_eq!(same.bytes, r.bytes);

    // Revalidation.
    let req = axum::http::Request::get("/")
        .header("if-none-match", &etag)
        .body(axum::body::Body::empty())
        .unwrap();
    let r = t.send(req).await;
    assert_eq!(r.status, 304);
    assert!(r.bytes.is_empty());

    // Not a file, not GET, or climbing out: the router's 404, unchanged.
    for (method, path) in [
        ("GET", "/nope.js"),
        ("GET", "/../Cargo.toml"),
        ("GET", "/fonts/../index.html"),
        ("POST", "/"),
    ] {
        let r = t.call(method, path, None, None).await;
        assert_eq!(r.status, 404, "{method} {path}");
        assert!(String::from_utf8_lossy(&r.bytes).contains("Cannot "), "{method} {path}");
    }

    // /api keeps the router whatever the case, and its own cache rule.
    let r = t.call("GET", "/API/health", None, None).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.header("cache-control").as_deref(), Some("no-store"));
    assert!(r.header("content-security-policy").is_some());
    let r = t.call("GET", "/api/index.html", None, None).await;
    assert_eq!(r.status, 404);
    assert_eq!(r.json()["error"], "Route inconnue");
}
