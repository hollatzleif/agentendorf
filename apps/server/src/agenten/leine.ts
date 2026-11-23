import path from 'node:path';
import type { AktionsWerkzeug } from '@dorf/shared';
import { normalisieren } from '../vault/pfade.js';
import { DorfFehler } from '../fehler.js';
import { EXTRA_ALLTAG, EXTRA_NETZ, EXTRA_POST, EXTRA_RECHENRAUM, type ExtraWerkzeug } from './leine-extra.js';

/**
 * Die Leine: EINE Stelle im Code, die festlegt, was Agenten dürfen – für beide Motoren.
 * Grundsatz (E185): Lesen überall (Vault, Post, Moodle, Kalender, Web – auch zusammen, Leifs Entscheidung), Schreiben nur
 * dorthin, wo Leif es vor einer Außenwirkung sieht (eigenes Gebäude, Entwurf, To-do, Notiz, eigener Kalender – mit
 * „Rückgängig“). Senden, Abgeben, Zahlen gibt es nicht. Freigaben nur noch für echte Außenwirkung und die Regeln selbst.
 */

/** Werkzeuge, die ein Agent überhaupt bekommen kann (Namen wie im Modell sichtbar). */
export type DorfWerkzeug =
  | 'vault_lesen'
  | 'vault_liste'
  | 'vault_suchen'
  | 'vault_schreiben'
  | 'vault_aendern'
  | 'vault_verschieben'
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
  | 'post_suchen'
  | 'post_entwurf'
  | 'post_entwurf_aendern'
  | 'moodle_oeffnen'
  | 'moodle_klicken'
  | 'moodle_seite'
  | 'moodle_zurueck'
  | 'moodle_bild'
  | 'moodle_herunterladen'
  | 'kalender_lesen'
  | 'aktion_anlegen'
  | 'gedaechtnis_schreiben'
  | 'persoenlichkeit_vorschlagen'
  | 'todo_liste'
  | 'noten_lesen'
  | 'depot_lesen'
  | 'depot_bewegungen'
  | 'noten_eintragen'
  | 'noten_entfernen'
  | 'todo_anlegen'
  | 'todo_bearbeiten'
  | 'todo_loeschen'
  | 'kirchturm_lesen'
  | 'kirchturm_timer'
  | 'kirchturm_wecker'
  | 'pomodoro'
  | 'pomodoro_einstellen'
  | 'notiz_anlegen'
  | 'termin_anlegen'
  | 'termin_aendern'
  | 'termin_loeschen'
  | 'freie_zeiten'
  | 'kontakt_suchen'
  | 'kontakt_merken'
  | 'rueckfrage'
  | 'post_entwurf_neu'
  | 'meine_todos_lesen'
  | 'meine_todos_anlegen'
  | 'meine_todos_erledigen'
  // E199: Werkzeuge aus der Ideen-Liste (Gruppen und Einstufung in leine-extra.ts)
  | ExtraWerkzeug
  | 'bild_bearbeiten'; // E198
export const LESE_WERKZEUGE: DorfWerkzeug[] = ['vault_lesen', 'vault_liste', 'vault_suchen'];
/**
 * Nur Aktionen mit werkzeuge: [post]: Mails aus dem Posteingang (dem Dorf bekannt) suchen und lesen, Entwürfe anlegen
 * und eigene Entwürfe ändern. Senden gibt es nicht – Leif schickt selbst ab.
 */
export const POST_WERKZEUGE: DorfWerkzeug[] = ['post_suchen', 'post_lesen', 'post_entwurf', 'post_entwurf_neu', 'post_entwurf_aendern', ...EXTRA_POST];
/** Nur Aktionen mit werkzeuge: [kalender]: Hauptkalender + Uni-Kalender lesen (Titel sind Fremdinhalt). */
export const KALENDER_WERKZEUGE: DorfWerkzeug[] = ['kalender_lesen'];
/**
 * Nur Aktionen mit rolle: buergermeister. E185: Kurzes erledigt er selbst – darum hat er Post, Kalender, Adressbuch
 * und Web direkt (dienst.ts gibt ihm Web immer). Gedächtnis frei, Persönlichkeit nur per Freigabe (E61).
 */
/**
 * E192: die eigene To-do-Liste des Bürgermeisters (Rathaus/buergermeister-todos/) – nur er, nur über diese Werkzeuge.
 * Kein Helfer und keine Aktion bekommt sie (werkzeugprofil kennt sie nicht); die WerkzeugKiste lehnt sie ohne Rolle ab.
 */
