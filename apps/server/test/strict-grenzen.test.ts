import { describe, expect, it } from 'vitest';
import { schemaZaehlen, strictAuswahl, strictTauglich, STRICT_GRENZEN } from '../src/agenten/motor-api.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { BUERGERMEISTER_WERKZEUGE, LESE_WERKZEUGE } from '../src/agenten/leine.js';

/**
 * E180: Die API lehnt eine Anfrage mit 400 ab, wenn die strict-Werkzeuge zusammen zu viele optionale Felder haben
 * („too many optional parameters (39) … limit: 24“ – so ist der Bürgermeister am 19.11.2026 gescheitert).
 */
function summe(namen: Set<string>) {
  let optional = 0;
  let vereinigungen = 0;
  for (const n of namen) {
    const z = schemaZaehlen(WERKZEUG_DEFINITIONEN[n as keyof typeof WERKZEUG_DEFINITIONEN].input_schema);
    optional += z.optional;
    vereinigungen += z.vereinigungen;
  }
  return { optional, vereinigungen, werkzeuge: namen.size };
}

describe('strict-Werkzeuge innerhalb der API-Grenzen (E180)', () => {
  it('zählt optionale Felder rekursiv und Typ-Vereinigungen', () => {
    expect(
      schemaZaehlen({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: ['string', 'null'] }, c: { type: 'array', items: { type: 'object', properties: { x: {}, y: {} }, required: ['x'] } } },
        required: ['a'],
      }),
    ).toEqual({ optional: 3, vereinigungen: 1 });
  });

  it('alle Werkzeuge auf einmal (schlimmster Fall): Grenzen eingehalten, nur strict-taugliche', () => {
    const alle = Object.values(WERKZEUG_DEFINITIONEN);
    const gewaehlt = strictAuswahl(alle);
    const s = summe(gewaehlt);
    expect(s.optional).toBeLessThanOrEqual(STRICT_GRENZEN.optional);
    expect(s.vereinigungen).toBeLessThanOrEqual(STRICT_GRENZEN.vereinigungen);
    expect(s.werkzeuge).toBeLessThanOrEqual(STRICT_GRENZEN.werkzeuge);
    for (const n of gewaehlt) expect(strictTauglich(WERKZEUG_DEFINITIONEN[n as keyof typeof WERKZEUG_DEFINITIONEN].input_schema)).toBe(true);
    // ohne Begrenzung wäre es zu viel gewesen – genau der Fehler vom 19.11.
    const ohne = alle.filter((d) => strictTauglich(d.input_schema)).reduce((n, d) => n + schemaZaehlen(d.input_schema).optional, 0);
    expect(ohne).toBeGreaterThan(STRICT_GRENZEN.optional);
  });

  it('Bürgermeister-Werkzeuge: Grenzen eingehalten, Lese-Werkzeuge bleiben strict', () => {
    const defs = [...new Set([...LESE_WERKZEUGE, ...BUERGERMEISTER_WERKZEUGE])].map((n) => WERKZEUG_DEFINITIONEN[n]);
    const gewaehlt = strictAuswahl(defs);
    const s = summe(gewaehlt);
    expect(s.optional).toBeLessThanOrEqual(STRICT_GRENZEN.optional);
    for (const n of LESE_WERKZEUGE) expect(gewaehlt.has(n)).toBe(true);
  });
});
