import { z } from 'zod';
import type { KalenderAntwort, KalenderInfo, KalenderTermin } from '@dorf/shared';
import { istFristBlock } from '@dorf/shared';
import type { GoogleZugang } from './post/google-oauth.js';
import type { Terminkalender } from './kalender.js';
import { ortszeitZuUtc, type IcsTermin } from './uni/ical.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';
import { tagIn, tagPlus } from './zeit.js';

/**
 * Kalender auf dem Marktplatz (E75): Leifs Google Calendar über die Calendar API v3 (Doku developers.google.com,
 * geprüft am 18.11.2026). Bereiche: calendar.events (Termine lesen/ändern) + calendar.calendarlist.readonly (Liste).
 *
 * Schreiben: Leif über App-Routen, Telegram /termin und Cardputer (E182). Agenten tragen in Leifs EIGENEN Kalender
 * direkt ein, ändern und löschen dort (termin_anlegen/_aendern/_loeschen, E185 – mit „Rückgängig“-Meldung); Termine mit
 * Gästen nur per Freigabe. Einladungen werden nie verschickt (sendUpdates=none).
 * Ohne Google-Verbindung: nur lesen über die geheime iCal-Adresse (wie bisher).
 */
export { KALENDER_BEREICHE } from './post/google-oauth.js';
const ZONE = 'Europe/Vienna';
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** RRULE in der Form, die die App erzeugt (FREQ + optional INTERVAL/BYDAY/UNTIL/COUNT) */
const RRULE = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=\d{1,3})?(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6})?(;(UNTIL=\d{8}(T\d{6}Z)?|COUNT=\d{1,4}))?$/;

export const TerminEingabe = z
  .object({
    kalenderId: z.string().min(1).max(300),
    titel: z.string().trim().min(1, 'Titel fehlt').max(300),
    ganztags: z.boolean().default(false),
    /** ganztags: JJJJ-MM-TT; sonst JJJJ-MM-TTTHH:MM (Ortszeit Linz/Konstanz) */
    start: z.string(),
    ende: z.string(),
    ort: z.string().max(500).optional(),
    beschreibung: z.string().max(8000).optional(),
    wiederholung: z.string().regex(RRULE, 'Wiederholung verstehe ich nicht').nullable().optional(),
    erinnerungen: z.array(z.number().int().min(0).max(40320)).max(5).nullable().optional(),
    farbe: z.string().regex(/^([1-9]|1[01])$/).nullable().optional(),
  })
  .superRefine((t, ctx) => {
    const muster = t.ganztags ? DATUM : ZEIT;
    if (!muster.test(t.start) || !muster.test(t.ende)) ctx.addIssue({ code: 'custom', message: t.ganztags ? 'Datum als JJJJ-MM-TT' : 'Zeit als JJJJ-MM-TTTHH:MM' });
    else if (t.ganztags ? t.ende <= t.start : t.ende < t.start) ctx.addIssue({ code: 'custom', message: 'Das Ende liegt vor dem Anfang.' });
  });
export type TerminEingabe = z.infer<typeof TerminEingabe>;

const GZeit = z.object({ date: z.string().nullish(), dateTime: z.string().nullish(), timeZone: z.string().nullish() }).passthrough();
const GEvent = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: GZeit.optional(),
    end: GZeit.optional(),
    recurringEventId: z.string().optional(),
    recurrence: z.array(z.string()).optional(),
    reminders: z.object({ useDefault: z.boolean().optional(), overrides: z.array(z.object({ method: z.string(), minutes: z.number() })).optional() }).optional(),
    colorId: z.string().optional(),
    htmlLink: z.string().optional(),
    attendees: z.array(z.unknown()).optional(),
  })
  .passthrough();
type GEvent = z.infer<typeof GEvent>;

