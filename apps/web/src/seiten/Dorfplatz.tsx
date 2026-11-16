import { useQuery } from '@tanstack/react-query';
import type { Gebaeude } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';

/** Etappe 1: schlichte Gebäudeliste. Ab Etappe 5 wird daraus das isometrische Dorf. */
export function Dorfplatz() {
  const g = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  if (g.isPending) return <p>Lade Gebäude …</p>;
  if (g.isError) return <p className="fehler">{g.error.message}</p>;
  return (
    <section>
      <h1>Dorfplatz</h1>
      <div className="gebaeude-raster">
        {g.data.map((x) => (
          <a key={x.id} href={`/gebaeude/${encodeURIComponent(x.id)}`} onClick={linkKlick} className={`gebaeude-karte ${x.status}${x.fehler ? ' kaputt' : ''}`}>
            <span className="symbol">{x.symbol}</span>
            <span className="name">{x.name}</span>
            <span className="beschreibung">{x.fehler ?? (x.status === 'geschlossen' ? 'Noch nicht eröffnet' : x.beschreibung)}</span>
            {x.aktionen > 0 && <span className="abzeichen">{x.aktionen} Aktionen</span>}
          </a>
        ))}
      </div>
      <p className="leise">Neues Gebäude: Ordner mit einer <code>gebaeude.md</code> im Vault anlegen – es erscheint sofort hier.</p>
    </section>
  );
}
