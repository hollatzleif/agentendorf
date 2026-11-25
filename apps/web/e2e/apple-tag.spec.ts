// E240, Bereich B „Tagesgeschäft“: Apple-Oberfläche auf Heute, To-do-Brett, Kalender, Kirchturm, Fokus, Statistik,
// Woche planen, Tag abschließen, Schreibtisch. Prüft Kern-Merkmale (Systemschrift, Grund, kein Überlauf, runde Abhak-Kreise,
// Bearbeiten als Sheet, Symbole statt Emoji) – und dass das Dorf-Design daneben unverändert bleibt.
// Mit APPLE_FOTOS=<Ordner> entstehen zusätzlich Bildschirmfotos (Sichtprüfung).
import { expect, test, type Page } from '@playwright/test';
import { appleAn } from './apple-hilfe';

const PW = 'e2e-Passwort-sehr-lang-1';
const FOTOS = process.env.APPLE_FOTOS;

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand').or(page.getByRole('heading', { name: 'Dorfplatz' }))).toBeVisible();
}

/** Beispieldaten über die echte API (gleicher Ursprung, Sitzungs-Cookie) */
const angelegt: string[] = [];
test.afterEach(async ({ page }) => {
  while (angelegt.length) await aufraeumen(page, angelegt.pop()!).catch(() => undefined);
});

async function daten(page: Page, kennung: string) {
  angelegt.push(kennung);
  await page.evaluate(async (k) => {
    const tag = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/todos', { titel: `Steuererklärung abschicken ${k}`, faellig: tag(-2) });
    await post('/api/todos', { titel: `Blatt 7 rechnen ${k}`, faellig: tag(0), dauer: 90, gruppe: `Bachelorarbeit ${k}` });
    await post('/api/todos', { titel: `Milch kaufen ${k}`, faellig: tag(0) });
    await post('/api/todos', { titel: `Zimmer aufräumen ${k}`, faellig: tag(1), gruppe: `Bachelorarbeit ${k}` });
    await post('/api/todos', { titel: `Buch zurückgeben ${k}`, faellig: tag(4), gruppe: `Bachelorarbeit ${k}` });
    await post('/api/todos', { titel: `Ideen sammeln ${k}` });
    await post('/api/gewohnheiten', { name: `Lesen ${k}`, symbol: '📖', tage: 'täglich' });
    await post('/api/gewohnheiten', { name: `Sport ${k}`, symbol: '🏃', tage: 'täglich' });
    await post('/api/wochenziele', { text: `Blatt 7 abgeben ${k}` });
    await post('/api/notiz', { text: `Gedanke für später ${k}` });
  }, kennung);
}

/** Beispieldaten wieder abräumen – die Dorf-Tests teilen sich denselben Testserver (sonst gibt es dort doppelte To-dos/Wochenziele) */
async function aufraeumen(page: Page, kennung: string) {
  await page.evaluate(async (k) => {
    const ende = (t: string) => t.endsWith(` ${k}`);
    const todos = (await (await fetch('/api/todos?alle=1')).json()) as { pfad: string; titel: string; gruppe?: string }[];
    for (const t of todos) if (ende(t.titel)) await fetch(`/api/todos?pfad=${encodeURIComponent(t.pfad)}`, { method: 'DELETE' });
    const w = (await (await fetch('/api/wochenziele')).json()) as { ziele: { text: string }[] };
    for (let i = w.ziele.length - 1; i >= 0; i--) if (ende(w.ziele[i]!.text)) await fetch(`/api/wochenziele?nr=${i}&text=${encodeURIComponent(w.ziele[i]!.text)}`, { method: 'DELETE' });
    for (const n of ['Lesen', 'Sport']) await fetch(`/api/gewohnheiten?name=${encodeURIComponent(`${n} ${k}`)}`, { method: 'DELETE' });
  }, kennung);
}

async function keinUeberlauf(page: Page) {
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(breit, `Überlauf auf ${page.url()}`).toBeLessThanOrEqual(1);
}

