// E227: Einstieg des Kryptowerk-Containers (gleiches Image wie das Dorf, eigener Prozess, eigene Datenbank).
// Kein Vault, keine Dorf-Geheimnisse – nur KRYPTO_GEHEIMNIS. Bewertungen mit LLM laufen über das Dorf (interner Port).
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { systemUhr } from './uhr.js';
import { Kryptowerk, kryptoDb, type LlmAntwort } from './krypto/motor.js';
import { DexScreener, Metadaten, PumpPortal, RugCheck } from './krypto/quellen.js';
import { SmartMoney } from './krypto/smart.js';
import { kryptoServer } from './krypto/server.js';
import { WalletTresor, istAdresse } from './krypto/wallet.js';
import { LiveAusfuehrer } from './krypto/ausfuehrung.js';
import { Backtests } from './krypto/backtest.js';
import { KurveStrom, wssAusRpc } from './krypto/strom.js';
import { MusterDienst } from './krypto/muster/dienst.js';

const geheimnis = process.env.KRYPTO_GEHEIMNIS ?? '';
const daten = process.env.KRYPTO_DATEN ?? '/krypto';
const dorf = process.env.DORF_INTERN_URL ?? 'http://dorf:3001';
fs.mkdirSync(daten, { recursive: true });
const db = kryptoDb(path.join(daten, 'krypto.db'));
const log = (t: string) => console.warn(`[kryptowerk] ${t}`);
// E228: Wallets (Hauptschlüssel nur in krypto.env), echte Ausführung nur mit RPC, Auszahlung nur an die feste Adresse
const tresor = new WalletTresor(db, process.env.KRYPTO_HAUPTSCHLUESSEL);
const rpcUrl = process.env.KRYPTO_RPC_URL?.trim();
const auszahlung = process.env.KRYPTO_AUSZAHLUNG?.trim();

// Verwaltung auf dem Server (dorf krypto-export): Schlüssel eines Wallets im Phantom-Format, dann Ende
if (process.argv[2] === 'wallets' || process.argv[2] === 'export') {
  if (process.argv[2] === 'wallets') for (const w of tresor.liste()) console.log(`${w.adresse}  ${w.botId}`);
  else {
    const adr = process.argv[3] ?? '';
    if (!istAdresse(adr)) {
      console.error('Aufruf: export <Wallet-Adresse>');
      process.exit(1);
    }
    console.log(tresor.exportieren(adr));
  }
  db.close();
  process.exit(0);
}

const Antwort = z.object({ action: z.enum(['buy', 'sell', 'hold']), token: z.string(), confidence: z.number(), reason: z.string() });

let werk: Kryptowerk;
// E232: Echtzeit-Kurse über den WebSocket desselben RPC (Helius: Standard-WebSockets im kostenlosen Tarif); KRYPTO_ECHTZEIT=aus schaltet ab
const wss = rpcUrl && process.env.KRYPTO_ECHTZEIT !== 'aus' ? wssAusRpc(rpcUrl) : null;
const grenzeMb = Number(process.env.KRYPTO_ECHTZEIT_MB_TAG ?? '') || undefined;
const strom = wss ? new KurveStrom({ url: wss, tick: (m, s, z) => werk.kurveTick(m, s, z), log, ...(grenzeMb ? { grenzeMb } : {}) }) : undefined;
// E235: Muster-Modell + RL-Agent – Training alle KRYPTO_MUSTER_STUNDEN (Standard 5) Stunden, erstes 10 min nach dem Start
const muster = new MusterDienst({ db, uhr: systemUhr, stunden: Number(process.env.KRYPTO_MUSTER_STUNDEN ?? '') || 5, log });
const portal = new PumpPortal({ neu: (t, zeit) => werk.neuerToken(t, zeit), log });
werk = new Kryptowerk({
  db,
  uhr: systemUhr,
  dex: new DexScreener(),
  rug: new RugCheck(),
  portal,
  log,
  tresor,
  muster,
  // E244: Pump.fun-Metadaten (nur IPFS über gateway.pinata.cloud) und Smart Money über Leifs Helius-RPC (eigene Tagesgrenze)
  metadaten: new Metadaten(),
  smart: new SmartMoney({ db, rpcUrl: rpcUrl ?? null, creditsTag: Number(process.env.KRYPTO_SMART_CREDITS_TAG ?? '') || undefined }),
  ...(strom ? { strom } : {}),
  ...(rpcUrl && /^https:\/\//.test(rpcUrl) && tresor.bereit ? { live: LiveAusfuehrer.mitRpcUrl(tresor, rpcUrl) } : {}),
  ...(auszahlung ? { auszahlung } : {}),
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
const app = kryptoServer(werk, geheimnis, new Backtests({ db }), muster);
if (!tresor.bereit) log('Hauptschlüssel fehlt – Bots bekommen kein Wallet, Live ist aus (dorf deploy legt ihn an).');
if (!rpcUrl) log('Kein RPC – Live und Echtzeit-Kurse sind aus (dorf krypto-rpc).');
werk.starten();
muster.starten();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 4300) });
log('bereit');
const ende = () => {
  muster.beenden();
  werk.beenden();
  void app.close().then(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', ende);
process.on('SIGINT', ende);
