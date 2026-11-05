// API responses, as server/src/routes/*.rs build them.

import type { Entry } from './logic/grid.ts';

export type Role = 'admin' | 'cadre';

/** /api/auth/login and /api/auth/me */
export type Me = {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  companyId: number | null;
  companyName: string | null;
};

/** GET /api/companies */
export type Company = { id: number; name: string; created_at: string; active_cadre_count: string };

/** GET /api/users */
export type UserRow = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  company_id: number | null;
  company_name: string | null;
  active: boolean;
  created_at: string;
};

/** GET /api/attendance */
export type Planning = {
  userId: number;
  entries: Entry[];
  cadreValidated: boolean;
  cadreValidatedAt: string | null;
  companyValidated: boolean;
  companyValidatedAt: string | null;
  editable: boolean;
};

/** GET /api/attendance/history */
export type HistoryRow = {
  year: number;
  month: number;
  present: number;
  absent: number;
  conge: number;
  rtt: number;
  cadreValidated: boolean;
  companyValidated: boolean;
};

/** GET /api/validations/overview */
export type Overview = {
  companies: { id: number; name: string; activeCadres: number; validatedCadres: number; companyValidated: boolean }[];
  totalActiveCadres: number;
  lateCadres: number;
  pendingCompanies: number;
};

/** GET /api/validations/company/:id */
export type CompanyMonth = {
  cadres: {
    id: number;
    fullName: string;
    email: string;
    filled: number;
    cadreValidated: boolean;
    cadreValidatedAt: string | null;
  }[];
  allCadresValidated: boolean;
  companyValidated: boolean;
  companyValidatedAt: string | null;
};
