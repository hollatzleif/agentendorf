import path from 'node:path';
import type { AktionsWerkzeug } from '@dorf/shared';
import { normalisieren } from '../vault/pfade.js';
import { DorfFehler } from '../fehler.js';

/**
 * Die Leine: EINE Stelle im Code, die festlegt, was Agenten dürfen – für beide Motoren.
 * Grundsatz: Lesen überall, Schreiben nur im eigenen Gebäude (ohne Anweisungen, Protokolle, Chats),
 * nie überschreiben, was nicht aus demselben Chat stammt, Außenwirkung nur per Freigabe-Antrag.
 */

/** Werkzeuge, die ein Agent überhaupt bekommen kann (Namen wie im Modell sichtbar). */
export type DorfWerkzeug =
  | 'vault_lesen'
  | 'vault_liste'
  | 'vault_suchen'
  | 'vault_schreiben'
  | 'freigabe_beantragen'
  | 'aktionen_liste'
  | 'helfer_starten'
  | 'plan_vorlegen'
  | 'rechenraum_befehl'
  | 'rechenraum_schreiben'
  | 'rechenraum_vault_kopieren'
  | 'rechenraum_seite_ansehen'
  | 'rechenraum_ablegen'
  | 'post_lesen'
  | 'post_entwurf'
  | 'moodle_oeffnen'
  | 'moodle_klicken'
  | 'moodle_seite'
  | 'moodle_zurueck'
  | 'moodle_bild'
  | 'moodle_herunterladen';
export const LESE_WERKZEUGE: DorfWerkzeug[] = ['vault_lesen', 'vault_liste', 'vault_suchen'];
/** Nur Aktionen mit rolle: buergermeister bekommen diese Werkzeuge. */
export const BUERGERMEISTER_WERKZEUGE: DorfWerkzeug[] = ['aktionen_liste', 'helfer_starten', 'plan_vorlegen'];
/**
 * Nur Aktionen mit werkzeuge: [rechenraum]. Der Rechenraum hat weder Internet noch Vault – darum ist er auch
 * mit Fremdinhalten erlaubt. Heraus kommt nur, was rechenraum_ablegen in den vom Code bestimmten Ordner legt.
 */
export const RECHENRAUM_WERKZEUGE: DorfWerkzeug[] = [
  'rechenraum_befehl',
  'rechenraum_schreiben',
  'rechenraum_vault_kopieren',
  'rechenraum_seite_ansehen',
  'rechenraum_ablegen',
];
/**
 * Nur Aktionen mit werkzeuge: [post]. Lesen nur von Mails aus dem Posteingang (dem Dorf bekannt),
 * Entwurf nur als Antwort auf genau so eine Mail – kein frei wählbarer Empfänger, Senden gibt es nicht.
 */
export const POST_WERKZEUGE: DorfWerkzeug[] = ['post_lesen', 'post_entwurf'];
/**
 * Nur Aktionen mit werkzeuge: [moodle] UND fremdinhalte: ja. Der Browser-Container liest nur (Leine dort: nur
 * JKU-Domains, kein Formular-Senden, keine sesskey-Aktionen) – Moodle-Inhalte sind Fremdinhalt. Herunterladen
 * landet nur in einem vom Code bestimmten Ordner unter Uni/.
 */
export const MOODLE_WERKZEUGE: DorfWerkzeug[] = ['moodle_oeffnen', 'moodle_klicken', 'moodle_seite', 'moodle_zurueck', 'moodle_bild', 'moodle_herunterladen'];
/** Höchstens so viele Helfer pro Plan */
export const MAX_HELFER_PRO_PLAN = 10;
/** So viele Helfer darf der Bürgermeister pro Aufgabe ohne Plan starten (Leifs Vorgabe: ab 2 Helfern nur mit Plan) */
export const MAX_HELFER_OHNE_PLAN = 1;

export interface Werkzeugprofil {
  dorf: DorfWerkzeug[];
  web: boolean;
}

/** Fehler in der Kombination von Aktionseinstellungen (wird an der Aktion angezeigt, die Aktion startet dann nicht). */
export function aktionPruefen(a: { werkzeuge: AktionsWerkzeug[]; fremdinhalte: boolean }): string | null {
  if (a.fremdinhalte && a.werkzeuge.includes('web'))
    return 'Web-Werkzeuge und Fremdinhalte schließen sich aus (Stadtordnung, Abschnitt 5): Sonst könnte ein präparierter Inhalt Daten über eine Web-Adresse nach außen schicken.';
  if (a.werkzeuge.includes('moodle') && !a.fremdinhalte) return 'Moodle-Werkzeuge nur mit „fremdinhalte: ja“ – Moodle-Seiten stammen von außen.';
  if (a.werkzeuge.includes('moodle') && a.werkzeuge.includes('web')) return 'Moodle-Werkzeuge und Web-Werkzeuge schließen sich aus.';
  return null;
}