async function foto(page: Page, name: string, projekt: string) {
  if (!FOTOS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${FOTOS}/${name}-${projekt}.png`, fullPage: projekt === 'desktop' });
}

test('Apple: Heute – Large Title, Karten, runde Abhak-Kreise, Symbole', async ({ page }, info) => {
  await appleAn(page);
  await anmelden(page);
  await daten(page, info.project.name);
  await page.goto('/heute');
  const heute = page.getByRole('region', { name: 'Mein Tag' });
  await expect(page.locator('.heute-gruss')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-design', 'apple');
  // Systemschrift und Grund aus den Tokens
  const s = await page.evaluate(() => {
    const titel = getComputedStyle(document.querySelector('.heute-gruss')!);
    const body = getComputedStyle(document.body);
    const grund = getComputedStyle(document.documentElement).getPropertyValue('--a-grund').trim();
    return { schrift: titel.fontFamily, groesse: parseFloat(titel.fontSize), gewicht: titel.fontWeight, grund, body: body.backgroundColor };
  });
  expect(s.schrift).toMatch(/-apple-system|system-ui/);
  expect(s.groesse).toBeGreaterThanOrEqual(27);
  expect(s.gewicht).toBe('700');
  // To-do-Karte: Fläche ohne Rahmen, großer Radius
  const karte = await page.locator('.heute-todos-karte').evaluate((e) => {
    const c = getComputedStyle(e);
    return { rand: c.borderTopWidth, radius: parseFloat(c.borderTopLeftRadius) };
  });
  expect(karte.rand).toBe('0px');
  expect(karte.radius).toBeGreaterThanOrEqual(16);
  // Überschriften mit Symbol statt Emoji
  await expect(page.locator('.heute-todos-karte h2 svg.a-symbol')).toHaveCount(1);
  await expect(page.locator('.heute-todos-karte h2')).not.toContainText('☑');
  // runder Abhak-Kreis
  const kreis = page.locator('.heute-todo input[type=checkbox]').first();
  const k = await kreis.evaluate((e) => {
    const c = getComputedStyle(e);
    return { radius: c.borderTopLeftRadius, breite: parseFloat(c.width), appearance: c.appearance };
  });
  expect(k.radius).toBe('50%');
  expect(k.breite).toBeGreaterThanOrEqual(20);
  expect(k.appearance).toBe('none');
  await keinUeberlauf(page);
  await foto(page, 'heute-hell', info.project.name);
  // abhaken: Kreis füllt sich (Tint), Zeile verschwindet danach
  const zeile = heute.locator('.heute-todo', { hasText: `Milch kaufen ${info.project.name}` });
  await zeile.getByRole('checkbox').check();
  await expect(heute.locator('.heute-todo', { hasText: `Milch kaufen ${info.project.name}` })).toHaveCount(0);
});

test('Apple dunkel: Heute und Fokus-Vollbild mit Ring', async ({ page }, info) => {
  await appleAn(page, { dunkel: true });
  await anmelden(page);
  await page.goto('/heute');
  await expect(page.locator('.heute-gruss')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-dunkel', 'ja');
  const flaeche = await page.locator('.heute-todos-karte').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(flaeche).toBe('rgb(28, 28, 30)');
  await keinUeberlauf(page);
  await foto(page, 'heute-dunkel', info.project.name);
  await page.goto('/fokus');
  await expect(page.locator('.fokus-ring-a svg.a-ring')).toBeVisible();
  const ziffern = await page.locator('.fokus-zeit').evaluate((e) => getComputedStyle(e).fontVariantNumeric);
  expect(ziffern).toContain('tabular-nums');
  await keinUeberlauf(page);
  await foto(page, 'fokus-dunkel', info.project.name);
});

test('Apple: To-do-Brett wie Erinnerungen – Liste inset grouped, Bearbeiten als Sheet', async ({ page }, info) => {
  await appleAn(page);
  await anmelden(page);
  await daten(page, `${info.project.name}-b`);
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const zeile = page.locator('li.todo', { hasText: `Blatt 7 rechnen ${info.project.name}-b` });
  await expect(zeile).toBeVisible();
  const z = await zeile.evaluate((e) => ({ rand: getComputedStyle(e).borderTopWidth, schatten: getComputedStyle(e).boxShadow }));
  expect(z.rand).toBe('0px');
  expect(z.schatten).toBe('none');
  const liste = await page.locator('.todo-liste').first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
  expect(liste).toBeGreaterThanOrEqual(10);
  await keinUeberlauf(page);
  await foto(page, 'todo-hell', info.project.name);
  // aufklappen → Details mit Symbolen; Bearbeiten → Sheet (fest positioniert, Scrim)
  await zeile.locator('.todo-titel').click();
  await expect(zeile.locator('.todo-knoepfe svg.a-symbol').first()).toBeVisible();
  await zeile.getByRole('button', { name: 'Bearbeiten' }).click();
  const sheet = page.locator('.todo.bearbeiten > form');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
  await expect(page.locator('.todo.bearbeiten .a-sheet-scrim')).toBeVisible();
  await foto(page, 'todo-sheet', info.project.name);
  // Tipp auf den Scrim schließt wie „Abbrechen“
  await page.mouse.click(5, 5);
  await expect(page.locator('.todo.bearbeiten')).toHaveCount(0);
});

test('Apple: Kalender, Kirchturm, Statistik, Wochenplan, Projekte, Planen, Abschluss, Schreibtisch', async ({ page }, info) => {
  await appleAn(page);
  await anmelden(page);
  await daten(page, `${info.project.name}-c`);
  for (const [url, name, merkmal] of [
    ['/gebaeude/Marktplatz?reiter=kalender', 'kalender', '.markt-kalender'],
    ['/gebaeude/Marktplatz?reiter=wochenplan', 'wochenplan', '.wplan-spalten'],
    ['/gebaeude/Marktplatz?reiter=projekte', 'projekte', '.projekte'],
    ['/gebaeude/Kirchturm?reiter=uhr', 'kirchturm', '.pomodoro'],
    ['/gebaeude/Rathaus?reiter=statistik', 'statistik', '.statistik-kacheln'],
    ['/gebaeude/Rathaus?reiter=notizen', 'notizen', '.notizen'],
    ['/gebaeude/Rathaus?reiter=schreibtisch', 'schreibtisch', '.schreibtisch'],
    ['/planen', 'planen', '.planen'],
    ['/abschluss', 'abschluss', '.planen'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator(merkmal).first()).toBeVisible();
    await keinUeberlauf(page);
    await foto(page, name, info.project.name);
  }
  // Kalender-Ansicht als Segmented Control
  await page.goto('/gebaeude/Marktplatz?reiter=kalender');
  const segment = page.locator('.markt-kalender .reiter.klein');
  expect(await segment.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('0px');
  // Statistik: Kachel ohne Rahmen, Balken in Tint-Farbe
  await page.goto('/gebaeude/Rathaus?reiter=statistik');
  const kachel = await page.locator('.statistik-kachel').first().evaluate((e) => getComputedStyle(e).borderTopWidth);
  expect(kachel).toBe('0px');
});

test('Dorf-Design bleibt: Heute ohne Apple-Symbole, Emojis wie gehabt', async ({ page }) => {
  await anmelden(page);
  await page.goto('/heute');
  await expect(page.locator('html')).toHaveAttribute('data-design', 'dorf');
  await expect(page.locator('.heute-todos-karte h2')).toHaveText('☑️ To-dos');
  await expect(page.locator('.heute .a-symbol')).toHaveCount(0);
  const rand = await page.locator('.heute-todos-karte').evaluate((e) => getComputedStyle(e).borderTopWidth);
  expect(rand).not.toBe('0px');
});
