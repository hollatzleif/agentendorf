import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CodingUebersicht } from '@dorf/shared';
import { tokenHash } from './auth/sitzungen.js';
import type { DB } from './db.js';
import { DorfFehler } from './fehler.js';
import type { Konfig } from './konfig.js';
import type { Uhr } from './uhr.js';
import { PROJEKT_MUSTER } from './agenten/motor-claude-code.js';

/**
 * Codehaus (E191): Zugang zu VS Code im Browser und Projektliste.
 *
 * VS Code läuft auf einer EIGENEN Adresse (code.<Dorf-Adresse>, eigener Ursprung): Das Sitzungs-Cookie des Dorfs gilt nur
 * für den Dorf-Host und wird dorthin vom Browser nie geschickt – VS Code, seine Erweiterungen und der Coding-Container
 * bekommen es also nie zu sehen. Der Weg hinein:
 *   1. Dorf (angemeldet): GET /api/coding/oeffnen → Einmal-Karte (60 s, an die Sitzung gebunden) → Weiterleitung
 *   2. code.…/_dorf/eintritt?karte=…  (Caddy reicht NUR diesen Pfad an das Dorf: /api/coding/eintritt) → Karte einlösen,
 *      eigenes Cookie `dorf_coding` für den Code-Host setzen, weiter zu VS Code mit dessen Verbindungs-Token
 *   3. Jede weitere Anfrage an code.… prüft Caddy vorab (forward_auth) über den INTERNEN Port des Dorfs:
 *      GET /intern/coding/zugang → 200 oder 401 (intern.ts; von außen nicht erreichbar, kein WebSocket-Plugin –
 *      auch Upgrade-Anfragen von VS Code werden dort als gewöhnliche Anfrage beantwortet).
 * Das Code-Cookie gilt nur, solange die Dorf-Sitzung besteht (Abmelden / „alle Geräte abmelden“ sperrt auch VS Code).
 */
export const CODING_COOKIE = 'dorf_coding';
/** Ohne Dorf-Sitzung erreichbar – prüft selbst (Einmal-Karte). */
export const CODING_OFFEN = ['/api/coding/eintritt'] as const;
/** Vorab-Prüfung für Caddy – nur auf dem internen Port (intern.ts) */
export const CODING_ZUGANG_PFAD = '/intern/coding/zugang';

const KARTE_MS = 60 * 1000;
export const CODING_ZUGANG_MS = 7 * 24 * 60 * 60 * 1000;

export class CodingZugang {
  /** Einmal-Karten nur im Speicher (60 s): Hash → Sitzung */
  private karten = new Map<string, { sitzung: string; ablauf: number }>();

  constructor(
    private db: DB,
    private uhr: Uhr,
  ) {}

  karteAusstellen(sitzungId: string): string {
    const jetzt = this.uhr.jetzt();
    for (const [k, v] of this.karten) if (v.ablauf <= jetzt) this.karten.delete(k);
    const karte = crypto.randomBytes(32).toString('base64url');
    this.karten.set(tokenHash(karte), { sitzung: sitzungId, ablauf: jetzt + KARTE_MS });
    return karte;
  }

  /** Löst eine Karte genau einmal ein und gibt das Cookie-Token für den Code-Host zurück (nur hier im Klartext). */
  karteEinloesen(karte: string | undefined): string | null {
    if (!karte) return null;
    const h = tokenHash(karte);
    const k = this.karten.get(h);
    this.karten.delete(h);
    const jetzt = this.uhr.jetzt();
    if (!k || k.ablauf <= jetzt || !this.sitzungGueltig(k.sitzung)) return null;
    this.db.prepare('DELETE FROM coding_zugang WHERE ablauf <= ?').run(jetzt);
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO coding_zugang (id, sitzung, erstellt, ablauf) VALUES (?, ?, ?, ?)').run(tokenHash(token), k.sitzung, jetzt, jetzt + CODING_ZUGANG_MS);
    return token;
  }

  /** Gilt das Code-Cookie noch? Nur solange es nicht abgelaufen ist UND die Dorf-Sitzung dahinter besteht. */
  pruefen(token: string | undefined): boolean {
    if (!token || token.length > 200) return false;
    const z = this.db.prepare('SELECT sitzung, ablauf FROM coding_zugang WHERE id = ?').get(tokenHash(token)) as { sitzung: string; ablauf: number } | undefined;
    return !!z && z.ablauf > this.uhr.jetzt() && this.sitzungGueltig(z.sitzung);
  }

  private sitzungGueltig(id: string) {
    const s = this.db.prepare('SELECT ablauf FROM sitzungen WHERE id = ?').get(id) as { ablauf: number } | undefined;
    return !!s && s.ablauf > this.uhr.jetzt();
  }
}

/** Ein Cookie aus dem Cookie-Kopf lesen (forward_auth-Anfragen können ohne das Cookie-Plugin geprüft werden). */
function cookieWert(kopf: string | undefined, name: string): string | undefined {
  for (const teil of (kopf ?? '').split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === name) return teil.slice(i + 1).trim();
  }
  return undefined;
}

export function codingEingerichtet(k: Konfig) {
  return !!(k.codingGeheimnis && k.codingAdresse && k.codingVscodeToken);
}

