// Geteilte Typen zwischen Server und Oberfläche.
// Alles, was über HTTP oder WebSocket geht, ist hier beschrieben.

export type Eintragsart = 'datei' | 'ordner';

export interface VaultEintrag {
  pfad: string; // relativ zum Vault, mit "/" getrennt
  name: string;
  art: Eintragsart;
  groesse?: number;
  geaendert?: string; // ISO-Zeit
  kinder?: VaultEintrag[];
}

export interface VaultDatei {
  pfad: string;
  inhalt: string;
  version: string; // sha256 des Inhalts, für Konfliktschutz
  geaendert: string;
}

export interface SchreibErgebnis {
  pfad: string;
  version: string;
  /** true, wenn die Datei inzwischen woanders geändert wurde und deshalb eine Konfliktkopie angelegt wurde */
  konflikt: boolean;
  konfliktPfad?: string;
}

export type GebaeudeStatus = 'offen' | 'geschlossen';

export interface Gebaeude {
  id: string; // Ordnername
  name: string;
  status: GebaeudeStatus;
  beschreibung: string;
  symbol: string;
  reihenfolge: number;
  aktionen: number;
  fehler?: string;
}

export interface Suchtreffer {
  pfad: string;
  titel: string;
  ausschnitt: string;
}

export interface Konflikt {
  pfad: string;
  original: string;
  quelle: 'syncthing' | 'dorf';
  geaendert: string;
}

export interface SitzungInfo {
  id: string;
  geraet: string;
  ip: string;
  erstellt: string;
  zuletzt: string;
  aktuell: boolean;
}

export interface Ich {
  angemeldet: true;
  totpAktiv: boolean;
  version: string;
}

/** Nachrichten Server → Client über WebSocket */
export type LiveEreignis =
  | { typ: 'hallo'; version: string }
  | { typ: 'vault.geaendert'; pfad: string; art: 'angelegt' | 'geaendert' | 'geloescht' }
  | { typ: 'gebaeude.geaendert' }
  | { typ: 'konflikte.geaendert' }
  | { typ: 'sitzung.beendet' }
  | AgentenEreignis;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// ---- Etappe 2a: Agenten ------------------------------------------------------------------------

export type Motor = 'api' | 'claude-code';
export type Stufe = 'klein' | 'mittel' | 'gross';
export type Aufwand = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type LaufStatus = 'wartet_freigabe' | 'wartend' | 'laeuft' | 'fertig' | 'fehler' | 'abgebrochen';
export type Ausloeser = 'klick' | 'zeitplan' | 'buergermeister';
export type AktionsWerkzeug = 'vault_lesen' | 'vault_suchen' | 'vault_schreiben' | 'web' | 'rechenraum';

export interface AktionEingabe {
  name: string;
  typ: 'text' | 'langtext' | 'auswahl' | 'datei';
  beschriftung?: string;
  pflicht: boolean;
  optionen?: string[];
  /** Auswahl, die der Server liefert (z. B. Kurse aus Moodle) */
  quelle?: AktionQuelle;
}

export type AktionQuelle = 'uni.faecher' | 'uni.abgaben';
export interface QuellenOption {
  wert: string;
  beschriftung: string;
}

export interface AktionInfo {
  id: string; // "<Gebäude>/<datei ohne .md>"
  gebaeude: string;
  pfad: string;
  name: string;
  beschreibung: string;
  motor: Motor;
  stufe: Stufe;
  eingaben: AktionEingabe[];
  werkzeuge: AktionsWerkzeug[];
  fremdinhalte: boolean;
  freigabeVorStart: boolean;
  rolle?: 'buergermeister';
  fehler?: string;
}

export interface LaufInfo {
  id: string;
  chatId: string;
  nummer: number;
  motor: Motor;
  modell: string;
  stufe: Stufe;
  status: LaufStatus;
  ausloeser: Ausloeser;
  auftrag: string;
  erstellt: string;
  start?: string;
  ende?: string;
  einToken: number;
  ausToken: number;
  cacheLesen: number;
  cacheSchreiben: number;
  kostenUsd: number;
  fehler?: string;
}

export interface ChatInfo {
  id: string;
  gebaeude: string;
  aktion?: string;
  titel: string;
  motor: Motor;
  stufe: Stufe;
  modell: string;
  erstellt: string;
  geaendert: string;
  status?: LaufStatus; // Status des letzten Laufs
  spiegelPfad?: string;
  protokollPfad?: string;
  rolle?: string;
  schreibtischId?: string;
  elternChatId?: string;
  planId?: string;
}

export interface ChatNachricht {
  id: number;
  laufId?: string;
  rolle: 'nutzer' | 'agent' | 'werkzeug' | 'hinweis';
  text: string;
  erstellt: string;
}

export interface ChatDetail extends ChatInfo {
  nachrichten: ChatNachricht[];
  laeufe: LaufInfo[];
}

export type FreigabeStatus = 'offen' | 'abgelehnt' | 'angenommen' | 'ausgefuehrt' | 'fehlgeschlagen';
export interface FreigabeInfo {
  id: string;
  laufId?: string;
  chatId?: string;
  gebaeude: string;
  art: string;
  titel: string;
  begruendung: string;
  inhalt: unknown;
  status: FreigabeStatus;
  erstellt: string;
  entschieden?: string;
  ergebnis?: string;
}

export interface VerbrauchZeile {
  zeitraum: string; // z. B. 2026-11-16, 2026-W47, 2026-11
  motor: Motor;
  einToken: number;
  ausToken: number;
  cacheLesen: number;
  cacheSchreiben: number;
  kostenUsd: number;
  laeufe: number;
}
export interface Verbrauch {
  tage: VerbrauchZeile[];
  wochen: VerbrauchZeile[];
  monate: VerbrauchZeile[];
}

