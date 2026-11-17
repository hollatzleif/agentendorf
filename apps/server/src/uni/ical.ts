/**
 * Kleiner iCalendar-Leser (RFC 5545) für Moodle- und Google-Kalender.
 * Nur was das Dorf braucht: VEVENT mit UID, SUMMARY, DESCRIPTION, CATEGORIES, DTSTART/DTEND, URL, STATUS,
 * Serien (RRULE, EXDATE, RECURRENCE-ID).
 */

export interface IcsTermin {
  uid: string;
  titel: string;
  beschreibung: string;
  kategorie: string;
  start: number | null; // ms
  ende: number | null; // ms
  ganztags: boolean;
  url: string;
}

/** Zeilen entfalten: CRLF/LF gefolgt von Leerzeichen oder Tab setzt die vorige Zeile fort. */
function entfalten(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function textWert(w: string) {
  return w.replace(/\\([\;,nN])/g, (_g, z: string) => (z === 'n' || z === 'N' ? '\n' : z)).trim();
}

/** Ortszeit in einer IANA-Zone → UTC-ms (über Intl, ohne Bibliothek) */
export function ortszeitZuUtc(j: number, mo: number, t: number, h: number, mi: number, s: number, zone: string) {
  const annahme = Date.UTC(j, mo - 1, t, h, mi, s);
  let ergebnis = annahme;
  for (let i = 0; i < 2; i++) {
    const teile = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ergebnis))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const alsUtc = Date.UTC(teile.year!, teile.month! - 1, teile.day!, teile.hour!, teile.minute!, teile.second!);
    ergebnis -= alsUtc - annahme;
  }
  return ergebnis;
}

/** Zeitpunkt, wie er im Kalender steht: Ortszeit (Wanduhr) + Zone, oder UTC, oder ganztägig */
interface Zeitangabe {
  j: number;
  mo: number;
  t: number;
  h: number;
  mi: number;
  s: number;
  zone: string | null; // null = UTC
  ganztags: boolean;
}

function zeitLesen(params: Record<string, string>, w: string): Zeitangabe | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(w.trim());
  if (!m) return null;
  const [j, mo, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!m[4]) return { j, mo, t, h: 0, mi: 0, s: 0, zone: 'Europe/Vienna', ganztags: true };
  let zone: string | null = m[7] ? null : params.TZID?.replace(/^"|"$/g, '') || 'Europe/Vienna';
  if (zone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
    } catch {
      zone = 'Europe/Vienna';
    }
  }
  return { j, mo, t, h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0), zone, ganztags: false };
}

function inUtc(z: Zeitangabe) {
  return z.zone === null ? Date.UTC(z.j, z.mo - 1, z.t, z.h, z.mi, z.s) : ortszeitZuUtc(z.j, z.mo, z.t, z.h, z.mi, z.s, z.zone);
}

/** Frist-Zeitpunkt: ganztägig = Ende des Tages in Linz */
function fristUtc(z: Zeitangabe) {
  return z.ganztags ? ortszeitZuUtc(z.j, z.mo, z.t, 23, 59, 0, 'Europe/Vienna') : inUtc(z);
}

/** Datum um n Tage verschieben (reiner Kalender, ohne Zeitzone) */
function plusTage(z: Zeitangabe, n: number): Zeitangabe {
  const d = new Date(Date.UTC(z.j, z.mo - 1, z.t) + n * 86_400_000);
  return { ...z, j: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, t: d.getUTCDate() };
}

function wochentag(z: Zeitangabe) {
  return new Date(Date.UTC(z.j, z.mo - 1, z.t)).getUTCDay(); // 0 = Sonntag
}

type Roh = Record<string, { params: Record<string, string>; wert: string }[]>;

