import { z } from 'zod';
import { wetterArt, type DorfWetter } from '@dorf/shared';
import type { Uhr } from './uhr.js';

/**
 * Wetter in Linz von Open-Meteo (frei, ohne Schlüssel, ohne Konto). Es geht nur die feste Ortsangabe aus WETTER_URL
 * hinaus – keine Daten über Leif. Geholt wird nur bei Bedarf (Dorf-Ansicht, Morgenzeitung) und höchstens alle 30 Minuten.
 * Ohne WETTER_URL ist das Wetter aus (Tests, Entwicklung).
 */
const Antwort = z.object({
  current: z.object({ time: z.string(), temperature_2m: z.number(), weather_code: z.number() }),
  daily: z.object({
    weather_code: z.array(z.number()).min(1),
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
  }),
});

const FRISCH = 30 * 60_000;
const NACH_FEHLER = 5 * 60_000;

export class Wetter {
  private stand: { bis: number; wetter: DorfWetter | null } = { bis: 0, wetter: null };
  private laufend?: Promise<DorfWetter | null>;

  constructor(
    private o: {
      url?: string;
      uhr: Uhr;
      log?: (t: string) => void;
      /** Für Tests: Antwort ohne Netz */
      laden?: () => Promise<unknown>;
    },
  ) {}

  get eingeschaltet() {
    return !!(this.o.url || this.o.laden);
  }

  /** Für die Dorf-Ansicht (synchron): letzter bekannter Stand; ist er alt, wird im Hintergrund neu geholt. */
  aktuell(): DorfWetter | undefined {
    if (this.eingeschaltet && this.stand.bis <= this.o.uhr.jetzt()) void this.holen();
    return this.stand.wetter ?? undefined;
  }

  /** Für die Morgenzeitung: wartet auf frische Werte (oder den letzten Stand, wenn Open-Meteo nicht antwortet). */
  async holen(): Promise<DorfWetter | null> {
    if (!this.eingeschaltet) return null;
    if (this.stand.bis > this.o.uhr.jetzt()) return this.stand.wetter;
    this.laufend ??= this.abrufen().finally(() => (this.laufend = undefined));
    return this.laufend;
  }

  private async abrufen(): Promise<DorfWetter | null> {
    try {
      const roh = this.o.laden ? await this.o.laden() : await this.netz();
      const a = Antwort.parse(roh);
      const regen = a.daily.precipitation_probability_max?.[0];
      const wetter: DorfWetter = {
        art: wetterArt(a.current.weather_code),
        temperatur: Math.round(a.current.temperature_2m * 10) / 10,
        tag: {
          art: wetterArt(a.daily.weather_code[0]!),
          min: Math.round(a.daily.temperature_2m_min[0]!),
          max: Math.round(a.daily.temperature_2m_max[0]!),
          regen: regen == null ? null : Math.round(regen),
        },
        stand: a.current.time,
      };
      this.stand = { bis: this.o.uhr.jetzt() + FRISCH, wetter };
      return wetter;
    } catch (e) {
      this.o.log?.(`Wetter: ${(e as Error).message.slice(0, 200)}`);
      this.stand = { bis: this.o.uhr.jetzt() + NACH_FEHLER, wetter: this.stand.wetter };
      return this.stand.wetter;
    }
  }

  private async netz() {
    const r = await fetch(this.o.url!, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Open-Meteo antwortet ${r.status}`);
    return r.json();
  }
}
