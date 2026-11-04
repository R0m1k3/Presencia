//! Test harness: one throw-away database per test (PG* variables, e.g.
//! PGPORT=55432), the app called in-process with a mocked peer address.
#![allow(dead_code)]

use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::connect_info::MockConnectInfo,
    http::{HeaderMap, Request, StatusCode},
};
use http_body_util::BodyExt;
use presencia::{AppState, config::Config};
use serde_json::{Value, json};
use sqlx::{Connection, PgConnection, PgPool};
use tower::ServiceExt;

pub const ADMIN_EMAIL: &str = "admin@test.fr";
pub const ADMIN_PASSWORD: &str = "admin-password";

pub struct T {
    pub st: AppState,
    pub pool: PgPool,
    pub peer: SocketAddr,
}

pub struct Res {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub bytes: Vec<u8>,
}

impl Res {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes).unwrap_or(Value::Null)
    }
    pub fn error(&self) -> String {
        self.json()["error"].as_str().unwrap_or_default().to_string()
    }
    /// `name=value` of the first Set-Cookie.
    pub fn cookie(&self) -> Option<String> {
        let c = self.headers.get("set-cookie")?.to_str().ok()?;
        Some(c.split(';').next()?.to_string())
    }
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).map(|v| v.to_str().unwrap().to_string())
    }
}

pub fn test_config(db: &str) -> Config {
    let mut cfg = Config::from_env();
    for (k, d) in [("PGHOST", "127.0.0.1"), ("PGPORT", "55432")] {
        if std::env::var(k).is_err() {
            match k {
                "PGHOST" => cfg.pg_host = d.into(),
                _ => cfg.pg_port = d.parse().unwrap(),
            }
        }
    }
    cfg.pg_database = db.into();
    cfg.admin_email = ADMIN_EMAIL.into();
    cfg.admin_password = Some(ADMIN_PASSWORD.into());
    cfg.jwt_secret = Some("test-secret-test-secret-test-secret-0123".into());
    cfg.cookie_secure = false;
    cfg.cors_origin = None;
    cfg
}

pub async fn recreate_db(cfg: &Config) {
    let url = format!(
        "postgres://{}:{}@{}:{}/postgres",
        cfg.pg_user, cfg.pg_password, cfg.pg_host, cfg.pg_port
    );
    let mut c = PgConnection::connect(&url).await.expect("test cluster reachable (PGPORT=55432)");
    let db = &cfg.pg_database;
    for q in [format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"), format!("CREATE DATABASE {db}")] {
        sqlx::raw_sql(&q).execute(&mut c).await.unwrap();
    }
}

pub async fn setup(name: &str) -> T {
    setup_with(name, |_| {}).await
}

pub async fn setup_with(name: &str, tweak: impl FnOnce(&mut Config)) -> T {
    let mut cfg = test_config(&format!("presencia_t_{name}"));
    tweak(&mut cfg);
    recreate_db(&cfg).await;
    let pool = presencia::db::pool(&cfg);
    let secret = presencia::bootstrap::bootstrap(&pool, &cfg).await.expect("bootstrap");
    T { st: AppState::new(pool.clone(), cfg, secret), pool, peer: "127.0.0.1:50000".parse().unwrap() }
}

impl T {
    pub async fn send(&self, req: Request<Body>) -> Res {
        self.send_from(self.peer, req).await
    }

    pub async fn send_from(&self, peer: SocketAddr, req: Request<Body>) -> Res {
        let app = presencia::app(self.st.clone()).layer(MockConnectInfo(peer));
        let res = app.oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, headers, bytes }
    }

    /// JSON request; `cookie` is `name=value` or None.
    pub async fn call(&self, method: &str, path: &str, body: Option<Value>, cookie: Option<&str>) -> Res {
        let mut b = Request::builder().method(method).uri(path);
        if let Some(c) = cookie {
            b = b.header("cookie", c);
        }
        let req = match body {
            Some(v) => b.header("content-type", "application/json").body(Body::from(v.to_string())),
            None => b.body(Body::empty()),
        };
        self.send(req.unwrap()).await
    }

    pub async fn login(&self, email: &str, password: &str) -> String {
        let r = self.call("POST", "/api/auth/login", Some(json!({ "email": email, "password": password })), None).await;
        assert_eq!(r.status, 200, "login {email}: {}", String::from_utf8_lossy(&r.bytes));
        r.cookie().unwrap()
    }

    pub async fn admin(&self) -> String {
        self.login(ADMIN_EMAIL, ADMIN_PASSWORD).await
    }

    /// Company and cadre created through the API; returns (company id, cadre id, cadre cookie).
    pub async fn company_with_cadre(&self, admin: &str, company: &str, email: &str) -> (i64, i64, String) {
        let c = self.call("POST", "/api/companies", Some(json!({ "name": company })), Some(admin)).await;
        assert_eq!(c.status, 201, "{:?}", c.json());
        let cid = c.json()["id"].as_i64().unwrap();
        let u = self
            .call(
                "POST",
                "/api/users",
                Some(json!({ "full_name": format!("Cadre {email}"), "email": email, "password": "cadre-password", "role": "cadre", "company_id": cid.to_string() })),
                Some(admin),
            )
            .await;
        assert_eq!(u.status, 201, "{:?}", u.json());
        let uid = u.json()["id"].as_i64().unwrap();
        let cookie = self.login(email, "cadre-password").await;
        (cid, uid, cookie)
    }
}
