import { test, expect, login, axe, mobileLayout, seed, ADMIN, CADRE_PASSWORD } from './fixtures.ts';
import { request as pwRequest } from '@playwright/test';

const YM = '2026-03';

test('admin : utilisateurs, plannings, validation, exports', async ({ watched: page, request, baseURL }, info) => {
  const { company, cadre, email } = await seed(request, 'admin');
  const mobile = info.project.name === 'mobile';
  await login(page, ADMIN.email, ADMIN.password);
  await axe(page);
  if (mobile) await mobileLayout(page);

  // Users: deactivate, reactivate, reset the password.
  await page.goto('/#/utilisateurs');
  await page.getByPlaceholder('Nom ou e-mail').fill(email);
  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(row.getByText('Inactif')).toBeVisible();
  await row.getByRole('button', { name: 'Activer' }).click();
  await expect(row.getByText('Actif', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Mot de passe' }).click();
  await page.getByRole('dialog').getByLabel('Mot de passe').fill(CADRE_PASSWORD);
  await page.getByRole('dialog').getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByText(/Mot de passe changé pour/)).toBeVisible();
  await axe(page);
  if (mobile) await mobileLayout(page);

  // Plannings: open the cadre and correct a half-day.
  await page.goto(`/#/plannings/${YM}`);
  await page.getByPlaceholder('Nom ou e-mail').fill(cadre.full_name);
  await page.getByRole('row').filter({ hasText: cadre.full_name }).getByRole('link', { name: 'Ouvrir' }).click();
  await expect(page.locator('.page-sub', { hasText: cadre.full_name })).toBeVisible();
  const am = page.locator('button[data-k="2026-03-02|AM"]');
  await am.click();
  await page.getByRole('menuitem', { name: /Présent/ }).click();
  await expect(am).toHaveText('Présent');
  await axe(page);

  // Validation: refused until the cadre validated.
  await page.goto(`/#/validation/${YM}/${company.id}`);
  const validate = page.getByRole('button', { name: 'Valider la société' });
  await expect(validate).toBeDisabled();
  const asCadre = await pwRequest.newContext({ baseURL });
  await asCadre.post('/api/auth/login', { data: { email, password: CADRE_PASSWORD } });
  expect((await asCadre.post('/api/validations/cadre', { data: { year: 2026, month: 3 } })).ok()).toBeTruthy();
  await asCadre.dispose();
  await page.reload();
  await expect(validate).toBeEnabled();
  await validate.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Valider la société' }).click();
  await expect(page.getByText('Société validée')).toBeVisible();
  await axe(page);
  if (mobile) await mobileLayout(page);

  // Exports: type and file name.
  for (const [label, ext] of [['Excel', 'xlsx'], ['PDF', 'pdf']] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`^presences_.*_2026-03\\.${ext}$`));
  }

  // Reopen the company, then the cadre.
  await page.getByRole('button', { name: 'Réouvrir la société' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Réouvrir' }).click();
  await expect(page.getByText('Société réouverte')).toBeVisible();
  await page.getByRole('row').filter({ hasText: cadre.full_name }).getByRole('button', { name: 'Réouvrir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Réouvrir' }).click();
  await expect(page.getByText('Mois réouvert pour ce cadre')).toBeVisible();

  // The admin's own planning.
  await page.goto(`/#/planning/${YM}`);
  await expect(page.getByRole('heading', { name: /Mars 2026/ })).toBeVisible();
});

test('admin : sociétés et nouvel utilisateur', async ({ watched: page }, info) => {
  const name = `Société UI ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/#/societes');
  await page.getByRole('button', { name: 'Nouvelle société' }).click();
  await page.getByRole('dialog').getByLabel('Nom').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await axe(page);
  if (info.project.name === 'mobile') await mobileLayout(page);

  await page.goto('/#/utilisateurs');
  await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
  const d = page.getByRole('dialog');
  const email = `ui-${Date.now()}@e2e.test`;
  await d.getByLabel('Nom complet').fill('Nouveau Cadre');
  await d.getByLabel('E-mail').fill(email);
  await d.getByLabel('Mot de passe').fill('mot-de-passe-1');
  await d.getByLabel('Société').selectOption({ label: name });
  await axe(page);
  await d.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();

  await page.goto('/#/societes');
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Renommer' }).click();
  await page.getByRole('dialog').getByLabel('Nom').fill(`${name} bis`);
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('row').filter({ hasText: `${name} bis` })).toBeVisible();
});
