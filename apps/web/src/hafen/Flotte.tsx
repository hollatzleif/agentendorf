// E227: Hafen → Flotte – alle Bots im Vergleich (Kapital, Gewinn, Trades, Kurve), anlegen/bearbeiten/pausieren/löschen,
// Not-Aus. Jeder neue Bot läuft im Paper Trading.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KRYPTO_PAPER_MINDESTENS_STUNDEN, KRYPTO_STANDARD, type KryptoBacktest, type KryptoBot, type KryptoEinstellung, type KryptoUebersicht } from '@dorf/shared';
import { ApiFehler, api } from '../api';
import { linkKlick } from '../router';
import { prozent, sol, solVz, uhrzeit } from './format';
import './hafen.css';

/** feste Farbreihenfolge je Bot (nach Anlage), nie zyklisch nach Rang */
const FARBEN = ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#64748b', '#d946ef', '#84cc16'];

export function HafenFlotte() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['krypto'], queryFn: () => api<KryptoUebersicht>('/api/krypto'), refetchInterval: 5000 });
  const [form, setForm] = useState<{ id?: string; e: KryptoEinstellung } | null>(null);
  const [dialog, setDialog] = useState<{ art: 'scharf' | 'auszahlen' | 'backtest'; bot: KryptoBot } | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const neu = () => qc.invalidateQueries({ queryKey: ['krypto'] });
  const tun = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => void neu(),
    onError: (e) => setMeldung(e instanceof ApiFehler ? e.message : String(e)),
  });
  const u = q.data;
  if (!u) return <p className="leise">Lade den Hafen …</p>;
  const farbe = (id: string) => FARBEN[u.bots.findIndex((b) => b.id === id) % FARBEN.length]!;

  return (
    <div className="hafen" style={{ display: 'grid', gap: '0.8rem' }}>
      <div className="karte innen hafen-kopf">
        <div>
          <h3 style={{ margin: 0 }}>⚓ Flotte</h3>
          <span className="leise">
            {u.verbunden ? (u.datenOnline ? `🟢 Pump.fun live · ${u.beobachtet} Tokens im Blick` : '⚪ wartet auf Daten (verbindet, sobald ein Bot läuft)') : '🔴 Kryptowerk nicht erreichbar'}
            {u.solUsd ? ` · SOL ≈ $${u.solUsd.toLocaleString('de-DE', { maximumFractionDigits: 2 })}` : ''}
          </span>
        </div>
        <div className="hafen-knoepfe">
          <button type="button" onClick={() => setForm({ e: structuredClone(KRYPTO_STANDARD) })} disabled={!u.verbunden}>
            + Neuer Bot
          </button>
          {u.notaus ? (
            <button type="button" onClick={() => tun.mutate(() => api('/api/krypto/notaus/aufheben', { methode: 'POST' }))}>
              Not-Aus aufheben
            </button>
          ) : (
            <button
              type="button"
              className="hafen-notaus"
              disabled={!u.verbunden}
              onClick={() => {
                if (window.confirm('Not-Aus: alle Bots sofort stoppen und offene Positionen (simuliert) verkaufen?')) tun.mutate(() => api('/api/krypto/notaus', { methode: 'POST' }));
              }}
            >
              🛑 Not-Aus
            </button>
          )}
        </div>
      </div>
      {u.fehler && <p className="hinweis">{u.fehler}</p>}
      {u.notaus && <p className="hinweis">Not-Aus ist aktiv – alle Bots stehen. „Not-Aus aufheben“, dann jeden Bot einzeln starten.</p>}
      {meldung && (
        <p className="hinweis" role="alert">
          {meldung}{' '}
          <button type="button" className="klein" onClick={() => setMeldung(null)}>
            ok
          </button>
        </p>
      )}
      <p className="hafen-hinweis leise">
        <b>Paper Trading:</b> echte Live-Daten von Pump.fun, aber nur simulierte Trades – mit Pump.fun-Gebühren, Slippage aus der Bonding Curve, Verzögerung und fehlgeschlagenen Transaktionen. Kein Wallet, kein Hebel. Die meisten neuen
        Coins verlieren schnell an Wert – das zeigt sich hier ohne echtes Geld.
      </p>

      {form && (
        <BotFormular
          start={form.e}
          {...(form.id ? { id: form.id } : {})}
          fertig={() => {
            setForm(null);
            void neu();
          }}
          abbrechen={() => setForm(null)}
        />
      )}

      {dialog?.art === 'scharf' && <ScharfDialog bot={dialog.bot} fertig={() => (setDialog(null), void neu())} />}
      {dialog?.art === 'auszahlen' && <AuszahlenDialog bot={dialog.bot} an={u.auszahlung ?? ''} fertig={() => (setDialog(null), void neu())} />}
      {dialog?.art === 'backtest' && <BacktestPanel bot={dialog.bot} schliessen={() => setDialog(null)} />}

      {u.bots.length > 0 && <Vergleich bots={u.bots} farbe={farbe} />}

      <div className="hafen-bots">
        {u.bots.map((b) => (
          <BotKarte
            key={b.id}
            b={b}
            farbe={farbe(b.id)}
            notaus={u.notaus}
            bearbeiten={() => setForm({ id: b.id, e: structuredClone(b.einstellung) })}
            tun={(f) => tun.mutate(f)}
            liveMoeglich={!!u.liveMoeglich}
            auszahlung={u.auszahlung ?? null}
            oeffnen={(art) => setDialog({ art, bot: b })}
          />
        ))}
        {!u.bots.length && u.verbunden && <p className="leise">Noch keine Bots. „+ Neuer Bot“ legt einen mit vorsichtigen Standardwerten an.</p>}
      </div>
    </div>
  );
}

