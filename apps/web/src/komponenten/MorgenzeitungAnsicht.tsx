import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MorgenzeitungUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { Markdown } from './Markdown';

const zeit = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function MorgenzeitungAnsicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['morgenzeitung'], queryFn: () => api<MorgenzeitungUebersicht>('/api/morgenzeitung') });
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  if (!q.data) return <p className="leise">Lade …</p>;
  const m = q.data;

  const erstellen = async () => {
    setLaeuft(true);
    setFehler('');
    try {
      await api('/api/morgenzeitung/erstellen', { body: {} });
      await qc.invalidateQueries({ queryKey: ['morgenzeitung'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="morgenzeitung">
      <div className="zeile">
        <button onClick={() => void erstellen()} disabled={laeuft || m.laeuft}>
          {laeuft || m.laeuft ? 'Wird gedruckt …' : 'Jetzt neu erstellen'}
        </button>
        <span className="leise">Erscheint jeden Morgen um 06:30{m.naechste ? ` – nächste: ${zeit.format(new Date(m.naechste))}` : ''}.</span>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
      {m.aktuell ? <Markdown inhalt={m.aktuell.inhalt} pfad={m.aktuell.pfad} /> : <p className="leise">Noch keine Ausgabe.</p>}
      {m.aeltere.length > 0 && (
        <details>
          <summary>Ältere Ausgaben</summary>
          <ul className="ordnerliste">
            {m.aeltere.map((a) => (
              <li key={a.pfad}>
                <a href={bibliothekUrl(a.pfad)} onClick={linkKlick}>
                  {a.datum}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