export interface KalenderKlient {
  kalender(): Promise<KalenderInfo[]>;
  termine(kalenderId: string, von: number, bis: number): Promise<GEvent[]>;
  holen(kalenderId: string, id: string): Promise<GEvent>;
  anlegen(kalenderId: string, body: unknown): Promise<GEvent>;
  aendern(kalenderId: string, id: string, body: unknown): Promise<GEvent>;
  loeschen(kalenderId: string, id: string): Promise<void>;
  verschieben(kalenderId: string, id: string, ziel: string): Promise<GEvent>;
}

/** Fehlermeldungen von Google verständlich machen (API aus, Berechtigung fehlt …) */
async function googleFehler(r: Response): Promise<never> {
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } };
  const gruende = [...(j.error?.errors ?? []), ...(j.error?.details ?? [])].map((e) => e.reason ?? '');
  if (r.status === 403 && gruende.some((g) => /accessNotConfigured|SERVICE_DISABLED/i.test(g)))
    throw new DorfFehler(409, 'Die Google Calendar API ist in deinem Google-Cloud-Projekt noch nicht eingeschaltet (Cloud Console → APIs & Dienste → Bibliothek → „Google Calendar API“ → Aktivieren).');
  if (r.status === 403 && gruende.some((g) => /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(g)))
    throw new DorfFehler(409, 'Der Kalender-Zugriff fehlt noch: auf dem Server „dorf gmail-anmelden“ erneut ausführen und den Kalender erlauben.');
  if (r.status === 404) throw new DorfFehler(404, 'Diesen Termin gibt es nicht (mehr).');
  if (r.status === 410) throw new DorfFehler(404, 'Dieser Termin wurde gelöscht.');
  throw new DorfFehler(502, `Google Kalender antwortet mit ${r.status}${j.error?.message ? `: ${j.error.message}` : ''}.`);
}

