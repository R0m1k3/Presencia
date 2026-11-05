//! Request pipeline, in the order Express ran it: JSON body, CORS, then the
//! routes. Path matching follows Express 4: case-insensitive, one optional
//! trailing slash, and a mount point that swallows one extra slash.

mod attendance;
mod auth;
mod companies;
mod export;
mod users;
mod validations;

use std::net::SocketAddr;

use axum::{
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::{AuthError, User, clear_cookie},
    error::{ApiError, ApiResult, json_response},
    validate::is_id_str,
};

/// What a handler sees of the request.
pub struct Ctx {
    pub st: AppState,
    pub method: Method,
    pub headers: HeaderMap,
    pub query: Value,
    pub body: Value,
    pub peer: SocketAddr,
    /// The `:id` / `:companyId` path parameter, already checked.
    pub id: i32,
    user: Option<User>,
}

impl Ctx {
    /// The signed-in user (routes behind `requireAuth` only).
    pub fn user(&self) -> &User {
        self.user.as_ref().expect("route behind requireAuth")
    }

    pub fn q(&self, key: &str) -> Option<&Value> {
        crate::validate::field(&self.query, key)
    }

    pub fn b(&self, key: &str) -> Option<&Value> {
        crate::validate::field(&self.body, key)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum M {
    Get,
    Post,
    Put,
    Delete,
}

impl M {
    fn handles(self, m: &Method) -> bool {
        match self {
            M::Get => m == Method::GET || m == Method::HEAD,
            M::Post => m == Method::POST,
            M::Put => m == Method::PUT,
            M::Delete => m == Method::DELETE,
        }
    }

    /// `route._options()`.
    fn names(self) -> &'static [&'static str] {
        match self {
            M::Get => &["GET", "HEAD"],
            M::Post => &["POST"],
            M::Put => &["PUT"],
            M::Delete => &["DELETE"],
        }
    }
}

#[derive(Clone, Copy)]
enum Seg {
    Lit(&'static str),
    Id,
}

#[derive(Clone, Copy)]
enum R {
    Login,
    Logout,
    Me,
    Password,
    CompanyList,
    CompanyCreate,
    CompanyUpdate,
    CompanyDelete,
    UserList,
    UserCreate,
    UserUpdate,
    UserPassword,
    UserDelete,
    AttGet,
    AttPut,
    AttHistory,
    AttDeleteMonth,
    AttBulk,
    AttBulkDelete,
    AttDelete,
    ValCadre,
    ValCadreReopen,
    ValCompany,
    ValOverview,
    ValCompanyValidate,
    ValCompanyReopen,
    ExportExcel,
    ExportPdf,
}

struct Route {
    m: M,
    segs: &'static [Seg],
    /// Route-level `requireAdmin`, run after the path parameter check.
    admin: bool,
    r: R,
}

#[derive(PartialEq)]
enum Guard {
    None,
    Auth,
    Admin,
}

struct Mount {
    prefix: &'static str,
    guard: Guard,
    routes: &'static [Route],
}

const fn rt(m: M, segs: &'static [Seg], r: R) -> Route {
    Route {
        m,
        segs,
        admin: false,
        r,
    }
}

const fn admin(m: M, segs: &'static [Seg], r: R) -> Route {
    Route {
        m,
        segs,
        admin: true,
        r,
    }
}

use Seg::{Id, Lit};

static MOUNTS: &[Mount] = &[
    Mount {
        prefix: "/api/auth",
        guard: Guard::None,
        routes: &[
            rt(M::Post, &[Lit("login")], R::Login),
            rt(M::Post, &[Lit("logout")], R::Logout),
            rt(M::Get, &[Lit("me")], R::Me),
            rt(M::Put, &[Lit("password")], R::Password),
        ],
    },
    Mount {
        prefix: "/api/companies",
        guard: Guard::Admin,
        routes: &[
            rt(M::Get, &[], R::CompanyList),
            rt(M::Post, &[], R::CompanyCreate),
            rt(M::Put, &[Id], R::CompanyUpdate),
            rt(M::Delete, &[Id], R::CompanyDelete),
        ],
    },
    Mount {
        prefix: "/api/users",
        guard: Guard::Admin,
        routes: &[
            rt(M::Get, &[], R::UserList),
            rt(M::Post, &[], R::UserCreate),
            rt(M::Put, &[Id], R::UserUpdate),
            rt(M::Put, &[Id, Lit("password")], R::UserPassword),
            rt(M::Delete, &[Id], R::UserDelete),
        ],
    },
    Mount {
        prefix: "/api/attendance",
        guard: Guard::Auth,
        routes: &[
            rt(M::Get, &[], R::AttGet),
            rt(M::Put, &[], R::AttPut),
            rt(M::Get, &[Lit("history")], R::AttHistory),
            rt(M::Delete, &[Lit("month")], R::AttDeleteMonth),
            rt(M::Put, &[Lit("bulk")], R::AttBulk),
            rt(M::Delete, &[Lit("bulk")], R::AttBulkDelete),
            rt(M::Delete, &[], R::AttDelete),
        ],
    },
    Mount {
        prefix: "/api/validations",
        guard: Guard::Auth,
        routes: &[
            rt(M::Post, &[Lit("cadre")], R::ValCadre),
            admin(M::Post, &[Lit("cadre"), Lit("reopen")], R::ValCadreReopen),
            admin(M::Get, &[Lit("company"), Id], R::ValCompany),
            admin(M::Get, &[Lit("overview")], R::ValOverview),
            admin(M::Post, &[Lit("company"), Id], R::ValCompanyValidate),
            admin(M::Post, &[Lit("company"), Id, Lit("reopen")], R::ValCompanyReopen),
        ],
    },
    Mount {
        prefix: "/api/export",
        guard: Guard::Admin,
        routes: &[
            rt(M::Get, &[Lit("excel"), Id], R::ExportExcel),
            rt(M::Get, &[Lit("pdf"), Id], R::ExportPdf),
        ],
    },
];

fn starts_with_ci(path: &str, prefix: &str) -> bool {
    path.len() >= prefix.len() && path.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// `app.use(prefix, router)`: regex `^prefix\/?(?=\/|$)`, case-insensitive.
/// Returns the path seen by the router (always starting with `/`).
pub(crate) fn strip_mount<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if !starts_with_ci(path, prefix) {
        return None;
    }
    let rest = &path[prefix.len()..];
    if rest.is_empty() || rest == "/" {
        Some("/")
    } else if rest.starts_with("//") {
        Some(&rest[1..])
    } else if rest.starts_with('/') {
        Some(rest)
    } else {
        None
    }
}

/// Segments of a router path for matching `^/s1/.../sn/?$`.
fn segments(inner: &str) -> Vec<&str> {
    if inner == "/" {
        return Vec::new();
    }
    let p = &inner[1..];
    p.strip_suffix('/').unwrap_or(p).split('/').collect()
}

/// The raw `:id` segment when the path matches the route pattern.
fn matches<'a>(segs: &[Seg], path: &[&'a str]) -> Option<Option<&'a str>> {
    if segs.len() != path.len() {
        return None;
    }
    let mut param = None;
    for (s, p) in segs.iter().zip(path) {
        match s {
            Lit(l) if p.eq_ignore_ascii_case(l) => {}
            Id if !p.is_empty() => param = Some(*p),
            _ => return None,
        }
    }
    Some(param)
}

