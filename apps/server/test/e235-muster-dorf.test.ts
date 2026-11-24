import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KRYPTO_RL_STANDARD, KRYPTO_STANDARD, type KryptoBot, type KryptoEinstellung, type KryptoMusterStatus } from '@dorf/shared';
import { werkzeugprofil } from '../src/agenten/leine.js';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { zeitplanLesen } from '../src/agenten/zeitplan.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { agentenBots, HAFEN_AGENT_MAX_RL, musterText } from '../src/agenten/werkzeuge-hafen.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/**
 * E235: Muster-Modell im Dorf – Durchreiche /api/krypto/muster*, Werkzeug hafen_muster (Status, Training, 409),
 * RL-Bots für Agenten (höchstens einer, nur Paper), Vorlage-Aktion Muster-Meister.
 */
const G = 'm'.repeat(40);
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

function status(o: Partial<KryptoMusterStatus> = {}): KryptoMusterStatus {
  return {
    ziel: { zielProzent: 20, stopProzent: 15, horizontMin: 5 },
    modell: {
      version: 3,
      trainiert: '2026-11-24T10:00:00.000Z',
      beispiele: 48_210,
      positivAnteil: 0.18,
      test: { beispiele: 12_050, auc: 0.612, praezision: 0.31, basis: 0.17 },
      aktiv: true,
      merkmale: [
        { name: 'kaufVerhaeltnis60s', wichtigkeit: 0.21 },
        { name: 'rendite30s', wichtigkeit: 0.14 },
        { name: 'ticks60s', wichtigkeit: 0.1 },
      ],
    },
    rl: { version: 2, trainiert: '2026-11-24T10:01:00.000Z', episoden: 4000, zeitraffer: { trades: 57, gewinnSol: 0.84, trefferquote: 0.42, pleiten: 0 } },
    training: { laeuft: false, fortschritt: 0, letzter: '2026-11-24T10:01:00.000Z', naechster: '2026-11-24T15:01:00.000Z', fehler: null, dauerMs: 61_000 },
    daten: { ticks: 1_204_000, tokens: 3_100, von: '2026-11-21T08:00:00.000Z', bis: '2026-11-24T10:00:00.000Z' },
    bericht: '## Muster-Modell v3\nTest-AUC 0,61 – besser als Raten (0,5).',
    ...o,
  };
}

const KENNZAHLEN = {
  kapitalSol: 10,
  startSol: 10,
  faktor: 1,
  gewinnSol: 0,
  gewinnProzent: 0,
  trades: 0,
  gewonnen: 0,
  verloren: 0,
  trefferquote: null,
  maxDrawdownProzent: 0,
  offen: 0,
  gebuehrenSol: 0,
  gebuehrenArt: { pumpSol: 0, portalSol: 0, netzSol: 0 },
  umsatzSol: 0,
  geblockteRugs: 0,
  heuteSol: 0,
};

/** nachgebautes Kryptowerk: merkt Anfragen, hält Bots im Speicher, Training läuft nach dem ersten Start „schon“ (409) */
function kryptowerk(m: KryptoMusterStatus = status()) {
  const anfragen: { methode: string; pfad: string; auth: string | null; body: unknown }[] = [];
  const bots: KryptoBot[] = [];
  let training = false;
  let nr = 0;
  const holen = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const methode = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    anfragen.push({ methode, pfad: u.pathname, auth: new Headers(init.headers).get('authorization'), body });
    if (u.pathname === '/muster' && methode === 'GET') return Response.json({ ...m, training: { ...m.training, laeuft: training, fortschritt: training ? 0.4 : 0 } });
    if (u.pathname === '/muster/training' && methode === 'POST') {
      if (training) return Response.json({ fehler: 'Das Training läuft schon.' }, { status: 409 });
      training = true;
      return Response.json({ ok: true });
    }
    if (u.pathname === '/uebersicht') return Response.json({ verbunden: true, notaus: false, datenOnline: true, beobachtet: 3, solUsd: 140, bots });
    if (u.pathname === '/bots' && methode === 'POST') {
      const e = (body as { einstellung: KryptoEinstellung }).einstellung;
      const id = `00000000-0000-4000-8000-${String(++nr).padStart(12, '0')}`;
      const b = { id, einstellung: e, modus: 'paper', status: 'laeuft', erstellt: '2026-11-24T10:00:00.000Z', abschnittSeit: '2026-11-24T10:00:00.000Z', kennzahlen: KENNZAHLEN, kurve: [], wallet: null, live: null, paperBilanz: null } as unknown as KryptoBot;
      bots.push(b);
      return Response.json(b);
    }
    if (u.pathname.startsWith('/bots/') && methode === 'PUT') {
      const b = bots.find((x) => u.pathname === `/bots/${x.id}`)!;
      b.einstellung = (body as { einstellung: KryptoEinstellung }).einstellung;
      return Response.json(b);
    }
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return { holen, anfragen, bots, fertig: () => (training = false) };
}

