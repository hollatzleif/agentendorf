import { expect, test, type Page } from '@playwright/test';
import { belegungBerechnen, feldSchluessel, type DorfAntwort, type DorfLayout, type DorfStatus } from '@dorf/shared';

const PW = 'e2e-Passwort-sehr-lang-1';
// Software-WebGL auf dem CI-Rechner ist langsam (der Bau-Test hält zwei 3D-Seiten offen) – großzügige Zeit, in CI ein zweiter Versuch
test.describe.configure({ timeout: 180_000, retries: process.env.CI ? 1 : 0 });

interface DorfTest {
  bildschirmPunkt(art: string, id?: string): { x: number; y: number } | null;
  feldPunkt(x: number, z: number): { x: number; y: number };
  feldUnter(e: { clientX: number; clientY: number }): [number, number] | null;
  layoutStand(): DorfLayout | null;
  zustand(id: string): { rot: boolean; blasen: string; rauch: number } | null;
  blickAuf(x: number, z: number, abstand?: number): void;
  blickAufFigur(id: string, abstand?: number): void;
  figurenAnzahl(): number;
  treffer(e: { clientX: number; clientY: number }): { art: string; id?: string } | null;
}
declare global {
  interface Window {
    __dorf?: DorfTest;
  }
}

async function imDorf(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible();
  await page.waitForFunction(() => !!window.__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 20_000 });
}

const dorf = async (page: Page) => (await (await page.request.get('/api/dorf')).json()) as DorfAntwort;

/** Freier Bauplatz (4×4 + ein Feld Abstand ringsum) nahe bei (x, z) */
function freierPlatz(l: DorfLayout, nahe: { x: number; z: number }): [number, number] {
  const { belegung } = belegungBerechnen(l);
  const kandidaten: [number, number][] = [];
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) kandidaten.push([x, z]);
  kandidaten.sort((a, b) => Math.hypot(a[0] - nahe.x, a[1] - nahe.z) - Math.hypot(b[0] - nahe.x, b[1] - nahe.z));
  for (const [x, z] of kandidaten) {
    let frei = true;
    for (let dx = -1; dx <= 4 && frei; dx++) for (let dz = -1; dz <= 4 && frei; dz++) if (belegung.has(feldSchluessel(x + dx, z + dz))) frei = false;
    if (frei) return [x, z];
  }
  throw new Error('kein Platz');
}