pub(crate) fn auth_error(e: AuthError) -> Response {
    match e {
        AuthError::Missing => ApiError::new(401, "Non authentifié").into_response(),
        AuthError::Invalid => {
            let mut res = ApiError::new(401, "Session invalide ou expirée").into_response();
            res.headers_mut().append(header::SET_COOKIE, clear_cookie());
            res
        }
        AuthError::Db(e) => e.into_response(),
    }
}

fn forbidden_admin() -> Response {
    ApiError::new(403, "Accès réservé aux administrateurs").into_response()
}

/// `cors({ origin, credentials: true })` headers for a non-preflight request.
fn cors_headers(origin: &str, h: &mut HeaderMap) {
    if let Ok(o) = HeaderValue::from_str(origin) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
    }
    h.append(header::VARY, HeaderValue::from_static("Origin"));
    h.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
}

fn cors_preflight(origin: &str, req_headers: &HeaderMap) -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    let h = res.headers_mut();
    cors_headers(origin, h);
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET,HEAD,PUT,PATCH,POST,DELETE"),
    );
    if let Some(v) = req_headers.get(header::ACCESS_CONTROL_REQUEST_HEADERS) {
        h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, v.clone());
        h.append(header::VARY, HeaderValue::from_static("Access-Control-Request-Headers"));
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
    res
}

