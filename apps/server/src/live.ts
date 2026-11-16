import type { LiveEreignis } from '@dorf/shared';

interface Verbindung {
  sitzungId: string;
  senden(text: string): void;
  schliessen(): void;
}

/** Verteilt Ereignisse an alle verbundenen Geräte. */
export class LiveHub {
  private verbindungen = new Set<Verbindung>();
  private ausstehend = new Map<string, LiveEreignis>();
  private timer: NodeJS.Timeout | null = null;

  anmelden(v: Verbindung) {
    this.verbindungen.add(v);
    return () => this.verbindungen.delete(v);
  }

  get anzahl() {
    return this.verbindungen.size;
  }

  /** Sendet sofort. */
  senden(e: LiveEreignis) {
    const text = JSON.stringify(e);
    for (const v of this.verbindungen) {
      try {
        v.senden(text);
      } catch {
        /* Verbindung wird beim close aufgeräumt */
      }
    }
  }

  /** Bündelt gleiche Ereignisse über 150 ms (z. B. viele Dateiänderungen beim Sync). */
  gebuendelt(e: LiveEreignis) {
    const schluessel = e.typ === 'vault.geaendert' ? `${e.typ}:${e.pfad}` : e.typ;
    this.ausstehend.set(schluessel, e);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        const liste = [...this.ausstehend.values()];
        this.ausstehend.clear();
        for (const x of liste) this.senden(x);
      }, 150);
    }
  }

  /** Beendet alle Verbindungen der genannten Sitzungen (nach Widerruf). */
  sitzungenTrennen(ids: string[]) {
    const set = new Set(ids);
    for (const v of this.verbindungen) {
      if (set.has(v.sitzungId)) {
        try {
          v.senden(JSON.stringify({ typ: 'sitzung.beendet' } satisfies LiveEreignis));
          v.schliessen();
        } catch {
          /* egal */
        }
        this.verbindungen.delete(v);
      }
    }
  }
}
