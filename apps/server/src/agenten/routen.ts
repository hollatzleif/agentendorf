import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AktionInfo } from '@dorf/shared';
import type { VaultDienst } from '../vault/dienst.js';
import type { Uhr } from '../uhr.js';
import type { DB } from '../db.js';
import type { LiveHub } from '../live.js';
import type { AgentenDienst } from './dienst.js';
import { aktionenListe } from './aktionen.js';
import { motorenLaden, motorenSetzen, stufeSetzen, stufenLaden } from './modelle.js';
import { verbrauchAuswerten } from './verbrauch.js';

export function agentenRouten(app: FastifyInstance, d: { agenten: AgentenDienst; vault: VaultDienst; uhr: Uhr; db: DB; hub: LiveHub }) {
  const { agenten, vault } = d;

  app.get('/api/aktionen', async (req): Promise<AktionInfo[]> => {
    const { gebaeude } = z.object({ gebaeude: z.string().optional() }).parse(req.query);
    // Prompt und Kopf bleiben auf dem Server
    return (await aktionenListe(vault, gebaeude)).map(({ kopf: _k, prompt: _p, anhaenge: _a, ...info }) => info);
  });

  app.post('/api/aktionen/starten', async (req) => {
    const b = z.object({ id: z.string(), eingaben: z.record(z.string(), z.string()).default({}) }).parse(req.body);
    return agenten.aktionStarten(b.id, b.eingaben, 'klick');
  });

  app.get('/api/chats', async (req) => {
    const q = z.object({ gebaeude: z.string().optional(), q: z.string().max(100).optional() }).parse(req.query);
    return agenten.chatListe(q);
  });
  app.get('/api/chats/:id', async (req) => agenten.chatDetail(z.object({ id: z.string() }).parse(req.params).id));
  app.post('/api/chats/:id/nachricht', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { text } = z.object({ text: z.string().max(100_000) }).parse(req.body);
    return agenten.nachrichtSenden(id, text);
  });
  app.post('/api/laeufe/:id/abbrechen', async (req) => {
    agenten.abbrechen(z.object({ id: z.string() }).parse(req.params).id);
    return { ok: true };
  });
  app.get('/api/laeufe/aktiv', async () => agenten.aktiveLaeufe());

  app.get('/api/freigaben', async (req) => {
    const { status } = z.object({ status: z.enum(['offen', 'erledigt']).optional() }).parse(req.query);
    return agenten.freigaben.liste(status);
  });
  app.post('/api/freigaben/:id/entscheiden', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { annehmen } = z.object({ annehmen: z.boolean() }).parse(req.body);
    return agenten.freigaben.entscheiden(id, annehmen);
  });

  app.get('/api/verbrauch', async () => verbrauchAuswerten(d.db, d.uhr.jetzt()));

  app.get('/api/einstellungen/agenten', async () => ({ modelle: await stufenLaden(vault), motoren: await motorenLaden(vault) }));
  app.put('/api/einstellungen/stufe', async (req) => {
    const b = z
      .object({ stufe: z.enum(['klein', 'mittel', 'gross']), modell: z.string(), aufwand: z.enum(['low', 'medium', 'high', 'xhigh', 'max']) })
      .parse(req.body);
    await stufeSetzen(vault, b.stufe, b.modell, b.aufwand);
    d.hub.senden({ typ: 'konfig.geaendert' });
    return stufenLaden(vault);
  });
  app.put('/api/einstellungen/motoren', async (req) => {
    const b = z
      .object({
        alleAuf: z.enum(['keiner', 'api', 'claude-code']),
        parallel: z.object({ 'claude-code': z.number().int().min(0).max(10), api: z.number().int().min(0).max(20) }),
      })
      .parse(req.body);
    await motorenSetzen(vault, b);
    d.hub.senden({ typ: 'konfig.geaendert' });
    agenten.anstossen();
    return motorenLaden(vault);
  });
}