function bloeckeLesen(text: string): Roh[] {
  const zeilen = entfalten(text);
  if (!zeilen.some((z) => z.trim().toUpperCase() === 'BEGIN:VCALENDAR')) throw new Error('Das ist keine Kalenderdatei (BEGIN:VCALENDAR fehlt).');
  const aus: Roh[] = [];
  let akt: Roh | null = null;
  let tiefe = 0; // VALARM u. Ä. innerhalb eines VEVENT überspringen
  for (const z of zeilen) {
    const doppel = z.indexOf(':');
    if (doppel < 0) continue;
    const kopf = z.slice(0, doppel);
    const wert = z.slice(doppel + 1);
    const [nameRoh, ...paramTeile] = kopf.split(';');
    const name = nameRoh!.toUpperCase();
    const w = wert.trim().toUpperCase();
    if (name === 'BEGIN' && w === 'VEVENT') {
      akt = {};
      tiefe = 0;
    } else if (name === 'BEGIN' && akt) tiefe++;
    else if (name === 'END' && w === 'VEVENT') {
      if (akt) aus.push(akt);
      akt = null;
    } else if (name === 'END' && akt) tiefe--;
    else if (akt && tiefe === 0) {
      const params = Object.fromEntries(
        paramTeile.map((t) => {
          const i = t.indexOf('=');
          return [t.slice(0, i).toUpperCase(), t.slice(i + 1)];
        }),
      );
      (akt[name] ??= []).push({ params, wert });
    }
  }
  return aus;
}

const eins = (r: Roh, n: string) => r[n]?.[0];

function terminAus(r: Roh): (IcsTermin & { _start: Zeitangabe | null; _ende: Zeitangabe | null }) {
  const st = eins(r, 'DTSTART') ? zeitLesen(eins(r, 'DTSTART')!.params, eins(r, 'DTSTART')!.wert) : null;
  const en = eins(r, 'DTEND') ? zeitLesen(eins(r, 'DTEND')!.params, eins(r, 'DTEND')!.wert) : null;
  const start = st ? fristUtc(st) : en ? fristUtc(en) : null;
  return {
    uid: textWert(eins(r, 'UID')?.wert ?? '') || `${textWert(eins(r, 'SUMMARY')?.wert ?? '')}@${start}`,
    titel: textWert(eins(r, 'SUMMARY')?.wert ?? '(ohne Titel)'),
    beschreibung: textWert(eins(r, 'DESCRIPTION')?.wert ?? ''),
    kategorie: textWert(eins(r, 'CATEGORIES')?.wert ?? '').split(/(?<!\\),/)[0]!.trim(),
    // Frist = Start; Moodle setzt bei Abgaben Start = Ende. Ohne Start notfalls das Ende.
    start,
    ende: en && !en.ganztags ? inUtc(en) : st?.ganztags ? fristUtc(st) : null,
    ganztags: !!st?.ganztags,
    url: textWert(eins(r, 'URL')?.wert ?? ''),
    _start: st,
    _ende: en,
  };
}

/** Termine ohne Wiederholungen (für den Moodle-Export, der keine Serien enthält) */
export function icsLesen(text: string): IcsTermin[] {
  return bloeckeLesen(text)
    .filter((r) => !eins(r, 'RECURRENCE-ID'))
    .map((r) => {
      const { _start: _s, _ende: _e, ...t } = terminAus(r);
      return t;
    });
}

const TAGE: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_SCHRITTE = 5000;

/**
 * Termine im Zeitfenster [von, bis) – Serien (RRULE) werden aufgelöst: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 * COUNT, UNTIL, BYDAY (bei WEEKLY), EXDATE, verschobene/abgesagte Einzeltermine (RECURRENCE-ID, STATUS:CANCELLED).
 * Gerechnet wird in Ortszeit (Wanduhr), damit die Zeitumstellung stimmt. Unbekannte Regeln → nur der erste Termin + Hinweis.
 */
