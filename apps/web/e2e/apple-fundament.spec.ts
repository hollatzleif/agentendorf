import { expect, test, type Page } from '@playwright/test';
import { appleAn } from './apple-hilfe';

/** E240 – Apple-Oberfläche, Fundament: Umschalten, Schale (Tab-Leiste/Seitenleiste), Sheet, Spotlight, Dunkel, Dorf unverändert */
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 3999}`;
const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

const stil = (page: Page, sel: string, eig: string) => page.locator(sel).first().evaluate((e, k) => getComputedStyle(e).getPropertyValue(k), eig);
const keinUeberlauf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('Apple: Umschalten in den Einstellungen wirkt sofort, bleibt nach Neuladen, zurück ist das Dorf wie vorher', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht (gemeinsamer Server)');
  await anmelden(page);
  const html = page.locator('html');
  try {
    await page.goto('/einstellungen');
    await expect(html).toHaveAttribute('data-design', 'dorf');
    const dorf = { grund: await stil(page, 'body', 'background-image'), schrift: await stil(page, 'body', 'font-family'), kopf: await stil(page, '.kopf', 'background-image') };
    await expect(page.locator('.kopf')).toBeVisible();

    // einschalten – sofort, ohne „Speichern“
    await page.getByRole('group', { name: 'Oberfläche' }).getByRole('button', { name: 'Apple' }).click();
    await expect(html).toHaveAttribute('data-design', 'apple');
    expect(await stil(page, 'body', 'background-color')).toBe('rgb(242, 242, 247)');
    expect(await stil(page, 'body', 'font-family')).toContain('-apple-system');
    await expect(page.getByRole('complementary', { name: 'Seitenleiste' })).toBeVisible();
    await expect(page.locator('.kopf')).toHaveCount(0);
    // Einstellungen als Inset-Grouped-Liste, Bereich daneben
    await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
    await expect(page.locator('.a-gruppe .a-zelle', { hasText: 'Anschlüsse' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Oberfläche' }).getByRole('button', { name: 'Apple' })).toHaveAttribute('aria-pressed', 'true');
    // die Stil-Optionen des Dorf-Designs sind ausgeblendet
    await expect(page.getByRole('region', { name: 'Vorlagen' })).toHaveCount(0);
    await expect(page.getByText('gelten nur im Dorf-Design')).toBeVisible();

    // bleibt nach Neuladen (sofort aus dem Gerät, dann vom Server)
    await page.reload();
    await expect(html).toHaveAttribute('data-design', 'apple');
    await page.goto('/heute');
    await expect(html).toHaveAttribute('data-design', 'apple');
    expect(await keinUeberlauf(page)).toBe(true);

    // zurück zum Dorf: alles wie vorher
    await page.goto('/einstellungen?bereich=aussehen');
    await page.getByRole('group', { name: 'Oberfläche' }).getByRole('button', { name: 'Dorf' }).click();
    await expect(html).toHaveAttribute('data-design', 'dorf');
    await expect(page.locator('.kopf')).toBeVisible();
    expect(await stil(page, 'body', 'background-image')).toBe(dorf.grund);
    expect(await stil(page, 'body', 'font-family')).toBe(dorf.schrift);
    expect(await stil(page, '.kopf', 'background-image')).toBe(dorf.kopf);
    await page.reload();
    await expect(html).toHaveAttribute('data-design', 'dorf');
    await expect(page.getByRole('region', { name: 'Vorlagen' })).toBeVisible();
  } finally {
    await page.request.put('/api/aussehen', { headers: { origin: ORIGIN }, data: {} });
    await page.evaluate(() => localStorage.removeItem('dorf-aussehen'));
  }
});

test('Apple Handy: Tab-Leiste unten, „Mehr“ als Sheet, Einstellungen Liste → Bereich', async ({ page }, info) => {
  test.skip(info.project.name !== 'handy', 'nur am Handy');
  await appleAn(page);
  await anmelden(page);
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Seitenleiste' })).toBeHidden();
  const vp = page.viewportSize()!;
  const kasten = (await tabs.boundingBox())!;
  expect(kasten.y + kasten.height).toBeGreaterThan(vp.height - 40);
  expect(await stil(page, '.a-tableiste', 'backdrop-filter')).toContain('blur');
  // Symbole statt Emoji in der Tab-Leiste
  await expect(tabs.locator('svg.a-symbol')).toHaveCount(5);

  await tabs.getByRole('link', { name: 'Heute' }).click();
  await expect(page).toHaveURL(/\/heute$/);
  await expect(tabs.getByRole('link', { name: 'Heute' })).toHaveAttribute('aria-current', 'page');
  expect(await keinUeberlauf(page)).toBe(true);

  // Mehr → Sheet von unten
  await tabs.getByRole('button', { name: 'Mehr' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mehr' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  const s = (await sheet.boundingBox())!;
  expect(Math.round(s.y + s.height)).toBeGreaterThanOrEqual(vp.height - 2);
  expect(s.width).toBeGreaterThan(vp.width - 2);
  await sheet.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(page).toHaveURL(/\/einstellungen$/);
  await expect(sheet).toHaveCount(0);

  // Liste → Bereich → zurück
  await page.locator('.a-zelle', { hasText: 'Aussehen' }).click();
  await expect(page.getByRole('heading', { name: 'Aussehen', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Oberfläche' })).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(page.locator('.a-zelle', { hasText: 'Passwort' })).toBeVisible();
  expect(await keinUeberlauf(page)).toBe(true);
});

test('Apple Desktop dunkel: Seitenleiste, Spotlight-Suche, Sheet, Knöpfe und Schalter', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'nur am Desktop');
  await appleAn(page, { dunkel: true });
  await anmelden(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-design', 'apple');
  await expect(html).toHaveAttribute('data-dunkel', 'ja');
  expect(await stil(page, 'body', 'background-color')).toBe('rgb(0, 0, 0)');
  expect(await stil(page, 'body', 'color')).toBe('rgb(255, 255, 255)');
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden();

  const leiste = page.getByRole('complementary', { name: 'Seitenleiste' });
  await expect(leiste.getByRole('link', { name: 'Rathaus' })).toBeVisible();
  await leiste.getByRole('link', { name: 'Rathaus' }).click();
  await expect(page).toHaveURL(/\/gebaeude\/Rathaus$/);
  await expect(leiste.getByRole('link', { name: 'Rathaus' })).toHaveAttribute('aria-current', 'page');

  // Kopfleiste: Scroll-Kante erst beim Scrollen
  await expect(page.locator('.a-kopfleiste')).not.toHaveClass(/gescrollt/);

  // Spotlight: Glas-Feld mit Lupe, Treffer mit Symbolen
  await page.getByRole('button', { name: 'Suchen', exact: true }).first().click();
  const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
  await expect(palette).toBeVisible();
  await expect(palette.locator('.palette-suche svg.a-symbol')).toBeVisible();
  await page.getByLabel('Befehl oder Suche').fill('Einstellungen');
  await expect(palette.getByRole('option').first()).toContainText('Einstellungen');
  await expect(palette.getByRole('option').first().locator('svg.a-symbol')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // Sheet (Fenster) in der Mitte mit großem Radius und Scrim
  await page.goto('/heute');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('?');
  const hilfe = page.getByRole('dialog', { name: 'Tastenkürzel' });
  await expect(hilfe).toBeVisible();
  expect(await stil(page, '.tasten-hilfe', 'border-radius')).toBe('28px');
  expect(await stil(page, '.fenster-hintergrund', 'background-color')).toBe('rgba(0, 0, 0, 0.5)');
  await page.keyboard.press('Escape');

  // Knöpfe als Kapsel, Hauptknopf blau; Schalter als iOS-Switch
  await page.goto('/einstellungen?bereich=aussehen');
  const knopf = page.getByRole('group', { name: 'Oberfläche' }).getByRole('button', { name: 'Apple' });
  await expect(knopf).toHaveAttribute('aria-pressed', 'true');
  const schalter = page.getByRole('switch');
  await expect(schalter).toBeVisible();
  expect(await schalter.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(51);
  expect(await keinUeberlauf(page)).toBe(true);
});