/// Express' automatic answer to OPTIONS for a path with routes.
fn options_response(methods: &[&str]) -> Response {
    let allow = methods.join(",");
    let mut res = (StatusCode::OK, allow.clone()).into_response();
    let h = res.headers_mut();
    h.insert(header::ALLOW, HeaderValue::from_str(&allow).unwrap());
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    res
}

fn route_unknown() -> Response {
    json_response(StatusCode::NOT_FOUND, &json!({ "error": "Route inconnue" }))
}

/// Express' final handler, for paths outside `/api`.
fn cannot(method: &Method, path: &str) -> Response {
    let path = path
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;");
    let body = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot {method} {path}</pre>\n</body>\n</html>\n"
    );
    let mut res = (StatusCode::NOT_FOUND, body).into_response();
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    h.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'"),
    );
    res
}

/// `decodeURIComponent`, `None` on a malformed sequence.
fn decode_param(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    for (i, c) in b.iter().enumerate() {
        if *c == b'%'
            && !(b.get(i + 1).is_some_and(u8::is_ascii_hexdigit) && b.get(i + 2).is_some_and(u8::is_ascii_hexdigit))
        {
            return None;
        }
    }
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

/// `qs`-like query parsing: repeated keys and `k[]` give arrays, `k[x]` objects.
pub fn parse_query(q: Option<&str>) -> Value {
    let mut out = Map::new();
    let decode = |s: &str| {
        let s = s.replace('+', " ");
        percent_encoding::percent_decode_str(&s)
            .decode_utf8_lossy()
            .into_owned()
    };
    for pair in q.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let (k, v) = (decode(k), Value::String(decode(v)));
        let bracket = k.find('[').filter(|&i| i > 0 && k.ends_with(']'));
        if let Some(i) = bracket {
            let (base, sub) = (k[..i].to_string(), k[i + 1..k.len() - 1].to_string());
            let is_index = sub.is_empty()
                || (sub.len() <= 2
                    && sub.bytes().all(|c| c.is_ascii_digit())
                    && sub.parse::<u32>().is_ok_and(|n| n <= 20));
            match out.get_mut(&base) {
                Some(Value::Array(a)) if is_index => a.push(v),
                Some(Value::Object(o)) => {
                    o.insert(if is_index { o.len().to_string() } else { sub }, v);
                }
                Some(existing) => {
                    let prev = existing.take();
                    *existing = Value::Array(vec![prev, v]);
                }
                None if is_index => {
                    out.insert(base, Value::Array(vec![v]));
                }
                None => {
                    out.insert(base, json!({ sub: v }));
                }
            }
        } else {
            match out.get_mut(&k) {
                Some(Value::Array(a)) => a.push(v),
                Some(existing) => {
                    let prev = existing.take();
                    *existing = Value::Array(vec![prev, v]);
                }
                None => {
                    out.insert(k, v);
                }
            }
        }
    }
    Value::Object(out)
}

pub async fn dispatch(st: &AppState, peer: SocketAddr, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_string();

    let body = match crate::body::read_json(&parts.headers, body).await {
        Ok(b) => b,
        Err(e) => return e.into_response(),
    };

    let cors = st.cfg.cors_origin.clone();
    if let Some(origin) = &cors
        && method == Method::OPTIONS
    {
        return cors_preflight(origin, &parts.headers);
    }

    let mut ctx = Ctx {
        st: st.clone(),
        method,
        headers: parts.headers,
        query: parse_query(parts.uri.query()),
        body,
        peer,
        id: 0,
        user: None,
    };
    let mut res = route(&mut ctx, &path).await;
    if let Some(origin) = &cors {
        cors_headers(origin, res.headers_mut());
    }
    res
}