export function icsTermine(text: string, von: number, bis: number, hinweise: string[] = []): IcsTermin[] {
  const bloecke = bloeckeLesen(text);
  // verschobene/abgesagte Einzeltermine einer Serie: uid → (ursprünglicher Zeitpunkt → Ersatz)
  const ersatz = new Map<string, Map<number, Roh>>();
  for (const r of bloecke) {
    const rid = eins(r, 'RECURRENCE-ID');
    if (!rid) continue;
    const z = zeitLesen(rid.params, rid.wert);
    if (!z) continue;
    const uid = textWert(eins(r, 'UID')?.wert ?? '');
    if (!ersatz.has(uid)) ersatz.set(uid, new Map());
    ersatz.get(uid)!.set(fristUtc(z), r);
  }
  const aus: IcsTermin[] = [];
  const nimm = (t: IcsTermin) => {
    const zeit = t.ende ?? t.start;
    if (t.start != null && zeit != null && zeit >= von && t.start < bis) aus.push(t);
  };
  const abgesagt = (r: Roh) => (eins(r, 'STATUS')?.wert ?? '').trim().toUpperCase() === 'CANCELLED';

  for (const r of bloecke) {
    if (eins(r, 'RECURRENCE-ID') || abgesagt(r)) continue;
    const { _start: st, _ende: en, ...basis } = terminAus(r);
    const regel = eins(r, 'RRULE')?.wert;
    if (!regel || !st) {
      nimm(basis);
      continue;
    }
    const teile = Object.fromEntries(regel.split(';').map((x) => x.split('=') as [string, string]));
    const freq = teile.FREQ;
    const intervall = Math.max(1, Number(teile.INTERVAL ?? 1));
    const anzahl = teile.COUNT ? Number(teile.COUNT) : Infinity;
    const until = teile.UNTIL ? zeitLesen({}, teile.UNTIL) : null;
    const bisUtc = until ? (until.ganztags ? fristUtc(until) : inUtc(until)) : Infinity;
    const dauer = basis.ende != null && basis.start != null ? basis.ende - basis.start : 0;
    const ausgenommen = new Set<number>();
    for (const ex of r.EXDATE ?? []) for (const w of ex.wert.split(',')) {
      const z = zeitLesen(ex.params, w);
      if (z) ausgenommen.add(fristUtc(z));
    }
    const eigene = ersatz.get(basis.uid);
    const termin = (z: Zeitangabe) => {
      const s = fristUtc(z);
      if (ausgenommen.has(s)) return;
      const e = eigene?.get(s);
      if (e) {
        if (abgesagt(e)) return;
        const { _start: _a, _ende: _b, ...t } = terminAus(e);
        nimm({ ...t, uid: `${basis.uid}#${s}` });
        return;
      }
      nimm({ ...basis, uid: `${basis.uid}#${s}`, start: s, ende: dauer ? s + dauer : basis.ganztags ? s : null });
    };

    let gezaehlt = 0;
    const weiter = (z: Zeitangabe) => gezaehlt < anzahl && fristUtc(z) <= bisUtc && fristUtc(z) < bis;
    if (freq === 'WEEKLY') {
      const tage = (teile.BYDAY ? teile.BYDAY.split(',').map((d) => TAGE[d.slice(-2)]!) : [wochentag(st)]).filter((d) => d != null).sort();
      // Wochen ab dem Montag der Startwoche
      const montag = plusTage(st, -((wochentag(st) + 6) % 7));
      for (let w = 0, schritte = 0; schritte < MAX_SCHRITTE; w += intervall, schritte++) {
        let ende = false;
        for (const d of tage) {
          const z = plusTage(montag, w * 7 + ((d + 6) % 7));
          if (Date.UTC(z.j, z.mo - 1, z.t) < Date.UTC(st.j, st.mo - 1, st.t)) continue;
          if (!weiter(z)) {
            ende = true;
            break;
          }
          gezaehlt++;
          termin(z);
        }
        if (ende) break;
      }
    } else if (freq === 'DAILY') {
      for (let n = 0; n < MAX_SCHRITTE; n++) {
        const z = plusTage(st, n * intervall);
        if (!weiter(z)) break;
        gezaehlt++;
        termin(z);
      }
    } else if ((freq === 'MONTHLY' || freq === 'YEARLY') && !Object.keys(teile).some((k) => k.startsWith('BY'))) {
      for (let n = 0; n < MAX_SCHRITTE; n++) {
        const monate = (freq === 'MONTHLY' ? 1 : 12) * intervall * n;
        const jahr = st.j + Math.floor((st.mo - 1 + monate) / 12);
        const monat = ((st.mo - 1 + monate) % 12) + 1;
        const z = { ...st, j: jahr, mo: monat };
        if (new Date(Date.UTC(jahr, monat - 1, st.t)).getUTCMonth() !== monat - 1) continue; // z. B. 31. im Februar
        if (!weiter(z)) break;
        gezaehlt++;
        termin(z);
      }
    } else {
      hinweise.push(`Serie „${basis.titel}“: Wiederholungsregel ${regel} wird nicht unterstützt – nur der erste Termin.`);
      nimm(basis);
    }
  }
  return aus.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

/** Art einer Frist aus dem Titel (Moodle: „… ist fällig“ / „… is due“, Tests „… schließt“ / „… closes“) */
export function terminArt(titel: string): 'abgabe' | 'test' | 'termin' {
  if (/\b(ist fällig|is due|fällig|due)\b|abgabe|submission/i.test(titel)) return 'abgabe';
  if (/\b(quiz|test|klausur|prüfung|exam)\b|schließt|closes/i.test(titel)) return 'test';
  return 'termin';
}
