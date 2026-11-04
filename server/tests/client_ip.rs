mod common;

use std::net::SocketAddr;

use axum::{body::Body, http::Request};
use common::*;
use presencia::client_ip::client_ip;
use serde_json::json;

fn peer(s: &str) -> SocketAddr {
    s.parse().unwrap()
}

#[test]
fn proxy_addr_rules() {
    // Direct client: X-Forwarded-For is ignored.
    assert_eq!(
        client_ip(&peer("203.0.113.9:1"), Some("10.0.0.1")),
        "::ffff:203.0.113.9"
    );
    // Public client behind the proxies.
    assert_eq!(
        client_ip(&peer("172.18.0.3:1"), Some("198.51.100.7, 172.18.0.1")),
        "198.51.100.7"
    );
    // A spoofed left-most hop does not win over the first untrusted one.
    assert_eq!(
        client_ip(&peer("172.18.0.3:1"), Some("1.1.1.1, 198.51.100.7")),
        "198.51.100.7"
    );
    // LAN client behind the proxy keeps its own address.
    assert_eq!(client_ip(&peer("172.18.0.3:1"), Some("192.168.1.20")), "192.168.1.20");
    assert_eq!(client_ip(&peer("[::ffff:172.18.0.3]:1"), None), "::ffff:172.18.0.3");
}

async fn fail_login(t: &T, from: &str, xff: Option<&str>) -> u16 {
    let mut b = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json");
    if let Some(x) = xff {
        b = b.header("x-forwarded-for", x);
    }
    let s = json!({ "email": ADMIN_EMAIL, "password": "bad" }).to_string();
    let req = b.header("content-length", s.len()).body(Body::from(s)).unwrap();
    t.send_from(peer(from), req).await.status.as_u16()
}

#[tokio::test]
async fn limiter_uses_client_ip() {
    let t = setup("clientip").await;
    for _ in 0..10 {
        assert_eq!(fail_login(&t, "172.18.0.3:1", Some("198.51.100.7")).await, 401);
    }
    assert_eq!(fail_login(&t, "172.18.0.3:1", Some("198.51.100.7")).await, 429);
    // Same proxy, other client: allowed.
    assert_eq!(fail_login(&t, "172.18.0.3:1", Some("198.51.100.8")).await, 401);
    // A direct client cannot borrow the blocked address through the header.
    assert_eq!(fail_login(&t, "198.51.100.9:1", Some("198.51.100.8")).await, 401);
}
