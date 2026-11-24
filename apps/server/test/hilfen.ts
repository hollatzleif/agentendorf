import type { BoerseKlient } from '../src/boerse.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { konfigLaden } from '../src/konfig.js';
import { dorfStarten } from '../src/dorf.js';
import { TestUhr } from '../src/uhr.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import type { Motoren } from '../src/agenten/motoren.js';
import type { WerkzeugRegister } from '../src/agenten/register.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import type { MoodleKlient } from '../src/uni/moodle.js';
import type { KalenderQuelle } from '../src/uni/abgleich.js';
import type { GmailKlient } from '../src/post/gmail.js';
import type { ModellKlient } from '../src/agenten/motor-api.js';
import type { MoodleBrowserKlient } from '../src/agenten/moodle-browser.js';

export const ORIGIN = 'https://dorf.test';

// Jeder Testlauf legte ~1000 Ordner (≈ 3 GB) unter /tmp an und räumte sie nie weg – die Platte lief voll (E204).
// Darum merken und beim Ende des Test-Prozesses löschen (dann läuft nichts mehr, das darin schreibt).
const angelegt: string[] = [];
process.once('exit', () => {
  for (const d of angelegt) fs.rmSync(d, { recursive: true, force: true });
});

export function tempOrdner(praefix = 'dorf-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  angelegt.push(d);
  return d;
}

export async function testDorf(
  opt: {
    beobachten?: boolean;
    motoren?: Motoren | ((r: WerkzeugRegister) => Motoren);
    env?: Record<string, string>;
    telegram?: TelegramSchnittstelle;
    moodle?: MoodleKlient;
    kalender?: KalenderQuelle;
    google?: { fristen?: KalenderQuelle; pflicht?: KalenderQuelle; termine?: KalenderQuelle };
    gmail?: GmailKlient;
    ki?: () => ModellKlient;
    moodleBrowser?: MoodleBrowserKlient;
    wetter?: () => Promise<unknown>;
    boerse?: BoerseKlient;
    boerseFx?: (waehrung: 'USD' | 'CHF') => Promise<{ datum: string; kurs: number }>;
    saxoHolen?: typeof fetch;
    kalenderKlient?: import('../src/kalender-google.js').KalenderKlient;
    hafenHolen?: typeof fetch;
  } = {},
) {
  const daten = tempOrdner();
  const konfig = konfigLaden({
    DATEN_DIR: daten,
    VAULT_DIR: path.join(daten, 'vault'),
    ORIGIN,
    LOG_LEVEL: 'silent',
    WEB_DIR: path.join(daten, 'kein-web'),
    ...opt.env,
  });
  const uhr = new TestUhr();
  const d = await dorfStarten(konfig, {
    uhr,
    beobachten: opt.beobachten ?? false,
    motoren: opt.motoren ?? { api: attrappe('api'), 'claude-code': attrappe('claude-code'), coding: attrappe('coding') },
    telegram: opt.telegram,
    moodle: opt.moodle,
    kalender: opt.kalender,
    google: opt.google,
    gmail: opt.gmail,
    ki: opt.ki,
    moodleBrowser: opt.moodleBrowser,
    wetter: opt.wetter,
    boerse: opt.boerse,
    saxoHolen: opt.saxoHolen,
    kalenderKlient: opt.kalenderKlient,
    hafenHolen: opt.hafenHolen,
    // nie echtes Netz in Tests
    boerseFx: opt.boerseFx ?? (async (w) => ({ datum: '2026-11-13', kurs: w === 'CHF' ? 0.94 : 1.1 })),
  });
  return { ...d, uhr, konfig, daten };
}

export function cookieAus(setCookie: string | string[] | undefined) {
  const s = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return s?.split(';')[0] ?? '';
}