export const MEINE_TODOS_WERKZEUGE: DorfWerkzeug[] = ['meine_todos_lesen', 'meine_todos_anlegen', 'meine_todos_erledigen'];
export const MEINE_TODOS_BEREICH = 'Rathaus/buergermeister-todos';
export const BUERGERMEISTER_WERKZEUGE: DorfWerkzeug[] = [
  'aktionen_liste',
  'helfer_starten',
  'plan_vorlegen',
  'aktion_anlegen',
  'gedaechtnis_schreiben',
  'persoenlichkeit_vorschlagen',
  ...MEINE_TODOS_WERKZEUGE,
  ...POST_WERKZEUGE,
  ...KALENDER_WERKZEUGE,
  // E199: Literatur, Zugverbindungen, Wetter – der Bürgermeister hat Web immer (dienst.ts)
  ...EXTRA_NETZ,
];
/**
 * Nur Aktionen mit werkzeuge: [rechenraum]. Der Rechenraum hat weder Internet noch Vault. Heraus kommt nur, was
 * rechenraum_ablegen in den vom Code bestimmten Ordner legt.
 */
export const RECHENRAUM_WERKZEUGE: DorfWerkzeug[] = [
  'rechenraum_befehl',
  'rechenraum_schreiben',
  'rechenraum_vault_kopieren',
  'rechenraum_seite_ansehen',
  'rechenraum_ablegen',
  // E199: feste Werkzeuge im Rechenraum (dorfwerk.py) – PDF, Diagramm, Daten, QR, Anki
  ...EXTRA_RECHENRAUM,
  'bild_bearbeiten', // E198: Bilder aus dem Vault bearbeiten – gerechnet im Rechenraum, Ergebnis nur im Ablage-Ordner des Chats
];
/**
 * Nur Aktionen mit werkzeuge: [moodle]. Der Browser-Container liest nur (Leine dort: nur JKU-Domains, kein
 * Formular-Senden, keine sesskey-Aktionen). Herunterladen landet nur in einem vom Code bestimmten Ordner unter Uni/.
 */
export const MOODLE_WERKZEUGE: DorfWerkzeug[] = ['moodle_oeffnen', 'moodle_klicken', 'moodle_seite', 'moodle_zurueck', 'moodle_bild', 'moodle_herunterladen'];
/**
 * To-do-Brett (E65, Leifs Wunsch: „für alle Agenten“): jeder Agent darf To-dos lesen, anlegen, bearbeiten/abhaken und
 * löschen – nur über den TodoDienst (nur Marktplatz/todos/), Löschen = Papierkorb (wiederherstellbar).
 */
export const TODO_WERKZEUGE: DorfWerkzeug[] = ['todo_liste', 'todo_anlegen', 'todo_bearbeiten', 'todo_loeschen'];
/**
 * E221: Leifs Notenliste (Uni/noten.md, die Ansicht Uni → Noten) – jeder Agent, nur über den Notendienst (feste Datei,
 * geprüftes Format). Vorher fehlte ein Weg: vault_schreiben verlangt neue Dateinamen mit Datum und nur im eigenen Gebäude.
 * Jede Änderung: alte Fassung ins Archiv, Leif kann sie zurücknehmen (wie vault_aendern).
 */
export const NOTEN_WERKZEUGE: DorfWerkzeug[] = ['noten_lesen', 'noten_eintragen', 'noten_entfernen'];
/**
 * E222: Leifs Saxo-Depot lesen (Stand, Positionen, Bewegungen je Tag) – nur aus dem, was das Dorf ohnehin abruft und
 * speichert; kein eigener Zugriff auf Saxo, nichts Schreibendes (Handeln gibt es im Dorf nicht). Für jeden Agenten,
 * damit Börse-Helfer und Bürgermeister Bewegungen erklären können (mit Web: Schlagzeilen dazu – Leifs Entscheidung E185).
 */
export const DEPOT_WERKZEUGE: DorfWerkzeug[] = ['depot_lesen', 'depot_bewegungen'];
/**
 * Alltag für jeden Agenten (E183, E185): Kirchturm (Timer, Wecker, Pomodoro), Notizen, Termine in Leifs EIGENEM
 * Kalender (direkt, ohne Einladungen, mit „Rückgängig“; Termine mit Gästen nur per Freigabe), freie Zeiten,
 * Adressbuch, Dateien im eigenen Gebäude ändern/verschieben (alte Fassung ins Archiv) und höchstens eine Rückfrage.
 */
