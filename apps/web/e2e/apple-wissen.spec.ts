import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { appleAn } from './apple-hilfe';

/**
 * E240 Bereich C „Gebäude & Wissen“ in der Apple-Oberfläche: Gebäude (Large Title, Segmented Control bzw. Seitenleiste),
 * Aktionen als Liste mit Sheet, Chat wie Nachrichten, Bibliothek wie Dateien, Uni (Fristen-Liste, Fach mit Ring,
 * Karteikarte mit Wende), Noten, Post, Bank, Atelier, Codehaus, Anleitung, Dorfplatz-Liste – hell und dunkel.
 */
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 3999}`;
const PW = 'e2e-Passwort-sehr-lang-1';
const BILDER = process.env.APPLE_BILDER;

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

/** Bildschirmfoto für die Sichtprüfung (nur wenn APPLE_BILDER gesetzt ist, sonst in den Testausgaben) */
async function foto(page: Page, info: TestInfo, name: string, voll = true) {
  await page.waitForTimeout(450); // Federn auslaufen lassen
  const pfad = BILDER ? `${BILDER}/wissen-${name}-${info.project.name}.png` : info.outputPath(`${name}.png`);
  if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
  await page.screenshot({ path: pfad, fullPage: voll });
}

async function keinUeberlauf(page: Page) {
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(breit).toBeLessThanOrEqual(1);
}

const stil = (page: Page, sel: string, eig: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), eig);

test('Apple – Gebäude, Aktion im Sheet, Chat wie Nachrichten', async ({ page }, info) => {
  test.setTimeout(90_000);
  await appleAn(page);
  await anmelden(page);
  await expect(page.locator('html')).toHaveAttribute('data-design', 'apple');
  await foto(page, info, 'dorfplatz-hell');
  // Dorfplatz-Liste: Karten ohne Rahmen auf der Fläche
  expect(await stil(page, '.gebaeude-karte', 'border-top-width')).toBe('0px');

  await page.goto('/gebaeude/Rathaus?reiter=aktionen');
  const titel = page.locator('h1.geb-titel');
  await expect(titel).toContainText('Rathaus');
  // Large Title in der Systemschrift, negatives Tracking
  expect(await stil(page, 'h1.geb-titel', 'font-size')).toBe('34px');
  expect(await stil(page, 'h1.geb-titel', 'font-family')).toMatch(/system-ui|-apple-system/);
  expect(parseFloat(await stil(page, 'h1.geb-titel', 'letter-spacing'))).toBeLessThan(0);
  // Hintergrund = --a-grund (systemGroupedBackground)
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(242, 242, 247)');
  // Reiter: Segmented Control (Handy) bzw. Seitenleiste (Desktop) – der aktive Reiter ist abgesetzt
  const aktiv = page.locator('.geb-reiter button.aktiv');
  await expect(aktiv).toHaveText('Aktionen');
  if (info.project.name === 'desktop') expect(await stil(page, '.geb-reiter', 'flex-direction')).toBe('column');
  else expect(await stil(page, '.geb-reiter', 'flex-direction')).toBe('row');
  // Aktionen als gruppierte Liste mit Symbol statt Emoji
  await expect(page.locator('.aktion-knopf .aktion-ikon svg').first()).toBeVisible();
  await keinUeberlauf(page);
  await foto(page, info, 'gebaeude-aktionen-hell');

  // Aktion öffnet ein Sheet (Dialog) – Esc schließt es wieder
  await page.getByRole('button', { name: /Frage stellen/ }).click();
  const blatt = page.getByRole('dialog', { name: /Frage stellen/ });
  await expect(blatt).toBeVisible();
  await foto(page, info, 'aktion-sheet-hell', false); // feste Ebenen (Sheet) nur im Sichtbereich
  await page.keyboard.press('Escape');
  await expect(blatt).toBeHidden();
  await page.getByRole('button', { name: /Frage stellen/ }).click();
  await blatt.getByLabel(/Deine Frage/).fill(`Apple-Test ${info.project.name} [schreibe Rathaus/notizen/apple-${info.project.name}.md]`);
  await blatt.getByRole('button', { name: 'Starten' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible({ timeout: 30_000 });

  // Nachrichten: eigene Blase rechts in Blau, Agent links in grauer Füllung
  const nutzer = page.locator('.nachricht.nutzer').first();
  expect(await nutzer.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(0, 122, 255)');
  expect(await nutzer.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(255, 255, 255)');
  const agent = page.locator('.nachricht.agent').first();
  const [n, a] = [await nutzer.boundingBox(), await agent.boundingBox()];
  expect(n!.x + n!.width).toBeGreaterThan(a!.x + a!.width);
  // runder Senden-Knopf mit Pfeil, Name bleibt „Senden“
  const senden = page.getByRole('button', { name: 'Senden' });
  const kasten = await senden.boundingBox();
  expect(Math.abs(kasten!.width - kasten!.height)).toBeLessThan(1);
  await expect(senden.locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Datei' })).toBeVisible();
  // Eingabeleiste im Glas
  expect(await stil(page, '.chat-eingabe', 'backdrop-filter')).toContain('blur');
  await keinUeberlauf(page);
  await foto(page, info, 'chat-hell');

  // Weiterschreiben geht wie gewohnt
  await page.getByPlaceholder('Weiter im Gespräch …').fill('Und jetzt mit Freigabe [freigabe Rathaus/notizen/apple-x.md]');
  await senden.click();
  await expect(page.getByText(/Lauf 2: fertig/)).toBeVisible({ timeout: 30_000 });

  // Freigaben: Freigeben grün getönt, Ablehnen rot
  await page.goto('/gebaeude/Rathaus?reiter=freigaben');
  const ja = page.getByRole('button', { name: 'Ja, ausführen' }).first();
  await expect(ja).toBeVisible();
  expect(await ja.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/^(rgba|color)\(/);
  await foto(page, info, 'freigaben-hell');
  await page.goto('/gebaeude/Rathaus?reiter=alle-chats');
  await expect(page.locator('.chatliste.chats li').first()).toBeVisible({ timeout: 15_000 });
  await foto(page, info, 'chats-hell');
  await page.goto('/gebaeude/Rathaus?reiter=uebersicht');
  await expect(page.locator('.gebaeude-einstellen')).toBeVisible();
  await foto(page, info, 'uebersicht-hell');
});

test('Apple – Bibliothek wie Dateien, Anleitung', async ({ page }, info) => {
  await appleAn(page);
  await anmelden(page);
  await page.goto('/bibliothek?pfad=Rathaus');
  // Ordnerliste mit Symbolen statt Emoji
  await expect(page.locator('.ordnerliste .ordner-ikon svg').first()).toBeVisible();
  await expect(page.locator('.ordnerliste')).not.toContainText('📁');
  await expect(page.locator('.brotkrumen .a-chevron')).toHaveCount(1);
  if (info.project.name === 'desktop') await expect(page.locator('.baum .baum-ikon svg').first()).toBeVisible();
  await keinUeberlauf(page);
  await foto(page, info, 'bibliothek-hell');
  await page.goto('/bibliothek?pfad=Rathaus%2Fgebaeude.md');
  await expect(page.locator('.textansicht')).toBeVisible();
  await foto(page, info, 'bibliothek-datei-hell');
  await page.goto('/anleitung');
  await expect(page.getByRole('heading', { name: 'So nutzt du das Dorf' })).toBeVisible();
  expect(await stil(page, '.anleitung h1', 'font-size')).toBe('34px');
  await keinUeberlauf(page);
  await foto(page, info, 'anleitung-hell');
});

test('Apple – Uni: Fristen als Liste, Fach mit Ring, Karteikarte mit Wende, Noten, Prüfungen', async ({ page }, info) => {
  test.setTimeout(60_000);
  await appleAn(page);
  await anmelden(page);
  const o = { origin: ORIGIN };
  const fach = `Apfel ${info.project.name}`;
  expect((await page.request.post('/api/uni/fach', { headers: o, data: { name: fach } })).ok()).toBe(true);
  expect((await page.request.post('/api/uni/lernziel', { headers: o, data: { fach, stunden: 3 } })).ok()).toBe(true);
  expect((await page.request.put('/api/vault/datei', { headers: o, data: { pfad: `Uni/faecher/${fach}/karten.md`, inhalt: 'Hauptstadt von Österreich :: Wien\n\nWas ist 2 + 2? :: 4\n' } })).ok()).toBe(true);
  await page.goto('/gebaeude/Uni');
  await page.getByRole('button', { name: /Jetzt abgleichen|Abgleich läuft/ }).click();
  // Fristen kommen aus dem nachgebauten Google-Kalender; falls der (bei vielen parallelen Testreihen) nicht antwortet, gilt der Rest trotzdem
  const fristen = page.locator('table.fristen');
  const mitFristen = await fristen
    .waitFor({ timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  // Tabelle wird zur gruppierten Liste: keine Kopfzeile
  if (mitFristen) await expect(fristen.locator('thead')).toBeHidden();
  const karte = page.getByRole('region', { name: `Fach ${fach}` });
  await expect(karte.locator('.a-ring')).toBeVisible();
  await keinUeberlauf(page);
  await foto(page, info, 'uni-hell');

  await page.getByRole('button', { name: 'Karteikarten', exact: true }).click();
  await page.getByRole('region', { name: `Karten ${fach}` }).getByRole('button', { name: 'Lernen' }).click();
  const kk = page.getByLabel('Karteikarte');
  await expect(kk).toContainText('Hauptstadt von Österreich');
  await foto(page, info, 'karte-vorne-hell');
  await page.keyboard.press(' ');
  await expect(kk).toHaveClass(/gewendet/);
  await expect(kk).toContainText('Wien');
  await foto(page, info, 'karte-hinten-hell');
  await page.keyboard.press('3');
  await expect(kk).toContainText('Was ist 2 + 2?');

  await page.goto('/gebaeude/Uni?reiter=noten');
  await page.getByLabel('Fach', { exact: true }).fill(fach);
  await page.getByRole('button', { name: 'Fach hinzufügen' }).click();
  await expect(page.getByLabel(`Note ${fach}`)).toBeVisible();
  await keinUeberlauf(page);
  await foto(page, info, 'noten-hell');
  await page.goto('/gebaeude/Uni?reiter=pruefungen');
  await expect(page.getByRole('region', { name: 'Prüfungs-Cockpit' }).or(page.getByText('Keine Prüfung in Sicht.', { exact: false }))).toBeVisible();
  await foto(page, info, 'pruefungen-hell');
});

test('Apple – Post, Bank (Wallet), Corps, Atelier, Codehaus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' && !BILDER, 'einmal reicht – Handy nur für die Sichtprüfung');
  await appleAn(page);
  await anmelden(page);
  await page.goto('/gebaeude/Bank');
  if (info.project.name === 'desktop') {
    // eigener Auszug in einem alten Monat – die Bank-Tests im Dorf-Design (gleicher Server) bleiben unberührt
    const csv = 'Buchungstag;Beguenstigter/Zahlungspflichtiger;Verwendungszweck;Betrag\n02.10.2025;Apfelhof Miete;Miete Oktober;-390,00\n05.10.2025;Apfelmarkt;Einkauf;-21,40\n15.10.2025;Apfel AG;Lohn Oktober;1.100,00\n';
    await page.locator('.bank input[type=file]').setInputFiles({ name: 'apple-oktober-2025.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByText(/Hochgeladen – \d+ neue Buchungen/)).toBeVisible();
  }
  await expect(page.locator('.bank-kachel').first()).toBeVisible();
  // „Übrig“ ist die große Karte oben (Wallet)
  const rest = await page.locator('.bank-kachel').nth(2).boundingBox();
  const ein = await page.locator('.bank-kachel').nth(0).boundingBox();
  expect(rest!.y).toBeLessThan(ein!.y);
  await keinUeberlauf(page);
  await foto(page, info, 'bank-hell');
  for (const [geb, name] of [
    ['Post', 'post'],
    ['Corpshaus', 'corps'],
    ['Atelier', 'atelier'],
    ['Codehaus', 'codehaus'],
  ] as const) {
    await page.goto(`/gebaeude/${geb}`);
    await expect(page.locator('h1.geb-titel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await keinUeberlauf(page);
    await foto(page, info, `${name}-hell`);
  }
});

test('Apple dunkel – Gebäude, Chat-Liste, Bibliothek, Uni', async ({ page }, info) => {
  test.setTimeout(60_000);
  await appleAn(page, { dunkel: true });
  await anmelden(page);
  await expect(page.locator('html')).toHaveAttribute('data-dunkel', 'ja');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  await foto(page, info, 'dorfplatz-dunkel');
  await page.goto('/gebaeude/Rathaus?reiter=aktionen');
  expect(await stil(page, '.aktions-knoepfe', 'background-color')).toBe('rgb(28, 28, 30)');
  await foto(page, info, 'gebaeude-aktionen-dunkel');
  await page.goto('/gebaeude/Rathaus?reiter=alle-chats');
  const erster = page.locator('.chatliste.chats li a').first();
  await expect(erster).toBeVisible({ timeout: 15_000 });
  await erster.click();
  await expect(page.locator('.nachricht').first()).toBeVisible();
  await foto(page, info, 'chat-dunkel');
  await page.goto('/bibliothek?pfad=Rathaus');
  await foto(page, info, 'bibliothek-dunkel');
  await page.goto('/gebaeude/Uni');
  await foto(page, info, 'uni-dunkel');
  await page.goto('/gebaeude/Bank');
  await foto(page, info, 'bank-dunkel');
  await keinUeberlauf(page);
});
