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