export const ALLTAG_WERKZEUGE: DorfWerkzeug[] = [
  'kirchturm_lesen',
  'kirchturm_timer',
  'kirchturm_wecker',
  'pomodoro',
  'pomodoro_einstellen',
  'notiz_anlegen',
  'termin_anlegen',
  'termin_aendern',
  'termin_loeschen',
  'freie_zeiten',
  'kontakt_suchen',
  'kontakt_merken',
  'rueckfrage',
  // E199: rechnen lokal bzw. holen nur die feste EZB-Tabelle – kein Text des Agenten geht hinaus
  ...EXTRA_ALLTAG,
];
/** Dateien im eigenen Gebäude ändern/verschieben – nur für Läufe, die auch schreiben dürfen */
export const VAULT_PFLEGE_WERKZEUGE: DorfWerkzeug[] = ['vault_aendern', 'vault_verschieben'];
/** Höchstens so viele Helfer pro Plan */
export const MAX_HELFER_PRO_PLAN = 10;
/** E185: So viele Helfer darf der Bürgermeister je Aufgabe ohne Plan starten (Schutz vor Ausreißern, keine Freigabe) */
export const MAX_HELFER_JE_AUFGABE = 5;
/** E185: Pläne starten ohne Leifs Klick – außer er wollte einen Plan sehen, oder der Plan ist größer/teurer als das */
export const PLAN_OHNE_FRAGE_MAX_HELFER = 5;
export const PLAN_OHNE_FRAGE_MAX_USD = 2;

/** Was ein freier Helfer zusätzlich bekommen kann (helfer_starten, Plan-Teilaufgaben) */
export const HELFER_FAEHIGKEITEN = ['web', 'post', 'kalender', 'moodle', 'rechenraum'] as const;
export type HelferFaehigkeit = (typeof HELFER_FAEHIGKEITEN)[number];

export interface Werkzeugprofil {
  dorf: DorfWerkzeug[];
  web: boolean;
}

/**
 * Fehler in der Kombination von Aktionseinstellungen. Seit E185 gibt es keine verbotenen Kombinationen mehr: Leif hat
 * entschieden, dass Web auch zusammen mit Post, Moodle, Kalender und Fremdinhalten laufen darf (Risiko bewusst in Kauf
 * genommen, siehe ENTSCHEIDUNGEN.md). Die Funktion bleibt als die eine Stelle für künftige Regeln.
 */
export function aktionPruefen(_a: { werkzeuge: AktionsWerkzeug[]; fremdinhalte: boolean }): string | null {
  return null;
}

/**
 * E191 – Codehaus: Der Motor „coding“ läuft im Coding-Container mit Shell, Internet, GitHub-Zugang und beschreibbarem
 * Vault (Leifs Entscheidung). Diese Leine gilt dort NICHT für das, was claude selbst tut (Bash/Edit/Write) – nur für die
 * Dorf-Werkzeuge. Darum bekommt ihn ausschließlich eine Aktion im Gebäude Codehaus; überall sonst ist er ein Fehler.
 * Über die App und `aktion_anlegen` lässt sich kein coding-Skill anlegen (skills.ts kennt den Motor nicht).
 */
export const CODING_GEBAEUDE = 'Codehaus';
export function motorPruefen(gebaeude: string, motor: string): string | null {
  if (motor === 'coding' && gebaeude !== CODING_GEBAEUDE)
    return `motor: coding gibt es nur im Gebäude ${CODING_GEBAEUDE} (dort hat der Agent Shell und vollen Schreibzugriff). Hier: claude-code oder api.`;
  return null;
}

export function werkzeugprofil(a: { werkzeuge: AktionsWerkzeug[]; fremdinhalte: boolean }): Werkzeugprofil {
  const fehler = aktionPruefen(a);
  if (fehler) throw new DorfFehler(400, fehler);
  const dorf: DorfWerkzeug[] = [...LESE_WERKZEUGE, 'freigabe_beantragen', ...TODO_WERKZEUGE, ...NOTEN_WERKZEUGE, ...DEPOT_WERKZEUGE, ...ALLTAG_WERKZEUGE];
  if (a.werkzeuge.includes('vault_schreiben')) dorf.push('vault_schreiben', ...VAULT_PFLEGE_WERKZEUGE);
  if (a.werkzeuge.includes('rechenraum')) dorf.push(...RECHENRAUM_WERKZEUGE);
  if (a.werkzeuge.includes('post')) dorf.push(...POST_WERKZEUGE);
  if (a.werkzeuge.includes('moodle')) dorf.push(...MOODLE_WERKZEUGE);
  if (a.werkzeuge.includes('kalender')) dorf.push(...KALENDER_WERKZEUGE);
  // E199: Werkzeuge, die frei gewählten Text nach draußen schicken (Suchwörter, Orte), nur mit Web – wie die Websuche
  if (a.werkzeuge.includes('web')) dorf.push(...EXTRA_NETZ);
  return { dorf, web: a.werkzeuge.includes('web') };
}

