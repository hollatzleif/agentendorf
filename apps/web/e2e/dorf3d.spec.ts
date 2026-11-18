import { expect, test, type Page } from '@playwright/test';
import { belegungBerechnen, feldSchluessel, type DorfAntwort, type DorfLayout, type DorfStatus } from '@dorf/shared';

const PW = 'e2e-Passwort-sehr-lang-1';
// 3D mit Software-Grafik ist im Testbrowser langsam
test.describe.configure({ timeout: 90_000 });

interface DorfTest {
  bildschirmPunkt(art: string, id?: string): { x: number; y: number } | null;
  feldPunkt(x: number, z: number): { x: number; y: number };
  feldUnter(e: { clientX: number; clientY: number }): [number, number] | null;
  layoutStand(): DorfLayout | null;
  zustand(id: string): { rot: boolean; blasen: string; rauch: number } | null;
  blickAuf(x: number, z: number, abstand?: number): void;
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
  await expect(page).toHaveURL(/\?g=Uni/);
  const menue = page.getByRole('complementary', { name: /Gebäude Uni/ });
  await expect(menue.getByRole('heading', { name: /Uni/ })).toBeVisible();
  await menue.getByRole('button', { name: 'Übersicht' }).click();
  await expect(menue.getByRole('heading', { name: /Uni – Arbeitsanweisung/ })).toBeVisible();
  await menue.getByRole('button', { name: 'Menü schließen' }).click();
  await expect(menue).toBeHidden();

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
});

test('Figuren: arbeitender Agent mit Infokarte und Abbrechen; Bürgermeister', async ({ page }) => {
  await imDorf(page);
  const origin = new URL(page.url()).origin;
  const r = await page.request.post('/api/aktionen/starten', { headers: { origin }, data: { id: 'Bibliothek/notizen-zusammenfassen', eingaben: { thema: '[warte 60000]' } } });
  const { laufId } = (await r.json()) as { laufId: string };
  await page.waitForFunction(() => window.__dorf!.figurenAnzahl() >= 1, null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__dorf!.zustand('Bibliothek')?.rauch ?? 0)).toBeGreaterThan(0);
  const l = (await dorf(page)).layout.gebaeude.Bibliothek!;
  await page.evaluate(([x, z]) => window.__dorf!.blickAuf(x, z, 12), [l.x + 2, l.z + 3] as const);
  await page.waitForTimeout(300);
  const pt = (await page.evaluate((id) => window.__dorf!.bildschirmPunkt('figur', id), laufId))!;
  await page.mouse.click(pt.x, pt.y);
  const karte = page.getByRole('dialog', { name: 'Figur' });
  await expect(karte.getByText('Agent in Bibliothek')).toBeVisible();
  await expect(karte.getByText(/Notizen zusammenfassen/)).toBeVisible();
  await expect(karte.getByText('claude-code', { exact: true })).toBeVisible();
  await expect(karte.getByRole('link', { name: 'Zum Chat' })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await karte.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByText('Dieser Agent ist gerade fertig geworden.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dorf!.zustand('Bibliothek')?.rauch ?? 0)).toBe(0);

  // Bürgermeister steht am Rathaus
  await page.getByRole('button', { name: 'Schließen' }).click();
  const r2 = (await dorf(page)).layout.gebaeude.Rathaus!;
  await page.evaluate(([x, z]) => window.__dorf!.blickAuf(x, z, 12), [r2.x + 1, r2.z + 3] as const);
  await page.waitForTimeout(300);
  const bm = (await page.evaluate(() => window.__dorf!.bildschirmPunkt('buergermeister')))!;
  await page.mouse.click(bm.x, bm.y);
  await expect(page.getByRole('dialog', { name: 'Figur' }).getByRole('heading', { name: /Bürgermeister/ })).toBeVisible();
});
