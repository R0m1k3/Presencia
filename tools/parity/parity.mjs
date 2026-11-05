#!/usr/bin/env node
// Plays the same HTTP scenario against the Node API (reference) and the Rust
// API, each on a freshly recreated database, and reports every difference.
// See README.md next to this file.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args['node-dir'] || !args['rust-bin']) {
  console.error('Usage: node parity.mjs --node-dir <backend/ of f760cf6> --rust-bin <presencia binary>');
  process.exit(2);
}
const PG = {
  PGHOST: process.env.PGHOST || '127.0.0.1',
  PGPORT: process.env.PGPORT || '55432',
  PGUSER: process.env.PGUSER || 'presencia',
  PGPASSWORD: process.env.PGPASSWORD || 'presencia',
};
const DB = 'presencia_parity';
const ADMIN = { email: 'admin@parity.fr', password: 'admin-password' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function psql(sql) {
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qd', 'postgres', '-c', sql], { env: { ...process.env, ...PG }, stdio: 'pipe' });
}

async function startServer(name, cmd, cmdArgs, cwd, port) {
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  psql(`CREATE DATABASE ${DB}`);
  const env = {
    PATH: process.env.PATH,
    ...PG,
    PGDATABASE: DB,
    PORT: String(port),
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    COOKIE_SECURE: 'false',
  };
  const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { child, log: () => log };
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error(`${name} did not start:\n${log}`);
}

// --- scenario --------------------------------------------------------------

function scenario() {
  const steps = [];
  const s = (role, method, url, body, opts = {}) => steps.push({ role, method, url, body, ...opts });
  const j = (body) => JSON.stringify(body);

  // Pipeline, routing, body parsing.
  s(null, 'GET', '/api/health');
  s(null, 'HEAD', '/api/health');
  s(null, 'GET', '/API/Health/');
  s(null, 'GET', '/api/nope');
  s(null, 'GET', '/nope');
  s(null, 'GET', '/api/auth/login');
  s(null, 'OPTIONS', '/api/auth/login');
  s(null, 'OPTIONS', '/api/health');
  s(null, 'OPTIONS', '/api/auth/me');
  s(null, 'POST', '/api/companies', '{', { raw: true });
  s(null, 'POST', '/api/auth/login', '"x"', { raw: true });
  s(null, 'POST', '/api/auth/login', '{}', { raw: true, ct: 'application/json; charset=latin1' });
  s(null, 'POST', '/api/auth/login', '{"email":1}', { raw: true, ct: 'text/plain' });
  s(null, 'POST', '/api/auth/login', j({ a: 'x'.repeat(110000) }), { raw: true });
  s(null, 'GET', '/api/companies');
  s(null, 'GET', '/api/attendance/nope');
  s(null, 'GET', '/api/auth/me');
  s(null, 'GET', '/api/auth/me', null, { cookie: 'presencia_token=abc' });

  // Session.
  s(null, 'POST', '/api/auth/login', j({ email: ADMIN.email, password: 'wrong' }));
  s(null, 'POST', '/api/auth/login', j({ email: 'x' }));
  s('admin', 'POST', '/api/auth/login', j({ email: `  ${ADMIN.email.toUpperCase()} `, password: ADMIN.password }));
  s('admin', 'GET', '/api/auth/me');

  // Companies.
  s('admin', 'POST', '/api/companies', j({ name: '  Société — Nord ' }));
  s('admin', 'POST', '/api/companies', j({ name: 'Acme' }));
  s('admin', 'POST', '/api/companies', j({ name: 'Acme' }));
  s('admin', 'POST', '/api/companies', j({ name: '   ' }));
  s('admin', 'POST', '/api/companies', j({ name: 'x'.repeat(256) }));
  s('admin', 'PUT', '/api/companies/2', j({ name: 'Acme SA' }));
  s('admin', 'PUT', '/api/companies/2/', j({ name: 'Société — Nord' }));
  s('admin', 'PUT', '/api/companies/abc', j({ name: 'X' }));
  s('admin', 'PUT', '/api/companies/07', j({ name: 'X' }));
  s('admin', 'PUT', '/api/companies/999', j({ name: 'X' }));
  s('admin', 'PATCH', '/api/companies/1');
  s('admin', 'GET', '/api/companies//');
  s('admin', 'POST', '/api/companies', j({ name: 'Vide' }));
  s('admin', 'DELETE', '/api/companies/3');
  s('admin', 'DELETE', '/api/companies/3');
  s('admin', 'OPTIONS', '/api/attendance/');

  // Users (ids sent as strings, like the front end).
  const cadre = (n, extra = {}) => ({ full_name: ` Cadre ${n} `, email: ` Cadre${n}@Acme.FR `, password: 'cadre-password', role: 'cadre', company_id: '1', ...extra });
  s('admin', 'POST', '/api/users', j(cadre('Alice')));
  s('admin', 'POST', '/api/users', j(cadre('Bruno', { company_id: 1 })));
  s('admin', 'POST', '/api/users', j(cadre('Zoé', { company_id: '2' })));
  s('admin', 'POST', '/api/users', j(cadre('Dup', { email: 'cadrealice@acme.fr' })));
  s('admin', 'POST', '/api/users', j(cadre('X', { company_id: 999 })));
  s('admin', 'POST', '/api/users', j(cadre('X', { company_id: [1] })));
  s('admin', 'POST', '/api/users', j(cadre('X', { company_id: 1.5 })));
  s('admin', 'POST', '/api/users', j(cadre('X', { password: 'short' })));
  s('admin', 'POST', '/api/users', j(cadre('X', { password: 'é'.repeat(37) })));
  s('admin', 'POST', '/api/users', j(cadre('X', { email: 'a@b' })));
  s('admin', 'POST', '/api/users', j(cadre('X', { role: 'boss' })));
  s('admin', 'POST', '/api/users', j({ email: 'x@y.z', role: 'cadre' }));
  s('admin', 'POST', '/api/users', j({ full_name: 'Admin Deux', email: 'a2@parity.fr', password: 'password1', role: 'admin', company_id: 'zzz' }));
  s('admin', 'GET', '/api/users');
  s('admin', 'GET', '/api/users?company_id=1');
  s('admin', 'GET', '/api/users?company_id=');
  s('admin', 'GET', '/api/users?company_id=abc');
  s('admin', 'GET', '/api/users?company_id=1&company_id=2');
  s('admin', 'PUT', '/api/users/1', j({ full_name: 'A', email: ADMIN.email, role: 'admin', active: false }));
  s('admin', 'PUT', '/api/users/1', j({ full_name: 'A', email: ADMIN.email, role: 'cadre', company_id: 1 }));
  s('admin', 'DELETE', '/api/users/1');
  s('admin', 'PUT', '/api/users/3', j({ full_name: 'Bruno B', email: 'cadrebruno@acme.fr', role: 'cadre', company_id: '1', active: 0 }));
  s('admin', 'PUT', '/api/users/999', j({ full_name: 'X', email: 'x@x.fr', role: 'admin' }));
  s('admin', 'PUT', '/api/users/999/password', j({ password: 'password1' }));

  // Cadre session and planning.
  s('alice', 'POST', '/api/auth/login', j({ email: 'cadrealice@acme.fr', password: 'cadre-password' }));
  s('bruno', 'POST', '/api/auth/login', j({ email: 'cadrebruno@acme.fr', password: 'cadre-password' }));
  s('alice', 'GET', '/api/auth/me');
  s('alice', 'GET', '/api/users');
  s('alice', 'PUT', '/api/companies/abc');
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-02', period: 'AM', status: 'present' }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-02', period: 'AM', status: 'rtt' }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-30', period: 'AM', status: 'present' }));
  s('alice', 'PUT', '/api/attendance', j({ date: '0000-01-01', period: 'AM', status: 'present' }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-02', period: 'am', status: 'present' }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-02', period: 'PM', status: 'present', user_id: 3 }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-02', period: 'PM', status: 'absent', user_id: '' }));
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-03', period: 'AM', status: 'conge', user_id: '2' }));
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-03', period: 'AM', status: 'conge', user_id: 'abc' }));
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-03', period: 'AM', status: 'conge', user_id: ['2'] }));
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-03', period: 'AM', status: 'conge', user_id: 999 }));
  const bulk = [
    { date: '2026-02-04', period: 'AM', status: 'present' },
    { date: '2026-02-04', period: 'AM', status: 'absent' },
    { date: '2026-02-04', period: 'PM', status: 'present' },
    { date: '2026-02-27', period: 'PM', status: 'rtt' },
    { date: '2026-03-02', period: 'AM', status: 'present' },
  ];
  s('alice', 'PUT', '/api/attendance/bulk', j({ entries: bulk }));
  s('bruno', 'PUT', '/api/attendance/bulk', j({ entries: [{ date: '2026-02-05', period: 'AM', status: 'present' }] }));
  s('alice', 'PUT', '/api/attendance/bulk', j({ entries: [] }));
  s('alice', 'PUT', '/api/attendance/bulk', j({ entries: [null] }));
  s('alice', 'DELETE', '/api/attendance', j({ date: '2026-03-02', period: 'AM' }));
  s('alice', 'GET', '/api/attendance?year=2026&month=2');
  s('alice', 'GET', '/api/attendance?year=2026.9&month=2x');
  s('alice', 'GET', '/api/attendance?year[]=2026&month=2');
  s('alice', 'GET', '/api/attendance?year=1999&month=2');
  s('alice', 'GET', '/api/attendance?year=2026');
  s('admin', 'GET', '/api/attendance?year=2026&month=2&user_id=2');
  s('admin', 'GET', '/api/attendance?year=2026&month=2&user_id[]=2');
  s('alice', 'GET', '/api/attendance/history');
  s('admin', 'GET', '/api/attendance/history?user_id=2');

  // Validations.
  s('alice', 'POST', '/api/validations/cadre', j({}));
  s('alice', 'POST', '/api/validations/cadre', j({ year: 2026, month: 2, user_id: 3 }));
  s('alice', 'PUT', '/api/attendance', j({ date: '2026-02-06', period: 'AM', status: 'present' }));
  s('alice', 'GET', '/api/attendance?year=2026&month=2');
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-06', period: 'AM', status: 'present', user_id: 2 }));
  s('admin', 'GET', '/api/validations/company/1?year=2026&month=2');
  s('admin', 'GET', '/api/validations/overview?year=2026&month=2');
  s('admin', 'POST', '/api/validations/company/1', j({ year: 2026, month: 2 }));
  s('admin', 'POST', '/api/validations/cadre?year=2026&month=2', j({ user_id: '3' }));
  s('admin', 'POST', '/api/validations/cadre', j({ year: 2026, month: 2, user_id: 'x' }));
  s('admin', 'POST', '/api/validations/cadre', j({ year: 2026, month: 2, user_id: 999 }));
  s('admin', 'POST', '/api/validations/company/1', j({ year: 2026, month: 2 }));
  s('admin', 'GET', '/api/validations/company/1?year=2026&month=2');
  s('admin', 'GET', '/api/validations/overview?year=2026&month=2');
  s('alice', 'POST', '/api/validations/cadre', j({ year: 2026, month: 2 }));
  s('admin', 'PUT', '/api/attendance', j({ date: '2026-02-06', period: 'AM', status: 'present', user_id: 2 }));
  s('admin', 'DELETE', '/api/attendance/month', j({ year: 2026, month: 2, user_id: 2 }));
  s('alice', 'GET', '/api/attendance?year=2026&month=2');
  s('alice', 'GET', '/api/attendance/history');
  s('alice', 'GET', '/api/validations/company/abc?year=2026&month=2');
  s('alice', 'GET', '/api/validations/company/1?year=2026&month=2');
  s('alice', 'GET', '/api/validations/overview?year=2026&month=2');
  s('alice', 'GET', '/api/validations/nope');
  s('admin', 'POST', '/api/validations/cadre/reopen', j({ year: 2026, month: 2 }));
  s('admin', 'POST', '/api/validations/cadre/reopen', j({ year: 2026, month: 2, user_id: 999 }));
  s('admin', 'POST', '/api/validations/company/999', j({ year: 2026, month: 2 }));

  // Exports (company validated, Alice's month validated).
  s('admin', 'GET', '/api/export/excel/1?year=2026&month=2');
  s('admin', 'GET', '/api/export/pdf/1?year=2026&month=2');
  s('admin', 'GET', '/api/export/excel/2?year=2026&month=3');
  s('admin', 'GET', '/api/export/pdf/999?year=2026&month=2');
  s('admin', 'GET', '/api/export/pdf/1?year=2026');
  s('alice', 'GET', '/api/export/pdf/1?year=2026&month=2');

  s('admin', 'POST', '/api/validations/company/1/reopen', j({ month: 2 }));
  s('admin', 'POST', '/api/validations/company/1/reopen', j({ year: 2026, month: 2 }));
  s('admin', 'POST', '/api/validations/cadre/reopen', j({ year: 2026, month: 2, user_id: 2 }));
  s('admin', 'DELETE', '/api/attendance/month', j({ year: '2026', month: '2', user_id: 2 }));
  s('alice', 'GET', '/api/attendance?year=2026&month=2');

  // Passwords and session invalidation (sleeps keep JWT `iat` before the change).
  s('alice', 'PUT', '/api/auth/password', j({ current: 'cadre-password', password: 'short' }));
  s('alice', 'PUT', '/api/auth/password', j({ password: 'new-password' }));
  s('alice', 'PUT', '/api/auth/password', j({ current: 'nope', password: 'new-password' }));
  s('alice', 'PUT', '/api/auth/password', j({ current: 'cadre-password', password: 'new-password' }), { sleep: 1100 });
  s('alice', 'GET', '/api/auth/me');
  s('admin', 'PUT', '/api/users/3/password', j({ password: 'another-pass' }), { sleep: 1100 });
  s('bruno', 'GET', '/api/auth/me');
  s('admin', 'PUT', '/api/users/1/password', j({ password: 'admin-password' }));
  s('admin', 'GET', '/api/auth/me');
  s('admin', 'POST', '/api/validations/company/2', j({ year: 2026, month: 1 }));
  s('admin', 'DELETE', '/api/users/4');
  s('admin', 'DELETE', '/api/users/3');
  s('admin', 'DELETE', '/api/users/3');

  // Rate limit: 10 failures, then 429 for that account only.
  for (let i = 0; i < 11; i++) s(null, 'POST', '/api/auth/login', j({ email: 'cadrealice@acme.fr', password: 'bad' }));
  s(null, 'POST', '/api/auth/login', j({ email: ADMIN.email, password: 'bad' }));
  s('alice', 'POST', '/api/auth/logout');
  s('alice', 'GET', '/api/auth/me');
  return steps;
}

// --- execution -------------------------------------------------------------

async function play(port) {
  const jar = {};
  const results = [];
  for (const st of scenario()) {
    if (st.sleep) await sleep(st.sleep);
    const headers = {};
    if (st.body != null) headers['content-type'] = st.ct || 'application/json';
    const cookie = st.cookie || (st.role && jar[st.role]);
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`http://127.0.0.1:${port}${st.url}`, { method: st.method, headers, body: st.body ?? undefined, redirect: 'manual' });
    const buf = Buffer.from(await res.arrayBuffer());
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (st.role) jar[st.role] = pair.endsWith('=') ? undefined : pair;
    }
    results.push({
      step: `${st.role || '-'} ${st.method} ${st.url.slice(0, 80)}`,
      status: res.status,
      contentType: res.headers.get('content-type'),
      disposition: res.headers.get('content-disposition'),
      allow: res.headers.get('allow'),
      setCookie: setCookie.map((c) => c.replace(/^presencia_token=[^;]+/, 'presencia_token=<jwt>').replace(/Expires=[^;]+/, 'Expires=<date>')),
      body: buf,
    });
  }
  return results;
}

