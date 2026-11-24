import { expect, test } from '@playwright/test';

/** E224: Einstellungen → Aussehen – Vorschau sofort, Verwerfen, Speichern gilt nach Neuladen, Farben/Stile als Attribute */
test('Aussehen: Vorlage, Vorschau, Verwerfen, Speichern, eigene Farbe und Stile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht (der e2e-Server ist für beide Projekte derselbe)');
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
  const html = page.locator('html');
  try {
    await page.goto('/einstellungen');
    const vorlagen = page.getByRole('region', { name: 'Vorlagen' });
    await vorlagen.getByRole('button', { name: 'Nacht', exact: true }).click();
    await expect(html).toHaveAttribute('data-dunkel', 'ja');
    await page.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(html).toHaveAttribute('data-dunkel', 'nein');
    // Vorlage + Stil + Größe, dann speichern
    await vorlagen.getByRole('button', { name: 'Nacht', exact: true }).click();
    await page.getByRole('group', { name: 'Knöpfe' }).getByRole('button', { name: 'Pille' }).click();
    await page.getByRole('group', { name: 'Abstände' }).getByRole('button', { name: 'Kompakt' }).click();
    await page.getByRole('slider', { name: 'Größe' }).fill('18');
    await expect(html).toHaveAttribute('data-knoepfe', 'pille');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Gespeichert – gilt jetzt auf allen Geräten.')).toBeVisible();
    await page.goto('/gebaeude/Marktplatz');
    await expect(html).toHaveAttribute('data-dunkel', 'ja');
    await expect(html).toHaveAttribute('data-dichte', 'kompakt');
    expect(await html.evaluate((e) => getComputedStyle(e).fontSize)).toBe('18px');
    // nach Neuladen sofort da (aus dem Gerät, bevor der Server antwortet)
    await page.reload();
    await expect(html).toHaveAttribute('data-knoepfe', 'pille');
    // eigene Akzentfarbe
    await page.goto('/einstellungen');
    await page.getByRole('button', { name: 'Akzent #e34948' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect.poll(() => html.evaluate((e) => e.style.getPropertyValue('--gruen'))).toBe('#e34948');
  } finally {
    await page.request.put('/api/aussehen', { headers: { origin: 'http://127.0.0.1:3999' }, data: {} });
    await page.evaluate(() => localStorage.removeItem('dorf-aussehen'));
  }
});