async function lauf(d: Awaited<ReturnType<typeof testDorf>>, zeilen: string[], werkzeuge = '[vault_lesen, hafen]') {
  fs.writeFileSync(path.join(d.vault.wurzel, 'Hafen/aktionen/test.md'), `---\nname: test\nwerkzeuge: ${werkzeuge}\n---\n${zeilen.join('\n')}\n`);
  const r = await d.agenten.aktionStarten('Hafen/test', {});
  await d.agenten.leerlauf();
  return d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
}

describe('Muster-Modell: Durchreiche (E235)', () => {
  it('GET /api/krypto/muster und POST …/training mit Bearer; 409 kommt an; ohne Sitzung/Origin nichts', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/krypto/muster' })).statusCode).toBe(401);
    const s = await d.app.inject({ url: '/api/krypto/muster', headers: h });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ modell: { version: 3, aktiv: true }, rl: { episoden: 4000 } });
    expect(k.anfragen[0]).toMatchObject({ methode: 'GET', pfad: '/muster', auth: `Bearer ${G}` });
    expect((await d.app.inject({ method: 'POST', url: '/api/krypto/muster/training', headers: { cookie: h.cookie } })).statusCode).toBe(403); // ohne Origin
    expect(k.anfragen.filter((a) => a.pfad === '/muster/training')).toHaveLength(0);
    const t = await d.app.inject({ method: 'POST', url: '/api/krypto/muster/training', headers: h });
    expect(t.json()).toEqual({ ok: true });
    const doppelt = await d.app.inject({ method: 'POST', url: '/api/krypto/muster/training', headers: h });
    expect(doppelt.statusCode).toBe(409);
    expect(doppelt.json().fehler).toContain('läuft schon');
    // ohne Kryptowerk: sauberer Fehler
    const aus = await testDorf();
    expect((await aus.app.inject({ url: '/api/krypto/muster', headers: await kopf(aus) })).statusCode).toBe(503);
  });
});

