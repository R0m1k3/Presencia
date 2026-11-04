mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn monthly_validation_flow() {
    let t = setup("validations").await;
    let admin = t.admin().await;
    let (cid, uid, cadre) = t.company_with_cadre(&admin, "Acme", "c@acme.fr").await;
    let (_, uid2, _) = {
        let u = t
            .call("POST", "/api/users", Some(json!({ "full_name": "Zoé", "email": "z@acme.fr", "password": "password1", "role": "cadre", "company_id": cid })), Some(&admin))
            .await;
        (cid, u.json()["id"].as_i64().unwrap(), ())
    };
    t.call("PUT", "/api/attendance", Some(json!({ "date": "2026-05-04", "period": "AM", "status": "present" })), Some(&cadre)).await;

    for body in [json!({}), json!({ "year": 2026, "month": 0 }), json!({ "year": null, "month": 5 })] {
        let r = t.call("POST", "/api/validations/cadre", Some(body), Some(&cadre)).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "year/month invalides"));
    }
    // Query string as a fallback for the body.
    let r = t.call("POST", "/api/validations/cadre?year=2026&month=5", None, Some(&cadre)).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    // A cadre's user_id is ignored.
    let r = t.call("POST", "/api/validations/cadre", Some(json!({ "year": 2026, "month": 6, "user_id": uid2 })), Some(&cadre)).await;
    assert_eq!(r.status, 200);

    let r = t.call("GET", &format!("/api/validations/company/{cid}?year=2026&month=5"), None, Some(&admin)).await;
    let b = r.json();
    assert_eq!(b["cadres"].as_array().unwrap().len(), 2);
    assert_eq!((b["cadres"][0]["filled"].as_i64(), b["cadres"][0]["cadreValidated"].as_bool()), (Some(1), Some(true)));
    let at = b["cadres"][0]["cadreValidatedAt"].as_str().unwrap();
    assert!(at.len() == 24 && at.ends_with('Z'), "{at}");
    assert_eq!(b["cadres"][1]["cadreValidatedAt"], serde_json::Value::Null);
    assert_eq!((b["allCadresValidated"].as_bool(), b["companyValidated"].as_bool()), (Some(false), Some(false)));

    let r = t.call("POST", &format!("/api/validations/company/{cid}"), Some(json!({ "year": 2026, "month": 5 })), Some(&admin)).await;
    assert_eq!(r.status, 409);
    assert_eq!(r.json()["pending"], json!(["Zoé"]));
    assert_eq!(r.error(), "Tous les cadres doivent valider leur mois avant validation de la société");

    // Admin validates for the cadre; a falsy user_id means the admin.
    let r = t.call("POST", "/api/validations/cadre", Some(json!({ "year": 2026, "month": 5, "user_id": uid2.to_string() })), Some(&admin)).await;
    assert_eq!(r.status, 200);
    for (id, status, msg) in [(json!("x"), 400, "Utilisateur invalide"), (json!(999), 404, "Utilisateur introuvable"), (json!([uid2]), 400, "Valeur invalide")] {
        let r = t.call("POST", "/api/validations/cadre", Some(json!({ "year": 2026, "month": 5, "user_id": id })), Some(&admin)).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (status, msg));
    }

    let r = t.call("GET", "/api/validations/overview?year=2026&month=5", None, Some(&admin)).await;
    assert_eq!(
        r.json(),
        json!({ "companies": [{ "id": cid, "name": "Acme", "activeCadres": 2, "validatedCadres": 2, "companyValidated": false }], "totalActiveCadres": 2, "lateCadres": 0, "pendingCompanies": 1 })
    );
    let r = t.call("POST", &format!("/api/validations/company/{cid}"), Some(json!({ "year": 2026, "month": 5 })), Some(&admin)).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    let r = t.call("GET", &format!("/api/validations/company/{cid}?year=2026&month=5"), None, Some(&admin)).await;
    assert_eq!((r.json()["allCadresValidated"].as_bool(), r.json()["companyValidated"].as_bool()), (Some(true), Some(true)));
    let r = t.call("POST", "/api/validations/cadre", Some(json!({ "year": 2026, "month": 5 })), Some(&cadre)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (423, "La société a déjà été validée par l’administrateur pour ce mois"));
    let r = t.call("GET", "/api/validations/overview?year=2026&month=5", None, Some(&admin)).await;
    assert_eq!(r.json()["pendingCompanies"], 0);

    // Reopen cadre.
    let r = t.call("POST", "/api/validations/cadre/reopen", Some(json!({ "year": 2026, "month": 5 })), Some(&admin)).await;
    assert_eq!(r.error(), "Paramètres invalides");
    let r = t.call("POST", "/api/validations/cadre/reopen", Some(json!({ "year": 2026, "month": 5, "user_id": 999 })), Some(&admin)).await;
    assert_eq!(r.error(), "Élément référencé introuvable");
    let r = t.call("POST", "/api/validations/cadre/reopen", Some(json!({ "year": 2026, "month": 5, "user_id": uid })), Some(&admin)).await;
    assert_eq!(r.json(), json!({ "ok": true }));
    let r = t.call("POST", &format!("/api/validations/company/{cid}/reopen"), Some(json!({ "month": 5 })), Some(&admin)).await;
    assert_eq!(r.error(), "year/month invalides");
    // Unknown company: the foreign key fails.
    let r = t.call("POST", "/api/validations/company/999", Some(json!({ "year": 2026, "month": 5 })), Some(&admin)).await;
    assert_eq!(r.error(), "Élément référencé introuvable");

    // Guards: the path id is checked before the route-level admin check.
    let r = t.call("GET", "/api/validations/company/abc?year=2026&month=5", None, Some(&cadre)).await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Identifiant invalide"));
    let r = t.call("GET", &format!("/api/validations/company/{cid}?year=2026&month=5"), None, Some(&cadre)).await;
    assert_eq!(r.status, 403);
    assert_eq!(t.call("GET", "/api/validations/overview?year=2026&month=5", None, Some(&cadre)).await.status, 403);
    assert_eq!(t.call("GET", "/api/validations/nope", None, Some(&cadre)).await.status, 404);
    assert_eq!(t.call("GET", "/api/validations/nope", None, None).await.status, 401);
}
