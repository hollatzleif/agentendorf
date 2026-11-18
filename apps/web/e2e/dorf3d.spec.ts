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
  vorspulen(sekunden: number): void;
  uhrzeiger(id: string): { stunde: number[]; minute: number[] } | null;
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
  const bmKarte = page.getByRole('dialog', { name: 'Figur' });
  await expect(bmKarte.getByRole('heading', { name: /Bürgermeister/ })).toBeVisible();
  // ruht er gerade, nennt die Karte die nächste Runde und das Tagesbudget (läuft er, Status und Chat)
  await expect(bmKarte.getByText(/Nächste Runde|Status/).first()).toBeVisible();
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

  // neue Ausgabe, diesmal auf der vollen Rathaus-Seite gelesen → im Dorf kein Punkt mehr
  await page.request.post('/api/morgenzeitung/erstellen', { headers: { origin: new URL(page.url()).origin }, data: {} });
  await page.evaluate(() => localStorage.removeItem('dorf-zeitung-gelesen'));
  await page.goto('/gebaeude/Rathaus?reiter=morgenzeitung');
  await expect(page.getByRole('heading', { name: /Morgenzeitung –/ })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Morgenzeitung', exact: true })).toBeVisible({ timeout: 20_000 });
});

test('Rundgang: der von selbst geweckte Bürgermeister läuft durchs Dorf und kehrt danach zum Rathaus zurück', async ({ page }) => {
  await imDorf(page);
  await page.goto('/?animiert');
  await page.waitForFunction(() => !!window.__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 20_000 });
  type Intern = { figuren: { position(id: string): { x: number; z: number } | null }; daten: { status?: DorfStatus }; setzen(d: unknown): void };
  const wo = () => page.evaluate(() => (window.__dorf as unknown as Intern).figuren.position('buergermeister'));
  let start = (await wo())!;
  const weg = async () => {
    const p = (await wo())!;
    return Math.hypot(p.x - start.x, p.z - start.z);
  };
  // Status wie bei einem stündlichen Rundgang (Auslöser zeitplan) – ohne echten Lauf. Auch neu geladene Stände
  // (Live-Ereignisse anderer Läufe) liefern nur diese Figuren, sonst überschreibt der echte Status die Probe.
  let figurenJetzt: unknown[] = [];
  await page.route('**/api/dorf/status', async (route) => {
    const echt = (await (await route.fetch()).json()) as DorfStatus;
    await route.fulfill({ json: { ...echt, figuren: figurenJetzt } });
  });
  const setzeFiguren = (figuren: unknown[]) => {
    figurenJetzt = figuren;
    return page.evaluate((f) => {
      const s = window.__dorf as unknown as Intern;
      s.setzen({ ...s.daten, status: { ...(s.daten.status ?? { jetzt: new Date().toISOString(), gebaeude: {} }), figuren: f } });
    }, figuren);
  };
  // Ausgangslage: Bürgermeister zu Hause (ein echter Lauf aus einem früheren Test – z. B. seine Fortsetzung nach
  // dem Ende seiner Helfer – kann ihn gerade noch unterwegs zeigen)
  await setzeFiguren([]);
  await page.evaluate((x) => window.__dorf!.vorspulen(x), 90);
  start = (await wo())!;
  await setzeFiguren([
    { laufId: 'rundgang', chatId: 'c', gebaeude: 'Rathaus', titel: 'Rundgang', auftrag: '', motor: 'api', modell: 'm', stufe: 'mittel', status: 'laeuft', ausloeser: 'zeitplan', buergermeister: true, erstellt: new Date().toISOString(), token: 0, kostenUsd: 0 },
  ]);
  // vorspulen statt warten: in der CI schafft die Software-Grafik oft nur ein Bild pro Sekunde
  const spulen = (sek: number) => page.evaluate((x) => window.__dorf!.vorspulen(x), sek);
  await spulen(6);
  expect(await weg()).toBeGreaterThan(1.5);
  // fertig: zurück zum Rathaus
  await setzeFiguren([]);
  await spulen(90);
  expect(await weg()).toBeLessThan(0.05);
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

test('Wetter: Schild oben rechts, Tipp zeigt die Wetterkarte; Regen im Dorf ohne Fehler', async ({ page }) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.route('**/api/dorf/status', async (route) => {
    const echt = (await (await route.fetch()).json()) as DorfStatus;
    await route.fulfill({ json: { ...echt, wetter: { art: 'regen', temperatur: 7.2, tag: { art: 'regen', min: 6, max: 14, regen: 93 }, stand: '2026-11-18T08:00' } } });
  });
  await imDorf(page);
  const schild = page.getByRole('button', { name: /Wetter in Konstanz: Regen, 7 Grad/ });
  await expect(schild).toBeVisible();
  await schild.click();
  const karte = page.getByRole('dialog', { name: 'Wetter in Konstanz' });
  await expect(karte).toContainText('6–14 °C · Regen 93 %');
  await expect(karte).toContainText('Schirm mitnehmen');
  await schild.click();
  await expect(karte).toBeHidden();
  expect(fehler).toEqual([]);
});

test('„Neu im Dorf“ erscheint einmal und bleibt nach „Alles klar“ weg', async ({ page }) => {
  // im Testbrowser ist die Karte sonst aus (navigator.webdriver) – hier ausdrücklich an
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await imDorf(page);
  const karte = page.getByRole('region', { name: 'Neu im Dorf' });
  await expect(karte).toBeVisible();
  await expect(karte).toContainText('dorf moodle-browser-zugang');
  await karte.getByRole('button', { name: 'Alles klar' }).click();
  await expect(karte).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible();
  await expect(karte).toBeHidden();
});

