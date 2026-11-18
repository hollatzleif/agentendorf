import { icsTermine, type IcsTermin } from './uni/ical.js';
import type { KalenderQuelle } from './uni/abgleich.js';

/**
 * Leifs Hauptkalender (geheime iCal-Adresse) – wird nur gelesen, wenn er gebraucht wird (Morgenzeitung, Aufwachen),
 * und NICHT gespeichert: Dort stehen auch private Termine. Zwischenspeicher 10 Minuten im Arbeitsspeicher.
 */
export class Terminkalender {
  private zwischen?: { bis: number; text: string };
  /** E75: ist Google Calendar verbunden, liest das Dorf (Morgenzeitung, Corps, Agenten) dort – sonst die iCal-Adresse */
  google?: (von: number, bis: number) => Promise<IcsTermin[] | null>;

  constructor(
    private quelle: KalenderQuelle | undefined,
    private jetzt: () => number,
  ) {}

  get eingerichtet() {
    return !!this.quelle || !!this.google;
  }

  async termine(von: number, bis: number): Promise<IcsTermin[]> {
    if (this.google) {
      const g = await this.google(von, bis).catch(() => null);
      if (g) return g;
    }
    return this.nurIcal(von, bis);
  }

  /** nur die geheime iCal-Adresse (Rückfall, wenn Google nicht geht) */
  async nurIcal(von: number, bis: number): Promise<IcsTermin[]> {
    if (!this.quelle) return [];
    if (!this.zwischen || this.zwischen.bis < this.jetzt()) this.zwischen = { bis: this.jetzt() + 10 * 60_000, text: await this.quelle.laden() };
    return icsTermine(this.zwischen.text, von, bis);
  }
}