async fn route(c: &mut Ctx, path: &str) -> Response {
    let is_health = path.eq_ignore_ascii_case("/api/health") || path.eq_ignore_ascii_case("/api/health/");
    if is_health && M::Get.handles(&c.method) {
        return json_response(StatusCode::OK, &json!({ "ok": true }));
    }

    for mount in MOUNTS {
        let Some(inner) = strip_mount(path, mount.prefix) else {
            continue;
        };
        if mount.guard != Guard::None {
            match crate::auth::authenticate(&c.st, &c.headers).await {
                Ok(u) => c.user = Some(u),
                Err(e) => return auth_error(e),
            }
            if mount.guard == Guard::Admin && !c.user().is_admin() {
                return forbidden_admin();
            }
        }
        let segs = segments(inner);
        let mut options: Vec<&str> = Vec::new();
        for r in mount.routes {
            let Some(param) = matches(r.segs, &segs) else { continue };
            if c.method == Method::OPTIONS {
                for m in r.m.names() {
                    if !options.contains(m) {
                        options.push(m);
                    }
                }
                continue;
            }
            if !r.m.handles(&c.method) {
                continue;
            }
            if let Some(raw) = param {
                match decode_param(raw) {
                    // Express answers 400 « Failed to decode param », which its error handler turns into a 500.
                    None => return ApiError::Internal(format!("Failed to decode param '{raw}'")).into_response(),
                    Some(id) if is_id_str(&id) => c.id = id.parse().unwrap(),
                    Some(_) => return ApiError::new(400, "Identifiant invalide").into_response(),
                }
            }
            if r.admin && !c.user().is_admin() {
                return forbidden_admin();
            }
            return run(r.r, c).await.unwrap_or_else(IntoResponse::into_response);
        }
        if !options.is_empty() {
            return options_response(&options);
        }
        break;
    }

    if strip_mount(path, "/api").is_some() {
        route_unknown()
    } else {
        cannot(&c.method, path)
    }
}

async fn run(r: R, c: &Ctx) -> ApiResult {
    match r {
        R::Login => auth::login(c).await,
        R::Logout => auth::logout(c).await,
        R::Me => auth::me(c).await,
        R::Password => auth::password(c).await,
        R::CompanyList => companies::list(c).await,
        R::CompanyCreate => companies::create(c).await,
        R::CompanyUpdate => companies::update(c).await,
        R::CompanyDelete => companies::delete(c).await,
        R::UserList => users::list(c).await,
        R::UserCreate => users::create(c).await,
        R::UserUpdate => users::update(c).await,
        R::UserPassword => users::password(c).await,
        R::UserDelete => users::delete(c).await,
        R::AttGet => attendance::get(c).await,
        R::AttPut => attendance::put(c).await,
        R::AttHistory => attendance::history(c).await,
        R::AttDeleteMonth => attendance::delete_month(c).await,
        R::AttBulk => attendance::bulk(c).await,
        R::AttBulkDelete => attendance::bulk_delete(c).await,
        R::AttDelete => attendance::delete(c).await,
        R::ValCadre => validations::cadre(c).await,
        R::ValCadreReopen => validations::cadre_reopen(c).await,
        R::ValCompany => validations::company(c).await,
        R::ValOverview => validations::overview(c).await,
        R::ValCompanyValidate => validations::company_validate(c).await,
        R::ValCompanyReopen => validations::company_reopen(c).await,
        R::ExportExcel => export::excel(c).await,
        R::ExportPdf => export::pdf(c).await,
    }
}

/// Session handlers need to add `Set-Cookie` to a JSON response.
pub fn with_cookie(mut res: Response, cookie: HeaderValue) -> Response {
    res.headers_mut().append(header::SET_COOKIE, cookie);
    res
}

/// Timestamps that `pg` returned as JS `Date`s, serialized by `JSON.stringify`.
pub fn js_date(t: chrono::DateTime<chrono::Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn js_date_opt(t: Option<chrono::DateTime<chrono::Utc>>) -> Value {
    t.map(|t| Value::String(js_date(t))).unwrap_or(Value::Null)
}
