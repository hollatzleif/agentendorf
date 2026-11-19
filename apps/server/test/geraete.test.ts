import { describe, expect, it } from 'vitest';
import type { KalenderKlient } from '../src/kalender-google.js';
import { geraetTodoAusText, ohneMarkdown } from '../src/geraete.js';
import { ORIGIN, testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/**
 * E182: Geräte koppeln + Geräte-API (Vertrag: apps/cardputer/API.md).
 * TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien.
 */

/** Nachgebauter Google-Kalender (nur was die Geräte-API braucht) */
function kalenderAttrappe() {
  const angelegt: { kalenderId: string; body: Record<string, unknown> }[] = [];
  const termine: Record<string, unknown>[] = [
    { id: 'e1', summary: 'Mathe **VO**', start: { dateTime: '2026-11-16T14:00:00+01:00' }, end: { dateTime: '2026-11-16T15:30:00+01:00' }, location: 'HS 1' },
    { id: 'e0', summary: 'Frühstück', start: { dateTime: '2026-11-16T08:00:00+01:00' }, end: { dateTime: '2026-11-16T08:30:00+01:00' } },
    { id: 'e2', summary: 'Geburtstag Oma', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } },
  ];
  const klient: KalenderKlient = {
    kalender: async () => [{ id: 'leif@gmail.com', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }],
    termine: async () => termine as never,
    holen: async (_k, id) => termine.find((t) => t.id === id) as never,
    anlegen: async (kalenderId, body) => {
      angelegt.push({ kalenderId, body: body as Record<string, unknown> });
      const e = { id: `neu${angelegt.length}`, ...(body as object) };
      termine.push(e);
      return e as never;
    },
    aendern: async () => {
      throw new Error('nicht gebraucht');
    },
    loeschen: async () => undefined,
    verschieben: async () => {
      throw new Error('nicht gebraucht');
    },
  };
  return { klient, angelegt };
}

async function aufbau() {
  const kal = kalenderAttrappe();
  const d = await testDorf({ kalenderKlient: kal.klient });
  const h = await kopf(d);
  const code = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json().code as string;
  const r = await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code, name: 'Cardputer' } });
  const token = r.json().token as string;
  const g = { authorization: `Bearer ${token}` };
  const holen = async (url: string) => {
    const x = await d.app.inject({ url, headers: g });
    expect(x.statusCode, `${url}: ${x.body}`).toBe(200);
    return x.json();
  };
  const senden = async (url: string, payload: unknown, extra: Record<string, string> = {}) => {
    const x = await d.app.inject({ method: 'POST', url, headers: { ...g, ...extra }, payload: payload as object });
    return { status: x.statusCode, json: x.json() };
  };
  return { d, h, g, token, holen, senden, kal };
}

