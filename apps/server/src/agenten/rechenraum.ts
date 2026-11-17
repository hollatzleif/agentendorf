import path from 'node:path';
import { DorfFehler } from '../fehler.js';

/**
 * Rechenraum: eigener Container mit pdflatex, Python und pdftoppm – ohne Internet, ohne Vault.
 * Das Dorf ist der einzige Weg hinein (Dateien, Befehle) und hinaus (Ablage in einen vom Code bestimmten Ordner).
 */
export interface RechenraumKlient {
  befehl(raum: string, befehl: string): Promise<{ code: number | null; abgelaufen: boolean; sekunden: number; ausgabe: string }>;
  schreiben(raum: string, pfad: string, inhalt: Buffer): Promise<void>;
  lesen(raum: string, pfad: string): Promise<Buffer>;
  dateien(raum: string): Promise<{ pfad: string; groesse: number }[]>;
  seite(raum: string, pdf: string, seite: number): Promise<{ png: Buffer; seiten: number | null }>;
  aufraeumen(raum: string): Promise<void>;
}

export function rechenraumKlient(url: string, geheimnis: string): RechenraumKlient {
  const basis = url.replace(/\/$/, '');
  async function post<T>(weg: string, daten: Record<string, unknown>, zeitMs = 60_000): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${basis}${weg}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rechenraum-geheimnis': geheimnis },
        body: JSON.stringify(daten),
        signal: AbortSignal.timeout(zeitMs),
      });
    } catch (e) {
      throw new DorfFehler(503, `Rechenraum nicht erreichbar (${(e as Error).message}). Auf dem Server: dorf status`);
    }
    const j = (await r.json().catch(() => ({}))) as T & { fehler?: string };
    if (!r.ok) throw new DorfFehler(r.status === 401 ? 503 : 400, j.fehler ?? `Rechenraum: HTTP ${r.status}`);
    return j;
  }
  return {
    befehl: (raum, befehl) => post('/befehl', { raum, befehl }, 180_000),
    async schreiben(raum, pfad, inhalt) {
      await post('/schreiben', { raum, pfad, inhalt_b64: inhalt.toString('base64') });
    },
    async lesen(raum, pfad) {
      return Buffer.from((await post<{ inhalt_b64: string }>('/lesen', { raum, pfad })).inhalt_b64, 'base64');
    },
    async dateien(raum) {
      return (await post<{ dateien: { pfad: string; groesse: number }[] }>('/dateien', { raum })).dateien;
    },
    async seite(raum, pdf, seite) {
      const r = await post<{ png: string; seiten: number | null }>('/seite', { raum, pdf, seite, dpi: 100 });
      return { png: Buffer.from(r.png, 'base64'), seiten: r.seiten };
    },
    async aufraeumen(raum) {
      await post('/aufraeumen', { raum });
    },
  };
}

/** Kurzname für Ordner: Kleinbuchstaben, Ziffern, Bindestriche */
export function kurzname(t: string, max = 40) {
  const umlaute: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  return (
    t
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => umlaute[z] ?? z)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'entwurf'
  );
}

function stempel(ms: number) {
  // Linzer Zeit, wie die Dateinamen der Agenten: JJJJ-MM-TT_HHMM
  const t = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(ms))
    .replace(' ', '_')
    .replace(':', '');
  return t;
}

/**
 * Der Ordner, in den rechenraum_ablegen schreibt – bestimmt vom CODE, nie vom Agenten:
 *   Uni mit Eingabe „abgabe“ (= „<Fach>/aufgaben/<Abgabe>“): Uni/faecher/<Fach>/entwuerfe/JJJJ-MM-TT_HHMM_<abgabe>/
 *   sonst: <Gebäude>/entwuerfe/JJJJ-MM-TT_HHMM_<chat-titel>/
 * Der Zeitstempel ist der Start des Chats – alle Läufe eines Chats legen in denselben Ordner.
 */
export function ablageOrdner(c: { gebaeude: string; titel: string; erstellt: number; eingaben: Record<string, string> }) {
  const m = c.gebaeude === 'Uni' ? /^([^/]+)\/aufgaben\/([^/]+)$/.exec(c.eingaben.abgabe ?? '') : null;
  if (m && !m[1]!.startsWith('.')) return `Uni/faecher/${m[1]}/entwuerfe/${stempel(c.erstellt)}_${kurzname(m[2]!)}`;
  return `${c.gebaeude}/entwuerfe/${stempel(c.erstellt)}_${kurzname(c.titel)}`;
}

/** Nur fertige Ergebnisse verlassen den Rechenraum */
export const ABLAGE_ENDUNGEN = ['.pdf', '.tex'];

export function ablageName(datei: string) {
  const name = path.posix.basename(datei.replace(/\\/g, '/'));
  const ext = path.posix.extname(name).toLowerCase();
  if (!ABLAGE_ENDUNGEN.includes(ext)) throw new DorfFehler(400, `Abgelegt werden nur ${ABLAGE_ENDUNGEN.join(' und ')} – nicht „${name}“.`);
  const basis = name
    .slice(0, -ext.length)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 100);
  if (!basis) throw new DorfFehler(400, 'Ungültiger Dateiname.');
  return basis + ext;
}
