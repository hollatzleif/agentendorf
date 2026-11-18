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
  | { typ: 'dorf.geaendert'; version: number }
  | { typ: 'todos.geaendert'; liste?: string }
  | { typ: 'bank.geaendert' }
  | { typ: 'boerse.geaendert' }
  | { typ: 'kirchturm.geaendert' }
  | { typ: 'kalender.geaendert' }
  | { typ: 'kirchturm.klingelt'; klingel: KirchturmKlingel }
  | AgentenEreignis;

// ---- E74: Kirchturm (Wecker, Timer, Pomodoro, Stoppuhr) ------------------------------------------

export interface KirchturmWecker {
  id: string;
  name: string;
  /** HH:MM in Ortszeit (Europe/Vienna) */
  zeit: string;
  /** Wochentage 0 = So … 6 = Sa; leer = einmalig */
  tage: number[];
  aktiv: boolean;
  schlummerMin: number;
  /** nächstes Klingeln (ISO) – auch nach Schlummern */
  naechster: string | null;
}

export interface KirchturmTimer {
  id: string;
  name: string;
  dauerMs: number;
  status: 'laeuft' | 'pause' | 'fertig';
  /** läuft: Ende (ISO); Pause: Rest in ms */
  ende: string | null;
  restMs: number | null;
}

export interface PomodoroEinstellungen {
  arbeitMin: number;
  kurzMin: number;
  langMin: number;
  /** nach so vielen Arbeitsrunden kommt die lange Pause */
  langNach: number;
  /** Arbeitsrunden insgesamt (danach Schluss) */
  runden: number;
  /** nächste Phase von selbst starten */
  autoWeiter: boolean;
  /** optional: woran gearbeitet wird (To-do-Titel) */
  thema?: string;
  /** optional: Fach/Gruppe (für die Fokus-Statistik) und das To-do dazu */
  gruppe?: string;
  todoPfad?: string;
  /** Während der Arbeitsphase hält Telegram Meldungen zurück (Standard: an) */
  nichtStoeren?: boolean;
}

export interface FokusStatistik {
  heuteMin: number;
  wocheMin: number;
  /** Arbeitsphasen heute (fertige) */
  heutePomodoros: number;
  /** letzte 7 Tage (Ortszeit), ältester zuerst */
  tage: { tag: string; min: number }[];
  /** Themen bzw. Fächer der letzten 7 Tage, meiste zuerst */
  themen: { thema: string; min: number }[];
  /** Tage in Folge mit mindestens einer fertigen Arbeitsphase (bis heute bzw. gestern) */
  serie: number;
}

export interface KirchturmPomodoro {
  einstellungen: PomodoroEinstellungen;
  phase: 'aus' | 'arbeit' | 'kurz' | 'lang';
  status: 'aus' | 'laeuft' | 'pause' | 'wartet';
  ende: string | null;
  restMs: number | null;
  /** fertige Arbeitsrunden in dieser Sitzung */
  erledigt: number;
}

export interface KirchturmKlingel {
  id: string;
  quelle: 'wecker' | 'timer' | 'pomodoro';
  bezugId: string;
  titel: string;
  text: string;
  /** gelaeut = mehrere Schläge (Wecker), schlag = kurz (Timer, Pomodoro) */
  ton: 'gelaeut' | 'schlag';
  seit: string;
  /** Wecker: Schlummern möglich */
  schlummern: boolean;
}

export interface KirchturmToene {
  /** Glocke auch bei Mitteilungen des Programms (Freigaben, fertige Aufgaben) */
  mitteilungen: boolean;
  /** Wie oft das Geläut beim Wecker wiederholt wird (bis „Aus“) */
  weckerWiederholen: number;
}

export interface KirchturmZustand {
  jetzt: string;
  wecker: KirchturmWecker[];
  timer: KirchturmTimer[];
  vorlagen: { name: string; dauerMs: number }[];
  pomodoro: KirchturmPomodoro;
  stoppuhr: { start: string | null; bisherMs: number; runden: number[] };
  klingelt: KirchturmKlingel[];
  toene: KirchturmToene;
}