export function codingRouten(app: FastifyInstance, d: { konfig: Konfig; db: DB; uhr: Uhr; holen?: typeof fetch }) {
  const { konfig } = d;
  const holen = d.holen ?? fetch;
  const zugang = new CodingZugang(d.db, d.uhr);
  const codeHost = () => {
    try {
      return new URL(konfig.codingAdresse ?? '').host;
    } catch {
      return '';
    }
  };
  const nichtMerken = (reply: { header: (n: string, w: string) => unknown }) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  };

  // Übersicht für das Gebäude: Adresse, Projektordner (Namen vom Runner im Coding-Container), was fehlt
  app.get('/api/coding', async (): Promise<CodingUebersicht> => {
    const aus: CodingUebersicht = { eingerichtet: codingEingerichtet(konfig), adresse: konfig.codingAdresse ?? null, erreichbar: false, projekte: [], befehl: 'dorf coding-einrichten' };
    if (!konfig.codingGeheimnis) return aus;
    try {
      const r = await holen(`${konfig.codingUrl}/projekte`, { headers: { 'x-werkstatt-geheimnis': konfig.codingGeheimnis }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`Antwort ${r.status}`);
      const j = z
        .object({ projekte: z.array(z.object({ name: z.string().regex(PROJEKT_MUSTER), git: z.boolean(), geaendert: z.number() })) })
        .parse(await r.json());
      aus.erreichbar = true;
      aus.projekte = j.projekte.map((p) => ({ name: p.name, git: p.git, geaendert: new Date(p.geaendert).toISOString() }));
    } catch (e) {
      aus.fehler = `Der Coding-Container antwortet nicht (${(e as Error).message}). Auf dem Server: dorf status – läuft „coding“?`;
    }
    return aus;
  });

  // 1. Aus dem Dorf (Sitzung nötig – prüft der allgemeine Schutz): Karte ausstellen und zum Code-Host weiterleiten.
  //    GET, damit ein normaler Link/ein Lesezeichen reicht; von einer fremden Seite kommt wegen SameSite=Strict kein Cookie mit.
  app.get('/api/coding/oeffnen', async (req, reply) => {
    if (!codingEingerichtet(konfig)) throw new DorfFehler(503, 'Das Codehaus ist noch nicht eingerichtet. Auf dem Server: dorf coding-einrichten');
    const q = z.object({ projekt: z.string().regex(PROJEKT_MUSTER).optional() }).parse(req.query);
    const ziel = new URL(`${konfig.codingAdresse}/_dorf/eintritt`);
    ziel.searchParams.set('karte', zugang.karteAusstellen(req.sitzung!.id));
    if (q.projekt) ziel.searchParams.set('projekt', q.projekt);
    nichtMerken(reply);
    return reply.redirect(ziel.toString(), 302);
  });

  // 2. Auf dem Code-Host (über Caddy, nur dieser eine Pfad): Karte einlösen, Code-Cookie setzen, weiter zu VS Code.
  app.get('/api/coding/eintritt', async (req, reply) => {
    nichtMerken(reply);
    // Nur über den Code-Host: dort – und nur dort – soll das Cookie landen
    if (!codingEingerichtet(konfig) || req.host !== codeHost()) return reply.status(404).send({ fehler: 'Nicht gefunden.' });
    const q = z.object({ karte: z.string().max(100).optional(), projekt: z.string().regex(PROJEKT_MUSTER).optional() }).safeParse(req.query);
    const token = q.success ? zugang.karteEinloesen(q.data.karte) : null;
    if (!token) return reply.status(401).type('text/plain; charset=utf-8').send('Dieser Link gilt nicht (mehr). Öffne VS Code bitte über das Codehaus im Dorf.');
    reply.setCookie(CODING_COOKIE, token, {
      httpOnly: true,
      secure: konfig.cookieSicher,
      // Lax: der Eintritt ist eine Weiterleitungskette vom Dorf-Host; das Cookie schützt nur den Zugang zu VS Code
      sameSite: 'lax',
      path: '/',
      maxAge: CODING_ZUGANG_MS / 1000,
    });
    // VS Code nimmt sein Verbindungs-Token einmal als ?tkn=, setzt daraus sein eigenes Cookie und entfernt es aus der Adresse
    const ziel = new URLSearchParams({ tkn: konfig.codingVscodeToken! });
    if (q.success && q.data.projekt) ziel.set('folder', `/arbeit/${q.data.projekt}`);
    return reply.redirect(`/?${ziel.toString()}`, 302);
  });

}

/**
 * 3. Vorab-Prüfung für Caddy (forward_auth) – jede Anfrage an den Code-Host, auch WebSockets. Nur 200, 302 oder 401, nie Inhalt.
 * Liest ausschließlich das Code-Cookie; das Sitzungs-Cookie des Dorfs öffnet hier nichts.
 */
export function codingZugangPruefen(d: { konfig: Konfig; db: DB; uhr: Uhr }, kopf: Record<string, string | string[] | undefined>): { status: 200 | 401 } | { status: 302; ziel: string } {
  const eins = (w: string | string[] | undefined) => (Array.isArray(w) ? w[0] : w);
  if (!codingEingerichtet(d.konfig)) return { status: 401 };
  if (new CodingZugang(d.db, d.uhr).pruefen(cookieWert(eins(kopf.cookie), CODING_COOKIE))) return { status: 200 };
  // Seitenaufruf im Browser ohne (gültiges) Cookie: einmal über das Dorf schicken – ist Leif dort angemeldet, kommt er
  // mit frischer Karte zurück (z. B. nach 7 Tagen oder von einem Lesezeichen). Alles andere (Skripte, WebSocket): 401.
  const seite = eins(kopf['sec-fetch-mode']) === 'navigate' && eins(kopf['sec-fetch-dest']) === 'document';
  const dorf = d.konfig.origins[0];
  return seite && dorf ? { status: 302, ziel: `${dorf}/api/coding/oeffnen` } : { status: 401 };
}