export function googleKalenderKlient(zugang: GoogleZugang, basis = 'https://www.googleapis.com/calendar/v3'): KalenderKlient {
  const rufen = async (pfad: string, o: { methode?: string; abfrage?: Record<string, string>; body?: unknown } = {}) => {
    const u = new URL(`${basis}${pfad}`);
    for (const [k, v] of Object.entries(o.abfrage ?? {})) u.searchParams.set(k, v);
    for (let versuch = 0; versuch < 2; versuch++) {
      const r = await fetch(u, {
        method: o.methode ?? 'GET',
        headers: { Authorization: `Bearer ${await zugang.accessToken()}`, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 401 && versuch === 0) {
        zugang.vergessen();
        continue;
      }
      if (!r.ok) return googleFehler(r);
      return r.status === 204 ? null : ((await r.json()) as unknown);
    }
    throw new DorfFehler(502, 'Google lehnt die Anmeldung ab.');
  };
  const k = (id: string) => `/calendars/${encodeURIComponent(id)}`;
  return {
    async kalender() {
      const aus: KalenderInfo[] = [];
      let seite: string | undefined;
      do {
        const r = z
          .object({
            items: z.array(z.object({ id: z.string(), summary: z.string().optional(), summaryOverride: z.string().optional(), backgroundColor: z.string().optional(), primary: z.boolean().optional(), accessRole: z.string().optional(), hidden: z.boolean().optional() }).passthrough()).default([]),
            nextPageToken: z.string().optional(),
          })
          .parse(await rufen('/users/me/calendarList', { abfrage: { maxResults: '250', ...(seite ? { pageToken: seite } : {}) } }));
        for (const c of r.items)
          if (!c.hidden)
            aus.push({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, farbe: c.backgroundColor ?? '#4a86e8', primaer: !!c.primary, schreibbar: c.accessRole === 'owner' || c.accessRole === 'writer' });
        seite = r.nextPageToken;
      } while (seite);
      return aus.sort((a, b) => Number(b.primaer) - Number(a.primaer) || a.name.localeCompare(b.name, 'de'));
    },
    async termine(kalenderId, von, bis) {
      const aus: GEvent[] = [];
      let seite: string | undefined;
      do {
        const r = z
          .object({ items: z.array(GEvent).default([]), nextPageToken: z.string().optional() })
          .parse(
            await rufen(`${k(kalenderId)}/events`, {
              abfrage: { singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(von).toISOString(), timeMax: new Date(bis).toISOString(), maxResults: '2500', ...(seite ? { pageToken: seite } : {}) },
            }),
          );
        aus.push(...r.items.filter((e) => e.status !== 'cancelled'));
        seite = r.nextPageToken;
      } while (seite && aus.length < 5000);
      return aus;
    },
    async holen(kalenderId, id) {
      return GEvent.parse(await rufen(`${k(kalenderId)}/events/${encodeURIComponent(id)}`));
    },
    async anlegen(kalenderId, body) {
      return GEvent.parse(await rufen(`${k(kalenderId)}/events`, { methode: 'POST', abfrage: { sendUpdates: 'none' }, body }));
    },
    async aendern(kalenderId, id, body) {
      return GEvent.parse(await rufen(`${k(kalenderId)}/events/${encodeURIComponent(id)}`, { methode: 'PATCH', abfrage: { sendUpdates: 'none' }, body }));
    },
    async loeschen(kalenderId, id) {
      await rufen(`${k(kalenderId)}/events/${encodeURIComponent(id)}`, { methode: 'DELETE', abfrage: { sendUpdates: 'none' } });
    },
    async verschieben(kalenderId, id, ziel) {
      return GEvent.parse(await rufen(`${k(kalenderId)}/events/${encodeURIComponent(id)}/move`, { methode: 'POST', abfrage: { destination: ziel, sendUpdates: 'none' } }));
    },
  };
}

/** Eingabe der App → Google-Event (nur gesetzte Felder; null = entfernen) */
export function zuGoogle(t: TerminEingabe, aendern = false) {
  // beim Ändern das jeweils andere Feld ausdrücklich leeren (ganztags ↔ mit Uhrzeit), beim Anlegen weglassen
  const zeit = (w: string) =>
    t.ganztags
      ? { date: w, ...(aendern ? { dateTime: null, timeZone: null } : {}) }
      : { dateTime: w.length === 16 ? `${w}:00` : w, timeZone: ZONE, ...(aendern ? { date: null } : {}) };
  const body: Record<string, unknown> = { summary: t.titel, start: zeit(t.start), end: zeit(t.ende) };
  if (t.ort !== undefined) body.location = t.ort;
  if (t.beschreibung !== undefined) body.description = t.beschreibung;
  if (t.wiederholung !== undefined && (aendern || t.wiederholung)) body.recurrence = t.wiederholung ? [t.wiederholung] : [];
  if (t.erinnerungen !== undefined) body.reminders = t.erinnerungen === null ? { useDefault: true } : { useDefault: false, overrides: t.erinnerungen.map((m) => ({ method: 'popup', minutes: m })) };
  if (t.farbe !== undefined && (aendern || t.farbe !== null)) body.colorId = t.farbe;
  return body;
}

function vonGoogle(e: GEvent, kal: KalenderInfo): KalenderTermin {
  const ganztags = !!e.start?.date;
  return {
    id: e.id,
    kalenderId: kal.id,
    titel: e.summary ?? '(ohne Titel)',
    start: ganztags ? e.start!.date! : new Date(e.start?.dateTime ?? 0).toISOString(),
    ende: ganztags ? (e.end?.date ?? e.start!.date!) : new Date(e.end?.dateTime ?? e.start?.dateTime ?? 0).toISOString(),
    ganztags,
    ...(e.location ? { ort: e.location } : {}),
    ...(e.description ? { beschreibung: e.description } : {}),
    ...(e.recurringEventId ? { serieId: e.recurringEventId } : {}),
    ...(e.recurrence?.length ? { wiederholung: e.recurrence.find((r) => r.startsWith('RRULE:')) } : {}),
    erinnerungen: e.reminders?.useDefault === false ? (e.reminders.overrides ?? []).map((o) => o.minutes) : null,
    ...(e.colorId ? { farbe: e.colorId } : {}),
    ...(e.htmlLink ? { link: e.htmlLink } : {}),
    ...(e.attendees?.length ? { teilnehmer: e.attendees.length } : {}),
    quelle: 'google',
    schreibbar: kal.schreibbar,
  };
}

/** Uni-Fristen als Overlay (nur anzeigen) */
export interface FristQuelle {
  fristen(): { id: string; titel: string; kurs: string; art: string; frist: string | null; ende: string | null }[];
}

export class GoogleKalender {
  private listeCache?: { bis: number; liste: KalenderInfo[] };
  constructor(
    private o: { klient?: KalenderKlient; ical?: Terminkalender; uni?: FristQuelle; hub: LiveHub; jetzt: () => number },
  ) {}

  get verbunden() {
    return !!this.o.klient;
  }

  private async liste() {
    if (!this.o.klient) return [];
    if (!this.listeCache || this.listeCache.bis < this.o.jetzt()) this.listeCache = { bis: this.o.jetzt() + 10 * 60_000, liste: await this.o.klient.kalender() };
    return this.listeCache.liste;
  }

  private async kal(id: string, schreiben = false) {
    const k = (await this.liste()).find((x) => x.id === id);
    if (!k) throw new DorfFehler(404, 'Diesen Kalender gibt es nicht.');
    if (schreiben && !k.schreibbar) throw new DorfFehler(403, `In „${k.name}“ darfst du keine Termine ändern.`);
    return k;
  }

  /** Termine im Zeitraum (von, bis] – alle Kalender + Uni-Fristen */
  async zeitraum(von: number, bis: number): Promise<KalenderAntwort> {
    if (bis <= von || bis - von > 120 * 86_400_000) throw new DorfFehler(400, 'Zeitraum höchstens 120 Tage.');
    const fristen: KalenderTermin[] = (this.o.uni?.fristen() ?? [])
      .filter((f) => (f.art === 'abgabe' || f.art === 'test') && f.frist && Date.parse(f.frist) >= von && Date.parse(f.frist) < bis)
      .map((f) => ({
        id: `uni:${f.id}`,
        kalenderId: 'uni',
        titel: `${f.art === 'test' ? '📝' : '⏰'} ${f.kurs ? `${f.kurs}: ` : ''}${f.titel}`,
        start: f.frist!,
        ende: f.ende ?? f.frist!,
        ganztags: false,
        quelle: 'uni' as const,
        schreibbar: false,
      }));
    if (this.o.klient) {
      try {
        const kalender = await this.liste();
        const termine = (await Promise.all(kalender.map(async (k) => (await this.o.klient!.termine(k.id, von, bis)).map((e) => vonGoogle(e, k))))).flat();
        return { modus: 'google', kalender, termine: [...termine, ...fristen] };
      } catch (e) {
        // API aus oder Bereich fehlt → wenigstens lesen über iCal, mit Hinweis
        if (!(e instanceof DorfFehler) || e.status !== 409 || !this.o.ical?.eingerichtet) throw e;
        return { ...(await this.icalZeitraum(von, bis, fristen)), hinweis: e.message };
      }
    }
    if (this.o.ical?.eingerichtet) return this.icalZeitraum(von, bis, fristen);
    return { modus: 'aus', hinweis: 'Kein Kalender verbunden. Auf dem Server: dorf gmail-anmelden (mit Kalender) – oder dorf google-kalender für die Nur-lesen-Adresse.', kalender: [], termine: fristen };
  }

  private async icalZeitraum(von: number, bis: number, fristen: KalenderTermin[]): Promise<KalenderAntwort> {
    const t = await this.o.ical!.nurIcal(von, bis);
    const tag = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: ZONE });
    return {
      modus: 'ical',
      hinweis: 'Nur lesen: Zum Anlegen und Bearbeiten auf dem Server „dorf gmail-anmelden“ ausführen und den Kalender erlauben.',
      kalender: [{ id: 'ical', name: 'Mein Kalender', farbe: '#4a86e8', primaer: true, schreibbar: false }],
      termine: [
        ...t
          .filter((x) => x.start != null)
          .map((x) => ({
            id: `ical:${x.uid}`,
            kalenderId: 'ical',
            titel: x.titel,
            start: x.ganztags ? tag(x.start!) : new Date(x.start!).toISOString(),
            ende: x.ganztags ? tag(x.ende ?? x.start! + 86_400_000) : new Date(x.ende ?? x.start!).toISOString(),
            ganztags: x.ganztags,
            ...(x.beschreibung ? { beschreibung: x.beschreibung } : {}),
            quelle: 'ical' as const,
            schreibbar: false,
          })),
        ...fristen,
      ],
    };
  }

  /** Für Morgenzeitung, Corps und kalender_lesen: alle Kalender als einfache Termine; null = Google nicht nutzbar */
  async alsIcs(von: number, bis: number): Promise<IcsTermin[] | null> {
    if (!this.o.klient) return null;
    const kalender = await this.liste();
    const ms = (z: { date?: string | null; dateTime?: string | null } | undefined) => {
      if (z?.dateTime) return Date.parse(z.dateTime);
      if (z?.date) {
        const [j, m, t] = z.date.split('-').map(Number) as [number, number, number];
        return ortszeitZuUtc(j, m, t, 0, 0, 0, ZONE);
      }
      return null;
    };
    const aus: IcsTermin[] = [];
    for (const k of kalender)
      for (const e of await this.o.klient.termine(k.id, von, bis))
        aus.push({
          uid: `${k.id}:${e.id}`,
          titel: e.summary ?? '(ohne Titel)',
          beschreibung: e.description ?? '',
          kategorie: k.name,
          start: ms(e.start),
          ende: ms(e.end),
          ganztags: !!e.start?.date,
          url: e.htmlLink ?? '',
        });
    return aus.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }

  /**
   * Lernzeit einplanen: freie Lücken zwischen jetzt und der Frist, nur innerhalb der Lernzeiten (Standard 08–20 Uhr),
   * mit 15 min Puffer zu anderen Terminen. Je Tag höchstens ein Vorschlag, frühe Tage zuerst – Leif wählt und trägt ein.
   * Ganztägige Termine (Feiertage, Geburtstage) blockieren nicht.
   */
  async freieZeiten(o: { bis: number; dauerMin: number; anzahl?: number; tagVon?: number; tagBis?: number }): Promise<{ start: string; ende: string }[]> {
    if (!this.o.klient) throw new DorfFehler(409, 'Zum Einplanen muss der Google-Kalender verbunden sein (dorf gmail-anmelden).');
    const jetzt = this.o.jetzt();
    const bis = Math.min(o.bis, jetzt + 60 * 86_400_000);
    if (bis <= jetzt) return [];
    const dauer = o.dauerMin * 60_000;
    const puffer = 15 * 60_000;
    const tagVon = o.tagVon ?? 8;
    const tagBis = o.tagBis ?? 20;
    const kalender = await this.liste();
    const belegt: [number, number][] = [];
    for (const k of kalender)
      for (const e of await this.o.klient.termine(k.id, jetzt, bis))
        if (e.start?.dateTime && e.end?.dateTime && (e as { transparency?: string }).transparency !== 'transparent')
          belegt.push([Date.parse(e.start.dateTime) - puffer, Date.parse(e.end.dateTime) + puffer]);
    for (const f of this.o.uni?.fristen() ?? []) if ((f.art === 'pflicht' || f.art === 'test') && f.frist && f.ende) belegt.push([Date.parse(f.frist) - puffer, Date.parse(f.ende) + puffer]);
    belegt.sort((a, b) => a[0] - b[0]);
    const aus: { start: string; ende: string }[] = [];
    // über Kalendertage (Wien) – auch der Fristtag selbst, wenn die Frist erst später am Tag ist
    const letzterTag = tagIn(bis - 1);
    for (let tag = tagIn(jetzt); tag <= letzterTag && aus.length < (o.anzahl ?? 5); tag = tagPlus(tag, 1)) {
      const [j, m, t] = tag.split('-').map(Number) as [number, number, number];
      // auf volle Viertelstunde nach jetzt runden
      let a = Math.max(ortszeitZuUtc(j, m, t, tagVon, 0, 0, ZONE), Math.ceil((jetzt + 30 * 60_000) / (15 * 60_000)) * 15 * 60_000);
      const tagEnde = Math.min(ortszeitZuUtc(j, m, t, tagBis, 0, 0, ZONE), bis);
      while (a + dauer <= tagEnde) {
        const stoss = belegt.find(([s, e]) => s < a + dauer && e > a);
        if (!stoss) {
          aus.push({ start: new Date(a).toISOString(), ende: new Date(a + dauer).toISOString() });
          break;
        }
        a = Math.ceil(stoss[1] / (15 * 60_000)) * 15 * 60_000;
      }
    }
    return aus;
  }

  /**
   * E96 Lernplan: so viele Sitzungen, dass die gewünschten Stunden zusammenkommen, gleichmäßig auf die Tage bis
   * `bis` verteilt (je Tag höchstens eine, die früheste freie Lücke 9–20 Uhr). Nur ein Vorschlag – eintragen tut Leif.
   */
  async lernplan(o: { bis: number; stunden: number; dauerMin: number }) {
    const gewuenscht = Math.max(1, Math.ceil((o.stunden * 60) / o.dauerMin));
    const kandidaten = await this.freieZeiten({ bis: o.bis, dauerMin: o.dauerMin, anzahl: 60, tagVon: 9, tagBis: 20 });
    return { gewuenscht, bloecke: gleichmaessigVerteilen(kandidaten, gewuenscht) };
  }

  /** Freie Zeiten eines Tages (Ortszeit), tagVon–tagBis, 15 min Puffer um Termine; ab jetzt (+15 min), wenn heute */
  async freiAmTag(tag: string, tagVon = 8, tagBis = 20): Promise<[number, number][]> {
    if (!this.o.klient) throw new DorfFehler(409, 'Zum Planen muss der Google-Kalender verbunden sein (dorf gmail-anmelden).');
    const [j, m, t] = tag.split('-').map(Number) as [number, number, number];
    const puffer = 15 * 60_000;
    let a = ortszeitZuUtc(j, m, t, tagVon, 0, 0, ZONE);
    const e = ortszeitZuUtc(j, m, t, tagBis, 0, 0, ZONE);
    a = Math.max(a, Math.ceil((this.o.jetzt() + puffer) / puffer) * puffer);
    if (a >= e) return [];
    const belegt: [number, number][] = [];
    for (const k of await this.liste())
      for (const ev of await this.o.klient.termine(k.id, a, e))
        if (ev.start?.dateTime && ev.end?.dateTime && (ev as { transparency?: string }).transparency !== 'transparent' && !istFristBlock({ titel: ev.summary ?? '' }))
          belegt.push([Date.parse(ev.start.dateTime) - puffer, Date.parse(ev.end.dateTime) + puffer]);
    for (const f of this.o.uni?.fristen() ?? []) if ((f.art === 'pflicht' || f.art === 'test') && f.frist && f.ende) belegt.push([Date.parse(f.frist) - puffer, Date.parse(f.ende) + puffer]);
    belegt.sort((x, y) => x[0] - y[0]);
    const frei: [number, number][] = [];
    let cur = a;
    for (const [s, en] of belegt) {
      if (en <= cur) continue;
      if (s > cur) frei.push([cur, Math.min(s, e)]);
      cur = Math.max(cur, en);
      if (cur >= e) break;
    }
    if (cur < e) frei.push([cur, e]);
    return frei.filter(([x, y]) => y - x >= 30 * 60_000);
  }

  /** Mehrere gewählte Blöcke eintragen (Tag planen) – Leifs Klick */
  async bloeckeEintragen(roh: unknown) {
    const b = z.array(z.object({ titel: z.string().trim().min(1).max(200), start: z.string().datetime(), ende: z.string().datetime() })).min(1).max(10).parse(roh);
    const aus = [];
    for (const x of b) aus.push(await this.lernzeitEintragen(x));
    return aus;
  }

  /** Termin aus Text (Telegram /termin, nach Leifs Bestätigung) in den Hauptkalender */
  async inHauptkalender(t: { titel: string; ganztags: boolean; start: string; ende: string; ort?: string }) {
    const k = (await this.liste()).find((x) => x.primaer && x.schreibbar) ?? (await this.liste()).find((x) => x.schreibbar);
    if (!k) throw new DorfFehler(409, 'Kein Kalender, in den du schreiben darfst.');
    return this.anlegen({ kalenderId: k.id, ...t });
  }

  /** Gewählten Vorschlag in den Hauptkalender eintragen (Leifs Klick): „📚 <Titel>“, Erinnerung 10 min vorher */
  async lernzeitEintragen(roh: unknown) {
    const b = z.object({ titel: z.string().trim().min(1).max(200), start: z.string().datetime(), ende: z.string().datetime(), notiz: z.string().max(2000).optional() }).parse(roh);
    const k = (await this.liste()).find((x) => x.primaer && x.schreibbar) ?? (await this.liste()).find((x) => x.schreibbar);
    if (!k) throw new DorfFehler(409, 'Kein Kalender, in den du schreiben darfst.');
    const lokal = (iso: string) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
          .formatToParts(new Date(iso))
          .map((x) => [x.type, x.value]),
      );
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    return this.anlegen({ kalenderId: k.id, titel: `📚 ${b.titel}`, start: lokal(b.start), ende: lokal(b.ende), erinnerungen: [10], ...(b.notiz ? { beschreibung: b.notiz } : {}) });
  }

  /** E185: Googles Termine eines Kalendertags (Wien) aus den schreibbaren Kalendern, mit IDs – für termin_aendern/_loeschen der Agenten */
  async amTag(datum: string): Promise<KalenderTermin[]> {
    if (!DATUM.test(datum)) throw new DorfFehler(400, 'Datum als JJJJ-MM-TT');
    const [j, m, t] = datum.split('-').map(Number) as [number, number, number];
    const von = ortszeitZuUtc(j, m, t, 0, 0, 0, ZONE);
    const kalender = (await this.liste()).filter((k) => k.schreibbar);
    const alle = (await Promise.all(kalender.map(async (k) => (await this.klient().termine(k.id, von, von + 25 * 3_600_000)).map((e) => vonGoogle(e, k))))).flat();
    return alle.filter((x) => (x.ganztags ? x.start <= datum && datum < x.ende : tagIn(Date.parse(x.start)) === datum));
  }

  private klient() {
    if (!this.o.klient) throw new DorfFehler(409, 'Zum Bearbeiten muss der Google-Kalender verbunden sein (dorf gmail-anmelden).');
    return this.o.klient;
  }

  private geaendert() {
    this.o.hub.senden({ typ: 'kalender.geaendert' });
  }

  /** Serie: RRULE des Serien-Termins (für das Bearbeiten-Formular) */
  async serie(kalenderId: string, serieId: string) {
    await this.kal(kalenderId);
    const e = await this.klient().holen(kalenderId, serieId);
    return { wiederholung: e.recurrence?.find((r) => r.startsWith('RRULE:')) ?? null, start: e.start?.date ?? e.start?.dateTime ?? null };
  }

  async anlegen(roh: unknown) {
    const t = TerminEingabe.parse(roh);
    const k = await this.kal(t.kalenderId, true);
    const e = await this.klient().anlegen(k.id, zuGoogle(t));
    this.geaendert();
    return vonGoogle(e, k);
  }

  /** Ändern: einzelner Termin (Standard) oder – bei Serien – die ganze Serie; anderer Kalender = verschieben */
  async aendern(id: string, roh: unknown, opt: { serie?: boolean; vonKalender?: string } = {}) {
    const t = TerminEingabe.parse(roh);
    const vonKal = await this.kal(opt.vonKalender ?? t.kalenderId, true);
    const ziel = await this.kal(t.kalenderId, true);
    let zielId = id;
    if (opt.serie) {
      const e = await this.klient().holen(vonKal.id, id);
      zielId = e.recurringEventId ?? id;
    }
    if (ziel.id !== vonKal.id) await this.klient().verschieben(vonKal.id, zielId, ziel.id);
    const e = await this.klient().aendern(ziel.id, zielId, zuGoogle(t, true));
    this.geaendert();
    return vonGoogle(e, ziel);
  }

  async loeschen(kalenderId: string, id: string, opt: { serie?: boolean } = {}) {
    const k = await this.kal(kalenderId, true);
    let zielId = id;
    if (opt.serie) zielId = (await this.klient().holen(k.id, id)).recurringEventId ?? id;
    await this.klient().loeschen(k.id, zielId);
    this.geaendert();
  }
}

