import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/**
 * Schema-Migrationen. Nur anhängen, nie bestehende ändern.
 * Der Stand steht in PRAGMA user_version.
 */
const MIGRATIONEN: string[] = [
  `
  CREATE TABLE nutzer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    passwort_hash TEXT NOT NULL,
    totp_geheimnis TEXT,
    totp_aktiv INTEGER NOT NULL DEFAULT 0,
    totp_letzter_zaehler INTEGER,
    geaendert INTEGER NOT NULL
  );
  CREATE TABLE sitzungen (
    id TEXT PRIMARY KEY,            -- sha256 des Cookie-Werts, nie der Wert selbst
    erstellt INTEGER NOT NULL,
    zuletzt INTEGER NOT NULL,
    ablauf INTEGER NOT NULL,
    geraet TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE login_versuche (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    zeit INTEGER NOT NULL,
    erfolg INTEGER NOT NULL
  );
  CREATE INDEX login_versuche_ip_zeit ON login_versuche (ip, zeit);
  CREATE INDEX login_versuche_zeit ON login_versuche (zeit);
  CREATE VIRTUAL TABLE suche USING fts5 (pfad UNINDEXED, titel, inhalt, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE suche_stand (
    pfad TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    groesse INTEGER NOT NULL
  );
  `,
  // 2 – Etappe 2a: Agenten-Kern
  `
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    gebaeude TEXT NOT NULL,
    aktion TEXT,
    titel TEXT NOT NULL,
    motor TEXT NOT NULL,
    stufe TEXT NOT NULL,
    modell TEXT NOT NULL,
    cc_sitzung TEXT,
    eingaben_json TEXT NOT NULL DEFAULT '{}',
    anhaenge_json TEXT NOT NULL DEFAULT '[]',   -- Anhang-Muster des ersten Laufs
    werkzeuge_json TEXT NOT NULL DEFAULT '[]',
    fremdinhalte INTEGER NOT NULL DEFAULT 0,
    spiegel_pfad TEXT,
    spiegel_version TEXT,
    protokoll_pfad TEXT,
    erstellt INTEGER NOT NULL,
    geaendert INTEGER NOT NULL
  );
  CREATE INDEX chats_gebaeude ON chats (gebaeude, geaendert);
  CREATE TABLE nachrichten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
    lauf_id TEXT,
    rolle TEXT NOT NULL,              -- nutzer | agent | werkzeug | hinweis
    text TEXT NOT NULL DEFAULT '',
    roh_json TEXT,                    -- unveränderter API-Inhalt (für den Verlauf des api-Motors)
    motor TEXT,
    erstellt INTEGER NOT NULL
  );
  CREATE INDEX nachrichten_chat ON nachrichten (chat_id, id);
  CREATE TABLE laeufe (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
    nummer INTEGER NOT NULL,
    motor TEXT NOT NULL,
    modell TEXT NOT NULL,
    stufe TEXT NOT NULL,
    aufwand TEXT NOT NULL,
    status TEXT NOT NULL,             -- wartet_freigabe | wartend | laeuft | fertig | fehler | abgebrochen
    ausloeser TEXT NOT NULL,          -- klick | zeitplan | buergermeister
    auftrag TEXT NOT NULL,
    erstellt INTEGER NOT NULL,
    start INTEGER,
    ende INTEGER,
    ein_token INTEGER NOT NULL DEFAULT 0,
    aus_token INTEGER NOT NULL DEFAULT 0,
    cache_lesen INTEGER NOT NULL DEFAULT 0,
    cache_schreiben INTEGER NOT NULL DEFAULT 0,
    kosten_usd REAL NOT NULL DEFAULT 0,
    fehler TEXT,
    zusammenfassung TEXT
  );
  CREATE INDEX laeufe_status ON laeufe (status, erstellt);
  CREATE INDEX laeufe_chat ON laeufe (chat_id, nummer);
  CREATE TABLE werkzeug_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lauf_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    werkzeug TEXT NOT NULL,
    eingabe_json TEXT NOT NULL,
    ergebnis TEXT NOT NULL,
    erlaubt INTEGER NOT NULL,
    pfad TEXT,
    art TEXT,                         -- gelesen | geschrieben | web | freigabe
    zeit INTEGER NOT NULL
  );
  CREATE INDEX werkzeug_log_lauf ON werkzeug_log (lauf_id);
  CREATE INDEX werkzeug_log_chat_pfad ON werkzeug_log (chat_id, pfad);
  CREATE TABLE freigaben (
    id TEXT PRIMARY KEY,
    lauf_id TEXT,
    chat_id TEXT,
    gebaeude TEXT NOT NULL,
    art TEXT NOT NULL,
    titel TEXT NOT NULL,
    begruendung TEXT NOT NULL DEFAULT '',
    inhalt_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offen', -- offen | abgelehnt | angenommen | ausgefuehrt | fehlgeschlagen
    erstellt INTEGER NOT NULL,
    entschieden INTEGER,
    ergebnis TEXT,
    vault_pfad TEXT
  );
  CREATE INDEX freigaben_status ON freigaben (status, erstellt);
  `,
  // 3 – Etappe 2b: Bürgermeister, Schreibtisch, Pläne, Telegram
  `
  CREATE TABLE schreibtisch (
    id TEXT PRIMARY KEY,
    pfad TEXT NOT NULL UNIQUE,
    titel TEXT NOT NULL,
    quelle TEXT NOT NULL,              -- app | telegram | vault
    status TEXT NOT NULL,              -- neu | in_arbeit | plan_wartet | helfer_laufen | erledigt | beantwortet | abgelehnt | fehler
    chat_id TEXT,                      -- Chat des Bürgermeisters
    erstellt INTEGER NOT NULL,
    geaendert INTEGER NOT NULL
  );
  CREATE TABLE plaene (
    id TEXT PRIMARY KEY,
    schreibtisch_id TEXT,
    chat_id TEXT NOT NULL,             -- Chat des Bürgermeisters
    inhalt_json TEXT NOT NULL,
    status TEXT NOT NULL,              -- wartet | abgelehnt | laeuft | fertig
    freigabe_id TEXT,
    vault_pfad TEXT,
    erstellt INTEGER NOT NULL,
    geaendert INTEGER NOT NULL
  );
  CREATE TABLE plan_helfer (
    plan_id TEXT NOT NULL,
    nr INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    PRIMARY KEY (plan_id, nr)
  );
  CREATE TABLE telegram_nachrichten (
    freigabe_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL
  );
  ALTER TABLE chats ADD COLUMN rolle TEXT;
  ALTER TABLE chats ADD COLUMN schreibtisch_id TEXT;
  ALTER TABLE chats ADD COLUMN eltern_chat_id TEXT;
  ALTER TABLE chats ADD COLUMN plan_id TEXT;
  `,
  // 4 – Etappe 3: Uni / Moodle
  `
  CREATE TABLE moodle_kurse (
    id INTEGER PRIMARY KEY,           -- Moodle-Kurs-ID
    name TEXT NOT NULL,
    kurzname TEXT NOT NULL DEFAULT '',
    ordner TEXT NOT NULL UNIQUE,      -- Ordnername unter Uni/faecher/
    url TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1, -- im aktuellen Semester
    gesehen INTEGER NOT NULL
  );
  CREATE TABLE moodle_dateien (
    schluessel TEXT PRIMARY KEY,      -- Datei-URL ohne Token bzw. aufgabe:<id>
    kurs_id INTEGER NOT NULL,
    pfad TEXT NOT NULL,
    merkmal TEXT NOT NULL,            -- Zeitstempel+Größe aus Moodle bzw. Hash des erzeugten Texts
    version TEXT NOT NULL,            -- sha256 dessen, was das Dorf zuletzt geschrieben hat
    geladen INTEGER NOT NULL
  );
  CREATE TABLE moodle_fristen (
    id TEXT PRIMARY KEY,              -- assign:<id> | event:<id>
    kurs_id INTEGER,
    kurs TEXT NOT NULL DEFAULT '',
    titel TEXT NOT NULL,
    art TEXT NOT NULL,                -- abgabe | test | termin
    frist INTEGER,                    -- ms, NULL = keine Frist
    url TEXT NOT NULL DEFAULT '',
    pfad TEXT,                        -- Ordner der Abgabe im Vault
    abgegeben INTEGER NOT NULL DEFAULT 0,
    gesehen INTEGER NOT NULL
  );
  CREATE INDEX moodle_fristen_frist ON moodle_fristen (frist);
  CREATE TABLE moodle_abgleiche (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start INTEGER NOT NULL,
    ende INTEGER,
    ok INTEGER,
    fehler TEXT,
    neue_dateien INTEGER NOT NULL DEFAULT 0,
    neue_abgaben INTEGER NOT NULL DEFAULT 0,
    hinweise TEXT NOT NULL DEFAULT ''
  );
  `,
  // 5 – Etappe 3: Erinnerungen an Fristen (Telegram)
  `
  CREATE TABLE moodle_erinnerungen (
    frist_id TEXT NOT NULL,
    stufe TEXT NOT NULL,              -- 3t | 1t | 3h | danach
    frist INTEGER NOT NULL,           -- Frist zum Zeitpunkt der Erinnerung (verschoben → neue Erinnerungen)
    gesendet INTEGER NOT NULL,
    PRIMARY KEY (frist_id, stufe, frist)
  );
  `,
  // 6 – Etappe 3: Termine aus Google-Kalendern (Pflichtvorlesungen haben ein Ende; „läuft gerade“)
  `
  ALTER TABLE moodle_fristen ADD COLUMN ende INTEGER;
  `,
];

export function dbOeffnen(datei: string): DB {
  if (datei !== ':memory:') fs.mkdirSync(path.dirname(datei), { recursive: true });
  const db = new Database(datei);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrieren(db);
  return db;
}

export function migrieren(db: DB) {
  const stand = db.pragma('user_version', { simple: true }) as number;
  for (let i = stand; i < MIGRATIONEN.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONEN[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
