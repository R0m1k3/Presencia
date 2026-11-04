-- Presencia schema

CREATE TYPE user_role AS ENUM ('admin', 'cadre');
CREATE TYPE half_day_period AS ENUM ('AM', 'PM');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'conge', 'rtt');

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'cadre',
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_company ON users(company_id);

CREATE TABLE attendance_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  period half_day_period NOT NULL,
  status attendance_status NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, entry_date, period)
);

CREATE INDEX idx_attendance_user_date ON attendance_entries(user_id, entry_date);

-- Cadre self-validation of a given month (locks that month's entries for the cadre)
CREATE TABLE month_locks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  cadre_validated BOOLEAN NOT NULL DEFAULT false,
  cadre_validated_at TIMESTAMPTZ,
  UNIQUE(user_id, year, month)
);

-- Admin validation of a whole company for a given month (requires all cadres validated first)
CREATE TABLE company_month_validations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  admin_validated BOOLEAN NOT NULL DEFAULT false,
  admin_validated_at TIMESTAMPTZ,
  admin_validated_by INTEGER REFERENCES users(id),
  UNIQUE(company_id, year, month)
);
