mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn session_lifecycle() {
    let t = setup("auth").await;

    let r = t.call("POST", "/api/auth/login", Some(json!({ "email": "  ADMIN@test.fr ", "password": ADMIN_PASSWORD })), None).await;
    assert_eq!(r.status, 200);
    assert_eq!(
        r.json(),
        json!({ "id": 1, "fullName": "Administrateur", "email": ADMIN_EMAIL, "role": "admin", "companyId": null, "companyName": null })
    );
    let set = r.header("set-cookie").unwrap();
    let re = regex_like(&set);
    assert!(re, "{set}");
    let admin = r.cookie().unwrap();

    let r = t.call("GET", "/api/auth/me", None, Some(&admin)).await;
    assert_eq!(r.json()["email"], ADMIN_EMAIL);

    let r = t.call("GET", "/api/auth/me", None, None).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (401, "Non authentifié"));
    assert!(r.header("set-cookie").is_none());
    let r = t.call("GET", "/api/auth/me", None, Some("presencia_token=abc")).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (401, "Session invalide ou expirée"));
    assert_eq!(r.header("set-cookie").unwrap(), "presencia_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    let r = t.call("POST", "/api/auth/logout", None, None).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    assert_eq!(r.header("set-cookie").unwrap(), "presencia_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    for body in [json!({}), json!({ "email": "a", "password": 5 }), json!({ "email": "", "password": "x" })] {
        let r = t.call("POST", "/api/auth/login", Some(body), None).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Email et mot de passe requis"));
    }
    let r = t.call("POST", "/api/auth/login", Some(json!({ "email": ADMIN_EMAIL, "password": "wrong" })), None).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (401, "Identifiants incorrects"));

    // Password change: other sessions end, the current one gets a fresh cookie.
    let other = t.admin().await;
    let r = t.call("PUT", "/api/auth/password", Some(json!({ "current": ADMIN_PASSWORD, "password": "short" })), Some(&admin)).await;
    assert_eq!(r.error(), "Mot de passe trop court (8 caractères minimum)");
    let r = t.call("PUT", "/api/auth/password", Some(json!({ "password": "new-password" })), Some(&admin)).await;
    assert_eq!(r.error(), "Mot de passe actuel requis");
    let r = t.call("PUT", "/api/auth/password", Some(json!({ "current": "nope", "password": "new-password" })), Some(&admin)).await;
    assert_eq!(r.error(), "Mot de passe actuel incorrect");
    let long = "é".repeat(37);
    let r = t.call("PUT", "/api/auth/password", Some(json!({ "current": ADMIN_PASSWORD, "password": long })), Some(&admin)).await;
    assert_eq!(r.error(), "Mot de passe trop long (72 octets maximum)");
    // A token issued in an earlier second than the change is refused.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let r = t.call("PUT", "/api/auth/password", Some(json!({ "current": ADMIN_PASSWORD, "password": "new-password" })), Some(&admin)).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    let fresh = r.cookie().unwrap();
    assert_eq!(t.call("GET", "/api/auth/me", None, Some(&fresh)).await.status, 200, "immediate reuse");
    assert_eq!(t.call("GET", "/api/auth/me", None, Some(&other)).await.status, 401);
    t.login(ADMIN_EMAIL, "new-password").await;

    // Hashes are written in the $2a$ format, readable by bcryptjs.
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = 1").fetch_one(&t.pool).await.unwrap();
    assert!(hash.starts_with("$2a$10$"), "{hash}");
}

fn regex_like(set: &str) -> bool {
    let parts: Vec<&str> = set.split("; ").collect();
    parts.len() == 6
        && parts[0].starts_with("presencia_token=ey")
        && parts[1] == "Max-Age=43200"
        && parts[2] == "Path=/"
        && parts[3].starts_with("Expires=")
        && parts[3].ends_with(" GMT")
        && parts[4] == "HttpOnly"
        && parts[5] == "SameSite=Lax"
}

#[tokio::test]
async fn rate_limit_and_inactive() {
    let t = setup("ratelimit").await;
    let admin = t.admin().await;
    let (_, uid, _) = t.company_with_cadre(&admin, "Acme", "cadre@acme.fr").await;

    // An inactive account counts as a failure, even with the right password.
    let r = t.call("PUT", &format!("/api/users/{uid}"), Some(json!({ "full_name": "Cadre", "email": "cadre@acme.fr", "role": "cadre", "company_id": 1, "active": false })), Some(&admin)).await;
    assert_eq!(r.status, 200);
    for i in 0..10 {
        let r = t.call("POST", "/api/auth/login", Some(json!({ "email": "cadre@acme.fr", "password": "cadre-password" })), None).await;
        assert_eq!(r.status, 401, "attempt {i}");
    }
    let r = t.call("POST", "/api/auth/login", Some(json!({ "email": "Cadre@acme.fr", "password": "cadre-password" })), None).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (429, "Trop de tentatives. Réessayez dans 15 min."));
    // Another account from the same address is still allowed.
    t.admin().await;
}
