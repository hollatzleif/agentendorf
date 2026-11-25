import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { appleAn } from './apple-hilfe';
import { analyseDaten } from './boerse-daten';
import { BOT_ID, konsole, muster, musterVerlauf, terminal, uebersicht } from './hafen-daten';

/** E240: Apple-Oberfläche im Bereich Finanzen – Hafen (Flotte, Kielwasser, Muster-Kielwasser), Börse, Paketwerk. Daten nachgebaut. */
async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

async function nachbauen(page: Page) {
  await page.route('**/api/krypto**', async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/api/krypto') return r.fulfill({ json: uebersicht() });
    if (url.pathname === '/api/krypto/muster') return r.fulfill({ json: muster(false) });
    if (url.pathname === '/api/krypto/muster/verlauf') {
      const v = url.searchParams.get('version');
      return r.fulfill({ json: musterVerlauf(v ? Number(v) : null) });
    }
    if (url.pathname === '/api/krypto/muster/konsole') {
      const v = url.searchParams.get('version');
      return r.fulfill({ json: konsole(v ? Number(v) : 5, Number(url.searchParams.get('ab') ?? 0)) });
    }
    if (/\/terminal$/.test(url.pathname)) return r.fulfill({ json: { ...terminal(), kerzenTakt: url.searchParams.get('takt') || '15m' } });
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/boerse/analyse', (r) => r.fulfill({ json: analyseDaten() }));
  await page.route('**/api/paketwerk', (r) => r.fulfill({ json: { eingerichtet: true, pakete: [{ name: 'scikit-learn', version: '1.9.1' }, { name: 'polars', version: '1.2.0' }] } }));
}

/** Bildschirmfoto in den Test-Ausgaben; mit APPLE_BILDER zusätzlich dorthin (Sichtprüfung) */
async function foto(page: Page, info: TestInfo, name: string) {
  const pfad = info.outputPath(`${name}.png`);
  // die Schale scrollt in einem eigenen Bereich – für ein ganzes Bild kurz ein hohes Fenster
  const alt = page.viewportSize()!;
  const hoehe = await page.evaluate(() => Math.max(...[...document.querySelectorAll('main, main *')].slice(0, 400).map((e) => e.scrollHeight), document.documentElement.scrollHeight));
  await page.setViewportSize({ width: alt.width, height: Math.min(6000, Math.max(alt.height, hoehe + 120)) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: pfad });
  await page.setViewportSize(alt);
  const ziel = process.env.APPLE_BILDER;
  if (ziel) {
    mkdirSync(ziel, { recursive: true });
    copyFileSync(pfad, join(ziel, `finanzen-${name}-${info.project.name}.png`));
  }
}

async function keinUeberlauf(page: Page) {
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // bei Überlauf: die Elemente nennen, die über den rechten Rand ragen
  const zuBreit = breit > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(-4).map((e) => `${e.tagName}.${e.className}`).join(' | ')) : '';
  expect(breit, zuBreit).toBeLessThanOrEqual(1);
}

const farbe = (page: Page, sel: string, eig: string) => page.locator(sel).first().evaluate((el, e) => getComputedStyle(el).getPropertyValue(e), eig);

