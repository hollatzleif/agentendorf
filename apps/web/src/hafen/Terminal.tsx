// E227: Terminal „Kielwasser“ – ein Bot live: Kopfzeile, Token-Leiste, Equity-Kerzen, Agent mit Prüfmodulen, Volumen,
// X-Feed, PnL und das Protokoll. Daten alle 2 s vom Dorf (das sie vom Kryptowerk holt). Alles Paper Trading.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KRYPTO_KERZEN_TAKTE, type KryptoKerze, type KryptoKerzenTakt, type KryptoModul, type KryptoTerminal, type KryptoTokenKerzen } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { farbeAus, prozent, sol, solVz, stundeWien, uhrzeit, usd, usdKurz } from './format';
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
            ← zurück zum Hafen
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
  return <Terminal t={q.data} jetzt={jetzt} takt={takt} taktWaehlen={taktWaehlen} />;
}

function Terminal({ t, jetzt, takt, taktWaehlen }: { t: KryptoTerminal; jetzt: number; takt: KryptoKerzenTakt; taktWaehlen: (t: KryptoKerzenTakt) => void }) {
  const b = t.bot;
  const k = b.kennzahlen;
  const e = b.einstellung;
  const seit = Date.parse(b.erstellt);
  const tage = Math.max(0, Math.floor((jetzt - seit) / 86_400_000));
  const letzterGeschlossen = t.trades.find((x) => x.gewinnSol != null);
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
            </div>
            <div className="kw-zeile">
              <span>{uhrzeit(jetzt, true)}</span>
              <span>seit {tage ? `${tage} T` : uhrzeit(seit)}</span>
              <span>Pump.fun · Solana</span>
              <span>{e.art === 'prompt' ? 'Prompt + LLM' : 'Regeln'}</span>
              <span className={`kw-online${t.datenOnline ? '' : ' aus'}`}>{t.datenOnline ? 'online' : 'offline'}</span>
            </div>
            {b.wallet && (
              <div className="kw-zeile" title="Eigenes Wallet dieses Bots">
                <span>
                  👛 {b.wallet.adresse.slice(0, 6)}…{b.wallet.adresse.slice(-6)}
                  {b.wallet.guthabenSol != null ? ` · ${sol(b.wallet.guthabenSol, 4)}` : ''}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="kw-konto">
          <strong>{sol(k.kapitalSol, 3)}</strong>
          <span>
            {t.solUsd ? `≈ ${usd(k.kapitalSol * t.solUsd)} · ` : ''}
            <b className={k.faktor >= 1 ? 'plus' : 'minus'}>{k.faktor.toLocaleString('de-DE', { maximumFractionDigits: 3 })}×</b> · {k.trades} Trades · {k.gewonnen}W/{k.verloren}L
          </span>
          <div className="kw-zeile" style={{ justifyContent: 'flex-end', marginTop: '0.35rem' }}>
            <a href="/gebaeude/Hafen" onClick={linkKlick}>
              ← Hafen
            </a>
          </div>
        </div>
      </header>

      <section className="kw-tafel" aria-label="Beobachtete Tokens">
        <div className="kw-pillen">
          {t.pillen.length ? (
            t.pillen.map((p) => (
              <span key={p.mint} className={`kw-token${p.gehalten ? ' aktiv' : ''}`} title={p.mint}>
                <i style={{ background: farbeAus(p.symbol) }}>{p.symbol.slice(0, 1).toUpperCase()}</i>
                {p.symbol}
                <b className={(p.prozent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozent(p.prozent, 1)}</b>
              </span>
            ))
          ) : (
            <span className="leise mono" style={{ fontSize: '0.78rem' }}>
              noch keine Tokens im Blick – {t.datenOnline ? 'neue Coins kommen laufend' : 'warte auf die Verbindung zu PumpPortal'}
            </span>
          )}
        </div>
        <div className="kw-stunden" aria-label="Gewinn je Stunde heute">
          {t.pnlStunden.map((v, i) => (
            <div key={i} className={`${i === stundeWien(jetzt) ? 'jetzt ' : ''}${v == null ? '' : v >= 0 ? 'plus' : 'minus'}`} title={v == null ? `${i}:00 – kein Trade` : `${i}:00 ${solVz(v)} SOL`}>
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
          <EquityKerzen kerzen={t.kerzen} sekunden={(t.kerzenTakt ?? '15m').endsWith('s')} start={k.startSol} letzter={letzterGeschlossen ? { symbol: letzterGeschlossen.symbol, sol: letzterGeschlossen.gewinnSol!, prozent: letzterGeschlossen.gewinnProzent!, usd: t.solUsd } : null} />
        </section>
        <Agent t={t} jetzt={jetzt} />
      </div>

      <Echtzeit t={t} />

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
              <strong className={k.heuteSol >= 0 ? 'plus' : 'minus'}>{solVz(k.heuteSol)}</strong>
            </div>
            <div>
              <span>Gesamt</span>
              <strong className={k.gewinnSol >= 0 ? 'plus' : 'minus'}>{prozent(k.gewinnProzent)}</strong>
            </div>
            <div>
              <span>Bester Trade</span>
              <strong className="plus">{t.besterTradeSol == null ? '–' : solVz(t.besterTradeSol)}</strong>
            </div>
            <div>
              <span>Rugs geblockt</span>
              <strong>{k.geblockteRugs}</strong>
            </div>
            <div>
              <span>Trefferquote</span>
              <strong>{k.trefferquote == null ? '–' : `${Math.round(k.trefferquote * 100)} %`}</strong>
            </div>
            <div>
              <span>Max. Drawdown</span>
              <strong className="minus">{k.maxDrawdownProzent ? `−${k.maxDrawdownProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : '0 %'}</strong>
            </div>
          </div>
          <div className="kw-zahlen">
            <div>
              <span>Umsatz</span>
              <strong>{sol(k.umsatzSol, 2)}</strong>
            </div>
            <div title={`Pump.fun ${sol(k.gebuehrenArt.pumpSol, 4)} · PumpPortal ${sol(k.gebuehrenArt.portalSol, 4)} · Netz/Priority ${sol(k.gebuehrenArt.netzSol, 4)}`}>
              <span>Gebühren</span>
              <strong>{sol(k.gebuehrenSol, 3)}</strong>
            </div>
          </div>
          <p className="leise mono" style={{ fontSize: '0.68rem', margin: '0.5rem 0 0' }}>
            Gebühren: Pump.fun {sol(k.gebuehrenArt.pumpSol, 4)} · PumpPortal {sol(k.gebuehrenArt.portalSol, 4)} · Netz {sol(k.gebuehrenArt.netzSol, 4)}
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
              ⬇ CSV
            </button>
          </div>
          <ul className="kw-eintraege">
            {t.trades.map((x) => (
              <li key={x.id}>
                <span>{uhrzeit(x.zeit, true)}</span>
                <span className={`kw-tag ${x.art}`}>{x.art === 'fehlschlag' ? 'FAIL' : x.art === 'kauf' ? 'BUY' : 'SELL'}</span>
                <span>
                  <b style={{ color: 'var(--kw-text)' }}>{x.symbol}</b> {x.art !== 'fehlschlag' && `${sol(x.sol)} · Slippage ${x.slippageProzent.toFixed(1)} % · `}Gebühr {sol(x.gebuehrSol, 4)} · {x.verzoegerungMs} ms
                  {x.gewinnSol != null && (
                    <b className={x.gewinnSol >= 0 ? 'plus' : 'minus'}>
                      {' '}
                      · {solVz(x.gewinnSol)} ({prozent(x.gewinnProzent)})
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

function EquityKerzen({ kerzen, start, letzter, sekunden = false }: { kerzen: KryptoKerze[]; start: number; sekunden?: boolean; letzter: { symbol: string; sol: number; prozent: number; usd: number | null } | null }) {
  const B = 640;
  const H = 420;
  const R = 62; // Preisskala rechts
  const O = 10;
  const U = 20;
  const werte = kerzen.flatMap((k) => [k.h, k.l]).concat(start);
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
  const jetzt = kerzen.at(-1);
  const skala = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  return (
    <div className="kw-chart">
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`Equity: ${jetzt ? jetzt.c.toFixed(3) : start.toFixed(3)} SOL, Start ${start.toFixed(3)} SOL`}>
        {skala.map((v) => (
          <g key={v}>
            <line x1={0} x2={B - R} y1={y(v)} y2={y(v)} stroke="#1c2236" strokeWidth={1} />
            <text x={B - R + 6} y={y(v) + 4} fill="#8a90a8" fontSize={10} fontFamily="ui-monospace, monospace">
              {v.toFixed(3)}
            </text>
          </g>
        ))}
        <line x1={0} x2={B - R} y1={y(start)} y2={y(start)} stroke="#8a90a8" strokeDasharray="4 4" strokeWidth={1} />
        <text x={4} y={y(start) - 4} fill="#8a90a8" fontSize={10} fontFamily="ui-monospace, monospace">
          Start {start.toFixed(2)}
        </text>
        {kerzen.map((k, i) => {
          const auf = k.c >= k.o;
          const farbe = auf ? '#22c55e' : '#f43f5e';
          const kw = Math.max(2, w * 0.62);
          return (
            <g key={k.zeit}>
              <title>{`${uhrzeit(k.zeit, sekunden)} O ${k.o.toFixed(3)} H ${k.h.toFixed(3)} L ${k.l.toFixed(3)} C ${k.c.toFixed(3)}`}</title>
              <line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} stroke={farbe} strokeWidth={1.5} />
              <rect x={x(i) - kw / 2} y={Math.min(y(k.o), y(k.c))} width={kw} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} rx={1.5} fill={farbe} />
            </g>
          );
        })}
        {jetzt && (
          <g>
            <line x1={0} x2={B - R} y1={y(jetzt.c)} y2={y(jetzt.c)} stroke="#8b5cf6" strokeWidth={1} opacity={0.6} />
            <rect x={B - R + 1} y={y(jetzt.c) - 9} width={R - 2} height={18} rx={4} fill="#8b5cf6" />
            <text x={B - R + 6} y={y(jetzt.c) + 4} fill="#fff" fontSize={10.5} fontWeight={700} fontFamily="ui-monospace, monospace">
              {jetzt.c.toFixed(3)}
            </text>
          </g>
        )}
      </svg>
      {letzter && (
        <div className="kw-popup" style={{ right: '13%', top: '0.6rem' }}>
          <b>{letzter.symbol}</b> · 1× (kein Hebel)
          <br />
          <span className={letzter.sol >= 0 ? 'plus' : 'minus'}>
            {solVz(letzter.sol)} SOL{letzter.usd ? ` (${usd(letzter.sol * letzter.usd)})` : ''} · {prozent(letzter.prozent)}
          </span>
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
        <h3>⚡ Echtzeit-Kurse · 5 s</h3>
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

function TokenKerzen({ k }: { k: KryptoTokenKerzen }) {
  const B = 320;
  const H = 140;
  const werte = k.kerzen.flatMap((x) => [x.h, x.l]);
  let lo = Math.min(...werte);
  let hi = Math.max(...werte);
  if (hi - lo < hi * 1e-6) ((lo *= 0.995), (hi *= 1.005));
  const y = (v: number) => 6 + ((hi - v) / (hi - lo)) * (H - 12);
  const n = Math.max(k.kerzen.length, 30);
  const w = (B - 8) / n;
  const x = (i: number) => 4 + (n - k.kerzen.length + i) * w + w / 2;
  const erst = k.kerzen[0]!.o;
  const letzt = k.kerzen.at(-1)!.c;
  const pz = (letzt / erst - 1) * 100;
  return (
    <div className="kw-token-kerzen">
      <div className="zeile">
        <b>
          {k.symbol}
          {k.gehalten ? <span className="kw-gehalten"> · gehalten</span> : <span className="leise"> · beobachtet</span>}
        </b>
        <span className={pz >= 0 ? 'plus' : 'minus'}>{prozent(pz, 1)} · 10 min</span>
        <span>
          <span className="plus">{k.kaeufe}↑</span> <span className="minus">{k.verkaeufe}↓</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`${k.symbol}: ${k.kerzen.length} Kerzen, ${prozent(pz, 1)}`}>
        {k.kerzen.map((c, i) => {
          const farbe = c.c >= c.o ? '#22c55e' : '#f43f5e';
          const kw = Math.max(1.5, w * 0.62);
          return (
            <g key={c.zeit}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={farbe} strokeWidth={1} />
              <rect x={x(i) - kw / 2} y={Math.min(y(c.o), y(c.c))} width={kw} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={farbe} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Agent({ t, jetzt }: { t: KryptoTerminal; jetzt: number }) {
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
              <line x1={x} y1={y} x2={50} y2={50} stroke={aktiv(m) ? MODUL_FARBE[m.schluessel] : '#232a40'} strokeWidth={aktiv(m) ? 0.5 : 0.3} strokeDasharray={m.an ? undefined : '1 1'} />
              {aktiv(m) && (
                <circle r={1} fill={MODUL_FARBE[m.schluessel]}>
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
              <i style={{ background: MODUL_FARBE[m.schluessel] }}>{m.buchstabe}</i>
              {m.name}
            </div>
            <p>{m.zeile}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
