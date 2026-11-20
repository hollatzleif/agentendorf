import { expect, test, type Page } from '@playwright/test';

/**
 * E198 – Atelier: der Bildeditor in der App. Desktop und Handy (Pixel 7): Editor öffnen, Ebene anlegen, malen, Filter,
 * Rückgängig, in den Vault speichern (Projekt mit Ebenen und PNG), wieder öffnen, Konfliktkopie; Auswahl, Füllen,
 * Zauberstab, Transformieren, Zuschneiden, Bildgröße, Text, Tastenkürzel; Finger-Gesten; KI-Knöpfe ehrlich ausgegraut.
 */
const PW = 'e2e-Passwort-sehr-lang-1';

interface AtelierTest {
  buehne: {
    zoom: number;
    werkzeug: string;
    opt: { vordergrund: string; hintergrund: string; groesse: number };
    transform: unknown;
    schnitt: { x: number; y: number; b: number; h: number } | null;
    zuAnsicht(p: { x: number; y: number }): { x: number; y: number };
  };
  doc: {
    breite: number;
    hoehe: number;
    aktivId: number;
    geaendert: boolean;
    verlaufPos: number;
    verlauf: { name: string }[];
    ebenen: { id: number; name: string; leinwand: HTMLCanvasElement; sichtbar: boolean; deckkraft: number; modus: string }[];
    aktiv: { name: string; leinwand: HTMLCanvasElement };
    auswahlGrenzen(): { x: number; y: number; b: number; h: number } | null;
    zusammengesetzt(): HTMLCanvasElement;
  };
  sitzung: { pfad: string | null; version: string | null; name: string };
}
declare global {
  interface Window {
    __atelier?: AtelierTest;
  }
}

async function anmelden(page: Page) {
  // „Ungespeicherte Änderungen“ (beim Verlassen bzw. beim Öffnen einer anderen Datei) im Test immer bestätigen
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}
async function imEditor(page: Page, frage = '') {
  await page.goto(`/atelier${frage}`);
  await expect(page.getByTestId('at-leinwand')).toBeVisible();
  await page.waitForFunction(() => !!window.__atelier?.doc && window.__atelier.buehne.zoom !== 1);
}
/** Bildschirmpunkt zu einem Punkt im Bild */
async function punkt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const a = window.__atelier!;
      const r = document.querySelector<HTMLCanvasElement>('[data-testid="at-leinwand"]')!.getBoundingClientRect();
      const s = a.buehne.zuAnsicht({ x: px!, y: py! });
      return { x: r.left + s.x, y: r.top + s.y };
    },
    [x, y],
  );
}
async function ziehen(page: Page, von: [number, number], nach: [number, number], tasten: string[] = []) {
  const a = await punkt(page, ...von);
  const b = await punkt(page, ...nach);
  for (const t of tasten) await page.keyboard.down(t);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
  for (const t of tasten) await page.keyboard.up(t);
}
/** Farbe eines Pixels: der aktiven Ebene oder des fertigen Bildes */
const pixel = (page: Page, x: number, y: number, was: 'ebene' | 'bild' = 'bild') =>
  page.evaluate(
    ([px, py, w]) => {
      const d = window.__atelier!.doc;
      const c = w === 'ebene' ? d.aktiv.leinwand : d.zusammengesetzt();
      return [...c.getContext('2d')!.getImageData(px as number, py as number, 1, 1).data];
    },
    [x, y, was] as const,
  );
const doc = <T>(page: Page, f: (d: AtelierTest['doc'], a: AtelierTest) => T) => page.evaluate(`(${f.toString()})(window.__atelier.doc, window.__atelier)`) as Promise<T>;
async function menue(page: Page, titel: string, punktName: string | RegExp) {
  await page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name: titel, exact: true }).click();
  await page.getByRole('menu', { name: titel }).getByRole('menuitem', { name: punktName }).click();
}
const werkzeug = (page: Page, id: string) => page.locator(`.at-werkzeuge button[data-werkzeug="${id}"]`).click();

