import { z } from 'zod';
import { KRYPTO_MUSTER_MODELLE, KRYPTO_RL_STANDARD, KRYPTO_STANDARD, type KryptoBacktest, type KryptoBot, type KryptoEinstellung, type KryptoKennzahlen, type KryptoMusterModellInfo, type KryptoMusterStatus, type KryptoTerminal, type KryptoUebersicht } from '@dorf/shared';
import type { DB } from '../db.js';
import { DorfFehler } from '../fehler.js';
import type { Hafen } from '../krypto-dorf.js';
import { fremdinhaltHuelle } from './leine.js';
import type { HafenWerkzeug } from './leine-hafen.js';
import type { RueckgaengigArt } from './rueckgaengig.js';
import type { WerkzeugAufrufErgebnis, WerkzeugDefinition } from './werkzeuge.js';

/**
 * E231 – Hafen-Werkzeuge für Agenten (Leifs Entscheidung: Paper-Bots direkt mit „Rückgängig“, Not-Aus ja).
 *
 * Erlaubt: Flotte und Bots lesen, Paper-Bots anlegen/ändern/starten/pausieren, Backtests, Not-Aus ziehen, und – nur
 * die EIGENEN Paper-Bots (von einem Agenten angelegt, gemerkt in dorf_stand) – löschen (Hafenmeister, Leifs Wunsch).
 * NIE (fest im Code, es gibt dafür kein Werkzeug): scharf schalten, entschärfen, auszahlen, Wallets/Schlüssel, Leifs Bots
 * löschen, Not-Aus aufheben, Live-Bots ändern oder starten/pausieren.
 * Bot-Einstellungen prüft das Kryptowerk (Zod, strict) – genau wie bei Leifs Klick.
 */

/** So viele EIGENE Bots dürfen Agenten zugleich haben (Leifs Bots zählen nicht) – davon höchstens so viele Prompt-Bots
 * (die kosten je bis 0,50 $/Tag); dazu eine Obergrenze für die ganze Flotte */
export const HAFEN_AGENT_MAX_BOTS = 6;
export const HAFEN_AGENT_MAX_PROMPT = 2;
/** E235: höchstens ein eigener RL-Bot (handelt nach Muster-Modell + RL-Agent, nur Paper) */
export const HAFEN_AGENT_MAX_RL = 1;
export const HAFEN_FLOTTE_MAX = 12;
const AGENTENBOTS = 'hafen_agentenbots';

const EINSTELLUNG_BESCHREIBUNG =
  'Teil-Einstellung – nur was vom Standard (anlegen) bzw. vom jetzigen Stand (ändern) abweicht. Felder: name (≤ 40), avatar (ein Emoji), art ("regeln" | "prompt" | "rl"), prompt (Strategie in Worten, ≤ 4000, nur art prompt), startkapitalSol (Paper-Spielgeld, Standard 10), minSicherheit (0–1, Prompt-Bots), regeln: {minPunkte 0–100, musterGewicht 0–30 (so viele Punkte darf der Rat des Muster-Modells beisteuern; 0 = nur anzeigen, Standard; > 0 heißt auch: sieht der aktive Absturz-Erkenner ≥ 70 %, verkauft auch ein Regel-/Prompt-Bot sofort)}, rl: {minSicherheit 0–1 (Kauf erst ab dieser Wahrscheinlichkeit des Muster-Modells – oder bei Pump-Signal ≥ 0,3), erkunden 0–0,3 (Anteil zufälliger Handlungen zum Lernen), nachschuss true/false (frisches Paper-Spielgeld nach Pleite – zählt nie als Gewinn), maxAbsturz 0–1 (kein Kauf, wenn der Absturz-Erkenner mindestens so viel sieht; Standard 0,35; gehalten ab 0,7 immer sofort raus)} – nur art rl, RL-Bots handeln nur Paper, filter: {maxRugScore, keineGefahr, minVolumenUsdM5, minKaeufeM5, minKaufVerhaeltnis, minAlterSek, maxAlterSek, minMarketCapUsd, maxMarketCapUsd, maxDevProzent, maxDevTokens24h (andere Tokens desselben Erstellers in 24 h), minEchtzeitKaufVerhaeltnis (Käufe÷Verkäufe der letzten 60 s aus dem Echtzeit-Strom, 0 = aus), maxTopHalterProzent, minLiquiditaetSol}, limits: {einsatzProTradeSol, positionProzent, maxTagesverlustSol, maxOffen, maxLlmProTag}, ausstieg: {takeProfit: [{beiProzent, verkaufProzent}] (ersetzt die ganze Liste), stopLossProzent, trailingProzent, maxHaltMinuten, notausEinzelverkaufProzent (sofort raus, wenn EIN Verkauf die Liquidität um so viel % senkt, 0 = aus)}, simulation: {verzoegerungMs ≥ 300, prioritaetSol, fehlschlagProzent, portalGebuehrProzent}, slippageProzent. Unterobjekte werden Feld für Feld zusammengeführt.';

