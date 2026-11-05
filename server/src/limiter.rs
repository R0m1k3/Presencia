//! Login brute-force guard, two counters over a 15-minute window:
//! per (IP, email), guessing one account's password; per IP, all emails
//! together, trying a few passwords on many accounts.

use std::time::{Duration, Instant};

use hashlink::LinkedHashMap;

pub const WINDOW: Duration = Duration::from_secs(15 * 60);
pub const MAX_PER_ACCOUNT: u32 = 10;
pub const MAX_PER_IP: u32 = 50;
/// Bounds memory whatever the attempt volume.
pub const MAX_KEYS: usize = 50_000;

struct Failures {
    count: u32,
    since: Instant,
}

/// Keys in insertion order, like the JS `Map` of the Node version: the first
/// key is the oldest window, evicted when the map is full.
#[derive(Default)]
pub struct Limiter {
    map: LinkedHashMap<String, Failures>,
}

fn keys(ip: &str, email: &str) -> [(String, u32); 2] {
    [
        (format!("a:{ip}:{email}"), MAX_PER_ACCOUNT),
        (format!("i:{ip}"), MAX_PER_IP),
    ]
}

impl Limiter {
    /// The live entry for `key`; an expired one is removed.
    fn live(&mut self, key: &str, now: Instant) -> Option<&mut Failures> {
        if self.map.get(key).is_some_and(|f| f.since + WINDOW <= now) {
            self.map.remove(key);
        }
        self.map.get_mut(key)
    }

    /// Time until a new attempt is allowed, zero if allowed now.
    pub fn locked_for(&mut self, ip: &str, email: &str, now: Instant) -> Duration {
        let mut wait = Duration::ZERO;
        for (key, max) in keys(ip, email) {
            if let Some(f) = self.live(&key, now)
                && f.count >= max
            {
                wait = wait.max(f.since + WINDOW - now);
            }
        }
        wait
    }

    pub fn record_failure(&mut self, ip: &str, email: &str, now: Instant) {
        for (key, _) in keys(ip, email) {
            if let Some(f) = self.live(&key, now) {
                f.count += 1;
                continue;
            }
            if self.map.len() >= MAX_KEYS {
                self.map.pop_front();
            }
            self.map.insert(key, Failures { count: 1, since: now });
        }
    }

    /// After a successful login only the account counter is cleared.
    pub fn clear_account(&mut self, ip: &str, email: &str) {
        self.map.remove(&format!("a:{ip}:{email}"));
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_and_eviction() {
        let mut l = Limiter::default();
        let t0 = Instant::now();
        for _ in 0..10 {
            l.record_failure("1.2.3.4", "a@b.c", t0);
        }
        assert!(l.locked_for("1.2.3.4", "a@b.c", t0) > Duration::from_secs(14 * 60));
        assert_eq!(l.locked_for("1.2.3.5", "a@b.c", t0), Duration::ZERO);
        assert_eq!(l.locked_for("1.2.3.4", "a@b.c", t0 + WINDOW), Duration::ZERO);
        for i in 0..MAX_KEYS {
            l.record_failure(&format!("ip{i}"), "x", t0);
        }
        assert!(l.len() <= MAX_KEYS);
    }
}
