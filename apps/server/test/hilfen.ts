import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { konfigLaden } from '../src/konfig.js';
import { dorfStarten } from '../src/dorf.js';
import { TestUhr } from '../src/uhr.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import type { Motor } from '../src/agenten/motor.js';
import type { WerkzeugRegister } from '../src/agenten/register.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import type { MoodleKlient } from '../src/uni/moodle.js';
import type { KalenderQuelle } from '../src/uni/abgleich.js';

export const ORIGIN = 'https://dorf.test';

export function tempOrdner(praefix = 'dorf-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), praefix));
}

export async function testDorf(
  opt: {
    beobachten?: boolean;
    motoren?: Record<'api' | 'claude-code', Motor> | ((r: WerkzeugRegister) => Record<'api' | 'claude-code', Motor>);
    env?: Record<string, string>;
    telegram?: TelegramSchnittstelle;
    moodle?: MoodleKlient;
    kalender?: KalenderQuelle;
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
    motoren: opt.motoren ?? { api: attrappe('api'), 'claude-code': attrappe('claude-code') },
    telegram: opt.telegram,
    moodle: opt.moodle,
    kalender: opt.kalender,
  });
  return { ...d, uhr, konfig, daten };
}

export function cookieAus(setCookie: string | string[] | undefined) {
  const s = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return s?.split(';')[0] ?? '';
}