/** k Elemente möglichst gleichmäßig über die Liste verteilt (erstes und letztes inklusive); Reihenfolge bleibt */
/** E182/E183: kurze Angaben (Cardputer, termin_anlegen der Agenten) → Termin für den Hauptkalender */
export const TerminAngaben = z.object({
  titel: z.string().trim().min(1, 'Titel fehlt').max(200),
  datum: z.string().regex(DATUM, 'Datum als JJJJ-MM-TT'),
  /** leer/fehlt = ganztägig */
  zeit: z
    .string()
    .trim()
    .regex(/^(([01]?\d|2[0-3]):[0-5]\d)?$/, 'Uhrzeit als HH:MM')
    .optional(),
  dauerMin: z.number().int().min(5, 'mindestens 5 min').max(1440, 'höchstens 24 h').optional(),
  ort: z.string().trim().max(200).optional(),
});

export function terminAusAngaben(roh: unknown): { titel: string; ganztags: boolean; start: string; ende: string; ort?: string } {
  const a = TerminAngaben.parse(roh);
  const [j, m, t] = a.datum.split('-').map(Number) as [number, number, number];
  const tag = new Date(Date.UTC(j, m - 1, t));
  if (tag.toISOString().slice(0, 10) !== a.datum) throw new DorfFehler(400, `Den Tag ${a.datum} gibt es nicht.`);
  const ort = a.ort ? { ort: a.ort } : {};
  if (!a.zeit) return { titel: a.titel, ganztags: true, start: a.datum, ende: tagPlus(a.datum, 1), ...ort };
  const [h, mi] = a.zeit.split(':').map(Number) as [number, number];
  const beginn = Date.UTC(j, m - 1, t, h, mi);
  // reines Rechnen in Ortszeit (ohne Zone): 23:30 + 60 min = nächster Tag 00:30
  const lokal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  return { titel: a.titel, ganztags: false, start: lokal(beginn), ende: lokal(beginn + (a.dauerMin ?? 60) * 60_000), ...ort };
}

/** ISO-Zeitpunkt → Ortszeit Wien „JJJJ-MM-TTTHH:MM“ (so erwartet TerminEingabe Start und Ende) */
export function ortszeitText(iso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** „Do 20.11.2026 · 14:00–15:00 (60 min)“ bzw. „Do 20.11.2026 · ganztägig“ – Vorschau für Freigaben */
export function terminVorschau(t: { ganztags: boolean; start: string; ende: string; ort?: string }) {
  const tag = new Date(`${t.start.slice(0, 10)}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const wann = t.ganztags
    ? 'ganztägig'
    : `${t.start.slice(11, 16)}–${t.ende.slice(11, 16)} (${Math.round((Date.parse(`${t.ende}:00Z`) - Date.parse(`${t.start}:00Z`)) / 60_000)} min)`;
  return `${tag} · ${wann}${t.ort ? ` · ${t.ort}` : ''}`;
}

export function gleichmaessigVerteilen<T>(liste: T[], k: number): T[] {
  const n = liste.length;
  if (k >= n) return liste.slice();
  if (k <= 0) return [];
  if (k === 1) return [liste[n - 1]!];
  return Array.from({ length: k }, (_, i) => liste[Math.round((i * (n - 1)) / (k - 1))]!);
}
