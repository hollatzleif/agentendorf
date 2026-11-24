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
  // E195: nur diesen Absendern wird X-Forwarded-For geglaubt (Namen im Docker-Netz oder IP-Adressen, mit Komma getrennt)
  VERTRAUTER_PROXY: z
    .string()
    .default('')
    .transform((w) => w.split(',').map((x) => x.trim()).filter(Boolean)),
  DORF_VERSION: z.string().default('entwicklung'),
  LOG_LEVEL: z.string().default('info'),
  ANTHROPIC_API_KEY: z.string().optional(),
  WERKSTATT_URL: z.string().default('http://werkstatt:4000'),
  WERKSTATT_GEHEIMNIS: z.string().optional(),
  // E191 Codehaus: Runner im Coding-Container (eigenes Geheimnis), öffentliche Adresse von VS Code, dessen Verbindungs-Token
  CODING_URL: z.string().default('http://coding:4000'),
  CODING_GEHEIMNIS: z.string().optional(),
  CODING_ADRESSE: z.string().optional(),
  CODING_VSCODE_TOKEN: z.string().optional(),
  // E205: Verzeichnis der Erweiterungen für VS Code im Codehaus (Open VSX, Eclipse Foundation); andere Adresse nur für Tests
  OPENVSX_URL: z.string().default('https://open-vsx.org'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_API_URL: z.string().default('https://api.telegram.org'),
  RECHENRAUM_URL: z.string().default('http://rechenraum:4100'),
  RECHENRAUM_GEHEIMNIS: z.string().optional(),
  PAKETWERK_URL: z.string().default('http://paketwerk:4100'),
  // E198 Atelier: „Bild generieren“ über Cloudflare Workers AI (optional, Gratiskontingent) – nur in .env (dorf bilder-einrichten)
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_API_URL: z.string().default('https://api.cloudflare.com/client/v4'),
  BROWSER_URL: z.string().default('http://browser:4200'),
  // E227 Hafen: Kryptowerk (eigener Container, Paper Trading) – ohne Geheimnis ist der Hafen aus
  KRYPTO_URL: z.string().default('http://kryptowerk:4300'),
  KRYPTO_GEHEIMNIS: z.string().optional(),
  WETTER_URL: z.string().optional(),
  WETTER_ORT: z.string().default('Konstanz'),
  // Etappe 7: Börse – Kurse von EODHD (Leifs Schlüssel, nur .env), Wechselkurs von der EZB (ohne Schlüssel)
  EODHD_API_KEY: z.string().optional(),
  EODHD_URL: z.string().default('https://eodhd.com/api'),
  EZB_URL: z.string().default('https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  // E73: Saxo OpenAPI (nur lesen) – App-Schlüssel/-Secret nur in .env; Live-Adressen laut developer.saxo
  SAXO_APP_KEY: z.string().optional(),
  SAXO_APP_SECRET: z.string().optional(),
  SAXO_AUTH_URL: z.string().default('https://live.logonvalidation.net'),
  SAXO_API_URL: z.string().default('https://gateway.saxobank.com/openapi'),
  BROWSER_GEHEIMNIS: z.string().optional(),
  MOODLE_URL: z.string().optional(),
  MOODLE_TOKEN: z.string().optional(),
  MOODLE_KALENDER_URL: z.string().optional(),
  GOOGLE_FRISTEN_ICS: z.string().optional(),
  GOOGLE_TERMINE_ICS: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_API_URL: z.string().default('https://gmail.googleapis.com'),
  GOOGLE_CALENDAR_API_URL: z.string().default('https://www.googleapis.com/calendar/v3'),
  GOOGLE_TOKEN_URL: z.string().default('https://oauth2.googleapis.com/token'),
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
  /** E195: wem X-Forwarded-For geglaubt wird (leer + hinterProxy = nur der eigene Rechner) */
  vertrauterProxy: string[];
  version: string;
  logLevel: string;
  motorAttrappe: boolean;
  anthropicApiKey?: string;
  werkstattUrl: string;
  werkstattGeheimnis?: string;
  codingUrl: string;
  codingGeheimnis?: string;
  /** Öffentliche Adresse von VS Code, z. B. https://code.dorf.example.de (ohne Schrägstrich am Ende) */
  codingAdresse?: string;
  codingVscodeToken?: string;
  openvsxUrl: string;
  telegramToken?: string;
  telegramChatId?: string;
  telegramApiUrl: string;
  moodleUrl?: string;
  moodleToken?: string;
  moodleKalenderUrl?: string;
  googleFristenIcs?: string;
  googleTermineIcs?: string;
  gmail?: { clientId: string; clientSecret: string; refreshToken: string };
  gmailApiUrl: string;
  googleTokenUrl: string;
  googleCalendarApiUrl: string;
  googlePflichtIcs?: string;
  /** E198: Zugang zu Cloudflare Workers AI für „Bild generieren“ im Atelier (fehlt → Knopf ausgegraut) */
  cloudflare?: { accountId: string; token: string; url: string };
  rechenraumUrl: string;
  rechenraumGeheimnis?: string;
  /** E230: Paketwerk (gleiches Image wie der Rechenraum, gleiches Geheimnis, mit Internet) */
  paketwerkUrl: string;
  kryptoUrl: string;
  kryptoGeheimnis?: string;
  browserUrl: string;
  wetterUrl?: string;
  wetterOrt: string;
  eodhdSchluessel?: string;
  eodhdUrl: string;
  ezbUrl: string;
  browserGeheimnis?: string;
  saxo?: { appKey: string; appSecret: string; authUrl: string; apiUrl: string };
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
    vertrauterProxy: e.VERTRAUTER_PROXY,
    version: e.DORF_VERSION,
    logLevel: e.LOG_LEVEL,
    motorAttrappe: e.DORF_MOTOR_ATTRAPPE,
    anthropicApiKey: e.ANTHROPIC_API_KEY || undefined,
    werkstattUrl: e.WERKSTATT_URL,
    werkstattGeheimnis: e.WERKSTATT_GEHEIMNIS || undefined,
    codingUrl: e.CODING_URL.replace(/\/$/, ''),
    codingGeheimnis: e.CODING_GEHEIMNIS || undefined,
    codingAdresse: e.CODING_ADRESSE?.trim().replace(/\/$/, '') || undefined,
    codingVscodeToken: e.CODING_VSCODE_TOKEN || undefined,
    openvsxUrl: e.OPENVSX_URL.trim().replace(/\/$/, ''),
    telegramToken: e.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: e.TELEGRAM_CHAT_ID || undefined,
    telegramApiUrl: e.TELEGRAM_API_URL,
    moodleUrl: e.MOODLE_URL?.replace(/\/$/, '') || undefined,
    moodleToken: e.MOODLE_TOKEN || undefined,
    moodleKalenderUrl: e.MOODLE_KALENDER_URL || undefined,
    googleFristenIcs: e.GOOGLE_FRISTEN_ICS || undefined,
    googleTermineIcs: e.GOOGLE_TERMINE_ICS || undefined,
    gmail:
      e.GMAIL_CLIENT_ID && e.GMAIL_CLIENT_SECRET && e.GMAIL_REFRESH_TOKEN
        ? { clientId: e.GMAIL_CLIENT_ID, clientSecret: e.GMAIL_CLIENT_SECRET, refreshToken: e.GMAIL_REFRESH_TOKEN }
        : undefined,
    gmailApiUrl: e.GMAIL_API_URL,
    googleTokenUrl: e.GOOGLE_TOKEN_URL,
    googleCalendarApiUrl: e.GOOGLE_CALENDAR_API_URL.replace(/\/$/, ''),
    googlePflichtIcs: e.GOOGLE_PFLICHT_ICS || undefined,
    cloudflare:
      e.CLOUDFLARE_ACCOUNT_ID && e.CLOUDFLARE_API_TOKEN
        ? { accountId: e.CLOUDFLARE_ACCOUNT_ID, token: e.CLOUDFLARE_API_TOKEN, url: e.CLOUDFLARE_API_URL.replace(/\/$/, '') }
        : undefined,
    rechenraumUrl: e.RECHENRAUM_URL,
    rechenraumGeheimnis: e.RECHENRAUM_GEHEIMNIS || undefined,
    paketwerkUrl: e.PAKETWERK_URL,
    kryptoUrl: e.KRYPTO_URL.replace(/\/$/, ''),
    kryptoGeheimnis: e.KRYPTO_GEHEIMNIS && e.KRYPTO_GEHEIMNIS.length >= 32 ? e.KRYPTO_GEHEIMNIS : undefined,
    browserUrl: e.BROWSER_URL,
    wetterUrl: e.WETTER_URL || undefined,
    wetterOrt: e.WETTER_ORT,
    eodhdSchluessel: e.EODHD_API_KEY || undefined,
    eodhdUrl: e.EODHD_URL.replace(/\/$/, ''),
    ezbUrl: e.EZB_URL,
    browserGeheimnis: e.BROWSER_GEHEIMNIS || undefined,
    saxo:
      e.SAXO_APP_KEY && e.SAXO_APP_SECRET
        ? { appKey: e.SAXO_APP_KEY, appSecret: e.SAXO_APP_SECRET, authUrl: e.SAXO_AUTH_URL.replace(/\/$/, ''), apiUrl: e.SAXO_API_URL.replace(/\/$/, '') }
        : undefined,
  };
}
