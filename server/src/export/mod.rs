//! Monthly company exports (active cadres only).

pub mod filename;
pub mod pdf;
pub mod xlsx;

use std::collections::HashMap;

use sqlx::PgPool;

pub struct Cadre {
    pub id: i32,
    pub full_name: String,
    /// `(YYYY-MM-DD, AM|PM)` → status.
    pub entries: HashMap<(String, String), String>,
}

impl Cadre {
    pub fn status(&self, date: &str, period: &str) -> Option<&str> {
        self.entries
            .get(&(date.to_string(), period.to_string()))
            .map(String::as_str)
    }
}

pub struct CompanyMonth {
    pub company_name: String,
    pub year: i32,
    pub month: i32,
    pub cadres: Vec<Cadre>,
}

impl CompanyMonth {
    pub fn date(&self, day: u32) -> String {
        format!("{}-{:02}-{:02}", self.year, self.month, day)
    }
}

/// `None` when the company does not exist.
pub async fn load(pool: &PgPool, company_id: i32, year: i32, month: i32) -> Result<Option<CompanyMonth>, sqlx::Error> {
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM companies WHERE id = $1")
        .bind(company_id)
        .fetch_optional(pool)
        .await?;
    let Some(company_name) = name else { return Ok(None) };
    let rows: Vec<(i32, String)> = sqlx::query_as(
        "SELECT id, full_name FROM users WHERE company_id = $1 AND role = 'cadre' AND active = true ORDER BY full_name",
    )
    .bind(company_id)
    .fetch_all(pool)
    .await?;
    // All entries of the month in one query, rather than one query per cadre.
    let entries: Vec<(i32, String, String, String)> = sqlx::query_as(
        "SELECT ae.user_id, ae.entry_date::text, ae.period::text, ae.status::text
         FROM attendance_entries ae
         JOIN users u ON u.id = ae.user_id
         WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true
           AND ae.entry_date >= $2::date AND ae.entry_date < ($2::date + INTERVAL '1 month')",
    )
    .bind(company_id)
    .bind(format!("{year}-{month:02}-01"))
    .fetch_all(pool)
    .await?;
    let mut cadres: Vec<Cadre> = rows
        .into_iter()
        .map(|(id, full_name)| Cadre {
            id,
            full_name,
            entries: HashMap::new(),
        })
        .collect();
    let index: HashMap<i32, usize> = cadres.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    for (user_id, date, period, status) in entries {
        // A cadre (re)activated between the two queries is simply left out.
        if let Some(&i) = index.get(&user_id) {
            cadres[i].entries.insert((date, period), status);
        }
    }
    Ok(Some(CompanyMonth {
        company_name,
        year,
        month,
        cadres,
    }))
}
