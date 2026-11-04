mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn crud_and_guards() {
    let t = setup("companies").await;
    let admin = t.admin().await;
    let (_, _, cadre) = t.company_with_cadre(&admin, "Acme", "c@acme.fr").await;

    assert_eq!(t.call("GET", "/api/companies", None, None).await.status, 401);
    let r = t.call("GET", "/api/companies", None, Some(&cadre)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (403, "Accès réservé aux administrateurs"));
    // Admin check comes before the id check on this mount.
    assert_eq!(t.call("PUT", "/api/companies/abc", None, Some(&cadre)).await.status, 403);

    let r = t.call("POST", "/api/companies", Some(json!({ "name": "  Société — Nord " })), Some(&admin)).await;
    assert_eq!(r.status, 201);
    let body = r.json();
    assert_eq!(body["name"], "Société — Nord");
    let at = body["created_at"].as_str().unwrap();
    assert!(at.len() == 24 && at.ends_with('Z') && &at[19..20] == ".", "{at}");
    let id = body["id"].as_i64().unwrap();

    for bad in [json!({}), json!({ "name": "   " }), json!({ "name": 5 }), json!({ "name": "x".repeat(256) })] {
        let r = t.call("POST", "/api/companies", Some(bad), Some(&admin)).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Nom requis (255 caractères maximum)"));
    }
    let r = t.call("POST", "/api/companies", Some(json!({ "name": "Acme" })), Some(&admin)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (409, "Cette société existe déjà"));
    let r = t.call("PUT", &format!("/api/companies/{id}"), Some(json!({ "name": "Acme" })), Some(&admin)).await;
    assert_eq!(r.status, 409);

    let r = t.call("GET", "/api/companies", None, Some(&admin)).await;
    let list = r.json();
    assert_eq!(list[0]["name"], "Acme");
    assert_eq!(list[0]["active_cadre_count"], "1");
    assert_eq!(list[1]["active_cadre_count"], "0");

    let r = t.call("PUT", &format!("/api/companies/{id}/"), Some(json!({ "name": "Sud" })), Some(&admin)).await;
    assert_eq!((r.status.as_u16(), r.json()["name"].as_str()), (200, Some("Sud")));
    let r = t.call("PUT", "/api/companies/999", Some(json!({ "name": "X" })), Some(&admin)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (404, "Société introuvable"));
    assert_eq!(t.call("DELETE", &format!("/api/companies/{id}"), None, Some(&admin)).await.json(), json!({ "ok": true }));
    assert_eq!(t.call("DELETE", &format!("/api/companies/{id}"), None, Some(&admin)).await.status, 404);
}
