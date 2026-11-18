/**
 * Termin aus einfachem deutschen Text (Nacht 18./19.11.) – ohne KI, damit es verlässlich und sofort geht:
 *   „morgen 14 Uhr Zahnarzt“ · „Fr 9-11 Lernen Mathe“ · „20.11. 18:30 Kneipe @Corpshaus“ · „übermorgen Geburtstag Oma“
 *   „nächsten Dienstag 10:15 für 2h Sprechstunde“ · „in 3 Tagen 8 Uhr Laufen 45 min“
 * Ohne Uhrzeit → ganztägig. Ohne Datum, aber mit Uhrzeit → heute (oder morgen, wenn die Zeit schon vorbei ist).
 * Ergebnis in Ortszeit (Europe/Vienna) als JJJJ-MM-TT bzw. JJJJ-MM-TTTHH:MM – genau das Format der Kalender-API.
 */
export interface TerminAusText {
  titel: string;
  ganztags: boolean;
  start: string;
  /** ganztags: exklusiv (Folgetag) */
  ende: string;
  ort?: string;
}

const WT: Record<string, number> = {
  so: 0, sonntag: 0,
  mo: 1, montag: 1,
  di: 2, dienstag: 2,
  mi: 3, mittwoch: 3,
  do: 4, donnerstag: 4,
  fr: 5, freitag: 5,
  sa: 6, samstag: 6,
};

function tagPlus(tag: string, n: number) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const zwei = (n: number) => String(n).padStart(2, '0');

function ortJetzt(ms: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { tag: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

export function terminAusText(rohText: string, jetztMs: number): TerminAusText | null {
  let t = ` ${rohText.trim().replace(/\s+/g, ' ')} `;
  const jetzt = ortJetzt(jetztMs);
  let tag: string | null = null;
  let von: number | null = null;
  let bis: number | null = null;
  let dauer: number | null = null;
  let ort: string | undefined;
  const weg = (m: RegExpExecArray) => {
    t = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`;
  };
  let m: RegExpExecArray | null;

  // Ort: „@Corpshaus“ oder „@ Mensa Linz“ (bis zum Ende)
  if ((m = /\s@\s?(.+?)\s*$/.exec(t))) {
    ort = m[1]!.trim();
    weg(m);
  }
  // Datum
  if ((m = /\s(heute)\s/i.exec(t))) (tag = jetzt.tag), weg(m);
  else if ((m = /\s(übermorgen|uebermorgen)\s/i.exec(t))) (tag = tagPlus(jetzt.tag, 2)), weg(m);
  else if ((m = /\s(morgen)\s/i.exec(t))) (tag = tagPlus(jetzt.tag, 1)), weg(m);
  else if ((m = /\sin (\d{1,3}) (tagen|tag)\s/i.exec(t))) (tag = tagPlus(jetzt.tag, Number(m[1]))), weg(m);
  else if ((m = /\s(?:am )?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s/.exec(t))) {
    const tt = Number(m[1]);
    const mm = Number(m[2]);
    let jj = m[3] ? Number(m[3]) : Number(jetzt.tag.slice(0, 4));
    if (jj < 100) jj += 2000;
    if (mm >= 1 && mm <= 12 && tt >= 1 && tt <= 31) {
      tag = `${jj}-${zwei(mm)}-${zwei(tt)}`;
      // ohne Jahr und schon vorbei → nächstes Jahr
      if (!m[3] && tag < jetzt.tag) tag = `${jj + 1}-${zwei(mm)}-${zwei(tt)}`;
      weg(m);
    }
  } else if ((m = /\s(?:(?:am|nächsten|naechsten|kommenden)\s)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?\s/i.exec(t))) {
    const ziel = WT[m[1]!.toLowerCase()]!;
    const heuteWt = new Date(`${jetzt.tag}T12:00:00Z`).getUTCDay();
    let diff = (ziel - heuteWt + 7) % 7;
    if (diff === 0 || /nächsten|naechsten/i.test(m[0])) diff = diff === 0 ? 7 : diff;
    tag = tagPlus(jetzt.tag, diff);
    weg(m);
  }
  // Uhrzeit: „9-11 Uhr“, „von 9 bis 11“, „14:00–15:30“
  const zeit = '(\\d{1,2})(?:[:.](\\d{2}))?';
  if ((m = new RegExp(`\\s(?:von |um |ab )?${zeit}\\s?(?:uhr\\s?)?(?:-|–|bis )\\s?${zeit}\\s?(?:uhr)?\\s`, 'i').exec(t))) {
    von = Number(m[1]) * 60 + Number(m[2] ?? 0);
    bis = Number(m[3]) * 60 + Number(m[4] ?? 0);
    weg(m);
  } else if ((m = new RegExp(`\\s(?:um |ab )?(\\d{1,2})[:.](\\d{2})(?:\\s?uhr)?\\s`, 'i').exec(t)) || (m = /\s(?:um |ab )?(\d{1,2})\s?uhr\s/i.exec(t)) || (m = /\sum (\d{1,2})\s/i.exec(t))) {
    von = Number(m[1]) * 60 + Number(m[2] ?? 0);
    weg(m);
  }
  // Dauer: „für 2h“, „2 Stunden“, „90 min“, „1,5 h“
  if ((m = /\s(?:für |fuer )?(\d+(?:[,.]\d+)?)\s?(h|std|stunden?|min|minuten)\s/i.exec(t))) {
    const n = Number(m[1]!.replace(',', '.'));
    dauer = /^m/i.test(m[2]!) ? n : n * 60;
    weg(m);
  }
  if (von != null && (von >= 24 * 60 || von < 0)) return null;
  if (bis != null && (bis > 24 * 60 || bis <= (von ?? 0))) bis = null;

  const titel = t.replace(/\s+/g, ' ').trim().replace(/^[-–:,]\s*/, '');
  if (!titel) return null;
  if (von == null) {
    const d = tag ?? jetzt.tag;
    return { titel, ganztags: true, start: d, ende: tagPlus(d, 1), ...(ort ? { ort } : {}) };
  }
  // nur Uhrzeit: heute, oder morgen, wenn schon vorbei
  if (!tag) tag = von > jetzt.min ? jetzt.tag : tagPlus(jetzt.tag, 1);
  const ende = bis ?? Math.min(von + Math.round(dauer ?? 60), 24 * 60);
  const iso = (d: string, min: number) => (min >= 24 * 60 ? `${tagPlus(d, 1)}T00:00` : `${d}T${zwei(Math.floor(min / 60))}:${zwei(min % 60)}`);
  return { titel, ganztags: false, start: iso(tag, von), ende: iso(tag, ende), ...(ort ? { ort } : {}) };
}