function BotKarte({ b, farbe, notaus, bearbeiten, tun, liveMoeglich, auszahlung, oeffnen }: { b: KryptoBot; farbe: string; notaus: boolean; bearbeiten: () => void; tun: (f: () => Promise<unknown>) => void; liveMoeglich: boolean; auszahlung: string | null; oeffnen: (art: 'scharf' | 'auszahlen' | 'backtest') => void }) {
  const k = b.kennzahlen;
  const e = b.einstellung;
  const live = b.modus === 'live';
  return (
    <article className="karte innen hafen-bot" aria-label={`Bot ${e.name}`} style={{ borderTop: `4px solid ${farbe}` }}>
      <div className="hafen-bot-kopf">
        <span className="avatar" aria-hidden>
          {e.avatar}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{e.name}</strong>
          <div className="leise" style={{ fontSize: '0.8rem' }}>
            {b.status === 'laeuft' ? '🟢 läuft' : b.status === 'pausiert' ? '⏸ pausiert' : '🛑 gestoppt'} · {live ? <b className="hafen-live">LIVE · echtes Geld</b> : 'Paper'} · {e.art === 'prompt' ? 'Prompt' : 'Regeln'}
          </div>
        </div>
        <strong className={k.gewinnSol >= 0 ? 'plus' : 'minus'}>{prozent(k.gewinnProzent)}</strong>
      </div>
      <div className="hafen-zahlen">
        <div>
          <span>Kapital</span>
          <b>{sol(k.kapitalSol, 2)}</b>
        </div>
        <div>
          <span>Gewinn</span>
          <b className={k.gewinnSol >= 0 ? 'plus' : 'minus'}>{solVz(k.gewinnSol, 2)}</b>
        </div>
        <div>
          <span>Trades</span>
          <b>
            {k.trades} · {k.gewonnen}W/{k.verloren}L
          </b>
        </div>
        <div>
          <span>Trefferquote</span>
          <b>{k.trefferquote == null ? '–' : `${Math.round(k.trefferquote * 100)} %`}</b>
        </div>
        <div>
          <span>Max. Drawdown</span>
          <b>{k.maxDrawdownProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</b>
        </div>
        <div>
          <span>Offen · Rugs</span>
          <b>
            {k.offen} · {k.geblockteRugs}
          </b>
        </div>
      </div>
      {b.wallet && (
        <div className="leise hafen-wallet" title="Eigenes, neu erzeugtes Wallet dieses Bots">
          👛 <code>{b.wallet.adresse.slice(0, 6)}…{b.wallet.adresse.slice(-6)}</code>
          <button type="button" className="klein" onClick={() => void navigator.clipboard?.writeText(b.wallet!.adresse)}>
            Kopieren
          </button>
          {b.wallet.guthabenSol != null && <span> · {sol(b.wallet.guthabenSol, 4)}</span>}
        </div>
      )}
      {live && b.live && <div className="leise">Scharf seit {new Date(b.live.seit).toLocaleString('de-AT')} · Budget {sol(b.live.budgetSol, 2)}</div>}
      {!live && b.paperBilanz && <div className="leise">Letzter Live-Abschnitt vorher: {prozent(b.paperBilanz.gewinnProzent)}</div>}
      <div className="hafen-knoepfe">
        <a className="knopf klein" href={`/hafen/${b.id}`} onClick={linkKlick}>
          Terminal öffnen
        </a>
        {!live && e.art === 'regeln' && (
          <button type="button" className="klein" onClick={() => oeffnen('backtest')}>
            Backtest
          </button>
        )}
        {!live && liveMoeglich && b.wallet && (
          <button type="button" className="klein" onClick={() => oeffnen('scharf')}>
            🎯 Scharf schalten
          </button>
        )}
        {live && (
          <button
            type="button"
            className="klein"
            onClick={() => {
              if (window.confirm('Zurück ins Paper Trading? Geht nur ohne offene Positionen (vorher pausieren oder Not-Aus).')) tun(() => api(`/api/krypto/bots/${b.id}/entschaerfen`, { methode: 'POST' }));
            }}
          >
            Entschärfen
          </button>
        )}
        {auszahlung && b.wallet && (b.wallet.guthabenSol ?? 0) > 0 && (
          <button type="button" className="klein" onClick={() => oeffnen('auszahlen')}>
            Auszahlen
          </button>
        )}
        {b.status === 'laeuft' ? (
          <button type="button" className="klein" onClick={() => tun(() => api(`/api/krypto/bots/${b.id}/status`, { methode: 'POST', body: { status: 'pausiert' } }))}>
            Pausieren
          </button>
        ) : (
          <button type="button" className="klein" disabled={notaus} onClick={() => tun(() => api(`/api/krypto/bots/${b.id}/status`, { methode: 'POST', body: { status: 'laeuft' } }))}>
            Starten
          </button>
        )}
        <button type="button" className="klein" onClick={bearbeiten}>
          Bearbeiten
        </button>
        <button
          type="button"
          className="klein"
          onClick={() => {
            if (window.confirm(`„${e.name}“ mit allen Trades und dem Protokoll löschen?`)) tun(() => api(`/api/krypto/bots/${b.id}`, { methode: 'DELETE' }));
          }}
        >
          Löschen
        </button>
      </div>
    </article>
  );
}

/** Vergleich: Kapital aller Bots relativ zum Startkapital (Index 100 = Start), eine Achse */
function Vergleich({ bots, farbe }: { bots: KryptoBot[]; farbe: (id: string) => string }) {
  const B = 720;
  const H = 220;
  const reihen = bots.map((b) => ({ id: b.id, name: b.einstellung.name, punkte: b.kurve.map(([t, w]) => [t, (w / b.kennzahlen.startSol) * 100] as [number, number]) }));
  const alle = reihen.flatMap((r) => r.punkte);
  const t0 = Math.min(...alle.map((p) => p[0]));
  const t1 = Math.max(...alle.map((p) => p[0]), t0 + 3_600_000);
  let lo = Math.min(100, ...alle.map((p) => p[1]));
  let hi = Math.max(100, ...alle.map((p) => p[1]));
  const pad = Math.max(1, (hi - lo) * 0.1);
  lo -= pad;
  hi += pad;
  const x = (t: number) => 44 + ((t - t0) / (t1 - t0)) * (B - 54);
  const y = (v: number) => 10 + ((hi - v) / (hi - lo)) * (H - 30);
  return (
    <section className="karte innen" aria-label="Vergleich der Bots">
      <h3 style={{ marginTop: 0 }}>Kurven im Vergleich (Start = 100)</h3>
      <svg viewBox={`0 0 ${B} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Kapital der Bots relativ zum Start">
        {[lo + (hi - lo) * 0.25, 100, lo + (hi - lo) * 0.75].map((v) => (
          <g key={v}>
            <line x1={44} x2={B - 10} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={v === 100 ? 0.45 : 0.12} strokeDasharray={v === 100 ? '4 4' : undefined} />
            <text x={4} y={y(v) + 4} fontSize={11} fill="currentColor" opacity={0.6}>
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {reihen.map((r) => (
          <polyline key={r.id} fill="none" stroke={farbe(r.id)} strokeWidth={2} strokeLinejoin="round" points={r.punkte.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')} />
        ))}
        <text x={44} y={H - 4} fontSize={11} fill="currentColor" opacity={0.6}>
          {new Date(t0).toLocaleDateString('de-AT')} {uhrzeit(t0)}
        </text>
        <text x={B - 10} y={H - 4} fontSize={11} fill="currentColor" opacity={0.6} textAnchor="end">
          jetzt
        </text>
      </svg>
      <ul className="diagramm-legende" aria-label="Legende" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 1rem', listStyle: 'none', padding: 0, margin: '0.3rem 0 0' }}>
        {bots.map((b) => (
          <li key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '0.8rem', height: '0.8rem', borderRadius: '50%', background: farbe(b.id) }} />
            {b.einstellung.avatar} {b.einstellung.name} <b className={b.kennzahlen.gewinnSol >= 0 ? 'plus' : 'minus'}>{prozent(b.kennzahlen.gewinnProzent)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

const AVATARE = ['🐟', '🦈', '🐙', '🦀', '🐋', '🐡', '🦑', '🐬', '🚢', '⚓', '🧭', '🌊'];

function BotFormular({ start, id, fertig, abbrechen }: { start: KryptoEinstellung; id?: string; fertig: () => void; abbrechen: () => void }) {
  const [e, setE] = useState<KryptoEinstellung>(start);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const setzen = <K extends keyof KryptoEinstellung>(k: K, v: KryptoEinstellung[K]) => setE((x) => ({ ...x, [k]: v }));
  const zahl = <G extends 'filter' | 'limits' | 'ausstieg' | 'simulation' | 'regeln'>(g: G, k: keyof KryptoEinstellung[G], label: string, o: { schritt?: number; hilfe?: string } = {}) => (
    <label title={o.hilfe}>
      {label}
      <input
        type="number"
        step={o.schritt ?? 'any'}
        value={String((e[g] as Record<string, unknown>)[k as string])}
        onChange={(ev) => setE((x) => ({ ...x, [g]: { ...(x[g] as object), [k]: Number(ev.target.value) } }))}
      />
    </label>
  );
  const speichern = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      await api(id ? `/api/krypto/bots/${id}` : '/api/krypto/bots', { methode: id ? 'PUT' : 'POST', body: { einstellung: e } });
      fertig();
    } catch (x) {
      setFehler(x instanceof ApiFehler ? x.message : String(x));
    } finally {
      setLaeuft(false);
    }
  };
  return (
    <section className="karte innen hafen-formular" aria-label={id ? 'Bot bearbeiten' : 'Neuer Bot'}>
      <h3 style={{ marginTop: 0 }}>{id ? `${e.name} bearbeiten` : 'Neuer Bot (Paper Trading)'}</h3>
      <fieldset>
        <legend>Bot</legend>
        <label>
          Name
          <input value={e.name} maxLength={40} onChange={(ev) => setzen('name', ev.target.value)} />
        </label>
        <label>
          Avatar
          <select value={e.avatar} onChange={(ev) => setzen('avatar', ev.target.value)}>
            {AVATARE.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Startkapital (SOL, simuliert)
          <input type="number" step="any" value={e.startkapitalSol} onChange={(ev) => setzen('startkapitalSol', Number(ev.target.value))} />
        </label>
        <label>
          Strategie
          <select value={e.art} onChange={(ev) => setzen('art', ev.target.value as 'regeln' | 'prompt')}>
            <option value="regeln">Regeln (Punkte aus den Modulen)</option>
            <option value="prompt">Prompt (LLM schlägt vor, Code entscheidet)</option>
          </select>
        </label>
        {e.art === 'prompt' ? (
          <>
            <label className="breit">
              Strategie in deinen Worten
              <textarea rows={4} value={e.prompt} maxLength={4000} onChange={(ev) => setzen('prompt', ev.target.value)} placeholder="z. B. Kaufe nur, wenn Käufer klar überwiegen, der Entwickler wenig hält und das Volumen in den letzten 5 Minuten steigt. Meide Namen, die bekannte Marken nachahmen." />
            </label>
            <label>
              Kauf ab Sicherheit (0–1)
              <input type="number" step={0.05} min={0} max={1} value={e.minSicherheit} onChange={(ev) => setzen('minSicherheit', Number(ev.target.value))} />
            </label>
            {zahl('limits', 'maxLlmProTag', 'LLM-Bewertungen je Tag höchstens', { schritt: 1, hilfe: 'Dazu gilt im Dorf eine harte Grenze von 0,50 $ je Bot und Tag.' })}
          </>
        ) : (
          zahl('regeln', 'minPunkte', 'Kaufen ab Punkten (0–100)', { schritt: 1 })
        )}
      </fieldset>
      <fieldset>
        <legend>Filter (harte Regeln)</legend>
        {zahl('filter', 'maxRugScore', 'RugCheck-Score höchstens (0–100)', { schritt: 1 })}
        <label>
          Keine „danger“-Risiken
          <select value={e.filter.keineGefahr ? 'ja' : 'nein'} onChange={(ev) => setE((x) => ({ ...x, filter: { ...x.filter, keineGefahr: ev.target.value === 'ja' } }))}>
            <option value="ja">ja</option>
            <option value="nein">nein</option>
          </select>
        </label>
        {zahl('filter', 'minVolumenUsdM5', 'Volumen 5 min mindestens ($)')}
        {zahl('filter', 'minKaeufeM5', 'Käufe 5 min mindestens', { schritt: 1 })}
        {zahl('filter', 'minKaufVerhaeltnis', 'Käufe ÷ Verkäufe mindestens')}
        {zahl('filter', 'minAlterSek', 'Alter mindestens (s)', { schritt: 1 })}
        {zahl('filter', 'maxAlterSek', 'Alter höchstens (s)', { schritt: 1 })}
        {zahl('filter', 'minMarketCapUsd', 'Marktwert mindestens ($)')}
        {zahl('filter', 'maxMarketCapUsd', 'Marktwert höchstens ($)')}
        {zahl('filter', 'maxDevProzent', 'Entwickler hält höchstens (%)')}
        {zahl('filter', 'maxTopHalterProzent', 'Größter Halter höchstens (%)')}
        {zahl('filter', 'minLiquiditaetSol', 'Liquidität mindestens (SOL)')}
      </fieldset>
      <fieldset>
        <legend>Risikolimits (setzt der Code durch)</legend>
        {zahl('limits', 'einsatzProTradeSol', 'Einsatz je Trade höchstens (SOL)')}
        {zahl('limits', 'positionProzent', 'Positionsgröße (% des Kapitals)')}
        {zahl('limits', 'maxTagesverlustSol', 'Tagesverlust höchstens (SOL)')}
        {zahl('limits', 'maxOffen', 'Offene Positionen höchstens', { schritt: 1 })}
      </fieldset>
      <fieldset>
        <legend>Ausstieg</legend>
        {e.ausstieg.takeProfit.map((tp, i) => (
          <label key={i}>
            Take-Profit {i + 1}: bei +% / verkaufe %
            <span style={{ display: 'flex', gap: '0.3rem' }}>
              <input type="number" value={tp.beiProzent} aria-label={`Take-Profit ${i + 1} bei Prozent`} onChange={(ev) => setE((x) => ({ ...x, ausstieg: { ...x.ausstieg, takeProfit: x.ausstieg.takeProfit.map((t, j) => (j === i ? { ...t, beiProzent: Number(ev.target.value) } : t)) } }))} />
              <input type="number" value={tp.verkaufProzent} aria-label={`Take-Profit ${i + 1} verkaufe Prozent`} onChange={(ev) => setE((x) => ({ ...x, ausstieg: { ...x.ausstieg, takeProfit: x.ausstieg.takeProfit.map((t, j) => (j === i ? { ...t, verkaufProzent: Number(ev.target.value) } : t)) } }))} />
              <button type="button" className="klein" aria-label={`Take-Profit ${i + 1} entfernen`} onClick={() => setE((x) => ({ ...x, ausstieg: { ...x.ausstieg, takeProfit: x.ausstieg.takeProfit.filter((_, j) => j !== i) } }))}>
                ✕
              </button>
            </span>
          </label>
        ))}
        {e.ausstieg.takeProfit.length < 6 && (
          <button type="button" className="klein" style={{ alignSelf: 'end' }} onClick={() => setE((x) => ({ ...x, ausstieg: { ...x.ausstieg, takeProfit: [...x.ausstieg.takeProfit, { beiProzent: 300, verkaufProzent: 100 }] } }))}>
            + Stufe
          </button>
        )}
        {zahl('ausstieg', 'stopLossProzent', 'Stop-Loss (% Verlust)')}
        {zahl('ausstieg', 'trailingProzent', 'Trailing Stop (% vom Hoch, 0 = aus)')}
        {zahl('ausstieg', 'maxHaltMinuten', 'Haltedauer höchstens (min)', { schritt: 1 })}
      </fieldset>
      <fieldset>
        <legend>Simulation (realistisch, nicht schönen)</legend>
        {zahl('simulation', 'verzoegerungMs', 'Verzögerung (ms, mind. 300)', { schritt: 100 })}
        {zahl('simulation', 'prioritaetSol', 'Priority Fee je Transaktion (SOL)')}
        {zahl('simulation', 'fehlschlagProzent', 'Fehlgeschlagene Transaktionen (%)', { schritt: 1 })}
      </fieldset>
      {fehler && (
        <p className="hinweis" role="alert">
          {fehler}
        </p>
      )}
      <div className="hafen-knoepfe">
        <button type="button" onClick={() => void speichern()} disabled={laeuft}>
          {laeuft ? 'Speichere …' : id ? 'Speichern' : 'Bot anlegen (Paper)'}
        </button>
        <button type="button" className="klein" onClick={abbrechen}>
          Abbrechen
        </button>
      </div>
    </section>
  );
}

function useTotpAktiv() {
  return useQuery({ queryKey: ['ich'], queryFn: () => api<{ totpAktiv: boolean }>('/api/ich') }).data?.totpAktiv ?? false;
}

/** E228: Scharf schalten – echtes Geld. Passwort (+ Code), getipptes SCHARF, Budget. */
function ScharfDialog({ bot, fertig }: { bot: KryptoBot; fertig: () => void }) {
  const totp = useTotpAktiv();
  const [budget, setBudget] = useState(0.5);
  const [passwort, setPasswort] = useState('');
  const [code, setCode] = useState('');
  const [wort, setWort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const stunden = (Date.now() - Date.parse(bot.abschnittSeit)) / 3_600_000;
  const los = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      await api(`/api/krypto/bots/${bot.id}/scharf`, { methode: 'POST', body: { budgetSol: budget, bestaetigung: wort, passwort, ...(totp ? { code } : {}) } });
      fertig();
    } catch (x) {
      setFehler(x instanceof ApiFehler ? x.message : String(x));
    } finally {
      setLaeuft(false);
    }
  };
  return (
    <section className="karte innen hafen-formular hafen-scharf" aria-label="Scharf schalten">
      <h3 style={{ marginTop: 0 }}>🎯 {bot.einstellung.name} scharf schalten</h3>
      <p className="hafen-hinweis">
        Ab jetzt handelt der Bot mit <b>echtem Geld</b> aus seinem eigenen Wallet <code>{bot.wallet?.adresse}</code>. Schick vorher SOL dorthin (z. B. aus Phantom) – mindestens Budget + 0,02 SOL für Gebühren. Die meisten neuen Coins verlieren schnell an Wert;
        Verluste sind echt. Fang klein an.
      </p>
      <ul className="leise">
        <li>{stunden >= KRYPTO_PAPER_MINDESTENS_STUNDEN ? '✓' : '✗'} mindestens {KRYPTO_PAPER_MINDESTENS_STUNDEN} h im Paper Trading (jetzt {Math.floor(stunden)} h) – Paper-Ergebnis: {prozent(bot.kennzahlen.gewinnProzent)} bei {bot.kennzahlen.trades} Trades</li>
        <li>{bot.kennzahlen.offen === 0 ? '✓' : '✗'} keine offenen Paper-Positionen</li>
        <li>Wallet: {bot.wallet?.guthabenSol == null ? 'Guthaben wird geprüft' : sol(bot.wallet.guthabenSol, 4)}</li>
        <li>Grenzen im Code: Einsatz je Trade höchstens {sol(bot.einstellung.limits.einsatzProTradeSol, 2)} bzw. {bot.einstellung.limits.positionProzent} % des Budgets, Tagesverlust höchstens {sol(bot.einstellung.limits.maxTagesverlustSol, 2)}, höchstens {bot.einstellung.limits.maxOffen} offene Positionen. Kein Hebel.</li>
      </ul>
      <fieldset>
        <legend>Bestätigen</legend>
        <label>
          Budget (SOL, 0,05–50)
          <input type="number" step="0.05" min={0.05} max={50} value={budget} onChange={(ev) => setBudget(Number(ev.target.value))} />
        </label>
        <label>
          Dein Passwort
          <input type="password" autoComplete="current-password" value={passwort} onChange={(ev) => setPasswort(ev.target.value)} />
        </label>
        {totp && (
          <label>
            Code (Authenticator)
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(ev) => setCode(ev.target.value)} />
          </label>
        )}
        <label>
          Zum Bestätigen SCHARF eintippen
          <input value={wort} onChange={(ev) => setWort(ev.target.value)} />
        </label>
      </fieldset>
      {fehler && (
        <p className="hinweis" role="alert">
          {fehler}
        </p>
      )}
      <div className="hafen-knoepfe">
        <button type="button" className="hafen-notaus" disabled={laeuft || wort !== 'SCHARF' || !passwort} onClick={() => void los()}>
          {laeuft ? 'Prüfe …' : 'Mit echtem Geld handeln'}
        </button>
        <button type="button" className="klein" onClick={fertig}>
          Abbrechen
        </button>
      </div>
    </section>
  );
}

function AuszahlenDialog({ bot, an, fertig }: { bot: KryptoBot; an: string; fertig: () => void }) {
  const totp = useTotpAktiv();
  const [passwort, setPasswort] = useState('');
  const [code, setCode] = useState('');
  const [meldung, setMeldung] = useState<string | null>(null);
  const los = async () => {
    try {
      const r = await api<{ signatur: string; betragSol: number }>(`/api/krypto/bots/${bot.id}/auszahlen`, { methode: 'POST', body: { passwort, ...(totp ? { code } : {}) } });
      setMeldung(`Ausgezahlt: ${sol(r.betragSol, 4)} – Transaktion ${r.signatur}`);
    } catch (x) {
      setMeldung(x instanceof ApiFehler ? x.message : String(x));
    }
  };
  return (
    <section className="karte innen hafen-formular" aria-label="Auszahlen">
      <h3 style={{ marginTop: 0 }}>Auszahlen: {bot.einstellung.name}</h3>
      <p className="leise">
        Das ganze Guthaben ({bot.wallet?.guthabenSol == null ? '?' : sol(bot.wallet.guthabenSol, 4)}) geht an deine feste Adresse <code>{an}</code>. Eine andere Adresse geht nur auf dem Server (dorf krypto-auszahlung).
      </p>
      <fieldset>
        <label>
          Dein Passwort
          <input type="password" autoComplete="current-password" value={passwort} onChange={(ev) => setPasswort(ev.target.value)} />
        </label>
        {totp && (
          <label>
            Code (Authenticator)
            <input inputMode="numeric" value={code} onChange={(ev) => setCode(ev.target.value)} />
          </label>
        )}
      </fieldset>
      {meldung && (
        <p className="hinweis" role="status">
          {meldung}
        </p>
      )}
      <div className="hafen-knoepfe">
        <button type="button" disabled={!passwort} onClick={() => void los()}>
          Auszahlen
        </button>
        <button type="button" className="klein" onClick={fertig}>
          Schließen
        </button>
      </div>
    </section>
  );
}

/** E228: Backtest mit den Einstellungen eines Regel-Bots über die Aufzeichnungen */
function BacktestPanel({ bot, schliessen }: { bot: KryptoBot; schliessen: () => void }) {
  const [stunden, setStunden] = useState<number | null>(24);
  const [id, setId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const liste = useQuery({ queryKey: ['krypto', 'backtests'], queryFn: () => api<{ bereich: { von: string | null; bis: string | null }; jobs: KryptoBacktest[] }>('/api/krypto/backtests') });
  const job = useQuery({ queryKey: ['krypto', 'backtest', id], queryFn: () => api<KryptoBacktest>(`/api/krypto/backtests/${id}`), enabled: !!id, refetchInterval: (q) => (q.state.data?.status === 'laeuft' ? 1000 : false) });
  const starten = async () => {
    setFehler(null);
    try {
      const j = await api<KryptoBacktest>('/api/krypto/backtests', { methode: 'POST', body: { einstellung: bot.einstellung, ...(stunden ? { vonStunden: stunden } : {}) } });
      setId(j.id);
    } catch (x) {
      setFehler(x instanceof ApiFehler ? x.message : String(x));
    }
  };
  const b = liste.data?.bereich;
  const j = job.data;
  const k = j?.ergebnis?.kennzahlen;
  return (
    <section className="karte innen" aria-label="Backtest">
      <div className="hafen-kopf">
        <h3 style={{ margin: 0 }}>Backtest: {bot.einstellung.avatar} {bot.einstellung.name}</h3>
        <button type="button" className="klein" onClick={schliessen}>
          Schließen
        </button>
      </div>
      <p className="leise">
        Spielt die aufgezeichneten Pump.fun-Daten {b?.von ? `(${new Date(b.von).toLocaleString('de-AT')} bis ${new Date(b.bis!).toLocaleString('de-AT')})` : '(noch keine)'} mit genau diesen Regeln ab – gleiche Filter, gleiches Gate, gleiche Gebühren, Slippage, Verzögerung, Fehlschläge.
        Die Aufzeichnung kennt Kurse alle paar Sekunden, nicht jeden Trade: gut zum Vergleichen von Strategien, kein Versprechen.
      </p>
      <div className="hafen-knoepfe">
        {[6, 24, 72, 168, null].map((h) => (
          <button key={String(h)} type="button" className={`klein${stunden === h ? ' an' : ''}`} onClick={() => setStunden(h)}>
            {h == null ? 'Alles' : h < 24 ? `${h} h` : `${h / 24} T`}
          </button>
        ))}
        <button type="button" onClick={() => void starten()} disabled={j?.status === 'laeuft'}>
          {j?.status === 'laeuft' ? `Läuft … ${j.fortschritt} %` : '▶ Backtest starten'}
        </button>
      </div>
      {fehler && (
        <p className="hinweis" role="alert">
          {fehler}
        </p>
      )}
      {j?.status === 'fehler' && <p className="hinweis">{j.fehler}</p>}
      {k && j?.ergebnis && (
        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.6rem' }}>
          <div className="hafen-zahlen">
            <div>
              <span>Ergebnis</span>
              <b className={k.gewinnSol >= 0 ? 'plus' : 'minus'}>
                {solVz(k.gewinnSol, 3)} ({prozent(k.gewinnProzent)})
              </b>
            </div>
            <div>
              <span>Trades</span>
              <b>
                {k.trades} · {k.gewonnen}W/{k.verloren}L
              </b>
            </div>
            <div>
              <span>Max. Drawdown</span>
              <b>{k.maxDrawdownProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</b>
            </div>
            <div>
              <span>Umsatz</span>
              <b>{sol(k.umsatzSol, 2)}</b>
            </div>
            <div>
              <span>Gebühren</span>
              <b>{sol(k.gebuehrenSol, 4)}</b>
            </div>
            <div>
              <span>Entscheidungen</span>
              <b>
                {j.ergebnis.entscheidungen.buy} Käufe · {j.ergebnis.entscheidungen.block} geblockt
              </b>
            </div>
          </div>
          <span className="leise">
            Daten: {j.daten?.tokens} Tokens, {j.daten?.kurse} Kurse, {j.daten?.rug} RugCheck-Berichte
          </span>
          <ul className="hafen-trades">
            {j.ergebnis.trades.slice(0, 30).map((t) => (
              <li key={t.id}>
                <span>{new Date(t.zeit).toLocaleString('de-AT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                <b>{t.art === 'kauf' ? 'Kauf' : t.art === 'verkauf' ? 'Verkauf' : 'Fehlschlag'}</b> {t.symbol} {t.art !== 'fehlschlag' && sol(t.sol)} · Gebühr {sol(t.gebuehrSol, 4)}
                {t.gewinnSol != null && <b className={t.gewinnSol >= 0 ? 'plus' : 'minus'}> {solVz(t.gewinnSol)}</b>} <span className="leise">{t.grund}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
