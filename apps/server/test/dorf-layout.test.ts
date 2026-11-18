import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRUNDSTUECK,
  belegungBerechnen,
  fehlendePlatzieren,
  feldSchluessel,
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