async function ziehen(page: Page, von: { x: number; y: number }, nach: { x: number; y: number }) {
  await page.mouse.move(von.x, von.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(von.x + ((nach.x - von.x) * i) / 8, von.y + ((nach.y - von.y) * i) / 8);
  await page.mouse.up();
}

test('Dorf: Gebäude anklicken öffnet das Menü; Statusanzeigen folgen dem Server', async ({ page }) => {
  await imDorf(page);
  const pt = (await page.evaluate(() => window.__dorf!.bildschirmPunkt('gebaeude', 'Uni')))!;
  await page.mouse.click(pt.x, pt.y);
  // Antippen: Namensbanner und runde Knöpfe erscheinen, das Gebäude ist hervorgehoben
  const knoepfe = page.getByRole('group', { name: 'Gebäude Uni' });
  await expect(knoepfe).toBeVisible();
  await expect(knoepfe.getByRole('button', { name: 'Studium' })).toBeVisible();
  await knoepfe.getByRole('button', { name: 'Info' }).click();
  await expect(page).toHaveURL(/\?g=Uni&reiter=uebersicht/);
  const menue = page.getByRole('complementary', { name: /Gebäude Uni/ });
  await expect(menue.getByRole('heading', { name: /Uni – Arbeitsanweisung/ })).toBeVisible();
  await menue.getByRole('button', { name: 'Menü schließen' }).click();
  await expect(menue).toBeHidden();
  // Schnellknopf: „Lernen“ öffnet die Aktion gleich ausgewählt
  await knoepfe.getByRole('button', { name: 'Lernen' }).click();
  await expect(page).toHaveURL(/reiter=aktionen&aktion=Uni%2Flernen/);
  await expect(menue.locator('.aktion-knopf.aktiv')).toContainText('Lernen');
  await expect(menue.getByRole('button', { name: 'Starten' })).toBeVisible();
  await menue.getByRole('button', { name: 'Menü schließen' }).click();
  // zurück bei den Knöpfen; Auswahl aufheben
  await knoepfe.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await expect(knoepfe).toBeHidden();

  // rotes Dach + Uhr genau dann, wenn der Server eine Frist < 3 Tage meldet
  const s = (await (await page.request.get('/api/dorf/status')).json()) as DorfStatus;
  await expect.poll(() => page.evaluate(() => window.__dorf!.zustand('Uni'))).toMatchObject({ rot: !!s.gebaeude.Uni?.frist });
  const z = (await page.evaluate(() => window.__dorf!.zustand('Uni')))!;
  expect(z.blasen.includes('uhr')).toBe(!!s.gebaeude.Uni?.frist);
});

test('Bau-Modus: verschieben (live auf zweitem Gerät), Straße malen, rückgängig, Lager', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await imDorf(a);
  await imDorf(b);
  const start = await dorf(a);
  const bank = start.layout.gebaeude.Bank!;
  const [tx, tz] = freierPlatz(start.layout, bank);

  await a.getByRole('button', { name: 'Bauen' }).click();
  await expect(a.getByRole('toolbar', { name: 'Bau-Werkzeuge' })).toBeVisible();
  await a.evaluate(([x, z]) => window.__dorf!.blickAuf(x, z, 34), [Math.round((bank.x + tx) / 2) + 2, Math.round((bank.z + tz) / 2) + 2] as const);
  await a.waitForTimeout(300);
  // Bank greifen (wie ein Mensch: am Haus) und auf den freien Platz ziehen; das gegriffene Feld wandert mit
  // eine Stelle suchen, an der wirklich die Bank getroffen wird (nicht ein Haus davor)
  const treffer = await a.evaluate(([bx, bz]) => {
    for (let dx = 0; dx < 4; dx++)
      for (let dz = 3; dz >= 0; dz--) {
        const p = window.__dorf!.feldPunkt(bx + dx, bz + dz);
        const t = window.__dorf!.treffer({ clientX: p.x, clientY: p.y });
        if (t?.art === 'gebaeude' && t.id === 'Bank') return { p, f: window.__dorf!.feldUnter({ clientX: p.x, clientY: p.y })! };
      }
    return null;
  }, [bank.x, bank.z] as const);
  expect(treffer).not.toBeNull();
  const greif = treffer!.p;
  const gf = treffer!.f;
  const ziel = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), [tx + gf[0] - bank.x, tz + gf[1] - bank.z] as const);
  await ziehen(a, greif, ziel);
  await expect.poll(async () => (await dorf(a)).layout.gebaeude.Bank).toMatchObject({ x: tx, z: tz });
  await expect(a.getByText('gespeichert', { exact: true })).toBeVisible();
  // zweites Gerät sieht es ohne Neuladen
  await b.waitForFunction(([x, z]) => window.__dorf?.layoutStand()?.gebaeude.Bank?.x === x && window.__dorf?.layoutStand()?.gebaeude.Bank?.z === z, [tx, tz] as const, { timeout: 10_000 });

  // Straße über drei freie Felder malen, dann rückgängig
  const l1 = (await dorf(a)).layout;
  const { belegung } = belegungBerechnen(l1);
  let reihe: [number, number][] | null = null;
  for (let dz = -3; dz <= 7 && !reihe; dz++) {
    const r: [number, number][] = [0, 1, 2].map((i) => [tx + i, tz + dz]);
    if (r.every(([x, z]) => !belegung.has(feldSchluessel(x, z)))) reihe = r;
  }
  expect(reihe).not.toBeNull();
  await a.getByRole('button', { name: /Straße/ }).click();
  const p0 = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), reihe![0]!);
  const p2 = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), reihe![2]!);
  await ziehen(a, p0, p2);
  await expect.poll(async () => (await dorf(a)).layout.strassen.length).toBe(l1.strassen.length + 3);
  await a.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await dorf(a)).layout.strassen.length).toBe(l1.strassen.length);

  // Deko über die runden Knöpfe setzen
  const dekoVorher = (await dorf(a)).layout.deko.length;
  await a.getByRole('button', { name: 'Laubbaum' }).click();
  const p1 = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), reihe![1]!);
  await a.mouse.click(p1.x, p1.y);
  await expect.poll(async () => (await dorf(a)).layout.deko.length).toBe(dekoVorher + 1);
  await a.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await dorf(a)).layout.deko.length).toBe(dekoVorher);

  // Ins Lager und wieder hinstellen
  await a.getByRole('button', { name: /Auswählen/ }).click();
  const bankPt = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), [tx + 1, tz + 2] as const);
  await a.mouse.click(bankPt.x, bankPt.y);
  await a.getByRole('button', { name: /Ins Lager/ }).click();
  await expect.poll(async () => (await dorf(a)).layout.lager).toContain('Bank');
  await expect.poll(async () => (await dorf(a)).layout.gebaeude.Bank).toBeUndefined();
  await a.getByRole('button', { name: /📦 Bank/ }).click();
  const ecke = await a.evaluate(([x, z]) => window.__dorf!.feldPunkt(x, z), [tx, tz] as const);
  await a.mouse.click(ecke.x, ecke.y);
  await expect.poll(async () => (await dorf(a)).layout.gebaeude.Bank).toMatchObject({ x: tx, z: tz });
  expect((await dorf(a)).layout.lager).not.toContain('Bank');
  // Bank wieder an den alten Platz (für folgende Läufe)
  const zurueck = await dorf(a);
  zurueck.layout.gebaeude.Bank = bank;
  await a.request.put('/api/dorf/layout', { data: { basisVersion: zurueck.version, layout: zurueck.layout }, headers: { origin: new URL(a.url()).origin } });
  await a.getByRole('button', { name: 'Bau-Modus beenden' }).click();
  await expect(a.getByRole('toolbar', { name: 'Bau-Werkzeuge' })).toBeHidden();
  await a.context().close();
  await b.context().close();
});

