import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import { kryptoServer } from '../src/krypto/server.js';
import { BUERGERMEISTER_WERKZEUGE, HELFER_FAEHIGKEITEN, werkzeugprofil } from '../src/agenten/leine.js';
import { HAFEN_WERKZEUGE } from '../src/agenten/leine-hafen.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { agentenBots, einstellungZusammenfuehren, HAFEN_AGENT_MAX_BOTS, HAFEN_FLOTTE_MAX } from '../src/agenten/werkzeuge-hafen.js';
import { testDorf } from './hilfen.js';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { tagIn, tagPlus } from '../src/zeit.js';

/**
 * E231: Hafen-Werkzeuge für Agenten – gegen ein ECHTES Kryptowerk (Motor + HTTP-Server, Speicher-DB), angesprochen über
 * dieselbe Durchreiche wie Leifs Klicks. Geprüft: nur Paper, Live-Bots unantastbar, kein Weg zu scharf/auszahlen/Wallet.
 */
const G = 'g'.repeat(40);
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

function kryptowerk() {
  const uhr = new TestUhr();
  const db = kryptoDb(':memory:');
  const werk = new Kryptowerk({ db, uhr, dex: { async paare() { return { schnappschuesse: [], solUsd: 140 }; } } as never, rug: { bereit: () => true } as never });
  const app = kryptoServer(werk, G);
  const pfade: string[] = [];
  const holen = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    pfade.push(`${init.method ?? 'GET'} ${u.pathname}`);
    const r = await app.inject({ method: (init.method ?? 'GET') as 'GET', url: u.pathname + u.search, headers: Object.fromEntries(new Headers(init.headers).entries()), ...(init.body ? { payload: String(init.body) } : {}) });
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { werk, db, holen, pfade };
}

async function lauf(d: Awaited<ReturnType<typeof testDorf>>, zeilen: string[], werkzeuge = '[vault_lesen, hafen]') {
  fs.writeFileSync(path.join(d.vault.wurzel, 'Hafen/aktionen/test.md'), `---\nname: test\nwerkzeuge: ${werkzeuge}\n---\n${zeilen.join('\n')}\n`);
  const r = await d.agenten.aktionStarten('Hafen/test', {});
  await d.agenten.leerlauf();
  return d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
}

describe('Hafen-Werkzeuge: Leine (E231)', () => {
  it('nur mit werkzeuge: [hafen], als Helfer-Fähigkeit und für den Bürgermeister; nichts zum Scharfschalten/Auszahlen', () => {
    expect(werkzeugprofil({ werkzeuge: [], fremdinhalte: false }).dorf.some((n) => n.startsWith('hafen_'))).toBe(false);
    expect(werkzeugprofil({ werkzeuge: ['hafen'], fremdinhalte: false }).dorf).toEqual(expect.arrayContaining([...HAFEN_WERKZEUGE]));
    expect(HELFER_FAEHIGKEITEN).toContain('hafen');
    expect(BUERGERMEISTER_WERKZEUGE).toEqual(expect.arrayContaining([...HAFEN_WERKZEUGE]));
    const alle = Object.keys(WERKZEUG_DEFINITIONEN);
    expect(alle.filter((n) => /scharf|auszahl|wallet|schluessel|export|entschaerf|aufheben/.test(n) && n.startsWith('hafen'))).toEqual([]);
    expect(alle.filter((n) => n.startsWith('hafen') && /loeschen/.test(n))).toEqual(['hafen_bot_loeschen']); // nur eigene Paper-Bots (unten geprüft)
    expect(alle.filter((n) => n.startsWith('hafen_')).sort()).toEqual([...HAFEN_WERKZEUGE].sort());
  });

  it('Teil-Einstellungen: Unterobjekte Feld für Feld, takeProfit als ganze Liste', () => {
    const e = einstellungZusammenfuehren(KRYPTO_STANDARD, { name: 'Hai', filter: { minAlterSek: 30 }, ausstieg: { takeProfit: [{ beiProzent: 30, verkaufProzent: 50 }] } }) as unknown as typeof KRYPTO_STANDARD;
    expect(e.name).toBe('Hai');
    expect(e.filter.minAlterSek).toBe(30);
    expect(e.filter.maxRugScore).toBe(KRYPTO_STANDARD.filter.maxRugScore);
    expect(e.ausstieg.takeProfit).toEqual([{ beiProzent: 30, verkaufProzent: 50 }]);
    expect(e.ausstieg.stopLossProzent).toBe(KRYPTO_STANDARD.ausstieg.stopLossProzent);
    expect(KRYPTO_STANDARD.name).toBe('Neuer Bot'); // Vorgabe bleibt unverändert
  });
});

