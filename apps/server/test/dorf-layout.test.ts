import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRUNDSTUECK,
  VERSTREUT_STAND,
  belegungBerechnen,
  dekoFelder,
  dekoVerstreuen,
  fehlendePlatzieren,
  feldSchluessel,
  grundstueckFelder,
  layoutPruefen,
  standardLayout,
  type DorfAntwort,
  type DorfLayout,
  type DorfStatus,
} from '@dorf/shared';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-sehr-langes-testpasswort';
const VORLAGE = ['Rathaus', 'Uni', 'Post', 'Marktplatz', 'Bibliothek', 'Corpshaus', 'Bank', 'Boerse', 'Einkaufsladen', 'Kirchturm'];

async function angemeldet() {
  const d = await testDorf();
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  const ereignisse: unknown[] = [];
  d.hub.anmelden({ sitzungId: 'x', senden: (t) => ereignisse.push(JSON.parse(t)), schliessen: () => undefined });
  return { ...d, h: { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) }, ereignisse };
}

const kopie = (l: DorfLayout): DorfLayout => JSON.parse(JSON.stringify(l));

describe('Dorf-Layout (gemeinsame Regeln)', () => {
  it('Standardlayout: alle Gebäude auf eigenen Grundstücken, mit Straßen verbunden, nichts doppelt', () => {
    const l = standardLayout(VORLAGE);
    expect(Object.keys(l.gebaeude).sort()).toEqual([...VORLAGE].sort());
    expect(layoutPruefen(l, new Set(VORLAGE))).toBeNull();
    // Rathaus (erstes Gebäude) liegt in der Mitte
    const r = l.gebaeude.Rathaus!;
    expect(Math.abs(r.x + GRUNDSTUECK / 2)).toBeLessThanOrEqual(3);
    // jedes Grundstück hat eine Straße direkt daneben
    const { belegung } = belegungBerechnen(l);
    for (const g of Object.values(l.gebaeude)) {
      const nachbarn = [];
      for (let i = 0; i < GRUNDSTUECK; i++) nachbarn.push([g.x + i, g.z + GRUNDSTUECK], [g.x - 1, g.z + i]);
      expect(nachbarn.some(([x, z]) => belegung.get(feldSchluessel(x!, z!))?.art === 'strasse')).toBe(true);
    }
    expect(l.wasser.length).toBeGreaterThan(0); // Park
  });

  it('Prüfung: Überlappung, Grenzen, unbekannte Gebäude, Lager, Deko-Arten', () => {
    const l = standardLayout(['Rathaus', 'Uni']);
    const ok = new Set(['Rathaus', 'Uni']);
    const a = kopie(l);
    a.gebaeude.Uni = { ...a.gebaeude.Rathaus!, x: a.gebaeude.Rathaus!.x + 2 };
    expect(layoutPruefen(a, ok)).toMatch(/doppelt belegt/);
    const b = kopie(l);
    b.strassen.push([...b.strassen[0]!]);
    expect(layoutPruefen(b, ok)).toMatch(/doppelt belegt/);
    const c = kopie(l);
    c.gebaeude.Uni = { x: 58, z: 0, dreh: 0 };
    expect(layoutPruefen(c, ok)).toMatch(/außerhalb/);
    const e = kopie(l);
    e.gebaeude.Fremd = { x: 30, z: 30, dreh: 0 };
    expect(layoutPruefen(e, ok)).toMatch(/Unbekanntes Gebäude/);
    const f = kopie(l);
    f.lager.push('Uni');
    expect(layoutPruefen(f, ok)).toMatch(/im Dorf und im Lager/);
    const g = kopie(l);
    g.deko.push({ art: 'ufo' as never, x: 40, z: 40, dreh: 0 });
    expect(layoutPruefen(g, ok)).toMatch(/Unbekannte Deko/);
    const h = kopie(l);
    h.deko.push({ art: 'baum', x: l.strassen[0]![0], z: l.strassen[0]![1], dreh: 0 });
    expect(layoutPruefen(h, ok)).toMatch(/doppelt belegt/);
  });

  it('neue Gebäude kommen auf freie Grundstücke, Gebäude im Lager bleiben dort', () => {
    const l = standardLayout(['Rathaus']);
    l.lager.push('Alt');
    expect(fehlendePlatzieren(l, ['Rathaus', 'Alt', 'Neu1', 'Neu2'])).toBe(true);
    expect(l.gebaeude.Alt).toBeUndefined();
    expect(l.gebaeude.Neu1 && l.gebaeude.Neu2).toBeTruthy();
    expect(layoutPruefen(l, new Set(['Rathaus', 'Alt', 'Neu1', 'Neu2']))).toBeNull();
    expect(fehlendePlatzieren(l, ['Rathaus', 'Alt', 'Neu1', 'Neu2'])).toBe(false);
  });
});

