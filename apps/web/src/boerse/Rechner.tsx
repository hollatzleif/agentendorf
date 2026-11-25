import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { entnahme, kostenEffekt, rebalancing, sparplan, verdopplungJahre, wasWaereWenn, type BoerseAnalyse, type Punkt } from '@dorf/shared';
import { api } from '../api';
import { EmText } from '../hafen/zeichen';
import { LinienDiagramm, datumKurz, geldFormat, prozentText, usePrivat } from './teile';

/** Zahl aus einem deutschen Eingabefeld („1.234,5“ oder „1234.5“) */
const zahl = (t: string) => {
  const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
function Feld({ text, wert, setzen, einheit, hilfe }: { text: string; wert: string; setzen: (x: string) => void; einheit?: string; hilfe?: string }) {
  return (
    <label className="rechner-feld" title={hilfe}>
      <span>{text}</span>
      <span className="rechner-eingabe">
        <input inputMode="decimal" value={wert} onChange={(e) => setzen(e.target.value)} aria-label={text} />
        {einheit && <span className="leise">{einheit}</span>}
      </span>
    </label>
  );
}
/** Eingaben merken sich das Gerät (je Rechner) */
function useFelder<T extends Record<string, string>>(name: string, start: T): [T, (k: keyof T, v: string) => void] {
  const [f, setF] = useState<T>(() => ({ ...start, ...(JSON.parse(localStorage.getItem(`dorf-rechner-${name}`) ?? '{}') as Partial<T>) }));
  return [
    f,
    (k, v) =>
      setF((alt) => {
        const n = { ...alt, [k]: v };
        localStorage.setItem(`dorf-rechner-${name}`, JSON.stringify(n));
        return n;
      }),
  ];
}

const RECHNER = [
  ['sparplan', '📈 Sparplan'],
  ['entnahme', '🏖 Entnahme'],
  ['rebalancing', '⚖️ Umschichten'],
  ['kosten', '💸 Kosten'],
  ['ziel', '🎯 Sparziel'],
  ['waere', '🔮 Was wäre wenn'],
] as const;

/** E223: Börse → Rechner – reine Arithmetik, keine Empfehlung */
export function BoerseRechner() {
  const [welcher, setWelcher] = useState<(typeof RECHNER)[number][0]>(() => (localStorage.getItem('dorf-rechner') as (typeof RECHNER)[number][0] | null) ?? 'sparplan');
  const [privat] = usePrivat();
  const geld = geldFormat(privat, 'EUR', 0);
  return (
    <div className="boerse-rechner">
      <div className="ba-chips" role="tablist" aria-label="Rechner">
        {RECHNER.map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={welcher === k}
            className={`klein${welcher === k ? ' an' : ''}`}
            onClick={() => {
              setWelcher(k);
              localStorage.setItem('dorf-rechner', k);
            }}
          >
            <EmText t={t} />
          </button>
        ))}
      </div>
      {welcher === 'sparplan' && <Sparplan geld={geld} />}
      {welcher === 'entnahme' && <Entnahme geld={geld} />}
      {welcher === 'rebalancing' && <Umschichten geld={geld} />}
      {welcher === 'kosten' && <Kosten geld={geld} />}
      {welcher === 'ziel' && <Sparziel geld={geld} />}
      {welcher === 'waere' && <WasWaere />}
      <p className="leise">Rechenbeispiele mit festen Annahmen – echte Renditen schwanken, Vergangenes garantiert nichts. Steuern sind nicht eingerechnet.</p>
    </div>
  );
}

type Geld = (n: number | null | undefined, v?: boolean) => string;

