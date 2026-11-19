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
import type { Schreibtisch } from '../schreibtisch.js';
import type { Buergermeister } from './buergermeister.js';
import { DorfFehler } from '../fehler.js';
import type { Automatik } from './automatik.js';
import { skillAnlegen, skillPruefen } from './skills.js';

export function agentenRouten(
  app: FastifyInstance,
  d: { agenten: AgentenDienst; vault: VaultDienst; uhr: Uhr; db: DB; hub: LiveHub; schreibtisch: Schreibtisch; buergermeister: Buergermeister; automatik?: Automatik },
) {
  const { agenten, vault } = d;

  app.get('/api/aktionen', async (req): Promise<AktionInfo[]> => {
    const { gebaeude } = z.object({ gebaeude: z.string().optional() }).parse(req.query);
    // Prompt und Kopf bleiben auf dem Server
    return (await aktionenListe(vault, gebaeude)).map(({ kopf: _k, prompt: _p, anhaenge: _a, ...info }) => {
      const naechsterLauf = d.automatik?.naechster(info);
      return naechsterLauf ? { ...info, naechsterLauf } : info;
    });
  });

  app.get('/api/aktionen/quelle', async (req) => {
    const q = z.object({ name: z.enum(['uni.faecher', 'uni.abgaben', 'post.mails']) }).parse(req.query);
    return agenten.quellen(q.name);
  });

  // Skill anlegen (App-Formular): wird wie jede Aktion geprüft, dann als Markdown-Datei gespeichert
  app.post('/api/aktionen/neu', async (req) => {
    const r = await skillAnlegen(vault, req.body);
    return { id: r.id, pfad: r.pfad };
  });
  // Vorschau: Prüfen ohne Speichern (zeigt das Markdown)
  app.post('/api/aktionen/pruefen', async (req) => {
    const s = await skillPruefen(vault, req.body);
    return { pfad: s.pfad, markdown: s.markdown };
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
  // E185: wartende Nachricht wieder herausnehmen
  app.delete('/api/chats/:id/wartend/:nr', async (req) => {
    const p = z.object({ id: z.string(), nr: z.coerce.number().int() }).parse(req.params);
    agenten.wartendeLoeschen(p.id, p.nr);
    return { ok: true };
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
    const { annehmen, grund } = z.object({ annehmen: z.boolean(), grund: z.string().max(2000).optional() }).parse(req.body);
    return agenten.freigaben.entscheiden(id, annehmen, 'leif', grund);
  });

  // E185: was Agenten ohne Rückfrage getan haben – und der Knopf, der es genau einmal zurücknimmt
  app.get('/api/rueckgaengig', async () => agenten.rueckgaengig.liste());
  app.post('/api/rueckgaengig/:id', async (req) => agenten.rueckgaengig.zuruecknehmen(z.object({ id: z.string() }).parse(req.params).id));

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

  // ---- Schreibtisch und Pläne (Etappe 2b) -----------------------------------------------------
  app.get('/api/schreibtisch', async () => d.schreibtisch.liste());

  /** Neue Aufgabe (Text + Dateien, multipart oder JSON) – der Bürgermeister legt sofort los. */
  app.post('/api/schreibtisch', async (req) => {
    let text = '';
    const anhaenge: string[] = [];
    if (req.isMultipart()) {
      for await (const teil of req.parts()) {
        if (teil.type === 'file') anhaenge.push(await d.schreibtisch.anhangSpeichern(teil.filename, teil.file));
        else if (teil.fieldname === 'text') text = String(teil.value ?? '');
      }
    } else text = z.object({ text: z.string() }).parse(req.body).text;
    const a = await d.schreibtisch.anlegen({ text, quelle: 'app', anhaenge });
    await d.buergermeister.starten(a.id, 'klick');
    return d.schreibtisch.holen(a.id);
  });

  app.post('/api/schreibtisch/:id/bearbeiten', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const a = d.schreibtisch.holen(id);
    if (a.status !== 'neu') throw new DorfFehler(409, 'Diese Aufgabe ist schon in Arbeit oder erledigt.');
    await d.buergermeister.starten(id, 'klick');
    return d.schreibtisch.holen(id);
  });

  app.get('/api/plaene', async () => d.buergermeister.plaene());
  app.get('/api/plaene/:id', async (req) => d.buergermeister.planInfo(z.object({ id: z.string() }).parse(req.params).id));
}
