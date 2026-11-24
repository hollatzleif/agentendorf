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

test('Börse-Analyse: Zeitraum, Teile ein- und ausblenden, Kennzahlen, Aufteilung, Monate, Beträge verbergen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'ausführlich am Desktop; am Handy der schlanke Test unten');
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
  // Depot-Ziel: Fortschritt aus Saxo + eigenem Depot
  await page.locator('.ba-ziel summary').click();
  await page.getByLabel('Zielbetrag').fill('46000');
  await expect(page.getByRole('progressbar', { name: 'Fortschritt zum Ziel' })).toHaveAttribute('aria-valuenow', /^\d+$/);
  await expect(page.locator('.ba-ziel')).toContainText('voraussichtlich');
  // ähnlich laufende Werte, einzeln ansehen (Einstandslinie), CSV
  await expect(page.getByRole('region', { name: 'Wie ähnlich laufen deine Werte' })).toContainText('Apple');
  await page.getByRole('region', { name: 'Teile des Depots' }).getByRole('button', { name: 'Apple Inc.' }).click();
  await page.getByRole('group', { name: 'Anzeige' }).getByRole('button', { name: 'Wert' }).click();
  await expect(page.getByLabel('Kennzahlen: Apple Inc.')).toBeVisible();
  await expect(page.locator('.diagramm-referenz-text')).toContainText('Einstand');
  if (info.project.name === 'desktop') {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇ CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^boerse-analyse-.+\.csv$/);
  }
  // Beträge verbergen
  await page.getByRole('button', { name: '👁 Beträge' }).click();
  await expect(page.getByLabel('Kennzahlen: Apple Inc.')).toContainText('•••');
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
  await page.getByRole('tab', { name: '🔮 Was wäre wenn' }).click();
  await page.getByLabel('Einmal').fill('1000');
  await expect(page.locator('.rechner-ergebnis')).toContainText('wären bis');
  await page.goto('/gebaeude/Boerse?reiter=berater');
  await expect(page.getByRole('button', { name: /Aktie analysieren/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Welcher Welt-ETF passt zu mir?' }).click();
  await expect(page.getByLabel(/Thema oder ETFs/)).toHaveValue(/Welt-ETF/);
  await expect(page.getByRole('button', { name: /Starten|Los/ }).first()).toBeVisible();
});

test('Börse-Analyse am Handy: Kennzahlen, Diagramm, Tabelle – nichts ragt über den Bildschirm', async ({ page }, info) => {
  test.skip(info.project.name !== 'handy', 'nur Handy');
  await anmelden(page);
  await page.goto('/gebaeude/Boerse?reiter=analyse');
  await expect(page.getByLabel('Kennzahlen: Saxo-Konto gesamt')).toContainText('1 Jahr');
  await expect(page.locator('.diagramm svg').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Teile des Depots' })).toContainText('Apple Inc.');
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(breit).toBeLessThanOrEqual(1);
  await page.getByRole('group', { name: 'Zeitraum' }).getByRole('button', { name: 'Max' }).click();
  await expect(page.getByLabel('Kennzahlen: Saxo-Konto gesamt')).toContainText('Alles');
});

test('E226: Börse-Analyse im schmalen Gebäude-Fenster des Dorfs – nachgerechnete Werte (≈), Hinweis bei Positionen ohne Linie, nichts ragt hinaus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Gebäude-Fenster neben dem 3D-Dorf gibt es am Desktop');
  const daten = analyseDaten();
  // wie bei Leif: Saxo meldete 0 → Server rechnet nach; Nestlé hat (noch) keinen Kursverlauf
  daten.saxo!.positionen = daten.saxo!.positionen.map((p) => (p.symbol === 'VWCE:xetr' ? { ...p, geschaetzt: true } : p));
  delete daten.historien['NESN.SW'];
  await page.route('**/api/boerse/analyse', (r) => r.fulfill({ json: daten }));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByLabel('Passwort')).toHaveCount(0);
  await page.goto('/?g=Boerse&reiter=analyse');
  const panel = page.locator('.dorf-panel');
  await expect(panel.getByLabel('Kennzahlen: Saxo-Konto gesamt')).toBeVisible({ timeout: 20_000 });
  const teile = panel.getByRole('region', { name: 'Teile des Depots' });
  await expect(teile.locator('tr', { hasText: 'Vanguard' })).toContainText('≈');
  await panel.getByLabel('Nestlé SA im Diagramm').check();
  await expect(panel.getByRole('status').filter({ hasText: 'Ohne Linie im Zeitraum' })).toContainText('Nestlé SA');
  await expect(panel.getByRole('button', { name: 'in % vergleichen' })).toBeVisible();
  // schmaler Container: Spalten ab „€ im Zeitraum“ ausgeblendet, kein waagrechtes Scrollen im Fenster
  await expect(teile.getByRole('columnheader', { name: 'Schwankung' })).toBeHidden();
  const ueber = await panel.evaluate((el) => {
    const innen = el.querySelector('.boerse-analyse') as HTMLElement;
    return innen.scrollWidth - innen.clientWidth;
  });
  expect(ueber).toBeLessThanOrEqual(1);
  // das Fenster selbst scrollt nie (sonst bleibt nach einem Klick ein leerer Bereich stehen) – nur sein Inhalt
  expect(await panel.evaluate((el) => [el.scrollTop, el.scrollHeight - el.clientHeight])).toEqual([0, 0]);
  await page.screenshot({ path: info.outputPath('panel.png') });
});
