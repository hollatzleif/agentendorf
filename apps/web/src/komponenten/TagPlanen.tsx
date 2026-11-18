import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';

type Block = { titel: string; todoPfad: string; start: string; ende: string; grund: string };
const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });
const heuteOderMorgen = () => {
  const jetzt = new Date();
  const stunde = Number(jetzt.toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
  return new Date(jetzt.getTime() + (stunde >= 18 ? 86_400_000 : 0)).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
};

/**
 * Tag planen (Nacht 18./19.11.): Das Dorf legt die dringendsten To-dos in die freien Lücken des Tages.
 * Nur ein Vorschlag – eingetragen wird, was Leif angehakt lässt.
 */
export function TagPlanen({ schliessen }: { schliessen: () => void }) {
  const qc = useQueryClient();
  const [tag, setTag] = useState(heuteOderMorgen);
  const q = useQuery({ queryKey: ['kalender', 'plan', tag], queryFn: () => api<Block[]>(`/api/tag/planen?tag=${tag}`), retry: false });
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [fertig, setFertig] = useState('');
  const [fehler, setFehler] = useState('');
  useEffect(() => setGewaehlt(new Set((q.data ?? []).map((b) => b.start))), [q.data]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && schliessen();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [schliessen]);
  const eintragen = async () => {
    setFehler('');
    try {
      const bloecke = (q.data ?? []).filter((b) => gewaehlt.has(b.start)).map((b) => ({ titel: b.titel, start: b.start, ende: b.ende }));
      await api('/api/tag/eintragen', { body: { bloecke } });
      setFertig(`✅ ${bloecke.length} ${bloecke.length === 1 ? 'Block' : 'Blöcke'} eingetragen.`);
      await qc.invalidateQueries({ queryKey: ['kalender'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  return (
    <div className="fenster-hintergrund" onClick={schliessen}>
      <div className="fenster karte" role="dialog" aria-label="Tag planen" onClick={(e) => e.stopPropagation()}>
        <div className="zeile">
          <h3 style={{ margin: 0 }}>🧭 Tag planen</h3>
          <input type="date" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" />
        </div>
        <p className="leise">Die dringendsten To-dos in deine freien Lücken (8–20 Uhr, mit Puffer zu Terminen). Abhaken, was du willst – dann eintragen.</p>
        {q.isLoading && <p className="leise">Plane …</p>}
        {q.error && <p className="fehler">{q.error instanceof ApiFehler ? q.error.message : String(q.error)}</p>}
        {q.data && !q.data.length && <p className="leise">Nichts zu planen – entweder keine offenen To-dos oder kein freier Platz mehr.</p>}
        <ul className="plan-liste">
          {q.data?.map((b) => (
            <li key={b.start}>
              <label>
                <input
                  type="checkbox"
                  checked={gewaehlt.has(b.start)}
                  onChange={(e) =>
                    setGewaehlt((g) => {
                      const n = new Set(g);
                      if (e.target.checked) n.add(b.start);
                      else n.delete(b.start);
                      return n;
                    })
                  }
                />
                <span className="plan-zeit">
                  {uhr(b.start)}–{uhr(b.ende)}
                </span>
                <strong>{b.titel}</strong>
                <span className="leise"> · {b.grund}</span>
              </label>
            </li>
          ))}
        </ul>
        {fehler && <p className="fehler">{fehler}</p>}
        {fertig && <p className="hinweis">{fertig}</p>}
        <div className="zeile">
          <button type="button" className="haupt" disabled={!gewaehlt.size || !!fertig} onClick={() => void eintragen()}>
            Eintragen ({gewaehlt.size})
          </button>
          <button type="button" onClick={schliessen}>
            {fertig ? 'Schließen' : 'Abbrechen'}
          </button>
        </div>
      </div>
    </div>
  );
}