export function werkzeugprofil(a: { werkzeuge: AktionsWerkzeug[]; fremdinhalte: boolean }): Werkzeugprofil {
  const fehler = aktionPruefen(a);
  if (fehler) throw new DorfFehler(400, fehler);
  const dorf: DorfWerkzeug[] = [...LESE_WERKZEUGE, 'freigabe_beantragen'];
  if (a.werkzeuge.includes('vault_schreiben')) dorf.push('vault_schreiben');
  if (a.werkzeuge.includes('rechenraum')) dorf.push(...RECHENRAUM_WERKZEUGE);
  if (a.werkzeuge.includes('post')) dorf.push(...POST_WERKZEUGE);
  if (a.werkzeuge.includes('moodle')) dorf.push(...MOODLE_WERKZEUGE);
  return { dorf, web: a.werkzeuge.includes('web') && !a.fremdinhalte };
}

/** Namensschema für Dateien, die Agenten anlegen: JJJJ-MM-TT_HHMM_kurztitel.endung */
export const AGENTEN_DATEINAME = /^\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9]+(?:-[a-z0-9]+)*\.(md|txt|csv|json|html)$/;

/** Bereiche eines Gebäudes, die nur das Dorf selbst (bzw. Leif) schreibt – nie ein Agent. */
const GESCHUETZT_IM_GEBAEUDE = ['gebaeude.md', 'aktionen', 'protokolle', 'chats'];

export interface SchreibPruefung {
  gebaeude: string;
  pfad: string;
  existiert: boolean;
  /** true, wenn genau dieser Chat die Datei früher selbst angelegt hat */
  vonDiesemChat: boolean;
}

/** Gibt null zurück, wenn das Schreiben erlaubt ist, sonst den Grund (wird dem Agenten als Fehler zurückgegeben). */
export function schreibenPruefen(p: SchreibPruefung): string | null {
  let rel: string;
  try {
    rel = normalisieren(p.pfad);
  } catch (e) {
    return (e as Error).message;
  }
  if (!rel) return 'Pfad fehlt.';
  const teile = rel.split('/');
  const name = teile[teile.length - 1]!;
  if (teile[0] === '00_Stadtordnung') return 'In 00_Stadtordnung schreibt kein Agent.';
  const imGebaeude = teile[0] === p.gebaeude && teile.length >= 2;
  const aufSchreibtisch = rel.startsWith('Rathaus/schreibtisch/') && teile.length === 3;
  if (!imGebaeude && !aufSchreibtisch)
    return `Schreiben ist nur im eigenen Gebäude (${p.gebaeude}/…) und auf dem Schreibtisch des Bürgermeisters (Rathaus/schreibtisch/) erlaubt.`;
  if (imGebaeude && GESCHUETZT_IM_GEBAEUDE.includes(teile[1]!))
    return `${p.gebaeude}/${teile[1]} wird nur vom Dorf bzw. von Leif geschrieben (Arbeitsanweisung, Aktionen, Protokolle, Chats).`;
  if (!AGENTEN_DATEINAME.test(name))
    return `Dateiname „${name}“ passt nicht zum Schema JJJJ-MM-TT_HHMM_kurztitel.md (nur Kleinbuchstaben, Ziffern, Bindestriche).`;
  if (path.posix.extname(name) === '') return 'Dateiendung fehlt.';
  if (p.existiert && !p.vonDiesemChat)
    return 'Diese Datei gibt es schon und sie stammt nicht aus diesem Chat. Lege eine neue Fassung an (anderer Name) oder beantrage das Überschreiben mit freigabe_beantragen (art: datei_ueberschreiben).';
  return null;
}

/** Packt fremde Inhalte so ein, dass sie als Daten erkennbar sind und die Hülle nicht vorzeitig schließen können. */
export function fremdinhaltHuelle(quelle: string, inhalt: string) {
  const sicher = inhalt.replace(/<\/?fremdinhalt/gi, (m) => m.replace('<', '‹'));
  const q = quelle.replace(/["<>]/g, '');
  return `<fremdinhalt quelle="${q}">\n${sicher}\n</fremdinhalt>`;
}
