import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';
import { Markdown } from './Markdown';

/** Wochenrückblick (sonntags 18:30): die Woche in Zahlen + Vorschläge für die nächste */
export function WochenrueckblickAnsicht() {
  const qc = useQueryClient();
  // hängt an ['morgenzeitung', …] – das Live-Ereignis morgenzeitung.geaendert lädt beides neu
  const q = useQuery({ queryKey: ['morgenzeitung', 'woche'], queryFn: () => api<{ aktuell: { woche: string; pfad: string; inhalt: string } | null }>('/api/wochenrueckblick') });
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const erstellen = async () => {
    setLaeuft(true);
    setFehler('');
    try {
      await api('/api/wochenrueckblick/erstellen', { body: {} });
      await qc.invalidateQueries({ queryKey: ['morgenzeitung', 'woche'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };
  return (
    <div className="morgenzeitung">
      <div className="zeile">
        <button onClick={() => void erstellen()} disabled={laeuft}>
          {laeuft ? 'Wird geschrieben …' : 'Jetzt erstellen'}
        </button>
        <span className="leise">Kommt jeden Sonntag um 18:30 – was lief, was liegen blieb, was nächste Woche ansteht.</span>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
      {q.data?.aktuell ? <Markdown inhalt={q.data.aktuell.inhalt} pfad={q.data.aktuell.pfad} /> : q.data && <p className="leise">Noch kein Rückblick.</p>}
    </div>
  );
}
