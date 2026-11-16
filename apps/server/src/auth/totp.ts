import crypto from 'node:crypto';

// TOTP nach RFC 6238 (SHA-1, 30 s, 6 Stellen) – kompatibel mit allen gängigen Authenticator-Apps.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SCHRITT_S = 30;

export function base32Kodieren(buf: Buffer): string {
  let bits = 0;
  let wert = 0;
  let aus = '';
  for (const byte of buf) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += ALPHABET[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += ALPHABET[(wert << (5 - bits)) & 31];
  return aus;
}

export function base32Dekodieren(s: string): Buffer {
  const sauber = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let wert = 0;
  const bytes: number[] = [];
  for (const z of sauber) {
    const i = ALPHABET.indexOf(z);
    if (i < 0) throw new Error('Ungültiges Base32');
    wert = (wert << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function geheimnisErzeugen(): string {
  return base32Kodieren(crypto.randomBytes(20));
}

export function hotp(geheimnis: string, zaehler: number): string {
  const key = base32Dekodieren(geheimnis);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(zaehler));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

export function zaehlerFuer(ms: number) {
  return Math.floor(ms / 1000 / SCHRITT_S);
}

/**
 * Prüft einen Code (±1 Zeitschritt Toleranz). Gibt den benutzten Zähler zurück oder null.
 * Ein Zähler, der nicht größer als `letzterZaehler` ist, wird abgelehnt (kein Wiederverwenden).
 */
export function totpPruefen(geheimnis: string, code: string, ms: number, letzterZaehler: number | null): number | null {
  const sauber = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(sauber)) return null;
  const z = zaehlerFuer(ms);
  for (const d of [0, -1, 1]) {
    const kandidat = z + d;
    if (letzterZaehler !== null && kandidat <= letzterZaehler) continue;
    const erwartet = hotp(geheimnis, kandidat);
    if (crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(sauber))) return kandidat;
  }
  return null;
}

export function otpauthUri(geheimnis: string, konto = 'Leif', aussteller = 'Agentendorf') {
  const label = encodeURIComponent(`${aussteller}:${konto}`);
  return `otpauth://totp/${label}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=6&period=${SCHRITT_S}`;
}
