import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Gebaeude, VaultDatei } from '@dorf/shared';
import { api } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { Markdown } from '../komponenten/Markdown';
import { Dateibaum } from '../komponenten/Dateibaum';

type Reiter = 'uebersicht' | 'aktionen' | 'chats' | 'dateien';

export function GebaeudeSeite({ id }: { id: string }) {
  const [reiter, setReiter] = useState<Reiter>('uebersicht');
  const liste = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const g = liste.data?.find((x) => x.id === id);
  const anweisung = useQuery({
    queryKey: ['datei', `${id}/gebaeude.md`],
    queryFn: () => api<VaultDatei>(`/api/vault/datei?pfad=${encodeURIComponent(`${id}/gebaeude.md`)}`),
  });

  if (liste.isPending) return <p>Lade …</p>;
  if (!g) return <p className="karte">Gebäude „{id}“ gibt es nicht (mehr).</p>;

  return (
    <section>
      <a href="/" onClick={linkKlick} className="zurueck">
        ← Dorfplatz
      </a>
      <h1>
        {g.symbol} {g.name} {g.status === 'geschlossen' && <span className="abzeichen">noch nicht eröffnet</span>}
      </h1>
      {g.fehler && <p className="fehler">{g.fehler}</p>}
      <div className="reiter">
        {(
          [
            ['uebersicht', 'Übersicht'],
            ['aktionen', 'Aktionen'],
            ['chats', 'Chats'],
            ['dateien', 'Dateien'],
          ] as [Reiter, string][]
        ).map(([k, t]) => (
          <button key={k} className={reiter === k ? 'aktiv' : ''} onClick={() => setReiter(k)}>
            {t}
          </button>
        ))}
      </div>
      <div className="karte">
        {reiter === 'uebersicht' && (anweisung.data ? <Markdown inhalt={anweisung.data.inhalt} pfad={anweisung.data.pfad} /> : <p>Lade …</p>)}
        {reiter === 'aktionen' && (
          <p className="leise">
            Aktionen werden ab Etappe 2a zu Knöpfen. Schon jetzt kannst du sie als Markdown in{' '}
            <a href={bibliothekUrl(`${id}/aktionen`)} onClick={linkKlick}>
              {id}/aktionen
            </a>{' '}
            anlegen ({g.aktionen} vorhanden).
          </p>
        )}
        {reiter === 'chats' && <p className="leise">Chats kommen mit dem Agenten-Kern in Etappe 2a.</p>}
        {reiter === 'dateien' && <Dateibaum wurzel={id} />}
      </div>
    </section>
  );
}