export const HAFEN_DEFINITIONEN: Record<HafenWerkzeug, Omit<WerkzeugDefinition, 'name'> & { name: HafenWerkzeug }> = {
  hafen_uebersicht: {
    name: 'hafen_uebersicht',
    description:
      'Die Flotte im Hafen (Krypto-Bots für Pump.fun): jeder Bot mit Kennung, Art, Modus (paper/LIVE), Status und Kennzahlen NACH Gebühren (Gewinn, Trefferquote, max. Drawdown, Trades, Umsatz, Gebühren, heute), dazu Not-Aus und Datenlage. Nur lesen.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  hafen_bot_lesen: {
    name: 'hafen_bot_lesen',
    description:
      'Ein Bot genau: alle Einstellungen (Filter, Regeln/Prompt, Limits, Ausstieg, Simulation), Kennzahlen, offene Positionen, die letzten Trades (mit Grund, Gebühr, Slippage, Gewinn) und Entscheidungen (buy/hold/block mit Grund). Zum Auswerten, WARUM ein Bot gewinnt oder verliert. Token-Namen und Gründe stammen teils von außen (Fremdinhalt).',
    input_schema: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Kennung (UUID) oder genauer Name des Bots' },
        anzahl: { type: 'integer', minimum: 1, maximum: 60, description: 'Wie viele Trades/Entscheidungen (Standard 25)' },
      },
      required: ['bot'],
      additionalProperties: false,
    },
  },
  hafen_bot_anlegen: {
    name: 'hafen_bot_anlegen',
    description: `Neuen Bot anlegen – IMMER im Paper Trading (Spielgeld, echte Marktdaten, Gebühren/Slippage/Verzögerung simuliert). Er läuft sofort (starten: false = pausiert). Leif bekommt „Rückgängig“. Prompt-Bots kosten LLM-Geld (höchstens 0,50 $ je Bot und Tag). Agenten haben höchstens ${HAFEN_AGENT_MAX_BOTS} eigene Bots, davon höchstens ${HAFEN_AGENT_MAX_PROMPT} Prompt-Bots und ${HAFEN_AGENT_MAX_RL} RL-Bot (art "rl": handelt nach Muster-Modell + RL-Agent).`,
    input_schema: {
      type: 'object',
      properties: {
        einstellung: { type: 'object', description: EINSTELLUNG_BESCHREIBUNG },
        starten: { type: 'boolean', description: 'Sofort laufen lassen (Standard: ja)' },
      },
      required: ['einstellung'],
      additionalProperties: false,
    },
  },
  hafen_bot_aendern: {
    name: 'hafen_bot_aendern',
    description:
      'Einstellungen eines PAPER-Bots ändern (Live-Bots nie – die ändert nur Leif). Das Startkapital lässt sich nach dem ersten Trade nicht mehr ändern. Leif bekommt „Rückgängig“ (alte Einstellung zurück). Tipp: Für einen sauberen Vergleich lieber einen zweiten Bot anlegen als einen laufenden umbauen.',
    input_schema: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Kennung (UUID) oder genauer Name' },
        einstellung: { type: 'object', description: EINSTELLUNG_BESCHREIBUNG },
      },
      required: ['bot', 'einstellung'],
      additionalProperties: false,
    },
  },
  hafen_bot_status: {
    name: 'hafen_bot_status',
    description: 'Einen PAPER-Bot laufen lassen oder pausieren (pausiert kauft er nichts Neues; offene Positionen verkauft er weiter nach Ausstiegsregeln). Live-Bots nur Leif.',
    input_schema: {
      type: 'object',
      properties: { bot: { type: 'string', description: 'Kennung oder Name' }, status: { type: 'string', enum: ['laeuft', 'pausiert'] } },
      required: ['bot', 'status'],
      additionalProperties: false,
    },
  },
  hafen_backtest: {
    name: 'hafen_backtest',
    description:
      'Backtest einer REGEL-Strategie über die aufgezeichneten Marktdaten (dieselbe Maschine wie Paper; Prompt-Bots gehen nicht). Starten: bot (dessen Einstellung) und/oder einstellung (Teil-Einstellung, wird darüber gelegt), optional stunden (wie weit zurück). Ergebnis abfragen: nur id angeben (Backtests dauern Sekunden bis Minuten). Ohne alles: Liste der letzten Backtests und Datenbereich.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Kennung eines gestarteten Backtests (nur zum Abfragen)' },
        bot: { type: 'string', description: 'Kennung oder Name eines Bots als Grundlage' },
        einstellung: { type: 'object', description: EINSTELLUNG_BESCHREIBUNG },
        stunden: { type: 'number', description: 'Zeitraum in Stunden ab heute zurück (0,2–720; Standard: alle Aufzeichnungen)' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  hafen_bot_loeschen: {
    name: 'hafen_bot_loeschen',
    description: `Einen EIGENEN Paper-Bot löschen – nur Bots, die ein Agent angelegt hat (in hafen_uebersicht mit „🤖 Agent“ markiert), nie Leifs Bots, nie Live-Bots. Trades und Kurve sind danach weg: vorher das Wichtigste ins Logbuch schreiben. Nicht zurücknehmbar.`,
    input_schema: { type: 'object', properties: { bot: { type: 'string', description: 'Kennung oder Name' }, grund: { type: 'string', description: 'Ein Satz: warum (≤ 200)' } }, required: ['bot', 'grund'], additionalProperties: false },
  },
  hafen_muster: {
    name: 'hafen_muster',
    description:
      'Das Muster-Modell im Hafen (E235/E236): mehrere Modelle aus denselben Echtzeit-Tick-Merkmalen – Grundsignal (erst +Ziel, bevor −Stop), 🚀 Pump- und 💥 Absturz-Erkenner (2 min), Ausblick Hoch/Tief in 1 und 5 min (%), Früh-Modelle für Tokens ≤ 90 s; jedes eigens ehrlich getestet und nur aktiv, wenn klar besser als Raten bzw. als der Median. Dazu ein RL-Agent, der mit allen aktiven Signalen im Zeitraffer über die Aufzeichnungen übt. Ohne Eingabe: Stand als Text – je Modell aktiv/nicht aktiv mit Gründen, Test-AUC (0,5 = Raten) bzw. Fehler vs. Median, Präzision vs. Basisrate, wichtigste Merkmale, Zeitraffer, Datenlage, letztes/nächstes Training, Bericht. Mit {"training": true}: startet sofort ein Training (dauert Minuten; läuft schon eines, passiert nichts). Nur lesen bzw. Training anstoßen.',
    input_schema: { type: 'object', properties: { training: { type: 'boolean', description: 'true = jetzt ein Training starten' } }, required: [], additionalProperties: false },
  },
  hafen_notaus: {
    name: 'hafen_notaus',
    description:
      'NOT-AUS für den ganzen Hafen: alle Bots stoppen sofort, offene Positionen werden verkauft (bei Live-Bots echt). Nur, wenn etwas schiefläuft – z. B. ein Live-Bot verliert schnell, Daten sind kaputt, oder Leif sagt es. Leif bekommt sofort eine Meldung (App + Telegram) und kann den Not-Aus mit „Rückgängig“ aufheben; du selbst kannst ihn nicht aufheben.',
    input_schema: { type: 'object', properties: { grund: { type: 'string', description: 'Warum (ein Satz, ≤ 200 Zeichen)' } }, required: ['grund'], additionalProperties: false },
  },
};