// Timestamps: checked against the formats Node produces, then masked.
const JS_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PG_JSON_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
function normalize(v, problems, where) {
  if (Array.isArray(v)) return v.map((x) => normalize(x, problems, where));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x, problems, `${where}.${k}`)]));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    if (JS_DATE.test(v)) return '<js-date>';
    if (PG_JSON_DATE.test(v)) return '<pg-date>';
    problems.push(`${where}: unexpected timestamp format ${v}`);
  }
  return v;
}

// Minimal ZIP reader (central directory + raw inflate).
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attrOf = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

// Sheet name, frozen panes, merges, and every non-empty cell with its value and fill.
function readXlsx(buf) {
  const f = unzip(buf);
  const strings = [...(f['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''),
  );
  const styles = f['xl/styles.xml'];
  const fills = [...styles.match(/<fills[\s\S]*?<\/fills>/)[0].matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((m) => attrOf(m[1], 'rgb') || null);
  const xfs = [...styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)[0].matchAll(/<xf\b[^>]*>/g)].map((m) => fills[Number(attrOf(m[0], 'fillId') || 0)]);
  const sheet = f['xl/worksheets/sheet1.xml'];
  const cells = {};
  for (const m of sheet.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
    const r = attrOf(m[1], 'r');
    const v = (m[3] || '').match(/<v>([\s\S]*?)<\/v>/);
    let value = v ? xmlText(v[1]) : '';
    if (v && attrOf(m[1], 't') === 's') value = strings[Number(v[1])];
    const fill = xfs[Number(attrOf(m[1], 's') || 0)] || null;
    if (value !== '' || fill) cells[r] = [value, fill];
  }
  const pane = sheet.match(/<pane\b[^>]*>/);
  return {
    sheet: xmlText(attrOf(f['xl/workbook.xml'].match(/<sheet\b[^>]*>/)[0], 'name')),
    frozen: pane ? [attrOf(pane[0], 'xSplit'), attrOf(pane[0], 'ySplit')] : null,
    merges: [...sheet.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]).sort(),
    cells,
  };
}

function pdfText(buf) {
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: buf }).toString().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

