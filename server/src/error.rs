//! `{error}` responses and the mapping of Postgres errors, as in the Express
//! error handler.

use axum::{
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::{Value, json};

pub type ApiResult = Result<Response, ApiError>;

#[derive(Debug)]
pub enum ApiError {
    /// A ready response (status and JSON body).
    Http(StatusCode, Value),
    Db(sqlx::Error),
    Internal(String),
}

impl ApiError {
    pub fn new(status: u16, msg: impl Into<String>) -> Self {
        ApiError::Http(StatusCode::from_u16(status).unwrap(), json!({ "error": msg.into() }))
    }

    /// The SQLSTATE of a database error.
    pub fn pg_code(&self) -> Option<String> {
        match self {
            ApiError::Db(sqlx::Error::Database(e)) => e.code().map(|c| c.into_owned()),
            _ => None,
        }
    }

    /// Route-specific translation of a SQLSTATE, the rest left as is.
    pub fn on_pg(self, code: &str, status: u16, msg: &str) -> Self {
        if self.pg_code().as_deref() == Some(code) { ApiError::new(status, msg) } else { self }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Db(e)
    }
}

/// Postgres errors caused by the request content rather than by the server.
fn client_pg_error(code: &str) -> Option<&'static str> {
    Some(match code {
        "22P02" => "Valeur invalide",
        "22007" | "22008" => "Date invalide",
        "22001" => "Valeur trop longue",
        "23503" => "Élément référencé introuvable",
        _ => return None,
    })
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Some(msg) = self.pg_code().as_deref().and_then(client_pg_error) {
            return json_response(StatusCode::BAD_REQUEST, &json!({ "error": msg }));
        }
        match self {
            ApiError::Http(status, body) => json_response(status, &body),
            ApiError::Db(e) => internal(&e.to_string()),
            ApiError::Internal(msg) => internal(&msg),
        }
    }
}

fn internal(msg: &str) -> Response {
    eprintln!("{msg}");
    json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": "Erreur interne du serveur" }))
}

/// `res.status(s).json(body)`.
pub fn json_response<T: Serialize + ?Sized>(status: StatusCode, body: &T) -> Response {
    let bytes = serde_json::to_vec(body).expect("serializable body");
    let mut res = (status, bytes).into_response();
    res.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    res
}

pub fn ok_json<T: Serialize + ?Sized>(body: &T) -> ApiResult {
    Ok(json_response(StatusCode::OK, body))
}

pub fn fail<T>(status: u16, msg: impl Into<String>) -> Result<T, ApiError> {
    Err(ApiError::new(status, msg))
}
