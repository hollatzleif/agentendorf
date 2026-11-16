import { useQuery } from '@tanstack/react-query';
import type { Verbrauch as V, VerbrauchZeile } from '@dorf/shared';
import { api } from '../api';

const zahl = (n: number) => n.toLocaleString('de-AT');

/** Token je Tag, Woche und Monat – getrennt nach api und claude-code. Beim Abo zählt kein Geld, nur das Kontingent. */
export function Verbrauch() {
  const v = useQuery({ queryKey: ['verbrauch'], queryFn: () => api<V>('/api/verbrauch') });
  if (v.isPending) return <p className="leise">Lade …</p>;
  if (v.isError) return <p className="fehler">{v.error.message}</p>;
  return (
    <div className="verbrauch">
      <p className="leise">
        Ein = Eingabe inkl. Cache. Kosten nur beim <strong>api</strong>-Motor (Schätzung nach den Preisen in <code>modelle.md</code>); <strong>claude-code</strong> läuft über dein Abo.
      </p>
      <Tabelle titel="Tage" zeilen={v.data.tage} />
      <Tabelle titel="Wochen" zeilen={v.data.wochen} />
      <Tabelle titel="Monate" zeilen={v.data.monate} />
    </div>
  );
}

function Tabelle({ titel, zeilen }: { titel: string; zeilen: VerbrauchZeile[] }) {
  const zeitraeume = [...new Set(zeilen.map((z) => z.zeitraum))];
  const wert = (zr: string, m: string) => zeilen.find((z) => z.zeitraum === zr && z.motor === m);
  return (
    <>
      <h3>{titel}</h3>
      {zeitraeume.length === 0 ? (
        <p className="leise">Noch keine Läufe.</p>
      ) : (
        <table className="tabelle zahlen">
          <thead>
            <tr>
              <th>Zeitraum</th>
              <th>api ein / aus</th>
              <th>api $</th>
              <th>claude-code ein / aus</th>
              <th>Läufe</th>
            </tr>
          </thead>
          <tbody>
            {zeitraeume.map((zr) => {
              const a = wert(zr, 'api');
              const c = wert(zr, 'claude-code');
              const ein = (z?: VerbrauchZeile) => (z ? z.einToken + z.cacheLesen + z.cacheSchreiben : 0);
              return (
                <tr key={zr}>
                  <td>{zr}</td>
                  <td>{a ? `${zahl(ein(a))} / ${zahl(a.ausToken)}` : '–'}</td>
                  <td>{a ? a.kostenUsd.toFixed(2) : '–'}</td>
                  <td>{c ? `${zahl(ein(c))} / ${zahl(c.ausToken)}` : '–'}</td>
                  <td>{(a?.laeufe ?? 0) + (c?.laeufe ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
