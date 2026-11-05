import { test, expect, login, axe, mobileLayout, seed, signedOut, CADRE_PASSWORD } from './fixtures.ts';
import type { APIRequestContext, Page } from '@playwright/test';

const YM = '2026-03'; // a past month: the 1st is a Sunday, 22 working days

const half = (page: Page, day: number, period: 'matin' | 'après-midi') =>
  page.locator(`button[data-k="2026-03-${String(day).padStart(2, '0')}|${period === 'matin' ? 'AM' : 'PM'}"]`);

async function entries(request: APIRequestContext, userId: number) {
  const r = await request.get(`/api/attendance?year=2026&month=3&user_id=${userId}`);
  return (await r.json()).entries as { date: string; period: string; status: string }[];
}

test('cadre : saisie, pinceau, glisser, annulation, remplissage, validation', async ({ watched: page, request }, info) => {
  const { cadre, email } = await seed(request, 'cadre');
  await login(page, email, CADRE_PASSWORD);
  await expect(page.getByRole('heading', { name: /\d{4}/ })).toBeVisible(); // dashboard
  await axe(page);
  if (info.project.name === 'mobile') await mobileLayout(page);
  await page.goto(`/#/planning/${YM}`);
  await expect(page.getByRole('heading', { name: /Mars 2026/ })).toBeVisible();
  await axe(page);
  if (info.project.name === 'mobile') await mobileLayout(page);

  // Menu of a half-day: 1 = Présent.
  await half(page, 2, 'matin').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await axe(page);
  await page.keyboard.press('1');
  await expect(half(page, 2, 'matin')).toHaveText('Présent');

  // Enter in the menu: the whole day, Présent by default.
  await half(page, 3, 'matin').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(half(page, 3, 'après-midi')).toHaveText('Présent');

  // Brush: Congé, then a tap writes directly.
  const brushes = info.project.name === 'mobile' ? page.locator('.m-brush') : page.getByRole('group', { name: 'Pinceau' });
  await brushes.getByRole('button', { name: /Congé/ }).click();
  await half(page, 4, 'matin').click();
  await expect(half(page, 4, 'matin')).toHaveText('Congé');
  await brushes.getByRole('button', { name: /Congé/ }).click(); // brush off

  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(4);

  if (info.project.name === 'desktop') {
    // Drag from Monday 9 morning to Wednesday 11 afternoon: 6 half-days.
    const a = (await half(page, 9, 'matin').boundingBox())!;
    const b = (await half(page, 11, 'après-midi').boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 10, b.y + 10, { steps: 8 });
    await page.mouse.up();
    const bar = page.getByRole('toolbar', { name: 'Appliquer à la sélection' });
    await expect(bar).toContainText('6 demi-journées');
    await axe(page);
    await bar.getByRole('button', { name: 'RTT' }).click();
    await expect(half(page, 10, 'après-midi')).toHaveText('RTT');
    await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(10);

    // Undo puts the six half-days back to empty, on screen and on the server.
    await page.getByRole('button', { name: /Annuler/ }).click();
    await expect(half(page, 10, 'après-midi')).toHaveText('après-midi');
    await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(4);

    // Ctrl+Z after a keyboard write.
    await half(page, 12, 'matin').focus();
    await page.keyboard.press('2');
    await expect(half(page, 12, 'matin')).toHaveText('Non-présent');
    await page.keyboard.press('Control+z');
    await expect(half(page, 12, 'matin')).toHaveText('matin');
  }

  // Fill the working days: what is set stays.
  await page.getByRole('button', { name: /Remplir les jours ouvrés|Jours ouvrés/ }).click();
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(44);
  await expect(half(page, 4, 'matin')).toHaveText('Congé');
  await page.getByRole('button', { name: /Annuler/ }).click();
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(4);

  {
    // Clear all, with confirmation.
    await page.getByRole('button', { name: 'Tout effacer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tout effacer' }).click();
    await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(0);
    await page.getByRole('button', { name: /Annuler/ }).click();
    await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(4);
    await expect(half(page, 4, 'matin')).toHaveText('Congé');
  }

  // Validate: the month locks.
  await page.getByRole('button', { name: 'Valider le mois' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Valider le mois' }).click();
  await expect(page.getByText(/saisies verrouillées/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Pinceau' })).toHaveCount(0);
  await expect(half(page, 16, 'matin')).toHaveAttribute('aria-disabled', 'true');
  if (info.project.name === 'desktop') {
    // The view switch stays available on a locked month.
    await expect(page.getByRole('group', { name: 'Affichage' })).toBeVisible();
  }
  await axe(page);

  // History lists the month.
  await page.goto('/#/historique');
  await expect(page.getByRole('cell', { name: 'Mars 2026' })).toBeVisible();
  await axe(page);
  if (info.project.name === 'mobile') await mobileLayout(page);
});

test('cadre : mon mot de passe', async ({ watched: page, request }, info) => {
  const { email } = await seed(request, 'pwd');
  await login(page, email, CADRE_PASSWORD);
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Compte' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mon mot de passe' }).click();
  } else {
    await page.getByRole('button', { name: 'Mon mot de passe' }).click();
  }
  const d = page.getByRole('dialog', { name: 'Mon mot de passe' });
  await d.getByLabel('Mot de passe actuel').fill(CADRE_PASSWORD);
  await d.getByLabel('Nouveau mot de passe', { exact: true }).fill('nouveau-mot-de-passe');
  await d.getByLabel('Nouveau mot de passe, encore').fill('nouveau-mot-de-passe');
  await axe(page);
  await d.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByText('Mot de passe changé')).toBeVisible();
});

