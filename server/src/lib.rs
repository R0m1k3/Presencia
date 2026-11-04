//! Presencia API: Rust port of the Node/Express backend (commit f760cf6),
//! same JSON contract and same database.

// Query rows are read as tuples, in the column order of the SQL next to them.
#![allow(clippy::type_complexity)]

pub mod auth;
pub mod body;
pub mod bootstrap;
pub mod client_ip;
pub mod config;
pub mod db;
pub mod error;
pub mod export;
pub mod limiter;
pub mod routes;
pub mod status;
pub mod validate;

use std::{net::SocketAddr, ops::Deref, sync::Arc};

use axum::{
    Router,
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, header},
    response::Response,
};
use sqlx::PgPool;

pub struct Inner {
    pub pool: PgPool,
    pub cfg: config::Config,
    pub jwt_secret: Vec<u8>,
    pub limiter: std::sync::Mutex<limiter::Limiter>,
    /// Compared against when the email is unknown, so that a wrong email and
    /// a wrong password take the same time.
    pub dummy_hash: String,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    pub fn new(pool: PgPool, cfg: config::Config, jwt_secret: String) -> Self {
        let dummy_hash = bcrypt::hash("presencia-dummy-password", 10).expect("bcrypt");
        AppState(Arc::new(Inner {
            pool,
            cfg,
            jwt_secret: jwt_secret.into_bytes(),
            limiter: std::sync::Mutex::new(limiter::Limiter::default()),
            dummy_hash,
        }))
    }

    pub fn jwt_secret(&self) -> &[u8] {
        &self.0.jwt_secret
    }
}

/// Every request goes through one handler: the routing rules of Express
/// (case-insensitive paths, optional trailing slash, mount-level session
/// checks before the 404) do not map onto axum's router.
pub fn app(state: AppState) -> Router {
    Router::new().fallback(handle).with_state(state)
}

async fn handle(State(st): State<AppState>, ConnectInfo(peer): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let mut res = routes::dispatch(&st, peer, req).await;
    // The API is also reachable on its own port, without the nginx headers.
    let h = res.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}
