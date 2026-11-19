import type { Aufwand, Motor as MotorName } from '@dorf/shared';
import type { WerkzeugKiste } from './werkzeuge.js';

/** Ein Anhang, der dem ersten Auftrag beigelegt wird. */
export interface Anhang {
  pfad: string; // relativ zum Vault
  art: 'text' | 'pdf' | 'bild';
  text?: string; // bei Text: Inhalt (ggf. in Fremdinhalt-Hülle)
  base64?: string; // bei PDF/Bild (api-Motor)
  mime?: string;
  /** E190: Bild aus einer Umwandlung im Rechenraum (liegt nicht als Datei im Vault – claude-code sieht es über vault_lesen) */
  umgewandelt?: boolean;
  titel?: string;
}

/** Bisheriger Verlauf eines Chats, wie ihn der jeweilige Motor braucht. */
export interface Verlauf {
  /** Unveränderte API-Nachrichten früherer api-Läufe (nur api-Motor) */
  apiNachrichten: unknown[];
  /** claude-Sitzung zum Fortsetzen (claude-code- und coding-Motor; gilt nur im Container, in dem sie entstand) */
  ccSitzung?: string;
  /** Lesbarer Verlauf als Text – für den Fall, dass der Motor gewechselt hat */
  textVerlauf?: string;
}

export interface LaufAuftrag {
  laufId: string;
  chatId: string;
  modell: string;
  aufwand: Aufwand;
  system: string;
  /** Neue Nutzernachricht dieses Laufs */
  nachricht: string;
  anhaenge: Anhang[];
  verlauf: Verlauf;
  werkzeuge: WerkzeugKiste;
  web: boolean;
  /** Nur Motor coding (E191): Projektordner unter /arbeit im Codehaus (geprüfter Ordnername) – sonst leer */
  projekt?: string;
  signal: AbortSignal;
  /**
   * E185: Nachrichten, die Leif während des Laufs nachgeschoben hat (werden dabei aus der Warteschlange genommen).
   * Ein Motor, der das kann, gibt sie zwischen zwei Werkzeug-Runden weiter; sonst kommen sie nach dem Lauf dran.
   */
  nachschub?: () => string[];
  /** Textstücke live an die Oberfläche (während das Modell schreibt) */
  liveText: (text: string) => void;
}

export type LaufEreignis =
  | { typ: 'text'; text: string } // Textstück (live)
  | { typ: 'nachricht'; rolle: 'nutzer' | 'agent' | 'werkzeug' | 'hinweis'; text: string; roh?: unknown } // fertige Nachricht
  | { typ: 'verbrauch'; ein: number; aus: number; cacheLesen: number; cacheSchreiben: number; kostenUsd?: number }
  | { typ: 'sitzung'; id: string };

export interface Motor {
  name: MotorName;
  /** Führt einen Lauf aus. Fehler werfen; Abbruch über auftrag.signal. */
  starten(auftrag: LaufAuftrag): AsyncIterable<LaufEreignis>;
}

export class AbbruchFehler extends Error {
  constructor() {
    super('Abgebrochen.');
  }
}