describe('Dorf-Layout auf dem Server', () => {
  it('nur angemeldet; erstes Laden legt das Standarddorf an', async () => {
    const d = await angemeldet();
    expect((await d.app.inject({ url: '/api/dorf' })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: { cookie: d.h.cookie }, payload: {} })).statusCode).toBe(403); // ohne Origin
    const a = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    expect(a.version).toBe(1);
    expect(Object.keys(a.layout.gebaeude).sort()).toEqual([...VORLAGE].sort());
    // zweites Laden ändert nichts
    expect(((await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort).version).toBe(1);
  });

  it('Speichern: Version steigt, Live-Ereignis; veraltete Version → 409 mit aktuellem Stand; Unsinn → 400', async () => {
    const d = await angemeldet();
    const a = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    const l = kopie(a.layout);
    l.gebaeude.Bank = { x: 30, z: 30, dreh: 2 };
    l.deko.push({ art: 'laterne', x: 25, z: 25, dreh: 0 });
    const r = await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 1, layout: l } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ version: 2, layout: { gebaeude: { Bank: { x: 30, z: 30, dreh: 2 } } } });
    expect(d.ereignisse).toContainEqual({ typ: 'dorf.geaendert', version: 2 });

    // zweites Gerät hat noch Version 1
    const alt = kopie(a.layout);
    alt.lager.push('Boerse');
    delete alt.gebaeude.Boerse;
    const k = await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 1, layout: alt } });
    expect(k.statusCode).toBe(409);
    expect(k.json()).toMatchObject({ version: 2, layout: { gebaeude: { Bank: { x: 30, z: 30 } } } });
    expect(((await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort).layout.gebaeude.Boerse).toBeTruthy();

    const kaputt = kopie(l);
    kaputt.gebaeude.Uni = { ...kaputt.gebaeude.Bank! };
    const f = await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 2, layout: kaputt } });
    expect(f.statusCode).toBe(400);
    expect(f.json().fehler).toMatch(/doppelt belegt/);
    expect((await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 2, layout: { gebaeude: 'x' } } })).statusCode).toBe(400);

    // Entfernen = ins Lager; der Ordner im Vault bleibt
    const ohne = kopie(l);
    delete ohne.gebaeude.Boerse;
    ohne.lager.push('Boerse');
    const e = await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 2, layout: ohne } });
    expect(e.json()).toMatchObject({ version: 3, layout: { lager: ['Boerse'] } });
    expect(fs.existsSync(path.join(d.vault.wurzel, 'Boerse/gebaeude.md'))).toBe(true);
    expect(((await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort).layout.gebaeude.Boerse).toBeUndefined();
  });

  it('neues Gebäude im Vault wird beim Laden platziert; fehlt ein Gebäude beim Speichern, setzt der Server es wieder hin', async () => {
    const d = await angemeldet();
    await d.app.inject({ url: '/api/dorf', headers: d.h });
    fs.mkdirSync(path.join(d.vault.wurzel, 'Sternwarte'));
    fs.writeFileSync(path.join(d.vault.wurzel, 'Sternwarte/gebaeude.md'), '---\nname: Sternwarte\n---\n');
    const a = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    expect(a.version).toBe(2);
    expect(a.layout.gebaeude.Sternwarte).toBeTruthy();
    expect(layoutPruefen(a.layout, new Set([...VORLAGE, 'Sternwarte']))).toBeNull();

    const l = kopie(a.layout);
    delete l.gebaeude.Post; // altes Gerät kennt Post (noch) nicht
    const r = (await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 2, layout: l } })).json() as DorfAntwort;
    expect(r.layout.gebaeude.Post).toBeTruthy();
  });
});

