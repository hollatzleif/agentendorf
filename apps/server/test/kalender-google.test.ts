import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';
import { GoogleZugang } from '../src/post/google-oauth.js';
import { googleKalenderKlient } from '../src/kalender-google.js';

/** Nachgebauter Google-Calendar-Server nach der Doku (calendarList, events list/get/insert/patch/delete/move) */
async function googleAttrappe() {
  const anfragen: { methode: string; pfad: string; abfrage: Record<string, string>; body?: unknown; auth?: string }[] = [];
  const termine = new Map<string, Record<string, unknown>>([
    ['e1', { id: 'e1', summary: 'Zahnarzt', start: { dateTime: '2026-11-17T09:00:00+01:00' }, end: { dateTime: '2026-11-17T10:00:00+01:00' }, location: 'Konstanz' }],
    ['serie_20261118', { id: 'serie_20261118', recurringEventId: 'serie', summary: 'Training', start: { dateTime: '2026-11-18T18:00:00+01:00' }, end: { dateTime: '2026-11-18T19:30:00+01:00' } }],
    ['serie', { id: 'serie', summary: 'Training', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'], start: { dateTime: '2026-11-04T18:00:00+01:00' }, end: { dateTime: '2026-11-04T19:30:00+01:00' } }],
    ['weg', { id: 'weg', status: 'cancelled' }],
  ]);
  let apiAus = false;
  const s = http.createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    let roh = '';
    for await (const c of req) roh += c;
    anfragen.push({ methode: req.method!, pfad: decodeURIComponent(u.pathname), abfrage: Object.fromEntries(u.searchParams), body: roh && req.headers['content-type']?.includes('json') ? JSON.parse(roh) : undefined, auth: req.headers.authorization });
    const json = (status: number, x: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(x));
    };
    if (u.pathname === '/token') return json(200, { access_token: 'AT', expires_in: 3600 });
    if (apiAus) return json(403, { error: { code: 403, message: 'Google Calendar API has not been used', errors: [{ reason: 'accessNotConfigured' }] } });
    if (u.pathname === '/cal/users/me/calendarList')
      return json(200, {
        items: [
          { id: 'leif@gmail.com', summary: 'leif@gmail.com', summaryOverride: 'Leif', backgroundColor: '#9fe1e7', primary: true, accessRole: 'owner' },
          { id: 'feiertage', summary: 'Feiertage in Österreich', backgroundColor: '#16a765', accessRole: 'reader' },
        ],
      });
    const m = /^\/cal\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/move)?$/.exec(u.pathname);
    if (!m) return json(404, {});
    const [, kal, id, move] = m.map((x) => (x ? decodeURIComponent(x) : x));
    if (kal === 'feiertage') return req.method === 'GET' && !id ? json(200, { items: [{ id: 'f1', summary: 'Mariä Empfängnis', start: { date: '2026-12-08' }, end: { date: '2026-12-09' } }] }) : json(403, {});
    if (req.method === 'GET' && !id) return json(200, { items: [...termine.values()].filter((t) => t.id !== 'serie') });
    if (req.method === 'GET') return termine.has(id!) ? json(200, termine.get(id!)) : json(404, {});
    if (req.method === 'POST' && move) return json(200, { ...termine.get(id!) });
    if (req.method === 'POST') {
      const neu = { id: `neu${termine.size}`, ...(JSON.parse(roh) as object) };
      termine.set(neu.id, neu);
      return json(200, neu);
    }
    if (req.method === 'PATCH') {
      const t = { ...termine.get(id!), ...(JSON.parse(roh) as object) };
      termine.set(id!, t);
      return json(200, t);
    }
    if (req.method === 'DELETE') {
      termine.delete(id!);
      res.statusCode = 204;
      return res.end();
    }
    json(404, {});
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const basis = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const zugang = new GoogleZugang({ clientId: 'c', clientSecret: 's', refreshToken: 'r', tokenUrl: `${basis}/token` });
  return { klient: googleKalenderKlient(zugang, `${basis}/cal`), anfragen, termine, schliessen: () => s.close(), aus: (x: boolean) => (apiAus = x) };
}

const VON = '2026-11-16T00:00:00.000Z';
const BIS = '2026-12-31T00:00:00.000Z';

