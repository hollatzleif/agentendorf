import { describe, expect, it } from 'vitest';
import { base32Dekodieren, base32Kodieren, hotp, totpPruefen, zaehlerFuer } from '../src/auth/totp.js';

// RFC 6238, Anhang B: Schlüssel "12345678901234567890" (SHA-1)
const GEHEIM = base32Kodieren(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('Base32 hin und zurück', () => {
    expect(GEHEIM).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Dekodieren(GEHEIM).toString()).toBe('12345678901234567890');
  });

  it('entspricht den RFC-Testvektoren (letzte 6 Stellen)', () => {
    expect(hotp(GEHEIM, zaehlerFuer(59_000))).toBe('287082');
    expect(hotp(GEHEIM, zaehlerFuer(1111111109_000))).toBe('081804');
    expect(hotp(GEHEIM, zaehlerFuer(2000000000_000))).toBe('279037');
  });

  it('akzeptiert ±1 Zeitschritt und lehnt Wiederverwendung ab', () => {
    const t = 1111111109_000;
    const code = hotp(GEHEIM, zaehlerFuer(t));
    const z = totpPruefen(GEHEIM, code, t + 30_000, null);
    expect(z).toBe(zaehlerFuer(t));
    expect(totpPruefen(GEHEIM, code, t, z)).toBeNull(); // gleicher Code nochmal
    expect(totpPruefen(GEHEIM, code, t + 90_000, null)).toBeNull(); // zu alt
    expect(totpPruefen(GEHEIM, 'abcdef', t, null)).toBeNull();
  });
});
