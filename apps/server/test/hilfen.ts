import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { konfigLaden } from '../src/konfig.js';
import { dorfStarten } from '../src/dorf.js';
import { TestUhr } from '../src/uhr.js';

export const ORIGIN = 'https://dorf.test';

export function tempOrdner(praefix = 'dorf-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), praefix));
}

export async function testDorf(opt: { beobachten?: boolean } = {}) {
  const daten = tempOrdner();
  const konfig = konfigLaden({
    DATEN_DIR: daten,
    VAULT_DIR: path.join(daten, 'vault'),
    ORIGIN,
    LOG_LEVEL: 'silent',
    WEB_DIR: path.join(daten, 'kein-web'),
  });
  const uhr = new TestUhr();
  const d = await dorfStarten(konfig, { uhr, beobachten: opt.beobachten ?? false });
  return { ...d, uhr, konfig, daten };
}

export function cookieAus(setCookie: string | string[] | undefined) {
  const s = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return s?.split(';')[0] ?? '';
}
