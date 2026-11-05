use std::time::Instant;

use serde_json::json;

use super::{Ctx, with_cookie};
use crate::{
    auth::{clear_cookie, hash_password, set_cookie, sign_token, verify_password},
    client_ip::client_ip,
    error::{ApiResult, fail, ok_json},
    validate::{js_trim, non_empty_str, password_error},
};

/// `req.ip`.
fn ip(c: &Ctx) -> String {
    let xff: Vec<&str> = c
        .headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect();
    let xff = (!xff.is_empty()).then(|| xff.join(", "));
    client_ip(&c.peer, xff.as_deref())
}

type LoginRow = (i32, String, String, String, String, bool, Option<i32>, Option<String>);

pub async fn login(c: &Ctx) -> ApiResult {
    let (Some(email), Some(password)) = (non_empty_str(c.b("email")), non_empty_str(c.b("password"))) else {
        return fail(400, "Email et mot de passe requis");
    };
    let key = js_trim(email).to_lowercase();
    let ip = ip(c);
    let wait = c.st.limiter().locked_for(&ip, &key, Instant::now());
    if !wait.is_zero() {
        let minutes = wait.as_millis().div_ceil(60_000);
        return fail(429, format!("Trop de tentatives. Réessayez dans {minutes} min."));
    }

    let user: Option<LoginRow> = sqlx::query_as(
        "SELECT u.id, u.full_name, u.email, u.password_hash, u.role::text, u.active,
                u.company_id, c.name AS company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE lower(u.email) = $1",
    )
    .bind(&key)
    .fetch_optional(&c.st.pool)
    .await?;
    let hash = user
        .as_ref()
        .map(|u| u.3.clone())
        .unwrap_or_else(|| c.st.dummy_hash.clone());
    let ok = verify_password(password.to_string(), hash).await;
    let Some((id, full_name, email, _, role, _, company_id, company_name)) = user.filter(|u| ok && u.5) else {
        c.st.limiter().record_failure(&ip, &key, Instant::now());
        return fail(401, "Identifiants incorrects");
    };
    c.st.limiter().clear_account(&ip, &key);
    let body = json!({
        "id": id, "fullName": full_name, "email": email, "role": role,
        "companyId": company_id, "companyName": company_name,
    });
    Ok(with_cookie(
        ok_json(&body)?,
        set_cookie(c.st.cfg.cookie_secure, &sign_token(c.st.jwt_secret(), id)),
    ))
}

pub async fn logout(_: &Ctx) -> ApiResult {
    Ok(with_cookie(ok_json(&json!({ "ok": true }))?, clear_cookie()))
}

/// GET /me needs a session; the auth mount has no router-level guard.
#[allow(clippy::result_large_err)]
async fn session(c: &Ctx) -> Result<crate::auth::User, axum::response::Response> {
    crate::auth::authenticate(&c.st, &c.headers)
        .await
        .map_err(super::auth_error)
}

pub async fn me(c: &Ctx) -> ApiResult {
    match session(c).await {
        Ok(u) => ok_json(&u.public()),
        Err(res) => Ok(res),
    }
}

/// Any signed-in user changes their own password; the current one is required.
pub async fn password(c: &Ctx) -> ApiResult {
    let user = match session(c).await {
        Ok(u) => u,
        Err(res) => return Ok(res),
    };
    if let Some(err) = password_error(c.b("password")) {
        return fail(400, err);
    }
    let Some(current) = non_empty_str(c.b("current")) else {
        return fail(400, "Mot de passe actuel requis");
    };
    let hash: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&c.st.pool)
        .await?;
    let Some(hash) = hash else {
        return fail(401, "Session invalide ou expirée");
    };
    if !verify_password(current.to_string(), hash).await {
        return fail(400, "Mot de passe actuel incorrect");
    }
    let new_hash = hash_password(c.b("password").and_then(|v| v.as_str()).unwrap().to_string()).await?;
    sqlx::query("UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2")
        .bind(new_hash)
        .bind(user.id)
        .execute(&c.st.pool)
        .await?;
    // Other sessions are now invalid; keep this one alive with a fresh token.
    Ok(with_cookie(
        ok_json(&json!({ "ok": true }))?,
        set_cookie(c.st.cfg.cookie_secure, &sign_token(c.st.jwt_secret(), user.id)),
    ))
}