describe('Hafen-Werkzeuge gegen das echte Kryptowerk (E231)', () => {
  it('anlegen (Paper, pausiert), lesen, ändern, Status, Rückgängig – Live-Bots unantastbar', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const t = await lauf(d, [
      w('hafen_bot_anlegen', { einstellung: { name: 'Lotse', avatar: '🧭', art: 'prompt', prompt: 'Kaufe nur bei breitem Kaufdruck und sauberem RugCheck.', minSicherheit: 0.7, limits: { maxOffen: 2 } }, starten: false }),
      w('hafen_bot_anlegen', { einstellung: { name: 'Kaputt', filter: { minAlterSek: 5000, maxAlterSek: 100 } } }),
      w('hafen_bot_anlegen', { einstellung: { name: 'Schmuggel', modus: 'live' } }),
      w('hafen_uebersicht', {}),
      w('hafen_bot_aendern', { bot: 'Lotse', einstellung: { ausstieg: { stopLossProzent: 15 } } }),
      w('hafen_bot_status', { bot: 'Lotse', status: 'laeuft' }),
      w('hafen_bot_lesen', { bot: 'lotse' }),
      w('hafen_bot_aendern', { bot: 'Gibtsnicht', einstellung: {} }),
    ]);
    expect(t[0]).toMatch(/^hafen_bot_anlegen: 🧭 Lotse angelegt \(Kennung [0-9a-f-]{36}\) – Paper Trading, pausiert/);
    expect(t[1]).toMatch(/^hafen_bot_anlegen: \(verweigert\).*Mindestalter muss kleiner als Höchstalter/);
    // ein eingeschmuggeltes „modus“ wird verworfen – auch dieser Bot ist Paper
    expect(t[2]).toMatch(/Schmuggel angelegt .* Paper Trading/);
    expect(t[3]).toMatch(/Lotse · [0-9a-f-]{36} · Prompt · paper · pausiert/);
    expect(t[4]).toMatch(/Lotse geändert \(ausstieg\)/);
    expect(t[5]).toMatch(/Lotse: läuft/);
    expect(t[6]).toContain('"stopLossProzent": 15');
    expect(t[6]).toContain('"maxOffen": 2');
    expect(t[6]).toContain('<fremdinhalt quelle="hafen">');
    expect(t[7]).toMatch(/\(verweigert\).*Keinen Bot „Gibtsnicht“/);
    const ueb = k.werk.uebersicht();
    expect(ueb.bots.map((b) => [b.einstellung.name, b.modus])).toEqual(expect.arrayContaining([['Lotse', 'paper'], ['Schmuggel', 'paper']]));
    const lotse = ueb.bots.find((b) => b.einstellung.name === 'Lotse')!;
    expect(lotse.einstellung.ausstieg.stopLossProzent).toBe(15);

    // Rückgängig: Änderung zurück, Anlegen = Bot wieder weg
    const r = d.agenten.rueckgaengig.liste();
    const aenderung = r.find((x) => x.art === 'hafen_bot_geaendert')!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(aenderung.id)).status).toBe('zurueckgenommen');
    expect(k.werk.uebersicht().bots.find((b) => b.id === lotse.id)!.einstellung.ausstieg.stopLossProzent).toBe(KRYPTO_STANDARD.ausstieg.stopLossProzent);
    const schmuggel = r.find((x) => x.titel.includes('Schmuggel'))!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(schmuggel.id)).status).toBe('zurueckgenommen');
    expect(k.werk.uebersicht().bots.some((b) => b.einstellung.name === 'Schmuggel')).toBe(false);

    // Lotse wird (von Leif) scharf geschaltet → Agenten kommen nicht mehr an ihn heran
    k.db.prepare("UPDATE bots SET modus = 'live' WHERE id = ?").run(lotse.id);
    const vorher = JSON.stringify(k.werk.uebersicht().bots.find((b) => b.id === lotse.id)!.einstellung);
    const t2 = await lauf(d, [w('hafen_bot_aendern', { bot: lotse.id, einstellung: { limits: { einsatzProTradeSol: 50 } } }), w('hafen_bot_status', { bot: 'Lotse', status: 'pausiert' })]);
    expect(t2[0]).toMatch(/\(verweigert\).*LIVE.*nur Leif/);
    expect(t2[1]).toMatch(/\(verweigert\).*LIVE.*nur Leif/);
    expect(JSON.stringify(k.werk.uebersicht().bots.find((b) => b.id === lotse.id)!.einstellung)).toBe(vorher);
    expect(k.werk.uebersicht().bots.find((b) => b.id === lotse.id)!.status).toBe('laeuft');
    // … und auch Leifs „Rückgängig“ einer älteren Paper-Änderung fasst einen inzwischen scharfen Bot nicht an
    const anlegen = d.agenten.rueckgaengig.liste().find((x) => x.titel.includes('„Lotse“ angelegt'))!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(anlegen.id)).status).toBe('fehlgeschlagen'); // Kryptowerk: erst entschärfen
    expect(k.werk.uebersicht().bots.some((b) => b.id === lotse.id)).toBe(true);
    // nie ein Aufruf an scharf/entschärfen/auszahlen
    expect(k.pfade.filter((p) => /scharf|entschaerfen|auszahlen/.test(p))).toEqual([]);
  });

  it('Hafenmeister: eigene Bots löschen ja, Leifs nie; höchstens 6 eigene, 2 Prompt-Bots', async () => {
    const k = kryptowerk();
    const leif = k.werk.anlegen({ ...KRYPTO_STANDARD, name: 'Test Bot Standart' });
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const prompt = (n: string) => ({ einstellung: { name: n, art: 'prompt', prompt: 'Kaufe nur bei breitem Kaufdruck.' } });
    const t = await lauf(d, [
      ...Array.from({ length: HAFEN_AGENT_MAX_BOTS }, (_, i) => w('hafen_bot_anlegen', i < 2 ? prompt(`HM G1-${i}`) : { einstellung: { name: `HM G1-${i}` } })),
      w('hafen_bot_anlegen', { einstellung: { name: 'HM G1-zuviel' } }),
      w('hafen_uebersicht', {}),
      w('hafen_bot_loeschen', { bot: 'Test Bot Standart', grund: 'schwach' }),
      w('hafen_bot_loeschen', { bot: 'HM G1-0', grund: 'Prompt-Bot verliert nach Gebühren' }),
      w('hafen_bot_anlegen', prompt('HM G2-A')),
      w('hafen_bot_loeschen', { bot: 'HM G1-2', grund: 'zu wenig Kaufdruck' }),
      w('hafen_bot_anlegen', prompt('HM G2-B')),
      w('hafen_bot_anlegen', { einstellung: { name: 'HM G2-B', filter: { minAlterSek: 90 } } }),
      w('hafen_bot_anlegen', { einstellung: { name: 'HM G2-C' } }),
    ]);
    expect(t.slice(0, HAFEN_AGENT_MAX_BOTS).every((x) => /angelegt/.test(x))).toBe(true);
    expect(t[6]).toMatch(/\(verweigert\).*schon 6 eigene Bots/);
    expect(t[7]).toMatch(/Test Bot Standart · [0-9a-f-]{36} · Regeln · paper · laeuft · Leifs Bot/);
    expect(t[7]).toMatch(/HM G1-0 · .* · 🤖 Agent/);
    expect(t[8]).toMatch(/\(verweigert\).*Leifs Bot – löschen darf ihn nur Leif/);
    expect(t[9]).toMatch(/HM G1-0 gelöscht \(0 Trades.*Prompt-Bot verliert/);
    expect(t[10]).toMatch(/HM G2-A angelegt/); // wieder ein Platz frei (2 Prompt-Bots: G1-1 + G2-A)
    expect(t[11]).toMatch(/HM G1-2 gelöscht/);
    expect(t[12]).toMatch(/\(verweigert\).*Schon 2 eigene Prompt-Bots/);
    expect(t[13]).toMatch(/HM G2-B angelegt/);
    expect(t[14]).toMatch(/\(verweigert\).*schon 6 eigene Bots/);
    expect(k.werk.uebersicht().bots.some((b) => b.id === leif.id)).toBe(true);
    expect(agentenBots(d.db)).toHaveLength(HAFEN_AGENT_MAX_BOTS);
    // ein scharfer eigener Bot lässt sich auch nicht löschen
    const g11 = k.werk.uebersicht().bots.find((b) => b.einstellung.name === 'HM G1-1')!;
    k.db.prepare("UPDATE bots SET modus = 'live' WHERE id = ?").run(g11.id);
    expect((await lauf(d, [w('hafen_bot_loeschen', { bot: g11.id, grund: 'weg' })]))[0]).toMatch(/\(verweigert\).*LIVE/);
  });

  it('Not-Aus: zieht das Kryptowerk, Leif bekommt Meldung + Rückgängig (= aufheben); Grenze der Flotte', async () => {
    const k = kryptowerk();
    for (let i = 0; i < HAFEN_FLOTTE_MAX; i++) k.werk.anlegen({ ...KRYPTO_STANDARD, name: `Bot ${i}` });
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const gemeldet: string[] = [];
    d.agenten.rueckgaengig.beiNeu.push((r) => {
      gemeldet.push(r.titel);
    });
    const t = await lauf(d, [w('hafen_bot_anlegen', { einstellung: { name: 'Neunter' } }), w('hafen_notaus', { grund: 'Daten seit 20 Minuten offline' })]);
    expect(t[0]).toMatch(/\(verweigert\).*schon 12 Bots/);
    expect(t[1]).toMatch(/Not-Aus gezogen: alle 12 Bots gestoppt/);
    expect(k.werk.uebersicht().notaus).toBe(true);
    expect(k.werk.uebersicht().bots.every((b) => b.status === 'gestoppt')).toBe(true);
    expect(gemeldet).toEqual(['Hafen: NOT-AUS gezogen – Daten seit 20 Minuten offline']);
    const r = d.agenten.rueckgaengig.liste().find((x) => x.art === 'hafen_notaus')!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(r.id)).status).toBe('zurueckgenommen');
    expect(k.werk.uebersicht().notaus).toBe(false);
  });

  it('Backtest nur für Regel-Bots; ohne Hafen-Werkzeug kein Zugriff; ohne Kryptowerk sauberer Fehler', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const t = await lauf(d, [w('hafen_backtest', { einstellung: { art: 'prompt', prompt: 'Nur bei starkem Volumen kaufen bitte.' } })]);
    expect(t[0]).toMatch(/\(verweigert\).*nur für Regel-Bots/);
    const ohne = await lauf(d, [w('hafen_uebersicht', {})], '[vault_lesen]');
    expect(ohne[0]).toMatch(/nicht erlaubt/);
    const aus = await testDorf();
    const t3 = await lauf(aus, [w('hafen_uebersicht', {})]);
    expect(t3[0]).toMatch(/\(verweigert\).*nicht eingerichtet/);
  });
});

