/**
 * To-do aus freiem Text (E120/E92, in E127 nach packages/shared, damit App und Telegram gleich erkennen):
 * „Wäsche jeden Montag 30 min“ → Titel, Wiederholung + erstes Datum, geschätzte Dauer.
 */
/** E120: „Referat üben 30 min“, „… 2h“, „… 1,5 Std.“ → Titel und Dauer (nur am Ende, nur mit Einheit) */
export function dauerAusText(text: string): { titel: string; dauer?: number } {
  const m = /^(.*\S)\s+(?:⏱\s*)?(\d{1,3}(?:[.,]\d)?)\s*(min\.?|minuten|h|std\.?|stunden?)$/i.exec(text.trim());
  if (!m) return { titel: text.trim() };
  const zahl = Number(m[2]!.replace(',', '.'));
  const min = Math.round(/^m/i.test(m[3]!) ? zahl : zahl * 60);
  if (!Number.isFinite(min) || min < 5 || min > 600) return { titel: text.trim() };
  return { titel: m[1]!.trim(), dauer: min };
}

/** Telegram/Schnelleingabe: „Wäsche jeden Montag“ → Titel, Regel und erstes Datum (E92) */
export function wiederholungAusText(text: string, heute: string): { titel: string; wiederholen?: string; faellig?: string } {
  const TAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
  const m = /^(.*?)\s+(?:🔁\s*)?(täglich|jeden tag|werktags|jeden werktag|wöchentlich|jede woche|monatlich|jeden monat|jährlich|jedes jahr|alle [1-9]\d{0,2} (?:tage|wochen|monate)|jeden (?:sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag))$/i.exec(text.trim());
  if (!m || !m[1]!.trim()) return { titel: text.trim() };
  const w = m[2]!.toLowerCase();
  const titel = m[1]!.trim();
  const tag = TAGE.findIndex((t) => w === `jeden ${t}`);
  if (tag >= 0) {
    const d = new Date(`${heute}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ((tag - d.getUTCDay() + 7) % 7));
    return { titel, wiederholen: 'wöchentlich', faellig: d.toISOString().slice(0, 10) };
  }
  const regel: Record<string, string> = { 'jeden tag': 'täglich', 'jeden werktag': 'werktags', 'jede woche': 'wöchentlich', 'jeden monat': 'monatlich', 'jedes jahr': 'jährlich' };
  return { titel, wiederholen: regel[w] ?? w, faellig: heute };
}


/** Beides in beliebiger Reihenfolge: „… 30 min jeden Montag“ und „… jeden Montag 30 min“ */
export function todoAusText(text: string, heute: string): { titel: string; wiederholen?: string; faellig?: string; dauer?: number; wartet?: string } {
  const d1 = dauerAusText(text.slice(0, 200));
  const w = wiederholungAusText(d1.titel, heute);
  const d2 = d1.dauer ? { titel: w.titel } : dauerAusText(w.titel);
  const dauer = d1.dauer ?? ('dauer' in d2 ? d2.dauer : undefined);
  // E147: „Note Mathe wartet auf Prof. Müller“ / „… (wartet auf Sekretariat)“ – nur am Ende, mit Titel davor
  const wm = /^(.*?\S)(?:\s+|\s*[(–—-]\s*)wartet auf\s+([^()]{2,80}?)\s*\)?$/i.exec(d2.titel);
  return { ...w, titel: wm ? wm[1]!.replace(/\s*[–—-]$/, '') : d2.titel, ...(dauer ? { dauer } : {}), ...(wm ? { wartet: wm[2]! } : {}) };
}
