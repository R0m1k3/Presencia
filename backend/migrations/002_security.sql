-- Idempotent: run on every start, after 001_init.sql.

-- Server-side settings, e.g. the generated JWT signing secret.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Sessions issued before this instant are rejected (password change).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
