use std::collections::HashMap;

use serde_json::{Value, json};

use super::Ctx;
use crate::{
    error::{ApiError, ApiResult, fail, ok_json},
    status::{PERIODS, STATUSES},
    validate::{YearMonth, checked_id, field, is_date, month_start, parse_year_month},
};

/// Whose planning a request acts on.
#[derive(Clone, Copy)]
pub struct Target {
    pub id: i32,
    pub company_id: Option<i32>,
}

/// A cadre only ever acts on themselves; an admin may pass `user_id` to act
/// on anyone.
async fn resolve_target(c: &Ctx, requested: Option<&Value>) -> Result<Target, ApiError> {
    let me = c.user();
    if matches!(requested, None | Some(Value::Null)) || requested == Some(&Value::String(String::new())) {
        return Ok(Target {
            id: me.id,
            company_id: me.company_id,
        });
    }
    if !me.is_admin() {
        return fail(403, "Accès refusé");
    }
    let id = checked_id(requested, "Utilisateur invalide")?;
    let row: Option<(i32, Option<i32>)> = sqlx::query_as("SELECT id, company_id FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&c.st.pool)
        .await?;
    match row {
        Some((id, company_id)) => Ok(Target { id, company_id }),
        None => fail(404, "Utilisateur introuvable"),
    }
}

struct MonthState {
    cadre_validated: bool,
    cadre_validated_at: Value,
    company_validated: bool,
    company_validated_at: Value,
}

fn truthy_field(v: &Option<Value>, key: &str) -> bool {
    v.as_ref()
        .and_then(|v| field(v, key))
        .is_some_and(|f| f == &Value::Bool(true))
}

/// `x || null` on a row_to_json field.
fn field_or_null(v: &Option<Value>, key: &str) -> Value {
    match v.as_ref().and_then(|v| field(v, key)) {
        Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
        _ => Value::Null,
    }
}

async fn month_state(c: &Ctx, t: Target, ym: YearMonth) -> Result<MonthState, ApiError> {
    let (lock, company): (Option<Value>, Option<Value>) = sqlx::query_as(
        "SELECT
           (SELECT row_to_json(ml) FROM (
              SELECT cadre_validated, cadre_validated_at FROM month_locks
              WHERE user_id = $1 AND year = $3 AND month = $4) ml) AS lock,
           (SELECT row_to_json(cv) FROM (
              SELECT admin_validated, admin_validated_at FROM company_month_validations
              WHERE company_id = $2 AND year = $3 AND month = $4) cv) AS company",
    )
    .bind(t.id)
    .bind(t.company_id)
    .bind(ym.year)
    .bind(ym.month)
    .fetch_one(&c.st.pool)
    .await?;
    Ok(MonthState {
        cadre_validated: truthy_field(&lock, "cadre_validated"),
        cadre_validated_at: field_or_null(&lock, "cadre_validated_at"),
        company_validated: truthy_field(&company, "admin_validated"),
        company_validated_at: field_or_null(&company, "admin_validated_at"),
    })
}

/// Nobody edits a month the admin validated for the company; a cadre cannot
/// edit a month they validated themselves (423).
async fn ensure_writable(c: &Ctx, t: Target, ym: YearMonth) -> Result<(), ApiError> {
    let st = month_state(c, t, ym).await?;
    if st.company_validated {
        return fail(423, "Ce mois a été validé par l’administrateur et est verrouillé");
    }
    if !c.user().is_admin() && st.cadre_validated {
        return fail(
            423,
            "Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.",
        );
    }
    Ok(())
}

fn ym_of(date: &str) -> YearMonth {
    YearMonth {
        year: date[0..4].parse().unwrap(),
        month: date[5..7].parse().unwrap(),
    }
}

fn one_of(v: Option<&Value>, set: &[&str]) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| set.contains(&s))
}

fn str_of(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or_default().to_string()
}

