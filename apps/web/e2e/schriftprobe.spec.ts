import { expect, test, type Page } from '@playwright/test';

/**
 * E216 – Schriftprobe: vom Atelier zur Seite, Zeichen schreiben (Maus), übernehmen, Fortschritt, gespeichert im Vault
 * (Versalhöhen-Einheiten), nach Neuladen noch da, Variante löschen, Probelesen. Desktop und Handy.
 */
const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

type Probe = { vorhanden: boolean; probe: { zeichen: Record<string, number[][][][]> } | null };
const probeHolen = (page: Page) => page.evaluate(async () => (await (await fetch('/api/atelier/schriftprobe')).json()) as Probe);

/** Ein Strich im Kästchen, Anteile von Breite/Höhe */
async function strich(page: Page, punkte: [number, number][]) {
  await page.getByTestId('sp-leinwand').scrollIntoViewIfNeeded();
  const box = (await page.getByTestId('sp-leinwand').boundingBox())!;
  const [x0, y0] = punkte[0]!;
  await page.mouse.move(box.x + x0 * box.width, box.y + y0 * box.height);
  await page.mouse.down();
  for (const [x, y] of punkte.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 });
  await page.mouse.up();
}

test('Schriftprobe: Zeichen schreiben, übernehmen, gespeichert in Versalhöhen-Einheiten, Variante löschen', async ({ page }) => {
  await anmelden(page);
  // sauberer Anfang (der e2e-Server ist für beide Projekte derselbe)
  await page.evaluate(() => fetch('/api/atelier/schriftprobe', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, zeichen: {} }) }));
  await page.goto('/gebaeude/Atelier');
  await expect(page.getByTestId('schriftprobe-stand')).toContainText('Noch keine Probe');
  await page.getByTestId('schriftprobe-oeffnen').click();
  await expect(page).toHaveURL(/\/schriftprobe$/);
  await expect(page.getByTestId('sp-aktuell')).toHaveText('a');
  await expect(page.getByTestId('sp-uebernehmen')).toBeDisabled();

  // „a“: Bogen + senkrechter Strich, von der Grundlinie (68 %) bis zur x-Höhe
  await strich(page, [[0.4, 0.5], [0.3, 0.55], [0.3, 0.65], [0.4, 0.68], [0.45, 0.6]]);
  await strich(page, [[0.45, 0.5], [0.45, 0.68]]);
  await page.getByTestId('sp-uebernehmen').click();
  await expect(page.getByTestId('sp-status')).toContainText('„a“ gespeichert (1×)');
  await expect(page.getByTestId('sp-aktuell')).toHaveText('a'); // Ziel 3× – gleiches Zeichen weiter
  await expect(page.getByTestId('sp-varianten').locator('canvas')).toHaveCount(1);
  await strich(page, [[0.4, 0.5], [0.3, 0.6], [0.45, 0.68]]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sp-status')).toContainText('(2×)');

  const p = await probeHolen(page);
  expect(p.vorhanden).toBe(true);
  const a = p.probe!.zeichen.a!;
  expect(a).toHaveLength(2);
  expect(a[0]).toHaveLength(2);
  // Grundlinie y = 0, Versalhöhe y = -1: der zweite Strich endet auf der Grundlinie, beginnt deutlich darüber
  const senkrecht = a[0]![1]!;
  expect(Math.abs(senkrecht[senkrecht.length - 1]![1]!)).toBeLessThan(0.08);
  expect(senkrecht[0]![1]!).toBeLessThan(-0.3);
  expect(senkrecht[0]![1]!).toBeGreaterThan(-0.6);
  // Zeit läuft mit
  expect(senkrecht[senkrecht.length - 1]![2]!).toBeGreaterThan(0);

  // anderes Zeichen wählen, schreiben; dann neu laden – alles noch da
  await page.getByTestId('sp-feld-H').click();
  await expect(page.getByTestId('sp-aktuell')).toHaveText('H');
  await strich(page, [[0.3, 0.26], [0.3, 0.68]]);
  await page.getByRole('button', { name: '↶ Strich zurück' }).click();
  await expect(page.getByTestId('sp-uebernehmen')).toBeDisabled();
  await strich(page, [[0.3, 0.26], [0.3, 0.68]]);
  await strich(page, [[0.6, 0.26], [0.6, 0.68]]);
  await strich(page, [[0.3, 0.47], [0.6, 0.47]]);
  await page.getByTestId('sp-uebernehmen').click();
  await expect(page.getByTestId('sp-status')).toContainText('„H“ gespeichert (1×)');
  await page.reload();
  await expect(page.getByTestId('sp-aktuell')).toHaveText('a'); // erstes offenes Zeichen
  await expect(page.getByTestId('sp-feld-a')).toContainText('2');
  await expect(page.getByTestId('sp-feld-H')).toHaveClass(/teil/);
  await expect(page.getByTestId('sp-fortschritt')).toContainText('3 von');
  await expect(page.getByTestId('sp-vorschau')).toBeVisible();

  // Variante löschen
  await page.getByRole('button', { name: 'Variante 1 löschen' }).click();
  await expect(page.getByTestId('sp-status')).toContainText('gelöscht');
  await expect.poll(async () => (await probeHolen(page)).probe?.zeichen.a?.length).toBe(1);

  // im Atelier steht jetzt, dass es sie gibt
  await page.goto('/gebaeude/Atelier');
  await expect(page.getByTestId('schriftprobe-stand')).toContainText('2 Zeichen in deiner Hand');
});
