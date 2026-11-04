mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn planning_and_locks() {
    let t = setup("attendance").await;
    let admin = t.admin().await;
    let (cid, uid, cadre) = t.company_with_cadre(&admin, "Acme", "c@acme.fr").await;

    let put = |cookie: String, body: serde_json::Value| {
        let t = &t;
        async move { t.call("PUT", "/api/attendance", Some(body), Some(&cookie)).await }
    };
    let r = put(
        cadre.clone(),
        json!({ "date": "2026-03-02", "period": "AM", "status": "present" }),
    )
    .await;
    assert_eq!(r.json(), json!({ "ok": true }));
    // Upsert of the same half-day.
    put(
        cadre.clone(),
        json!({ "date": "2026-03-02", "period": "AM", "status": "rtt" }),
    )
    .await;
    for bad in [
        json!({ "date": "2026-02-30", "period": "AM", "status": "present" }),
        json!({ "date": "2026-03-02", "period": "am", "status": "present" }),
        json!({ "date": "2026-03-02", "period": "AM", "status": "malade" }),
        json!({ "date": "2026-3-02", "period": "AM", "status": "present" }),
    ] {
        let r = put(cadre.clone(), bad).await;
        assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Paramètres invalides"));
    }
    let r = put(
        cadre.clone(),
        json!({ "date": "0000-01-01", "period": "AM", "status": "present" }),
    )
    .await;
    assert_eq!(r.error(), "Date invalide");

    // user_id: cadres act on themselves only; admins may target anyone, ids as strings.
    let r = put(
        cadre.clone(),
        json!({ "date": "2026-03-02", "period": "PM", "status": "present", "user_id": uid }),
    )
    .await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (403, "Accès refusé"));
    let r = put(
        cadre.clone(),
        json!({ "date": "2026-03-02", "period": "PM", "status": "present", "user_id": "" }),
    )
    .await;
    assert_eq!(r.status, 200);
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-03", "period": "PM", "status": "conge", "user_id": uid.to_string() }),
    )
    .await;
    assert_eq!(r.status, 200);
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-03", "period": "PM", "status": "conge", "user_id": "abc" }),
    )
    .await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Utilisateur invalide"));
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-03", "period": "PM", "status": "conge", "user_id": [uid] }),
    )
    .await;
    assert_eq!((r.status.as_u16(), r.error().as_str()), (400, "Valeur invalide"));
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-03", "period": "PM", "status": "conge", "user_id": 999 }),
    )
    .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (404, "Utilisateur introuvable")
    );

    let r = t
        .call("GET", "/api/attendance?year=2026&month=3", None, Some(&cadre))
        .await;
    assert_eq!(
        r.json(),
        json!({
            "userId": uid,
            "entries": [
                { "date": "2026-03-02", "period": "AM", "status": "rtt" },
                { "date": "2026-03-02", "period": "PM", "status": "present" },
                { "date": "2026-03-03", "period": "PM", "status": "conge" },
            ],
            "cadreValidated": false, "cadreValidatedAt": null,
            "companyValidated": false, "companyValidatedAt": null, "editable": true,
        })
    );
    let r = t
        .call(
            "GET",
            &format!("/api/attendance?year=2026&month=3&user_id={uid}"),
            None,
            Some(&admin),
        )
        .await;
    assert_eq!(r.json()["entries"].as_array().unwrap().len(), 3);
    for q in [
        "year=2026",
        "year=1999&month=1",
        "year=2026&month=13",
        "year=abc&month=1",
    ] {
        let r = t.call("GET", &format!("/api/attendance?{q}"), None, Some(&cadre)).await;
        assert_eq!(
            (r.status.as_u16(), r.error().as_str()),
            (400, "year et month requis"),
            "{q}"
        );
    }
    assert_eq!(
        t.call("GET", "/api/attendance?year=2026.9&month=3x", None, Some(&cadre))
            .await
            .status,
        200
    );

    // Bulk with a duplicate half-day: the last one wins.
    let entries = json!([
        { "date": "2026-03-04", "period": "AM", "status": "present" },
        { "date": "2026-03-04", "period": "AM", "status": "absent" },
        { "date": "2026-03-04", "period": "PM", "status": "present" },
    ]);
    let r = t
        .call(
            "PUT",
            "/api/attendance/bulk",
            Some(json!({ "entries": entries })),
            Some(&cadre),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true, "count": 2 }));
    let r = t
        .call("GET", "/api/attendance?year=2026&month=3", None, Some(&cadre))
        .await;
    assert_eq!(
        r.json()["entries"][3],
        json!({ "date": "2026-03-04", "period": "AM", "status": "absent" })
    );
    for bad in [
        json!({ "entries": [] }),
        json!({ "entries": [null] }),
        json!({ "entries": "x" }),
        json!({ "entries": vec![json!({ "date": "2026-03-04", "period": "AM", "status": "present" }); 201] }),
    ] {
        assert_eq!(
            t.call("PUT", "/api/attendance/bulk", Some(bad), Some(&cadre))
                .await
                .error(),
            "Paramètres invalides"
        );
    }

    let r = t
        .call(
            "DELETE",
            "/api/attendance",
            Some(json!({ "date": "2026-03-04", "period": "PM" })),
            Some(&cadre),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true }));

    // History.
    let r = t.call("GET", "/api/attendance/history", None, Some(&cadre)).await;
    assert_eq!(
        r.json(),
        json!([{ "year": 2026, "month": 3, "present": 1, "absent": 1, "conge": 1, "rtt": 1, "cadreValidated": false, "companyValidated": false }])
    );

    // Cadre validation locks the cadre but not the admin.
    let r = t
        .call(
            "POST",
            "/api/validations/cadre",
            Some(json!({ "year": 2026, "month": 3 })),
            Some(&cadre),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true }));
    let r = put(
        cadre.clone(),
        json!({ "date": "2026-03-05", "period": "AM", "status": "present" }),
    )
    .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (
            423,
            "Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier."
        )
    );
    let r = t
        .call("GET", "/api/attendance?year=2026&month=3", None, Some(&cadre))
        .await;
    let b = r.json();
    assert_eq!(
        (b["cadreValidated"].as_bool(), b["editable"].as_bool()),
        (Some(true), Some(false))
    );
    // row_to_json timestamp format (session in UTC).
    let at = b["cadreValidatedAt"].as_str().unwrap();
    assert!(at.ends_with("+00:00") && at.contains('T'), "{at}");
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-05", "period": "AM", "status": "present", "user_id": uid }),
    )
    .await;
    assert_eq!(r.status, 200, "admin correction on a validated cadre month");

    // Company validation locks everyone, bulk included.
    let r = t
        .call(
            "POST",
            &format!("/api/validations/company/{cid}"),
            Some(json!({ "year": 2026, "month": 3 })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true }));
    let r = put(
        admin.clone(),
        json!({ "date": "2026-03-05", "period": "AM", "status": "present", "user_id": uid }),
    )
    .await;
    assert_eq!(
        (r.status.as_u16(), r.error().as_str()),
        (423, "Ce mois a été validé par l’administrateur et est verrouillé")
    );
    let entries = json!([{ "date": "2026-04-01", "period": "AM", "status": "present" }, { "date": "2026-03-31", "period": "AM", "status": "present" }]);
    let r = t
        .call(
            "PUT",
            "/api/attendance/bulk",
            Some(json!({ "entries": entries, "user_id": uid })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.status, 423);
    let r = t
        .call(
            "DELETE",
            "/api/attendance/month",
            Some(json!({ "year": 2026, "month": 3, "user_id": uid })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.status, 423);
    let r = t.call("GET", "/api/attendance/history", None, Some(&cadre)).await;
    assert_eq!(r.json()[0]["companyValidated"], true);

    // Reopen, then « Tout effacer ».
    t.call(
        "POST",
        &format!("/api/validations/company/{cid}/reopen"),
        Some(json!({ "year": 2026, "month": 3 })),
        Some(&admin),
    )
    .await;
    let r = t
        .call(
            "DELETE",
            "/api/attendance/month",
            Some(json!({ "year": "2026", "month": "3", "user_id": uid })),
            Some(&admin),
        )
        .await;
    assert_eq!(r.json(), json!({ "ok": true }));
    assert_eq!(
        t.call(
            "DELETE",
            "/api/attendance/month",
            Some(json!({ "year": 2026 })),
            Some(&admin)
        )
        .await
        .error(),
        "Paramètres invalides"
    );
    let r = t
        .call("GET", "/api/attendance?year=2026&month=3", None, Some(&cadre))
        .await;
    assert_eq!(r.json()["entries"], json!([]));
}
