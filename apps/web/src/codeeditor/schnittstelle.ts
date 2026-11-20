import type { EditorBaum, EditorDatei, EditorGitAntwort, EditorGitStatus, EditorTreffer } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/** Editor im Codehaus (E197): alle Aufrufe gehen an das Dorf (/api/coding/editor/*), nie direkt an den Container. */
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const B = '/api/coding/editor';

export const editorApi = {
  baum: (projekt: string, pfad: string) => api<EditorBaum>(`${B}/baum?${q({ projekt, pfad })}`),
  datei: (projekt: string, pfad: string) => api<EditorDatei>(`${B}/datei?${q({ projekt, pfad })}`),
  rohUrl: (projekt: string, pfad: string) => `${B}/roh?${q({ projekt, pfad })}`,
  dateien: (projekt: string) => api<{ dateien: string[]; gekuerzt: boolean }>(`${B}/dateien?${q({ projekt })}`),
  speichern: (projekt: string, pfad: string, text: string, basisVersion?: string) =>
    api<{ version: string; groesse: number }>(`${B}/datei`, { methode: 'PUT', body: { projekt, pfad, text, ...(basisVersion ? { basisVersion } : {}) } }),
  neu: (projekt: string, pfad: string, art: 'datei' | 'ordner') => api(`${B}/neu`, { body: { projekt, pfad, art } }),
  umbenennen: (projekt: string, von: string, nach: string) => api(`${B}/umbenennen`, { body: { projekt, von, nach } }),
  loeschen: (projekt: string, pfad: string) => api(`${B}/loeschen`, { body: { projekt, pfad } }),
  projektAnlegen: (projekt: string) => api(`${B}/projekt`, { body: { projekt } }),
  suche: (projekt: string, text: string, opt: { regex?: boolean; gross?: boolean; wort?: boolean }) => api<{ treffer: EditorTreffer[]; gekuerzt: boolean }>(`${B}/suche`, { body: { projekt, text, ...opt } }),
  git: <T = EditorGitAntwort>(projekt: string, befehl: string, mehr: Record<string, unknown> = {}) => api<T>(`${B}/git`, { body: { projekt, befehl, ...mehr } }),
  gitStatus: (projekt: string) => api<EditorGitStatus>(`${B}/git`, { body: { projekt, befehl: 'status' } }),
  /** Eine Datei roh hochladen (bis 20 MB). 409 = gibt es schon → mit ersetzen noch einmal. */
  async hochladen(projekt: string, pfad: string, datei: Blob, ersetzen = false) {
    const r = await fetch(`${B}/hochladen?${q({ projekt, pfad, ...(ersetzen ? { ersetzen: '1' } : {}) })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: datei,
      credentials: 'same-origin',
    });
    if (r.ok) return;
    const j = (await r.json().catch(() => ({}))) as { fehler?: string };
    if (r.status === 401) window.dispatchEvent(new Event('dorf:abgemeldet'));
    throw new ApiFehler(r.status, j.fehler ?? (r.status === 413 ? 'Die Datei ist zu groß (höchstens 20 MB).' : `Fehler ${r.status}`));
  },
};

export const elternVon = (pfad: string) => (pfad.includes('/') ? pfad.slice(0, pfad.lastIndexOf('/')) : '');
export const nameVon = (pfad: string) => pfad.slice(pfad.lastIndexOf('/') + 1);
export const verbinden = (ordner: string, name: string) => (ordner ? `${ordner}/${name}` : name);

/** Namen/Unterpfade, die Leif eintippt: gleiche Regeln wie Server und Runner – die Meldung kommt aber sofort */
export function pfadFehler(pfad: string): string | null {
  if (!pfad.trim()) return 'Name fehlt.';
  if (pfad.startsWith('/') || pfad.includes('\\')) return 'Nur Pfade innerhalb des Projekts.';
  for (const t of pfad.split('/')) {
    if (!t || t === '.' || t === '..') return 'Der Pfad darf kein „..“ und keine leeren Teile enthalten.';
    if (t === '.git') return '.git ist über den Editor nicht erreichbar.';
  }
  return null;
}

/** Treffer für die Schnellsuche: alle Zeichen der Eingabe der Reihe nach im Pfad; Treffer im Dateinamen zuerst, kurze Pfade zuerst */
export function schnellFiltern(dateien: string[], eingabe: string, max = 60): string[] {
  const e = eingabe.trim().toLowerCase();
  if (!e) return dateien.slice(0, max);
  const bewertet: [number, string][] = [];
  for (const d of dateien) {
    const klein = d.toLowerCase();
    const name = klein.slice(klein.lastIndexOf('/') + 1);
    let punkte: number;
    if (name === e) punkte = 0;
    else if (name.startsWith(e)) punkte = 1;
    else if (name.includes(e)) punkte = 2;
    else if (klein.includes(e)) punkte = 3;
    else {
      let i = 0;
      for (const z of klein) if (z === e[i]) i++;
      if (i < e.length) continue;
      punkte = 5;
    }
    bewertet.push([punkte * 1000 + d.length, d]);
  }
  return bewertet
    .sort((a, b) => a[0] - b[0])
    .slice(0, max)
    .map((x) => x[1]);
}
