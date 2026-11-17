/**
 * Minimaler iCalendar-Leser (RFC 5545) für den Kalender-Export von Moodle.
 * Nur was das Dorf braucht: VEVENT mit UID, SUMMARY, DESCRIPTION, CATEGORIES, DTSTART/DTEND, URL.
 */

export interface IcsTermin {
  uid: string;
  titel: string;
  beschreibung: string;
  kategorie: string;
  start: number | null; // ms
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

function zeitWert(params: Record<string, string>, w: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(w.trim());
  if (!m) return null;
  const [j, mo, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!m[4]) return ortszeitZuUtc(j, mo, t, 23, 59, 0, 'Europe/Vienna'); // ganztägig: Ende des Tages in Linz
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return Date.UTC(j, mo - 1, t, h, mi, s);
  let zone = params.TZID?.replace(/^"|"$/g, '') || 'Europe/Vienna';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'Europe/Vienna';
  }
  return ortszeitZuUtc(j, mo, t, h, mi, s, zone);
}

export function icsLesen(text: string): IcsTermin[] {
  const zeilen = entfalten(text);
  if (!zeilen.some((z) => z.trim().toUpperCase() === 'BEGIN:VCALENDAR')) throw new Error('Das ist keine Kalenderdatei (BEGIN:VCALENDAR fehlt).');
  const aus: IcsTermin[] = [];
  let akt: Record<string, { params: Record<string, string>; wert: string }> | null = null;
  for (const z of zeilen) {
    const doppel = z.indexOf(':');
    if (doppel < 0) continue;
    const kopf = z.slice(0, doppel);
    const wert = z.slice(doppel + 1);
    const [nameRoh, ...paramTeile] = kopf.split(';');
    const name = nameRoh!.toUpperCase();
    if (name === 'BEGIN' && wert.trim().toUpperCase() === 'VEVENT') akt = {};
    else if (name === 'END' && wert.trim().toUpperCase() === 'VEVENT') {
      if (akt) {
        const p = (n: string) => akt![n];
        const start = p('DTSTART') ? zeitWert(p('DTSTART')!.params, p('DTSTART')!.wert) : null;
        const ende = p('DTEND') ? zeitWert(p('DTEND')!.params, p('DTEND')!.wert) : null;
        aus.push({
          uid: textWert(p('UID')?.wert ?? '') || `${textWert(p('SUMMARY')?.wert ?? '')}@${start}`,
          titel: textWert(p('SUMMARY')?.wert ?? '(ohne Titel)'),
          beschreibung: textWert(p('DESCRIPTION')?.wert ?? ''),
          kategorie: textWert(p('CATEGORIES')?.wert ?? '').split(/(?<!\\),/)[0]!.trim(),
          // Frist = Start; Moodle setzt bei Abgaben Start = Ende. Ohne Start notfalls das Ende.
          start: start ?? ende,
          url: textWert(p('URL')?.wert ?? ''),
        });
      }
      akt = null;
    } else if (akt && !(name in akt)) {
      const params = Object.fromEntries(
        paramTeile.map((t) => {
          const i = t.indexOf('=');
          return [t.slice(0, i).toUpperCase(), t.slice(i + 1)];
        }),
      );
      akt[name] = { params, wert };
    }
  }
  return aus;
}

/** Art einer Frist aus dem Titel (Moodle: „… ist fällig“ / „… is due“, Tests „… schließt“ / „… closes“) */
export function terminArt(titel: string): 'abgabe' | 'test' | 'termin' {
  if (/\b(ist fällig|is due|fällig|due)\b|abgabe|submission/i.test(titel)) return 'abgabe';
  if (/\b(quiz|test|klausur|prüfung|exam)\b|schließt|closes/i.test(titel)) return 'test';
  return 'termin';
}
