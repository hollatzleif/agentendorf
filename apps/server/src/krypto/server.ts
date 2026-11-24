// E227: HTTP-Schnittstelle des Kryptowerks – nur im internen Netz, nur mit KRYPTO_GEHEIMNIS (Bearer).
// Das Dorf reicht Leifs Klicks durch; die App spricht nie direkt mit dem Kryptowerk.
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { KRYPTO_KERZEN_TAKTE } from '@dorf/shared';
import { KryptoFehler, type Kryptowerk } from './motor.js';
import type { Backtests } from './backtest.js';

export function kryptoServer(werk: Kryptowerk, geheimnis: string, backtests?: Backtests): FastifyInstance {
  if (geheimnis.length < 32) throw new Error('KRYPTO_GEHEIMNIS fehlt oder ist zu kurz');
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const soll = Buffer.from(`Bearer ${geheimnis}`);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/gesund') return;
    const ist = Buffer.from(req.headers.authorization ?? '');
    if (ist.length !== soll.length || !crypto.timingSafeEqual(ist, soll)) return reply.code(401).send({ fehler: 'nicht erlaubt' });
  });
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof KryptoFehler) return reply.code(e.status).send({ fehler: e.message });
    if (e instanceof ZodError) return reply.code(400).send({ fehler: e.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ') });
    return reply.code(500).send({ fehler: (e as Error).message });
  });
  const Id = z.object({ id: z.string().uuid() });

  app.get('/gesund', async () => ({ ok: true }));
  app.get('/uebersicht', async () => werk.uebersicht());
  app.post('/bots', async (req) => {
    const b = z.object({ einstellung: z.unknown(), modus: z.unknown().optional() }).parse(req.body);
    return werk.anlegen(b.einstellung, b.modus ?? 'paper');
  });
  app.put('/bots/:id', async (req) => werk.aendern(Id.parse(req.params).id, z.object({ einstellung: z.unknown() }).parse(req.body).einstellung));
  app.post('/bots/:id/status', async (req) => werk.statusSetzen(Id.parse(req.params).id, z.object({ status: z.enum(['laeuft', 'pausiert']) }).parse(req.body).status));
  app.delete('/bots/:id', async (req) => {
    werk.loeschen(Id.parse(req.params).id);
    return { ok: true };
  });
  app.get('/bots/:id/terminal', async (req) => werk.terminal(Id.parse(req.params).id, z.object({ takt: z.enum(KRYPTO_KERZEN_TAKTE).default('15m') }).parse(req.query).takt));
  app.get('/bots/:id/protokoll', async (req) => {
    const q = z.object({ vor: z.coerce.number().int().positive().optional(), anzahl: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
    return werk.protokoll(Id.parse(req.params).id, q);
  });
  // E228: scharf schalten (Passwort/TOTP prüft das Dorf vorher), entschärfen, auszahlen (nur an die feste Adresse)
  app.post('/bots/:id/scharf', async (req) => werk.scharfSchalten(Id.parse(req.params).id, z.object({ budgetSol: z.number().finite() }).parse(req.body)));
  app.post('/bots/:id/entschaerfen', async (req) => werk.entschaerfen(Id.parse(req.params).id));
  app.post('/bots/:id/auszahlen', async (req) => werk.auszahlen(Id.parse(req.params).id));
  app.get('/backtests', async () => {
    if (!backtests) throw new KryptoFehler(503, 'Backtest nicht verfügbar');
    const b = backtests.bereich();
    return { bereich: { von: b.von ? new Date(b.von).toISOString() : null, bis: b.bis ? new Date(b.bis).toISOString() : null }, jobs: backtests.liste() };
  });
  app.post('/backtests', async (req) => {
    if (!backtests) throw new KryptoFehler(503, 'Backtest nicht verfügbar');
    const b = z.object({ einstellung: z.unknown(), vonStunden: z.number().min(0.2).max(24 * 30).optional() }).parse(req.body);
    const bis = backtests.bereich().bis ?? Date.now();
    return backtests.starten(b.einstellung, b.vonStunden ? { von: bis - b.vonStunden * 3_600_000 } : {});
  });
  app.get('/backtests/:id', async (req) => {
    if (!backtests) throw new KryptoFehler(503, 'Backtest nicht verfügbar');
    return backtests.hole(Id.parse(req.params).id);
  });
  app.post('/notaus', async (req) => {
    werk.notausAusloesen(z.object({ grund: z.string().max(100).optional() }).parse(req.body ?? {}).grund ?? 'Not-Aus');
    return werk.uebersicht();
  });
  app.post('/notaus/aufheben', async () => {
    werk.notausAufheben();
    return werk.uebersicht();
  });
  return app;
}
