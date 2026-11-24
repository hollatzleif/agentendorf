import { expect, test, type Page } from '@playwright/test';

/** E230: Paketwerk – Konsole für pip im eigenen Container. API nachgebaut. */
async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

async function nachbauen(page: Page) {
  const starts: unknown[] = [];
  let abrufe = 0;
  await page.route('**/api/paketwerk**', async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/api/paketwerk') return r.fulfill({ json: { eingerichtet: true, pakete: [{ name: 'scikit-learn', version: '1.9.1' }] } });
    if (url.pathname === '/api/paketwerk/start') {
      starts.push(r.request().postDataJSON());
      return r.fulfill({ json: { id: 'j1' } });
    }
    if (url.pathname === '/api/paketwerk/stand') {
      abrufe++;
      if (abrufe === 1) return r.fulfill({ json: { ausgabe: 'Collecting scikit-learn==1.9.1\n', bis: 31, fertig: false, code: null, sekunden: 1 } });
      expect(url.searchParams.get('ab')).toBe('31');
      return r.fulfill({ json: { ausgabe: 'Successfully installed scikit-learn-1.9.1\n', bis: 72, fertig: true, code: 0, sekunden: 2 } });
    }
    return r.fulfill({ json: { ok: true } });
  });
  return starts;
}

test('Paketwerk: Vorschlag wird nicht ausgeführt, Ausführen streamt Ausgabe, Entfernen füllt die Zeile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'ausführlich am Desktop');
  const starts = await nachbauen(page);
  await anmelden(page);
  await page.goto('/paketwerk?befehl=' + encodeURIComponent('pip install scikit-learn==1.9.1'));
  await expect(page.getByRole('heading', { name: /Paketwerk/ })).toBeVisible();
  const zeile = page.getByLabel('Befehl');
  await expect(zeile).toHaveValue('pip install scikit-learn==1.9.1');
  await expect(page.getByText('Vom Agenten vorgeschlagen')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(starts).toHaveLength(0);

  await page.getByRole('button', { name: 'Ausführen' }).click();
  await expect.poll(() => starts).toEqual([{ befehl: 'pip install scikit-learn==1.9.1' }]);
  const ausgabe = page.getByLabel('Ausgabe');
  await expect(ausgabe).toContainText('Collecting scikit-learn');
  await expect(ausgabe).toContainText('Successfully installed');
  await expect(page.locator('.pw-status')).toContainText('fertig mit Code 0');
  await expect(page.getByText('Vom Agenten vorgeschlagen')).toHaveCount(0);

  const liste = page.getByRole('list', { name: 'Installierte Pakete' });
  await expect(liste).toContainText('scikit-learn==1.9.1');
  await liste.getByRole('button', { name: 'Entfernen' }).click();
  await expect(zeile).toHaveValue('pip uninstall -y scikit-learn');
  await page.waitForTimeout(800);
  expect(starts).toHaveLength(1);

  // Verlauf mit Pfeil hoch
  await zeile.fill('');
  await zeile.press('ArrowUp');
  await expect(zeile).toHaveValue('pip install scikit-learn==1.9.1');
});

test('Paketwerk: schmal ohne Überlauf, Hinweis ohne Einrichtung', async ({ page }) => {
  await page.route('**/api/paketwerk**', (r) => r.fulfill({ json: { eingerichtet: false, pakete: [], fehler: 'Container nicht erreichbar' } }));
  await anmelden(page);
  await page.goto('/paketwerk');
  await expect(page.getByText('Das Paketwerk kommt mit dem nächsten Deploy')).toBeVisible();
  await expect(page.getByText('Container nicht erreichbar')).toBeVisible();
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(breit).toBeLessThanOrEqual(1);
});
