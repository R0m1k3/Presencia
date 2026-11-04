use axum::{
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};

use super::Ctx;
use crate::{
    error::{ApiError, ApiResult, fail},
    export::{self, CompanyMonth, filename::attachment},
    validate::parse_year_month,
};

async fn load(c: &Ctx) -> Result<CompanyMonth, ApiError> {
    let Some(ym) = parse_year_month(c.q("year"), c.q("month")) else { return fail(400, "year et month requis") };
    match export::load(&c.st.pool, c.id, ym.year, ym.month).await? {
        Some(d) => Ok(d),
        None => fail(404, "Société introuvable"),
    }
}

fn file(bytes: Vec<u8>, content_type: &'static str, disposition: String) -> Response {
    let mut res = (StatusCode::OK, bytes).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&disposition).expect("ASCII header"));
    res
}

pub async fn excel(c: &Ctx) -> ApiResult {
    let d = load(c).await?;
    let bytes = export::xlsx::build(&d).map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(file(
        bytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        attachment(&d.company_name, d.year, d.month, "xlsx"),
    ))
}

pub async fn pdf(c: &Ctx) -> ApiResult {
    let d = load(c).await?;
    Ok(file(export::pdf::build(&d), "application/pdf", attachment(&d.company_name, d.year, d.month, "pdf")))
}
