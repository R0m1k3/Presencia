use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::{Ctx, js_date};
use crate::{
    error::{ApiError, ApiResult, fail, json_response, ok_json},
    validate::{is_name, js_trim},
};

const NAME_REQUIRED: &str = "Nom requis (255 caractères maximum)";
const DUPLICATE: &str = "Cette société existe déjà";

fn company(id: i32, name: String, created_at: DateTime<Utc>) -> Value {
    json!({ "id": id, "name": name, "created_at": js_date(created_at) })
}

fn name(c: &Ctx) -> Result<String, ApiError> {
    if !is_name(c.b("name")) {
        return fail(400, NAME_REQUIRED);
    }
    Ok(js_trim(c.b("name").and_then(Value::as_str).unwrap()).to_string())
}

pub async fn list(c: &Ctx) -> ApiResult {
    let rows: Vec<(i32, String, DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT c.id, c.name, c.created_at,
                (COUNT(u.id) FILTER (WHERE u.role = 'cadre' AND u.active))::text AS active_cadre_count
         FROM companies c
         LEFT JOIN users u ON u.company_id = c.id
         GROUP BY c.id
         ORDER BY c.name",
    )
    .fetch_all(&c.st.pool)
    .await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, at, n)| json!({ "id": id, "name": name, "created_at": js_date(at), "active_cadre_count": n }))
        .collect();
    ok_json(&out)
}

pub async fn create(c: &Ctx) -> ApiResult {
    let name = name(c)?;
    let (id, name, at): (i32, String, DateTime<Utc>) =
        sqlx::query_as("INSERT INTO companies (name) VALUES ($1) RETURNING id, name, created_at")
            .bind(name)
            .fetch_one(&c.st.pool)
            .await
            .map_err(|e| ApiError::from(e).on_pg("23505", 409, DUPLICATE))?;
    Ok(json_response(axum::http::StatusCode::CREATED, &company(id, name, at)))
}

pub async fn update(c: &Ctx) -> ApiResult {
    let name = name(c)?;
    let row: Option<(i32, String, DateTime<Utc>)> =
        sqlx::query_as("UPDATE companies SET name = $1 WHERE id = $2 RETURNING id, name, created_at")
            .bind(name)
            .bind(c.id)
            .fetch_optional(&c.st.pool)
            .await
            .map_err(|e| ApiError::from(e).on_pg("23505", 409, DUPLICATE))?;
    match row {
        Some((id, name, at)) => ok_json(&company(id, name, at)),
        None => fail(404, "Société introuvable"),
    }
}

pub async fn delete(c: &Ctx) -> ApiResult {
    let n = sqlx::query("DELETE FROM companies WHERE id = $1")
        .bind(c.id)
        .execute(&c.st.pool)
        .await?
        .rows_affected();
    if n == 0 {
        return fail(404, "Société introuvable");
    }
    ok_json(&json!({ "ok": true }))
}
