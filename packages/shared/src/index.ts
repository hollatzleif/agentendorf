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
  | { typ: 'sitzung.beendet' };

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
