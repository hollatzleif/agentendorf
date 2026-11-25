import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaxoUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { Sparkline, usePrivat } from '../boerse/teile';
import type { BoerseAnalyse } from '@dorf/shared';
import { useDesign } from '../apple/design';

const prozent = (n: number | null | undefined) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${(n * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);
const zahl = (n?: number, st = 2) => (n == null ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: st }));

/**
 * Saxo (E73): Depotwert, Positionen und Performance direkt aus Leifs Saxo-Konto – nur lesen.
 * Anmelden: Knopf → Saxo-Login → zurück ins Dorf. Das Dorf hält die Sitzung selbst am Leben.
 */
export function SaxoDepot() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['boerse', 'saxo'], queryFn: () => api<SaxoUebersicht>('/api/boerse/saxo') });
  const [meldung, setMeldung] = useState('');
  const [privat] = usePrivat();
  // E225: Mini-Verläufe (3 Monate) je Position aus den Kursverläufen der Analyse
  const analyse = useQuery({ queryKey: ['boerse', 'analyse'], queryFn: () => api<BoerseAnalyse>('/api/boerse/analyse'), staleTime: 300_000 });
  const drei = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10);
  const verlaufVon = (symbol?: string) => {
    const k = symbol ? analyse.data?.zuordnung[symbol]?.kuerzel : undefined;
    return (k ? analyse.data?.historien[k]?.punkte ?? [] : []).filter(([d]) => d >= drei);
  };
  const [laeuft, setLaeuft] = useState(false);

  // Rückkehr von der Saxo-Anmeldung (?saxo=ok|fehler) einmal melden, dann aus der Adresse nehmen
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const s = p.get('saxo');
    if (!s) return;
    setMeldung(s === 'ok' ? '✅ Mit Saxo verbunden.' : '⚠️ Die Anmeldung bei Saxo hat nicht geklappt.');
    p.delete('saxo');
    history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
  }, []);

  const d = q.data;
  if (!d) return null;
  const tun = async (f: () => Promise<unknown>) => {
    setMeldung('');
    setLaeuft(true);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ['boerse', 'saxo'] });
    } catch (e) {
      setMeldung(`⚠️ ${e instanceof ApiFehler ? e.message : String(e)}`);
    } finally {
      setLaeuft(false);
    }
  };
  const verbinden = () =>
    tun(async () => {
      const r = await api<{ url: string }>('/api/boerse/saxo/anmelden', { body: {} });
      location.href = r.url;
    });

  if (!d.eingerichtet)
    return (
      <section className="saxo karte innen" aria-label="Saxo">
        <h3>Saxo</h3>
        <p className="leise">
          Noch nicht eingerichtet. Mit einer Saxo-App (nur lesen) siehst du hier deinen echten Depotwert und deine Performance. Anleitung: EINRICHTUNG.md (Abschnitt Saxo), auf dem Server dann{' '}
          <code>dorf saxo-einrichten</code>.
        </p>
      </section>
    );

  const st = d.stand;
  const geld = (n: number | null | undefined) => (n == null || !st ? '–' : privat ? '•••' : n.toLocaleString('de-DE', { style: 'currency', currency: st.waehrung }));
  return (
    <section className="saxo" aria-label="Saxo">
      <div className="zeile bank-kopf">
        <h3 style={{ margin: 0 }}>Saxo</h3>
        {d.verbunden ? (
          <>
            <button type="button" onClick={() => void tun(() => api('/api/boerse/saxo/aktualisieren', { body: {} }))} disabled={laeuft}>
              {laeuft ? 'Hole …' : '↻ Aktualisieren'}
            </button>
            <button type="button" className="klein" onClick={() => void tun(() => api('/api/boerse/saxo/abmelden', { body: {} }))}>
              Trennen
            </button>
          </>
        ) : (
          <button type="button" className="haupt" onClick={() => void verbinden()} disabled={laeuft}>
            Mit Saxo verbinden
          </button>
        )}
        {st && <span className="leise">Stand {new Date(st.zeit).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</span>}
      </div>
      {meldung && <p className="hinweis">{meldung}</p>}
      {d.fehler && <p className="fehler">{d.fehler}</p>}
      {!d.verbunden && <p className="leise">Nach dem Klick meldest du dich bei Saxo an und landest wieder hier. Das Dorf kann dein Depot dann nur lesen – nie handeln.</p>}
      {!d.verbunden && d.rueckleitung && (
        <details className="leise" data-testid="saxo-pruefen" open>
          <summary>Klappt die Anmeldung nicht? Das muss in deiner Saxo-App stehen</summary>
          <ul>
            <li>
              Redirect URL – genau so, Zeichen für Zeichen: <code>{d.rueckleitung}</code>{' '}
              <button
                type="button"
                className="klein"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(d.rueckleitung ?? '')
                    .then(() => setMeldung('Redirect URL kopiert – in der Saxo-App unter Redirect URLs einfügen.'))
                    .catch(() => setMeldung('Kopieren ging nicht – bitte die Adresse oben markieren.'))
                }
              >
                Kopieren
              </button>
              <br />
              Zeigt Saxo „Value of redirect_uri parameter is not registered“, fehlt genau diese Adresse in deiner App.
            </li>
            <li>Grant Type: Code (Authorization Code)</li>
            <li>
              Anmelde-Server des Dorfs: <code>{d.anmeldeServer}</code>
              {d.anmeldeServer?.startsWith('live.') ? ' – also eine LIVE-App (Entwicklerportal → Live apps), keine Simulations-App' : ''}
            </li>
            <li>App Key und Secret dieser App auf dem Server mit <code>dorf saxo-einrichten</code> eingetragen</li>
          </ul>
        </details>
      )}
      {st && (
        <>
          <div className="bank-kacheln">
            <div className="bank-kachel">
              <span className="leise">Kontowert</span>
              <strong>{geld(st.gesamt)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Seit Jahresbeginn</span>
              <strong className={(d.renditeJahr ?? 0) >= 0 ? 'plus' : 'minus'}>{prozent(d.renditeJahr)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">12 Monate</span>
              <strong className={(d.rendite12Monate ?? 0) >= 0 ? 'plus' : 'minus'}>{prozent(d.rendite12Monate)}</strong>
            </div>
          </div>
          {d.verlauf.length > 1 && !privat && <Verlauf punkte={d.verlauf.slice(-260)} waehrung={st.waehrung} />}
          <table className="tabelle zahlen boerse-tabelle">
            <thead>
              <tr>
                <th>Position</th>
                <th>Kurs</th>
                <th>Tag</th>
                <th>Wert</th>
                <th>Gewinn</th>
                <th>3 Monate</th>
              </tr>
            </thead>
            <tbody>
              {st.positionen.map((p, i) => (
                <tr key={`${i}-${p.name}`}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="leise">
                      {p.symbol ?? ''}
                      {p.stueck != null ? ` · ${zahl(p.stueck, 4)} Stück` : ''}
                      {p.einstand != null ? ` · Einstand ${zahl(p.einstand)}` : ''}
                    </div>
                  </td>
                  <td>
                    {zahl(p.kurs)} {p.waehrung ?? ''}
                    {p.verzoegerungMin ? <div className="leise">{p.verzoegerungMin} min verzögert</div> : null}
                  </td>
                  <td className={(p.tagProzent ?? 0) >= 0 ? 'plus' : 'minus'}>{p.tagProzent == null ? '' : `${p.tagProzent > 0 ? '+' : ''}${zahl(p.tagProzent, 1)} %`}</td>
                  <td>{geld(p.wert)}</td>
                  <td className={(p.gewinn ?? 0) >= 0 ? 'plus' : 'minus'}>{geld(p.gewinn)}</td>
                  <td>
                    <Sparkline punkte={verlaufVon(p.symbol)} />
                  </td>
                </tr>
              ))}
              {st.bar != null && (
                <tr>
                  <td>
                    <strong>Bargeld</strong>
                  </td>
                  <td />
                  <td />
                  <td>{geld(st.bar)}</td>
                  <td />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Kontowert der letzten 12 Monate als einfache Linie */
function Verlauf({ punkte, waehrung }: { punkte: { datum: string; wert: number }[]; waehrung: string }) {
  const B = 600;
  const H = 140;
  const min = Math.min(...punkte.map((p) => p.wert));
  const max = Math.max(...punkte.map((p) => p.wert));
  const spanne = max - min || 1;
  const pfad = punkte.map((p, i) => `${i ? 'L' : 'M'}${((i / (punkte.length - 1)) * B).toFixed(1)},${(H - 8 - ((p.wert - min) / spanne) * (H - 16)).toFixed(1)}`).join(' ');
  const geld = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: waehrung, maximumFractionDigits: 0 });
  // E240: Apple – Linie in Grün/Rot nach Richtung, darunter eine Verlaufsfläche (Aktien-Stil)
  const apple = useDesign() === 'apple';
  const richtung = punkte.at(-1)!.wert >= punkte[0]!.wert ? 'plus' : 'minus';
  return (
    <figure className="saxo-verlauf" data-richtung={apple ? richtung : undefined}>
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`Kontowert von ${geld(punkte[0]!.wert)} auf ${geld(punkte.at(-1)!.wert)}`} preserveAspectRatio="none">
        {apple && (
          <>
            <defs>
              <linearGradient id="saxo-verlauf-flaeche" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={`${pfad} L${B},${H} L0,${H} Z`} fill="url(#saxo-verlauf-flaeche)" stroke="none" />
          </>
        )}
        <path d={pfad} fill="none" stroke="currentColor" strokeWidth={apple ? 1.75 : 2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="leise">
        {punkte[0]!.datum}: {geld(punkte[0]!.wert)} → {punkte.at(-1)!.datum}: {geld(punkte.at(-1)!.wert)} · tief {geld(min)} · hoch {geld(max)}
      </figcaption>
    </figure>
  );
}
