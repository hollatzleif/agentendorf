import path from 'node:path';
import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().default(3000),
  INTERN_PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATEN_DIR: z.string().default('./daten'),
  VAULT_DIR: z.string().default('./daten/vault'),
  VORLAGE_DIR: z.string().default(path.resolve(import.meta.dirname, '../../../vault-vorlage')),
  WEB_DIR: z.string().default(path.resolve(import.meta.dirname, '../../web/dist')),
  /** Öffentliche Adresse, z. B. https://dorf.example.de – wird für die Herkunftsprüfung genutzt. Mehrere mit Komma. */
  ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),
  COOKIE_SICHER: z
    .string()
    .default('true')
    .transform((w) => w !== 'false'),
  HINTER_PROXY: z
    .string()
    .default('false')
    .transform((w) => w === 'true'),
  DORF_VERSION: z.string().default('entwicklung'),
  LOG_LEVEL: z.string().default('info'),
  ANTHROPIC_API_KEY: z.string().optional(),
  WERKSTATT_URL: z.string().default('http://werkstatt:4000'),
  WERKSTATT_GEHEIMNIS: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_API_URL: z.string().default('https://api.telegram.org'),
  RECHENRAUM_URL: z.string().default('http://rechenraum:4100'),
  RECHENRAUM_GEHEIMNIS: z.string().optional(),
  MOODLE_URL: z.string().optional(),
  MOODLE_TOKEN: z.string().optional(),
  MOODLE_KALENDER_URL: z.string().optional(),
  GOOGLE_FRISTEN_ICS: z.string().optional(),
  GOOGLE_PFLICHT_ICS: z.string().optional(),
  DORF_MOTOR_ATTRAPPE: z
    .string()
    .default('false')
    .transform((w) => w === '1' || w === 'true'),
});

export interface Konfig {
  port: number;
  internPort: number;
  host: string;
  datenDir: string;
  vaultDir: string;
  vorlageDir: string;
  webDir: string;
  origins: string[];
  cookieSicher: boolean;
  hinterProxy: boolean;
  version: string;
  logLevel: string;
  motorAttrappe: boolean;
  anthropicApiKey?: string;
  werkstattUrl: string;
  werkstattGeheimnis?: string;
  telegramToken?: string;
  telegramChatId?: string;
  telegramApiUrl: string;
  moodleUrl?: string;
  moodleToken?: string;
  moodleKalenderUrl?: string;
  googleFristenIcs?: string;
  googlePflichtIcs?: string;
  rechenraumUrl: string;
  rechenraumGeheimnis?: string;
}

export function konfigLaden(env: NodeJS.ProcessEnv = process.env): Konfig {
  const e = Schema.parse(env);
  return {
    port: e.PORT,
    internPort: e.INTERN_PORT,
    host: e.HOST,
    datenDir: path.resolve(e.DATEN_DIR),
    vaultDir: path.resolve(e.VAULT_DIR),
    vorlageDir: path.resolve(e.VORLAGE_DIR),
    webDir: path.resolve(e.WEB_DIR),
    origins: e.ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
    cookieSicher: e.COOKIE_SICHER,
    hinterProxy: e.HINTER_PROXY,
    version: e.DORF_VERSION,
    logLevel: e.LOG_LEVEL,
    motorAttrappe: e.DORF_MOTOR_ATTRAPPE,
    anthropicApiKey: e.ANTHROPIC_API_KEY || undefined,
    werkstattUrl: e.WERKSTATT_URL,
    werkstattGeheimnis: e.WERKSTATT_GEHEIMNIS || undefined,
    telegramToken: e.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: e.TELEGRAM_CHAT_ID || undefined,
    telegramApiUrl: e.TELEGRAM_API_URL,
    moodleUrl: e.MOODLE_URL?.replace(/\/$/, '') || undefined,
    moodleToken: e.MOODLE_TOKEN || undefined,
    moodleKalenderUrl: e.MOODLE_KALENDER_URL || undefined,
    googleFristenIcs: e.GOOGLE_FRISTEN_ICS || undefined,
    googlePflichtIcs: e.GOOGLE_PFLICHT_ICS || undefined,
    rechenraumUrl: e.RECHENRAUM_URL,
    rechenraumGeheimnis: e.RECHENRAUM_GEHEIMNIS || undefined,
  };
}
