//! Client address as Express computes `req.ip` with
//! `trust proxy = 'loopback, linklocal, uniquelocal'` (package `proxy-addr`).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

fn trusted_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 127                               // loopback 127.0.0.0/8
        || (a == 169 && b == 254)          // linklocal 169.254.0.0/16
        || a == 10                         // uniquelocal 10.0.0.0/8
        || (a == 172 && (16..=31).contains(&b)) // 172.16.0.0/12
        || (a == 192 && b == 168) // 192.168.0.0/16
}

fn trusted_v6(ip: Ipv6Addr) -> bool {
    let s0 = ip.segments()[0];
    ip == Ipv6Addr::LOCALHOST              // ::1
        || (s0 & 0xffc0) == 0xfe80         // fe80::/10
        || (s0 & 0xfe00) == 0xfc00 // fc00::/7
}

/// `ipaddr.js` accepts the same textual forms closely enough for our use;
/// anything that does not parse is untrusted, like in `proxy-addr`.
fn trusted(addr: &str) -> bool {
    let addr = addr.split('%').next().unwrap_or(addr);
    match addr.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => trusted_v4(v4),
        Ok(IpAddr::V6(v6)) => match v6.to_ipv4_mapped() {
            // IPv4-mapped addresses are checked against the IPv4 ranges.
            Some(v4) => trusted_v4(v4) || trusted_v6(v6),
            None => trusted_v6(v6),
        },
        Err(_) => false,
    }
}

/// Textual peer address as Node reports `socket.remoteAddress`.
pub fn peer_string(peer: &SocketAddr) -> String {
    match peer.ip() {
        IpAddr::V4(v4) => format!("::ffff:{v4}"),
        IpAddr::V6(v6) => v6.to_string(),
    }
}

/// The peer, then the `X-Forwarded-For` hops from right to left; the first
/// untrusted address wins, or the left-most hop when every one is trusted.
pub fn client_ip(peer: &SocketAddr, forwarded_for: Option<&str>) -> String {
    let mut addrs = vec![peer_string(peer)];
    if let Some(h) = forwarded_for {
        addrs.extend(h.split(',').rev().map(|s| s.trim_matches(' ').to_string()));
    }
    let last = addrs.len() - 1;
    for (i, a) in addrs.iter().enumerate() {
        if i == last || !trusted(a) {
            return a.clone();
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapped_and_ranges() {
        assert!(trusted("::ffff:10.1.2.3") && trusted("172.31.0.1") && trusted("fd00::1") && trusted("fe80::1%eth0"));
        assert!(!trusted("172.32.0.1") && !trusted("8.8.8.8") && !trusted("garbage") && !trusted(""));
    }
}
