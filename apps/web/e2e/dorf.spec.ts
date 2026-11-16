import { expect, test, type Page } from '@playwright/test';

const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

test('falsches Passwort wird abgelehnt, richtiges führt ins Dorf', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Passwort').fill('ganz-falsch');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByText('Passwort falsch.')).toBeVisible();
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  for (const g of ['Rathaus', 'Uni', 'Post', 'Marktplatz', 'Bibliothek', 'Corpshaus', 'Bank', 'Börse', 'Einkaufsladen']) {
    await expect(page.locator('.gebaeude-karte', { hasText: g }).first()).toBeVisible();
  }
  await expect(page.locator('.live.verbunden')).toBeVisible();
});

test('Gebäude öffnen zeigt die Arbeitsanweisung', async ({ page }) => {
  await anmelden(page);
  await page.locator('.gebaeude-karte', { hasText: 'Uni' }).click();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByRole('heading', { name: /Uni – Arbeitsanweisung/ })).toBeVisible();
  await page.getByRole('button', { name: 'Dateien' }).click();
  await expect(page.getByRole('button', { name: /faecher/ })).toBeVisible();
});

test('Notiz anlegen, bearbeiten, Wikilink folgen, suchen', async ({ page }, info) => {
  const name = `Testnotiz ${info.project.name}`;
  await anmelden(page);
  await page.goto('/bibliothek?pfad=Uni');
  if (info.project.name === 'handy') await page.getByRole('button', { name: '☰ Dateien' }).click();
  page.once('dialog', (d) => d.accept(name));
  await page.getByRole('button', { name: '+ Notiz' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`Eigenwertproblem ${info.project.name}\n\nSiehe [[stadtordnung]].`);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.getByRole('link', { name: 'stadtordnung' }).click();
  await expect(page.getByRole('heading', { name: 'Stadtordnung', exact: true })).toBeVisible();

  await page.goto(`/bibliothek?q=${encodeURIComponent(`eigenwert ${info.project.name}`)}`);
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('Änderungen erscheinen live auf einem zweiten Gerät', async ({ browser }, info) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await anmelden(a);
  await anmelden(b);
  const pfad = `Rathaus/schreibtisch/live-${info.project.name}.md`;
  // Gerät A legt die Datei an
  await a.evaluate(
    (p) => fetch('/api/vault/datei', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pfad: p, inhalt: 'Erste Fassung' }) }),
    pfad,
  );
  await b.goto(`/bibliothek?pfad=${encodeURIComponent(pfad)}`);
  await expect(b.getByText('Erste Fassung')).toBeVisible();
  // Gerät A ändert – Gerät B sieht es ohne Neuladen
  await a.evaluate(
    (p) => fetch('/api/vault/datei', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pfad: p, inhalt: 'Zweite Fassung' }) }),
    pfad,
  );
  await expect(b.getByText('Zweite Fassung')).toBeVisible({ timeout: 10_000 });
});

test('Einstellungen zeigen angemeldete Geräte; Abmelden wirkt', async ({ page }) => {
  await anmelden(page);
  await page.goto('/einstellungen');
  await expect(page.getByText('dieses Gerät')).toBeVisible();
  await page.getByRole('button', { name: 'Auf diesem Gerät abmelden' }).click();
  await expect(page.getByRole('button', { name: 'Ins Dorf' })).toBeVisible();
});

test('Aktion starten, Chat live, fortsetzen, Freigabe annehmen, Verbrauch', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus');
  await page.getByRole('button', { name: /Frage stellen/ }).click();
  const ziel = `Rathaus/schreibtisch/2026-11-16_1200_e2e-${info.project.name}.md`;
  await page.getByLabel(/Deine Frage/).fill(`Lege bitte etwas ab [schreibe ${ziel}] und beantrage [freigabe ${ziel}]`);
  await page.getByRole('button', { name: 'Starten' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(/Erledigt\. \(claude-code, claude-opus-5-5/)).toBeVisible();
  await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible();

  await page.getByPlaceholder('Weiter im Gespräch …').fill('Und noch etwas?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText(/Lauf 2: fertig/)).toBeVisible();

  // Freigabe im Kopf und im Rathaus
  await page.locator('.abzeichen.brief').click();
  await expect(page.getByRole('heading', { name: `${ziel} löschen` })).toBeVisible();
  await page.getByRole('button', { name: 'Ja, ausführen' }).first().click();
  await expect(page.getByText('Nichts offen.')).toBeVisible();

  await page.getByRole('button', { name: 'Verbrauch' }).click();
  await expect(page.locator('table.tabelle').first()).toContainText('2');
  await page.getByRole('button', { name: 'Agenten-Einstellungen' }).click();
  await expect(page.getByLabel('Modell gross')).toHaveValue('claude-fable-5-2');
});
