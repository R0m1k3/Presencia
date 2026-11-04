use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::{Ctx, js_date_opt};
use crate::{
    error::{ApiError, ApiResult, fail, ok_json},
    validate::{IdParam, YearMonth, id_param, is_id_str, js_string, month_start, parse_year_month, truthy},
};

/// `req.body?.year ?? req.query?.year`, same for month.
fn year_month(c: &Ctx) -> Option<YearMonth> {
    let pick = |k: &str| c.b(k).filter(|v| !v.is_null()).or_else(|| c.q(k));
    parse_year_month(pick("year"), pick("month"))
}

/// Cadre validates their own month; an admin may validate for a cadre.
pub async fn cadre(c: &Ctx) -> ApiResult {
    let Some(ym) = year_month(c) else { return fail(400, "year/month invalides") };
    let me = c.user();
    let requested = c.b("user_id").filter(|v| me.is_admin() && truthy(Some(v)));
    let target_id = match requested {
        None => me.id,
        Some(v) => {
            if !is_id_str(&js_string(Some(v))) {
                return fail(400, "Utilisateur invalide");
            }
            match id_param(Some(v)) {
                IdParam::Id(id) => id,
                IdParam::Invalid => return fail(400, "Valeur invalide"),
            }
        }
    };
    let target: Option<(i32, Option<i32>)> = sqlx::query_as("SELECT id, company_id FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_optional(&c.st.pool)
        .await?;
    let Some((id, company_id)) = target else { return fail(404, "Utilisateur introuvable") };

    let validated: Option<bool> = sqlx::query_scalar(
        "SELECT admin_validated FROM company_month_validations WHERE company_id = $1 AND year = $2 AND month = $3",
    )
    .bind(company_id)
    .bind(ym.year)
    .bind(ym.month)
    .fetch_optional(&c.st.pool)
    .await?;
    if validated == Some(true) {
        return fail(423, "La société a déjà été validée par l’administrateur pour ce mois");
    }
    sqlx::query(
        "INSERT INTO month_locks (user_id, year, month, cadre_validated, cadre_validated_at)
         VALUES ($1, $2, $3, true, now())
         ON CONFLICT (user_id, year, month)
         DO UPDATE SET cadre_validated = true, cadre_validated_at = now()",
    )
    .bind(id)
    .bind(ym.year)
    .bind(ym.month)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}

/// Admin reopens a cadre's month.
pub async fn cadre_reopen(c: &Ctx) -> ApiResult {
    let ym = year_month(c);
    let user = c.b("user_id").filter(|v| !v.is_null());
    let ok_id = user.is_some_and(|v| is_id_str(&js_string(Some(v))));
    let (Some(ym), true) = (ym, ok_id) else { return fail(400, "Paramètres invalides") };
    let IdParam::Id(user_id) = id_param(user) else { return fail(400, "Valeur invalide") };
    sqlx::query(
        "INSERT INTO month_locks (user_id, year, month, cadre_validated, cadre_validated_at)
         VALUES ($1, $2, $3, false, NULL)
         ON CONFLICT (user_id, year, month)
         DO UPDATE SET cadre_validated = false, cadre_validated_at = NULL",
    )
    .bind(user_id)
    .bind(ym.year)
    .bind(ym.month)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}

async fn company_validation(c: &Ctx, ym: YearMonth) -> Result<Option<(bool, Option<DateTime<Utc>>)>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT admin_validated, admin_validated_at
         FROM company_month_validations WHERE company_id = $1 AND year = $2 AND month = $3",
    )
    .bind(c.id)
    .bind(ym.year)
    .bind(ym.month)
    .fetch_optional(&c.st.pool)
    .await?)
}

/// Admin: status of every cadre of a company for a month.
pub async fn company(c: &Ctx) -> ApiResult {
    let Some(ym) = year_month(c) else { return fail(400, "year et month requis") };
    let cadres: Vec<(i32, String, String, Option<bool>, Option<DateTime<Utc>>, i64)> = sqlx::query_as(
        "SELECT u.id, u.full_name, u.email,
                ml.cadre_validated, ml.cadre_validated_at,
                COUNT(ae.id) AS filled
         FROM users u
         LEFT JOIN month_locks ml ON ml.user_id = u.id AND ml.year = $2 AND ml.month = $3
         LEFT JOIN attendance_entries ae ON ae.user_id = u.id
           AND ae.entry_date >= $4::date AND ae.entry_date < ($4::date + INTERVAL '1 month')
         WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true
         GROUP BY u.id, ml.cadre_validated, ml.cadre_validated_at
         ORDER BY u.full_name",
    )
    .bind(c.id)
    .bind(ym.year)
    .bind(ym.month)
    .bind(month_start(ym))
    .fetch_all(&c.st.pool)
    .await?;
    let cv = company_validation(c, ym).await?;
    let all = !cadres.is_empty() && cadres.iter().all(|r| r.3 == Some(true));
    let list: Vec<Value> = cadres
        .into_iter()
        .map(|(id, full_name, email, validated, at, filled)| {
            json!({
                "id": id, "fullName": full_name, "email": email, "filled": filled,
                "cadreValidated": validated == Some(true), "cadreValidatedAt": js_date_opt(at),
            })
        })
        .collect();
    ok_json(&json!({
        "cadres": list,
        "allCadresValidated": all,
        "companyValidated": cv.is_some_and(|v| v.0),
        "companyValidatedAt": js_date_opt(cv.and_then(|v| v.1)),
    }))
}