function Sparplan({ geld }: { geld: Geld }) {
  const [f, s] = useFelder('sparplan', { start: '1000', monatlich: '200', jahre: '20', rendite: '6', kosten: '0,2', dynamik: '0', inflation: '2' });
  const z = sparplan({ start: zahl(f.start), monatlich: zahl(f.monatlich), jahre: Math.round(zahl(f.jahre)), rendite: zahl(f.rendite) / 100, kosten: zahl(f.kosten) / 100, dynamik: zahl(f.dynamik) / 100, inflation: zahl(f.inflation) / 100 });
  const letzte = z.at(-1);
  const reihe = (k: 'eingezahlt' | 'wert' | 'real'): Punkt[] => [[`${new Date().getFullYear()}-01-01`, zahl(f.start)], ...z.map((x) => [`${new Date().getFullYear() + x.jahr}-01-01`, x[k]] as Punkt)];
  return (
    <section className="karte innen rechner">
      <div className="rechner-felder">
        <Feld text="Startbetrag" wert={f.start} setzen={(v) => s('start', v)} einheit="€" />
        <Feld text="Monatlich" wert={f.monatlich} setzen={(v) => s('monatlich', v)} einheit="€" />
        <Feld text="Jahre" wert={f.jahre} setzen={(v) => s('jahre', v)} />
        <Feld text="Rendite p. a." wert={f.rendite} setzen={(v) => s('rendite', v)} einheit="%" hilfe="Zum Vergleich: breite Weltaktien-ETFs lagen langfristig grob bei 5–8 % pro Jahr, mit großen Schwankungen" />
        <Feld text="Kosten (TER)" wert={f.kosten} setzen={(v) => s('kosten', v)} einheit="%" />
        <Feld text="Erhöhung je Jahr" wert={f.dynamik} setzen={(v) => s('dynamik', v)} einheit="%" />
        <Feld text="Inflation" wert={f.inflation} setzen={(v) => s('inflation', v)} einheit="%" />
      </div>
      {letzte && (
        <>
          <div className="bank-kacheln">
            <div className="bank-kachel">
              <span className="leise">Nach {letzte.jahr} Jahren</span>
              <strong>{geld(letzte.wert)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Eingezahlt</span>
              <strong>{geld(letzte.eingezahlt)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Ertrag</span>
              <strong className="plus">{geld(letzte.ertrag, true)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">In heutiger Kaufkraft</span>
              <strong>{geld(letzte.real)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Verdoppelt sich alle</span>
              <strong>{verdopplungJahre(zahl(f.rendite) / 100 - zahl(f.kosten) / 100)?.toLocaleString('de-DE', { maximumFractionDigits: 1 }) ?? '–'} Jahre</strong>
            </div>
          </div>
          <LinienDiagramm
            reihen={[
              { schluessel: 'w', name: 'Wert', farbe: '#2a78d6', punkte: reihe('wert') },
              { schluessel: 'e', name: 'Eingezahlt', farbe: '#eb6834', punkte: reihe('eingezahlt') },
              { schluessel: 'r', name: 'Kaufkraft heute', farbe: '#1baf7a', punkte: reihe('real'), strich: true },
            ]}
            format={(n) => geld(n)}
            hoehe={240}
          />
        </>
      )}
    </section>
  );
}

function Entnahme({ geld }: { geld: Geld }) {
  const [f, s] = useFelder('entnahme', { kapital: '200000', monatlich: '1000', rendite: '4', inflation: '2' });
  const r = entnahme({ kapital: zahl(f.kapital), monatlich: zahl(f.monatlich), rendite: zahl(f.rendite) / 100, inflation: zahl(f.inflation) / 100 });
  const jahr = new Date().getFullYear();
  return (
    <section className="karte innen rechner">
      <div className="rechner-felder">
        <Feld text="Kapital" wert={f.kapital} setzen={(v) => s('kapital', v)} einheit="€" />
        <Feld text="Entnahme monatlich" wert={f.monatlich} setzen={(v) => s('monatlich', v)} einheit="€" />
        <Feld text="Rendite p. a." wert={f.rendite} setzen={(v) => s('rendite', v)} einheit="%" />
        <Feld text="Entnahme steigt mit Inflation" wert={f.inflation} setzen={(v) => s('inflation', v)} einheit="%" />
      </div>
      <p className="rechner-ergebnis">
        {r.monate == null ? (
          <>Das Kapital reicht über 100 Jahre – die Entnahme ist kleiner als der Ertrag.</>
        ) : (
          <>
            Das Kapital reicht <strong>{Math.floor(r.monate / 12)} Jahre und {r.monate % 12} Monate</strong>.
          </>
        )}{' '}
        Faustregel zum Vergleich: 4 % im Jahr wären {geld((zahl(f.kapital) * 0.04) / 12)} im Monat.
      </p>
      <LinienDiagramm reihen={[{ schluessel: 'k', name: 'Kapital', farbe: '#2a78d6', punkte: r.verlauf.map(([j, v]) => [`${jahr + Number(j)}-01-01`, v]) }]} format={(n) => geld(n)} hoehe={220} />
    </section>
  );
}

function Umschichten({ geld }: { geld: Geld }) {
  const q = useQuery({ queryKey: ['boerse', 'analyse'], queryFn: () => api<BoerseAnalyse>('/api/boerse/analyse') });
  const [ziele, setZiele] = useState<Record<string, string>>(() => JSON.parse(localStorage.getItem('dorf-rechner-ziele') ?? '{}') as Record<string, string>);
  const [zusatz, setZusatz] = useState('0');
  const [nurKaufen, setNurKaufen] = useState(false);
  const pos = [
    ...(q.data?.saxo?.positionen ?? []).map((p) => ({ name: p.name, wert: p.wert ?? 0 })),
    ...(q.data?.eigen ?? []).map((p) => ({ name: p.name, wert: p.wertEur ?? 0 })),
  ].filter((p) => p.wert > 0);
  if (!pos.length) return <p className="leise">Keine Positionen mit Wert – verbinde Saxo oder trag dein Depot ein.</p>;
  const summe = pos.reduce((s, p) => s + p.wert, 0);
  const ziel = (n: string, w: number) => (ziele[n] !== undefined ? zahl(ziele[n]!) : Math.round((w / summe) * 1000) / 10);
  const r = rebalancing(
    pos.map((p) => ({ name: p.name, wert: p.wert, ziel: ziel(p.name, p.wert) })),
    zahl(zusatz),
    nurKaufen,
  );
  const zielSumme = pos.reduce((s, p) => s + ziel(p.name, p.wert), 0);
  const setzen = (n: string, v: string) => {
    const z = { ...ziele, [n]: v };
    setZiele(z);
    localStorage.setItem('dorf-rechner-ziele', JSON.stringify(z));
  };
  return (
    <section className="karte innen rechner">
      <p className="leise">Trag deine Wunsch-Gewichtung ein – der Rechner zeigt, was dafür zu kaufen/verkaufen wäre. Leer = so wie jetzt.</p>
      <div className="rechner-felder">
        <Feld text="Neues Geld dazu" wert={zusatz} setzen={setZusatz} einheit="€" />
        <label className="ba-schalter">
          <input type="checkbox" checked={nurKaufen} onChange={(e) => setNurKaufen(e.target.checked)} /> nur kaufen (nichts verkaufen)
        </label>
      </div>
      <div className="tabelle-rahmen">
        <table className="tabelle zahlen">
          <thead>
            <tr>
              <th>Position</th>
              <th>Jetzt</th>
              <th>Anteil</th>
              <th>Ziel %</th>
              <th>Kaufen / verkaufen</th>
            </tr>
          </thead>
          <tbody>
            {r.map((x) => (
              <tr key={x.name}>
                <td>{x.name}</td>
                <td>{geld(x.jetzt)}</td>
                <td>{((x.jetzt / summe) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</td>
                <td>
                  <input className="rechner-klein" inputMode="decimal" value={ziele[x.name] ?? ''} placeholder={String(ziel(x.name, x.jetzt)).replace('.', ',')} onChange={(e) => setzen(x.name, e.target.value)} aria-label={`Ziel für ${x.name}`} />
                </td>
                <td className={x.aenderung >= 0 ? 'plus' : 'minus'}>{Math.abs(x.aenderung) < 1 ? '–' : geld(x.aenderung, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Math.abs(zielSumme - 100) > 0.5 && <p className="hinweis">Die Ziele ergeben {zielSumme.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % – der Rechner skaliert sie auf 100 %.</p>}
      <button
        type="button"
        className="klein"
        onClick={() => {
          setZiele({});
          localStorage.removeItem('dorf-rechner-ziele');
        }}
      >
        Ziele zurücksetzen
      </button>
    </section>
  );
}

function Kosten({ geld }: { geld: Geld }) {
  const [f, s] = useFelder('kosten', { betrag: '10000', monatlich: '200', jahre: '30', rendite: '6', terA: '0,2', terB: '1,5' });
  const a = kostenEffekt({ betrag: zahl(f.betrag), monatlich: zahl(f.monatlich), jahre: Math.round(zahl(f.jahre)), rendite: zahl(f.rendite) / 100, ter: zahl(f.terA) / 100 });
  const b = kostenEffekt({ betrag: zahl(f.betrag), monatlich: zahl(f.monatlich), jahre: Math.round(zahl(f.jahre)), rendite: zahl(f.rendite) / 100, ter: zahl(f.terB) / 100 });
  return (
    <section className="karte innen rechner">
      <div className="rechner-felder">
        <Feld text="Startbetrag" wert={f.betrag} setzen={(v) => s('betrag', v)} einheit="€" />
        <Feld text="Monatlich" wert={f.monatlich} setzen={(v) => s('monatlich', v)} einheit="€" />
        <Feld text="Jahre" wert={f.jahre} setzen={(v) => s('jahre', v)} />
        <Feld text="Rendite vor Kosten" wert={f.rendite} setzen={(v) => s('rendite', v)} einheit="%" />
        <Feld text="Kosten A (z. B. ETF)" wert={f.terA} setzen={(v) => s('terA', v)} einheit="% p. a." />
        <Feld text="Kosten B (z. B. Fonds)" wert={f.terB} setzen={(v) => s('terB', v)} einheit="% p. a." />
      </div>
      <div className="bank-kacheln">
        <div className="bank-kachel">
          <span className="leise">Endwert mit A</span>
          <strong>{geld(a.mit)}</strong>
          <span className="leise">Kosten {geld(a.kosten)}</span>
        </div>
        <div className="bank-kachel">
          <span className="leise">Endwert mit B</span>
          <strong>{geld(b.mit)}</strong>
          <span className="leise">Kosten {geld(b.kosten)}</span>
        </div>
        <div className="bank-kachel">
          <span className="leise">Unterschied</span>
          <strong className="minus">{geld(a.mit - b.mit)}</strong>
        </div>
      </div>
    </section>
  );
}

function Sparziel({ geld }: { geld: Geld }) {
  const [f, s] = useFelder('ziel', { ziel: '100000', start: '5000', jahre: '15', rendite: '6' });
  // nötige Monatsrate: Ziel = Start·(1+r)^n + Rate·((1+r)^n − 1)/r (monatlich)
  const r = (1 + zahl(f.rendite) / 100) ** (1 / 12) - 1;
  const n = Math.round(zahl(f.jahre) * 12);
  const aufzins = (1 + r) ** n;
  const rest = zahl(f.ziel) - zahl(f.start) * aufzins;
  const rate = n <= 0 ? null : rest <= 0 ? 0 : r ? (rest * r) / (aufzins - 1) : rest / n;
  return (
    <section className="karte innen rechner">
      <div className="rechner-felder">
        <Feld text="Ziel" wert={f.ziel} setzen={(v) => s('ziel', v)} einheit="€" />
        <Feld text="Schon da" wert={f.start} setzen={(v) => s('start', v)} einheit="€" />
        <Feld text="In Jahren" wert={f.jahre} setzen={(v) => s('jahre', v)} />
        <Feld text="Rendite p. a." wert={f.rendite} setzen={(v) => s('rendite', v)} einheit="%" />
      </div>
      <p className="rechner-ergebnis">
        {rate == null ? 'Bitte Jahre angeben.' : rate === 0 ? 'Das Ziel erreichst du schon mit dem, was da ist.' : (
          <>
            Nötig: <strong>{geld(rate)} im Monat</strong> – zusammen {geld(rate * n)} eingezahlt.
          </>
        )}
      </p>
    </section>
  );
}

/** Was wäre, wenn ich damals in X investiert hätte? (echter Kursverlauf, ohne Kosten, Steuern, Dividenden) */
function WasWaere() {
  const q = useQuery({ queryKey: ['boerse', 'analyse'], queryFn: () => api<BoerseAnalyse>('/api/boerse/analyse') });
  const [privat] = usePrivat();
  const namen = new Map<string, string>();
  for (const p of q.data?.saxo?.positionen ?? []) if (p.symbol && q.data?.zuordnung[p.symbol]) namen.set(q.data.zuordnung[p.symbol]!.kuerzel, p.name);
  for (const w of [...(q.data?.eigen ?? []), ...(q.data?.watchlist ?? [])]) if (w.symbol) namen.set(w.symbol, w.name);
  const kuerzel = Object.keys(q.data?.historien ?? {}).filter((k) => (q.data!.historien[k]!.punkte.length ?? 0) > 20);
  const [f, s] = useFelder('waere', { wert: '', von: '', einmal: '1000', monatlich: '0' });
  if (!q.data) return <p className="leise">Lade …</p>;
  if (!kuerzel.length) return <p className="hinweis">Dafür braucht es Kursverläufe – in Analyse → „Kursverläufe & Kürzel“ laden.</p>;
  const wahl = kuerzel.includes(f.wert) ? f.wert : kuerzel[0]!;
  const h = q.data.historien[wahl]!;
  const erster = h.punkte[0]![0];
  const von = f.von && f.von >= erster ? f.von : erster;
  const r = wasWaereWenn(h.punkte, { von, einmal: zahl(f.einmal), monatlich: zahl(f.monatlich) });
  const geld = geldFormat(privat, h.waehrung, 0);
  return (
    <section className="karte innen rechner">
      <div className="rechner-felder">
        <label className="rechner-feld">
          <span>Wert</span>
          <select value={wahl} onChange={(e) => s('wert', e.target.value)} aria-label="Wert">
            {kuerzel.map((k) => (
              <option key={k} value={k}>
                {namen.get(k) ?? k} ({k})
              </option>
            ))}
          </select>
        </label>
        <label className="rechner-feld">
          <span>Ab (frühestens {datumKurz(erster)})</span>
          <input type="date" value={von} min={erster} onChange={(e) => s('von', e.target.value)} aria-label="Ab" />
        </label>
        <Feld text="Einmal" wert={f.einmal} setzen={(v) => s('einmal', v)} einheit={h.waehrung} />
        <Feld text="Monatlich" wert={f.monatlich} setzen={(v) => s('monatlich', v)} einheit={h.waehrung} />
      </div>
      {r && (
        <>
          <p className="rechner-ergebnis">
            Aus <strong>{geld(r.eingezahlt)}</strong> wären bis {datumKurz(r.ende)} <strong>{geld(r.wert)}</strong> geworden –{' '}
            <strong className={r.gewinn >= 0 ? 'plus' : 'minus'}>
              {geld(r.gewinn, true)} ({prozentText(r.prozent)})
            </strong>
            .
          </p>
          <LinienDiagramm reihen={[{ schluessel: 'w', name: namen.get(wahl) ?? wahl, farbe: '#2a78d6', punkte: r.verlauf }]} format={(n) => geld(n)} hoehe={220} />
        </>
      )}
      <p className="leise">In der Währung des Kurses ({h.waehrung}). Die kostenlose EODHD-Stufe liefert etwa ein Jahr Verlauf; das Dorf sammelt ab dann jeden Tag weiter.</p>
    </section>
  );
}
