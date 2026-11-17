import { icsTermine, type IcsTermin } from './uni/ical.js';
import type { KalenderQuelle } from './uni/abgleich.js';

/**
 * Leifs Hauptkalender (geheime iCal-Adresse) – wird nur gelesen, wenn er gebraucht wird (Morgenzeitung, Aufwachen),
 * und NICHT gespeichert: Dort stehen auch private Termine. Zwischenspeicher 10 Minuten im Arbeitsspeicher.
 */
export class Terminkalender {
  private zwischen?: { bis: number; text: string };

  constructor(
    private quelle: KalenderQuelle | undefined,
    private jetzt: () => number,
  ) {}

  get eingerichtet() {
    return !!this.quelle;
  }

  async termine(von: number, bis: number): Promise<IcsTermin[]> {
    if (!this.quelle) return [];
    if (!this.zwischen || this.zwischen.bis < this.jetzt()) this.zwischen = { bis: this.jetzt() + 10 * 60_000, text: await this.quelle.laden() };
    return icsTermine(this.zwischen.text, von, bis);
  }
}
