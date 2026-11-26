import { expect, test, type Page } from '@playwright/test';
import { appleAn } from './apple-hilfe';

/**
 * E245: Arbeitsanweisungen im Chat ausgeblendet (nur Leifs Eingabe sichtbar, die Anweisung ist zugeklappt) und „Letzte Chats“
 * in der Kopfleiste – Dorf und Apple: beim Überfahren die 5 letzten Chats, Klick springt hinein.
 */
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 3999}`;
const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

async function frageStellen(page: Page, frage: string): Promise<string> {
  const r = await page.request.post('/api/aktionen/starten', { headers: { origin: ORIGIN }, data: { id: 'Rathaus/frage-stellen', eingaben: { frage } } });
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { chatId: string }).chatId;
}

for (const design of ['dorf', 'apple'] as const) {
  test(`E245 ${design}: Arbeitsanweisung ausgeblendet, Letzte Chats springen in den Chat`, async ({ page }, info) => {
    test.setTimeout(90_000);
    if (design === 'apple') await appleAn(page);
    await anmelden(page);
    const kennung = `${design}-${info.project.name}-${Date.now()}`;
    const alt = await frageStellen(page, `Erste Frage ${kennung}`);
    const neu = await frageStellen(page, `Zweite Frage ${kennung}`);

    // Chat: nur die Frage sichtbar, die Anweisung zugeklappt
    await page.goto(`/chats/${neu}`);
    await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible({ timeout: 30_000 });
    const erste = page.locator('.nachricht.nutzer').first();
    await expect(erste.getByTestId('auftrag-anzeige')).toHaveText(`Zweite Frage ${kennung}`);
    const anweisung = erste.getByTestId('arbeitsanweisung');
    await expect(anweisung).not.toHaveAttribute('open', '');
    await expect(anweisung.locator('.nutzer-text, p').first()).toBeHidden();
    await anweisung.locator('summary').click();
    await expect(anweisung).toHaveAttribute('open', '');

    // Letzte Chats: Überfahren zeigt die Liste, Klick auf den älteren Chat springt dorthin
    const letzte = page.getByTestId('letzte-chats').first();
    await expect(letzte).toBeVisible();
    // Desktop: Überfahren öffnet; Handy (Touch): Antippen
    if (info.project.name === 'handy') await letzte.getByRole('button', { name: 'Letzte Chats' }).click();
    else await letzte.getByRole('button', { name: 'Letzte Chats' }).hover();
    const eintraege = page.getByTestId('letzter-chat');
    await expect(eintraege.first()).toBeVisible();
    expect(await eintraege.count()).toBeLessThanOrEqual(5);
    // keine Arbeitsanweisung in der Vorschau
    await expect(page.locator('.letzte-chats-liste')).not.toContainText('So arbeitest du');
    const ziel = eintraege.filter({ hasText: `Erste Frage ${kennung}` });
    await expect(ziel).toHaveCount(1);
    await ziel.click();
    await expect(page).toHaveURL(new RegExp(`/chats/${alt}$`));
    await expect(page.locator('.letzte-chats-liste')).toHaveCount(0);
  });
}
