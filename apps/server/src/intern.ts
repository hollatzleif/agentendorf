import Fastify from 'fastify';
import { z } from 'zod';
import type { WerkzeugRegister } from './agenten/register.js';
import { CODING_ZUGANG_PFAD, codingZugangPruefen } from './coding.js';
import type { DB } from './db.js';
import type { Konfig } from './konfig.js';
import type { Uhr } from './uhr.js';

/**
 * Interner Server (Port 3001, nur im Docker-Netz, nicht über Caddy erreichbar):
 * Der MCP-Server der Werkstatt (und des Codehauses) ruft hier die Dorf-Werkzeuge auf. Jedes Token gilt nur für einen laufenden Lauf.
 * E191: Caddy fragt hier vor jeder Anfrage an den Code-Host (VS Code), ob das Code-Cookie gilt (forward_auth).
 */
export async function internBauen(register: WerkzeugRegister, coding?: { konfig: Konfig; db: DB; uhr: Uhr }) {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  const kiste = (auth: string | undefined) => register.finden(auth?.replace(/^Bearer /, ''));

  app.get('/intern/werkzeuge', async (req, reply) => {
    const k = kiste(req.headers.authorization);
    if (!k) return reply.status(401).send({ fehler: 'Token ungültig oder Lauf beendet.' });
    return k.definitionen();
  });
  app.post('/intern/werkzeug', async (req, reply) => {
    const k = kiste(req.headers.authorization);
    if (!k) return reply.status(401).send({ fehler: 'Token ungültig oder Lauf beendet.' });
    const b = z.object({ name: z.string(), eingabe: z.unknown() }).parse(req.body);
    return k.aufrufen(b.name, b.eingabe);
  });
  if (coding)
    app.get(CODING_ZUGANG_PFAD, async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const r = codingZugangPruefen(coding, req.headers);
      if (r.status === 302) return reply.redirect(r.ziel, 302);
      return reply
        .status(r.status)
        .type('text/plain; charset=utf-8')
        .send(r.status === 200 ? 'ok' : 'Nicht angemeldet. Öffne VS Code über das Codehaus im Dorf.');
    });
  return app;
}
