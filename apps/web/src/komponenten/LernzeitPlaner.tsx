import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';

const wann = (iso: string) => new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

/**
 * Lernzeit einplanen (Nacht 18./19.11.): freie Lücken im Google-Kalender bis zur Frist (08–20 Uhr, Puffer zu Terminen).
 * Das Dorf schlägt nur vor – eingetragen wird erst mit Leifs Klick („Kalendereinträge legt nur Leif an“).
 */
export function LernzeitPlaner({ titel, bis, schliessen }: { titel: string; bis: string; schliessen: () => void }) {
  const qc = useQueryClient();
  const [dauer, setDauer] = useState(90);
  const [eingetragen, setEingetragen] = useState<string[]>([]);
  const [fehler, setFehler] = useState('');
  const q = useQuery({
    queryKey: ['kalender', 'frei', bis, dauer],
    queryFn: () => api<{ start: string; ende: string }[]>(`/api/kalender/frei?bis=${encodeURIComponent(bis)}&dauer=${dauer}&anzahl=5`),
    retry: false,
  });
  const eintragen = async (v: { start: string; ende: string }) => {
    setFehler('');
    try {
      await api('/api/kalender/lernzeit', { body: { titel, ...v } });
      setEingetragen((e) => [...e, v.start]);
      await qc.invalidateQueries({ queryKey: ['kalender'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  return (
    <div className="lernzeit karte innen" role="group" aria-label={`Lernzeit für ${titel}`}>
      <div className="zeile">
        <strong>📅 Lernzeit einplanen</strong>
        <select value={dauer} onChange={(e) => setDauer(Number(e.target.value))} aria-label="Dauer">
          <option value={45}>45 min</option>
          <option value={60}>1 h</option>
          <option value={90}>1,5 h</option>
          <option value={120}>2 h</option>
          <option value={180}>3 h</option>
        </select>
        <button type="button" className="klein" onClick={schliessen} aria-label="Lernzeit schließen">
          ×
        </button>
      </div>
      {q.isLoading && <p className="leise">Suche freie Zeiten …</p>}
      {q.error && <p className="fehler">{q.error instanceof ApiFehler ? q.error.message : String(q.error)}</p>}
      {q.data && !q.data.length && <p className="leise">Bis zur Frist ist zwischen 8 und 20 Uhr kein passender Block mehr frei.</p>}
      <ul className="lernzeit-liste">
        {q.data?.map((v) => (
          <li key={v.start}>
            <span>
              {wann(v.start)}–{uhr(v.ende)}
            </span>
            {eingetragen.includes(v.start) ? (
              <span className="plus">✅ eingetragen</span>
            ) : (
              <button type="button" className="klein haupt" onClick={() => void eintragen(v)}>
                Eintragen
              </button>
            )}
          </li>
        ))}
      </ul>
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}
