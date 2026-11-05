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
pub mod web;

use std::{
    net::SocketAddr,
    ops::Deref,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use axum::{
    Router,
    extract::{ConnectInfo, Request, State},
    http::{HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use sqlx::PgPool;

pub struct Inner {
    pub pool: PgPool,
    pub cfg: config::Config,
    pub jwt_secret: Vec<u8>,
    pub limiter: Mutex<limiter::Limiter>,
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
            limiter: Mutex::new(limiter::Limiter::default()),
            dummy_hash,
        }))
    }

    pub fn jwt_secret(&self) -> &[u8] {
        &self.0.jwt_secret
    }

    /// The limiter stays usable even if a panic happened while it was held
    /// (its state is a plain map, never left half-updated).
    pub fn limiter(&self) -> MutexGuard<'_, limiter::Limiter> {
        self.0.limiter.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Every request goes through one handler: the routing rules of Express
/// (case-insensitive paths, optional trailing slash, mount-level session
/// checks before the 404) do not map onto axum's router.
pub fn app(state: AppState) -> Router {
    Router::new().fallback(handle).with_state(state)
}

/// Node's `server.requestTimeout`: the whole request, body included.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

async fn handle(State(st): State<AppState>, ConnectInfo(peer): ConnectInfo<SocketAddr>, req: Request) -> Response {
    // The UI first, for every path outside the /api mount (matched the way
    // the router matches it: case-insensitive, optional trailing slash).
    let ui = match routes::strip_mount(req.uri().path(), "/api") {
        Some(_) => None,
        None => web::serve(req.method(), req.uri().path(), req.headers()),
    };
    let mut res = match ui {
        Some(res) => res,
        None => api(st, peer, req).await,
    };
    // Defaults only: a handler that sets one of these keeps its own value.
    let h = res.headers_mut();
    for (name, value) in [
        (HeaderName::from_static("x-content-type-options"), "nosniff"),
        (HeaderName::from_static("x-frame-options"), "DENY"),
        (HeaderName::from_static("referrer-policy"), "same-origin"),
        (HeaderName::from_static("content-security-policy"), CSP),
        (
            HeaderName::from_static("permissions-policy"),
            "camera=(), microphone=(), geolocation=()",
        ),
        (header::CACHE_CONTROL, "no-store"),
    ] {
        h.entry(name).or_insert(HeaderValue::from_static(value));
    }
    res
}

/// Same-origin only. No 'unsafe-inline' for styles: the Svelte build ships one
/// CSS file, and its `style:` bindings (bar widths, menu position) go through
/// the DOM style API, which CSP does not restrict.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; \
                   img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; \
                   base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/// The router, in its own task so that a panic becomes a 500 instead of a
/// dropped connection. Like a Node handler, it finishes even if the client
/// leaves, but never runs longer than REQUEST_TIMEOUT.
async fn api(st: AppState, peer: SocketAddr, req: Request) -> Response {
    let task =
        tokio::spawn(async move { tokio::time::timeout(REQUEST_TIMEOUT, routes::dispatch(&st, peer, req)).await });
    match task.await {
        Ok(Ok(res)) => res,
        Ok(Err(_elapsed)) => {
            let mut res = StatusCode::REQUEST_TIMEOUT.into_response();
            res.headers_mut()
                .insert(header::CONNECTION, HeaderValue::from_static("close"));
            res
        }
        Err(e) => error::ApiError::Internal(format!("panic: {e}")).into_response(),
    }
}
