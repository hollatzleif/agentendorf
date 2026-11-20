import { expect, test, type Page } from '@playwright/test';

/** Wie server-starten.sh: der nachgebaute Coding-Container hört zwei Ports unter dem nachgebauten Moodle */
const CODING = `http://127.0.0.1:${process.env.E2E_CODING_PORT ?? Number(process.env.E2E_MOODLE_PORT ?? 3998) - 2}`;
const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

test('Codehaus: Gebäude mit Projektliste (leer / mit Ordnern), „VS Code öffnen“ führt über das Dorf zur Code-Adresse, Aktionen über den Motor coding', async ({ page, request }) => {
  await request.post(`${CODING}/_test/projekte`, { data: [] });
  await anmelden(page);
  await expect(page.locator('.gebaeude-karte', { hasText: 'Codehaus' }).first()).toBeVisible();
  await page.goto('/gebaeude/Codehaus');
  await expect(page.getByRole('heading', { name: /Codehaus/ })).toBeVisible();
  // Standard-Reiter: Projekte & VS Code
  await expect(page.getByRole('button', { name: 'Projekte & VS Code' })).toHaveClass(/aktiv/);
  await expect(page.getByTestId('projekte-leer')).toContainText('Noch keine Projekte');

  // Projekte erscheinen (Namen vom Runner im Coding-Container)
  await request.post(`${CODING}/_test/projekte`, {
    data: [
      { name: 'agentendorf', git: true, geaendert: Date.now() },
      { name: 'spielwiese', git: false, geaendert: Date.now() - 86_400_000 },
    ],
  });
  await page.reload();
  const liste = page.getByTestId('projekte');
  await expect(liste.locator('li')).toHaveCount(2);
  await expect(liste.locator('li').first()).toContainText('agentendorf');
  await expect(liste.locator('li').first().locator('.abzeichen')).toHaveText('git');
  await expect(liste.locator('li').nth(1).locator('.abzeichen')).toHaveCount(0);

  // „VS Code öffnen“: neuer Tab, über das Dorf (Einmal-Karte) zur konfigurierten Code-Adresse
  const knopf = page.getByTestId('vscode-oeffnen');
  const [tab] = await Promise.all([page.context().waitForEvent('page'), knopf.click()]);
  // der Tab öffnet sofort (Popup-Schutz) und bekommt dann die Einmal-Adresse
  await tab.waitForURL((u) => u.href !== 'about:blank');
  await tab.waitForLoadState();
  expect(tab.url().startsWith(`${CODING}/_dorf/eintritt?karte=`)).toBe(true);
  expect(new URL(tab.url()).searchParams.get('karte')!.length).toBeGreaterThanOrEqual(40);
  await expect(tab.getByRole('heading', { name: 'VS Code (Attrappe)' })).toBeVisible();
  // die Adresse im neuen Tab verrät weder das VS-Code-Token noch die Sitzung
  expect(tab.url()).not.toContain('e2e-vscode-token');
  await tab.close();

  // ein Projekt direkt öffnen: der Ordner reist mit
  const [tab2] = await Promise.all([page.context().waitForEvent('page'), liste.locator('li').first().getByRole('button', { name: 'in VS Code öffnen' }).click()]);
  await tab2.waitForURL((u) => u.searchParams.get('projekt') === 'agentendorf');
  expect(new URL(tab2.url()).searchParams.get('projekt')).toBe('agentendorf');
  await expect(tab2.locator('#projekt')).toHaveText('agentendorf');
  await tab2.close();

  // Aktionen des Gebäudes: Programmieren läuft über den Motor coding (Attrappe) und bekommt das Projekt
  await page.getByRole('button', { name: 'Aktionen', exact: true }).click();
  await expect(page.getByRole('button', { name: /Repository holen/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pull Request prüfen/ })).toBeVisible();
  await page.getByRole('button', { name: /Programmieren/ }).click();
  await page.getByLabel(/Projektordner/).fill('agentendorf');
  await page.getByLabel(/Was soll gebaut/).fill('Eine Hallo-Welt-Seite.');
  await page.getByRole('button', { name: /Starten/ }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(/\(coding, .*Projekt: agentendorf\)/).first()).toBeVisible();

  // zurück im Gebäude: der Lauf steht unter „Coding-Agenten“
  await page.goto('/gebaeude/Codehaus');
  await expect(page.locator('.codehaus .chatliste').last().locator('li').first()).toContainText('Programmieren');
});

test('Codehaus: ohne Anmeldung gibt es weder Projektliste noch Karte', async ({ request }) => {
  expect((await request.get('/api/coding')).status()).toBe(401);
  expect((await request.get('/api/coding/oeffnen', { maxRedirects: 0 })).status()).toBe(401);
});

test('Codehaus im 3D-Dorf: eigenes Modell steht auf seinem Platz, Antippen zeigt „Projekte & VS Code“', async ({ page }) => {
  test.setTimeout(180_000); // Software-Grafik
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible({ timeout: 20_000 });
  type Dorf = {
    bildschirmPunkt(art: string, id?: string): { x: number; y: number } | null;
    layoutStand(): { gebaeude: Record<string, { x: number; z: number }> } | null;
    blickAuf(x: number, z: number, abstand?: number): void;
    treffer(e: { clientX: number; clientY: number }): { art: string; id?: string } | null;
  };
  const dorf = () => (window as unknown as { __dorf?: Dorf }).__dorf;
  await page.waitForFunction(() => !!(window as unknown as { __dorf?: Dorf }).__dorf?.bildschirmPunkt('gebaeude', 'Codehaus'), null, { timeout: 30_000 });
  void dorf;
  // der Dorfplan hat dem neuen Gebäude einen Platz gegeben
  const platz = await page.evaluate(() => (window as unknown as { __dorf: Dorf }).__dorf.layoutStand()!.gebaeude.Codehaus);
  expect(platz).toBeTruthy();
  await page.evaluate(([x, z]) => (window as unknown as { __dorf: Dorf }).__dorf.blickAuf(x + 2, z + 2, 16), [platz!.x, platz!.z] as const);
  await page.waitForTimeout(500);
  const pt = (await page.evaluate(() => (window as unknown as { __dorf: Dorf }).__dorf.bildschirmPunkt('gebaeude', 'Codehaus')))!;
  // an dieser Stelle steht wirklich das Gebäude (ein Modell mit Fläche, kein leerer Platz)
  expect(await page.evaluate((p) => (window as unknown as { __dorf: Dorf }).__dorf.treffer({ clientX: p.x, clientY: p.y }), pt)).toMatchObject({ art: 'gebaeude', id: 'Codehaus' });
  await page.mouse.click(pt.x, pt.y);
  const knoepfe = page.getByRole('group', { name: 'Gebäude Codehaus' });
  await expect(knoepfe).toBeVisible();
  await knoepfe.getByRole('button', { name: 'Projekte & VS Code' }).click();
  await expect(page).toHaveURL(/\?g=Codehaus&reiter=code/);
  await expect(page.getByRole('complementary', { name: /Gebäude Codehaus/ }).getByTestId('vscode-oeffnen')).toBeVisible();
  expect(fehler).toEqual([]);
});