/// Admin: one-shot overview of every company for a month (dashboard).
pub async fn overview(c: &Ctx) -> ApiResult {
    let Some(ym) = year_month(c) else { return fail(400, "year et month requis") };
    let rows: Vec<(i32, String, i64, i64, Option<bool>)> = sqlx::query_as(
        "SELECT c.id, c.name,
                COUNT(u.id) FILTER (WHERE u.id IS NOT NULL) AS active_cadres,
                COUNT(u.id) FILTER (WHERE ml.cadre_validated) AS validated_cadres,
                BOOL_OR(cmv.admin_validated) AS company_validated
         FROM companies c
         LEFT JOIN users u ON u.company_id = c.id AND u.role = 'cadre' AND u.active = true
         LEFT JOIN month_locks ml ON ml.user_id = u.id AND ml.year = $1 AND ml.month = $2
         LEFT JOIN company_month_validations cmv ON cmv.company_id = c.id AND cmv.year = $1 AND cmv.month = $2
         GROUP BY c.id
         ORDER BY c.name",
    )
    .bind(ym.year)
    .bind(ym.month)
    .fetch_all(&c.st.pool)
    .await?;
    let (mut total, mut late, mut pending) = (0i64, 0i64, 0i64);
    let companies: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, active, validated, cv)| {
            let cv = cv == Some(true);
            total += active;
            if !cv {
                late += active - validated;
                pending += 1;
            }
            json!({ "id": id, "name": name, "activeCadres": active, "validatedCadres": validated, "companyValidated": cv })
        })
        .collect();
    ok_json(&json!({ "companies": companies, "totalActiveCadres": total, "lateCadres": late, "pendingCompanies": pending }))
}

/// Admin validates the whole company for the month (every cadre validated first).
pub async fn company_validate(c: &Ctx) -> ApiResult {
    let Some(ym) = year_month(c) else { return fail(400, "year/month invalides") };
    let cadres: Vec<(i32, String, Option<bool>)> = sqlx::query_as(
        "SELECT u.id, u.full_name, ml.cadre_validated
         FROM users u
         LEFT JOIN month_locks ml ON ml.user_id = u.id AND ml.year = $2 AND ml.month = $3
         WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true",
    )
    .bind(c.id)
    .bind(ym.year)
    .bind(ym.month)
    .fetch_all(&c.st.pool)
    .await?;
    let pending: Vec<&str> = cadres.iter().filter(|r| r.2 != Some(true)).map(|r| r.1.as_str()).collect();
    if !pending.is_empty() {
        return Err(ApiError::Http(
            StatusCode::CONFLICT,
            json!({ "error": "Tous les cadres doivent valider leur mois avant validation de la société", "pending": pending }),
        ));
    }
    sqlx::query(
        "INSERT INTO company_month_validations (company_id, year, month, admin_validated, admin_validated_at, admin_validated_by)
         VALUES ($1, $2, $3, true, now(), $4)
         ON CONFLICT (company_id, year, month)
         DO UPDATE SET admin_validated = true, admin_validated_at = now(), admin_validated_by = $4",
    )
    .bind(c.id)
    .bind(ym.year)
    .bind(ym.month)
    .bind(c.user().id)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}

/// Admin reopens a company's month validation.
pub async fn company_reopen(c: &Ctx) -> ApiResult {
    let Some(ym) = year_month(c) else { return fail(400, "year/month invalides") };
    sqlx::query(
        "INSERT INTO company_month_validations (company_id, year, month, admin_validated, admin_validated_at, admin_validated_by)
         VALUES ($1, $2, $3, false, NULL, NULL)
         ON CONFLICT (company_id, year, month)
         DO UPDATE SET admin_validated = false, admin_validated_at = NULL, admin_validated_by = NULL",
    )
    .bind(c.id)
    .bind(ym.year)
    .bind(ym.month)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}