/** To-do auf dem Marktplatz (E65): eine Datei in Marktplatz/todos/ */
export interface TodoInfo {
  pfad: string;
  version: string;
  titel: string;
  erledigt: boolean;
  faellig?: string; // JJJJ-MM-TT
  gebaeude?: string;
  /** Gruppe in der Liste (Abteilung im Laden, Amt im Corps …) */
  gruppe?: string;
  /** von einem Agenten mit Fremdinhalten (Mails, Moodle …) angelegt/geändert – Internet-Läufe sehen ihn nicht */
  fremd?: boolean;
  /** ⭐ eines der wichtigsten Dinge (oben auf „Heute“, zuerst beim Tag planen) */
  wichtig?: boolean;
  /** E92: wiederkehrend – täglich, werktags, wöchentlich, monatlich, jährlich, „alle N tage/wochen/monate“ */
  wiederholen?: string;
  quelle?: string; // „Leif“, „Telegram“ oder der Agent/die Aktion
  erstellt?: string;
  erledigtAm?: string;
  notiz?: string;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// ---- Etappe 2a: Agenten ------------------------------------------------------------------------

export type Motor = 'api' | 'claude-code';
export type Stufe = 'klein' | 'mittel' | 'gross';
export type Aufwand = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type LaufStatus = 'wartet_freigabe' | 'wartend' | 'laeuft' | 'fertig' | 'fehler' | 'abgebrochen';
/** klick = Leif; zeitplan = Bürgermeister von selbst (api, Budget); buergermeister = seine Helfer; automatik = Aktion nach eigenem Zeitplan (Motor der Aktion) */
export type Ausloeser = 'klick' | 'zeitplan' | 'buergermeister' | 'automatik';
export type AktionsWerkzeug = 'vault_lesen' | 'vault_suchen' | 'vault_schreiben' | 'web' | 'rechenraum' | 'post' | 'moodle' | 'kalender';

export interface AktionEingabe {
  name: string;
  typ: 'text' | 'langtext' | 'auswahl' | 'datei';
  beschriftung?: string;
  pflicht: boolean;
  optionen?: string[];
  /** Auswahl, die der Server liefert (z. B. Kurse aus Moodle) */
  quelle?: AktionQuelle;
  /** Wert für automatische Läufe (Zeitplan) und Vorbelegung im Formular */
  standard?: string;
}

export type AktionQuelle = 'uni.faecher' | 'uni.abgaben' | 'post.mails';
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
  /** Läuft von selbst, z. B. „täglich 06:00“ */
  zeitplan?: string;
  /** Zeitplan läuft für jeden Wert dieser Eingabe (z. B. „fach“) einmal */
  zeitplanJe?: string;
  /** nächster automatischer Lauf (ISO) */
  naechsterLauf?: string;
  /** Ergebnis-Datei, die bei jedem Lauf ersetzt wird (alte Fassung → archiv/) */
  ablage?: string;
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
  /** true, wenn nicht Leif, sondern die Frist entschieden hat (E62) */
  automatisch?: boolean;
  /** Leifs Begründung beim Ablehnen (E64) */
  grund?: string;
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
  | { typ: 'post.geaendert' }
  | { typ: 'morgenzeitung.geaendert' };

// ---- Etappe 2b: Bürgermeister, Schreibtisch, Pläne ---------------------------------------------

export type SchreibtischStatus = 'neu' | 'in_arbeit' | 'plan_wartet' | 'helfer_laufen' | 'erledigt' | 'beantwortet' | 'abgelehnt' | 'fehler';
export interface SchreibtischAufgabe {
  id: string;
  pfad: string;
  titel: string;
  quelle: 'app' | 'telegram' | 'vault' | 'aufwachen';
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
  /** Ohne Entscheidung wird der Plan zu diesem Zeitpunkt automatisch angenommen (E62); fehlt → nie */
  automatischUm?: string;
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
  morgenzeitung: boolean;
  /** Etappe 7: Budget-Warnungen der Bank */
  bank: boolean;
  /** Nacht 18./19.11.: Tagesabschluss um 21 Uhr (erledigt, Fokus, ⭐ für morgen) */
  abend: boolean;
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

export interface MorgenzeitungInfo {
  datum: string; // JJJJ-MM-TT
  pfad: string;
  inhalt: string; // Markdown
  erstellt: string; // ISO
}
export interface MorgenzeitungUebersicht {
  aktuell: MorgenzeitungInfo | null;
  aeltere: { datum: string; pfad: string }[];
  naechste: string | null;
  laeuft: boolean;
}

export * from './dorf.js';

// ---- Etappe 6: Programme ------------------------------------------------------------------------
export interface ProgrammeInfo {
  vorhanden: boolean;
  version?: string;
  erstellt?: string;
  mac?: { datei: string; url: string };
  windows?: { datei: string; url: string };
}

// ---- Etappe 7: Bank -----------------------------------------------------------------------------
export interface BankBuchung {
  id: string;
  datum: string; // JJJJ-MM-TT
  betrag: number; // negativ = Ausgabe
  waehrung: string;
  gegenseite: string;
  zweck: string;
  kategorie: string;
  vonLeif: boolean;
}
export interface BankAbo {
  gegenseite: string;
  betrag: number;
  rhythmus: 'monatlich' | 'jährlich';
  letzte: string;
  naechste: string;
  anzahl: number;
  kategorie: string;
  proMonat: number;
}
export interface BankSparziel {
  name: string;
  ziel: number;
  gespart: number;
  prozent: number;
  bis?: string;
}
export interface BankDatei {
  datei: string;
  anzahl: number;
  status: 'ok' | 'zuordnung';
  fehler?: string;
  zeit: string;
  /** nur bei status „zuordnung“: Kopfzeile und Beispielzeilen zum Zuordnen */
  spalten?: { kennung: string; kopf: string[]; beispiel: string[][] };
}
export interface BankMonat {
  monat: string;
  monate: string[];
  einnahmen: number;
  ausgaben: number;
  saldo: number;
  kategorien: { kategorie: string; betrag: number; budget?: number }[];
  buchungen: BankBuchung[];
  abos: BankAbo[];
  sparziele: BankSparziel[];
  dateien: BankDatei[];
  kategorienListe: string[];
  fehler?: string;
}

// ---- Etappe 7: Corpshaus ------------------------------------------------------------------------
export interface CorpsUebersicht {
  termine: { start: string; ende?: string; ganztags: boolean; titel: string }[];
  stichworte: string[];
  absender: string[];
  kalenderEingerichtet: boolean;
  fehler?: string;
}

// ---- Etappe 7: Börse ----------------------------------------------------------------------------
export interface BoerseWert {
  index: number;
  name: string;
  isin?: string;
  symbol?: string;
  stueck?: number;
  einstand?: number; // je Stück, Euro
  kurs?: number; // in der Handelswährung
  waehrung?: string;
  datum?: string; // Tag des Schlusskurses
  veraenderungProzent?: number; // zum Handelstag davor
  wertEur?: number;
  gewinnEur?: number;
  gewinnProzent?: number;
}
/** E73: eine Position aus dem Saxo-Konto (Werte in Kontowährung, wenn Saxo sie liefert) */
export interface SaxoPosition {
  name: string;
  symbol?: string;
  art?: string;
  waehrung?: string;
  stueck?: number;
  einstand?: number;
  kurs?: number;
  verzoegerungMin?: number;
  wert?: number;
  gewinn?: number;
  tagProzent?: number;
}

export interface SaxoUebersicht {
  eingerichtet: boolean;
  verbunden: boolean;
  verbundenSeit?: string;
  stand?: { zeit: string; waehrung: string; gesamt: number | null; bar: number | null; positionen: SaxoPosition[] };
  /** Kontowert je Tag (letzte 12 Monate) */
  verlauf: { datum: string; wert: number }[];
  /** zeitgewichtete Rendite als Anteil (0,05 = 5 %) */
  renditeJahr: number | null;
  rendite12Monate: number | null;
  fehler?: string;
}

export interface BoerseUebersicht {
  eingerichtet: boolean;
  positionen: BoerseWert[];
  watchlist: BoerseWert[];
  gesamtEur: number;
  einstandEur: number;
  abrufeHeute: number;
  abrufeMax: number;
  letzter?: { zeit: number; abgerufen: number; offen: number; fehler: string | null };
  dollarJeEuro?: { datum: string; kurs: number };
  /** EZB: Einheiten der Währung je Euro (Dollar, Franken) */
  wechselkurse?: { waehrung: string; datum: string; kurs: number }[];
  fehler?: string;
}


// ---- E75: Kalender auf dem Marktplatz (Leifs Google Calendar) -----------------------------------

export interface KalenderInfo {
  id: string;
  name: string;
  farbe: string;
  primaer: boolean;
  /** Leif darf hier Termine anlegen/ändern */
  schreibbar: boolean;
}

export interface KalenderTermin {
  id: string;
  kalenderId: string;
  titel: string;
  /** ganztags: JJJJ-MM-TT; sonst ISO mit Zeit */
  start: string;
  /** ganztags: JJJJ-MM-TT (exklusiv, wie bei Google); sonst ISO */
  ende: string;
  ganztags: boolean;
  ort?: string;
  beschreibung?: string;
  /** Teil einer Serie: ID der Serie */
  serieId?: string;
  /** Serie: RRULE (nur wenn bekannt) */
  wiederholung?: string;
  /** Erinnerungen in Minuten vorher (Popup); null = Standard des Kalenders */
  erinnerungen?: number[] | null;
  farbe?: string;
  link?: string;
  teilnehmer?: number;
  /** quelle uni = Uni-Frist (nur anzeigen); ical = nur lesbar (Google-API nicht verbunden) */
  quelle: 'google' | 'uni' | 'ical';
  schreibbar: boolean;
}

export interface KalenderAntwort {
  /** google = voll (lesen + schreiben), ical = nur lesen über die geheime Adresse, aus = nichts eingerichtet */
  modus: 'google' | 'ical' | 'aus';
  hinweis?: string;
  kalender: KalenderInfo[];
  termine: KalenderTermin[];
}
export * from './termintext.js';

/** Uni: Stand je Fach (Nacht 18./19.11.) */
export interface FachStand {
  name: string;
  titel: string;
  ordner: string;
  moodleUrl: string | null;
  offeneAbgaben: number;
  naechsteFrist: { titel: string; frist: string; art: 'abgabe' | 'test' } | null;
  fokus7Tage: number;
}

/** Karteikarten (Nacht 18./19.11.) */
export interface KartenFach {
  fach: string;
  gesamt: number;
  /** heute dran: fällige Wiederholungen + neue bis zum Tageslimit */
  faellig: number;
  neu: number;
  /** sitzt (Abstand ≥ 21 Tage) */
  gelernt: number;
}
export interface KarteFaellig {
  id: string;
  fach: string;
  frage: string;
  antwort: string;
  neu: boolean;
}

/** Gewohnheiten (Nacht 18./19.11.) */
export interface GewohnheitStand {
  name: string;
  symbol: string;
  tage: 'täglich' | 'werktags' | 'wochenende' | ('so' | 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa')[];
  heuteFaellig: boolean;
  heuteErledigt: boolean;
  serie: number;
  /** letzte 7 Tage, ältester zuerst */
  woche: { tag: string; faellig: boolean; erledigt: boolean }[];
}

/** Wochenziele (E91) */
export interface Wochenziele {
  woche: string;
  pfad: string;
  ziele: { text: string; erledigt: boolean }[];
}
export interface WochenzieleStand extends Wochenziele {
  letzte: { woche: string; ziele: { text: string; erledigt: boolean }[] };
}