test('Atelier: Gebäude → Editor, Ebene anlegen, malen, Filter, Rückgängig, als Projekt und PNG in den Vault speichern, wieder öffnen, Konfliktkopie', async ({ page }, info) => {
  const name = `werk-${info.project.name}`;
  await anmelden(page);
  await expect(page.locator('.gebaeude-karte', { hasText: 'Atelier' }).first()).toBeVisible();
  await page.goto('/gebaeude/Atelier');
  await expect(page.getByRole('heading', { name: '🎨 Atelier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bilder', exact: true })).toHaveClass(/aktiv/);
  // ehrlich: im Testserver gibt es weder Rechenraum noch Cloudflare-Zugang
  await expect(page.getByTestId('atelier-stand')).toContainText('dorf bilder-einrichten');
  await page.getByTestId('atelier-oeffnen').click();
  await expect(page).toHaveURL(/\/atelier$/);
  await expect(page.getByTestId('at-leinwand')).toBeVisible();
  await page.waitForFunction(() => !!window.__atelier?.doc && window.__atelier.buehne.zoom !== 1);
  await expect(page.getByTestId('at-groesse')).toHaveText('1280 × 800 px');
  expect(await pixel(page, 640, 400)).toEqual([255, 255, 255, 255]);

  // Ebene anlegen (über das Menü – geht am PC wie am Handy)
  await menue(page, 'Ebene', 'Neue Ebene');
  expect(await doc(page, (d) => [d.ebenen.length, d.aktiv.name])).toEqual([2, 'Ebene 2']);
  expect(await pixel(page, 640, 400, 'ebene')).toEqual([0, 0, 0, 0]);

  // malen: ein Strich quer durch die Mitte, auf der neuen Ebene
  await werkzeug(page, 'pinsel');
  await ziehen(page, [400, 400], [900, 400]);
  expect(await pixel(page, 640, 400, 'ebene')).toEqual([0x1b, 0x25, 0x38, 255]);
  expect(await pixel(page, 640, 300, 'ebene')).toEqual([0, 0, 0, 0]);
  expect(await doc(page, (d) => d.verlauf[d.verlaufPos]!.name)).toBe('Pinsel');
  // die Hintergrund-Ebene darunter ist unberührt
  expect(await doc(page, (d) => [...d.ebenen[0]!.leinwand.getContext('2d')!.getImageData(640, 400, 1, 1).data])).toEqual([255, 255, 255, 255]);

  // Filter ohne Regler: Invertieren wirkt nur auf die aktive Ebene
  await menue(page, 'Bild', 'Invertieren');
  expect(await pixel(page, 640, 400, 'ebene')).toEqual([255 - 0x1b, 255 - 0x25, 255 - 0x38, 255]);
  // Filter mit Reglern und Vorschau: Weichzeichner macht den harten Rand weich
  const randVorher = await pixel(page, 640, 400 - 16, 'ebene');
  expect(randVorher[3]).toBe(0);
  await menue(page, 'Filter', /Gaußscher Weichzeichner/);
  const regler = page.getByRole('dialog', { name: 'Gaußscher Weichzeichner' });
  await expect(regler).toBeVisible();
  await regler.getByRole('slider', { name: 'Radius (Pixel)' }).fill('8');
  // Vorschau liegt schon im Bild, aber noch nicht im Verlauf
  await expect.poll(async () => (await pixel(page, 640, 400 - 16, 'ebene'))[3]).toBeGreaterThan(0);
  expect(await doc(page, (d) => d.verlauf[d.verlaufPos]!.name)).toBe('Invertieren');
  await regler.getByRole('button', { name: 'Anwenden' }).click();
  await expect(regler).toBeHidden();
  expect(await doc(page, (d) => d.verlauf.map((s) => s.name))).toEqual(['Neu', 'Neue Ebene', 'Pinsel', 'Invertieren', 'Gaußscher Weichzeichner']);
  // Abbrechen eines Filters stellt die Ebene wieder her
  const vorAbbruch = await pixel(page, 640, 400, 'ebene');
  await menue(page, 'Bild', /Helligkeit\/Kontrast/);
  const hk = page.getByRole('dialog', { name: 'Helligkeit/Kontrast' });
  await hk.getByRole('slider', { name: 'Helligkeit' }).fill('-80');
  await expect.poll(() => pixel(page, 640, 400, 'ebene')).not.toEqual(vorAbbruch);
  await hk.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await pixel(page, 640, 400, 'ebene')).toEqual(vorAbbruch);

  // Rückgängig / Wiederholen
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  expect((await pixel(page, 640, 400 - 16, 'ebene'))[3]).toBe(0);
  await page.getByRole('button', { name: 'Wiederholen' }).click();
  expect((await pixel(page, 640, 400 - 16, 'ebene'))[3]).toBeGreaterThan(0);

  // Speichern: noch ohne Ort → Fenster; mit zwei Ebenen ist das Projektformat vorgewählt
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  const sp = page.getByRole('dialog', { name: 'Speichern unter' });
  await expect(sp.getByLabel('Ordner im Vault')).toHaveValue('Atelier/bilder');
  await expect(sp.getByLabel('Format')).toHaveValue('atelier');
  await sp.getByLabel('Name').fill(name);
  await sp.getByRole('button', { name: 'Im Vault speichern' }).click();
  await expect(page.getByTestId('at-hinweis')).toContainText(`Gespeichert: Atelier/bilder/${name}.atelier`);
  await expect(page.getByTestId('at-datei')).toHaveText(`${name}.atelier`);
  expect(await doc(page, (d) => d.geaendert)).toBe(false);
  // die Datei im Vault ist ein ZIP mit projekt.json und den Ebenen als PNG
  const zip = await (await page.request.get(`/api/vault/roh?pfad=Atelier/bilder/${name}.atelier`)).body();
  expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  expect(zip.toString('latin1')).toContain('projekt.json');
  expect(zip.toString('latin1')).toContain('ebene-1.png');
  const mitte = await pixel(page, 640, 400);

  // dazu als PNG (fertiges Bild)
  await menue(page, 'Datei', /Speichern unter/);
  await sp.getByLabel('Format').selectOption('png');
  await sp.getByRole('button', { name: 'Im Vault speichern' }).click();
  await expect(page.getByTestId('at-hinweis')).toContainText(`Gespeichert: Atelier/bilder/${name}.png`);
  const png = await (await page.request.get(`/api/vault/roh?pfad=Atelier/bilder/${name}.png`)).body();
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);

  // im Gebäude erscheinen beide; ein Klick öffnet das Projekt wieder – mit beiden Ebenen und demselben Bild
  await page.goto('/gebaeude/Atelier');
  const liste = page.getByTestId('atelier-bilder');
  await expect(liste.locator('li', { hasText: `${name}.png` })).toBeVisible();
  await liste.locator('li', { hasText: `${name}.atelier` }).locator('a').click();
  await expect(page.getByTestId('at-datei')).toHaveText(`${name}.atelier`);
  await page.waitForFunction(() => window.__atelier?.doc.ebenen.length === 2);
  expect(await doc(page, (d) => d.ebenen.map((e) => e.name))).toEqual(['Hintergrund', 'Ebene 2']);
  expect(await pixel(page, 640, 400)).toEqual(mitte);
  expect(await doc(page, (d) => d.geaendert)).toBe(false);

  // das PNG über „Datei → Öffnen“ aus dem Vault
  await menue(page, 'Datei', /^Öffnen/);
  const oe = page.getByRole('dialog', { name: 'Bild öffnen' });
  await oe.getByRole('searchbox').fill(`${name}.png`);
  await oe.getByTestId('at-vault-liste').getByRole('button', { name: new RegExp(`${name}\\.png`) }).click();
  await expect(page.getByTestId('at-datei')).toHaveText(`${name}.png`);
  await page.waitForFunction(() => window.__atelier?.doc.ebenen.length === 1);
  expect(await pixel(page, 640, 400)).toEqual(mitte);

  // inzwischen ändert jemand anderes die Datei (anderes Gerät, Obsidian) → unser Speichern überschreibt nicht
  const fremd = await page.request.post(`/api/atelier/speichern?pfad=Atelier/bilder/${name}.png`, {
    headers: { origin: new URL(page.url()).origin },
    multipart: { datei: { name: 'x.png', mimeType: 'image/png', buffer: png.subarray(0, png.length) } },
  });
  expect(fremd.ok()).toBe(true);
  const fremdVersion = ((await fremd.json()) as { version: string }).version;
  expect(await doc(page, (_d, a) => a.sitzung.version)).toBe(fremdVersion); // gleicher Inhalt → gleiche Version, noch kein Konflikt
  // jetzt wirklich anderer Inhalt
  const anders = Buffer.concat([png]);
  anders[anders.length - 1] = anders[anders.length - 1]! ^ 0xff;
  await page.request.post(`/api/atelier/speichern?pfad=Atelier/bilder/${name}.png`, { headers: { origin: new URL(page.url()).origin }, multipart: { datei: { name: 'x.png', mimeType: 'image/png', buffer: anders } } });
  await werkzeug(page, 'pinsel');
  await ziehen(page, [200, 200], [300, 260]);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByTestId('at-hinweis')).toContainText('Konfliktkopie');
  const baum = JSON.stringify(await (await page.request.get('/api/vault/baum?pfad=Atelier/bilder')).json());
  expect(baum).toMatch(new RegExp(`${name}\\.konflikt-[0-9-]+\\.png`));
  // das Original ist die fremde Fassung geblieben
  expect((await (await page.request.get(`/api/vault/roh?pfad=Atelier/bilder/${name}.png`)).body()).equals(anders)).toBe(true);

  // E204: „Speichern unter“ auf den vorhandenen Namen fragt erst – abbrechen ändert nichts, bestätigen ersetzt
  const fragen: string[] = [];
  page.removeAllListeners('dialog'); // statt „immer bestätigen“ (anmelden): hier zuerst ablehnen
  page.once('dialog', (d) => {
    fragen.push(d.message());
    void d.dismiss();
  });
  await menue(page, 'Datei', /Speichern unter/);
  await sp.getByLabel('Name').fill(name);
  await sp.getByLabel('Format').selectOption('png');
  await sp.getByRole('button', { name: 'Im Vault speichern' }).click();
  await expect(page.getByTestId('at-hinweis')).toContainText('Nicht gespeichert');
  expect(fragen[0]).toContain(`Atelier/bilder/${name}.png`);
  expect((await (await page.request.get(`/api/vault/roh?pfad=Atelier/bilder/${name}.png`)).body()).equals(anders)).toBe(true);
  page.on('dialog', (d) => void d.accept());
  await sp.getByRole('button', { name: 'Im Vault speichern' }).click();
  await expect(page.getByTestId('at-hinweis')).toContainText(`Gespeichert: Atelier/bilder/${name}.png`);
  expect((await (await page.request.get(`/api/vault/roh?pfad=Atelier/bilder/${name}.png`)).body()).equals(anders)).toBe(false);
});

