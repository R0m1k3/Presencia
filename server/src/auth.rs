//! Session cookie (JWT HS256), password hashing and the session check run by
//! every protected route.

use axum::http::{HeaderMap, HeaderValue, header};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde_json::{Value, json};

use crate::{AppState, error::ApiError};

pub const COOKIE_NAME: &str = "presencia_token";
const MAX_AGE_SECS: i64 = 12 * 60 * 60;

/// Values that have shipped in this repository or its docs.
pub const KNOWN_PLACEHOLDERS: [&str; 2] = ["change-me-to-a-long-random-string", "dev-secret-change-me"];

/// The signed-in account, read from the database on every request.
#[derive(Clone, Debug)]
pub struct User {
    pub id: i32,
    pub full_name: String,
    pub email: String,
    pub role: String,
    pub company_id: Option<i32>,
    pub company_name: Option<String>,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }

    pub fn public(&self) -> Value {
        json!({
            "id": self.id,
            "fullName": self.full_name,
            "email": self.email,
            "role": self.role,
            "companyId": self.company_id,
            "companyName": self.company_name,
        })
    }
}

pub fn sign_token(secret: &[u8], user_id: i32) -> String {
    let iat = Utc::now().timestamp();
    let claims = json!({ "id": user_id, "iat": iat, "exp": iat + MAX_AGE_SECS });
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .expect("HS256 signing")
}

/// `jwt.verify(token, secret, { algorithms: ['HS256'] })`: the payload, or
/// `None` when the token is invalid, expired or not yet valid.
pub fn verify_token(secret: &[u8], token: &str) -> Option<serde_json::Map<String, Value>> {
    let mut v = Validation::new(Algorithm::HS256);
    // exp / nbf are checked below with jsonwebtoken's (Node) rules.
    v.validate_exp = false;
    v.validate_nbf = false;
    v.validate_aud = false;
    v.required_spec_claims.clear();
    let data = jsonwebtoken::decode::<Value>(token, &DecodingKey::from_secret(secret), &v).ok()?;
    let Value::Object(payload) = data.claims else {
        return None;
    };
    let now = Utc::now().timestamp() as f64;
    match payload.get("exp") {
        None => {}
        Some(Value::Number(n)) if now < n.as_f64()? => {}
        Some(_) => return None,
    }
    match payload.get("nbf") {
        None => {}
        Some(Value::Number(n)) if n.as_f64()? <= now => {}
        Some(_) => return None,
    }
    Some(payload)
}

/// `res.cookie(...)` as Express writes it.
pub fn set_cookie(secure: bool, token: &str) -> HeaderValue {
    let expires = (Utc::now() + chrono::Duration::seconds(MAX_AGE_SECS)).format("%a, %d %b %Y %H:%M:%S GMT");
    let secure = if secure { "; Secure" } else { "" };
    let token = percent_encoding::utf8_percent_encode(token, COOKIE_VALUE).to_string();
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; Max-Age={MAX_AGE_SECS}; Path=/; Expires={expires}; HttpOnly{secure}; SameSite=Lax"
    ))
    .expect("ASCII cookie")
}

/// Characters `encodeURIComponent` escapes.
const COOKIE_VALUE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

pub fn clear_cookie() -> HeaderValue {
    HeaderValue::from_static("presencia_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT")
}

/// The session cookie, read like `cookie-parser`: first occurrence, quotes
/// removed, URI-decoded, `j:` JSON strings unwrapped.
pub fn read_cookie(headers: &HeaderMap) -> Option<String> {
    for h in headers.get_all(header::COOKIE) {
        let Ok(h) = h.to_str() else { continue };
        for pair in h.split(';') {
            let Some((k, v)) = pair.split_once('=') else { continue };
            if k.trim() != COOKIE_NAME {
                continue;
            }
            let mut v = v.trim();
            if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
                v = &v[1..v.len() - 1];
            }
            let v = if v.contains('%') {
                percent_encoding::percent_decode_str(v)
                    .decode_utf8()
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| v.to_string())
            } else {
                v.to_string()
            };
            if let Some(json) = v.strip_prefix("j:")
                && let Ok(Value::String(s)) = serde_json::from_str::<Value>(json)
                && !s.is_empty()
            {
                return Some(s);
            }
            return Some(v);
        }
    }
    None
}

pub enum AuthError {
    /// 401 « Non authentifié ».
    Missing,
    /// 401 « Session invalide ou expirée », and the cookie is cleared.
    Invalid,
    Db(ApiError),
}

/// `requireAuth`.
pub async fn authenticate(st: &AppState, headers: &HeaderMap) -> Result<User, AuthError> {
    let token = read_cookie(headers)
        .filter(|t| !t.is_empty())
        .ok_or(AuthError::Missing)?;
    let payload = verify_token(st.jwt_secret(), &token).ok_or(AuthError::Invalid)?;
    let id = match payload.get("id") {
        Some(Value::Number(n)) => n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    };
    let Some(id) = id.and_then(|i| i32::try_from(i).ok()) else {
        return Err(AuthError::Invalid);
    };
    let row: Option<(
        i32,
        String,
        String,
        String,
        Option<i32>,
        bool,
        Option<i64>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT u.id, u.full_name, u.email, u.role::text, u.company_id, u.active,
                floor(extract(epoch FROM u.password_changed_at))::bigint,
                c.name
         FROM users u LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await
    .map_err(|e| AuthError::Db(e.into()))?;
    let Some((id, full_name, email, role, company_id, active, changed_at, company_name)) = row else {
        return Err(AuthError::Invalid);
    };
    // `payload.iat < changedAt`, false when iat is missing.
    let iat = payload.get("iat").and_then(Value::as_f64);
    if !active || iat.is_some_and(|iat| iat < changed_at.unwrap_or(0) as f64) {
        return Err(AuthError::Invalid);
    }
    Ok(User {
        id,
        full_name,
        email,
        role,
        company_id,
        company_name,
    })
}

pub async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || {
        bcrypt::hash_with_result(password.as_bytes(), 10).map(|h| h.format_for_version(bcrypt::Version::TwoA))
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .map_err(|e| ApiError::Internal(e.to_string()))
}

/// `bcrypt.compare`: false for a malformed hash; input past 72 bytes is ignored.
pub async fn verify_password(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || bcrypt::verify(password.as_bytes(), &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}