/** Frühere Werkzeugnamen in gespeicherten Chats (werkzeuge_json) → heutige; Unbekanntes fällt weg. */
const FRUEHERE_NAMEN: Record<string, DorfWerkzeug> = { termin_vorschlagen: 'termin_anlegen', aktion_vorschlagen: 'aktion_anlegen' };
export function werkzeugeAktuell(liste: string[], bekannt: (n: string) => boolean): string[] {
  return [...new Set(liste.map((n) => FRUEHERE_NAMEN[n] ?? n))].filter((n) => n === 'web' || bekannt(n));
}

/** Namensschema für Dateien, die Agenten anlegen: JJJJ-MM-TT_HHMM_kurztitel.endung */
export const AGENTEN_DATEINAME = /^\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9]+(?:-[a-z0-9]+)*\.(md|txt|csv|json|html)$/;

/** Bereiche eines Gebäudes, die nur das Dorf selbst (bzw. Leif) schreibt – nie ein Agent. */
const GESCHUETZT_IM_GEBAEUDE = ['gebaeude.md', 'aktionen', 'protokolle', 'chats', 'archiv'];

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
  if (rel === MEINE_TODOS_BEREICH || rel.startsWith(`${MEINE_TODOS_BEREICH}/`)) return 'Die To-do-Liste des Bürgermeisters führt nur er selbst – über meine_todos_*.';
  const imGebaeude = teile[0] === p.gebaeude && teile.length >= 2;
  const aufSchreibtisch = rel.startsWith('Rathaus/schreibtisch/') && teile.length === 3;
  if (!imGebaeude && !aufSchreibtisch)
    return `Schreiben ist nur im eigenen Gebäude (${p.gebaeude}/…) und auf dem Schreibtisch des Bürgermeisters (Rathaus/schreibtisch/) erlaubt.`;
  if (imGebaeude && GESCHUETZT_IM_GEBAEUDE.includes(teile[1]!))
    return `${p.gebaeude}/${teile[1]} wird nur vom Dorf bzw. von Leif geschrieben (Arbeitsanweisung, Aktionen, Protokolle, Chats, Archiv).`;
  if (!AGENTEN_DATEINAME.test(name))
    return `Dateiname „${name}“ passt nicht zum Schema JJJJ-MM-TT_HHMM_kurztitel.md (nur Kleinbuchstaben, Ziffern, Bindestriche).`;
  if (path.posix.extname(name) === '') return 'Dateiendung fehlt.';
  if (p.existiert && !p.vonDiesemChat)
    return 'Diese Datei gibt es schon und sie stammt nicht aus diesem Chat. Lege eine neue Fassung an (anderer Name) – oder ändere sie mit vault_aendern (alte Fassung kommt ins Archiv).';
  return null;
}

/** Fremd ist alles, was hochgeladen wurde (…/anhaenge/…: Chat-Anhänge, Telegram-Dateien) – egal in welchem Format */
export function istHochgeladen(p: string) {
  return /(^|\/)anhaenge\//.test(p);
}

/** Packt fremde Inhalte so ein, dass sie als Daten erkennbar sind und die Hülle nicht vorzeitig schließen können. */
export function fremdinhaltHuelle(quelle: string, inhalt: string) {
  const sicher = inhalt.replace(/<\/?fremdinhalt/gi, (m) => m.replace('<', '‹'));
  const q = quelle.replace(/["<>]/g, '');
  return `<fremdinhalt quelle="${q}">\n${sicher}\n</fremdinhalt>`;
}

/**
 * vault_aendern / vault_verschieben: nur bestehende bzw. neue Pfade im eigenen Gebäude, nie die geschützten Bereiche.
 * Gibt null zurück, wenn erlaubt, sonst den Grund.
 */
export function pflegePruefen(gebaeude: string, pfad: string): string | null {
  let rel: string;
  try {
    rel = normalisieren(pfad);
  } catch (e) {
    return (e as Error).message;
  }
  const teile = rel.split('/');
  if (teile[0] !== gebaeude || teile.length < 2) return `Ändern und Verschieben geht nur im eigenen Gebäude (${gebaeude}/…).`;
  if (GESCHUETZT_IM_GEBAEUDE.includes(teile[1]!)) return `${gebaeude}/${teile[1]} wird nur vom Dorf bzw. von Leif geschrieben.`;
  if (rel === 'Rathaus/memory.md' || rel === 'Rathaus/personality.md') return 'Gedächtnis und Persönlichkeit haben eigene Werkzeuge.';
  if (rel === MEINE_TODOS_BEREICH || rel.startsWith(`${MEINE_TODOS_BEREICH}/`)) return 'Die To-do-Liste des Bürgermeisters führt nur er selbst – über meine_todos_*.';
  return null;
}
