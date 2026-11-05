use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::{Ctx, js_date, with_cookie};
use crate::{
    auth::{hash_password, set_cookie, sign_token},
    error::{ApiError, ApiResult, fail, json_response, ok_json},
    validate::{is_email, is_id, is_name, js_id, js_trim, password_error, truthy},
};

type UserRow = (i32, String, String, String, Option<i32>, bool, DateTime<Utc>);
const RETURNING: &str = "RETURNING id, full_name, email, role::text, company_id, active, created_at";

fn user_json((id, full_name, email, role, company_id, active, created_at): UserRow) -> Value {
    json!({
        "id": id, "full_name": full_name, "email": email, "role": role,
        "company_id": company_id, "active": active, "created_at": js_date(created_at),
    })
}

/// Checked profile fields of a create or update.
struct Profile {
    full_name: String,
    email: String,
    role: String,
    /// NULL for an admin; `Err` when `pg` would send a value Postgres rejects
    /// (an array), which only fails once the query runs.
    company_id: Result<Option<i32>, ()>,
}

/// Shared checks for create and update (`profileError`).
fn profile(c: &Ctx) -> Result<Profile, ApiError> {
    let (full_name, email, role) = (c.b("full_name"), c.b("email"), c.b("role"));
    let email = match email {
        Some(Value::String(e)) if is_name(full_name) && !e.is_empty() && truthy(role) => e,
        _ => return fail(400, "Champs requis manquants"),
    };
    if !is_email(js_trim(email)) {
        return fail(400, "Adresse e-mail invalide");
    }
    let role = match role {
        Some(Value::String(r)) if r == "admin" || r == "cadre" => r.clone(),
        _ => return fail(400, "Rôle invalide"),
    };
    let company_id = if role == "admin" {
        Ok(None)
    } else {
        match js_id(c.b("company_id")) {
            None => return fail(400, "Une société doit être attribuée au cadre"),
            Some(id) => id.map(Some),
        }
    };
    Ok(Profile {
        full_name: js_trim(full_name.and_then(Value::as_str).unwrap()).to_string(),
        email: js_trim(email).to_lowercase(),
        role,
        company_id,
    })
}

/// The company parameter, or the 22P02 error Postgres gives for an array.
fn company_param(p: &Profile) -> Result<Option<i32>, ApiError> {
    p.company_id.map_err(|_| ApiError::new(400, "Valeur invalide"))
}

fn db_error(e: sqlx::Error) -> ApiError {
    ApiError::from(e)
        .on_pg("23505", 409, "Cet email existe déjà")
        .on_pg("23503", 400, "Société introuvable")
}

pub async fn list(c: &Ctx) -> ApiResult {
    let company = c.q("company_id").filter(|v| truthy(Some(v)));
    if company.is_some_and(|v| !is_id(Some(v))) {
        return fail(400, "Société invalide");
    }
    let filter = company.and_then(Value::as_str).map(|s| s.parse::<i32>().unwrap());
    let sql = format!(
        "SELECT u.id, u.full_name, u.email, u.role::text, u.company_id, u.active, u.created_at,
                c.name AS company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         {}
         ORDER BY u.full_name",
        if filter.is_some() {
            "WHERE u.company_id = $1"
        } else {
            ""
        }
    );
    let mut q = sqlx::query_as::<
        _,
        (
            i32,
            String,
            String,
            String,
            Option<i32>,
            bool,
            DateTime<Utc>,
            Option<String>,
        ),
    >(&sql);
    if let Some(id) = filter {
        q = q.bind(id);
    }
    let rows = q.fetch_all(&c.st.pool).await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(
            |(id, full_name, email, role, company_id, active, created_at, company_name)| {
                json!({
                    "id": id, "full_name": full_name, "email": email, "role": role,
                    "company_id": company_id, "active": active, "created_at": js_date(created_at),
                    "company_name": company_name,
                })
            },
        )
        .collect();
    ok_json(&out)
}

pub async fn create(c: &Ctx) -> ApiResult {
    let p = profile(c)?;
    if let Some(err) = password_error(c.b("password")) {
        return fail(400, err);
    }
    let hash = hash_password(c.b("password").and_then(Value::as_str).unwrap().to_string()).await?;
    let company_id = company_param(&p)?;
    let row: UserRow = sqlx::query_as(&format!(
        "INSERT INTO users (full_name, email, password_hash, role, company_id, active)
         VALUES ($1, $2, $3, $4::text::user_role, $5, true)
         {RETURNING}"
    ))
    .bind(p.full_name)
    .bind(p.email)
    .bind(hash)
    .bind(p.role)
    .bind(company_id)
    .fetch_one(&c.st.pool)
    .await
    .map_err(db_error)?;
    Ok(json_response(StatusCode::CREATED, &user_json(row)))
}

pub async fn update(c: &Ctx) -> ApiResult {
    let p = profile(c)?;
    let active = c.b("active") != Some(&Value::Bool(false));
    // An admin locking themselves out can only be undone in the database.
    if c.user().id == c.id && (!active || p.role != "admin") {
        return fail(400, "Vous ne pouvez pas désactiver ni rétrograder votre propre compte");
    }
    let company_id = company_param(&p)?;
    let row: Option<UserRow> = sqlx::query_as(&format!(
        "UPDATE users SET full_name = $1, email = $2, role = $3::text::user_role, company_id = $4, active = $5
         WHERE id = $6
         {RETURNING}"
    ))
    .bind(p.full_name)
    .bind(p.email)
    .bind(p.role)
    .bind(company_id)
    .bind(active)
    .bind(c.id)
    .fetch_optional(&c.st.pool)
    .await
    .map_err(db_error)?;
    match row {
        Some(row) => ok_json(&user_json(row)),
        None => fail(404, "Utilisateur introuvable"),
    }
}

pub async fn password(c: &Ctx) -> ApiResult {
    if let Some(err) = password_error(c.b("password")) {
        return fail(400, err);
    }
    let hash = hash_password(c.b("password").and_then(Value::as_str).unwrap().to_string()).await?;
    // Also ends that user's open sessions.
    let n = sqlx::query("UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2")
        .bind(hash)
        .bind(c.id)
        .execute(&c.st.pool)
        .await?
        .rows_affected();
    if n == 0 {
        return fail(404, "Utilisateur introuvable");
    }
    let res = ok_json(&json!({ "ok": true }))?;
    if c.user().id == c.id {
        return Ok(with_cookie(
            res,
            set_cookie(c.st.cfg.cookie_secure, &sign_token(c.st.jwt_secret(), c.id)),
        ));
    }
    Ok(res)
}

pub async fn delete(c: &Ctx) -> ApiResult {
    if c.user().id == c.id {
        return fail(400, "Vous ne pouvez pas supprimer votre propre compte");
    }
    let n = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(c.id)
        .execute(&c.st.pool)
        .await
        // Referenced as the author of a company validation.
        .map_err(|e| {
            ApiError::from(e).on_pg(
                "23503",
                409,
                "Compte référencé par des validations : désactivez-le plutôt",
            )
        })?
        .rows_affected();
    if n == 0 {
        return fail(404, "Utilisateur introuvable");
    }
    ok_json(&json!({ "ok": true }))
}
