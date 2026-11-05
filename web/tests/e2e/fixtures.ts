import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@presencia.local', password: process.env.ADMIN_PASSWORD ?? 'admin-password' };
export const CADRE_PASSWORD = 'cadre-password-e2e';

/** Per test: fails on any request to another host and on console errors. */
export const test = base.extend<{ watched: Page }>({
  watched: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`requête externe : ${u}`);
    });
    page.on('pageerror', (e) => problems.push(`erreur JS : ${e.message}`));
    page.on('console', (m) => {
      // The startup GET /api/auth/me answers 401 before signing in.
      if (m.type() === 'error' && !/status of 401/.test(m.text())) problems.push(`console : ${m.text()}`);
    });
    await use(page);
    expect(problems, problems.join('\n')).toEqual([]);
  },
});
export { expect };

export async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('main')).toBeVisible();
}

export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** On phones: nothing wider than the screen, touch targets of 44 px. */
export async function mobileLayout(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main a.btn, nav button, nav a')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
      .filter((e) => e.h < 44),
  );
  expect(small).toEqual([]);
}

/** A company and a cadre created through the API, with unique names. */
export async function seed(request: APIRequestContext, tag: string) {
  const id = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const r = await request.post('/api/auth/login', { data: ADMIN });
  expect(r.ok()).toBeTruthy();
  const company = await (await request.post('/api/companies', { data: { name: `Société ${id}` } })).json();
  const email = `cadre-${id}@e2e.test`;
  const cadre = await (
    await request.post('/api/users', {
      data: { full_name: `Cadre ${id}`, email, password: CADRE_PASSWORD, role: 'cadre', company_id: company.id },
    })
  ).json();
  return { company, cadre, email };
}