describe('Hafenmeister → Morgenzeitung (E231)', () => {
  it('Aktion gültig; „⚓ Hafen“ nur mit dem Bericht von heute', async () => {
    const d = await testDorf();
    const a = await aktionLaden(d.vault, 'Hafen/hafenmeister');
    expect(a).toMatchObject({ zeitplan: 'täglich 06:05', ablage: 'Hafen/00_Flottenbericht.md', werkzeuge: expect.arrayContaining(['hafen']) });
    expect(a?.fehler).toBeUndefined();
    const heute = tagIn(d.uhr.jetzt());
    const bericht = (tag: string) => `---\ntag: ${tag}\n---\n## Für die Zeitung\nHai liegt nach Gebühren vorne (+0,8 SOL, 34 Trades).\n\n## Im Detail\n| Bot | … |\n`;
    fs.writeFileSync(path.join(d.vault.wurzel, 'Hafen/00_Flottenbericht.md'), bericht(tagPlus(heute, -1)));
    expect((await d.morgenzeitung.fakten()).abschnitte.some((x) => x.titel === '⚓ Hafen')).toBe(false);
    fs.writeFileSync(path.join(d.vault.wurzel, 'Hafen/00_Flottenbericht.md'), bericht(heute));
    const z = (await d.morgenzeitung.fakten()).abschnitte.find((x) => x.titel === '⚓ Hafen');
    expect(z?.zeilen).toEqual(['Hai liegt nach Gebühren vorne (+0,8 SOL, 34 Trades).']);
  });
});