pub async fn get(c: &Ctx) -> ApiResult {
    let Some(ym) = parse_year_month(c.q("year"), c.q("month")) else {
        return fail(400, "year et month requis");
    };
    let t = resolve_target(c, c.q("user_id")).await?;
    let entries = sqlx::query_as::<_, (String, String, String)>(
        "SELECT entry_date::text, period::text, status::text
         FROM attendance_entries
         WHERE user_id = $1
           AND entry_date >= $2::date
           AND entry_date < ($2::date + INTERVAL '1 month')
         ORDER BY attendance_entries.entry_date, attendance_entries.period",
    )
    .bind(t.id)
    .bind(month_start(ym))
    .fetch_all(&c.st.pool);
    // Both queries at once, like the Promise.all of the Node version.
    let (rows, st) = tokio::try_join!(async { entries.await.map_err(ApiError::from) }, month_state(c, t, ym))?;
    let editable = if c.user().is_admin() {
        !st.company_validated
    } else {
        !st.cadre_validated && !st.company_validated
    };
    let entries: Vec<Value> = rows
        .into_iter()
        .map(|(d, p, s)| json!({ "date": d, "period": p, "status": s }))
        .collect();
    ok_json(&json!({
        "userId": t.id,
        "entries": entries,
        "cadreValidated": st.cadre_validated,
        "cadreValidatedAt": st.cadre_validated_at,
        "companyValidated": st.company_validated,
        "companyValidatedAt": st.company_validated_at,
        "editable": editable,
    }))
}

pub async fn put(c: &Ctx) -> ApiResult {
    let (date, period, status) = (c.b("date"), c.b("period"), c.b("status"));
    if !is_date(date) || !one_of(period, &PERIODS) || !one_of(status, &STATUSES) {
        return fail(400, "Paramètres invalides");
    }
    let t = resolve_target(c, c.b("user_id")).await?;
    let date = str_of(date);
    ensure_writable(c, t, ym_of(&date)).await?;
    sqlx::query(
        "INSERT INTO attendance_entries (user_id, entry_date, period, status, updated_at)
         VALUES ($1, $2::date, $3::half_day_period, $4::attendance_status, now())
         ON CONFLICT (user_id, entry_date, period)
         DO UPDATE SET status = EXCLUDED.status, updated_at = now()",
    )
    .bind(t.id)
    .bind(date)
    .bind(str_of(period))
    .bind(str_of(status))
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}

/// Per-month aggregates for the history view, most recent month first.
pub async fn history(c: &Ctx) -> ApiResult {
    let t = resolve_target(c, c.q("user_id")).await?;
    let rows: Vec<(i32, i32, i64, i64, i64, i64, bool, bool)> = sqlx::query_as(
        "WITH months AS (
           SELECT EXTRACT(YEAR FROM entry_date)::int AS year,
                  EXTRACT(MONTH FROM entry_date)::int AS month,
                  COUNT(*) FILTER (WHERE status = 'present') AS present,
                  COUNT(*) FILTER (WHERE status = 'absent') AS absent,
                  COUNT(*) FILTER (WHERE status = 'conge') AS conge,
                  COUNT(*) FILTER (WHERE status = 'rtt') AS rtt
           FROM attendance_entries
           WHERE user_id = $1
           GROUP BY 1, 2
         )
         SELECT m.year, m.month, m.present, m.absent, m.conge, m.rtt,
                COALESCE(ml.cadre_validated, false) AS cadre_validated,
                COALESCE(cmv.admin_validated, false) AS company_validated
         FROM months m
         LEFT JOIN month_locks ml ON ml.user_id = $1 AND ml.year = m.year AND ml.month = m.month
         LEFT JOIN users u ON u.id = $1
         LEFT JOIN company_month_validations cmv
           ON cmv.company_id = u.company_id AND cmv.year = m.year AND cmv.month = m.month
         ORDER BY m.year DESC, m.month DESC
         LIMIT 24",
    )
    .bind(t.id)
    .fetch_all(&c.st.pool)
    .await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|(year, month, present, absent, conge, rtt, cv, sv)| {
            json!({
                "year": year, "month": month, "present": present, "absent": absent,
                "conge": conge, "rtt": rtt, "cadreValidated": cv, "companyValidated": sv,
            })
        })
        .collect();
    ok_json(&out)
}

/// Clear every entry of a month (« Tout effacer »).
pub async fn delete_month(c: &Ctx) -> ApiResult {
    let Some(ym) = parse_year_month(c.b("year"), c.b("month")) else {
        return fail(400, "Paramètres invalides");
    };
    let t = resolve_target(c, c.b("user_id")).await?;
    ensure_writable(c, t, ym).await?;
    sqlx::query(
        "DELETE FROM attendance_entries
         WHERE user_id = $1 AND entry_date >= $2::date AND entry_date < ($2::date + INTERVAL '1 month')",
    )
    .bind(t.id)
    .bind(month_start(ym))
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}

