mod common;

use axum::{body::Body, http::Request};
use common::*;

fn raw(method: &str, path: &str, ct: Option<&str>, body: &str) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("content-length", body.len());
    if let Some(ct) = ct {
        b = b.header("content-type", ct);
    }
    b.body(Body::from(body.to_string())).unwrap()
}

#[tokio::test]
async fn pipeline_and_routing() {
    let t = setup("errors").await;

    let r = t.call("GET", "/api/health", None, None).await;
    assert_eq!((r.status.as_u16(), r.json()), (200, serde_json::json!({ "ok": true })));
    assert_eq!(r.header("content-type").unwrap(), "application/json; charset=utf-8");
    for (h, v) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "same-origin"),
        ("cache-control", "no-store"),
    ] {
        assert_eq!(r.header(h).as_deref(), Some(v));
    }
    assert_eq!(t.call("GET", "/API/Health/", None, None).await.status, 200);
    assert_eq!(t.call("GET", "/api/health//", None, None).await.status, 404);

    // Invalid JSON is rejected before routing and before the session check.
    let r = t
        .send(raw("POST", "/api/companies", Some("application/json"), "{"))
        .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (400, "Corps de requête JSON invalide")
    );
    let r = t
        .send(raw("POST", "/api/auth/login", Some("application/json"), "\"x\""))
        .await;
    assert_eq!(r.status, 400);
    let r = t
        .send(raw("POST", "/api/auth/login", Some("application/json"), "  "))
        .await;
    assert_eq!(r.status, 400);
    // Not JSON: body ignored.
    let r = t.send(raw("POST", "/api/auth/login", Some("text/plain"), "{")).await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (400, "Email et mot de passe requis")
    );
    let big = format!("{{\"a\":\"{}\"}}", "x".repeat(crate_limit()));
    let r = t
        .send(raw("POST", "/api/auth/login", Some("application/json"), &big))
        .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (413, "Requête trop volumineuse")
    );
    let r = t
        .send(raw(
            "POST",
            "/api/auth/login",
            Some("application/json; charset=latin1"),
            "{}",
        ))
        .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (500, "Erreur interne du serveur")
    );

    // Unknown routes and wrong methods.
    let r = t.call("GET", "/api/nope", None, None).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (404, "Route inconnue"));
    assert_eq!(t.call("GET", "/api/auth/login", None, None).await.status, 404);
    let r = t.call("GET", "/nope", None, None).await;
    assert_eq!(r.status, 404);
    assert!(String::from_utf8_lossy(&r.bytes).contains("<pre>Cannot GET /nope</pre>"));
    // Under protected mounts the session is checked before the 404.
    assert_eq!(t.call("GET", "/api/companies/1/x", None, None).await.status, 401);
    assert_eq!(t.call("GET", "/api/attendance/nope", None, None).await.status, 401);
    let admin = t.admin().await;
    assert_eq!(
        t.call("PATCH", "/api/companies/1", None, Some(&admin)).await.status,
        404
    );
    assert_eq!(t.call("GET", "/api/companies//", None, Some(&admin)).await.status, 200);
    assert_eq!(t.call("GET", "/api/companies///", None, Some(&admin)).await.status, 404);
    let r = t
        .call("PUT", "/api/companies/abc", Some(serde_json::json!({})), Some(&admin))
        .await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Identifiant invalide"));
    assert_eq!(t.call("PUT", "/api/companies/07", None, Some(&admin)).await.status, 400);

    // Automatic OPTIONS answer when CORS is off.
    let r = t.call("OPTIONS", "/api/auth/login", None, None).await;
    assert_eq!((r.status.as_u16(), r.header("allow").as_deref()), (200, Some("POST")));
    let r = t.call("OPTIONS", "/api/attendance/", None, Some(&admin)).await;
    assert_eq!(String::from_utf8_lossy(&r.bytes), "GET,HEAD,PUT,DELETE");
}

fn crate_limit() -> usize {
    presencia::body::LIMIT
}

#[tokio::test]
async fn cors() {
    let t = setup_with("cors", |c| c.cors_origin = Some("https://app.example".into())).await;
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/auth/login")
        .header("origin", "https://app.example")
        .header("access-control-request-headers", "content-type")
        .body(Body::empty())
        .unwrap();
    let r = t.send(req).await;
    assert_eq!(r.status, 204);
    assert_eq!(
        r.header("access-control-allow-origin").as_deref(),
        Some("https://app.example")
    );
    assert_eq!(r.header("access-control-allow-credentials").as_deref(), Some("true"));
    assert_eq!(
        r.header("access-control-allow-methods").as_deref(),
        Some("GET,HEAD,PUT,PATCH,POST,DELETE")
    );
    assert_eq!(
        r.header("access-control-allow-headers").as_deref(),
        Some("content-type")
    );
    let r = t.call("GET", "/api/health", None, None).await;
    assert_eq!(
        r.header("access-control-allow-origin").as_deref(),
        Some("https://app.example")
    );
    assert_eq!(r.header("vary").as_deref(), Some("Origin"));
}
