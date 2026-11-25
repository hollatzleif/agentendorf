// E227: Terminal „Kielwasser“ – ein Bot live: Kopfzeile, Token-Leiste, Equity-Kerzen, Agent mit Prüfmodulen, Volumen,
// X-Feed, PnL und das Protokoll. Daten alle 2 s vom Dorf (das sie vom Kryptowerk holt). Alles Paper Trading.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KRYPTO_BOT_VON, KRYPTO_KERZEN_MS, KRYPTO_KERZEN_TAKTE, KRYPTO_VERLAUF_SEK, type KryptoKerze, type KryptoTrade, type KryptoKerzenTakt, type KryptoModul, type KryptoTerminal, type KryptoTokenKerzen } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { Eur, EuroKurs, KURS_QUELLE, eurJeSolAus, eurText, eurZusatz, kursText, useEurJeSol } from './euro';
import { MarkerForm, useKwFarben } from './chart';
import { Em } from './zeichen';
import { farbeAus, prozent, sol, solVz, stundeWien, uhrzeit, usdKurz } from './format';
import './hafen.css';

/** feste Reihenfolge, nie zyklisch vergeben (je Modul eine Farbe für das Buchstaben-Icon) */
const MODUL_FARBE: Record<string, string> = {
  rug: '#f43f5e',
  dev: '#fb923c',
  bundle: '#facc15',
  kol: '#a3e635',
  x: '#e2e8f0',
  holder: '#2dd4bf',
  volumen: '#22c55e',
  sniper: '#38bdf8',
  groesse: '#818cf8',
  tp: '#4ade80',
  sl: '#fb7185',
  gate: '#c4b5fd',
};
/** E240: dieselben Module in der Apple-Oberfläche (Systemfarben) */
const MODUL_FARBE_APPLE: Record<string, string> = {
  rug: 'var(--a-rot)',
  dev: 'var(--a-orange)',
  bundle: 'var(--a-gelb)',
  kol: 'var(--a-mint)',
  x: 'var(--a-grau)',
  holder: 'var(--a-tuerkis)',
  volumen: 'var(--a-gruen)',
  sniper: 'var(--a-cyan)',
  groesse: 'var(--a-indigo)',
  tp: 'var(--a-gruen)',
  sl: 'var(--a-pink)',
  gate: 'var(--a-lila)',
};

