import { expect, test, type Page } from '@playwright/test';
import { analyseDaten } from './boerse-daten';

/** E223: Börse – Analyse (Zeiträume, Teile ein/aus, Kennzahlen, Monate), Rechner, Berater. Daten nachgebaut (kein Saxo im Test). */
async function anmelden(page: Page) {
  await page.route('**/api/boerse/analyse', (r) => r.fulfill({ json: analyseDaten() }));
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

test('Börse-Analyse: Zeitraum, Teile ein- und ausblenden, Kennzahlen, Aufteilung, Monate, Beträge verbergen', async ({ page }) => {
  await anmelden(page);
  await page.goto('/gebaeude/Boerse?reiter=analyse');
  const kacheln = page.getByLabel('Kennzahlen: Saxo-Konto gesamt');
  await expect(kacheln).toContainText('1 Jahr');
  await page.getByRole('group', { name: 'Zeitraum' }).getByRole('button', { name: 'Max' }).click();
  await expect(kacheln).toContainText('Alles');
  await expect(kacheln).toContainText('pro Jahr');
  // Apple einblenden → zweite Linie + Legende
  const legende = page.getByRole('list', { name: 'Legende' });
  await expect(legende).toHaveCount(0);
  await page.getByLabel('Apple Inc. im Diagramm').check();
  await expect(legende).toContainText('Apple Inc.');
  await page.getByRole('group', { name: 'Anzeige' }).getByRole('button', { name: '%' }).click();
  await expect(page.locator('.diagramm-achse', { hasText: '%' }).first()).toBeVisible();
  // gemerkt
  await page.reload();
  await expect(page.getByLabel('Apple Inc. im Diagramm')).toBeChecked();
  await page.getByRole('region', { name: 'Teile des Depots' }).getByRole('button', { name: 'Keine' }).click();
  await expect(page.getByLabel('Apple Inc. im Diagramm')).not.toBeChecked();
  await expect(page.getByText('Für diesen Zeitraum gibt es zu wenige Daten.')).toBeVisible();
  await page.getByRole('region', { name: 'Teile des Depots' }).getByRole('button', { name: 'Alle Positionen' }).click();
  // Aufteilung und Monate
  await expect(page.getByRole('region', { name: 'Aufteilung' })).toContainText('Vanguard FTSE All-World');
  await page.getByLabel('Aufteilen nach').selectOption('waehrung');
  await expect(page.getByRole('region', { name: 'Aufteilung' })).toContainText('USD');
  await expect(page.getByRole('region', { name: 'Monatsrenditen' }).locator('tbody tr').first()).toContainText(String(new Date().getFullYear()));
  // Beträge verbergen
  await page.getByRole('button', { name: '👁 Beträge' }).click();
  await expect(page.getByLabel('Kennzahlen: Saxo-Konto gesamt')).toContainText('•••');
});

test('Börse-Rechner (Sparplan, Umschichten) und Berater (Karten, Schnellfrage füllt das Formular)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Boerse?reiter=rechner');
  await page.getByLabel('Startbetrag').fill('0');
  await page.getByLabel('Monatlich').fill('100');
  await page.getByLabel('Jahre').fill('1');
  await page.getByLabel('Rendite p. a.').fill('0');
  await page.getByLabel('Kosten (TER)').fill('0');
  await expect(page.locator('.bank-kachel', { hasText: 'Eingezahlt' })).toContainText('1.200');
  await page.getByRole('tab', { name: '⚖️ Umschichten' }).click();
  await page.getByLabel('Ziel für Vanguard FTSE All-World').fill('100');
  await expect(page.locator('tr', { hasText: 'Apple Inc.' }).locator('td.minus')).toBeVisible();
  await page.goto('/gebaeude/Boerse?reiter=berater');
  await expect(page.getByRole('button', { name: /Aktie analysieren/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Welcher Welt-ETF passt zu mir?' }).click();
  await expect(page.getByLabel(/Thema oder ETFs/)).toHaveValue(/Welt-ETF/);
  await expect(page.getByRole('button', { name: /Starten|Los/ }).first()).toBeVisible();
});