/// The `entries` of a bulk request (1 to 200, each with a valid date and
/// period, and a valid status when `with_status`), its target user, and the
/// check that every month it touches is writable.
async fn bulk_entries(c: &Ctx, with_status: bool) -> Result<(&Vec<Value>, Target), ApiError> {
    let entries = match c.b("entries") {
        Some(Value::Array(a)) if !a.is_empty() && a.len() <= 200 => a,
        _ => return fail(400, "Paramètres invalides"),
    };
    let valid = |e: &Value| {
        crate::validate::truthy(Some(e))
            && is_date(field(e, "date"))
            && one_of(field(e, "period"), &PERIODS)
            && (!with_status || one_of(field(e, "status"), &STATUSES))
    };
    if !entries.iter().all(valid) {
        return fail(400, "Paramètres invalides");
    }
    let t = resolve_target(c, c.b("user_id")).await?;

    let mut months: Vec<YearMonth> = Vec::new();
    for e in entries {
        let ym = ym_of(&str_of(field(e, "date")));
        if !months.contains(&ym) {
            months.push(ym);
        }
    }
    for ym in months {
        ensure_writable(c, t, ym).await?;
    }
    Ok((entries, t))
}

/// Bulk upsert; every month in the payload passes the same lock checks.
pub async fn bulk(c: &Ctx) -> ApiResult {
    let (entries, t) = bulk_entries(c, true).await?;

    // A half-day listed twice would make ON CONFLICT hit the same row twice:
    // the last one wins.
    let mut order: Vec<(String, String)> = Vec::new();
    let mut status: HashMap<(String, String), String> = HashMap::new();
    for e in entries {
        let key = (str_of(field(e, "date")), str_of(field(e, "period")));
        if !status.contains_key(&key) {
            order.push(key.clone());
        }
        status.insert(key, str_of(field(e, "status")));
    }
    let dates: Vec<String> = order.iter().map(|k| k.0.clone()).collect();
    let periods: Vec<String> = order.iter().map(|k| k.1.clone()).collect();
    let statuses: Vec<String> = order.iter().map(|k| status[k].clone()).collect();
    sqlx::query(
        "INSERT INTO attendance_entries (user_id, entry_date, period, status, updated_at)
         SELECT $1, d, p::half_day_period, s::attendance_status, now()
         FROM unnest($2::date[], $3::text[], $4::text[]) AS t(d, p, s)
         ON CONFLICT (user_id, entry_date, period)
         DO UPDATE SET status = EXCLUDED.status, updated_at = now()",
    )
    .bind(t.id)
    .bind(dates)
    .bind(periods)
    .bind(statuses)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true, "count": order.len() }))
}

/// `DELETE /api/attendance/bulk` (no Node counterpart: added with the new
/// UI, to clear or undo a selection in one statement).
pub async fn bulk_delete(c: &Ctx) -> ApiResult {
    let (entries, t) = bulk_entries(c, false).await?;
    let (dates, periods): (Vec<String>, Vec<String>) = entries
        .iter()
        .map(|e| (str_of(field(e, "date")), str_of(field(e, "period"))))
        .unzip();
    let done = sqlx::query(
        "DELETE FROM attendance_entries a
         USING unnest($2::date[], $3::text[]) AS t(d, p)
         WHERE a.user_id = $1 AND a.entry_date = t.d AND a.period = t.p::half_day_period",
    )
    .bind(t.id)
    .bind(dates)
    .bind(periods)
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true, "count": done.rows_affected() }))
}

pub async fn delete(c: &Ctx) -> ApiResult {
    let (date, period) = (c.b("date"), c.b("period"));
    if !is_date(date) || !one_of(period, &PERIODS) {
        return fail(400, "Paramètres invalides");
    }
    let t = resolve_target(c, c.b("user_id")).await?;
    let date = str_of(date);
    ensure_writable(c, t, ym_of(&date)).await?;
    sqlx::query(
        "DELETE FROM attendance_entries WHERE user_id = $1 AND entry_date = $2::date AND period = $3::half_day_period",
    )
    .bind(t.id)
    .bind(date)
    .bind(str_of(period))
    .execute(&c.st.pool)
    .await?;
    ok_json(&json!({ "ok": true }))
}
