import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GewohnheitStand } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * Gewohnheiten (Nacht 18./19.11.): heute fällige zum Abhaken, Serie (🔥) und die letzten 7 Tage als Punkte.
 * Die Liste steht in Marktplatz/gewohnheiten.md – hier lässt sie sich auch anlegen und entfernen.
 */
type Antwort = { gewohnheiten: GewohnheitStand[]; fehler?: string };
const KEY = ['liste', 'gewohnheiten'];
const TAGE = [
  ['täglich', 'täglich'],
  ['werktags', 'werktags'],
  ['wochenende', 'am Wochenende'],
  ['mo,mi,fr', 'Mo, Mi, Fr'],
  ['di,do', 'Di, Do'],
  ['2x pro woche', '2× pro Woche (beliebig)'],
  ['3x pro woche', '3× pro Woche (beliebig)'],
  ['4x pro woche', '4× pro Woche (beliebig)'],
] as const;
const kurzTag = (tag: string) => new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'narrow', timeZone: 'UTC' });
const tageText = (t: GewohnheitStand['tage']) => (Array.isArray(t) ? t.map((x) => x[0]!.toUpperCase() + x[1]).join(', ') : t.replace('x pro woche', '× pro Woche'));

export function GewohnheitenKarte() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Antwort>('/api/gewohnheiten') });
  const [bearbeiten, setBearbeiten] = useState(false);
  const [fehler, setFehler] = useState('');
  const setzen = (a: Antwort) => qc.setQueryData(KEY, a);
  const aufruf = async (f: () => Promise<Antwort>) => {
    setFehler('');
    try {
      setzen(await f());
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  const alle = q.data?.gewohnheiten ?? [];
  const heute = alle.filter((g) => g.heuteFaellig);
  const sonst = alle.filter((g) => !g.heuteFaellig);
  const fertig = heute.filter((g) => g.heuteErledigt).length;

  return (
    <section className="karte heute-karte" aria-label="Gewohnheiten">
      <div className="heute-karte-kopf">
        <h2>
          🔁 Gewohnheiten
          {heute.length > 0 && <span className="wochenziele-stand"> {fertig}/{heute.length}</span>}
        </h2>
        <button type="button" className="klein" onClick={() => setBearbeiten(!bearbeiten)} aria-expanded={bearbeiten}>
          {bearbeiten ? 'Fertig' : alle.length ? 'Bearbeiten' : '+ Anlegen'}
        </button>
      </div>
      {q.isError && <p className="fehler">Gewohnheiten nicht erreichbar: {q.error.message}</p>}
      {q.data?.fehler && <p className="fehler">{q.data.fehler}</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      {q.data && !alle.length && !bearbeiten && <p className="leise heute-leer">Noch keine Gewohnheiten – z. B. Sport, Lesen, Vokabeln. Kleine Serien machen viel aus.</p>}
      {(heute.length > 0 || (bearbeiten && sonst.length > 0)) && (
        <ul className="gewohnheiten">
          {[...heute, ...(bearbeiten ? sonst : [])].map((g) => (
            <li key={g.name} className={`gewohnheit${g.heuteErledigt ? ' erledigt' : ''}${g.heuteFaellig ? '' : ' frei'}`}>
              {g.heuteFaellig ? (
                <label className="gewohnheit-haken">
                  <input
                    type="checkbox"
                    checked={g.heuteErledigt}
                    onChange={(e) => {
                      const erledigt = e.target.checked;
                      // sofort zeigen, die Antwort des Servers (Serie, Woche) ersetzt es gleich
                      qc.setQueryData<Antwort>(KEY, (a) => a && { ...a, gewohnheiten: a.gewohnheiten.map((x) => (x.name === g.name ? { ...x, heuteErledigt: erledigt } : x)) });
                      void aufruf(() => api<Antwort>('/api/gewohnheiten/haken', { body: { name: g.name, erledigt } })).then(() => qc.invalidateQueries({ queryKey: KEY }));
                    }}
                    aria-label={`${g.name} heute erledigt`}
                  />
                  <span className="gewohnheit-symbol" aria-hidden>
                    {g.symbol}
                  </span>
                  <span className="gewohnheit-name">
                    {g.name}
                    {(g.uhrzeit || g.wocheStand) && (
                      <span className="leise">
                        {g.uhrzeit ? ` · ${g.uhrzeit}` : ''}
                        {g.wocheStand ? ` · ${g.wocheStand.erledigt}/${g.wocheStand.ziel} diese Woche` : ''}
                      </span>
                    )}
                  </span>
                </label>
              ) : (
                <span className="gewohnheit-haken">
                  <span className="gewohnheit-symbol" aria-hidden>
                    {g.symbol}
                  </span>
                  <span className="gewohnheit-name">
                    {g.name} <span className="leise">· {tageText(g.tage)}</span>
                  </span>
                </span>
              )}
              <span className="gewohnheit-woche" aria-label={`Letzte 7 Tage: ${g.woche.filter((t) => t.faellig && t.erledigt).length} von ${g.woche.filter((t) => t.faellig).length}`}>
                {g.woche.map((t) => (
                  <span key={t.tag} className={`punkt${t.erledigt ? ' an' : t.faellig ? ' aus' : ' frei'}`} title={`${kurzTag(t.tag)} ${t.tag}`} />
                ))}
              </span>
              {g.serie > 0 && (
                <span className="gewohnheit-serie" title={g.serieEinheit === 'wochen' ? `${g.serie} Wochen in Folge geschafft` : `${g.serie} fällige Tage in Folge`}>
                  🔥 {g.serie}
                  {g.serieEinheit === 'wochen' ? ' W' : ''}
                </span>
              )}
              {bearbeiten && (
                <button
                  type="button"
                  className="klein"
                  aria-label={`${g.name} entfernen`}
                  onClick={() => {
                    if (confirm(`„${g.name}“ entfernen? Die Häkchen bleiben gespeichert.`)) void aufruf(() => api<Antwort>(`/api/gewohnheiten?name=${encodeURIComponent(g.name)}`, { methode: 'DELETE' }));
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!bearbeiten && sonst.length > 0 && heute.length === 0 && <p className="leise heute-leer">Heute ist keine Gewohnheit dran.</p>}
      {bearbeiten && <Neu fertig={(a) => setzen(a)} fehler={setFehler} />}
    </section>
  );
}

function Neu({ fertig, fehler }: { fertig: (a: Antwort) => void; fehler: (t: string) => void }) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tage, setTage] = useState<string>('täglich');
  const [uhrzeit, setUhrzeit] = useState('');
  const anlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    fehler('');
    try {
      fertig(await api<Antwort>('/api/gewohnheiten', { body: { name: name.trim(), ...(symbol.trim() ? { symbol: symbol.trim() } : {}), tage: tage.includes(',') ? tage.split(',') : tage, ...(uhrzeit ? { uhrzeit } : {}) } }));
      setName('');
      setUhrzeit('');
      setSymbol('');
    } catch (err) {
      fehler(err instanceof ApiFehler ? err.message : String(err));
    }
  };
  return (
    <form className="gewohnheit-neu" onSubmit={(e) => void anlegen(e)} aria-label="Neue Gewohnheit">
      <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="✅" maxLength={8} aria-label="Symbol" className="gewohnheit-neu-symbol" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sport" maxLength={60} aria-label="Name der Gewohnheit" />
      <select value={tage} onChange={(e) => setTage(e.target.value)} aria-label="Wann">
        {TAGE.map(([w, t]) => (
          <option key={w} value={w}>
            {t}
          </option>
        ))}
      </select>
      <input type="time" value={uhrzeit} onChange={(e) => setUhrzeit(e.target.value)} aria-label="Uhrzeit (optional, dann läutet der Kirchturm)" title="Optional: dann läutet der Kirchturm zur Uhrzeit" className="gewohnheit-neu-zeit" />
      <button type="submit" className="haupt" aria-label="Gewohnheit anlegen">
        +
      </button>
    </form>
  );
}
