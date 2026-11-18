import type { Boerse } from './boerse.js';
import type { Saxo } from './saxo.js';
import type { Kirchturm } from './kirchturm.js';
import type { FachStand } from '@dorf/shared';
import type { Wochenrueckblick } from './wochenrueckblick.js';
import type { GoogleKalender } from './kalender-google.js';
import type { Corps } from './corps.js';
import type { Bank } from './bank.js';
import { programmeRouten } from './programme.js';
import { LISTEN_NAMEN, type ListenName, type TodoDienst } from './todos.js';
import type { Dorfplan } from './dorfplan.js';
import { normalisieren } from './vault/pfade.js';
import type { Automatik } from './agenten/automatik.js';
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
import { gebaeudeAendern, gebaeudeAnlegen, gebaeudeListe } from './vault/gebaeude.js';
import { Suchindex } from './vault/suche.js';
import { LiveHub } from './live.js';
import type { AgentenDienst } from './agenten/dienst.js';
import { agentenRouten } from './agenten/routen.js';
import type { Schreibtisch } from './schreibtisch.js';
import type { Buergermeister } from './agenten/buergermeister.js';
import type { TelegramBot } from './telegram/bot.js';
import type { Uni } from './uni/abgleich.js';
import type { Postbote } from './post/postbote.js';
import type { Morgenzeitung } from './morgenzeitung.js';
import { aufwachEinstellungen, type Aufwachen } from './aufwachen.js';
import { einstellungenLaden, einstellungenSetzen } from './telegram/einstellungen.js';

export const COOKIE = 'dorf_sitzung';
// Saxo-Rückleitung: kommt von einer fremden Seite ohne Cookie (SameSite=Strict) – geschützt über den einmaligen state
const OFFEN = new Set(['/api/gesundheit', '/api/anmeldung', '/api/anmeldung/info', '/api/boerse/saxo/rueckruf']);

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
  postbote: Postbote;
  morgenzeitung: Morgenzeitung;
  aufwachen: Aufwachen;
  dorfplan: Dorfplan;
  automatik?: Automatik;
  listen?: Record<ListenName, TodoDienst>;
  bank?: Bank;
  corps?: Corps;
  boerse?: Boerse;
  saxo?: Saxo;
  kirchturm?: Kirchturm;
  wochenrueckblick?: Wochenrueckblick;
  googleKalender?: GoogleKalender;
}