function view(r, problems) {
  const out = { status: r.status, contentType: r.contentType, disposition: r.disposition, allow: r.allow, setCookie: r.setCookie };
  if (r.body.length === 0) out.body = '';
  else if (r.contentType?.startsWith('application/json')) out.body = normalize(JSON.parse(r.body.toString()), problems, r.step);
  else if (r.contentType?.includes('spreadsheetml')) out.body = readXlsx(r.body);
  else if (r.contentType === 'application/pdf') out.body = pdfText(r.body);
  else out.body = r.body.toString();
  return out;
}

function diff(a, b, where, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${where}.${k}`, out);
    return;
  }
  out.push(`${where}\n    node: ${JSON.stringify(a)?.slice(0, 300)}\n    rust: ${JSON.stringify(b)?.slice(0, 300)}`);
}

const nodeDir = path.resolve(args['node-dir']);
if (!existsSync(path.join(nodeDir, 'node_modules'))) execFileSync('npm', ['ci', '--omit=dev'], { cwd: nodeDir, stdio: 'inherit' });

const runs = {};
for (const [name, cmd, cmdArgs, cwd, port] of [
  ['node', process.execPath, ['src/index.js'], nodeDir, 4791],
  ['rust', path.resolve(args['rust-bin']), [], process.cwd(), 4790],
]) {
  const srv = await startServer(name, cmd, cmdArgs, cwd, port);
  try {
    runs[name] = await play(port);
  } finally {
    srv.child.kill('SIGTERM');
    await sleep(300);
  }
}

const problems = [];
const diffs = [];
runs.node.forEach((n, i) => diff(view(n, problems), view(runs.rust[i], problems), `#${i} ${n.step}`, diffs));
console.log(`${runs.node.length} requêtes rejouées.`);
for (const p of problems) console.log(`FORMAT ${p}`);
for (const d of diffs) console.log(`ÉCART ${d}`);
if (problems.length || diffs.length) {
  console.log(`${diffs.length} écart(s), ${problems.length} problème(s) de format.`);
  process.exit(1);
}
console.log('Parité : aucun écart.');