/** Layout, wie es vor E72 gespeichert wurde: ohne verstreute Deko und ohne Markierung */
function altesLayout(ids = VORLAGE): DorfLayout {
  const l = standardLayout(ids);
  l.deko = l.deko.filter((d) => !d.auto);
  delete l.verstreut;
  return l;
}
const ringUm = (g: { x: number; z: number }) => {
  const f: string[] = [];
  for (let x = g.x - 1; x <= g.x + GRUNDSTUECK; x++) for (let z = g.z - 1; z <= g.z + GRUNDSTUECK; z++) f.push(feldSchluessel(x, z));
  return f;
};

describe('Häuschen und verstreute Deko (E72)', () => {
  it('Häuschen belegen 2 × 2 Felder: Überlappung und Dorfrand werden erkannt', () => {
    const ok = new Set(['Rathaus']);
    const l = standardLayout(['Rathaus']);
    l.deko = [];
    l.deko.push({ art: 'haeuschen', x: 40, z: 40, dreh: 0 });
    expect(dekoFelder(l.deko[0]!)).toEqual([[40, 40], [40, 41], [41, 40], [41, 41]]);
    expect(layoutPruefen(l, ok)).toBeNull();
    expect(belegungBerechnen(l).belegung.get(feldSchluessel(41, 41))).toEqual({ art: 'deko', index: 0 });
    const a = kopie(l);
    a.deko.push({ art: 'baum', x: 41, z: 41, dreh: 0 });
    expect(layoutPruefen(a, ok)).toMatch(/doppelt belegt/);
    const b = kopie(l);
    b.deko.push({ art: 'haeuschen', x: 60, z: 0, dreh: 0 });
    expect(layoutPruefen(b, ok)).toMatch(/außerhalb/);
  });

  it('verstreut nur auf freie Felder nahe der Straßen, lässt Grundstücksringe frei, deterministisch', () => {
    const alt = altesLayout();
    const a = kopie(alt);
    const n = dekoVerstreuen(a);
    expect(n).toBeGreaterThan(20);
    expect(a.verstreut).toBe(VERSTREUT_STAND);
    expect(layoutPruefen(a, new Set(VORLAGE))).toBeNull();
    // Bestehendes bleibt, wie es war; alles Neue ist als „auto“ markiert
    expect(a.gebaeude).toEqual(alt.gebaeude);
    expect(a.strassen).toEqual(alt.strassen);
    expect(a.wasser).toEqual(alt.wasser);
    expect(a.deko.slice(0, alt.deko.length)).toEqual(alt.deko);
    const neu = a.deko.slice(alt.deko.length);
    expect(neu.every((d) => d.auto === true)).toBe(true);
    const haeuser = neu.filter((d) => d.art === 'haeuschen');
    expect(haeuser.length).toBeGreaterThanOrEqual(4);
    expect(new Set(neu.map((d) => d.art)).size).toBeGreaterThanOrEqual(8);

    const { belegung } = belegungBerechnen(alt);
    const strasse = (x: number, z: number) => belegung.get(feldSchluessel(x, z))?.art === 'strasse';
    const ringe = new Set(Object.values(alt.gebaeude).flatMap(ringUm));
    for (const d of neu)
      for (const [x, z] of dekoFelder(d)) {
        expect(belegung.has(feldSchluessel(x, z))).toBe(false); // keine Straße, kein Wasser, kein Grundstück
        expect(ringe.has(feldSchluessel(x, z))).toBe(false); // Eingänge und Gehsteig bleiben frei
      }
    // alles höchstens zwei Felder neben einer Straße – oder im Garten eines Häuschens
    const garten = (d: { x: number; z: number }) => haeuser.some((h) => d.x >= h.x - 1 && d.x <= h.x + 2 && d.z >= h.z - 1 && d.z <= h.z + 2);
    for (const d of neu)
      if (!garten(d)) expect(dekoFelder(d).some(([x, z]) => [[0, 1], [1, 0], [0, -1], [-1, 0], [0, 2], [2, 0], [0, -2], [-2, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => strasse(x + dx!, z + dz!)))).toBe(true);
    // Häuschen: Eingang (Drehung) zeigt zu einer Straße
    const vorn: [number, number][][] = [
      [[0, 2], [1, 2]],
      [[2, 0], [2, 1]],
      [[0, -1], [1, -1]],
      [[-1, 0], [-1, 1]],
    ];
    for (const h of haeuser) expect(vorn[h.dreh]!.some(([dx, dz]) => strasse(h.x + dx, h.z + dz))).toBe(true);

    // gleicher Stand → gleiches Ergebnis
    const b = kopie(alt);
    dekoVerstreuen(b);
    expect(b).toEqual(a);
    // das Standarddorf bringt es gleich mit
    const s = standardLayout(VORLAGE);
    expect(s.verstreut).toBe(VERSTREUT_STAND);
    expect(s.deko.filter((d) => d.art === 'haeuschen').length).toBe(haeuser.length);
  });

  it('ein neues Gebäude verdrängt nur verstreute Deko, nie Leifs eigene', () => {
    const l = standardLayout(VORLAGE);
    const eigene = l.deko.filter((d) => !d.auto);
    // wo es ohne verstreute Deko hinkäme
    const ohne = kopie(l);
    ohne.deko = ohne.deko.filter((d) => !d.auto);
    fehlendePlatzieren(ohne, [...VORLAGE, 'Sternwarte']);
    const ziel = ohne.gebaeude.Sternwarte!;

    const a = kopie(l);
    expect(fehlendePlatzieren(a, [...VORLAGE, 'Sternwarte'])).toBe(true);
    expect(a.gebaeude.Sternwarte).toEqual(ziel);
    expect(layoutPruefen(a, new Set([...VORLAGE, 'Sternwarte']))).toBeNull();
    expect(a.deko.filter((d) => !d.auto)).toEqual(eigene);
    // Grundstück und Straßenring sind vollständig (keine Lücke durch Deko)
    const { belegung } = belegungBerechnen(a);
    for (const [x, z] of grundstueckFelder(ziel.x, ziel.z)) expect(belegung.get(feldSchluessel(x, z))).toEqual({ art: 'gebaeude', id: 'Sternwarte' });
    expect(ringUm(ziel).every((k) => belegung.get(k)?.art === 'strasse' || belegung.get(k)?.art === 'gebaeude')).toBe(true);

    // eine eigene Deko auf dem Block → das Gebäude sucht sich einen anderen Platz
    const b = kopie(l);
    b.deko = b.deko.filter((d) => !(d.auto && dekoFelder(d).some(([x, z]) => x === ziel.x + 1 && z === ziel.z + 1)));
    b.deko.push({ art: 'baum', x: ziel.x + 1, z: ziel.z + 1, dreh: 0 });
    fehlendePlatzieren(b, [...VORLAGE, 'Sternwarte']);
    expect(b.gebaeude.Sternwarte).not.toEqual(ziel);
    expect(b.deko).toContainEqual({ art: 'baum', x: ziel.x + 1, z: ziel.z + 1, dreh: 0 });
    expect(layoutPruefen(b, new Set([...VORLAGE, 'Sternwarte']))).toBeNull();
  });
});

describe('Verstreuen auf dem Server (E72)', () => {
  it('bestehendes Dorf bekommt EINMAL Häuschen und Deko; Version + Live-Ereignis; Abriss bleibt', async () => {
    const d = await angemeldet();
    const alt = altesLayout();
    d.db.prepare('INSERT INTO dorf_layout (id, inhalt_json, version, geaendert) VALUES (1, ?, 5, 0)').run(JSON.stringify(alt));

    const a = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    expect(a.version).toBe(6);
    expect(a.layout.verstreut).toBe(VERSTREUT_STAND);
    expect(a.layout.deko.length).toBeGreaterThan(alt.deko.length + 20);
    expect(a.layout.deko.some((x) => x.art === 'haeuschen' && x.auto)).toBe(true);
    expect(layoutPruefen(a.layout, new Set(VORLAGE))).toBeNull();
    expect(d.ereignisse).toContainEqual({ typ: 'dorf.geaendert', version: 6 });
    // gleiches Ergebnis wie das reine Verstreuen (deterministisch)
    const erwartet = kopie(alt);
    dekoVerstreuen(erwartet);
    expect(a.layout).toEqual(erwartet);

    // zweites Laden: nichts mehr
    expect(((await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort).version).toBe(6);

    // Leif reißt alle Häuschen ab – ein altes Gerät schickt das Layout ohne Markierung
    const ohne = kopie(a.layout);
    ohne.deko = ohne.deko.filter((x) => x.art !== 'haeuschen');
    delete ohne.verstreut;
    const r = await d.app.inject({ method: 'PUT', url: '/api/dorf/layout', headers: d.h, payload: { basisVersion: 6, layout: ohne } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ version: 7, layout: { verstreut: VERSTREUT_STAND } });
    const b = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    expect(b.version).toBe(7);
    expect(b.layout.deko.some((x) => x.art === 'haeuschen')).toBe(false);
    expect(b.layout.deko.length).toBe(ohne.deko.length);
  });

  it('neues Dorf: Standardlayout ist gleich verstreut, ein Neustart verstreut nicht noch einmal', async () => {
    const d = await angemeldet();
    const a = (await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort;
    expect(a.version).toBe(1);
    expect(a.layout.verstreut).toBe(VERSTREUT_STAND);
    expect(a.layout.deko.filter((x) => x.art === 'haeuschen').length).toBeGreaterThanOrEqual(4);
    expect(((await d.app.inject({ url: '/api/dorf', headers: d.h })).json() as DorfAntwort).version).toBe(1);
  });
});

describe('Dorf-Status', () => {
  it('Rauch, Baustelle, Brief, rotes Dach und Figuren kommen aus DB-Fakten', async () => {
    const d = await angemeldet();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}');
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Post/aktionen/frage.md'),
      '---\nname: Frage\nmotor: api\nstufe: klein\nfreigabe_vor_start: ja\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}',
    );
    const leer = (await d.app.inject({ url: '/api/dorf/status', headers: d.h })).json() as DorfStatus;
    expect(leer.figuren).toEqual([]);
    expect(leer.gebaeude.Uni).toBeUndefined();

    const jetzt = d.uhr.jetzt();
    d.db.prepare("INSERT INTO moodle_fristen (id, kurs, titel, art, frist, gesehen) VALUES ('gfrist:a', 'CDA', 'Übung 5', 'abgabe', ?, 0)").run(jetzt + 2 * 86_400_000);
    d.db.prepare("INSERT INTO moodle_fristen (id, kurs, titel, art, frist, gesehen) VALUES ('gfrist:b', 'Mathe', 'Blatt 9', 'abgabe', ?, 0)").run(jetzt + 5 * 86_400_000);
    d.db
      .prepare("INSERT INTO schreibtisch (id, pfad, titel, quelle, status, erstellt, geaendert) VALUES ('s1', 'Rathaus/schreibtisch/a.md', 'A', 'app', 'neu', ?, ?)")
      .run(jetzt, jetzt);
    d.db
      .prepare("INSERT INTO plaene (id, chat_id, inhalt_json, status, erstellt, geaendert) VALUES ('p1', 'c', ?, 'wartet', ?, ?)")
      .run(JSON.stringify({ teilaufgaben: [{ gebaeude: 'Bibliothek' }, { gebaeude: 'Bibliothek' }, { gebaeude: 'Post' }] }), jetzt, jetzt);

    const lauf = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 3000]' });
    await d.agenten.aktionStarten('Post/frage', { auftrag: 'Hallo' });
    // warten, bis der Uni-Lauf wirklich läuft
    for (let i = 0; i < 50 && d.agenten.aktiveLaeufe().find((l) => l.id === lauf.laufId)?.status !== 'laeuft'; i++) await new Promise((r) => setTimeout(r, 20));

    const s = (await d.app.inject({ url: '/api/dorf/status', headers: d.h })).json() as DorfStatus;
    expect(s.gebaeude.Uni).toMatchObject({ arbeitet: 1, frist: { titel: 'Übung 5 (CDA)' } });
    expect(s.gebaeude.Post).toMatchObject({ arbeitet: 0, freigaben: 1, aufgaben: 1 });
    expect(s.gebaeude.Rathaus).toMatchObject({ aufgaben: 1 });
    expect(s.gebaeude.Bibliothek).toMatchObject({ aufgaben: 2 });
    expect(s.figuren.map((f) => [f.gebaeude, f.status, f.buergermeister])).toEqual([
      ['Uni', 'laeuft', false],
      ['Post', 'wartet_freigabe', false],
    ]);
    expect(s.figuren[0]).toMatchObject({ laufId: lauf.laufId, chatId: lauf.chatId, motor: 'claude-code', auftrag: '[warte 3000]' });

    // abgehakt → kein rotes Dach mehr; nach dem Abbrechen keine Figur mehr
    d.uni.erledigtSetzen('gfrist:a', true);
    d.agenten.abbrechen(lauf.laufId);
    await d.agenten.leerlauf();
    const n = (await d.app.inject({ url: '/api/dorf/status', headers: d.h })).json() as DorfStatus;
    expect(n.gebaeude.Uni?.frist ?? null).toBeNull();
    expect(n.figuren.map((f) => f.gebaeude)).toEqual(['Post']);
    // wie der Lauf geendet hat, steht 10 Minuten lang in „zuletzt“ (Ticker: ✅/❌/⏹️, Feier nur bei Erfolg)
    expect(n.zuletzt).toEqual([expect.objectContaining({ laufId: lauf.laufId, gebaeude: 'Uni', status: 'abgebrochen', buergermeister: false })]);
    d.uhr.vor(11 * 60_000);
    expect(((await d.app.inject({ url: '/api/dorf/status', headers: d.h })).json() as DorfStatus).zuletzt).toEqual([]);
  });
});

describe('Hohe Gebäude (Kirchturm) kommen nach hinten', () => {
  it('der Kirchturm verdeckt kein Gebäude aus Blickrichtung der Startkamera (+z)', async () => {
    const { standardLayout, GRUNDSTUECK } = await import('@dorf/shared');
    const l = standardLayout(VORLAGE);
    const k = l.gebaeude.Kirchturm!;
    const dahinter = Object.entries(l.gebaeude).filter(([id, g]) => id !== 'Kirchturm' && Math.abs(g.x - k.x) < GRUNDSTUECK + 1 && g.z < k.z);
    expect(dahinter).toEqual([]);
  });
});