/** Für Agenten-HTML: Skripte ja, aber undurchsichtiger Ursprung und kein Netz. Bilder/Schriften nur eingebettet (data:). */
export const SEITEN_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

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

  /**
   * HTML aus dem Vault (Lernzettel, Probeklausuren) als abgeschottete Seite: Skripte laufen, aber in einem
   * eigenen, undurchsichtigen Ursprung (kein allow-same-origin → kein Zugriff auf App, Cookies, API)
   * und ohne Netz (default-src 'none'): nichts nachladen, nichts hinausschicken.
   */
  app.get('/api/vault/seite', async (req, reply) => {
    const q = z.object({ pfad: z.string(), v: z.string().optional() }).parse(req.query);
    if (!/\.html?$/i.test(q.pfad)) throw new DorfFehler(400, 'Nur .html-Dateien.');
    const r = vault.rohOeffnen(q.pfad);
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Length', String(r.groesse))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', SEITEN_CSP)
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'private, no-cache');
    return reply.send(r.strom);
  });

  /**
   * Häkchen-Brücke (E60): Eine HTML-Seite im Dorf darf über die App einen kleinen Zustand speichern (z. B. Häkchen
   * einer Checkliste) – sie selbst hat ja weder Speicher noch Netz. Nur für bestehende .html-Dateien, höchstens 64 KB.
   * Beim Ablösen einer Ablage wandert der Stand mit ins Archiv, und der nächste Lauf sieht ihn.
   */
  // ---- Etappe 7: Bank (nur lesen und auswerten) ----
  if (a.bank) {
    const bank = a.bank;
    app.get('/api/bank/monat', async (req) => {
      const { monat } = z.object({ monat: z.string().optional() }).parse(req.query);
      return bank.monat(monat ?? bank.monate()[0] ?? new Date(uhr.jetzt()).toISOString().slice(0, 7));
    });
    app.post('/api/bank/einlesen', async () => bank.einlesen());
    app.post('/api/bank/zuordnung', async (req) => {
      const { kennung, zuordnung } = z.object({ kennung: z.string().regex(/^[0-9a-f]{16}$/), zuordnung: z.unknown() }).parse(req.body);
      return bank.zuordnungSetzen(kennung, zuordnung);
    });
    app.patch('/api/bank/buchung/:id', async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { kategorie } = z.object({ kategorie: z.string().min(1).max(40) }).parse(req.body);
      return { geaendert: bank.kategorieSetzen(id, kategorie) };
    });
  }

  if (a.corps) {
    const corps = a.corps;
    app.get('/api/corps', async () => corps.uebersicht());
  }

  if (a.boerse) {
    const boerse = a.boerse;
    app.get('/api/boerse', async () => boerse.uebersicht());
    app.post('/api/boerse/aktualisieren', async () => boerse.aktualisieren());
    app.post('/api/boerse/wert', async (req) => {
      const { art, neu } = z.object({ art: z.enum(['positionen', 'watchlist']), neu: z.unknown() }).parse(req.body);
      await boerse.wertAendern(art, { neu });
      return boerse.uebersicht();
    });
    app.delete('/api/boerse/wert', async (req) => {
      const { art, index } = z.object({ art: z.enum(['positionen', 'watchlist']), index: z.coerce.number().int().min(0) }).parse(req.query);
      await boerse.wertAendern(art, { entfernen: index });
      return boerse.uebersicht();
    });
  }

  // ---- E75: Kalender auf dem Marktplatz (schreiben nur hier, also nur mit Leifs Klick) ----
  if (a.googleKalender) {
    const k = a.googleKalender;
    app.get('/api/kalender', async (req) => {
      const q = z.object({ von: z.string().datetime(), bis: z.string().datetime() }).parse(req.query);
      return k.zeitraum(Date.parse(q.von), Date.parse(q.bis));
    });
    app.get('/api/kalender/serie', async (req) => {
      const q = z.object({ kalenderId: z.string().min(1), serieId: z.string().min(1) }).parse(req.query);
      return k.serie(q.kalenderId, q.serieId);
    });
    app.post('/api/kalender/termin', async (req) => k.anlegen(req.body));
    app.post('/api/kalender/lernzeit', async (req) => k.lernzeitEintragen(req.body));
    app.get('/api/kalender/frei', async (req) => {
      const q = z
        .object({ bis: z.string().datetime(), dauer: z.coerce.number().int().min(15).max(480).default(90), anzahl: z.coerce.number().int().min(1).max(10).default(5) })
        .parse(req.query);
      return k.freieZeiten({ bis: Date.parse(q.bis), dauerMin: q.dauer, anzahl: q.anzahl });
    });
    app.patch('/api/kalender/termin', async (req) => {
      const b = z.object({ id: z.string().min(1), vonKalender: z.string().optional(), serie: z.boolean().optional(), termin: z.unknown() }).parse(req.body);
      return k.aendern(b.id, b.termin, { serie: b.serie, vonKalender: b.vonKalender });
    });
    app.delete('/api/kalender/termin', async (req) => {
      const q = z.object({ kalenderId: z.string().min(1), id: z.string().min(1), serie: z.enum(['ja', 'nein']).optional() }).parse(req.query);
      await k.loeschen(q.kalenderId, q.id, { serie: q.serie === 'ja' });
      return { ok: true };
    });
  }

  // ---- Wochenrückblick ----
  if (a.wochenrueckblick) {
    const w = a.wochenrueckblick;
    app.get('/api/wochenrueckblick', async () => ({ aktuell: await w.aktuell() }));
    app.post('/api/wochenrueckblick/erstellen', async () => ({ pfad: await w.erstellen() }));
  }

  // ---- E74: Kirchturm ----
  if (a.kirchturm) {
    const k = a.kirchturm;
    app.get('/api/kirchturm', async () => k.zustand());
    app.get('/api/kirchturm/fokus', async () => k.fokusStatistik());
    app.post('/api/kirchturm', async (req) => k.ausfuehren(req.body));
  }

  // ---- E73: Saxo (nur lesen) ----
  if (a.saxo) {
    const saxo = a.saxo;
    app.get('/api/boerse/saxo', async () => saxo.uebersicht());
    app.post('/api/boerse/saxo/anmelden', async () => saxo.anmeldenStart());
    app.post('/api/boerse/saxo/aktualisieren', async () => {
      await saxo.aktualisieren(true);
      return saxo.uebersicht();
    });
    app.post('/api/boerse/saxo/abmelden', async () => {
      saxo.abmelden();
      return saxo.uebersicht();
    });
    app.get('/api/boerse/saxo/rueckruf', async (req, reply) => {
      const q = z.object({ code: z.string().min(1).max(2000).optional(), state: z.string().min(1).max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
      let ziel = '/?g=Boerse&saxo=ok';
      try {
        if (!q.code || !q.state) throw new Error(q.error ? `Saxo meldet: ${q.error}` : 'Saxo hat keinen Code zurückgegeben.');
        await saxo.rueckruf(q.code, q.state);
      } catch (e) {
        req.log.warn(`Saxo-Anmeldung: ${(e as Error).message}`);
        ziel = `/?g=Boerse&saxo=fehler`;
      }
      return reply.redirect(ziel, 303);
    });
  }

  // ---- Etappe 6: Programme für Mac und Windows ----
  programmeRouten(app, { ordner: path.join(konfig.datenDir, 'programme'), ursprung: konfig.origins[0] ?? '' });

  // ---- E65: To-do-Brett (Marktplatz) ----
  // Etappe 7: alle Listen unter /api/listen/<name>; /api/todos bleibt für die To-do-Liste
  if (a.listen) {
    const listen = a.listen;
    for (const [basis, name] of [['/api/todos', 'todo'] as const, ...LISTEN_NAMEN.map((n) => [`/api/listen/${n}`, n] as const)]) {
      const l = listen[name];
      app.get(basis, async (req) => l.liste({ alleErledigten: (req.query as { alle?: string }).alle === '1' }));
      app.post(basis, async (req) => l.anlegen(req.body, 'Leif'));
      app.patch(basis, async (req) => {
        const { pfad, basisVersion, ...rest } = z.object({ pfad: z.string(), basisVersion: z.string().optional() }).passthrough().parse(req.body);
        return l.aendern(pfad, rest, basisVersion);
      });
      app.delete(basis, async (req) => {
        const { pfad } = z.object({ pfad: z.string() }).parse(req.query);
        return { papierkorb: await l.loeschen(pfad) };
      });
    }
  }

  app.get('/api/vault/seitenstand', async (req) => {
    const { pfad } = z.object({ pfad: z.string() }).parse(req.query);
    const z1 = db.prepare('SELECT inhalt_json FROM seiten_stand WHERE pfad = ?').get(normalisieren(pfad)) as { inhalt_json: string } | undefined;
    return { stand: z1 ? (JSON.parse(z1.inhalt_json) as unknown) : null };
  });
  app.put('/api/vault/seitenstand', async (req) => {
    const b = z.object({ pfad: z.string(), stand: z.unknown() }).parse(req.body);
    const pfad = normalisieren(b.pfad);
    if (!/\.html?$/i.test(pfad)) throw new DorfFehler(400, 'Nur für .html-Seiten.');
    if (!(await vault.existiert(pfad))) throw new DorfFehler(404, 'Diese Seite gibt es nicht.');
    const json = JSON.stringify(b.stand ?? null);
    if (json.length > 64_000) throw new DorfFehler(413, 'Der Stand ist zu groß (höchstens 64 KB).');
    db.prepare('INSERT OR REPLACE INTO seiten_stand (pfad, inhalt_json, geaendert) VALUES (?, ?, ?)').run(pfad, json, uhr.jetzt());
    return { ok: true };
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
  // Etappe 7: Gebäude anlegen und eröffnen/ändern
  app.post('/api/gebaeude', async (req) => {
    const id = await gebaeudeAnlegen(vault, req.body);
    hub.senden({ typ: 'gebaeude.geaendert' });
    return { id };
  });
  app.patch('/api/gebaeude/:id', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(80) }).parse(req.params);
    await gebaeudeAendern(vault, id, req.body);
    hub.senden({ typ: 'gebaeude.geaendert' });
    return (await gebaeudeListe(vault)).find((g) => g.id === id);
  });

  // ---- Agenten (Etappe 2a) ------------------------------------------------------------------
  agentenRouten(app, { agenten: a.agenten, vault, uhr, db, hub, schreibtisch: a.schreibtisch, buergermeister: a.buergermeister, automatik: a.automatik });

  // ---- Telegram (Etappe 2b) -----------------------------------------------------------------
  app.get('/api/telegram/status', async () => {
    const e = await einstellungenLaden(vault);
    if (a.telegram) return a.telegram.status(e);
    return { tokenGesetzt: !!konfig.telegramToken, chatGekoppelt: !!konfig.telegramChatId, laeuft: false, einstellungen: e };
  });
  app.put('/api/telegram/einstellungen', async (req) => {
    const b = z.object({ freigaben: z.boolean(), entwuerfe: z.boolean(), fehler: z.boolean(), beendet: z.boolean(), mails: z.boolean(), moodle: z.boolean().default(true), erinnerungen: z.boolean().default(true), morgenzeitung: z.boolean().default(true), bank: z.boolean().default(true) }).parse(req.body);
    return einstellungenSetzen(vault, b);
  });
  app.post('/api/telegram/test', async () => {
    if (!a.telegram) throw new DorfFehler(409, 'Telegram ist nicht eingerichtet. Auf dem Server: dorf telegram-einrichten');
    await a.telegram.senden('👋 Testnachricht aus dem Agentendorf – die Verbindung steht.');
    return { ok: true };
  });

  // ---- Uni (Etappe 3) ------------------------------------------------------------------------
  app.get('/api/uni', async () => a.uni.uebersicht());
  // Moodle-Browser (E57): aus = nicht eingerichtet; sonst ob der Container läuft und Zugangsdaten hat
  app.get('/api/uni/moodle-browser', async () => {
    const b = a.agenten.moodleBrowser;
    if (!b) return { status: 'aus' };
    const z = await b.zustand();
    return { status: !z.erreichbar ? 'nicht_erreichbar' : z.zugang ? 'bereit' : 'ohne_zugang' };
  });
  app.post('/api/uni/fristen/erledigt', async (req) => {
    const b = z.object({ id: z.string().min(1).max(100), erledigt: z.boolean() }).parse(req.body);
    try {
      a.uni.erledigtSetzen(b.id, b.erledigt);
    } catch (e) {
      throw new DorfFehler(404, (e as Error).message);
    }
    return { ok: true };
  });
  // Stand je Fach: offene Abgaben, nächste Frist (Kurs-Name passt ungefähr zum Fach), Fokuszeit der letzten 7 Tage
  app.get('/api/uni/faecher-stand', async (): Promise<FachStand[]> => {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
    const passt = (a: string, b: string) => {
      const x = norm(a);
      const y = norm(b);
      return x.length >= 2 && y.length >= 2 && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
    };
    const abgaben = a.uni.abgaben();
    const fristen = a.uni.fristen().filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && Date.parse(f.frist) > uhr.jetzt());
    const fokus = a.kirchturm?.fokusJeGruppe(uhr.jetzt() - 7 * 86_400_000) ?? new Map<string, number>();
    return a.uni.faecher().map((f) => {
      const n = fristen.find((x) => x.kurs && (passt(x.kurs, f.titel) || passt(x.kurs, f.name)));
      return {
        ...f,
        offeneAbgaben: abgaben.filter((x) => x.fach === f.titel).length,
        naechsteFrist: n ? { titel: n.titel, frist: n.frist!, art: n.art as 'abgabe' | 'test' } : null,
        fokus7Tage: [...fokus.entries()].filter(([k]) => passt(k, f.titel) || passt(k, f.name)).reduce((s2, [, m]) => s2 + m, 0),
      };
    });
  });
  app.post('/api/uni/fach', async (req) => {
    const b = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    try {
      return { ordner: await a.uni.fachAnlegen(b.name) };
    } catch (e) {
      throw e instanceof DorfFehler ? e : new DorfFehler(409, (e as Error).message);
    }
  });
  app.post('/api/uni/abgleichen', async () => {
    if (!a.uni.verbunden) throw new DorfFehler(409, 'Moodle ist nicht eingerichtet. Auf dem Server: dorf moodle-kalender');
    if (a.uni.laeuft) return { gestartet: false };
    void a.uni.abgleichen();
    return { gestartet: true };
  });

  // ---- Post (Etappe 4) -----------------------------------------------------------------------
  app.get('/api/post', async () => a.postbote.uebersicht());
  app.post('/api/post/abholen', async () => {
    if (!a.postbote.verbunden) throw new DorfFehler(409, 'Gmail ist nicht verbunden. Auf dem Server: dorf gmail-anmelden');
    if (a.postbote.laeuft) return { gestartet: false };
    void a.postbote.abholen().catch(() => undefined);
    return { gestartet: true };
  });

  // Mail → To-do (Leifs Klick): Betreff/Absender/Zusammenfassung stammen aus der Mail → als Fremdinhalt markiert
  app.post('/api/post/todo', async (req) => {
    const b = z.object({ id: z.string().min(1).max(100) }).parse(req.body);
    const m = a.postbote.mailHolen(b.id);
    if (!m) throw new DorfFehler(404, 'Diese Mail kenne ich nicht (mehr).');
    if (!a.listen) throw new DorfFehler(409, 'Keine To-do-Liste.');
    const faellig = m.frist && /^\d{4}-\d{2}-\d{2}/.test(m.frist) ? m.frist.slice(0, 10) : undefined;
    const notiz = [`Von: ${m.von}`, m.zusammenfassung ?? '', `[In Gmail öffnen](https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.threadId)})`].filter(Boolean).join('\n\n');
    return a.listen.todo.anlegen({ titel: `${m.antwortNoetig ? 'Antworten: ' : ''}${m.betreff || '(ohne Betreff)'}`.slice(0, 200), notiz, gebaeude: 'Post', ...(faellig ? { faellig } : {}) }, 'Post', { fremd: true });
  });

  // ---- Morgenzeitung (Etappe 4) --------------------------------------------------------------
  app.get('/api/morgenzeitung', async () => a.morgenzeitung.uebersicht());
  app.post('/api/morgenzeitung/erstellen', async () => ({ pfad: await a.morgenzeitung.erstellen() }));

  // ---- Aufwachen des Bürgermeisters (Etappe 4) -----------------------------------------------
  app.get('/api/aufwachen', async () => {
    const z = a.aufwachen.naechsteZeit;
    const e = await aufwachEinstellungen(vault);
    return {
      naechste: z == null ? null : new Date(z).toISOString(),
      anlaesse: a.aufwachen.anlaesse().map((x) => x.zeile),
      verbrauchHeute: a.aufwachen.verbrauchHeute(),
      tagesbudget: e.tagesbudget_usd,
      eigeneAufgaben: e.eigene_aufgaben,
    };
  });
  app.post('/api/aufwachen/jetzt', async () => a.aufwachen.aufwachen());

  // ---- Live-Verbindung ------------------------------------------------------------------------
  // ---- Etappe 5: Dorf ------------------------------------------------------------------------
  app.get('/api/dorf', async () => a.dorfplan.laden());
  app.put('/api/dorf/layout', async (req) => {
    const b = z.object({ basisVersion: z.number().int().min(0), layout: z.unknown() }).parse(req.body);
    return a.dorfplan.speichern(b.basisVersion, b.layout);
  });
  app.get('/api/dorf/status', async () => a.dorfplan.status());

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
