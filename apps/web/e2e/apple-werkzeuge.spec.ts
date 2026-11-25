import { expect, test, type Page } from '@playwright/test';
import { appleAn } from './apple-hilfe';

/**
 * E240 – Apple-Oberfläche, Bereich „Werkzeuge“: Overlays über dem 3D-Dorf (Glas-Kapseln, Sheet, Popover, Benachrichtigungen,
 * Bau-Leiste), Atelier (Glas-Palette, Inspector), Codehaus-Editor (Monaco-Themen apple-hell/-dunkel, Xcode-Navigator),
 * VS-Code-Seite mit Erweiterungen, Schriftprobe. Das Dorf-Design bleibt, wie es war (Emojis statt Symbole).
 */
const PW = 'e2e-Passwort-sehr-lang-1';
const CODING = `http://127.0.0.1:${process.env.E2E_CODING_PORT ?? Number(process.env.E2E_MOODLE_PORT ?? 3998) - 2}`;
test.describe.configure({ timeout: 180_000, retries: process.env.CI ? 1 : 0 });

interface DorfTestKurz {
  bildschirmPunkt(art: string, id?: string): { x: number; y: number } | null;
}

async function imDorf(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { __dorf?: DorfTestKurz }).__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 20_000 });
}

async function anmelden(page: Page) {
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

const stil = (page: Page, sel: string, eig: string) => page.locator(sel).first().evaluate((el, e) => getComputedStyle(el).getPropertyValue(e), eig);
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const keinUeberlauf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Farbe als „rgb(…)“, so wie getComputedStyle sie liefert */
const rgb = (page: Page, farbe: string) =>
  page.evaluate((f) => {
    const d = document.createElement('div');
    d.style.color = f;
    document.body.append(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  }, farbe);

test('Apple – Dorf: Glas-Kapseln mit Symbolen, Gebäude-Knöpfe, Sheet/Panel, Agenten-Popover, Bau-Leiste als Glas-Werkzeugleiste', async ({ page, isMobile }) => {
  await appleAn(page);
  await imDorf(page);
  await expect(page.locator('html')).toHaveAttribute('data-design', 'apple');

  // Kapseln am Rand: Glas (Unschärfe), ganz rund, Symbole statt Emojis
  const oben = page.locator('.dorf-werkzeuge.oben-rechts');
  expect(await stil(page, '.dorf-werkzeuge.oben-rechts', 'backdrop-filter')).toContain('blur');
  expect(parseFloat(await stil(page, '.dorf-werkzeuge.oben-rechts', 'border-top-left-radius'))).toBeGreaterThan(20);
  await expect(page.getByRole('button', { name: 'Agenten' }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Zum Rathaus' }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(oben).not.toContainText('🤖');
  const kh = await page.getByRole('button', { name: 'Zum Rathaus' }).boundingBox();
  expect(kh!.height).toBeGreaterThanOrEqual(44); // Mindest-Trefferfläche
  expect(await stil(page, '.dorf-buehne', 'font-family')).toContain('system-ui');

  // Gebäude antippen: Namensschild + runde Knöpfe in Systemfarben mit Symbolen
  const pt = (await page.evaluate(() => (window as unknown as { __dorf: DorfTestKurz }).__dorf.bildschirmPunkt('gebaeude', 'Uni')))!;
  await page.mouse.click(pt.x, pt.y);
  const knoepfe = page.getByRole('group', { name: 'Gebäude Uni' });
  await expect(knoepfe).toBeVisible();
  const studium = knoepfe.getByRole('button', { name: 'Studium' });
  await expect(studium.locator('svg.a-symbol')).toHaveCount(1);
  expect(await studium.locator('.spiel-kreis').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await rgb(page, await token(page, '--a-lila')));
  // auch Reiter ohne eigenen Spielknopf haben ein Symbol (kein „•“)
  await expect(knoepfe.getByRole('button', { name: 'Prüfungen' }).locator('svg.a-symbol')).toHaveCount(1);
  expect(await stil(page, '.spiel-knoepfe', 'backdrop-filter')).toContain('blur');

  // Gebäude-Menü: am Handy Sheet von unten (Griff, unten bündig), am PC schwebendes Panel – beide mit großem Radius
  await knoepfe.getByRole('button', { name: 'Info' }).click();
  const menue = page.getByRole('complementary', { name: /Gebäude Uni/ });
  await expect(menue).toBeVisible();
  await expect(menue.getByRole('heading', { name: /Uni – Arbeitsanweisung/ })).toBeVisible();
  expect(parseFloat(await stil(page, '.dorf-panel', 'border-top-left-radius'))).toBeGreaterThanOrEqual(24);
  const vp = page.viewportSize()!;
  // das Sheet gleitet mit einer Feder herein – auf den Endstand warten
  if (isMobile) await expect.poll(async () => { const b = (await menue.boundingBox())!; return Math.round(b.y + b.height); }).toBe(Math.round(vp.height));
  await page.waitForTimeout(500);
  const box = (await menue.boundingBox())!;
  if (isMobile) {
    expect(await page.locator('.dorf-panel-kopf').evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none');
  } else {
    expect(box.x).toBeGreaterThan(4);
    expect(parseFloat(await stil(page, '.dorf-panel', 'border-bottom-left-radius'))).toBeGreaterThanOrEqual(24);
  }
  await expect(menue.getByRole('button', { name: 'Menü schließen' }).locator('svg.a-symbol')).toHaveCount(1);
  await menue.getByRole('button', { name: 'Menü schließen' }).click();
  await knoepfe.getByRole('button', { name: 'Auswahl aufheben' }).click();

  // Agenten: Glas-Popover oben rechts, wächst aus der Ecke
  await page.getByRole('button', { name: 'Agenten' }).click();
  const karte = page.getByRole('dialog', { name: 'Laufende Agenten' });
  await expect(karte).toBeVisible();
  expect(await stil(page, '.dorf-agentenkarte', 'backdrop-filter')).toContain('blur');
  expect(await stil(page, '.dorf-agentenkarte', 'transform-origin')).toMatch(/px 0px$/);
  await karte.getByRole('button', { name: 'Schließen' }).click();

  // Bau-Modus: Werkzeuge als Segmente mit Symbolen, die Leiste ist Glas
  await page.getByRole('button', { name: 'Bauen' }).click();
  const leiste = page.getByRole('toolbar', { name: 'Bau-Werkzeuge' });
  await expect(leiste).toBeVisible();
  expect(await stil(page, '.bau-leiste', 'backdrop-filter')).toContain('blur');
  await expect(leiste.getByRole('button', { name: /Straße/ }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(leiste.getByRole('button', { name: /Auswählen/ })).toHaveClass(/aktiv/);
  await page.getByRole('button', { name: 'Bau-Modus beenden' }).click();
  expect(await keinUeberlauf(page)).toBe(true);
});

test('Apple dunkel – Dorf: Benachrichtigung im Ticker und „Neu im Dorf“ im iOS-Stil', async ({ page }) => {
  await appleAn(page, { dunkel: true });
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await imDorf(page);
  await expect(page.locator('html')).toHaveAttribute('data-dunkel', 'ja');
  const neu = page.getByRole('region', { name: 'Neu im Dorf' });
  await expect(neu).toBeVisible();
  await expect(neu.locator('.neu-symbol svg.a-symbol').first()).toBeVisible();
  expect(await stil(page, '.dorf-neuigkeiten', 'backdrop-filter')).toContain('blur');
  await neu.getByRole('button', { name: 'Alles klar' }).click();

  // ein Agent startet → Meldung als Glas-Benachrichtigung mit Symbol im getönten Quadrat
  const origin = new URL(page.url()).origin;
  const r = await page.request.post('/api/aktionen/starten', { headers: { origin }, data: { id: 'Bibliothek/notizen-zusammenfassen', eingaben: { thema: 'Benachrichtigung [warte 60000]' } } });
  const { laufId } = (await r.json()) as { laufId: string };
  const ticker = page.getByRole('list', { name: 'Was im Dorf passiert' });
  await expect(ticker.getByText(/Agent geht zur Bibliothek/)).toBeVisible({ timeout: 15_000 });
  await expect(ticker.locator('.ticker-symbol svg.a-symbol').first()).toBeVisible();
  expect(await stil(page, '.dorf-ticker button', 'backdrop-filter')).toContain('blur');
  expect(parseFloat(await stil(page, '.dorf-ticker button', 'border-top-left-radius'))).toBeGreaterThanOrEqual(16);
  await page.request.post(`/api/laeufe/${laufId}/abbrechen`, { headers: { origin } });
});

test('Dorf-Design bleibt: Emojis an den Knöpfen, keine Symbole', async ({ page }) => {
  await imDorf(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-design', 'apple');
  await expect(page.getByRole('button', { name: 'Agenten' })).toContainText('🤖');
  await expect(page.locator('.dorf-werkzeuge svg.a-symbol')).toHaveCount(0);
});

test('Apple – Atelier: Glas-Werkzeugpalette mit Symbolen, Inspector, Menü als Popover, Fenster als Sheet', async ({ page }, info) => {
  await appleAn(page);
  await anmelden(page);
  await page.goto('/atelier');
  await expect(page.getByTestId('at-leinwand')).toBeVisible();
  const palette = page.getByRole('toolbar', { name: 'Werkzeuge' });
  await expect(palette.locator('button[data-werkzeug="pinsel"] svg.a-symbol')).toHaveCount(1);
  await expect(palette.locator('button[data-werkzeug="text"] svg.a-symbol')).toHaveCount(1);
  await expect(palette).not.toContainText('🖌');
  expect(await stil(page, '.at-werkzeuge', 'backdrop-filter')).toContain('blur');
  // aktives Werkzeug: Tint-Farbe
  await palette.locator('button[data-werkzeug="pinsel"]').click();
  expect(await palette.locator('button[data-werkzeug="pinsel"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await rgb(page, await token(page, '--a-blau')));

  // Menü: Glas-Popover
  await page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Filter' })).toBeVisible();
  expect(await stil(page, '.at-menue-liste', 'backdrop-filter')).toContain('blur');
  await page.getByRole('menu', { name: 'Filter' }).getByRole('menuitem', { name: /Gaußscher Weichzeichner/ }).click();
  const fenster = page.getByRole('dialog', { name: 'Gaußscher Weichzeichner' });
  await expect(fenster).toBeVisible();
  await expect(fenster.getByRole('button', { name: 'Schließen' }).locator('svg.a-symbol')).toHaveCount(1);
  await fenster.getByRole('button', { name: 'Abbrechen' }).click();

  // Inspector (am Handy aufklappen): Ebenen mit Augen-Symbol
  if (info.project.name === 'handy') await page.getByRole('button', { name: 'Ebenen, Farbe, Verlauf' }).click();
  const ebenen = page.getByTestId('ebenen');
  await expect(ebenen.getByRole('button', { name: 'Neue Ebene' }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(ebenen.locator('.at-auge svg.a-symbol').first()).toBeVisible();
  expect(parseFloat(await stil(page, '.at-feld', 'border-top-left-radius'))).toBeGreaterThanOrEqual(10);
  expect(await keinUeberlauf(page)).toBe(true);
});

test('Apple dunkel – Codehaus-Editor: Monaco-Thema apple-dunkel, Navigator mit Symbolen, Terminal in passenden Farben', async ({ page }) => {
  await appleAn(page, { dunkel: true });
  await page.request.post(`${CODING}/_test/projekte`, { data: [{ name: 'spielwiese', git: true, geaendert: Date.now() }] });
  await anmelden(page);
  await page.evaluate(() => localStorage.removeItem('dorf-editor-thema'));
  await page.goto('/codehaus/editor?projekt=spielwiese');
  await expect(page.getByTestId('codeeditor')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('codeeditor')).toHaveClass(/dunkel/);
  const bereiche = page.getByRole('navigation', { name: 'Bereiche' });
  await expect(bereiche.getByRole('button', { name: 'Dateien', exact: true }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(bereiche).not.toContainText('📁');
  // Monaco: eigener Hintergrund des Themas apple-dunkel (nicht dorf-dunkel)
  const editorGrund = () => stil(page, '.ce-editor .monaco-editor', '--vscode-editor-background').then((v) => v.trim().toLowerCase());
  await expect.poll(editorGrund, { timeout: 15_000 }).toBe('#1e1e22');
  // Thema umschalten → apple-hell (weiß)
  await page.getByTestId('thema').click();
  await expect.poll(editorGrund).toBe('#ffffff');
  await page.getByTestId('thema').click();
  // Terminal: xterm mit dem Hintergrund des Themas
  await page.getByTestId('terminal-knopf').click();
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-zustand', 'bereit', { timeout: 20_000 });
  // xterm färbt je nach Version Viewport, Bildschirm oder Rollbereich – irgendeins davon trägt den Hintergrund des Themas
  await expect
    .poll(() => page.locator('.ce-terminal-kasten').first().evaluate((k) => [k, ...k.querySelectorAll('*')].map((el) => getComputedStyle(el).backgroundColor)))
    .toContain('rgb(30, 30, 34)');
  expect(await keinUeberlauf(page)).toBe(true);
});

test('Apple – VS-Code-Seite, Erweiterungen und Schriftprobe', async ({ page }) => {
  await appleAn(page);
  await anmelden(page);
  await page.goto('/codehaus/vscode');
  await expect(page.getByTestId('vscode-seite')).toBeVisible();
  expect(await stil(page, '.vs-kopf', 'backdrop-filter')).toContain('blur');
  await page.getByTestId('erweiterungen-knopf').click();
  await expect(page.getByTestId('erweiterungen-knopf').locator('svg.a-symbol')).toHaveCount(1);
  const panel = page.getByRole('complementary', { name: 'Erweiterungen' });
  await expect(panel.getByRole('button', { name: 'Erweiterungen schließen' }).locator('svg.a-symbol')).toHaveCount(1);
  await expect(panel.locator('.erw-warnung svg.a-symbol')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Erweiterungen schließen' }).click();

  await page.goto('/schriftprobe');
  await expect(page.getByTestId('sp-leinwand')).toBeVisible();
  expect(parseFloat(await stil(page, '.sp-leinwand', 'border-top-left-radius'))).toBeGreaterThanOrEqual(16);
  expect(await stil(page, '.sp-leinwand', 'border-top-width')).toBe('0px');
  await expect(page.getByRole('button', { name: /Strich zurück/ }).locator('svg.a-symbol')).toHaveCount(1);
  expect(await stil(page, '.sp-schreiben .knopfreihe', 'backdrop-filter')).toContain('blur');
  expect(await keinUeberlauf(page)).toBe(true);
});