export interface HafenUmgebung {
  hafen?: Hafen;
  db: DB;
  log(werkzeug: string, eingabe: unknown, ergebnis: string, erlaubt: boolean, pfad?: string, art?: string): void;
  fremd(): void;
  merken(art: RueckgaengigArt, titel: string, daten: unknown, leise?: boolean): Promise<void>;
}

const Teil = z.record(z.string(), z.unknown());
const UNTER = ['filter', 'regeln', 'limits', 'ausstieg', 'simulation', 'rl'] as const;

/** Teil-Einstellung über eine vollständige legen – Unterobjekte Feld für Feld, takeProfit als ganze Liste */
export function einstellungZusammenfuehren(basis: KryptoEinstellung, teil: Record<string, unknown>): Record<string, unknown> {
  const e: Record<string, unknown> = { ...structuredClone(basis), ...teil };
  for (const k of UNTER) {
    const t = teil[k];
    if (t && typeof t === 'object' && !Array.isArray(t)) e[k] = { ...(basis[k] as object), ...(t as object) };
  }
  return e;
}

const sol = (x: number) => `${x >= 0 ? '' : '−'}${Math.abs(x).toFixed(3)} SOL`;
const pz = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} %`;

function kennzahlenText(k: KryptoKennzahlen) {
  const tq = k.trefferquote == null ? '–' : `${Math.round(k.trefferquote * 100)} %`;
  const nachschuss = k.nachschussSol ? ` · Nachschuss ${k.nachschussSol.toFixed(3)} SOL in ${k.nachschuesse ?? 1} Schüben – zählt nicht als Gewinn` : '';
  return `Kapital ${k.kapitalSol.toFixed(3)} SOL (Start ${k.startSol}${nachschuss}) · Gewinn nach Gebühren ${sol(k.gewinnSol)} (${pz(k.gewinnProzent)}) · heute ${sol(k.heuteSol)} · ${k.trades} Trades (${k.gewonnen} gewonnen, ${k.verloren} verloren, Treffer ${tq}) · max. Drawdown ${k.maxDrawdownProzent.toFixed(1)} % · offen ${k.offen} · Umsatz ${k.umsatzSol.toFixed(2)} SOL · Gebühren ${k.gebuehrenSol.toFixed(4)} SOL (Pump ${k.gebuehrenArt.pumpSol.toFixed(4)}, PumpPortal ${k.gebuehrenArt.portalSol.toFixed(4)}, Netz ${k.gebuehrenArt.netzSol.toFixed(4)}) · geblockte Rugs ${k.geblockteRugs}${tageText(k)}`;
}

/** E234: Ergebnis je Tag – ein guter Tag ist Glück, mehrere Tage im Plus sind ein Muster */
function tageText(k: KryptoKennzahlen) {
  if (!k.tage?.length) return '';
  const plus = k.tage.filter((x) => x.gewinnSol > 0).length;
  return ` · Tage im Plus ${plus}/${k.tage.length} (${k.tage.map((x) => `${x.tag.slice(5)} ${sol(x.gewinnSol)}/${x.trades}T`).join(', ')})`;
}

/** Kennungen der Bots, die Agenten angelegt haben (nur die dürfen sie löschen) */
export function agentenBots(db: DB): string[] {
  const z = db.prepare('SELECT wert FROM dorf_stand WHERE schluessel = ?').get(AGENTENBOTS) as { wert: string } | undefined;
  try {
    const l = JSON.parse(z?.wert ?? '[]') as unknown;
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function agentenBotsSetzen(db: DB, ids: string[]) {
  db.prepare('INSERT INTO dorf_stand (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert').run(AGENTENBOTS, JSON.stringify([...new Set(ids)].slice(-200)));
}

function botZeile(b: KryptoBot, eigene: string[] = []) {
  const e = b.einstellung;
  const modus = b.modus === 'live' ? `LIVE (Budget ${b.live?.budgetSol ?? '?'} SOL)` : 'paper';
  return `- ${e.avatar} ${e.name} · ${b.id} · ${artText(e.art)} · ${modus} · ${b.status}${eigene.includes(b.id) ? ' · 🤖 Agent' : ' · Leifs Bot'} · seit ${b.abschnittSeit.slice(0, 16).replace('T', ' ')} UTC\n  ${kennzahlenText(b.kennzahlen)}`;
}

function artText(art: KryptoEinstellung['art']) {
  return art === 'prompt' ? 'Prompt' : art === 'rl' ? 'RL (Muster-Modell)' : 'Regeln';
}

const z3 = (x: number) => x.toFixed(3).replace('.', ',');
const ort = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '–');

const pzEins = (x: number) => `${(Math.round(x * 10) / 10).toString().replace('.', ',')}`;

/** E236: je Modell eine Zeile – aktiv oder nicht (mit Gründen), Test gegen Raten bzw. gegen den Median */
function modelleText(modelle: KryptoMusterModellInfo[]) {
  const zeilen = ['Modelle (je eigens getestet, nur aktive geben Rat):'];
  const sortiert = [...modelle].sort((a, b) => KRYPTO_MUSTER_MODELLE.findIndex((x) => x.schluessel === a.schluessel) - KRYPTO_MUSTER_MODELLE.findIndex((x) => x.schluessel === b.schluessel));
  for (const mo of sortiert) {
    const def = KRYPTO_MUSTER_MODELLE.find((x) => x.schluessel === mo.schluessel);
    const name = def?.name ?? mo.schluessel;
    const t = mo.test;
    const teile: string[] = [];
    if (def?.art === 'wert' || (t.auc == null && t.fehler != null)) {
      if (t.fehler != null) teile.push(`Fehler ±${pzEins(t.fehler)} %-Punkte vs. Median ±${t.fehlerBasis == null ? '–' : pzEins(t.fehlerBasis)}`);
    } else if (t.auc != null) {
      teile.push(`AUC ${z3(t.auc)} vs. 0,5 (Raten)${t.aucUntergrenze != null ? `, Untergrenze ${z3(t.aucUntergrenze)}` : ''}`);
      if (t.praezision != null && t.basis != null) teile.push(`Präzision ${Math.round(t.praezision * 100)} % vs. Basisrate ${Math.round(t.basis * 100)} %`);
      else if (t.basis != null) teile.push(`Basisrate ${Math.round(t.basis * 100)} %`);
    }
    teile.push(`Test ${t.beispiele} Beispiele/${t.tokens} Tokens`);
    const zustand = mo.aktiv ? 'AKTIV' : `nicht aktiv${mo.gruende.length ? ` (${mo.gruende.join('; ')})` : ''}`;
    zeilen.push(`- ${name} v${mo.version}: ${zustand} · ${teile.join(' · ')}`);
  }
  return zeilen;
}

/** E235: Stand des Muster-Modells als lesbarer Text (für Hafenmeister/Muster-Meister) */
export function musterText(m: KryptoMusterStatus) {
  const t = m.training;
  const zeilen = [
    `Muster-Modell · Ziel: erst +${m.ziel.zielProzent} %, bevor −${m.ziel.stopProzent} %, innerhalb ${m.ziel.horizontMin} min`,
    `Training: ${t.laeuft ? `läuft (${Math.round(t.fortschritt * 100)} %)` : 'ruht'} · letztes ${ort(t.letzter)} · nächstes ${ort(t.naechster)}${t.dauerMs != null ? ` · Dauer ${Math.round(t.dauerMs / 1000)} s` : ''}${t.fehler ? ` · Fehler: ${t.fehler}` : ''}`,
    `Daten: ${m.daten.ticks} Ticks von ${m.daten.tokens} Tokens (${ort(m.daten.von)} bis ${ort(m.daten.bis)})`,
  ];
  const mo = m.modell;
  if (!mo) zeilen.push('Modell: noch keins trainiert.');
  else {
    const praez = mo.test.praezision == null ? '– (kein Beispiel mit p ≥ 0,6)' : `${Math.round(mo.test.praezision * 100)} %`;
    zeilen.push(
      `Modell v${mo.version} (${ort(mo.trainiert)}): ${mo.aktiv ? 'AKTIV – gibt Rat' : 'NICHT aktiv – gibt keinen Rat (Test nicht klar besser als Raten)'}`,
      `Test (neueste, nie gesehene Daten): ${mo.test.beispiele} Beispiele · AUC ${z3(mo.test.auc)} (0,5 = Raten) · Präzision bei p ≥ 0,6 ${praez} vs. Basisrate ${Math.round(mo.test.basis * 100)} %`,
      `Gelernt aus ${mo.beispiele} Beispielen, ${Math.round(mo.positivAnteil * 100)} % positiv`,
      `Wichtigste Merkmale: ${mo.merkmale.slice(0, 5).map((x) => `${x.name} ${Math.round(x.wichtigkeit * 100)} %`).join(', ') || '–'}`,
    );
  }
  if (m.modelle?.length) zeilen.push('', ...modelleText(m.modelle), '');
  const rl = m.rl;
  if (!rl) zeilen.push('RL-Agent: noch nicht trainiert.');
  else {
    const z = rl.zeitraffer;
    zeilen.push(`RL-Agent v${rl.version} (${ort(rl.trainiert)}, ${rl.episoden} Episoden) · Zeitraffer auf den Testdaten: ${z.trades} Trades, ${sol(z.gewinnSol)} nach Gebühren, Treffer ${z.trefferquote == null ? '–' : `${Math.round(z.trefferquote * 100)} %`}, ${z.pleiten} Pleiten`);
  }
  if (m.bericht.trim()) zeilen.push('', 'Bericht:', m.bericht.trim().slice(0, 4000));
  return zeilen.join('\n');
}

function finden(u: KryptoUebersicht, ref: string): KryptoBot {
  const r = ref.trim();
  const b = u.bots.find((x) => x.id === r) ?? u.bots.filter((x) => x.einstellung.name.toLowerCase() === r.toLowerCase())[0];
  if (!b) throw new DorfFehler(404, `Keinen Bot „${r.slice(0, 60)}“ gefunden. Bots: ${u.bots.map((x) => `${x.einstellung.name} (${x.id})`).join(', ') || 'keine'}.`);
  const gleich = u.bots.filter((x) => x.einstellung.name.toLowerCase() === r.toLowerCase());
  if (b.id !== r && gleich.length > 1) throw new DorfFehler(409, `Mehrere Bots heißen „${r}“ – nimm die Kennung: ${gleich.map((x) => x.id).join(', ')}.`);
  return b;
}

function nurPaper(b: KryptoBot) {
  if (b.modus !== 'paper') throw new DorfFehler(403, `${b.einstellung.name} ist LIVE (echtes Geld) – Live-Bots ändert, startet und pausiert nur Leif in der App. Bei Gefahr: hafen_notaus.`);
}

function backtestText(j: KryptoBacktest) {
  const kopf = `Backtest ${j.id} · ${j.name} · ${j.status}${j.status === 'laeuft' ? ` (${Math.round(j.fortschritt * 100)} %)` : ''} · Daten ${j.von.slice(0, 16)} – ${j.bis.slice(0, 16)} UTC${j.daten ? ` · ${j.daten.tokens} Tokens, ${j.daten.kurse} Kurse` : ''}`;
  if (j.fehler) return `${kopf}\nFehler: ${j.fehler}`;
  if (!j.ergebnis) return `${kopf}\nNoch nicht fertig – später mit id abfragen.`;
  const r = j.ergebnis;
  return `${kopf}\n${kennzahlenText(r.kennzahlen)}\nEntscheidungen: ${r.entscheidungen.buy} buy, ${r.entscheidungen.hold} hold, ${r.entscheidungen.block} block\nHinweis: Vergangenheit ist kein Versprechen – Aufzeichnungen decken nur ab, was das Kryptowerk beobachtet hat.`;
}

export async function hafenAufrufen(name: HafenWerkzeug, eingabe: unknown, u: HafenUmgebung): Promise<WerkzeugAufrufErgebnis> {
  const h = u.hafen;
  if (!h?.eingerichtet) {
    const t = 'Der Hafen ist nicht eingerichtet (Kryptowerk fehlt).';
    u.log(name, eingabe, t, false);
    return { ok: false, text: t };
  }
  const flotte = () => h.anfrage<KryptoUebersicht>('GET', '/uebersicht');
  switch (name) {
    case 'hafen_uebersicht': {
      const f = await flotte();
      const text = [
        `Hafen: ${f.bots.length} Bots · Not-Aus ${f.notaus ? 'AKTIV' : 'aus'} · Daten ${f.datenOnline ? 'online' : 'OFFLINE'} · ${f.beobachtet} Tokens beobachtet${f.solUsd ? ` · 1 SOL ≈ ${f.solUsd.toFixed(2)} $` : ''} · Live ${f.liveMoeglich ? 'eingerichtet' : 'nicht eingerichtet'}`,
        ...f.bots.map((b) => botZeile(b, agentenBots(u.db))),
      ].join('\n');
      u.log(name, eingabe, `${f.bots.length} Bots`, true);
      return { ok: true, text };
    }
    case 'hafen_bot_lesen': {
      const e = z.object({ bot: z.string().min(1).max(100), anzahl: z.number().int().min(1).max(60).default(25) }).parse(eingabe);
      const b = finden(await flotte(), e.bot);
      const t = await h.anfrage<KryptoTerminal>('GET', `/bots/${b.id}/terminal`);
      const zeit = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
      const positionen = t.positionen.map((p) => `- ${p.symbol}: Einsatz ${p.einsatzSol.toFixed(3)} SOL, jetzt ${p.wertSol == null ? '?' : p.wertSol.toFixed(3)} SOL (${p.prozent == null ? '?' : pz(p.prozent)}), seit ${zeit(p.geoeffnet)}`);
      const trades = t.trades.slice(0, e.anzahl).map(
        (x) => `- ${zeit(x.zeit)} ${x.art} ${x.symbol} ${x.sol.toFixed(3)} SOL · Gebühr ${x.gebuehrSol.toFixed(4)} · Slippage ${x.slippageProzent.toFixed(1)} %${x.gewinnSol != null ? ` · Ergebnis ${sol(x.gewinnSol)} (${pz(x.gewinnProzent ?? 0)})` : ''} · ${x.grund}`,
      );
      const entscheidungen = t.entscheidungen.slice(0, e.anzahl).map((x) => `- ${zeit(x.zeit)} ${x.aktion} ${x.symbol}${x.sicherheit != null ? ` (${x.sicherheit.toFixed(2)})` : ''} [${x.quelle}] ${x.grund}`);
      u.fremd(); // Token-Namen, Symbole und LLM-Gründe stammen aus fremden Quellen
      const text = `${botZeile(b)}\nEinstellung:\n${JSON.stringify(b.einstellung, null, 1)}\n\n${fremdinhaltHuelle(
        'hafen',
        `Offene Positionen:\n${positionen.join('\n') || '(keine)'}\n\nLetzte Trades:\n${trades.join('\n') || '(keine)'}\n\nLetzte Entscheidungen:\n${entscheidungen.join('\n') || '(keine)'}`,
      )}`;
      u.log(name, eingabe, `${b.einstellung.name}: ${t.trades.length} Trades`, true, undefined, 'gelesen');
      return { ok: true, text };
    }
    case 'hafen_bot_anlegen': {
      const e = z.object({ einstellung: Teil, starten: z.boolean().default(true) }).parse(eingabe);
      const f = await flotte();
      const eigene = f.bots.filter((b) => agentenBots(u.db).includes(b.id));
      if ('modus' in e.einstellung) delete e.einstellung.modus; // es gibt nur Paper
      const einstellung = einstellungZusammenfuehren(KRYPTO_STANDARD, e.einstellung);
      if (einstellung.art === 'rl') einstellung.rl = { ...KRYPTO_RL_STANDARD, ...((e.einstellung.rl as object | undefined) ?? {}) };
      const grenze =
        f.bots.length >= HAFEN_FLOTTE_MAX
          ? `Die Flotte hat schon ${f.bots.length} Bots (höchstens ${HAFEN_FLOTTE_MAX}).`
          : eigene.length >= HAFEN_AGENT_MAX_BOTS
            ? `Agenten haben schon ${eigene.length} eigene Bots (höchstens ${HAFEN_AGENT_MAX_BOTS}) – erst einen schwachen eigenen Bot löschen (hafen_bot_loeschen) oder umbauen.`
            : einstellung.art === 'prompt' && eigene.filter((b) => b.einstellung.art === 'prompt').length >= HAFEN_AGENT_MAX_PROMPT
              ? `Schon ${HAFEN_AGENT_MAX_PROMPT} eigene Prompt-Bots (kosten je bis 0,50 $/Tag) – teste die Idee als Regel-Bot oder lösche erst einen Prompt-Bot.`
              : einstellung.art === 'rl' && eigene.filter((b) => b.einstellung.art === 'rl').length >= HAFEN_AGENT_MAX_RL
                ? `Schon ${HAFEN_AGENT_MAX_RL} eigener RL-Bot – stell seine Grenzen mit hafen_bot_aendern nach, statt einen zweiten anzulegen.`
                : null;
      if (grenze) {
        u.log(name, eingabe, grenze, false);
        return { ok: false, text: grenze };
      }
      const b = await h.anfrage<KryptoBot>('POST', '/bots', { einstellung });
      agentenBotsSetzen(u.db, [...agentenBots(u.db).filter((id) => f.bots.some((x) => x.id === id)), b.id]);
      if (b.modus !== 'paper') throw new DorfFehler(500, 'Unerwartet: neuer Bot ist nicht im Paper Trading.');
      let status = b.status;
      if (!e.starten && b.status === 'laeuft') status = (await h.anfrage<KryptoBot>('POST', `/bots/${b.id}/status`, { status: 'pausiert' })).status;
      await u.merken('hafen_bot_angelegt', `Hafen: Paper-Bot „${b.einstellung.name}“ angelegt`, { id: b.id, name: b.einstellung.name });
      const text = `${b.einstellung.avatar} ${b.einstellung.name} angelegt (Kennung ${b.id}) – Paper Trading, ${status === 'laeuft' ? 'läuft' : status}. Leif kann es zurücknehmen.${f.notaus ? ' Achtung: Not-Aus ist aktiv – der Bot handelt erst, wenn Leif ihn aufhebt.' : ''}`;
      u.log(name, { name: b.einstellung.name, art: b.einstellung.art }, text, true, undefined, 'geschrieben');
      return { ok: true, text };
    }
    case 'hafen_bot_aendern': {
      const e = z.object({ bot: z.string().min(1).max(100), einstellung: Teil }).parse(eingabe);
      const b = finden(await flotte(), e.bot);
      nurPaper(b);
      const neu = await h.anfrage<KryptoBot>('PUT', `/bots/${b.id}`, { einstellung: einstellungZusammenfuehren(b.einstellung, e.einstellung) });
      await u.merken('hafen_bot_geaendert', `Hafen: „${b.einstellung.name}“ geändert`, { id: b.id, vorher: b.einstellung }, true);
      const geaendert = Object.keys(e.einstellung).join(', ');
      const text = `${neu.einstellung.name} geändert (${geaendert}). Leif kann es zurücknehmen.`;
      u.log(name, { bot: b.id, felder: geaendert }, text, true, undefined, 'geschrieben');
      return { ok: true, text };
    }
    case 'hafen_bot_status': {
      const e = z.object({ bot: z.string().min(1).max(100), status: z.enum(['laeuft', 'pausiert']) }).parse(eingabe);
      const b = finden(await flotte(), e.bot);
      nurPaper(b);
      const neu = await h.anfrage<KryptoBot>('POST', `/bots/${b.id}/status`, { status: e.status });
      const text = `${neu.einstellung.name}: ${neu.status === 'laeuft' ? 'läuft' : 'pausiert'}.`;
      u.log(name, eingabe, text, true);
      return { ok: true, text };
    }
    case 'hafen_backtest': {
      const e = z
        .object({ id: z.string().uuid().optional(), bot: z.string().min(1).max(100).optional(), einstellung: Teil.optional(), stunden: z.number().min(0.2).max(720).optional() })
        .parse(eingabe ?? {});
      if (e.id) {
        const j = await h.anfrage<KryptoBacktest>('GET', `/backtests/${e.id}`);
        u.log(name, eingabe, `${j.status}`, true);
        return { ok: true, text: backtestText(j) };
      }
      if (!e.bot && !e.einstellung) {
        const l = await h.anfrage<{ bereich: { von: string | null; bis: string | null }; jobs: KryptoBacktest[] }>('GET', '/backtests');
        const text = `Aufzeichnungen: ${l.bereich.von?.slice(0, 16) ?? '–'} bis ${l.bereich.bis?.slice(0, 16) ?? '–'} UTC\n${l.jobs.slice(0, 10).map((j) => `- ${j.id} · ${j.name} · ${j.status}${j.ergebnis ? ` · ${sol(j.ergebnis.kennzahlen.gewinnSol)}` : ''}`).join('\n') || '(noch keine Backtests)'}`;
        u.log(name, eingabe, `${l.jobs.length} Backtests`, true);
        return { ok: true, text };
      }
      const basis = e.bot ? finden(await flotte(), e.bot).einstellung : KRYPTO_STANDARD;
      const einstellung = einstellungZusammenfuehren(basis, e.einstellung ?? {});
      if (einstellung.art === 'prompt' || einstellung.art === 'rl') {
        const t =
          einstellung.art === 'rl'
            ? 'Backtests gibt es nur für Regel-Bots – den RL-Bot prüft das Training selbst im Zeitraffer (hafen_muster). Setze einstellung.art = "regeln" für einen Backtest.'
            : 'Backtests gibt es nur für Regel-Bots (ein LLM über Tausende alte Tokens wäre teuer und nicht wiederholbar). Setze einstellung.art = "regeln" und passende Filter/Punkte.';
        u.log(name, eingabe, t, false);
        return { ok: false, text: t };
      }
      const j = await h.anfrage<KryptoBacktest>('POST', '/backtests', { einstellung, ...(e.stunden ? { vonStunden: e.stunden } : {}) });
      u.log(name, { bot: e.bot, stunden: e.stunden }, `gestartet ${j.id}`, true);
      return { ok: true, text: `${backtestText(j)}\nMit hafen_backtest {"id": "${j.id}"} abfragen.` };
    }
    case 'hafen_bot_loeschen': {
      const e = z.object({ bot: z.string().min(1).max(100), grund: z.string().trim().min(3).max(200) }).parse(eingabe);
      const b = finden(await flotte(), e.bot);
      nurPaper(b);
      if (!agentenBots(u.db).includes(b.id)) {
        const t = `${b.einstellung.name} ist Leifs Bot – löschen darf ihn nur Leif. Du kannst ihn höchstens empfehlen.`;
        u.log(name, eingabe, t, false);
        return { ok: false, text: t };
      }
      await h.anfrage('DELETE', `/bots/${b.id}`);
      agentenBotsSetzen(u.db, agentenBots(u.db).filter((id) => id !== b.id));
      const k = b.kennzahlen;
      const text = `${b.einstellung.name} gelöscht (${k.trades} Trades, Gewinn nach Gebühren ${sol(k.gewinnSol)}): ${e.grund}`;
      u.log(name, eingabe, text, true, undefined, 'geschrieben');
      return { ok: true, text };
    }
    case 'hafen_muster': {
      const e = z.object({ training: z.boolean().optional() }).parse(eingabe ?? {});
      if (e.training) {
        try {
          await h.anfrage('POST', '/muster/training', {});
        } catch (x) {
          if (x instanceof DorfFehler && x.status === 409) {
            const t = 'Das Training läuft schon – in ein paar Minuten mit hafen_muster (ohne Eingabe) nachsehen.';
            u.log(name, eingabe, t, true);
            return { ok: true, text: t };
          }
          throw x;
        }
        const t = 'Training gestartet (dauert einige Minuten) – danach mit hafen_muster (ohne Eingabe) den Bericht lesen.';
        u.log(name, eingabe, t, true);
        return { ok: true, text: t };
      }
      const m = await h.anfrage<KryptoMusterStatus>('GET', '/muster');
      u.log(name, eingabe, m.modell ? `v${m.modell.version} ${m.modell.aktiv ? 'aktiv' : 'inaktiv'}` : 'kein Modell', true, undefined, 'gelesen');
      return { ok: true, text: musterText(m) };
    }
    case 'hafen_notaus': {
      const e = z.object({ grund: z.string().trim().min(3).max(200) }).parse(eingabe);
      const f = await h.anfrage<KryptoUebersicht>('POST', '/notaus', { grund: `Not-Aus (Agent): ${e.grund}`.slice(0, 100) });
      await u.merken('hafen_notaus', `Hafen: NOT-AUS gezogen – ${e.grund}`, { grund: e.grund });
      const text = `🛑 Not-Aus gezogen: alle ${f.bots.length} Bots gestoppt. Leif ist benachrichtigt und kann ihn aufheben.`;
      u.log(name, eingabe, text, true, undefined, 'geschrieben');
      return { ok: true, text };
    }
  }
}