// Plain `page`: the failed request logs a console error on purpose.
test('cadre : une écriture refusée recharge le mois', async ({ page, request }) => {
  const { cadre, email } = await seed(request, 'fail');
  await login(page, email, CADRE_PASSWORD);
  await page.goto(`/#/planning/${YM}`);
  await half(page, 2, 'matin').click();
  await page.keyboard.press('1');
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(1);

  await page.route('**/api/attendance', (r) =>
    r.request().method() === 'PUT' ? r.fulfill({ status: 500, json: { error: 'Erreur serveur' } }) : r.fallback(),
  );
  await half(page, 3, 'matin').click();
  await page.keyboard.press('1');
  // Shown at once, then put back to what the server has.
  await expect(half(page, 3, 'matin')).toHaveText('matin');
  await expect(half(page, 2, 'matin')).toHaveText('Présent');
  await expect(page.getByText('Erreur serveur')).toBeVisible();
  await expect(page.getByRole('button', { name: /Annuler/ })).toHaveCount(0);
  expect((await entries(request, cadre.id)).length).toBe(1);
});

test('connexion et déconnexion', async ({ watched: page, request }, info) => {
  const { email } = await seed(request, 'out');
  await page.goto('/');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await axe(page);
  if (info.project.name === 'mobile') await mobileLayout(page);
  await login(page, email, CADRE_PASSWORD);
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Compte' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Se déconnecter' }).click();
  } else {
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
  }
  await expect(page.getByLabel('E-mail')).toBeVisible();
  signedOut(page);
  await page.goto('/#/historique');
  await expect(page.getByLabel('E-mail')).toBeVisible();
});

test('cadre au doigt : toucher ouvre le menu, le pinceau écrit', async ({ watched: page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'parcours tactile, à 390 px');
  const { cadre, email } = await seed(request, 'touch');
  await login(page, email, CADRE_PASSWORD);
  await page.goto(`/#/planning/${YM}`);
  await expect(page.getByRole('heading', { name: /Mars 2026/ })).toBeVisible();

  // A tap without a brush opens the menu (pointerType touch).
  await half(page, 2, 'matin').tap();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /RTT/ }).tap();
  await expect(half(page, 2, 'matin')).toHaveText('RTT');

  // With a brush, each tap writes.
  await page.locator('.m-brush').getByRole('button', { name: 'Congé' }).tap();
  await half(page, 3, 'matin').tap();
  await half(page, 3, 'après-midi').tap();
  await expect(half(page, 3, 'après-midi')).toHaveText('Congé');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(3);

  // A finger drag with the brush paints every half-day it crosses
  // (pointer events as the browser sends them for a touch).
  await page.evaluate(() => {
    const at = (k: string) => {
      const r = document.querySelector(`[data-k="${k}"]`)!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const fire = (type: string, k: string, target: EventTarget) => {
      const { x, y } = at(k);
      const el = type === 'pointerup' ? target : document.elementFromPoint(x, y)!;
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y }));
    };
    fire('pointerdown', '2026-03-04|AM', window);
    fire('pointermove', '2026-03-04|PM', window);
    fire('pointermove', '2026-03-05|PM', window);
    fire('pointerup', '2026-03-05|PM', window);
  });
  await expect(half(page, 5, 'après-midi')).toHaveText('Congé');
  await expect(half(page, 4, 'après-midi')).toHaveText('Congé');
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(7);
  // The undo offer sits above the brush bar and works with a tap.
  await page.getByRole('button', { name: /Annuler/ }).tap();
  await expect(half(page, 5, 'après-midi')).toHaveText('après-midi');
  await expect.poll(async () => (await entries(request, cadre.id)).length).toBe(3);
});
