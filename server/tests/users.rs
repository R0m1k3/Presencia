mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn crud_and_admin_guards() {
    let t = setup("users").await;
    let admin = t.admin().await;
    let (cid, uid, cadre) = t.company_with_cadre(&admin, "Acme", "c@acme.fr").await;

    let r = t.call("GET", "/api/users", None, Some(&admin)).await;
    let list = r.json();
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(list[1]["company_name"], "Acme");
    assert_eq!(list[1]["company_id"], cid);
    assert_eq!(
        t.call("GET", &format!("/api/users?company_id={cid}"), None, Some(&admin))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        t.call("GET", "/api/users?company_id=", None, Some(&admin))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for q in ["abc", "1&company_id=2", "07"] {
        let r = t
            .call("GET", &format!("/api/users?company_id={q}"), None, Some(&admin))
            .await;
        assert_eq!(
            (r.status.as_u16(), r.error().as_str()),
            (400, "Société invalide"),
            "{q}"
        );
    }
    assert_eq!(t.call("GET", "/api/users", None, Some(&cadre)).await.status, 403);

    let mk = |b: serde_json::Value| async { t.call("POST", "/api/users", Some(b), Some(&admin)).await };
    let r = mk(json!({ "full_name": " Jean Dupont ", "email": " Jean@Acme.FR ", "password": "password1", "role": "cadre", "company_id": cid.to_string() })).await;
    assert_eq!(r.status, 201);
    let u = r.json();
    assert_eq!(
        (u["full_name"].as_str(), u["email"].as_str(), u["active"].as_bool()),
        (Some("Jean Dupont"), Some("jean@acme.fr"), Some(true))
    );
    assert!(u.get("company_name").is_none());
    let jean = u["id"].as_i64().unwrap();

    let cases = [
        (
            json!({ "email": "a@b.c", "role": "cadre" }),
            400,
            "Champs requis manquants",
        ),
        (
            json!({ "full_name": "A", "email": "a@b", "role": "cadre", "company_id": cid }),
            400,
            "Adresse e-mail invalide",
        ),
        (
            json!({ "full_name": "A", "email": "a@b.c", "role": "boss" }),
            400,
            "Rôle invalide",
        ),
        (
            json!({ "full_name": "A", "email": "a@b.c", "role": "cadre", "company_id": 1.5 }),
            400,
            "Une société doit être attribuée au cadre",
        ),
        (
            json!({ "full_name": "A", "email": "a@b.c", "role": "cadre", "company_id": cid, "password": "short" }),
            400,
            "Mot de passe trop court (8 caractères minimum)",
        ),
        (
            json!({ "full_name": "A", "email": "a@b.c", "role": "cadre", "company_id": [cid], "password": "password1" }),
            400,
            "Valeur invalide",
        ),
        (
            json!({ "full_name": "A", "email": "a@b.c", "role": "cadre", "company_id": 999, "password": "password1" }),
            400,
            "Société introuvable",
        ),
        (
            json!({ "full_name": "A", "email": "JEAN@acme.fr", "role": "cadre", "company_id": cid, "password": "password1" }),
            409,
            "Cet email existe déjà",
        ),
    ];
    for (body, status, msg) in cases {
        let r = mk(body.clone()).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (status, msg), "{body}");
    }
    // An admin gets no company, whatever is sent.
    let r = mk(json!({ "full_name": "Admin 2", "email": "a2@x.fr", "password": "password1", "role": "admin", "company_id": "zzz" })).await;
    assert_eq!(r.json()["company_id"], serde_json::Value::Null);
    let a2_id = r.json()["id"].as_i64().unwrap() as i32;

    // Self-protection.
    let r = t
        .call(
            "PUT",
            "/api/users/1",
            Some(json!({ "full_name": "A", "email": "admin@test.fr", "role": "admin", "active": false })),
            Some(&admin),
        )
        .await;
    assert_eq!(
        r.error(),
        "Vous ne pouvez pas désactiver ni rétrograder votre propre compte"
    );
    let r = t
        .call(
            "PUT",
            "/api/users/1",
            Some(json!({ "full_name": "A", "email": "admin@test.fr", "role": "cadre", "company_id": cid })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.status, 400);
    let r = t.call("DELETE", "/api/users/1", None, Some(&admin)).await;
    assert_eq!(r.error(), "Vous ne pouvez pas supprimer votre propre compte");

    // Update, password reset (ends the cadre's sessions), delete.
    let r = t.call("PUT", &format!("/api/users/{uid}"), Some(json!({ "full_name": "Cadre B", "email": "c@acme.fr", "role": "cadre", "company_id": cid, "active": 0 })), Some(&admin)).await;
    assert_eq!(r.json()["active"], true, "only `false` deactivates");
    let r = t
        .call(
            "PUT",
            "/api/users/999",
            Some(json!({ "full_name": "X", "email": "x@x.fr", "role": "admin" })),
            Some(&admin),
        )
        .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (404, "Utilisateur introuvable")
    );
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let r = t
        .call(
            "PUT",
            &format!("/api/users/{uid}/password"),
            Some(json!({ "password": "another-pass" })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true }));
    assert!(r.header("set-cookie").is_none());
    assert_eq!(t.call("GET", "/api/auth/me", None, Some(&cadre)).await.status, 401);
    assert_eq!(
        t.call(
            "PUT",
            "/api/users/999/password",
            Some(json!({ "password": "another-pass" })),
            Some(&admin)
        )
        .await
        .status,
        404
    );
    let r = t
        .call(
            "PUT",
            "/api/users/1/password",
            Some(json!({ "password": "another-pass" })),
            Some(&admin),
        )
        .await;
    assert!(r.header("set-cookie").is_some(), "own password: fresh cookie");
    let admin = r.cookie().unwrap();

    // A validation author cannot be deleted.
    let a2 = t.login("a2@x.fr", "password1").await;
    sqlx::query("INSERT INTO company_month_validations (company_id, year, month, admin_validated, admin_validated_by) VALUES ($1, 2026, 1, true, $2)")
        .bind(cid as i32)
        .bind(a2_id)
        .execute(&t.pool)
        .await
        .unwrap();
    let _ = a2;
    let r = t
        .call("DELETE", &format!("/api/users/{a2_id}"), None, Some(&admin))
        .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (409, "Compte référencé par des validations : désactivez-le plutôt")
    );
    assert_eq!(
        t.call("DELETE", &format!("/api/users/{jean}"), None, Some(&admin))
            .await
            .json(),
        json!({ "ok": true })
    );
    assert_eq!(
        t.call("DELETE", &format!("/api/users/{jean}"), None, Some(&admin))
            .await
            .status,
        404
    );
}