test('Atelier: Auswahl, Füllen, Zauberstab, Verschieben, Transformieren, Zuschneiden, Bildgröße, Text – mit Photoshop-Tastenkürzeln', async ({ page }) => {
  await anmelden(page);
  await imEditor(page);
  // M: Auswahlrechteck, Alt+Rücktaste füllt mit der Vordergrundfarbe – nur in der Auswahl
  await page.keyboard.press('m');
  await expect(page.getByTestId('atelier')).toHaveAttribute('data-werkzeug', 'auswahl-rechteck');
  await ziehen(page, [200, 150], [500, 450]);
  const g = (await doc(page, (d) => d.auswahlGrenzen()))!;
  expect(Math.abs(g.x - 200) + Math.abs(g.y - 150) + Math.abs(g.b - 300) + Math.abs(g.h - 300)).toBeLessThanOrEqual(16);
  await page.keyboard.press('Alt+Backspace');
  expect(await pixel(page, 350, 300)).toEqual([0x1b, 0x25, 0x38, 255]);
  expect(await pixel(page, 600, 300)).toEqual([255, 255, 255, 255]);
  // Strg+D hebt auf; W: Zauberstab findet die gefüllte Fläche wieder
  await page.keyboard.press('Control+d');
  expect(await doc(page, (d) => d.auswahlGrenzen())).toBeNull();
  await page.keyboard.press('w');
  const p = await punkt(page, 350, 300);
  await page.mouse.click(p.x, p.y);
  const z = (await doc(page, (d) => d.auswahlGrenzen()))!;
  expect([z.x, z.y, z.b, z.h]).toEqual([g.x, g.y, g.b, g.h]);
  // Umschalt + Rechteck fügt hinzu (M, ziehen mit Umschalt)
  await page.keyboard.press('m');
  await ziehen(page, [700, 150], [800, 250], ['Shift']);
  const beide = (await doc(page, (d) => d.auswahlGrenzen()))!;
  expect(beide.x + beide.b).toBeGreaterThan(790);
  expect(beide.x).toBe(g.x);
  await page.keyboard.press('Control+d');

  // V: Verschieben zieht den Inhalt der Auswahl mit
  await page.keyboard.press('w');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('v');
  await ziehen(page, [350, 300], [450, 300]);
  expect(await pixel(page, 220, 300)).toEqual([0, 0, 0, 0]); // dort ist jetzt ein Loch (eine Ebene)
  expect(await pixel(page, 580, 300)).toEqual([0x1b, 0x25, 0x38, 255]);
  expect(Math.abs((await doc(page, (d) => d.auswahlGrenzen()))!.x - (g.x + 100))).toBeLessThanOrEqual(2);
  // Pfeiltasten schieben um 1 bzw. 10 Pixel
  const vorher = (await doc(page, (d) => d.auswahlGrenzen()))!.x;
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowLeft');
  expect((await doc(page, (d) => d.auswahlGrenzen()))!.x).toBe(vorher + 9);

  // Strg+T: frei transformieren – Breite über das Zahlenfeld, Enter wendet an
  await page.keyboard.press('Control+t');
  await expect(page.getByTestId('at-optionen')).toContainText('Transformieren');
  await page.getByTestId('at-optionen').getByLabel('Breite').fill('150');
  await page.getByTestId('at-optionen').getByLabel('Breite').blur();
  await page.keyboard.press('Enter');
  expect(await doc(page, (d) => d.verlauf[d.verlaufPos]!.name)).toBe('Transformieren');
  const schmal = (await doc(page, (d) => d.auswahlGrenzen()))!;
  expect(Math.abs(schmal.b - 150)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+d');

  // C: Zuschneiden mit Rahmen und Enter
  await page.keyboard.press('c');
  await ziehen(page, [300, 100], [900, 500]);
  await expect(page.getByTestId('at-optionen').getByRole('button', { name: /Zuschneiden/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const nachSchnitt = await doc(page, (d) => [d.breite, d.hoehe]);
  // am Handy ist ein Bildschirmpunkt gut drei Bildpunkte breit
  expect(Math.abs(nachSchnitt[0]! - 600) + Math.abs(nachSchnitt[1]! - 400)).toBeLessThanOrEqual(16);

  // Bild → Bildgröße: Seitenverhältnis bleibt
  await menue(page, 'Bild', /Bildgröße/);
  const bg = page.getByRole('dialog', { name: 'Bildgröße' });
  await bg.getByLabel('Breite').fill('300');
  await bg.getByRole('button', { name: 'Anwenden' }).click();
  const klein = await doc(page, (d) => [d.breite, d.hoehe]);
  expect(klein[0]).toBe(300);
  expect(Math.abs(klein[1]! - Math.round((300 * nachSchnitt[1]!) / nachSchnitt[0]!))).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('at-groesse')).toHaveText(`${klein[0]} × ${klein[1]} px`);
  // Strg+Z holt die Größe zurück, Strg+Umschalt+Z stellt sie wieder her
  await page.keyboard.press('Control+z');
  expect(await doc(page, (d) => [d.breite, d.hoehe])).toEqual(nachSchnitt);
  await page.keyboard.press('Control+Shift+z');
  expect(await doc(page, (d) => d.breite)).toBe(300);

  // T: Text setzen → eigene Ebene
  await page.keyboard.press('t');
  const tp = await punkt(page, 40, 40);
  await page.mouse.click(tp.x, tp.y);
  const feld = page.getByRole('textbox', { name: 'Text' });
  await feld.fill('Hallo Dorf');
  await feld.press('Control+Enter');
  await expect(feld).toBeHidden();
  expect(await doc(page, (d) => [d.aktiv.name, d.verlauf[d.verlaufPos]!.name])).toEqual(['Hallo Dorf', 'Text']);
  expect(await doc(page, (d) => { const x = d.aktiv.leinwand.getContext('2d')!.getImageData(0, 0, d.breite, d.hoehe).data; let n = 0; for (let i = 3; i < x.length; i += 4) if (x[i]! > 0) n++; return n; })).toBeGreaterThan(200);

  // Buchstaben sind hier Werkzeuge – die Sprung-Kürzel des Dorfs („g h“ = Heute) greifen im Editor nicht
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(page).toHaveURL(/\/atelier$/);
  await expect(page.getByTestId('atelier')).toHaveAttribute('data-werkzeug', 'hand');
  // B, E und X/D
  await page.keyboard.press('b');
  await expect(page.getByTestId('atelier')).toHaveAttribute('data-werkzeug', 'pinsel');
  await page.keyboard.press('x');
  expect(await doc(page, (_d, a) => [a.buehne.opt.vordergrund, a.buehne.opt.hintergrund])).toEqual(['#ffffff', '#1b2538']);
  await page.keyboard.press('d');
  expect(await doc(page, (_d, a) => a.buehne.opt.vordergrund)).toBe('#000000');
  // ungespeicherte Arbeit bleibt, wenn man im Dorf woanders hingeht und zurückkommt
  await page.getByRole('link', { name: 'Heute' }).click();
  await expect(page).toHaveURL(/\/heute/);
  await page.goBack();
  await expect(page.getByTestId('at-leinwand')).toBeVisible();
  expect(await doc(page, (d) => [d.breite, d.aktiv.name])).toEqual([300, 'Hallo Dorf']);
});

test('Atelier: Ebenen-Fenster (Deckkraft, Mischmodus, Sichtbarkeit, Reihenfolge), Radierer, Füllen, Form, Verlauf', async ({ page }, info) => {
  await anmelden(page);
  await imEditor(page);
  // am Handy liegt das Ebenen-Fenster hinter einem Knopf
  if (info.project.name === 'handy') await page.getByRole('button', { name: 'Ebenen, Farbe, Verlauf' }).click();
  const ebenen = page.getByTestId('ebenen');
  await ebenen.getByRole('button', { name: 'Neue Ebene' }).click();
  await expect(ebenen.locator('li')).toHaveCount(2);
  // Füllen (Eimer) färbt die leere Ebene ganz
  await page.evaluate(() => (window.__atelier!.buehne.opt.vordergrund = '#ff0000'));
  if (info.project.name === 'handy') await page.getByRole('button', { name: 'Ebenen, Farbe, Verlauf' }).click();
  await werkzeug(page, 'fuellen');
  const m = await punkt(page, 640, 400);
  await page.mouse.click(m.x, m.y);
  expect(await pixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  if (info.project.name === 'handy') await page.getByRole('button', { name: 'Ebenen, Farbe, Verlauf' }).click();
  // Mischmodus Multiplizieren auf Weiß bleibt Rot; Deckkraft 50 % mischt mit Weiß
  await ebenen.getByLabel('Mischmodus').selectOption('multiply');
  expect(await pixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await ebenen.getByLabel('Deckkraft der Ebene').fill('50');
  const halb = await pixel(page, 100, 100);
  expect(halb[0]).toBe(255);
  expect(Math.abs(halb[1]! - 128)).toBeLessThanOrEqual(2);
  // ausblenden → Weiß; Reihenfolge tauschen → Rot liegt unter dem weißen Hintergrund
  await ebenen.getByRole('button', { name: 'Ebene 2 ausblenden' }).click();
  expect(await pixel(page, 100, 100)).toEqual([255, 255, 255, 255]);
  await ebenen.getByRole('button', { name: 'Ebene 2 einblenden' }).click();
  await ebenen.getByRole('button', { name: 'Ebene nach unten' }).click();
  expect(await doc(page, (d) => d.ebenen.map((e) => e.name))).toEqual(['Ebene 2', 'Hintergrund']);
  expect(await pixel(page, 100, 100)).toEqual([255, 255, 255, 255]);
  await ebenen.getByRole('button', { name: 'Ebene nach oben' }).click();
  // duplizieren, vereinen, löschen
  await ebenen.getByRole('button', { name: 'Ebene duplizieren' }).click();
  await expect(ebenen.locator('li')).toHaveCount(3);
  await ebenen.getByRole('button', { name: 'Nach unten vereinen' }).click();
  await expect(ebenen.locator('li')).toHaveCount(2);
  if (info.project.name === 'handy') await page.getByRole('button', { name: 'Ebenen, Farbe, Verlauf' }).click();

  // Radierer macht die rote Ebene durchsichtig
  await werkzeug(page, 'radierer');
  await ziehen(page, [300, 300], [500, 300]);
  expect((await pixel(page, 400, 300, 'ebene'))[3]).toBe(0);
  expect((await pixel(page, 400, 500, 'ebene'))[3]).toBeGreaterThan(0);
  // Form: gefülltes Rechteck in Blau
  await page.evaluate(() => (window.__atelier!.buehne.opt.vordergrund = '#0000ff'));
  await werkzeug(page, 'form');
  await ziehen(page, [800, 100], [1000, 250]);
  const blau = await pixel(page, 900, 170, 'ebene');
  expect(blau[2]).toBeGreaterThan(200);
  expect(blau[0]).toBeLessThan(140);
  // Verlauf: links Vordergrund, rechts Hintergrund (Ebene ist halb deckend → Ebene selbst prüfen)
  await page.evaluate(() => Object.assign(window.__atelier!.buehne.opt, { vordergrund: '#000000', hintergrund: '#ffffff', deckkraft: 100 }));
  await werkzeug(page, 'verlauf');
  await ziehen(page, [100, 400], [1180, 400]);
  const links = await pixel(page, 120, 400, 'ebene');
  const rechts = await pixel(page, 1160, 400, 'ebene');
  expect(links[0]).toBeLessThan(30);
  expect(rechts[0]).toBeGreaterThan(225);
  expect(await doc(page, (d) => d.verlauf.map((s) => s.name).slice(-3))).toEqual(['Radierer', 'Rechteck', 'Verlauf']);
});

test('Atelier am Finger: ein Finger malt, zwei Finger zoomen und verschieben (und malen nicht)', async ({ page }) => {
  await anmelden(page);
  await imEditor(page);
  await werkzeug(page, 'pinsel');
  const a = await punkt(page, 300, 300);
  const b = await punkt(page, 600, 300);
  const finger = (art: string, id: number, x: number, y: number) =>
    page.evaluate(
      ([t, i, px, py]) => {
        const c = document.querySelector('[data-testid="at-leinwand"]')!;
        c.dispatchEvent(new PointerEvent(t as string, { pointerId: i as number, pointerType: 'touch', isPrimary: i === 11, clientX: px as number, clientY: py as number, bubbles: true, cancelable: true, buttons: t === 'pointerup' ? 0 : 1 }));
      },
      [art, id, x, y] as const,
    );
  // ein Finger: Strich
  await finger('pointerdown', 11, a.x, a.y);
  for (let i = 1; i <= 6; i++) await finger('pointermove', 11, a.x + ((b.x - a.x) * i) / 6, a.y);
  await finger('pointerup', 11, b.x, b.y);
  expect((await pixel(page, 450, 300))[0]).toBe(0x1b);
  const schritte = await doc(page, (d) => d.verlauf.length);
  // zwei Finger auseinander: Zoom wächst, es entsteht kein Strich und kein Verlaufsschritt
  const zoom = await doc(page, (_d, x) => x.buehne.zoom);
  const c1 = await punkt(page, 600, 500);
  await finger('pointerdown', 11, c1.x - 20, c1.y);
  await finger('pointerdown', 12, c1.x + 20, c1.y);
  for (let i = 1; i <= 5; i++) {
    await finger('pointermove', 11, c1.x - 20 - i * 12, c1.y);
    await finger('pointermove', 12, c1.x + 20 + i * 12, c1.y);
  }
  await finger('pointerup', 11, c1.x - 80, c1.y);
  await finger('pointerup', 12, c1.x + 80, c1.y);
  expect(await doc(page, (_d, x) => x.buehne.zoom)).toBeGreaterThan(zoom * 2);
  expect(await doc(page, (d) => d.verlauf.length)).toBe(schritte);
  expect(await pixel(page, 600, 500)).toEqual([255, 255, 255, 255]);
  // „Einpassen“ holt das ganze Bild zurück
  await page.getByTestId('at-zoom').click();
  expect(Math.abs((await doc(page, (_d, x) => x.buehne.zoom)) - zoom)).toBeLessThan(0.01);
});

test('Atelier: KI-Funktionen sind ehrlich – ohne Rechenraum und ohne Cloudflare-Zugang ausgegraut, mit Grund', async ({ page }) => {
  await anmelden(page);
  await imEditor(page);
  await page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name: 'KI', exact: true }).click();
  const ki = page.getByRole('menu', { name: 'KI' });
  for (const t of ['ki-hintergrund', 'ki-hochskalieren', 'ki-generieren', 'ki-fuellen']) await expect(ki.getByTestId(t)).toHaveAttribute('aria-disabled', 'true');
  await expect(ki.getByTestId('ki-generieren')).toHaveAttribute('title', /dorf bilder-einrichten/);
  // ein Klick auf einen ausgegrauten Punkt sagt, warum
  await ki.getByTestId('ki-generieren').click({ force: true });
  await expect(page.getByTestId('at-hinweis')).toContainText('dorf bilder-einrichten');
  await page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name: 'KI', exact: true }).click();
  await page.getByRole('menu', { name: 'KI' }).getByTestId('ki-hintergrund').click({ force: true });
  await expect(page.getByTestId('at-hinweis')).toContainText('Rechenraum');
  // nichts ist passiert
  expect(await doc(page, (d) => d.verlauf.length)).toBe(1);
});

test('Atelier im 3D-Dorf: das Gebäude steht da und führt zu den Bildern', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible({ timeout: 30_000 });
  type Dorf = { bildschirmPunkt(art: string, id?: string): { x: number; y: number } | null; blickAuf(x: number, z: number, abstand?: number): void };
  const w = () => (window as unknown as { __dorf?: Dorf }).__dorf;
  await page.waitForFunction(() => !!(window as unknown as { __dorf?: { bildschirmPunkt(a: string, i: string): unknown } }).__dorf?.bildschirmPunkt('gebaeude', 'Rathaus'), null, { timeout: 30_000 });
  const plan = (await (await page.request.get('/api/dorf')).json()) as { layout: { gebaeude: Record<string, { x: number; z: number }> } };
  const ort = plan.layout.gebaeude.Atelier!;
  expect(ort).toBeTruthy();
  await page.evaluate(`(${w.toString()})().blickAuf(${ort.x + 2}, ${ort.z + 2}, 16)`);
  await page.waitForTimeout(600);
  const pt = (await page.evaluate(`(${w.toString()})().bildschirmPunkt('gebaeude', 'Atelier')`)) as { x: number; y: number } | null;
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  const knoepfe = page.getByRole('group', { name: 'Gebäude Atelier' });
  await expect(knoepfe).toBeVisible();
  await expect(knoepfe.getByRole('button', { name: 'Bilder' })).toBeVisible();
});
