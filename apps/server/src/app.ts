import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES, type Ich, type SitzungInfo } from '@dorf/shared';
import type { Konfig } from './konfig.js';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import { DorfFehler } from './fehler.js';
import { Drossel } from './auth/drossel.js';
import { Sitzungen, SITZUNG_DAUER_MS, type Sitzung } from './auth/sitzungen.js';
import { nutzerLaden, passwortSetzen, passwortVergleichen } from './auth/passwort.js';
import { geheimnisErzeugen, otpauthUri, totpPruefen } from './auth/totp.js';
import { VaultDienst } from './vault/dienst.js';
import { gebaeudeListe } from './vault/gebaeude.js';
import { Suchindex } from './vault/suche.js';
import { LiveHub } from './live.js';
import type { AgentenDienst } from './agenten/dienst.js';
import { agentenRouten } from './agenten/routen.js';
import type { Schreibtisch } from './schreibtisch.js';
import type { Buergermeister } from './agenten/buergermeister.js';
import type { TelegramBot } from './telegram/bot.js';
import type { Uni } from './uni/abgleich.js';
import { einstellungenLaden, einstellungenSetzen } from './telegram/einstellungen.js';

export const COOKIE = 'dorf_sitzung';
const OFFEN = new Set(['/api/gesundheit', '/api/anmeldung', '/api/anmeldung/info']);

declare module 'fastify' {
  interface FastifyRequest {
    sitzung?: Sitzung;
  }
}

export interface Abhaengigkeiten {
  konfig: Konfig;
  db: DB;
  uhr: Uhr;
  vault: VaultDienst;
  suche: Suchindex;
  hub: LiveHub;
  agenten: AgentenDienst;
  schreibtisch: Schreibtisch;
  buergermeister: Buergermeister;
  telegram?: TelegramBot;
  uni: Uni;
}

const MIME: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