test('Knopf „Agenten“: Übersicht der laufenden Agenten, „Zeigen“ springt zur Figur', async ({ page }) => {
  await imDorf(page);
  const agenten = page.getByRole('button', { name: 'Agenten' });
  await agenten.click();
  const karte = page.getByRole('dialog', { name: 'Laufende Agenten' });
  await expect(karte).toBeVisible();
  await karte.getByRole('button', { name: 'Schließen' }).click();
  await expect(karte).toBeHidden();

  const r = await page.request.post('/api/aktionen/starten', {
    headers: { origin: new URL(page.url()).origin },
    data: { id: 'Bibliothek/notizen-zusammenfassen', eingaben: { thema: 'Übersicht [warte 60000]' } },
  });
  const { laufId, chatId } = (await r.json()) as { laufId: string; chatId: string };
  await expect(agenten).toContainText(/\d/, { timeout: 15_000 }); // Zahl am Knopf
  await agenten.click();
  const eintrag = karte.getByRole('listitem').filter({ hasText: 'Notizen zusammenfassen' }).first();
  await expect(eintrag).toContainText('Bibliothek');
  await expect(eintrag.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', `/chats/${chatId}`);
  await page.waitForFunction((id) => !!window.__dorf!.bildschirmPunkt('figur', id), laufId, { timeout: 15_000 });
  await eintrag.getByRole('button', { name: 'Zeigen' }).click();
  await expect(karte).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Figur' }).getByText('Agent in Bibliothek')).toBeVisible();
  await page.request.post(`/api/laeufe/${laufId}/abbrechen`, { headers: { origin: new URL(page.url()).origin } });
});

test('Kirchturm: Turmuhr auf vier Seiten zeigt die Wiener Zeit; Häuschen stehen im Dorf und sind im Bau-Menü', async ({ page }) => {
  await imDorf(page);
  const origin = new URL(page.url()).origin;
  // Die Vorlage bringt den Kirchturm mit; fehlt er (ältere Vorlage), legt der Test ihn an
  const liste = (await (await page.request.get('/api/gebaeude')).json()) as { id: string }[];
  if (!liste.some((g) => g.id === 'Kirchturm')) {
    const r = await page.request.put('/api/vault/datei', {
      headers: { origin },
      data: { pfad: 'Kirchturm/gebaeude.md', inhalt: '---\nname: Kirchturm\nsymbol: "⛪"\nstatus: offen\n---\n\n# Kirchturm\n', neu: true },
    });
    expect(r.ok()).toBe(true);
  }
  await expect.poll(async () => !!(await dorf(page)).layout.gebaeude.Kirchturm).toBe(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__dorf?.uhrzeiger('Kirchturm'), null, { timeout: 20_000 });
  const stand = await page.evaluate(() => {
    const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':');
    return { h: Number(teile[0]), m: Number(teile[1]), zeiger: window.__dorf!.uhrzeiger('Kirchturm')! };
  });
  expect(stand.zeiger.stunde).toHaveLength(4);
  expect(stand.zeiger.minute).toHaveLength(4);
  // Minutenwechsel zwischen Stellen und Lesen: eine Minute Spielraum (6° Minute, 0,5° Stunde)
  const abstand = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const minute = stand.zeiger.minute[0]!;
  const stunde = stand.zeiger.stunde[0]!;
  expect(abstand(minute, stand.m * 6)).toBeLessThanOrEqual(6.01);
  expect(abstand(stunde, ((stand.h % 12) + stand.m / 60) * 30)).toBeLessThanOrEqual(0.51);
  // alle vier Seiten zeigen dasselbe
  for (const w of stand.zeiger.minute) expect(abstand(w, minute)).toBeLessThan(0.01);
  for (const w of stand.zeiger.stunde) expect(abstand(w, stunde)).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.__dorf!.bildschirmPunkt('gebaeude', 'Kirchturm'))).not.toBeNull();

  // verstreute Häuschen (2 × 2 Felder) und die neuen Deko-Arten im Bau-Menü
  const l = (await dorf(page)).layout;
  const haeuser = l.deko.filter((d) => d.art === 'haeuschen');
  expect(haeuser.length).toBeGreaterThanOrEqual(4);
  // das vorderste Häuschen (die Kamera schaut von +x/+z) – davor steht kein Gebäude, das den Klick abfängt
  const h = [...haeuser].sort((a, b) => b.x + b.z - (a.x + a.z))[0]!;
  await page.getByRole('button', { name: 'Bauen' }).click();
  const leiste = page.getByRole('toolbar', { name: 'Bau-Werkzeuge' });
  await expect(leiste.getByRole('button', { name: 'Häuschen' })).toBeAttached();
  for (const name of ['Gartenzaun', 'Briefkasten', 'Holzstapel', 'Bienenstock', 'Seerosenteich']) await expect(leiste.getByRole('button', { name })).toBeAttached();
  // ein Häuschen an einem seiner vier Felder antippen wählt es aus
  await page.evaluate(([x, z]) => window.__dorf!.blickAuf(x + 1, z + 1, 16), [h.x, h.z] as const);
  await page.waitForTimeout(300);
  const p = await page.evaluate(([x, z]) => window.__dorf!.feldPunkt(x + 1, z + 1), [h.x, h.z] as const);
  await page.mouse.click(p.x, p.y);
  await expect(leiste.locator('.bau-auswahl')).toHaveText('Häuschen');
  await page.getByRole('button', { name: 'Bau-Modus beenden' }).click();
});