describe('Kalender auf dem Marktplatz (E75)', () => {
  it('liest alle Kalender (eigene schreibbar, Feiertage nur lesen) samt Serien und blendet Uni-Fristen ein', async () => {
    const g = await googleAttrappe();
    try {
      const d = await testDorf({ kalenderKlient: g.klient });
      const h = await kopf(d);
      const r = (await d.app.inject({ url: `/api/kalender?von=${VON}&bis=${BIS}`, headers: h })).json();
      expect(r.modus).toBe('google');
      expect(r.kalender).toEqual([
        { id: 'leif@gmail.com', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true },
        { id: 'feiertage', name: 'Feiertage in Österreich', farbe: '#16a765', primaer: false, schreibbar: false },
      ]);
      const titel = r.termine.map((t: { titel: string; ganztags: boolean; schreibbar: boolean; serieId?: string }) => [t.titel, t.ganztags, t.schreibbar, t.serieId ?? null]);
      expect(titel).toEqual([
        ['Zahnarzt', false, true, null],
        ['Training', false, true, 'serie'],
        ['Mariä Empfängnis', true, false, null],
      ]);
      expect(r.termine[0]).toMatchObject({ start: '2026-11-17T08:00:00.000Z', ende: '2026-11-17T09:00:00.000Z', ort: 'Konstanz' });
      // Abfrage nach Doku: Einzeltermine, sortiert, Zeitraum
      const liste = g.anfragen.find((a) => a.pfad === '/cal/calendars/leif@gmail.com/events')!;
      expect(liste.abfrage).toMatchObject({ singleEvents: 'true', orderBy: 'startTime', timeMin: VON, timeMax: BIS });
      expect(liste.auth).toBe('Bearer AT');
      // Serie: Regel nachladen
      expect((await d.app.inject({ url: '/api/kalender/serie?kalenderId=leif%40gmail.com&serieId=serie', headers: h })).json()).toMatchObject({ wiederholung: 'RRULE:FREQ=WEEKLY;BYDAY=WE' });
      // zu langer Zeitraum
      expect((await d.app.inject({ url: `/api/kalender?von=${VON}&bis=2027-06-01T00:00:00.000Z`, headers: h })).statusCode).toBe(400);
    } finally {
      g.schliessen();
    }
  });

  it('anlegen, ändern (einzeln oder Serie), löschen – immer ohne Einladungen; fremde Kalender sind gesperrt', async () => {
    const g = await googleAttrappe();
    try {
      const d = await testDorf({ kalenderKlient: g.klient });
      const h = await kopf(d);
      const neu = await d.app.inject({
        method: 'POST',
        url: '/api/kalender/termin',
        headers: h,
        payload: { kalenderId: 'leif@gmail.com', titel: 'Corps-Kneipe', start: '2026-11-20T20:00', ende: '2026-11-20T23:30', ort: 'Corpshaus', erinnerungen: [30], wiederholung: 'RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4' },
      });
      expect(neu.json()).toMatchObject({ titel: 'Corps-Kneipe' });
      const anlegen = g.anfragen.find((a) => a.methode === 'POST' && a.pfad.endsWith('/events'))!;
      expect(anlegen.abfrage).toEqual({ sendUpdates: 'none' });
      expect(anlegen.body).toEqual({
        summary: 'Corps-Kneipe',
        start: { dateTime: '2026-11-20T20:00:00', timeZone: 'Europe/Vienna' },
        end: { dateTime: '2026-11-20T23:30:00', timeZone: 'Europe/Vienna' },
        location: 'Corpshaus',
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4'],
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      });
      // ganztags, ändern → das Zeitfeld wird ausdrücklich geleert
      const r = await d.app.inject({ method: 'PATCH', url: '/api/kalender/termin', headers: h, payload: { id: 'e1', termin: { kalenderId: 'leif@gmail.com', titel: 'Zahnarzt (verschoben)', ganztags: true, start: '2026-11-19', ende: '2026-11-20' } } });
      expect(r.json()).toMatchObject({ titel: 'Zahnarzt (verschoben)' });
      expect(g.anfragen.at(-1)).toMatchObject({ methode: 'PATCH', pfad: '/cal/calendars/leif@gmail.com/events/e1', abfrage: { sendUpdates: 'none' }, body: { start: { date: '2026-11-19', dateTime: null, timeZone: null } } });
      // ganze Serie ändern → Serien-ID
      await d.app.inject({ method: 'PATCH', url: '/api/kalender/termin', headers: h, payload: { id: 'serie_20261118', serie: true, termin: { kalenderId: 'leif@gmail.com', titel: 'Training (neu)', start: '2026-11-04T18:30', ende: '2026-11-04T20:00' } } });
      expect(g.anfragen.at(-1)).toMatchObject({ methode: 'PATCH', pfad: '/cal/calendars/leif@gmail.com/events/serie' });
      // löschen: nur dieser
      expect((await d.app.inject({ method: 'DELETE', url: '/api/kalender/termin?kalenderId=leif%40gmail.com&id=e1', headers: h })).statusCode).toBe(200);
      expect(g.anfragen.at(-1)).toMatchObject({ methode: 'DELETE', pfad: '/cal/calendars/leif@gmail.com/events/e1', abfrage: { sendUpdates: 'none' } });
      // fremder (nur lesbarer) Kalender
      const f = await d.app.inject({ method: 'POST', url: '/api/kalender/termin', headers: h, payload: { kalenderId: 'feiertage', titel: 'X', start: '2026-11-20T10:00', ende: '2026-11-20T11:00' } });
      expect(f.statusCode).toBe(403);
      // Unsinn wird abgelehnt
      for (const p of [
        { kalenderId: 'leif@gmail.com', titel: 'X', start: '2026-11-20T11:00', ende: '2026-11-20T10:00' },
        { kalenderId: 'leif@gmail.com', titel: 'X', start: '2026-11-20', ende: '2026-11-21' },
        { kalenderId: 'leif@gmail.com', titel: 'X', start: '2026-11-20T10:00', ende: '2026-11-20T11:00', wiederholung: 'RRULE:FREQ=SECONDLY' },
      ])
        expect((await d.app.inject({ method: 'POST', url: '/api/kalender/termin', headers: h, payload: p })).statusCode).toBe(400);
      // ohne Anmeldung nichts
      expect((await d.app.inject({ url: `/api/kalender?von=${VON}&bis=${BIS}` })).statusCode).toBe(401);
    } finally {
      g.schliessen();
    }
  });

  it('API im Google-Projekt aus → verständlicher Hinweis; mit iCal-Adresse wenigstens lesen; ohne alles: modus aus', async () => {
    const g = await googleAttrappe();
    try {
      g.aus(true);
      const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:i1', 'SUMMARY:Aus iCal', 'DTSTART:20261118T100000Z', 'DTEND:20261118T110000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const d = await testDorf({ kalenderKlient: g.klient, google: { termine: { laden: async () => ics } } });
      const h = await kopf(d);
      const r = (await d.app.inject({ url: `/api/kalender?von=${VON}&bis=${BIS}`, headers: h })).json();
      expect(r).toMatchObject({ modus: 'ical', hinweis: expect.stringMatching(/Calendar API .* noch nicht eingeschaltet/) });
      expect(r.termine.map((t: { titel: string }) => t.titel)).toEqual(['Aus iCal']);
      const leer = await testDorf();
      const h2 = await kopf(leer);
      expect((await leer.app.inject({ url: `/api/kalender?von=${VON}&bis=${BIS}`, headers: h2 })).json()).toMatchObject({ modus: 'aus', kalender: [] });
    } finally {
      g.schliessen();
    }
  });

  it('verbunden: Morgenzeitung, Corps und kalender_lesen lesen über Google (ganztags in Linzer Zeit); geht Google nicht, die iCal-Adresse', async () => {
    const g = await googleAttrappe();
    try {
      const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:i1', 'SUMMARY:Aus iCal', 'DTSTART:20261118T100000Z', 'DTEND:20261118T110000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const d = await testDorf({ kalenderKlient: g.klient, google: { termine: { laden: async () => ics } } });
      const t = await d.kalender.termine(Date.parse(VON), Date.parse(BIS));
      expect(t.map((x) => [x.titel, x.kategorie, x.ganztags])).toEqual([
        ['Zahnarzt', 'Leif', false],
        ['Training', 'Leif', false],
        ['Mariä Empfängnis', 'Feiertage in Österreich', true],
      ]);
      expect(new Date(t[2]!.start!).toISOString()).toBe('2026-12-07T23:00:00.000Z');
      const k = await d.agenten.kalender!(Date.parse(VON), Date.parse(BIS));
      expect(k.map((x) => x.titel)).toContain('Zahnarzt');
      g.aus(true);
      // Kalenderliste ist 10 min zwischengespeichert – danach geht der Abruf schief → iCal
      d.uhr.vor(11 * 60_000);
      expect((await d.kalender.termine(Date.parse(VON), Date.parse(BIS))).map((x) => x.titel)).toEqual(['Aus iCal']);
    } finally {
      g.schliessen();
    }
  });

  it('Lernzeit einplanen: freie Lücken bis zur Frist, 08–20 Uhr Linz, 15 min Puffer, je Tag einer', async () => {
    const g = await googleAttrappe();
    try {
      const d = await testDorf({ kalenderKlient: g.klient });
      const h = await kopf(d);
      // TestUhr: Mo 16.11. 13:00 Linz; Zahnarzt Di 09–10, Training Mi 18–19:30
      const r = (await d.app.inject({ url: '/api/kalender/frei?bis=2026-11-19T23:00:00.000Z&dauer=120&anzahl=3', headers: h })).json();
      expect(r).toEqual([
        { start: '2026-11-16T12:30:00.000Z', ende: '2026-11-16T14:30:00.000Z' }, // heute ab 13:30 (jetzt + 30 min, gerundet)
        { start: '2026-11-17T09:15:00.000Z', ende: '2026-11-17T11:15:00.000Z' }, // Di nach dem Zahnarzt + Puffer (10:15 Linz)
        { start: '2026-11-18T07:00:00.000Z', ende: '2026-11-18T09:00:00.000Z' }, // Mi 08:00 Linz
      ]);
      // Vorschlag eintragen: Hauptkalender, Ortszeit, Erinnerung, nie Einladungen
      const e = await d.app.inject({ method: 'POST', url: '/api/kalender/lernzeit', headers: h, payload: { titel: 'Mathe III: Blatt 5', ...r[1] } });
      expect(e.json()).toMatchObject({ titel: '📚 Mathe III: Blatt 5', kalenderId: 'leif@gmail.com' });
      expect(g.anfragen.at(-1)).toMatchObject({
        methode: 'POST',
        abfrage: { sendUpdates: 'none' },
        body: { summary: '📚 Mathe III: Blatt 5', start: { dateTime: '2026-11-17T10:15:00', timeZone: 'Europe/Vienna' }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] } },
      });
      // Frist schon vorbei → nichts; ohne Google → 409
      expect((await d.app.inject({ url: '/api/kalender/frei?bis=2026-11-01T00:00:00.000Z', headers: h })).json()).toEqual([]);
      const ohne = await testDorf();
      const h2 = await kopf(ohne);
      expect((await ohne.app.inject({ url: '/api/kalender/frei?bis=2026-11-19T23:00:00.000Z', headers: h2 })).statusCode).toBe(409);
    } finally {
      g.schliessen();
    }
  });

  it('Tag planen: To-dos nach Dringlichkeit in die freien Lücken (Puffer zum Zahnarzt), dann eintragen', async () => {
    const g = await googleAttrappe();
    try {
      const d = await testDorf({ kalenderKlient: g.klient });
      const h = await kopf(d);
      await d.todos.anlegen({ titel: 'Lesen' }, 'Leif');
      await d.todos.anlegen({ titel: 'Abgabe: Blatt 5', faellig: '2026-11-17', gebaeude: 'Uni' }, 'Uni');
      await d.todos.anlegen({ titel: 'Steuer', faellig: '2026-11-10' }, 'Leif');
      // Di 17.11.: Zahnarzt 09–10 Linz → frei 08:00–08:45 und ab 10:15
      const p = (await d.app.inject({ url: '/api/tag/planen?tag=2026-11-17', headers: h })).json();
      expect(p.map((b: { titel: string; start: string; ende: string; grund: string }) => [b.titel, b.start, b.ende, b.grund])).toEqual([
        ['Steuer', '2026-11-17T07:00:00.000Z', '2026-11-17T07:45:00.000Z', 'überfällig'],
        ['Blatt 5', '2026-11-17T09:15:00.000Z', '2026-11-17T10:45:00.000Z', 'heute fällig'],
        ['Lesen', '2026-11-17T11:00:00.000Z', '2026-11-17T11:45:00.000Z', 'ohne Datum'],
      ]);
      const vorher = g.anfragen.length;
      const r = await d.app.inject({ method: 'POST', url: '/api/tag/eintragen', headers: h, payload: { bloecke: p.slice(0, 2).map((b: { titel: string; start: string; ende: string }) => ({ titel: b.titel, start: b.start, ende: b.ende })) } });
      expect(r.statusCode).toBe(200);
      const neu = g.anfragen.slice(vorher).filter((x) => x.methode === 'POST' && x.pfad.endsWith('/events'));
      expect(neu.map((x) => (x.body as { summary: string }).summary)).toEqual(['📚 Steuer', '📚 Blatt 5']);
      expect(neu.every((x) => x.abfrage.sendUpdates === 'none')).toBe(true);
    } finally {
      g.schliessen();
    }
  });

  it('Anmeldung fragt Mail UND Kalender an – Senden nie', async () => {
    const { anmeldungVorbereiten } = await import('../src/post/google-oauth.js');
    const scope = new URL(anmeldungVorbereiten('id.apps.googleusercontent.com').adresse).searchParams.get('scope')!.split(' ');
    expect(scope).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ]);
    expect(scope.some((s) => s.includes('gmail.send') || s.endsWith('mail.google.com/'))).toBe(false);
  });
});
