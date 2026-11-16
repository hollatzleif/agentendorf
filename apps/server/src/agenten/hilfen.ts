const z2 = (n: number) => String(n).padStart(2, '0');

/** JJJJ-MM-TT_HHMM in lokaler Zeit (Container-TZ: Europe/Vienna) */
export function dateiStempel(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}`;
}

export function lokaleZeit(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}`;
}

/** Kurzer ASCII-Name für Dateinamen: „Übung 3: Lösung“ → „uebung-3-loesung“ */
export function kurztitel(t: string, max = 40) {
  const s = t
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'chat';
}

/** Zieht den Abschnitt „## Zusammenfassung“ aus der letzten Agenten-Antwort. */
export function zusammenfassungAus(text: string): string | null {
  const m = /^##\s*Zusammenfassung\s*$/im.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length).trim() || null;
}

export function dauerText(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