describe('Geräte koppeln (E182)', () => {
  it('Code aus der App: richtig → Schlüssel; falsch, abgelaufen, zweimal → 401; nur mit Anmeldung', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    // Code holen geht nur angemeldet (Cookie + Herkunft)
    expect((await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: { origin: ORIGIN } })).statusCode).toBe(401);
    const k = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    expect(k.code).toMatch(/^\d{6}$/);
    expect(Date.parse(k.gueltigBis) - d.uhr.jetzt()).toBe(5 * 60_000);
    const falsch = k.code === '000000' ? '000001' : '000000';
    const r1 = await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: falsch } });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().fehler).toMatch(/Code falsch oder abgelaufen/);
    // richtig – ohne Origin und ohne Cookie (der Cardputer ist kein Browser)
    const r2 = await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: k.code, name: '  Mein\u0007 Cardputer  ' } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}$/), name: 'Mein Cardputer' });
    // nur der Hash steht in der DB
    expect(JSON.stringify(d.db.prepare('SELECT * FROM geraete').all())).not.toContain(r2.json().token);
    // derselbe Code ein zweites Mal → 401
    expect((await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: k.code } })).statusCode).toBe(401);
    // abgelaufen
    const k2 = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    d.uhr.vor(5 * 60_000 + 1000);
    expect((await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: k2.code } })).statusCode).toBe(401);
    // ohne Namen heißt das Gerät „Cardputer“; ein neuer Code ersetzt den alten
    const alt = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    const neu = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    if (alt.code !== neu.code) expect((await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: alt.code } })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', payload: { code: neu.code } })).json().name).toBe('Cardputer');
    const liste = (await d.app.inject({ url: '/api/geraete', headers: h })).json();
    expect(liste.map((x: { name: string }) => x.name).sort()).toEqual(['Cardputer', 'Mein Cardputer']);
    expect(liste[0]).toEqual({ id: expect.any(String), name: expect.any(String), erstellt: expect.any(String), zuletzt: expect.any(String), ip: '127.0.0.1' });
  });

  it('Drossel je IP wie bei der Anmeldung (429 + Retry-After); nach 10 Fehlversuchen verfällt der Code', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const k = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    const falsch = k.code === '999999' ? '999998' : '999999';
    const versuch = (code: string, ip: string) => d.app.inject({ method: 'POST', url: '/api/geraet/koppeln', remoteAddress: ip, payload: { code } });
    for (let i = 0; i < 5; i++) expect((await versuch(falsch, '10.0.0.1')).statusCode).toBe(401);
    const gesperrt = await versuch(k.code, '10.0.0.1');
    expect(gesperrt.statusCode).toBe(429);
    expect(Number(gesperrt.headers['retry-after'])).toBeGreaterThan(0);
    // andere IPs: nach insgesamt 10 Fehlversuchen ist auch der richtige Code verbraucht
    for (let i = 0; i < 5; i++) expect((await versuch(falsch, `10.0.1.${i}`)).statusCode).toBe(401);
    expect((await versuch(k.code, '10.0.2.1')).statusCode).toBe(401);
    const k2 = (await d.app.inject({ method: 'POST', url: '/api/geraete/kopplung', headers: h })).json();
    expect((await versuch(k2.code, '10.0.2.2')).statusCode).toBe(200);
  });

  it('Schlüssel gilt NUR unter /api/geraet/, das Cookie dort nicht; Sperren → sofort 401; zuletzt gesehen', async () => {
    const x = await aufbau();
    const { d, h, g } = x;
    // Schlüssel anderswo: nichts
    expect((await d.app.inject({ url: '/api/todos', headers: g })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/geraete', headers: g })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos', headers: { ...g, origin: ORIGIN }, payload: { titel: 'x' } })).statusCode).toBe(401);
    // Cookie an der Geräte-API: nichts
    expect((await d.app.inject({ url: '/api/geraet/start', headers: h })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/geraet/start', headers: { ...h, authorization: 'Bearer abc' } })).statusCode).toBe(401);
    // unbekannte Geräte-Route: ohne Schlüssel 401, mit 404
    expect((await d.app.inject({ url: '/api/geraet/gibtsnicht' })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/geraet/gibtsnicht', headers: g })).statusCode).toBe(404);
    // Umwege über Kodierung landen nie bei einer Route außerhalb der Geräte-API
    expect([401, 404]).toContain((await d.app.inject({ url: '/api/geraet/..%2Ftodos', headers: g })).statusCode);
    expect([401, 404]).toContain((await d.app.inject({ url: '/api/geraet/../todos', headers: g })).statusCode);
    // mit Schlüssel, ohne Origin: geht – und „zuletzt“ wird gemerkt
    d.uhr.vor(90_000);
    expect((await d.app.inject({ url: '/api/geraet/start', headers: g })).statusCode).toBe(200);
    const [geraet] = (await d.app.inject({ url: '/api/geraete', headers: h })).json();
    expect(geraet.zuletzt).toBe(new Date(d.uhr.jetzt()).toISOString());
    // Sperren in der App
    expect((await d.app.inject({ method: 'DELETE', url: `/api/geraete/${geraet.id}`, headers: h })).json()).toEqual({ ok: true });
    const r = await d.app.inject({ url: '/api/geraet/start', headers: g });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ fehler: expect.stringContaining('neu koppeln') });
    expect((await d.app.inject({ method: 'DELETE', url: `/api/geraete/${geraet.id}`, headers: h })).statusCode).toBe(404);
  });
});