export async function appBauen(a: Abhaengigkeiten): Promise<FastifyInstance> {
  const { konfig, db, uhr, vault, suche, hub } = a;
  const app = Fastify({
    trustProxy: konfig.hinterProxy,
    bodyLimit: 10 * 1024 * 1024,
    logger:
      konfig.logLevel === 'silent'
        ? false
        : { level: konfig.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
  });
  const sitzungen = new Sitzungen(db, uhr);
  const drossel = new Drossel(db, uhr);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DorfFehler) return reply.status(err.status).send({ fehler: err.message, ...err.extra });
    if (err instanceof z.ZodError) return reply.status(400).send({ fehler: 'Ungültige Eingabe.', details: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ fehler: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ fehler: 'Interner Fehler.' });
  });

  // ---- Schutz: Herkunftsprüfung (CSRF) und Anmeldung -----------------------------------------
  const herkunftOk = (req: FastifyRequest) => {
    let o = req.headers.origin;
    if (!o && req.headers.referer) {
      try {
        o = new URL(req.headers.referer).origin;
      } catch {
        o = undefined;
      }
    }
    return !!o && konfig.origins.includes(o.replace(/\/$/, ''));
  };

  app.addHook('onRequest', async (req, reply) => {
    const istWs = req.headers.upgrade?.toLowerCase() === 'websocket';
    if ((!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || istWs) && !herkunftOk(req)) {
      return reply.status(403).send({ fehler: 'Anfrage von fremder Herkunft abgelehnt.' });
    }
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/') || OFFEN.has(url)) return;
    const s = sitzungen.pruefen(req.cookies[COOKIE], req.ip);
    if (!s) return reply.status(401).send({ fehler: 'Nicht angemeldet.' });
    req.sitzung = s;
  });

  const cookieSetzen = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: konfig.cookieSicher,
      sameSite: 'strict',
      path: '/',
      maxAge: SITZUNG_DAUER_MS / 1000,
    });

  // ---- System ---------------------------------------------------------------------------------
  app.get('/api/gesundheit', async () => {
    db.prepare('SELECT 1').get();
    fs.accessSync(vault.wurzel, fs.constants.W_OK);
    return { ok: true, version: konfig.version, verbindungen: hub.anzahl };
  });

  // ---- Anmeldung ------------------------------------------------------------------------------
  app.get('/api/anmeldung/info', async () => {
    const n = nutzerLaden(db);
    return { passwortGesetzt: !!n, totpAktiv: !!n?.totp_aktiv };
  });

  app.post('/api/anmeldung', async (req, reply) => {
    const body = z.object({ passwort: z.string().max(1024), code: z.string().max(20).optional() }).parse(req.body);
    const n = nutzerLaden(db);
    if (!n) throw new DorfFehler(503, 'Noch kein Passwort gesetzt. Auf dem Server: ./dorf passwort');
    const d = drossel.pruefen(req.ip);
    if (!d.erlaubt) {
      reply.header('Retry-After', String(d.warteSek));
      throw new DorfFehler(429, `Zu viele Fehlversuche. Bitte ${d.warteSek} Sekunden warten.`, { warteSek: d.warteSek });
    }
    let ok = await passwortVergleichen(n.passwort_hash, body.passwort);
    if (ok && n.totp_aktiv && n.totp_geheimnis) {
      const z2 = totpPruefen(n.totp_geheimnis, body.code ?? '', uhr.jetzt(), n.totp_letzter_zaehler);
      if (z2 === null) ok = false;
      else db.prepare('UPDATE nutzer SET totp_letzter_zaehler = ? WHERE id = 1').run(z2);
    }
    drossel.merken(req.ip, ok);
    if (!ok) throw new DorfFehler(401, n.totp_aktiv ? 'Passwort oder Code falsch.' : 'Passwort falsch.');
    const { token } = sitzungen.anlegen(String(req.headers['user-agent'] ?? ''), req.ip);
    cookieSetzen(reply, token);
    return { ok: true };
  });

  app.post('/api/abmeldung', async (req, reply) => {
    if (req.sitzung) {
      sitzungen.beenden(req.sitzung.id);
      hub.sitzungenTrennen([req.sitzung.id]);
    }
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/ich', async (): Promise<Ich> => ({ angemeldet: true, totpAktiv: !!nutzerLaden(db)?.totp_aktiv, version: konfig.version }));

  app.get('/api/sitzungen', async (req): Promise<SitzungInfo[]> =>
    sitzungen.liste().map((s) => ({
      id: s.id,
      geraet: s.geraet,
      ip: s.ip,
      erstellt: new Date(s.erstellt).toISOString(),
      zuletzt: new Date(s.zuletzt).toISOString(),
      aktuell: s.id === req.sitzung?.id,
    })),
  );

  app.delete('/api/sitzungen/:id', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.params);
    if (!sitzungen.beenden(id)) throw new DorfFehler(404, 'Sitzung nicht gefunden.');
    hub.sitzungenTrennen([id]);
    return { ok: true };
  });

  app.post('/api/sitzungen/andere-beenden', async (req) => {
    const ids = sitzungen.alleAusserBeenden(req.sitzung!.id);
    hub.sitzungenTrennen(ids);
    return { beendet: ids.length };
  });

  app.post('/api/passwort', async (req) => {
    const body = z.object({ alt: z.string(), neu: z.string().max(1024) }).parse(req.body);
    const n = nutzerLaden(db)!;
    if (!(await passwortVergleichen(n.passwort_hash, body.alt))) throw new DorfFehler(401, 'Altes Passwort falsch.');
    await passwortSetzen(db, uhr, body.neu);
    const ids = sitzungen.alleAusserBeenden(req.sitzung!.id);
    hub.sitzungenTrennen(ids);
    return { ok: true, andereBeendet: ids.length };
  });

  // ---- Zweiter Faktor (TOTP) ------------------------------------------------------------------
  app.post('/api/totp/einrichten', async (req) => {
    const { passwort } = z.object({ passwort: z.string() }).parse(req.body);
    const n = nutzerLaden(db)!;
    if (!(await passwortVergleichen(n.passwort_hash, passwort))) throw new DorfFehler(401, 'Passwort falsch.');
    if (n.totp_aktiv) throw new DorfFehler(409, 'Zweiter Faktor ist schon aktiv.');
    const geheimnis = geheimnisErzeugen();
    db.prepare('UPDATE nutzer SET totp_geheimnis = ?, totp_aktiv = 0, totp_letzter_zaehler = NULL WHERE id = 1').run(geheimnis);
    return { geheimnis, uri: otpauthUri(geheimnis) };
  });

  app.post('/api/totp/bestaetigen', async (req) => {
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const n = nutzerLaden(db)!;
    if (!n.totp_geheimnis || n.totp_aktiv) throw new DorfFehler(409, 'Keine Einrichtung offen.');
    const z2 = totpPruefen(n.totp_geheimnis, code, uhr.jetzt(), null);
    if (z2 === null) throw new DorfFehler(400, 'Code passt nicht. Uhrzeit am Handy prüfen und neu versuchen.');
    db.prepare('UPDATE nutzer SET totp_aktiv = 1, totp_letzter_zaehler = ? WHERE id = 1').run(z2);
    return { ok: true };
  });

  app.post('/api/totp/abschalten', async (req) => {
    const body = z.object({ passwort: z.string(), code: z.string() }).parse(req.body);
    const n = nutzerLaden(db)!;
    const pwOk = await passwortVergleichen(n.passwort_hash, body.passwort);
    const codeOk = n.totp_geheimnis ? totpPruefen(n.totp_geheimnis, body.code, uhr.jetzt(), n.totp_letzter_zaehler) !== null : false;
    if (!pwOk || !codeOk) throw new DorfFehler(401, 'Passwort oder Code falsch.');
    db.prepare('UPDATE nutzer SET totp_geheimnis = NULL, totp_aktiv = 0, totp_letzter_zaehler = NULL WHERE id = 1').run();
    return { ok: true };
  });

  // ---- Vault / Bibliothek ---------------------------------------------------------------------
  const PfadQ = z.object({ pfad: z.string().default('') });

  app.get('/api/vault/baum', async (req) => {
    const { pfad } = PfadQ.parse(req.query);
    return vault.baum(pfad);
  });

  app.get('/api/vault/datei', async (req) => {
    const { pfad } = PfadQ.parse(req.query);
    return vault.lesen(pfad);
  });

  app.get('/api/vault/roh', async (req, reply) => {
    const q = z.object({ pfad: z.string(), download: z.string().optional() }).parse(req.query);
    const r = vault.rohOeffnen(q.pfad);
    const ext = path.posix.extname(r.rel).toLowerCase();
    const name = path.posix.basename(r.rel);
    const anzeigbar = ext in MIME && ext !== '.svg';
    reply
      .header('Content-Type', anzeigbar || ext === '.svg' ? MIME[ext]! : 'application/octet-stream')
      .header('Content-Length', String(r.groesse))
      .header('X-Content-Type-Options', 'nosniff')
      // Vault-Inhalte können aus fremden Quellen stammen: niemals als aktive Seite ausführen.
      .header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .header('Cache-Control', 'private, no-cache')
      .header(
        'Content-Disposition',
        `${q.download || !anzeigbar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
    return reply.send(r.strom);
  });

  app.put('/api/vault/datei', async (req) => {
    const b = z
      .object({ pfad: z.string(), inhalt: z.string(), basisVersion: z.string().optional(), neu: z.boolean().optional() })
      .parse(req.body);
    return vault.schreiben(b.pfad, b.inhalt, { basisVersion: b.basisVersion, nurNeu: b.neu });
  });

  app.post('/api/vault/ordner', async (req) => {
    const { pfad } = z.object({ pfad: z.string() }).parse(req.body);
    return { pfad: await vault.ordnerAnlegen(pfad) };
  });

  app.post('/api/vault/verschieben', async (req) => {
    const b = z.object({ von: z.string(), nach: z.string() }).parse(req.body);
    return { pfad: await vault.verschieben(b.von, b.nach) };
  });

  app.delete('/api/vault/eintrag', async (req) => {
    const { pfad } = z.object({ pfad: z.string() }).parse(req.query);
    return { papierkorb: await vault.loeschen(pfad) };
  });

  app.post('/api/vault/hochladen', async (req) => {
    const { ordner } = z.object({ ordner: z.string().default('') }).parse(req.query);
    const gespeichert: string[] = [];
    for await (const teil of req.files()) {
      gespeichert.push(await vault.hochladen(ordner, teil.filename, teil.file));
    }
    if (!gespeichert.length) throw new DorfFehler(400, 'Keine Datei empfangen.');
    return { gespeichert };
  });

  app.get('/api/vault/suche', async (req) => {
    const { q } = z.object({ q: z.string().max(200) }).parse(req.query);
    return suche.suchen(q);
  });

  app.get('/api/vault/konflikte', async () => vault.konflikte());

  app.get('/api/gebaeude', async () => gebaeudeListe(vault));

  // ---- Agenten (Etappe 2a) ------------------------------------------------------------------
  agentenRouten(app, { agenten: a.agenten, vault, uhr, db, hub, schreibtisch: a.schreibtisch, buergermeister: a.buergermeister });

  // ---- Telegram (Etappe 2b) -----------------------------------------------------------------
  app.get('/api/telegram/status', async () => {
    const e = await einstellungenLaden(vault);
    if (a.telegram) return a.telegram.status(e);
    return { tokenGesetzt: !!konfig.telegramToken, chatGekoppelt: !!konfig.telegramChatId, laeuft: false, einstellungen: e };
  });
  app.put('/api/telegram/einstellungen', async (req) => {
    const b = z.object({ freigaben: z.boolean(), entwuerfe: z.boolean(), fehler: z.boolean(), beendet: z.boolean(), mails: z.boolean(), moodle: z.boolean().default(true) }).parse(req.body);
    return einstellungenSetzen(vault, b);
  });
  app.post('/api/telegram/test', async () => {
    if (!a.telegram) throw new DorfFehler(409, 'Telegram ist nicht eingerichtet. Auf dem Server: dorf telegram-einrichten');
    await a.telegram.senden('👋 Testnachricht aus dem Agentendorf – die Verbindung steht.');
    return { ok: true };
  });

  // ---- Uni (Etappe 3) ------------------------------------------------------------------------
  app.get('/api/uni', async () => a.uni.uebersicht());
  app.post('/api/uni/abgleichen', async () => {
    if (!a.uni.verbunden) throw new DorfFehler(409, 'Moodle ist nicht verbunden. Auf dem Server: dorf moodle-anmelden');
    if (a.uni.laeuft) return { gestartet: false };
    void a.uni.abgleichen();
    return { gestartet: true };
  });

  // ---- Live-Verbindung ------------------------------------------------------------------------
  app.get('/api/live', { websocket: true }, (socket, req) => {
    const abmelden = hub.anmelden({
      sitzungId: req.sitzung!.id,
      senden: (t) => socket.send(t),
      schliessen: () => socket.close(4001, 'Sitzung beendet'),
    });
    socket.send(JSON.stringify({ typ: 'hallo', version: konfig.version }));
    socket.on('close', () => abmelden());
    socket.on('message', () => {
      /* Clients senden derzeit nichts außer Ping */
    });
  });

  // ---- Oberfläche (statisch, SPA) -------------------------------------------------------------
  if (fs.existsSync(path.join(konfig.webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: konfig.webDir,
      wildcard: false,
      setHeaders: (res, p) => {
        if (p.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !fs.existsSync(path.join(konfig.webDir, 'index.html'))) {
      return reply.status(404).send({ fehler: 'Nicht gefunden.' });
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
