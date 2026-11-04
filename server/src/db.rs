use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};

use crate::config::Config;

/// Lazy pool: connections are opened on first use, so startup can wait for
/// the database the same way the Node version did.
pub fn pool(cfg: &Config) -> PgPool {
    let opts = PgConnectOptions::new()
        .host(&cfg.pg_host)
        .port(cfg.pg_port)
        .username(&cfg.pg_user)
        .password(&cfg.pg_password)
        .database(&cfg.pg_database)
        // Timestamps read through row_to_json are formatted in the session
        // time zone; production runs postgres:16-alpine, which is UTC.
        .options([("TimeZone", "UTC")]);
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect_lazy_with(opts)
}
