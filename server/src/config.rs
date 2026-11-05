//! Environment configuration. As with Node's `process.env.X || default`, an
//! empty variable counts as absent.

use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub pg_host: String,
    pub pg_port: u16,
    pub pg_user: String,
    pub pg_password: String,
    pub pg_database: String,
    pub jwt_secret: Option<String>,
    pub admin_email: String,
    pub admin_name: String,
    pub admin_password: Option<String>,
    pub cookie_secure: bool,
    pub cors_origin: Option<String>,
}

/// The variable's value, or `None` when it is unset or empty.
pub fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.is_empty())
}

fn or(name: &str, default: &str) -> String {
    var(name).unwrap_or_else(|| default.to_string())
}

/// `parseInt(v, 10)` for a port; falls back to the default when it is not a number.
fn port(name: &str, default: u16) -> u16 {
    var(name)
        .and_then(|v| {
            let digits: String = v.trim_start().chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().ok()
        })
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            port: port("PORT", 4790),
            pg_host: or("PGHOST", "db"),
            pg_port: port("PGPORT", 5432),
            pg_user: or("PGUSER", "presencia"),
            pg_password: or("PGPASSWORD", "presencia"),
            pg_database: or("PGDATABASE", "presencia"),
            jwt_secret: var("JWT_SECRET"),
            admin_email: or("ADMIN_EMAIL", "admin@presencia.local"),
            admin_name: or("ADMIN_NAME", "Administrateur"),
            admin_password: var("ADMIN_PASSWORD"),
            // Secure by default; COOKIE_SECURE=false only for plain-HTTP setups.
            cookie_secure: env::var("COOKIE_SECURE").map(|v| v != "false").unwrap_or(true),
            cors_origin: var("CORS_ORIGIN"),
        }
    }
}
