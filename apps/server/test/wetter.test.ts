import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { wetterArt } from '@dorf/shared';
import { Wetter } from '../src/wetter.js';
import { TestUhr } from '../src/uhr.js';
import { testDorf } from './hilfen.js';

/** Open-Meteo-Antwort, wie sie am 18.11.2026 für Linz kam (gekürzt) */
const antwort = (code = 3, temp = 6.5, tagCode = 80, regen: number | null = 93) => ({
  timezone: 'Europe/Vienna',
  current: { time: '2026-11-16T13:00', interval: 900, temperature_2m: temp, weather_code: code, is_day: 1 },
  daily: { time: ['2026-11-16'], weather_code: [tagCode], temperature_2m_max: [13.8], temperature_2m_min: [5.9], precipitation_probability_max: [regen] },
});

describe('Wetter (Open-Meteo)', () => {
  it('WMO-Codes → Art', () => {
    expect([0, 1, 3, 45, 53, 63, 81, 73, 86, 95].map(wetterArt)).toEqual(['klar', 'heiter', 'bedeckt', 'nebel', 'niesel', 'regen', 'regen', 'schnee', 'schnee', 'gewitter']);
  });

  it('holt höchstens alle 30 min; bei Fehlern bleibt der letzte Stand; ohne Adresse aus', async () => {
    const uhr = new TestUhr();
    let aufrufe = 0;
    let kaputt = false;
    const w = new Wetter({
      uhr,
      laden: async () => {
        aufrufe++;
        if (kaputt) throw new Error('Netz weg');
        return antwort();
      },
    });
    expect(await w.holen()).toEqual({ art: 'bedeckt', temperatur: 6.5, tag: { art: 'regen', min: 6, max: 14, regen: 93 }, stand: '2026-11-16T13:00' });
    await w.holen();
    expect(w.aktuell()?.art).toBe('bedeckt');
    expect(aufrufe).toBe(1);
    uhr.vor(31 * 60_000);
    kaputt = true;
    expect((await w.holen())?.art).toBe('bedeckt'); // alter Stand
    expect(aufrufe).toBe(2);
    // unbrauchbare Antwort: wird nicht übernommen
    uhr.vor(6 * 60_000);
    kaputt = false;
    const w2 = new Wetter({ uhr, laden: async () => ({ irgendwas: 1 }) });
    expect(await w2.holen()).toBeNull();
    expect(new Wetter({ uhr }).aktuell()).toBeUndefined();
    expect(await new Wetter({ uhr }).holen()).toBeNull();
  });

  it('Dorf-Status und Morgenzeitung zeigen das Wetter; Schirm-Hinweis ab 60 % Regen', async () => {
    const d = await testDorf({ wetter: async () => antwort() });
    await d.wetter.holen();
    expect(d.dorfplan.status().wetter).toMatchObject({ art: 'bedeckt', temperatur: 6.5 });
    const c = matter((await d.vault.lesen(await d.morgenzeitung.erstellen())).inhalt).content;
    expect(c).toContain('## Heute\n\n- 🌧️ Wetter in Linz: Regen, 6–14 °C, Regen 93 % – Schirm mitnehmen (jetzt 6,5 °C)');

    const ohne = await testDorf();
    expect(ohne.dorfplan.status().wetter).toBeUndefined();
    const sonnig = await testDorf({ wetter: async () => antwort(0, 18, 1, 10) });
    const c2 = matter((await sonnig.vault.lesen(await sonnig.morgenzeitung.erstellen())).inhalt).content;
    expect(c2).toContain('- 🌤️ Wetter in Linz: heiter, 6–14 °C (jetzt 18 °C)');
  });
});