describe('Geräte-API (Vertrag apps/cardputer/API.md)', () => {
  it('start und heute: Uhr, Zähler, nächster Termin, Fokus, Zeilen wie „Heute“', async () => {
    const x = await aufbau();
    const { d } = x;
    await d.todos.anlegen({ titel: 'Überfällig', faellig: '2026-11-10' }, 'Leif');
    await d.todos.anlegen({ titel: 'Heute fällig', faellig: '2026-11-16' }, 'Leif');
    await d.todos.anlegen({ titel: 'Später', faellig: '2026-11-30' }, 'Leif');
    await d.todos.anlegen({ titel: 'Stern', wichtig: true }, 'Leif');
    await d.todos.anlegen({ titel: 'Wartet', wartet: 'Prof', faellig: '2026-11-20' }, 'Leif');
    await d.gewohnheiten.anlegen({ name: 'Lesen' });
    d.db.prepare("INSERT INTO moodle_fristen (id, kurs, titel, art, frist, gesehen) VALUES ('f1', 'CDA', 'Übung 5', 'abgabe', ?, 0)").run(Date.UTC(2026, 10, 16, 22, 59));
    d.kirchturm.ausfuehren({ befehl: 'pomodoro_fuer', titel: 'Mathe' });
    const s = await x.holen('/api/geraet/start');
    expect(s).toEqual({
      zeit: Math.floor(d.uhr.jetzt() / 1000),
      offsetMin: 60,
      version: d.konfig.version,
      todosOffen: 5,
      todosHeute: 3,
      freigaben: 0,
      gewohnheitenOffen: 1,
      termin: { zeit: '14:00', titel: 'Mathe **VO**' },
      fokus: { art: 'pomodoro', phase: 'fokus', restSek: 25 * 60 },
      buergermeister: { laeuft: false },
    });
    const { zeilen } = await x.holen('/api/geraet/heute');
    expect(zeilen).toEqual([
      { art: 'termin', text: 'Frühstück', zeit: '08:00', erledigt: true },
      { art: 'termin', text: 'Mathe **VO**', zeit: '14:00', erledigt: false },
      { art: 'frist', text: 'CDA: Übung 5', zeit: '23:59', id: 'f1', erledigt: false },
      { art: 'todo', text: 'Stern', id: expect.stringMatching(/^Marktplatz\/todos\//), erledigt: false },
      { art: 'todo', text: 'Überfällig', id: expect.any(String), erledigt: false },
      { art: 'todo', text: 'Heute fällig', id: expect.any(String), erledigt: false },
      { art: 'gewohnheit', text: 'Lesen', id: 'Lesen', erledigt: false },
    ]);
  });

  it('To-dos: Text deuten (morgen, fr, 24.12., !, 30 min), Ansichten, abhaken, Schritt, löschen, Grenzen', async () => {
    const x = await aufbau();
    const { d } = x;
    const neu = await x.senden('/api/geraet/todos', { text: 'Mathe Übung 3 30 min morgen !' });
    expect(neu.status).toBe(200);
    expect(neu.json.todo).toEqual({ id: expect.stringMatching(/^Marktplatz\/todos\//), titel: 'Mathe Übung 3', faellig: '2026-11-17', wichtig: true, erledigt: false, schritte: [] });
    const t = await d.todos.holen(neu.json.todo.id);
    expect(t).toMatchObject({ dauer: 30, quelle: 'Cardputer' });
    expect((await x.senden('/api/geraet/todos', { text: 'Wäsche fr' })).json.todo).toMatchObject({ titel: 'Wäsche', faellig: '2026-11-20', wichtig: false });
    expect((await x.senden('/api/geraet/todos', { text: 'Geschenk kaufen 24.12.' })).json.todo).toMatchObject({ titel: 'Geschenk kaufen', faellig: '2026-12-24' });
    expect((await x.senden('/api/geraet/todos', { text: 'Altes 2.1.' })).json.todo).toMatchObject({ faellig: '2027-01-02' });
    expect((await x.senden('/api/geraet/todos', { text: '   ' })).status).toBe(400);
    // Schritte (≤ 12) und lange Titel (≤ 120)
    const lang = await d.todos.anlegen({ titel: 'L'.repeat(190), notiz: Array.from({ length: 15 }, (_, i) => `- [ ] Schritt ${i}`).join('\n') }, 'Leif');
    const offen = (await x.holen('/api/geraet/todos?ansicht=offen')).todos;
    const l = offen.find((o: { id: string }) => o.id === lang.pfad);
    expect(Array.from(l.titel as string)).toHaveLength(120);
    expect(l.schritte).toHaveLength(12);
    expect((await x.senden('/api/geraet/todos/schritt', { id: lang.pfad, index: 1, erledigt: true })).json).toEqual({ ok: true });
    expect((await d.todos.holen(lang.pfad)).schritte![1]).toMatchObject({ erledigt: true });
    expect((await x.holen('/api/geraet/todos?ansicht=heute')).todos.map((o: { titel: string }) => o.titel)).toEqual(['Mathe Übung 3']);
    expect((await x.senden('/api/geraet/todos/erledigt', { id: neu.json.todo.id, erledigt: true })).json).toEqual({ ok: true });
    expect((await x.holen('/api/geraet/todos?ansicht=erledigt')).todos).toMatchObject([{ titel: 'Mathe Übung 3', erledigt: true }]);
    expect((await x.senden('/api/geraet/todos/loeschen', { id: lang.pfad })).json).toEqual({ ok: true });
    expect(await d.vault.existiert(lang.pfad)).toBe(false);
    // nur To-dos – keine anderen Dateien
    expect((await x.senden('/api/geraet/todos/loeschen', { id: 'Rathaus/memory.md' })).status).toBe(400);
    expect(await d.vault.existiert('Rathaus/memory.md')).toBe(true);
    // höchstens 60
    for (let i = 0; i < 62; i++) await d.todos.anlegen({ titel: `Viele ${i}` }, 'Leif');
    expect((await x.holen('/api/geraet/todos')).todos).toHaveLength(60);
    expect((await d.app.inject({ url: '/api/geraet/todos?ansicht=quatsch', headers: x.g })).statusCode).toBe(400);
  });

  it('X-Vorgang: dieselbe id zweimal → nur einmal angelegt, gleiche Antwort; je Gerät getrennt', async () => {
    const x = await aufbau();
    const a = await x.senden('/api/geraet/todos', { text: 'Nur einmal' }, { 'x-vorgang': 'abcdef0123456789' });
    const b = await x.senden('/api/geraet/todos', { text: 'Nur einmal' }, { 'x-vorgang': 'abcdef0123456789' });
    expect(b.json).toEqual(a.json);
    expect((await x.d.todos.liste()).filter((t) => t.titel === 'Nur einmal')).toHaveLength(1);
    // andere id → neu
    await x.senden('/api/geraet/notiz', { text: 'Eins' }, { 'x-vorgang': 'notiz-0001' });
    await x.senden('/api/geraet/notiz', { text: 'Eins' }, { 'x-vorgang': 'notiz-0001' });
    await x.senden('/api/geraet/notiz', { text: 'Eins' }, { 'x-vorgang': 'notiz-0002' });
    expect((await x.d.notizen.heute()).zeilen.filter((z) => z.includes('Eins'))).toHaveLength(2);
    // gemerkt mit Präfix je Gerät – kollidiert nie mit IDs der App (x-dorf-id, ohne Doppelpunkt)
    expect(x.d.db.prepare("SELECT id FROM idempotenz WHERE id LIKE 'geraet:%:%'").all()).toHaveLength(3);
  });

  it('Termine: Liste (14 Tage, ganztägig = zeit leer), anlegen im Hauptkalender ohne Einladungen', async () => {
    const x = await aufbau();
    const { termine } = await x.holen('/api/geraet/termine?tage=14');
    expect(termine).toEqual([
      { datum: '2026-11-16', zeit: '08:00', ende: '08:30', titel: 'Frühstück', ort: '' },
      { datum: '2026-11-16', zeit: '14:00', ende: '15:30', titel: 'Mathe **VO**', ort: 'HS 1' },
      { datum: '2026-11-17', zeit: '', ende: '', titel: 'Geburtstag Oma', ort: '' },
    ]);
    expect((await x.senden('/api/geraet/termine', { titel: 'Zahnarzt', datum: '2026-11-24', zeit: '15:30', dauerMin: 45 })).json).toEqual({ ok: true });
    expect((await x.senden('/api/geraet/termine', { titel: 'Urlaub', datum: '2026-11-25' })).json).toEqual({ ok: true });
    expect(x.kal.angelegt).toEqual([
      { kalenderId: 'leif@gmail.com', body: { summary: 'Zahnarzt', start: { dateTime: '2026-11-24T15:30:00', timeZone: 'Europe/Vienna' }, end: { dateTime: '2026-11-24T16:15:00', timeZone: 'Europe/Vienna' } } },
      { kalenderId: 'leif@gmail.com', body: { summary: 'Urlaub', start: { date: '2026-11-25' }, end: { date: '2026-11-26' } } },
    ]);
    expect((await x.senden('/api/geraet/termine', { titel: 'X', datum: '2026-02-30', zeit: '10:00' })).status).toBe(400);
    expect((await x.senden('/api/geraet/termine', { titel: 'X', datum: '2026-11-30', zeit: '25:00' })).status).toBe(400);
  });

  it('Kirchturm: laufend/klingelt/Einstellungen, Pomodoro, Timer, Wecker, pause/weiter/nächste/stopp, leise', async () => {
    const x = await aufbau();
    const { d } = x;
    const ok = async (b: unknown) => expect((await x.senden('/api/geraet/kirchturm', b)).json).toEqual({ ok: true });
    await ok({ aktion: 'pomodoro', titel: 'Mathe' });
    await ok({ aktion: 'timer', minuten: 10, titel: 'Tee' });
    await ok({ aktion: 'wecker', zeit: '7:30' });
    let k = await x.holen('/api/geraet/kirchturm');
    expect(k.jetztMs).toBe(d.uhr.jetzt());
    expect(k.pomodoro).toEqual({ fokus: 25, kurz: 5, lang: 15, langNach: 4 });
    expect(k.laufend).toEqual([
      { id: 'pomodoro', art: 'pomodoro', titel: 'Mathe', phase: 'fokus', endeMs: d.uhr.jetzt() + 25 * 60_000, pausiert: false, restMs: 25 * 60_000, runde: 1 },
      { id: expect.any(String), art: 'timer', titel: 'Tee', endeMs: d.uhr.jetzt() + 10 * 60_000, pausiert: false, restMs: 10 * 60_000 },
      { id: expect.any(String), art: 'wecker', titel: 'Wecker 07:30', endeMs: Date.UTC(2026, 10, 17, 6, 30), pausiert: false, restMs: Date.UTC(2026, 10, 17, 6, 30) - d.uhr.jetzt() },
    ]);
    const timerId = k.laufend[1].id;
    const weckerId = k.laufend[2].id;
    await ok({ aktion: 'pause', id: 'pomodoro' });
    await ok({ aktion: 'pause', id: timerId });
    k = await x.holen('/api/geraet/kirchturm');
    expect(k.laufend[0]).toMatchObject({ pausiert: true, endeMs: null, restMs: 25 * 60_000 });
    expect(k.laufend[1]).toMatchObject({ pausiert: true, endeMs: null });
    await ok({ aktion: 'weiter' }); // ohne id = Pomodoro
    await ok({ aktion: 'naechste', id: 'pomodoro' });
    expect(d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'kurz', status: 'wartet' });
    await ok({ aktion: 'weiter', id: 'pomodoro' }); // wartende Pause starten
    expect(d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'kurz', status: 'laeuft' });
    expect((await x.holen('/api/geraet/kirchturm')).laufend[0]).toMatchObject({ phase: 'kurz', runde: 1 });
    await ok({ aktion: 'stopp', id: timerId });
    await ok({ aktion: 'stopp', id: weckerId });
    await ok({ aktion: 'stopp' });
    expect((await x.holen('/api/geraet/kirchturm')).laufend).toEqual([]);
    expect((await x.senden('/api/geraet/kirchturm', { aktion: 'pause', id: 'gibtsnicht' })).status).toBe(404);
    expect((await x.senden('/api/geraet/kirchturm', { aktion: 'timer' })).status).toBe(400);
    expect((await x.senden('/api/geraet/kirchturm', { aktion: 'tanzen' })).status).toBe(400);
    // Klingeln quittieren
    await ok({ aktion: 'timer', minuten: 1, titel: 'Ei' });
    d.uhr.vor(61_000);
    d.kirchturm.pruefen();
    k = await x.holen('/api/geraet/kirchturm');
    expect(k.klingelt).toEqual([{ id: expect.any(String), titel: '⏳ Ei' }]);
    await ok({ aktion: 'leise', id: k.klingelt[0].id });
    expect((await x.holen('/api/geraet/kirchturm')).klingelt).toEqual([]);
    // Einstellungen: nur die angegebenen ändern sich
    expect((await x.senden('/api/geraet/kirchturm/einstellungen', { fokus: 50, kurz: 10 })).json).toEqual({ ok: true });
    expect((await x.holen('/api/geraet/kirchturm')).pomodoro).toEqual({ fokus: 50, kurz: 10, lang: 15, langNach: 4 });
    expect((await x.senden('/api/geraet/kirchturm/einstellungen', { fokus: 500 })).status).toBe(400);
  });

  it('Bürgermeister: neue Aufgabe startet sofort (Attrappe bis fertig), weiterreden, Liste, Markdown weg', async () => {
    const x = await aufbau();
    const { d } = x;
    const r = await x.senden('/api/geraet/buergermeister', { text: 'Wie spät ist es?' });
    expect(r.status).toBe(200);
    const chatId = r.json.chatId as string;
    expect((await x.holen('/api/geraet/start')).buergermeister.laeuft).toBe(true);
    expect((await x.holen(`/api/geraet/buergermeister/${chatId}`)).status).toBe('laeuft');
    await d.agenten.leerlauf();
    const c = await x.holen(`/api/geraet/buergermeister/${chatId}`);
    expect(c.status).toBe('fertig');
    expect(c.nachrichten[0]).toEqual({ von: 'du', text: 'Wie spät ist es?' });
    expect(c.nachrichten.at(-1).von).toBe('bm');
    expect(c.nachrichten.at(-1).text).not.toMatch(/##|\*\*/);
    expect(Array.from(c.nachrichten.at(-1).text as string).length).toBeLessThanOrEqual(1500);
    // weiterreden
    expect((await x.senden('/api/geraet/buergermeister', { text: 'Danke!', chatId })).json).toEqual({ chatId });
    await d.agenten.leerlauf();
    const c2 = await x.holen(`/api/geraet/buergermeister/${chatId}`);
    expect(c2.nachrichten.filter((n: { von: string }) => n.von === 'du').map((n: { text: string }) => n.text)).toEqual(['Wie spät ist es?', 'Danke!']);
    const l = await x.holen('/api/geraet/buergermeister');
    expect(l.chats).toEqual([{ chatId, titel: expect.stringContaining('Wie spät'), status: 'fertig', zeit: '13:00' }]);
    // nur Chats des Bürgermeisters
    const fremd = await d.agenten.aktionStarten('Bibliothek/notizen-zusammenfassen', { thema: 'x' });
    expect((await d.app.inject({ url: `/api/geraet/buergermeister/${fremd.chatId}`, headers: x.g })).statusCode).toBe(404);
    expect((await x.senden('/api/geraet/buergermeister', { text: 'x', chatId: fremd.chatId })).status).toBe(404);
    expect((await x.senden('/api/geraet/buergermeister', { text: '' })).status).toBe(400);
  });

  it('Freigaben: Liste mit Text (≤ 600), entscheiden ja/nein genau einmal', async () => {
    const x = await aufbau();
    const { d } = x;
    await d.vault.schreiben('Bibliothek/weg.md', 'x');
    const f1 = await d.agenten.freigaben.beantragen({ art: 'datei_loeschen', titel: 'weg.md löschen', begruendung: `**Alt** ${'b'.repeat(900)}`, inhalt: { pfad: 'Bibliothek/weg.md' }, gebaeude: 'Bibliothek' });
    const f2 = await d.agenten.freigaben.beantragen({ art: 'sonstiges', titel: 'Bezahlen', begruendung: 'Rechnung', inhalt: { beschreibung: 'Bitte zahlen' }, gebaeude: 'Bank' });
    const { freigaben } = await x.holen('/api/geraet/freigaben');
    expect(freigaben[0]).toMatchObject({ id: f1.id, titel: 'weg.md löschen', gebaeude: 'Bibliothek' });
    expect(freigaben[0].text).toMatch(/^Datei: Bibliothek\/weg\.md\nAlt b/);
    expect(Array.from(freigaben[0].text as string)).toHaveLength(600);
    expect(freigaben[1].text).toBe('Bitte zahlen\nRechnung');
    expect((await x.senden('/api/geraet/freigaben/entscheiden', { id: f1.id, entscheidung: 'ja' })).json).toEqual({ ok: true });
    expect(await d.vault.existiert('Bibliothek/weg.md')).toBe(false);
    expect((await x.senden('/api/geraet/freigaben/entscheiden', { id: f2.id, entscheidung: 'nein', begruendung: 'zu teuer' })).json).toEqual({ ok: true });
    expect(d.agenten.freigaben.holen(f2.id)).toMatchObject({ status: 'abgelehnt', grund: 'zu teuer' });
    expect((await x.senden('/api/geraet/freigaben/entscheiden', { id: f2.id, entscheidung: 'ja' })).status).toBe(409);
    expect((await x.holen('/api/geraet/freigaben')).freigaben).toEqual([]);
  });

  it('Gewohnheiten, Notiz, Fristen (14 Tage, Ortszeit mit Versatz), Post (heute + gestern)', async () => {
    const x = await aufbau();
    const { d } = x;
    await d.gewohnheiten.anlegen({ name: 'Lesen' });
    expect(await x.holen('/api/geraet/gewohnheiten')).toEqual({ gewohnheiten: [{ name: 'Lesen', erledigt: false, serie: 0 }] });
    expect((await x.senden('/api/geraet/gewohnheiten', { name: 'Lesen', erledigt: true })).json).toEqual({ ok: true });
    expect((await x.holen('/api/geraet/gewohnheiten')).gewohnheiten[0]).toMatchObject({ erledigt: true, serie: 1 });
    expect((await x.senden('/api/geraet/gewohnheiten', { name: 'Gibtsnicht', erledigt: true })).status).toBe(404);

    expect((await x.senden('/api/geraet/notiz', { text: 'Idee vom Cardputer' })).json).toEqual({ ok: true });
    expect((await d.notizen.heute()).zeilen).toEqual(['- 13:00 Idee vom Cardputer _(Cardputer)_']);
    expect((await x.senden('/api/geraet/notiz', { text: ' ' })).status).toBe(400);

    const ins = d.db.prepare("INSERT INTO moodle_fristen (id, kurs, titel, art, frist, gesehen) VALUES (?, 'CDA', ?, ?, ?, 0)");
    ins.run('a', 'Übung 5', 'abgabe', Date.UTC(2026, 10, 20, 22, 59));
    ins.run('b', 'Klausur', 'test', Date.UTC(2026, 11, 20, 9, 0)); // zu weit weg
    ins.run('c', 'Vorlesung', 'termin', Date.UTC(2026, 10, 18, 9, 0)); // kein Abgabe-/Prüfungstermin
    expect(await x.holen('/api/geraet/fristen')).toEqual({ fristen: [{ titel: 'Übung 5', fach: 'CDA', faellig: '2026-11-20T23:59:00+01:00', erledigt: false }] });

    const mail = d.db.prepare("INSERT INTO post_mails (id, thread_id, von, betreff, datum, kategorie, wichtig, antwort_noetig, zusammenfassung, eingeordnet) VALUES (?, 't', ?, ?, ?, 'Uni', 0, ?, ?, 1)");
    mail.run('m1', 'Prof <p@jku.at>', 'Prüfung', d.uhr.jetzt() - 3600_000, 1, 'Neuer Termin.');
    mail.run('m2', 'Shop', 'Angebot', d.uhr.jetzt() - 3 * 86_400_000, 0, 'Alt.');
    expect(await x.holen('/api/geraet/post')).toEqual({ mails: [{ von: 'Prof <p@jku.at>', betreff: 'Prüfung', zusammenfassung: 'Neuer Termin.', antwortNoetig: true }] });
  });
});

describe('Hilfen der Geräte-API', () => {
  it('To-do-Text: Datum am Ende, „!“, Wochentag heute = heute, „nächsten“ = eine Woche später', () => {
    const heute = '2026-11-20'; // Freitag
    expect(geraetTodoAusText('Mathe fr', heute)).toMatchObject({ titel: 'Mathe', faellig: '2026-11-20' });
    expect(geraetTodoAusText('Mathe nächsten fr', heute)).toMatchObject({ titel: 'Mathe', faellig: '2026-11-27' });
    expect(geraetTodoAusText('Mathe bis montag!', heute)).toEqual({ titel: 'Mathe', faellig: '2026-11-23', wichtig: true });
    expect(geraetTodoAusText('Referat üben morgen 2h', heute)).toMatchObject({ titel: 'Referat üben', faellig: '2026-11-21', dauer: 120 });
    expect(geraetTodoAusText('Wäsche jeden Montag', heute)).toMatchObject({ titel: 'Wäsche', wiederholen: 'wöchentlich', faellig: '2026-11-23' });
    expect(geraetTodoAusText('Brief 31.2.', heute)).toEqual({ titel: 'Brief 31.2.' });
    expect(geraetTodoAusText('Einfach so', heute)).toMatchObject({ titel: 'Einfach', faellig: '2026-11-22' }); // „so“ = Sonntag – bewusst wie „fr“
  });

  it('Markdown wird grob entfernt', () => {
    expect(ohneMarkdown('## Titel\n\n**fett** und *schräg* mit [Link](https://x.at) und [[Notiz|Alias]] `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      'Titel\n\nfett und schräg mit Link und Alias code\n\na · b\n\n1 · 2',
    );
  });
});