for (const dunkel of [false, true]) {
  const art = dunkel ? 'dunkel' : 'hell';

  test(`Apple ${art}: Terminal Kielwasser im Aktien-Stil – Karten, Systemschrift, Segmented Control, Kerzen in Systemgrün/-rot, Glas-Kapsel`, async ({ page }, info) => {
    await appleAn(page, { dunkel });
    await nachbauen(page);
    await anmelden(page);
    await page.goto(`/hafen/${BOT_ID}`);
    const kw = page.getByLabel('Terminal Schwarm');
    await expect(kw).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-design', 'apple');
    // Grund = --a-grund, Tafeln = --a-flaeche ohne Rahmen, Systemschrift
    expect(await farbe(page, '.kw', 'background-color')).toBe(dunkel ? 'rgb(0, 0, 0)' : 'rgb(242, 242, 247)');
    expect(await farbe(page, '.kw-tafel', 'background-color')).toBe(dunkel ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)');
    expect(await farbe(page, '.kw-tafel', 'border-top-width')).toBe('0px');
    expect(await farbe(page, '.kw', 'font-family')).toContain('-apple-system');
    expect(await farbe(page, '.kw-konto strong', 'font-variant-numeric')).toContain('tabular-nums');
    // Kerzen in Systemgrün/-rot
    const kerzenFarben = await page.locator('.kw-chart svg rect').evaluateAll((r) => [...new Set(r.map((x) => getComputedStyle(x).fill))]);
    expect(kerzenFarben.some((f) => f === (dunkel ? 'rgb(48, 209, 88)' : 'rgb(52, 199, 89)'))).toBe(true);
    // Takt als Segmented Control: gewählter Abschnitt hebt sich ab
    const takte = page.getByRole('group', { name: 'Kerzen-Takt' });
    expect(await takte.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    await takte.getByRole('button', { name: '5 min', exact: true }).click();
    await expect(takte.getByRole('button', { name: '5 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Symbole statt Emoji in den Überschriften
    await expect(page.getByRole('region', { name: 'Echtzeit-Kurse' }).locator('h3 svg.a-symbol')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Trades' }).getByRole('button', { name: 'CSV' }).locator('svg.a-symbol')).toHaveCount(1);
    // Fadenkreuz-Tooltip = Glas-Kapsel
    const svg = page.getByRole('img', { name: /^Equity:/ });
    const tip = page.getByTestId('chart-zeiger');
    await expect(async () => {
      const box = (await svg.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
      await expect(tip).toBeVisible({ timeout: 1000 });
    }).toPass();
    expect(await tip.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur');
    expect(await tip.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('14px');
    await page.mouse.move(0, 0);
    await keinUeberlauf(page);
    await foto(page, info, `terminal-${art}`);
  });
}

test('Apple: Flotte als Wallet-Karten, Not-Aus destruktiv, Euro als zweite Zeile; Muster-Kielwasser mit Konsole in Monospace', async ({ page }, info) => {
  await appleAn(page);
  await nachbauen(page);
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  await expect(page.getByRole('heading', { name: 'Flotte' }).locator('svg.a-symbol')).toHaveCount(1);
  const karte = page.getByRole('article', { name: 'Bot Schwarm' });
  await expect(karte).toBeVisible();
  expect(await karte.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
  expect(await karte.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('20px');
  expect(await karte.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient');
  expect(await karte.getByTestId('bot-kapital').locator('.hafen-eur').evaluate((el) => getComputedStyle(el).display)).toBe('block');
  const notaus = page.getByRole('button', { name: 'Not-Aus' });
  expect(await notaus.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 59, 48)');
  await keinUeberlauf(page);
  await foto(page, info, 'flotte-hell');

  await page.goto('/hafen/muster');
  const k = page.getByTestId('muster-konsole');
  await expect(k.getByTestId('konsole-zeilen').locator('.mk-zeile').first()).toBeVisible();
  expect(await k.getByTestId('konsole-zeilen').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/ui-monospace|Menlo/);
  expect(await farbe(page, '.kw-tafel', 'border-top-left-radius')).toBe('20px');
  // Verlauf-Chart: Systemfarben als Linien (var(--a-…)), Glas-Kapsel beim Drüberfahren
  const auc = page.getByTestId('verlauf-auc');
  await expect(auc.locator('path[stroke^="var(--a-"]').first()).toBeAttached();
  await keinUeberlauf(page);
  await foto(page, info, 'muster-hell');
});

test('Apple dunkel: Flotte und Muster-Kielwasser', async ({ page }, info) => {
  await appleAn(page, { dunkel: true });
  await nachbauen(page);
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  await expect(page.getByRole('article', { name: 'Bot Schwarm' })).toBeVisible();
  await keinUeberlauf(page);
  await foto(page, info, 'flotte-dunkel');
  await page.goto('/hafen/muster');
  await expect(page.getByTestId('muster-konsole').getByTestId('konsole-zeilen').locator('.mk-zeile').first()).toBeVisible();
  expect(await farbe(page, '.kw', 'background-color')).toBe('rgb(0, 0, 0)');
  await foto(page, info, 'muster-dunkel');
});

for (const dunkel of [false, true]) {
  const art = dunkel ? 'dunkel' : 'hell';
  test(`Apple ${art}: Börse – Zeitraum als Segmented Control, Linie mit Verlaufsfläche, Kennzahlen-Karten, Depot, Rechner, Berater`, async ({ page }, info) => {
    await appleAn(page, { dunkel });
    await nachbauen(page);
    await anmelden(page);
    await page.goto('/gebaeude/Boerse?reiter=analyse');
    const zeitraum = page.getByRole('group', { name: 'Zeitraum' });
    await expect(zeitraum).toBeVisible();
    expect(await zeitraum.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('9px');
    expect(await zeitraum.evaluate((el) => getComputedStyle(el).flexWrap)).toBe('nowrap');
    await zeitraum.getByRole('button', { name: 'Max' }).click();
    await expect(zeitraum.getByRole('button', { name: 'Max' })).toHaveAttribute('aria-pressed', 'true');
    // eine Linie → Verlaufsfläche darunter (Aktien-Stil)
    await expect(page.locator('.diagramm .diagramm-flaeche')).toHaveCount(1);
    const kachel = page.locator('.ba-kacheln .bank-kachel').first();
    expect(await kachel.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    // Tooltip als Glas-Kapsel
    const svg = page.locator('.diagramm svg').first();
    await svg.scrollIntoViewIfNeeded();
    await expect(async () => {
      const box = (await svg.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
      await expect(page.locator('.diagramm-tip')).toBeVisible({ timeout: 1000 });
    }).toPass();
    expect(await page.locator('.diagramm-tip').evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur');
    await page.mouse.move(0, 0);
    await keinUeberlauf(page);
    await foto(page, info, `boerse-analyse-${art}`);

    await page.goto('/gebaeude/Boerse?reiter=depot');
    await expect(page.getByRole('heading', { name: /Eigenes Depot/ })).toBeVisible();
    await keinUeberlauf(page);
    await foto(page, info, `boerse-depot-${art}`);

    await page.goto('/gebaeude/Boerse?reiter=rechner');
    const tabs = page.getByRole('tablist', { name: 'Rechner' });
    await expect(tabs.getByRole('tab', { name: 'Sparplan' }).locator('svg.a-symbol')).toHaveCount(1);
    await keinUeberlauf(page);
    await foto(page, info, `boerse-rechner-${art}`);

    await page.goto('/gebaeude/Boerse?reiter=berater');
    await expect(page.locator('.berater-karte .berater-symbol svg.a-symbol').first()).toBeVisible();
    await keinUeberlauf(page);
    await foto(page, info, `boerse-berater-${art}`);
  });
}

test('Apple: Paketwerk-Konsole im Terminal-Stil (dunkle Fläche, Monospace), Pakete als Liste', async ({ page }, info) => {
  await appleAn(page);
  await nachbauen(page);
  await anmelden(page);
  await page.goto('/paketwerk');
  await expect(page.getByRole('heading', { name: /Paketwerk/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Paketwerk/ }).locator('svg.a-symbol')).toHaveCount(1);
  const k = page.getByLabel('Konsole');
  const grund = await k.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = grund.match(/[\d.]+/g)!.map(Number);
  expect(r! + g! + b!).toBeLessThan(120); // dunkel
  expect(await page.getByLabel('Ausgabe').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/ui-monospace|Menlo/);
  await expect(page.getByRole('list', { name: 'Installierte Pakete' })).toContainText('polars==1.2.0');
  await keinUeberlauf(page);
  await foto(page, info, 'paketwerk-hell');
});

test('Dorf-Design bleibt: Kielwasser dunkel-lila wie bisher, Kerzen in den alten Farben, Emojis als Text', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'einmal reicht');
  await nachbauen(page);
  await anmelden(page);
  await page.goto(`/hafen/${BOT_ID}`);
  await expect(page.getByLabel('Terminal Schwarm')).toBeVisible();
  expect(await farbe(page, '.kw', 'background-color')).toBe('rgb(10, 12, 20)');
  await expect(page.locator('.kw-chart svg rect[fill="#22c55e"]').first()).toBeAttached();
  await expect(page.getByRole('region', { name: 'Trades' }).getByRole('button', { name: '⬇ CSV' })).toBeVisible();
  await expect(page.locator('svg.a-symbol')).toHaveCount(0);
});