function useJetzt(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

const TAKT_TEXT: Record<KryptoKerzenTakt, string> = { '5s': '5 s', '15s': '15 s', '1m': '1 min', '5m': '5 min', '15m': '15 min' };
const TAKT_SPEICHER = 'dorf-kielwasser-takt';

export function KielwasserSeite({ botId }: { botId: string }) {
  // E233: Kerzen-Takt der Equity (merkt sich die letzte Wahl auf diesem Gerät)
  const [takt, setTakt] = useState<KryptoKerzenTakt>(() => {
    const t = localStorage.getItem(TAKT_SPEICHER);
    return (KRYPTO_KERZEN_TAKTE as readonly string[]).includes(t ?? '') ? (t as KryptoKerzenTakt) : '15m';
  });
  const taktWaehlen = (t: KryptoKerzenTakt) => {
    setTakt(t);
    localStorage.setItem(TAKT_SPEICHER, t);
  };
  const q = useQuery({ queryKey: ['krypto', 'terminal', botId, takt], queryFn: () => api<KryptoTerminal>(`/api/krypto/bots/${botId}/terminal?takt=${takt}`), refetchInterval: 2000, placeholderData: (alt) => alt });
  const jetzt = useJetzt();
  useEffect(() => {
    const alt = document.title;
    document.title = 'Kielwasser · Hafen';
    return () => {
      document.title = alt;
    };
  }, []);
  if (q.isError)
    return (
      <div className="kw">
        <div className="kw-tafel">
          <h2>Kielwasser</h2>
          <p className="minus">{(q.error as Error).message}</p>
          <a href="/gebaeude/Hafen" onClick={linkKlick}>
            <Em e="←" /> zurück zum Hafen
          </a>
        </div>
      </div>
    );
  if (!q.data)
    return (
      <div className="kw">
        <p className="leise mono">verbinde …</p>
      </div>
    );
  return (
    <EuroKurs.Provider value={eurJeSolAus(q.data.solUsd, q.data.usdJeEur)}>
      <Terminal t={q.data} jetzt={jetzt} takt={takt} taktWaehlen={taktWaehlen} />
    </EuroKurs.Provider>
  );
}

function Terminal({ t, jetzt, takt, taktWaehlen }: { t: KryptoTerminal; jetzt: number; takt: KryptoKerzenTakt; taktWaehlen: (t: KryptoKerzenTakt) => void }) {
  const b = t.bot;
  const k = b.kennzahlen;
  const e = b.einstellung;
  const seit = Date.parse(b.erstellt);
  const tage = Math.max(0, Math.floor((jetzt - seit) / 86_400_000));
  const letzterGeschlossen = t.trades.find((x) => x.gewinnSol != null);
  const eurJeSol = useEurJeSol();
  const eurT = (n: number | null | undefined, vz = false) => eurZusatz(n, eurJeSol, vz);
  return (
    <div className="kw" aria-label={`Terminal ${e.name}`}>
      <header className="kw-tafel kw-kopf">
        <div className="kw-wer">
          <div className="kw-avatar" aria-hidden>
            {e.avatar}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="kw-name">
              {e.name}
              <span className={`kw-pille${b.modus === 'live' ? ' live' : ''}`}>{b.modus === 'paper' ? 'PAPER' : 'LIVE'}</span>
              {t.von && (
                <span className="kw-pille kw-von" data-testid="bot-von" title="Von einem Agenten angelegt">
                  {KRYPTO_BOT_VON[t.von]}
                </span>
              )}
            </div>
            <div className="kw-zeile">
              <span>{uhrzeit(jetzt, true)}</span>
              <span>seit {tage ? `${tage} T` : uhrzeit(seit)}</span>
              <span>Pump.fun · Solana</span>
              <span>{e.art === 'prompt' ? 'Prompt + LLM' : e.art === 'rl' ? 'RL + Muster-Modell' : 'Regeln'}</span>
              <span className={`kw-online${t.datenOnline ? '' : ' aus'}`}>{t.datenOnline ? 'online' : 'offline'}</span>
              {eurJeSol != null && (
                <span title={KURS_QUELLE} data-testid="kw-kurs">
                  {kursText(eurJeSol)}
                </span>
              )}
            </div>
            {b.wallet && (
              <div className="kw-zeile" title="Eigenes Wallet dieses Bots">
                <span>
                  👛 {b.wallet.adresse.slice(0, 6)}…{b.wallet.adresse.slice(-6)}
                  {b.wallet.guthabenSol != null ? ` · ${sol(b.wallet.guthabenSol, 4)}` : ''}
                  <Eur sol={b.wallet.guthabenSol} />
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="kw-konto">
          <strong data-testid="kw-kapital">{sol(k.kapitalSol, 3)}</strong>
          <span>
            {eurJeSol != null ? `≈ ${eurText(k.kapitalSol * eurJeSol)} · ` : ''}
            <b className={k.faktor >= 1 ? 'plus' : 'minus'}>{k.faktor.toLocaleString('de-DE', { maximumFractionDigits: 3 })}×</b> · {k.trades} Trades · {k.gewonnen}W/{k.verloren}L
          </span>
          <div className="kw-zeile" style={{ justifyContent: 'flex-end', marginTop: '0.35rem' }}>
            <a href="/gebaeude/Hafen" onClick={linkKlick} className="kw-zurueck">
              <Em e="←" /> Hafen
            </a>
          </div>
        </div>
      </header>

      <section className="kw-tafel" aria-label="Beobachtete Tokens">
        <div className="kw-pillen">
          {t.pillen.length ? (
            t.pillen.map((p) => {
              // E237: gehaltene Position mit Einsatz und Wert (SOL + €) im Tooltip
              const pos = t.positionen.find((x) => x.mint === p.mint);
              return (
                <span key={p.mint} className={`kw-token${p.gehalten ? ' aktiv' : ''}`} title={pos ? `${p.mint}\nEinsatz ${sol(pos.einsatzSol)}${eurT(pos.einsatzSol)} · Wert ${sol(pos.wertSol)}${eurT(pos.wertSol)}` : p.mint} data-testid={pos ? 'kw-position' : undefined}>
                  <i style={{ background: farbeAus(p.symbol) }}>{p.symbol.slice(0, 1).toUpperCase()}</i>
                  {p.symbol}
                  <b className={(p.prozent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozent(p.prozent, 1)}</b>
                </span>
              );
            })
          ) : (
            <span className="leise mono" style={{ fontSize: '0.78rem' }}>
              noch keine Tokens im Blick – {t.datenOnline ? 'neue Coins kommen laufend' : 'warte auf die Verbindung zu PumpPortal'}
            </span>
          )}
        </div>
        <div className="kw-stunden" aria-label="Gewinn je Stunde heute">
          {t.pnlStunden.map((v, i) => (
            <div key={i} className={`${i === stundeWien(jetzt) ? 'jetzt ' : ''}${v == null ? '' : v >= 0 ? 'plus' : 'minus'}`} title={v == null ? `${i}:00 – kein Trade` : `${i}:00 ${solVz(v)} SOL${eurT(v, true)}`}>
              {i + 1}
            </div>
          ))}
        </div>
      </section>

      <div className="kw-mitte">
        <section className="kw-tafel" aria-label="Bot-Equity">
          <div className="kw-chart-kopf">
            <h3>Bot-Equity · {TAKT_TEXT[t.kerzenTakt ?? '15m']}</h3>
            <div className="kw-takte" role="group" aria-label="Kerzen-Takt">
              {KRYPTO_KERZEN_TAKTE.map((x) => (
                <button key={x} type="button" className={x === takt ? 'an' : ''} aria-pressed={x === takt} onClick={() => taktWaehlen(x)}>
                  {TAKT_TEXT[x]}
                </button>
              ))}
            </div>
            <span className={`kw-lage${t.lage === 'LONG' ? ' long' : ''}`}>{t.lage}</span>
          </div>
          <Ohlc k={t.kerzen.at(-1)} />
          {letzterGeschlossen && (
            <p className="kw-letzter" data-testid="letzter-trade">
              Letzter Trade: <b>{letzterGeschlossen.symbol}</b> · 1× (kein Hebel) ·{' '}
              <span className={letzterGeschlossen.gewinnSol! >= 0 ? 'plus' : 'minus'}>
                {solVz(letzterGeschlossen.gewinnSol!)} SOL
                <Eur sol={letzterGeschlossen.gewinnSol} vz /> · {prozent(letzterGeschlossen.gewinnProzent!)}
              </span>
            </p>
          )}
          <EquityKerzen key={t.kerzenTakt ?? '15m'} kerzen={t.kerzen} sekunden={(t.kerzenTakt ?? '15m').endsWith('s')} ms={KRYPTO_KERZEN_MS[t.kerzenTakt ?? '15m']} trades={t.chartTrades ?? t.trades} start={k.startSol} />
        </section>
        <Agent t={t} jetzt={jetzt} />
      </div>

      <Echtzeit t={t} />

      <MusterRat t={t} />

      <div className="kw-unten">
        <section className="kw-tafel" aria-label="Volumen">
          <h3>Volumen · beobachtete Tokens</h3>
          <div className="kw-balken" aria-hidden>
            {(() => {
              const max = Math.max(1, ...t.volumenBalken.map((v) => v.kaeufe + v.verkaeufe));
              return t.volumenBalken.map((v) => (
                <div key={v.zeit} title={`${uhrzeit(v.zeit)}: ${v.kaeufe} Käufe, ${v.verkaeufe} Verkäufe (5-min-Fenster)`}>
                  <span style={{ height: `${(v.verkaeufe / max) * 100}%`, background: 'var(--kw-rot)' }} />
                  <span style={{ height: `${(v.kaeufe / max) * 100}%`, background: 'var(--kw-gruen)' }} />
                </div>
              ));
            })()}
          </div>
          <ul className="kw-liste">
            {t.topVolumen.map((v, i) => (
              <li key={`${v.symbol}-${i}`}>
                <div className="zeile">
                  <span>{v.symbol}</span>
                  <span>
                    {usdKurz(v.usd)} <span className="plus">{v.kaeufe}↑</span> <span className="minus">{v.verkaeufe}↓</span>
                  </span>
                </div>
                <div className="kw-fortschritt">
                  <b style={{ width: `${Math.min(100, (v.usd / Math.max(1, t.topVolumen[0]!.usd)) * 100)}%` }} />
                </div>
              </li>
            ))}
            {!t.topVolumen.length && <li className="leise">noch kein Volumen</li>}
          </ul>
        </section>
        <section className="kw-tafel" aria-label="X-Feed">
          <h3>X-Feed</h3>
          {t.xFeed.length ? (
            <ul className="kw-liste" style={{ marginTop: '0.5rem' }}>
              {t.xFeed.map((x, i) => (
                <li key={i}>
                  <div className="zeile">
                    <span>@{x.account} · {x.symbol}</span>
                    <b className={x.stimmung >= 0 ? 'plus' : 'minus'}>{x.stimmung.toFixed(2)}</b>
                  </div>
                  <span className="leise">{x.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="leise mono" style={{ fontSize: '0.74rem' }}>
              {t.xHinweis}
            </p>
          )}
        </section>
        <section className="kw-tafel" aria-label="PnL">
          <h3>PnL · heute</h3>
          <div className="kw-zahlen">
            <div>
              <span>Heute</span>
              <strong className={k.heuteSol >= 0 ? 'plus' : 'minus'}>
                {solVz(k.heuteSol)}
                <Eur sol={k.heuteSol} vz />
              </strong>
            </div>
            <div>
              <span>Gesamt</span>
              <strong className={k.gewinnSol >= 0 ? 'plus' : 'minus'} data-testid="kw-gesamt">
                {prozent(k.gewinnProzent)}
                <em className="hafen-eur" style={{ display: 'block', fontStyle: 'normal' }}>
                  {solVz(k.gewinnSol)} SOL{eurT(k.gewinnSol, true)}
                </em>
              </strong>
            </div>
            <div>
              <span>Bester Trade</span>
              <strong className="plus">
                {t.besterTradeSol == null ? '–' : solVz(t.besterTradeSol)}
                <Eur sol={t.besterTradeSol} vz />
              </strong>
            </div>
            <div>
              <span>Rugs geblockt</span>
              <strong>{k.geblockteRugs}</strong>
            </div>
            <div>
              <span>Trefferquote</span>
              <strong>{k.trefferquote == null ? '–' : `${Math.round(k.trefferquote * 100)} %`}</strong>
            </div>
            {k.tage && k.tage.length > 0 && (
              <div title={k.tage.map((x) => `${x.tag}: ${solVz(x.gewinnSol)} SOL${eurT(x.gewinnSol, true)} (${x.trades} Trades)`).join('\n')} data-testid="tage-im-plus">
                <span>Tage im Plus</span>
                <strong>
                  {k.tage.filter((x) => x.gewinnSol > 0).length}/{k.tage.length}
                </strong>
              </div>
            )}
            {(k.nachschussSol ?? 0) > 0 && (
              <div title="Frisches Paper-Spielgeld nach Pleite – zählt zum Startkapital, nie als Gewinn" data-testid="nachschuss">
                <span>Nachschuss</span>
                <strong>
                  {sol(k.nachschussSol, 2)}
                  <Eur sol={k.nachschussSol} />
                  {k.nachschuesse ? ` · ${k.nachschuesse}×` : ''}
                </strong>
                <em className="leise" style={{ display: 'block', fontSize: '0.62rem', fontStyle: 'normal' }}>
                  zählt nicht als Gewinn
                </em>
              </div>
            )}
            <div>
              <span>Max. Drawdown</span>
              <strong className="minus">{k.maxDrawdownProzent ? `−${k.maxDrawdownProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '0 %'}</strong>
            </div>
          </div>
          <div className="kw-zahlen">
            <div>
              <span>Umsatz</span>
              <strong>
                {sol(k.umsatzSol, 2)}
                <Eur sol={k.umsatzSol} />
              </strong>
            </div>
            <div title={`Pump.fun ${sol(k.gebuehrenArt.pumpSol, 4)}${eurT(k.gebuehrenArt.pumpSol)} · PumpPortal ${sol(k.gebuehrenArt.portalSol, 4)}${eurT(k.gebuehrenArt.portalSol)} · Netz/Priority ${sol(k.gebuehrenArt.netzSol, 4)}${eurT(k.gebuehrenArt.netzSol)}`}>
              <span>Gebühren</span>
              <strong>
                {sol(k.gebuehrenSol, 3)}
                <Eur sol={k.gebuehrenSol} />
              </strong>
            </div>
          </div>
          <p className="leise mono" style={{ fontSize: '0.68rem', margin: '0.5rem 0 0' }}>
            Heute, Gesamt und Bester Trade sind schon nach Gebühren. Gebühren: Pump.fun {sol(k.gebuehrenArt.pumpSol, 4)}
            {eurT(k.gebuehrenArt.pumpSol)} · PumpPortal {sol(k.gebuehrenArt.portalSol, 4)}
            {eurT(k.gebuehrenArt.portalSol)} · Netz {sol(k.gebuehrenArt.netzSol, 4)}
            {eurT(k.gebuehrenArt.netzSol)}
            <br />
            {b.modus === 'live' ? 'LIVE – echte Transaktionen über PumpPortal und dein RPC.' : `Paper Trading mit Pump.fun- und PumpPortal-Gebühren, Slippage, ${e.simulation.verzoegerungMs} ms Verzögerung, ${e.simulation.fehlschlagProzent} % Fehlschlägen.`}
          </p>
        </section>
      </div>

      <div className="kw-protokoll">
        <section className="kw-tafel" aria-label="Entscheidungen">
          <h3>Entscheidungen</h3>
          <ul className="kw-eintraege">
            {t.entscheidungen.map((x) => (
              <li key={x.id}>
                <span>{uhrzeit(x.zeit, true)}</span>
                <span className={`kw-tag ${x.aktion}`}>{x.aktion.toUpperCase()}</span>
                <span>
                  <b style={{ color: 'var(--kw-text)' }}>{x.symbol}</b> {x.sicherheit != null ? `(${x.sicherheit.toFixed(2)}) ` : ''}
                  {x.grund}
                </span>
              </li>
            ))}
            {!t.entscheidungen.length && <li className="leise">Noch nichts entschieden.</li>}
          </ul>
        </section>
        <section className="kw-tafel" aria-label="Trades">
          <div className="kw-chart-kopf">
            <h3>Trades</h3>
            <button type="button" className="kw-knopf" onClick={() => void csvLaden(b.id, e.name)}>
              <Em e="⬇" /> CSV
            </button>
          </div>
          <ul className="kw-eintraege">
            {t.trades.map((x) => (
              <li key={x.id}>
                <span>{uhrzeit(x.zeit, true)}</span>
                <span className={`kw-tag ${x.art}`}>{x.art === 'fehlschlag' ? 'FAIL' : x.art === 'kauf' ? 'BUY' : 'SELL'}</span>
                <span>
                  <b style={{ color: 'var(--kw-text)' }}>{x.symbol}</b>{' '}
                  {x.art !== 'fehlschlag' && (
                    <>
                      {sol(x.sol)}
                      <Eur sol={x.sol} /> · Slippage {x.slippageProzent.toFixed(1)} % ·{' '}
                    </>
                  )}
                  Gebühr {sol(x.gebuehrSol, 4)}
                  <Eur sol={x.gebuehrSol} /> · {x.verzoegerungMs} ms
                  {x.gewinnSol != null && (
                    <b className={x.gewinnSol >= 0 ? 'plus' : 'minus'} data-testid="kw-trade-gewinn">
                      {' '}
                      · {solVz(x.gewinnSol)} SOL
                      <Eur sol={x.gewinnSol} vz /> ({prozent(x.gewinnProzent)})
                    </b>
                  )}
                  <br />
                  {x.grund}
                  {x.signatur && (
                    <>
                      {' · '}
                      <a href={`https://solscan.io/tx/${x.signatur}`} target="_blank" rel="noreferrer noopener">
                        Transaktion
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
            {!t.trades.length && <li className="leise">Noch keine Trades.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** alle Trades (bis 500) als CSV – für Excel/Numbers */
async function csvLaden(botId: string, name: string) {
  const p = await api<{ trades: KryptoTerminal['trades'] }>(`/api/krypto/bots/${botId}/protokoll?anzahl=500`);
  const z = (n: number | undefined | null) => (n == null ? '' : String(n).replace('.', ','));
  const zeilen = ['Zeit;Art;Token;Mint;SOL;Preis (SOL);Gebühren (SOL);Slippage %;Verzögerung ms;Gewinn (SOL);Gewinn %;Grund;Transaktion'];
  for (const t of [...p.trades].reverse())
    zeilen.push([new Date(t.zeit).toLocaleString('de-AT'), t.art, t.symbol, t.mint, z(t.sol), z(t.preis), z(t.gebuehrSol), z(t.slippageProzent), z(t.verzoegerungMs), z(t.gewinnSol), z(t.gewinnProzent), `"${t.grund.replace(/"/g, '""')}"`, t.signatur ?? ''].join(';'));
  const url = URL.createObjectURL(new Blob(['\ufeff' + zeilen.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `hafen-${name.replace(/[^\w-]+/g, '_')}-trades.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Ohlc({ k }: { k: KryptoKerze | undefined }) {
  if (!k) return null;
  const f = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return (
    <div className="kw-ohlc">
      <span>
        O <b>{f(k.o)}</b>
      </span>
      <span>
        H <b>{f(k.h)}</b>
      </span>
      <span>
        L <b>{f(k.l)}</b>
      </span>
      <span>
        C <b className={k.c >= k.o ? 'plus' : 'minus'}>{f(k.c)}</b>
      </span>
    </div>
  );
}

/**
 * E233: Equity-Kerzen mit Zoom (Mausrad/Knöpfe), Verschieben (Ziehen), Fadenkreuz mit Uhrzeit und Werten, und Markern für
 * Käufe (▲) und Verkäufe (▼) – Details beim Drüberfahren. Ohne Zoom folgt der Chart dem rechten Rand (neueste Kerze).
 */
function EquityKerzen({ kerzen: alle, start, sekunden = false, ms, trades }: { kerzen: KryptoKerze[]; start: number; sekunden?: boolean; ms: number; trades: KryptoTrade[] }) {
  const eurJeSol = useEurJeSol();
  const f = useKwFarben();
  const B = 640;
  const H = 420;
  const R = 62; // Preisskala rechts
  const O = 14;
  const U = 22;
  const MIN = 10;
  const n0 = alle.length;
  // Ausschnitt: Breite in Kerzen und Abstand vom rechten Rand (0 = folgt der neuesten Kerze)
  const [sicht, setSicht] = useState<{ breite: number; rechts: number } | null>(null);
  const [zeiger, setZeiger] = useState<number | null>(null); // Kerzen-Index im Ausschnitt
  const [marker, setMarker] = useState<{ t: KryptoTrade; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zieh = useRef<{ x: number; rechts: number; bewegt: boolean } | null>(null);
  const breite = Math.min(n0, Math.max(MIN, sicht?.breite ?? n0));
  const rechts = Math.min(Math.max(0, sicht?.rechts ?? 0), Math.max(0, n0 - breite));
  const kerzen = alle.slice(n0 - rechts - breite, n0 - rechts);
  const werte = kerzen.flatMap((k) => [k.h, k.l]).concat(rechts === 0 && breite === n0 ? [start] : []);
  let lo = Math.min(...werte);
  let hi = Math.max(...werte);
  if (hi - lo < 1e-9) ((lo -= 0.05 * (start || 1)), (hi += 0.05 * (start || 1)));
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const y = (v: number) => O + ((hi - v) / (hi - lo)) * (H - O - U);
  const n = Math.max(kerzen.length, 24);
  const w = (B - R - 8) / n;
  const x = (i: number) => 4 + (n - kerzen.length + i) * w + w / 2;
  const letzte = kerzen.at(-1);
  const skala = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const f3 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const zoomen = (faktor: number, anteil = 1) => {
    const neu = Math.round(Math.min(n0, Math.max(MIN, breite * faktor)));
    // die Kerze unter der Maus bleibt an ihrem Platz
    const unter = n0 - rechts - breite + anteil * breite;
    const links = Math.round(unter - anteil * neu);
    const r = Math.min(Math.max(0, n0 - (links + neu)), Math.max(0, n0 - neu));
    setSicht(neu >= n0 ? null : { breite: neu, rechts: r });
  };
  const vbX = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * B;
  };
  const indexBei = (vx: number) => {
    const i = Math.round((vx - 4 - w / 2) / w) - (n - kerzen.length);
    return i >= 0 && i < kerzen.length ? i : null;
  };
  // Mausrad: zoomen (nicht die Seite scrollen) – nativ, weil React-Rad-Ereignisse passiv sind
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const rad = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anteil = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width) * (B / (B - R))));
      zoomen(e.deltaY > 0 ? 1.2 : 1 / 1.2, anteil);
    };
    el.addEventListener('wheel', rad, { passive: false });
    return () => el.removeEventListener('wheel', rad);
  });

  // Marker: Käufe/Verkäufe an ihrer Kerze, gestapelt, wenn mehrere in eine Kerze fallen
  const imAusschnitt = kerzen.length ? trades.filter((t) => (t.art === 'kauf' || t.art === 'verkauf') && t.zeit >= kerzen[0]!.zeit && t.zeit < kerzen.at(-1)!.zeit + ms) : [];
  const zaehler = new Map<string, number>();
  const marken = imAusschnitt.map((t) => {
    const slot = Math.floor(t.zeit / ms) * ms;
    const i = kerzen.findIndex((k) => k.zeit === slot);
    const k = kerzen[i];
    if (i < 0 || !k) return null;
    const schluessel = `${i}-${t.art}`;
    const nr = zaehler.get(schluessel) ?? 0;
    zaehler.set(schluessel, nr + 1);
    const kauf = t.art === 'kauf';
    const my = kauf ? Math.min(H - U + 8, y(k.l) + 12 + nr * 11) : Math.max(6, y(k.h) - 12 - nr * 11);
    return { t, mx: x(i), my, kauf };
  }).filter((m): m is { t: KryptoTrade; mx: number; my: number; kauf: boolean } => !!m);

  const z = zeiger != null ? kerzen[zeiger] : null;
  return (
    <div className="kw-chart">
      <div className="kw-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomen(1 / 1.5)} aria-label="Hineinzoomen" disabled={breite <= MIN}>
          +
        </button>
        <button type="button" onClick={() => zoomen(1.5)} aria-label="Herauszoomen" disabled={!sicht}>
          −
        </button>
        <button type="button" onClick={() => setSicht(null)} disabled={!sicht}>
          Alles
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${B} ${H}`}
        role="img"
        aria-label={`Equity: ${letzte ? letzte.c.toFixed(3) : start.toFixed(3)} SOL, Start ${start.toFixed(3)} SOL, ${kerzen.length} Kerzen, ${marken.length} Trades`}
        style={{ touchAction: 'none', cursor: zieh.current ? 'grabbing' : 'crosshair' }}
        onPointerDown={(e) => {
          zieh.current = { x: e.clientX, rechts, bewegt: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const vx = vbX(e.clientX);
          if (zieh.current) {
            const r = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - zieh.current.x) / r.width) * B;
            if (Math.abs(dx) > 3) zieh.current.bewegt = true;
            if (zieh.current.bewegt && sicht) {
              const r2 = Math.round(zieh.current.rechts + dx / w);
              setSicht({ breite, rechts: Math.min(Math.max(0, r2), n0 - breite) });
            }
          }
          setZeiger(indexBei(vx));
        }}
        onPointerUp={() => {
          zieh.current = null;
        }}
        onPointerLeave={() => {
          zieh.current = null;
          setZeiger(null);
        }}
        onDoubleClick={() => setSicht(null)}
      >
        {skala.map((v) => (
          <g key={v}>
            <line x1={0} x2={B - R} y1={y(v)} y2={y(v)} stroke={f.raster} strokeWidth={1} />
            <text x={B - R + 6} y={y(v) + 4} fill={f.achse} fontSize={10} fontFamily="ui-monospace, monospace">
              {v.toFixed(3)}
            </text>
          </g>
        ))}
        {start > lo && start < hi && (
          <g>
            <line x1={0} x2={B - R} y1={y(start)} y2={y(start)} stroke={f.achse} strokeDasharray={f.apple ? '2 3' : '4 4'} strokeWidth={1} />
            <text x={4} y={y(start) - 4} fill={f.achse} fontSize={10} fontFamily="ui-monospace, monospace">
              Start {start.toFixed(2)}
            </text>
          </g>
        )}
        {kerzen.map((k, i) => {
          const auf = k.c >= k.o;
          const farbe = auf ? f.gruen : f.rot;
          const kw = Math.max(1.5, w * 0.62);
          return (
            <g key={k.zeit}>
              <line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} stroke={farbe} strokeWidth={f.apple ? 1 : 1.5} />
              <rect x={x(i) - kw / 2} y={Math.min(y(k.o), y(k.c))} width={kw} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} rx={1.5} fill={farbe} />
            </g>
          );
        })}
        {letzte && rechts === 0 && (
          <g>
            <line x1={0} x2={B - R} y1={y(letzte.c)} y2={y(letzte.c)} stroke={f.preis} strokeWidth={1} opacity={0.6} strokeDasharray={f.apple ? '2 3' : undefined} />
            <rect x={B - R + 1} y={y(letzte.c) - 9} width={R - 2} height={18} rx={f.apple ? 9 : 4} fill={f.preis} />
            <text x={B - R + 6} y={y(letzte.c) + 4} fill={f.preisText} fontSize={10.5} fontWeight={700} fontFamily="ui-monospace, monospace">
              {letzte.c.toFixed(3)}
            </text>
          </g>
        )}
        {z && (
          <g pointerEvents="none">
            <line x1={x(zeiger!)} x2={x(zeiger!)} y1={O} y2={H - U} stroke={f.zeiger} strokeDasharray={f.apple ? undefined : '3 3'} strokeWidth={1} />
            <line x1={0} x2={B - R} y1={y(z.c)} y2={y(z.c)} stroke={f.zeiger} strokeDasharray="3 3" strokeWidth={1} opacity={0.6} />
          </g>
        )}
        {marken.map((m) => (
          <g
            key={m.t.id}
            className="kw-marker"
            onPointerEnter={() => setMarker({ t: m.t, x: m.mx, y: m.my })}
            onPointerLeave={() => setMarker(null)}
            onPointerDown={(e) => {
              e.stopPropagation();
              setMarker({ t: m.t, x: m.mx, y: m.my });
            }}
          >
            <circle cx={m.mx} cy={m.my} r={8} fill="transparent" />
            <MarkerForm x={m.mx} y={m.my} kauf={m.kauf} farbe={m.kauf ? f.gruen : f.rot} f={f} />
          </g>
        ))}
      </svg>
      {z && !marker && (
        <div className="kw-fadenkreuz" style={{ left: `${Math.min(70, (x(zeiger!) / B) * 100 + 2)}%` }} data-testid="chart-zeiger">
          <b>{uhrzeit(z.zeit, sekunden)}</b>
          <br />O {f3(z.o)} · H {f3(z.h)}
          <br />L {f3(z.l)} · C <span className={z.c >= z.o ? 'plus' : 'minus'}>{f3(z.c)}</span>
          {eurJeSol != null && (
            <>
              <br />
              <span className="hafen-eur">≈ {eurText(z.c * eurJeSol)}</span>
            </>
          )}
          <br />
          <span className={z.c >= start ? 'plus' : 'minus'}>{prozent((z.c / start - 1) * 100)} seit Start</span>
        </div>
      )}
      {marker && (
        <div className="kw-fadenkreuz" style={{ left: `${Math.min(62, (marker.x / B) * 100 + 2)}%`, top: `${Math.min(70, (marker.y / H) * 100)}%` }} data-testid="chart-marker">
          <b className={marker.t.art === 'kauf' ? 'plus' : 'minus'}>
            {marker.t.art === 'kauf' ? (f.apple ? 'Kauf' : '▲ Kauf') : f.apple ? 'Verkauf' : '▼ Verkauf'} {marker.t.symbol}
          </b>
          <br />
          {uhrzeit(marker.t.zeit, true)} · {marker.t.sol.toLocaleString('de-DE', { maximumFractionDigits: 4 })} SOL
          <Eur sol={marker.t.sol} />
          <br />
          Kurs {marker.t.preis.toExponential(3)} · Gebühr {marker.t.gebuehrSol.toLocaleString('de-DE', { maximumFractionDigits: 4 })} SOL
          <Eur sol={marker.t.gebuehrSol} />
          {marker.t.gewinnSol != null && (
            <>
              <br />
              <span className={marker.t.gewinnSol >= 0 ? 'plus' : 'minus'}>
                Ergebnis {solVz(marker.t.gewinnSol)} SOL
                <Eur sol={marker.t.gewinnSol} vz /> ({prozent(marker.t.gewinnProzent ?? 0)})
              </span>
            </>
          )}
          <br />
          <span className="leise">{marker.t.grund}</span>
        </div>
      )}
    </div>
  );
}

/** E232: Echtzeit-Kurse (Bonding Curve) – Status und 5-Sekunden-Kerzen je gehaltenem Token */
function Echtzeit({ t }: { t: KryptoTerminal }) {
  const e = t.echtzeit;
  const zeile = !e
    ? 'aus – braucht den Solana-Zugang (dorf krypto-rpc)'
    : e.grenzeErreicht
      ? `Tagesgrenze ${e.grenzeMb} MB erreicht – bis morgen nur DexScreener`
      : !e.an
        ? 'bereit – startet, sobald ein Bot läuft'
        : `${e.online ? '● live' : '○ verbindet …'} · ${e.abos} Tokens · ${e.ticksMinute} Trades/min · ${e.mbHeute.toLocaleString('de-DE')} MB heute${e.fehler ? ` · ${e.fehler}` : ''}`;
  return (
    <section className="kw-tafel" aria-label="Echtzeit-Kurse">
      <div className="kw-chart-kopf">
        <h3>
          <Em e="⚡" /> Echtzeit-Kurse · 5 s
        </h3>
        <span className="leise mono" style={{ fontSize: '0.74rem' }} data-testid="echtzeit-status">
          {zeile}
        </span>
      </div>
      {t.tokenKerzen?.length ? (
        <div className="kw-echtzeit">
          {t.tokenKerzen.map((k) => (
            <TokenKerzen key={k.mint} k={k} />
          ))}
        </div>
      ) : (
        <p className="leise mono" style={{ fontSize: '0.74rem' }}>
          {t.echtzeit?.an ? 'Noch keine Trades seit dem Abo – die Kerzen erscheinen mit dem ersten Trade (nur Tokens auf der Bonding Curve).' : 'Sobald der Strom läuft, erscheinen hier 5-Sekunden-Kerzen: gehaltene Tokens zuerst, dann die lebhaftesten beobachteten.'}
        </p>
      )}
    </section>
  );
}

/** E237: Horizont-Beschriftung der Kursvorhersage */
function horizontText(sek: number) {
  return sek < 60 ? `${sek} s` : `${sek / 60} min`;
}

/** E237: „5 s +1 % · 30 s +4 % · 1 min +9 %“ – nur aktive Horizonte (null = Modell nicht aktiv) */
function verlaufText(v: (number | null)[] | null | undefined) {
  if (!v) return '';
  return KRYPTO_VERLAUF_SEK.map((sek, i) => {
    const w = v[i];
    if (w == null || !Number.isFinite(w)) return null;
    const r = Math.round(w);
    return `${horizontText(sek)} ${r >= 0 ? '+' : '−'}${Math.abs(r)} %`;
  })
    .filter(Boolean)
    .join(' · ');
}

/** E237: deutliches Alarm-Abzeichen – 🚀 starker Anstieg / 💥 Absturz steht bevor */
function AlarmAbzeichen({ alarm }: { alarm: 'anstieg' | 'absturz' }) {
  return (
    <span
      className={`kw-alarm ${alarm}`}
      data-testid="muster-alarm"
      title={alarm === 'anstieg' ? 'Kursvorhersage/Pump-Erkenner: starker Anstieg in den nächsten 2 min erwartet' : 'Kursvorhersage/Absturz-Erkenner: Absturz in den nächsten 2 min erwartet'}
    >
      <Em e={alarm === 'anstieg' ? '🚀' : '💥'} /> ALARM
    </span>
  );
}

/** E235: Rat des Muster-Modells – nur Anzeige (Punkte steuert er erst mit regeln.musterGewicht > 0 bei) */
function MusterRat({ t }: { t: KryptoTerminal }) {
  const rat = t.musterRat ?? [];
  const gewicht = t.bot.einstellung.regeln.musterGewicht ?? 0;
  return (
    <section className="kw-tafel" aria-label="Muster-Rat">
      <div className="kw-chart-kopf">
        <h3>
          <Em e="🧠" /> Muster-Rat
        </h3>
        <span className="leise mono" style={{ fontSize: '0.72rem' }}>
          {t.bot.einstellung.art === 'rl' ? 'handelt danach (RL, nur Paper) · Alarme wirken' : gewicht > 0 ? `zählt bis ${gewicht} Punkte · 💥 ≥ 70 % → raus · Alarme wirken` : 'nur Anzeige'}
        </span>
      </div>
      {rat.length ? (
        <ul className="kw-liste" style={{ marginTop: '0.5rem' }}>
          {rat.map((x) => {
            const p = typeof x.wahrscheinlichkeit === 'number' && Number.isFinite(x.wahrscheinlichkeit) ? x.wahrscheinlichkeit : null;
            const pz = (v: number) => `${Math.round(v * 100)} %`;
            const vz = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))} %`;
            const a = x.ausblick;
            const hoch = a?.hoch5 ?? null;
            const tief = a?.tief5 ?? null;
            return (
              <li key={x.mint}>
                <div className="zeile" title={x.mint}>
                  <span>
                    {x.symbol}
                    {x.frueh && (
                      <span className="kw-frueh" title="Pump/Absturz vom Früh-Modell (Token höchstens 90 s alt)">
                        früh
                      </span>
                    )}
                    {x.alarm && <AlarmAbzeichen alarm={x.alarm} />}
                  </span>
                  <span>
                    {p != null && <>p {pz(p)} · </>}
                    <b className={`kw-rat ${x.rat}`}>{x.rat === 'kaufen' ? 'KAUFEN' : x.rat === 'raus' ? 'RAUS' : 'HALTEN'}</b>
                  </span>
                </div>
                {(x.pump != null || x.absturz != null || hoch != null || tief != null) && (
                  <div className="kw-signale" data-testid="muster-signale">
                    {x.pump != null && <span title="🚀 Pump: +50 % in 2 min, bevor −20 %">
                        <Em e="🚀" /> {pz(x.pump)}
                      </span>}
                    {x.absturz != null && (
                      <span className={x.absturz >= 0.35 ? 'gefahr' : undefined} title="💥 Absturz: −30 % in 2 min, bevor +20 %">
                        <Em e="💥" /> {pz(x.absturz)}
                      </span>
                    )}
                    {(hoch != null || tief != null) && (
                      <span title="erwartetes Hoch/Tief in den nächsten 5 min gegenüber jetzt">
                        5 min: {hoch != null && <>Hoch {vz(hoch)}</>}
                        {hoch != null && tief != null && ' / '}
                        {tief != null && <>Tief {vz(tief)}</>}
                      </span>
                    )}
                  </div>
                )}
                {verlaufText(x.verlauf) && (
                  <div className="kw-verlauf mono" data-testid="muster-verlauf" title="Kursvorhersage (nur aktive Horizonte) – bewusst vorsichtig: ein verpasster Absturz zählt 3×">
                    <Em e="📈" /> {verlaufText(x.verlauf)}
                  </div>
                )}
                {p != null && (
                  <div className="kw-fortschritt">
                    <b style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="leise mono" style={{ fontSize: '0.74rem' }}>
          kein aktives Modell – Rat gibt es erst, wenn das Muster-Modell im Test klar besser als Raten ist.
        </p>
      )}
    </section>
  );
}

function TokenKerzen({ k }: { k: KryptoTokenKerzen }) {
  const f = useKwFarben();
  const B = 320;
  const H = 140;
  const letzte = k.kerzen.at(-1)!;
  // E237: Kursvorhersage – nur Punkte nach der letzten Kerze; eigener x-Bereich rechts (bis zur letzten Prognosezeit)
  const prognose = (k.prognose ?? []).filter((p) => Number.isFinite(p.c) && p.c > 0 && p.zeit > letzte.zeit).sort((a, b) => a.zeit - b.zeit);
  const mitPrognose = prognose.length > 0;
  const kerzenB = mitPrognose ? Math.round((B - 8) * 0.72) : B - 8;
  const werte = [...k.kerzen.flatMap((x) => [x.h, x.l]), ...prognose.map((p) => p.c)];
  let lo = Math.min(...werte);
  let hi = Math.max(...werte);
  if (hi - lo < hi * 1e-6) ((lo *= 0.995), (hi *= 1.005));
  const y = (v: number) => 6 + ((hi - v) / (hi - lo)) * (H - 12);
  const n = Math.max(k.kerzen.length, 30);
  const w = kerzenB / n;
  const x = (i: number) => 4 + (n - k.kerzen.length + i) * w + w / 2;
  const erst = k.kerzen[0]!.o;
  const letzt = letzte.c;
  const pz = (letzt / erst - 1) * 100;
  const xJetzt = x(k.kerzen.length - 1);
  const tEnde = prognose.at(-1)?.zeit ?? letzte.zeit;
  const xStart = xJetzt + w / 2; // eigener x-Bereich der Vorhersage: ab dem Ende der letzten Kerze bis zur letzten Prognosezeit
  const xP = (zeit: number) => xStart + ((zeit - letzte.zeit) / Math.max(1, tEnde - letzte.zeit)) * (B - 4 - xStart);
  const pLetzt = prognose.at(-1)?.c;
  const pFarbe = pLetzt == null ? f.neutral : pLetzt >= letzt ? f.gruen : f.rot;
  return (
    <div className={`kw-token-kerzen${k.alarm ? ` alarm-${k.alarm}` : ''}`}>
      <div className="zeile">
        <b>
          {k.symbol}
          {k.gehalten ? <span className="kw-gehalten"> · gehalten</span> : <span className="leise"> · beobachtet</span>}
          {k.alarm && <> <AlarmAbzeichen alarm={k.alarm} /></>}
        </b>
        <span className={pz >= 0 ? 'plus' : 'minus'}>{prozent(pz, 1)} · 10 min</span>
        <span>
          <span className="plus">{k.kaeufe}↑</span> <span className="minus">{k.verkaeufe}↓</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`${k.symbol}: ${k.kerzen.length} Kerzen, ${prozent(pz, 1)}${mitPrognose ? `, Vorhersage ${prozent((pLetzt! / letzt - 1) * 100, 1)}` : ''}`}>
        {k.kerzen.map((c, i) => {
          const farbe = c.c >= c.o ? f.gruen : f.rot;
          const kw = Math.max(1.5, w * 0.62);
          return (
            <g key={c.zeit}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={farbe} strokeWidth={1} />
              <rect x={x(i) - kw / 2} y={Math.min(y(c.o), y(c.c))} width={kw} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={farbe} />
            </g>
          );
        })}
        {mitPrognose && (
          <g data-testid="prognose">
            <line x1={xStart} x2={xStart} y1={2} y2={H - 2} stroke={f.trenn} strokeWidth={0.5} strokeDasharray="1 2" />
            <polyline
              points={[`${xJetzt},${y(letzt)}`, ...prognose.map((p) => `${xP(p.zeit)},${y(p.c)}`)].join(' ')}
              fill="none"
              stroke={pFarbe}
              strokeWidth={1.4}
              strokeDasharray="4 3"
            />
            {prognose.map((p) => (
              <circle key={p.zeit} cx={xP(p.zeit)} cy={y(p.c)} r={1.6} fill={pFarbe}>
                <title>{`in ${horizontText(Math.round((p.zeit - letzte.zeit) / 1000))}: ${prozent((p.c / letzt - 1) * 100, 1)}`}</title>
              </circle>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

function Agent({ t, jetzt }: { t: KryptoTerminal; jetzt: number }) {
  const f = useKwFarben();
  const farben = f.apple ? MODUL_FARBE_APPLE : MODUL_FARBE;
  const online = t.module.filter((m) => m.an).length;
  const lage = useMemo(
    () =>
      t.module.map((m, i) => {
        // Ellipse, um eine halbe Teilung versetzt: oben und unten nie eine Karte genau übereinander
        const w = ((i + 0.5) / t.module.length) * Math.PI * 2 - Math.PI / 2;
        return { m, x: 50 + Math.cos(w) * 39, y: 50 + Math.sin(w) * 43 };
      }),
    [t.module],
  );
  const aktiv = (m: KryptoModul) => m.an && m.zuletzt != null && jetzt - m.zuletzt < 4000;
  const ruhig = !/scoring|LLM/.test(t.status);
  return (
    <section className="kw-tafel kw-agent" aria-label="Agent">
      <div className="kw-agent-kopf">
        <h3>Agent</h3>
        <span className="kw-online">{online} Module online</span>
      </div>
      <div className="kw-kreis">
        <svg viewBox="0 0 100 100" aria-hidden>
          {lage.map(({ m, x, y }) => (
            <g key={m.schluessel}>
              <line x1={x} y1={y} x2={50} y2={50} stroke={aktiv(m) ? farben[m.schluessel] : f.modulLinie} strokeWidth={aktiv(m) ? 0.5 : 0.3} strokeDasharray={m.an ? undefined : '1 1'} />
              {aktiv(m) && (
                <circle r={1} fill={farben[m.schluessel]}>
                  <animateMotion dur="1.2s" repeatCount="indefinite" path={`M${x},${y} L50,50`} />
                </circle>
              )}
            </g>
          ))}
        </svg>
        <div className={`kw-kern${ruhig ? ' ruhig' : ''}`}>
          <div>
            <b aria-hidden>{t.bot.einstellung.avatar}</b>
            <span>{t.status}</span>
          </div>
        </div>
        {lage.map(({ m, x, y }) => (
          <div key={m.schluessel} className={`kw-modul${m.an ? '' : ' aus'}${aktiv(m) ? ` leuchtet ${m.ton}` : ''}`} style={{ left: `${x}%`, top: `${y}%` }} title={`${m.name}: ${m.zeile}`}>
            <div className="kw-modul-kopf">
              <i style={{ background: farben[m.schluessel] }}>{m.buchstabe}</i>
              {m.name}
            </div>
            <p>{m.zeile}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
