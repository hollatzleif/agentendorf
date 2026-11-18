import crypto from 'node:crypto';

/**
 * Google-Anmeldung für einen Desktop-Client (OAuth 2.0 mit PKCE), ohne Bibliothek.
 * Ablauf wie bei Moodle: Leif öffnet die Adresse, meldet sich an, Google leitet auf eine lokale Adresse um
 * (dort lauscht nichts) – Leif kopiert die Adresse aus der Adresszeile ins Terminal.
 * Mail: nur Lesen und Entwürfe (gmail.readonly + gmail.compose) – Senden wird nie angefragt.
 * E75: Kalender (calendar.events + calendar.calendarlist.readonly) für den Marktplatz-Kalender; schreiben nur per Leifs Klick.
 */
export const GMAIL_BEREICHE = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];
export const KALENDER_BEREICHE = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
export const RUECKLEITUNG = 'http://127.0.0.1:8765/';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function anmeldungVorbereiten(clientId: string) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(18));
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: RUECKLEITUNG,
    response_type: 'code',
    scope: [...GMAIL_BEREICHE, ...KALENDER_BEREICHE].join(' '),
    access_type: 'offline',
    prompt: 'consent', // sonst gibt Google bei erneuter Anmeldung kein Refresh-Token heraus
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return { adresse: u.toString(), verifier, state };
}

/** Holt den Code aus der kopierten Rückleitungs-Adresse und prüft den state (gehört zu genau diesem Vorgang). */
export function codeAusAdresse(adresse: string, state: string): string {
  let u: URL;
  try {
    u = new URL(adresse.trim());
  } catch {
    throw new Error('Das ist keine Adresse. Bitte die vollständige Adresse aus der Adresszeile kopieren (beginnt mit http://127.0.0.1:8765/).');
  }
  if (u.searchParams.get('error')) throw new Error(`Google meldet: ${u.searchParams.get('error')} (Anmeldung abgebrochen oder verweigert).`);
  if (u.searchParams.get('state') !== state) throw new Error('Die Adresse gehört nicht zu diesem Anmeldevorgang (state passt nicht). Bitte neu starten.');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('In der Adresse steht kein code=…');
  return code;
}

export interface TokenAntwort {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenAnfrage(tokenUrl: string, felder: Record<string, string>): Promise<TokenAntwort> {
  const r = await fetch(tokenUrl, { method: 'POST', body: new URLSearchParams(felder), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as TokenAntwort & { error?: string; error_description?: string };
  if (!r.ok || j.error) {
    if (j.error === 'invalid_grant')
      throw new GoogleAnmeldungUngueltig(
        'Die Google-Anmeldung ist abgelaufen oder wurde widerrufen. Neu anmelden: dorf gmail-anmelden (läuft sie alle 7 Tage ab, steht das Google-Projekt noch auf „Testing“).',
      );
    throw new Error(`Google-Anmeldung: ${j.error ?? `HTTP ${r.status}`}${j.error_description ? ` – ${j.error_description}` : ''}`);
  }
  return j;
}

export class GoogleAnmeldungUngueltig extends Error {}

export async function codeTauschen(o: { clientId: string; clientSecret: string; code: string; verifier: string; tokenUrl?: string }) {
  const t = await tokenAnfrage(o.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
    grant_type: 'authorization_code',
    client_id: o.clientId,
    client_secret: o.clientSecret,
    code: o.code,
    code_verifier: o.verifier,
    redirect_uri: RUECKLEITUNG,
  });
  if (!t.refresh_token) throw new Error('Google hat kein Refresh-Token geliefert. Bitte unter myaccount.google.com → Sicherheit → Drittanbieter-Zugriff „Agentendorf“ entfernen und neu anmelden.');
  return { refreshToken: t.refresh_token, bereiche: (t.scope ?? '').split(' ').filter(Boolean), accessToken: t.access_token };
}

/** Kurzlebige Zugangs-Tokens aus dem Refresh-Token (zwischengespeichert bis kurz vor Ablauf). */
export class GoogleZugang {
  private token?: { wert: string; bis: number };
  constructor(
    private o: { clientId: string; clientSecret: string; refreshToken: string; tokenUrl?: string },
    private jetzt: () => number = Date.now,
  ) {}

  async accessToken() {
    if (this.token && this.token.bis > this.jetzt()) return this.token.wert;
    const t = await tokenAnfrage(this.o.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      refresh_token: this.o.refreshToken,
    });
    this.token = { wert: t.access_token, bis: this.jetzt() + Math.max(0, t.expires_in - 60) * 1000 };
    return t.access_token;
  }

  vergessen() {
    this.token = undefined;
  }
}
