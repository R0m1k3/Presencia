//! Startup, as `bootstrap.js`: wait for the database, create or update the
//! schema, load the JWT secret, create the first admin.

use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use sqlx::PgPool;

use crate::{auth::KNOWN_PLACEHOLDERS, config::Config};

const INIT_SQL: &str = include_str!("../migrations/001_init.sql");
const SECURITY_SQL: &str = include_str!("../migrations/002_security.sql");

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

fn random_b64(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

async fn wait_for_db(pool: &PgPool, retries: u32, delay: Duration) -> Result<(), BoxError> {
    let mut last = None;
    for i in 0..retries {
        match sqlx::query("SELECT 1").execute(pool).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                println!("En attente de la base de données... ({}/{retries}) — {e}", i + 1);
                last = Some(e);
                tokio::time::sleep(delay).await;
            }
        }
    }
    let reason = last.map(|e| e.to_string()).unwrap_or_else(|| "raison inconnue".into());
    Err(format!("Impossible de se connecter à la base de données : {reason}").into())
}

/// Not a migrator: 001 builds an empty database, 002 is idempotent and runs
/// at every start. A new file has to be added here by hand.
async fn run_migrations(pool: &PgPool) -> Result<(), BoxError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'companies')")
            .fetch_one(pool)
            .await?;
    if exists {
        println!("Schéma déjà initialisé.");
    } else {
        println!("Initialisation du schéma de base de données...");
        sqlx::raw_sql(INIT_SQL).execute(pool).await?;
        println!("Schéma créé.");
    }
    // Idempotent, so safe on every start: brings existing databases up to date.
    sqlx::raw_sql(SECURITY_SQL).execute(pool).await?;
    Ok(())
}

/// `JWT_SECRET` when it is a real secret; otherwise one generated once and
/// kept in the database so sessions survive restarts.
async fn jwt_secret(pool: &PgPool, cfg: &Config) -> Result<String, BoxError> {
    if let Some(s) = &cfg.jwt_secret {
        if s.encode_utf16().count() >= 32 && !KNOWN_PLACEHOLDERS.contains(&s.as_str()) {
            return Ok(s.clone());
        }
        eprintln!("JWT_SECRET ignoré (trop court ou valeur d’exemple) : un secret aléatoire est utilisé à la place.");
    }
    sqlx::query("INSERT INTO app_settings (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING")
        .bind(random_b64(48))
        .execute(pool)
        .await?;
    Ok(
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'jwt_secret'")
            .fetch_one(pool)
            .await?,
    )
}

/// ADMIN_EMAIL / ADMIN_PASSWORD only matter on the very first start. Without
/// ADMIN_PASSWORD a random password is generated and printed once.
async fn seed_admin(pool: &PgPool, cfg: &Config) -> Result<(), BoxError> {
    let existing: Option<i32> = sqlx::query_scalar("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        .fetch_optional(pool)
        .await?;
    if existing.is_some() {
        if cfg.admin_password.is_some() {
            eprintln!(
                "ADMIN_PASSWORD ignoré : un compte administrateur existe déjà. \
                 Vous pouvez retirer ADMIN_EMAIL / ADMIN_PASSWORD du fichier .env."
            );
        }
        return Ok(());
    }
    let generated = cfg.admin_password.is_none();
    let password = cfg.admin_password.clone().unwrap_or_else(|| random_b64(18));
    let hash = crate::auth::hash_password(password.clone())
        .await
        .map_err(|e| format!("{e:?}"))?;
    sqlx::query(
        "INSERT INTO users (full_name, email, password_hash, role, company_id, active)
         VALUES ($1, $2, $3, 'admin', NULL, true)",
    )
    .bind(&cfg.admin_name)
    .bind(&cfg.admin_email)
    .bind(hash)
    .execute(pool)
    .await?;
    println!("========================================================");
    println!(" Compte administrateur créé :");
    println!(" Email    : {}", cfg.admin_email);
    if generated {
        println!(" Mot de passe (généré, affiché une seule fois) : {password}");
    } else {
        println!(" Mot de passe : celui de ADMIN_PASSWORD");
    }
    println!(" Merci de le changer après la première connexion.");
    println!("========================================================");
    Ok(())
}

/// Returns the JWT secret.
pub async fn bootstrap(pool: &PgPool, cfg: &Config) -> Result<String, BoxError> {
    bootstrap_with(pool, cfg, 30, Duration::from_secs(2)).await
}

pub async fn bootstrap_with(pool: &PgPool, cfg: &Config, retries: u32, delay: Duration) -> Result<String, BoxError> {
    wait_for_db(pool, retries, delay).await?;
    run_migrations(pool).await?;
    let secret = jwt_secret(pool, cfg).await?;
    seed_admin(pool, cfg).await?;
    Ok(secret)
}
