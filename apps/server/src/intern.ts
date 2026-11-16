import Fastify from 'fastify';
import { z } from 'zod';
import type { WerkzeugRegister } from './agenten/register.js';

/**
 * Interner Server (Port 3001, nur im Docker-Netz, nicht über Caddy erreichbar):
 * Der MCP-Server der Werkstatt ruft hier die Dorf-Werkzeuge auf. Jedes Token gilt nur für einen laufenden Lauf.
 */
export async function internBauen(register: WerkzeugRegister) {
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
  return app;
}