export interface StufenKonfig {
  stufen: Record<Stufe, { modell: string; aufwand: Aufwand }>;
  preise: Record<string, { eingabe: number; ausgabe: number }>;
  fehler?: string;
}
export interface MotorenKonfig {
  alleAuf: 'keiner' | Motor;
  parallel: Record<Motor, number>;
  fehler?: string;
}

/** Live-Ereignisse der Agenten (zusätzlich zu LiveEreignis aus Etappe 1) */
export type AgentenEreignis =
  | { typ: 'lauf.status'; laufId: string; chatId: string; status: LaufStatus }
  | { typ: 'lauf.text'; laufId: string; chatId: string; text: string }
  | { typ: 'lauf.werkzeug'; laufId: string; chatId: string; name: string; erlaubt: boolean; kurz: string }
  | { typ: 'chat.geaendert'; chatId: string; gebaeude: string }
  | { typ: 'freigaben.geaendert' }
  | { typ: 'verbrauch.geaendert' }
  | { typ: 'aktionen.geaendert' }
  | { typ: 'konfig.geaendert' }
  | { typ: 'schreibtisch.geaendert' }
  | { typ: 'plaene.geaendert' }
  | { typ: 'uni.geaendert' }
  | { typ: 'post.geaendert' };

// ---- Etappe 2b: Bürgermeister, Schreibtisch, Pläne ---------------------------------------------

export type SchreibtischStatus = 'neu' | 'in_arbeit' | 'plan_wartet' | 'helfer_laufen' | 'erledigt' | 'beantwortet' | 'abgelehnt' | 'fehler';
export interface SchreibtischAufgabe {
  id: string;
  pfad: string;
  titel: string;
  quelle: 'app' | 'telegram' | 'vault';
  status: SchreibtischStatus;
  chatId?: string;
  planId?: string;
  erstellt: string;
}

export interface PlanTeilaufgabe {
  titel: string;
  gebaeude: string;
  aktion?: string;
  eingaben?: Record<string, string>;
  auftrag: string;
  stufe: Stufe;
  motor: Motor;
  modell: string;
  kostenUsd: number; // nur api-Motor, sonst 0
}
export interface PlanInhalt {
  planId: string;
  zusammenfassung: string;
  begruendung: string;
  teilaufgaben: PlanTeilaufgabe[];
  kostenUsd: number;
  hinweis: string;
}
export interface PlanInfo extends PlanInhalt {
  status: 'wartet' | 'abgelehnt' | 'laeuft' | 'fertig';
  chatId: string;
  schreibtischId?: string;
  vaultPfad?: string;
  erstellt: string;
  helfer: { nr: number; chatId: string; titel: string; status?: LaufStatus }[];
}

export interface TelegramStatus {
  tokenGesetzt: boolean;
  chatGekoppelt: boolean;
  laeuft: boolean;
  letzterFehler?: string;
  einstellungen: TelegramEinstellungen;
}
export interface TelegramEinstellungen {
  freigaben: boolean;
  entwuerfe: boolean;
  fehler: boolean;
  beendet: boolean;
  mails: boolean;
  moodle: boolean;
  erinnerungen: boolean;
}

// ---- Etappe 3: Uni -------------------------------------------------------------------------------

export interface UniFrist {
  id: string;
  kursId: number | null;
  kurs: string;
  titel: string;
  art: 'abgabe' | 'test' | 'termin' | 'pflicht';
  frist: string | null; // ISO – Frist bzw. Beginn
  ende: string | null; // ISO – nur bei Terminen mit Dauer (z. B. Pflichtvorlesung)
  url: string;
  pfad: string | null;
  abgegeben: boolean;
}

export interface UniKurs {
  id: number;
  name: string;
  ordner: string; // Vault-Pfad Uni/faecher/<…>
  url: string;
  aktiv: boolean;
}

export interface UniAbgleich {
  start: string;
  ende: string | null;
  ok: boolean | null;
  fehler: string | null;
  neueDateien: number;
  neueFristen: number;
  hinweise: string[];
}

/** Ein Fach = Ordner unter Uni/faecher/ (selbst angelegt oder aus Moodle) */
export interface UniFach {
  name: string; // Ordnername
  titel: string; // Anzeigename (Moodle-Kursname, sonst Ordnername)
  ordner: string; // Uni/faecher/<name>
  moodleUrl: string | null;
}

export interface UniUebersicht {
  /** irgendeine Quelle eingerichtet (Kalender-Export oder App-Zugang) */
  verbunden: boolean;
  kalender: boolean;
  /** Google-Kalender eingerichtet: Fristen (vom Skript gefüllt) bzw. Pflichttermine */
  google: { fristen: boolean; pflicht: boolean };
  appZugang: boolean;
  moodleUrl: string | null;
  laeuft: boolean;
  letzter: UniAbgleich | null;
  naechster: string | null;
  kurse: UniKurs[];
  faecher: UniFach[];
  fristen: UniFrist[];
}

// ---- Etappe 4: Post ----------------------------------------------------------------------------

export interface PostMail {
  id: string;
  threadId: string;
  von: string;
  betreff: string;
  datum: string; // ISO
  kategorie: string | null;
  wichtig: boolean;
  antwortNoetig: boolean;
  zusammenfassung: string | null;
  frist: string | null;
  eingeordnet: boolean;
}

export interface PostUebersicht {
  verbunden: boolean;
  einordnungMoeglich: boolean;
  laeuft: boolean;
  letzter: { zeit: number; ok: boolean; fehler: string | null; neu: number; eingeordnet: number } | null;
  mails: PostMail[];
}
