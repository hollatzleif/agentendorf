// E227: Einstieg des Kryptowerk-Containers (gleiches Image wie das Dorf, eigener Prozess, eigene Datenbank).
// Kein Vault, keine Dorf-Geheimnisse – nur KRYPTO_GEHEIMNIS. Bewertungen mit LLM laufen über das Dorf (interner Port).
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { systemUhr } from './uhr.js';
import { Kryptowerk, kryptoDb, type LlmAntwort } from './krypto/motor.js';
import { DexScreener, PumpPortal, RugCheck } from './krypto/quellen.js';
import { kryptoServer } from './krypto/server.js';

const geheimnis = process.env.KRYPTO_GEHEIMNIS ?? '';
const daten = process.env.KRYPTO_DATEN ?? '/krypto';
const dorf = process.env.DORF_INTERN_URL ?? 'http://dorf:3001';
fs.mkdirSync(daten, { recursive: true });
const db = kryptoDb(path.join(daten, 'krypto.db'));
const log = (t: string) => console.warn(`[kryptowerk] ${t}`);

const Antwort = z.object({ action: z.enum(['buy', 'sell', 'hold']), token: z.string(), confidence: z.number(), reason: z.string() });

let werk: Kryptowerk;
const portal = new PumpPortal({ neu: (t, zeit) => werk.neuerToken(t, zeit), log });
werk = new Kryptowerk({
  db,
  uhr: systemUhr,
  dex: new DexScreener(),
  rug: new RugCheck(),
  portal,
  log,
  llm: async (a): Promise<LlmAntwort> => {
    const r = await fetch(`${dorf}/intern/krypto/bewerten`, {
      method: 'POST',
      headers: { authorization: `Bearer ${geheimnis}`, 'content-type': 'application/json' },
      body: JSON.stringify(a),
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await r.json().catch(() => ({}))) as { fehler?: string };
    if (!r.ok) throw new Error(j.fehler ?? `Dorf antwortet mit ${r.status}`);
    return Antwort.parse(j);
  },
});
const app = kryptoServer(werk, geheimnis);
werk.starten();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 4300) });
log('bereit');
const ende = () => {
  werk.beenden();
  void app.close().then(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', ende);
process.on('SIGINT', ende);