test('Figuren: arbeitender Agent mit Infokarte und Abbrechen; Bürgermeister', async ({ page }) => {
  await imDorf(page);
  const origin = new URL(page.url()).origin;
  const r = await page.request.post('/api/aktionen/starten', { headers: { origin }, data: { id: 'Bibliothek/notizen-zusammenfassen', eingaben: { thema: '<<werkzeug vault_suchen {"anfrage":"Folien"}>> [pause 60000]' } } });
  const { laufId } = (await r.json()) as { laufId: string };
  await page.waitForFunction(() => window.__dorf!.figurenAnzahl() >= 1, null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__dorf!.zustand('Bibliothek')?.rauch ?? 0)).toBeGreaterThan(0);
  await page.evaluate((id) => window.__dorf!.blickAufFigur(id, 12), laufId);
  await page.waitForTimeout(300);
  const pt = (await page.evaluate((id) => window.__dorf!.bildschirmPunkt('figur', id), laufId))!;
  await page.mouse.click(pt.x, pt.y);
  const karte = page.getByRole('dialog', { name: 'Figur' });
  await expect(karte.getByText('Agent in Bibliothek')).toBeVisible();
  await expect(karte.getByText(/Notizen zusammenfassen/)).toBeVisible();
  await expect(karte.getByText('claude-code', { exact: true })).toBeVisible();
  await expect(karte.getByText(/Gerade: 🔎 sucht/)).toBeVisible();
  await expect(karte.getByRole('link', { name: 'Zum Chat' })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await karte.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByText('Dieser Agent ist gerade fertig geworden.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dorf!.zustand('Bibliothek')?.rauch ?? 0)).toBe(0);

  // Bürgermeister steht am Rathaus
  await page.getByRole('button', { name: 'Schließen' }).click();
  await page.evaluate(() => window.__dorf!.blickAufFigur('buergermeister', 12));
  await page.waitForTimeout(300);
  const bm = (await page.evaluate(() => window.__dorf!.bildschirmPunkt('buergermeister')))!;
  await page.mouse.click(bm.x, bm.y);
  await expect(page.getByRole('dialog', { name: 'Figur' }).getByRole('heading', { name: /Bürgermeister/ })).toBeVisible();
});

test('Bürgermeister schickt einen Helfer zur Uni: Figur mit Rucksack, Karte nennt ihn Helfer', async ({ page }, info) => {
  await imDorf(page);
  const origin = new URL(page.url()).origin;
  const r = await page.request.post('/api/schreibtisch', { headers: { origin }, multipart: { text: `Folien vorbereiten ${info.project.name} [helfer Uni|Folien lesen {warte 60000}]` } });
  expect(r.ok()).toBe(true);
  // Status: ein Helfer (Auslöser buergermeister) in der Uni
  await expect
    .poll(async () => ((await (await page.request.get('/api/dorf/status')).json()) as DorfStatus).figuren.find((f) => f.gebaeude === 'Uni' && f.ausloeser === 'buergermeister')?.laufId ?? null, { timeout: 20_000 })
    .not.toBeNull();
  const s = (await (await page.request.get('/api/dorf/status')).json()) as DorfStatus;
  const helfer = s.figuren.find((f) => f.gebaeude === 'Uni' && f.ausloeser === 'buergermeister')!;
  // der Ticker meldet es
  await expect(page.getByRole('list', { name: 'Was im Dorf passiert' }).getByText(/Helfer läuft zur Uni/)).toBeVisible();
  await page.waitForFunction((id) => !!window.__dorf!.bildschirmPunkt('figur', id), helfer.laufId, { timeout: 15_000 });
  await page.evaluate((id) => window.__dorf!.blickAufFigur(id, 12), helfer.laufId);
  await page.waitForTimeout(300);
  // eine Stelle suchen, an der wirklich die Figur getroffen wird
  const pt = await page.evaluate((id) => {
    const m = window.__dorf!.bildschirmPunkt('figur', id)!;
    for (const [dx, dy] of [[0, 0], [0, -6], [0, 6], [-4, 0], [4, 0], [0, -12]] as const) {
      const t = window.__dorf!.treffer({ clientX: m.x + dx, clientY: m.y + dy });
      if (t?.art === 'figur' && t.id === undefined) return { x: m.x + dx, y: m.y + dy };
    }
    return m;
  }, helfer.laufId);
  await page.mouse.click(pt.x, pt.y);
  const karte = page.getByRole('dialog', { name: 'Figur' });
  await expect(karte.getByText('Helfer des Bürgermeisters in Uni')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await karte.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByText('Dieser Agent ist gerade fertig geworden.')).toBeVisible();
});

test('Zeitungs-Knopf: roter Punkt bei neuer Ausgabe, öffnet die Morgenzeitung im Rathaus', async ({ page }) => {
  await imDorf(page);
  const r = await page.request.post('/api/morgenzeitung/erstellen', { headers: { origin: new URL(page.url()).origin }, data: {} });
  expect(r.ok()).toBe(true);
  const neu = page.getByRole('button', { name: 'Morgenzeitung (neue Ausgabe)' });
  await expect(neu).toBeVisible({ timeout: 15_000 });
  await neu.click();
  await expect(page).toHaveURL(/\?g=Rathaus&reiter=morgenzeitung/);
  const menue = page.getByRole('complementary', { name: /Gebäude Rathaus/ });
  await expect(menue.getByRole('heading', { name: /Morgenzeitung –/ })).toBeVisible();
  // gelesen: der Punkt verschwindet (auch nach dem Neuladen)
  await menue.getByRole('button', { name: 'Menü schließen' }).click();
  await expect(page.getByRole('button', { name: 'Morgenzeitung', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Morgenzeitung', exact: true })).toBeVisible({ timeout: 20_000 });
});

test('Rundgang: der von selbst geweckte Bürgermeister läuft durchs Dorf und kehrt danach zum Rathaus zurück', async ({ page }) => {
  await imDorf(page);
  await page.goto('/?animiert');
  await page.waitForFunction(() => !!window.__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 20_000 });
  type Intern = { figuren: { position(id: string): { x: number; z: number } | null }; daten: { status?: DorfStatus }; setzen(d: unknown): void };
  const wo = () => page.evaluate(() => (window.__dorf as unknown as Intern).figuren.position('buergermeister'));
  const start = (await wo())!;
  const weg = async () => {
    const p = (await wo())!;
    return Math.hypot(p.x - start.x, p.z - start.z);
  };
  // Status wie bei einem stündlichen Rundgang (Auslöser zeitplan) – direkt in die Szene, ohne echten Lauf
  const setzeFiguren = (figuren: unknown[]) =>
    page.evaluate((f) => {
      const s = window.__dorf as unknown as Intern;
      s.setzen({ ...s.daten, status: { ...(s.daten.status ?? { jetzt: new Date().toISOString(), gebaeude: {} }), figuren: f } });
    }, figuren);
  await setzeFiguren([
    { laufId: 'rundgang', chatId: 'c', gebaeude: 'Rathaus', titel: 'Rundgang', auftrag: '', motor: 'api', modell: 'm', stufe: 'mittel', status: 'laeuft', ausloeser: 'zeitplan', buergermeister: true, erstellt: new Date().toISOString(), token: 0, kostenUsd: 0 },
  ]);
  await expect.poll(weg, { timeout: 20_000 }).toBeGreaterThan(1.5);
  // fertig: zurück zum Rathaus
  await setzeFiguren([]);
  await expect.poll(weg, { timeout: 60_000, intervals: [1000] }).toBeLessThan(0.05);
});

test('Agent fertig: Ticker meldet ✅ und über dem Gebäude regnet Konfetti', async ({ page }) => {
  await imDorf(page);
  await page.goto('/?animiert');
  await page.waitForFunction(() => !!window.__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 20_000 });
  const r = await page.request.post('/api/aktionen/starten', {
    headers: { origin: new URL(page.url()).origin },
    data: { id: 'Bibliothek/notizen-zusammenfassen', eingaben: { thema: 'Konfetti [warte 7000]' } },
  });
  expect(r.ok()).toBe(true);
  const ticker = page.getByRole('list', { name: 'Was im Dorf passiert' });
  await expect(ticker.getByText(/Agent geht zur Bibliothek/)).toBeVisible({ timeout: 15_000 });
  await expect(ticker.getByText(/Fertig in Bibliothek/)).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window.__dorf as unknown as { konfetti: unknown[] }).konfetti.length)).toBeGreaterThan(0);
});