describe('hafen_muster und RL-Bots für Agenten (E235)', () => {
  it('Leine: nur mit werkzeuge: [hafen]; kein Weg zum Scharfschalten', () => {
    expect(werkzeugprofil({ werkzeuge: [], fremdinhalte: false }).dorf).not.toContain('hafen_muster');
    expect(werkzeugprofil({ werkzeuge: ['hafen'], fremdinhalte: false }).dorf).toContain('hafen_muster');
    expect(Object.keys(WERKZEUG_DEFINITIONEN)).toContain('hafen_muster');
    const def = WERKZEUG_DEFINITIONEN.hafen_muster as { input_schema: { properties: Record<string, unknown> } };
    expect(Object.keys(def.input_schema.properties)).toEqual(['training']);
  });

  it('Status als Text, Training starten, „läuft schon“ freundlich; ohne Hafen-Werkzeug verweigert', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const t = await lauf(d, [w('hafen_muster', {}), w('hafen_muster', { training: true }), w('hafen_muster', { training: true }), w('hafen_muster', {})]);
    expect(t[0]).toContain('Modell v3');
    expect(t[0]).toContain('AKTIV');
    expect(t[0]).toContain('AUC 0,612 (0,5 = Raten)');
    expect(t[0]).toContain('Präzision bei p ≥ 0,6 31 % vs. Basisrate 17 %');
    expect(t[0]).toContain('kaufVerhaeltnis60s 21 %');
    expect(t[0]).toContain('Zeitraffer auf den Testdaten: 57 Trades, 0.840 SOL nach Gebühren');
    expect(t[0]).toContain('1204000 Ticks von 3100 Tokens');
    expect(t[0]).toContain('besser als Raten (0,5)'); // Bericht
    expect(t[1]).toMatch(/Training gestartet/);
    expect(t[2]).toMatch(/läuft schon/);
    expect(t[2]).not.toMatch(/verweigert/);
    expect(t[3]).toMatch(/läuft \(40 %\)/);
    expect(k.anfragen.filter((a) => a.pfad === '/muster/training')).toHaveLength(2);
    expect(k.anfragen.every((a) => !/scharf|auszahlen|entschaerfen/.test(a.pfad))).toBe(true);
    const ohne = await lauf(d, [w('hafen_muster', {})], '[vault_lesen]');
    expect(ohne[0]).toMatch(/nicht erlaubt/);
  });

  it('ohne Modell und ohne RL: ehrlich „noch keins“; inaktives Modell sagt es', () => {
    expect(musterText(status({ modell: null, rl: null, bericht: '' }))).toMatch(/Modell: noch keins trainiert\.\nRL-Agent: noch nicht trainiert\./);
    const inaktiv = status();
    inaktiv.modell!.aktiv = false;
    inaktiv.modell!.test = { beispiele: 150, auc: 0.51, praezision: null, basis: 0.2 };
    expect(musterText(inaktiv)).toMatch(/NICHT aktiv – gibt keinen Rat/);
    expect(musterText(inaktiv)).toMatch(/Präzision bei p ≥ 0,6 – \(kein Beispiel/);
  });

  it('RL-Bot anlegen (Standard-Grenzen), höchstens einer; Grenzen nachstellen; Nachschuss im Kennzahlen-Text', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const t = await lauf(d, [
      w('hafen_bot_anlegen', { einstellung: { name: 'HM Muster-RL', avatar: '🧠', art: 'rl' } }),
      w('hafen_bot_anlegen', { einstellung: { name: 'HM Muster-RL 2', art: 'rl', rl: { minSicherheit: 0.7 } } }),
      w('hafen_bot_aendern', { bot: 'HM Muster-RL', einstellung: { rl: { minSicherheit: 0.65 } } }),
      w('hafen_bot_anlegen', { einstellung: { name: 'HM Regeln', regeln: { musterGewicht: 10 } } }),
      w('hafen_backtest', { bot: 'HM Muster-RL' }),
    ]);
    expect(t[0]).toMatch(/🧠 HM Muster-RL angelegt .* Paper Trading/);
    expect(t[1]).toMatch(/\(verweigert\).*Schon 1 eigener RL-Bot/);
    expect(t[2]).toMatch(/HM Muster-RL geändert \(rl\)/);
    expect(t[3]).toMatch(/HM Regeln angelegt/);
    expect(t[4]).toMatch(/\(verweigert\).*nur für Regel-Bots.*Zeitraffer/);
    expect(HAFEN_AGENT_MAX_RL).toBe(1);
    expect(k.bots).toHaveLength(2);
    const rl = k.bots[0]!.einstellung;
    expect(rl.art).toBe('rl');
    expect(rl.rl).toEqual({ ...KRYPTO_RL_STANDARD, minSicherheit: 0.65 }); // Feld für Feld zusammengeführt (E236: samt maxAbsturz)
    expect(k.bots[1]!.einstellung.regeln).toEqual({ ...KRYPTO_STANDARD.regeln, musterGewicht: 10 });
    expect(k.bots[1]!.einstellung.rl).toBeUndefined();
    expect(agentenBots(d.db)).toHaveLength(2);
    // nie ein Modus außer Paper
    expect(k.anfragen.filter((a) => a.pfad === '/bots' && a.methode === 'POST').every((a) => !('modus' in ((a.body as { einstellung: object }).einstellung ?? {})) || (a.body as { einstellung: { modus?: string } }).einstellung.modus !== 'live')).toBe(true);
    // Nachschuss: Lehrgeld, nie Gewinn
    k.bots[0]!.kennzahlen = { ...KENNZAHLEN, kapitalSol: 4.2, startSol: 20, nachschussSol: 10, nachschuesse: 1 } as never;
    const u = await lauf(d, [w('hafen_uebersicht', {})]);
    expect(u[0]).toContain('HM Muster-RL · 00000000-0000-4000-8000-000000000001 · RL (Muster-Modell) · paper');
    expect(u[0]).toContain('Nachschuss 10.000 SOL in 1 Schüben – zählt nicht als Gewinn');
  });
});

describe('Vorlage Muster-Meister (E235)', () => {
  it('Aktion wird fehlerfrei gelesen, Zeitplan fünfmal am Tag; Logbuch liegt bereit; Hafenmeister erwähnt das Modell', async () => {
    const d = await testDorf();
    const a = await aktionLaden(d.vault, 'Hafen/muster-meister');
    expect(a?.fehler).toBeUndefined();
    expect(a).toMatchObject({ name: 'Muster-Meister', motor: 'claude-code', zeitplan: 'täglich 00:35, 05:35, 10:35, 15:35, 20:35', ablage: 'Hafen/00_Musterbericht.md', fremdinhalte: true });
    expect(a?.werkzeuge).toEqual(expect.arrayContaining(['vault_lesen', 'vault_suchen', 'vault_schreiben', 'hafen']));
    const z = zeitplanLesen(a!.zeitplan!);
    expect(z.tage.size).toBe(7);
    expect(z.zeiten).toEqual([{ h: 0, m: 35 }, { h: 5, m: 35 }, { h: 10, m: 35 }, { h: 15, m: 35 }, { h: 20, m: 35 }]);
    expect(await d.vault.existiert('Hafen/muster-logbuch.md')).toBe(true);
    const text = (await d.vault.lesen('Hafen/aktionen/muster-meister.md')).inhalt;
    expect(text).toContain('hafen_muster');
    expect(text).toContain('HM Muster-RL');
    expect(text).toContain('## Für die Zeitung');
    expect(text).toMatch(/musterGewicht.*nie/);
    expect((await d.vault.lesen('Hafen/aktionen/hafenmeister.md')).inhalt).toContain('Hafen/00_Musterbericht.md');
  });
});
