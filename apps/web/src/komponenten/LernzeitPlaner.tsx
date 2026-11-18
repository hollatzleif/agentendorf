import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';

const wann = (iso: string) => new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

/**
 * Lernzeit einplanen (Nacht 18./19.11.): freie Lücken im Google-Kalender bis zur Frist (08–20 Uhr, Puffer zu Terminen).
 * Das Dorf schlägt nur vor – eingetragen wird erst mit Leifs Klick („Kalendereinträge legt nur Leif an“).
 */
export function LernzeitPlaner({ titel, bis, schliessen, fristTag }: { titel: string; bis: string; schliessen: () => void; fristTag?: string }) {
  const [modus, setModus] = useState<'einzeln' | 'plan'>('einzeln');
  return (
    <div className="lernzeit karte innen" role="group" aria-label={`Lernzeit für ${titel}`}>
      <div className="zeile">
        <strong>📅 Lernzeit</strong>
        {fristTag && (
          <span className="lernzeit-modus" role="group" aria-label="Art">
            <button type="button" className={`klein${modus === 'einzeln' ? ' an' : ''}`} aria-pressed={modus === 'einzeln'} onClick={() => setModus('einzeln')}>
              Ein Block
            </button>
            <button type="button" className={`klein${modus === 'plan' ? ' an' : ''}`} aria-pressed={modus === 'plan'} onClick={() => setModus('plan')}>
              Lernplan bis zur Frist
            </button>
          </span>
        )}
        <button type="button" className="klein" onClick={schliessen} aria-label="Lernzeit schließen">
          ×
        </button>
      </div>
      {modus === 'plan' && fristTag ? <Lernplan titel={titel} fristTag={fristTag} /> : <Einzeln titel={titel} bis={bis} />}
    </div>
  );
}

/** E96: Gesamtstunden → Sitzungen gleichmäßig bis zum Vortag der Frist; Leif wählt ab und trägt ein */
function Lernplan({ titel, fristTag }: { titel: string; fristTag: string }) {
  const qc = useQueryClient();
  const [stunden, setStunden] = useState(6);
  const [dauer, setDauer] = useState(90);
  const [ab, setAb] = useState<Set<string>>(new Set());
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState('');
  const q = useQuery({
    queryKey: ['kalender', 'lernplan', fristTag, stunden, dauer],
    queryFn: () => api<{ gewuenscht: number; bloecke: { start: string; ende: string }[] }>(`/api/kalender/lernplan?bisTag=${fristTag}&stunden=${stunden}&dauer=${dauer}`),
    retry: false,
  });
  const gewaehlt = q.data?.bloecke.filter((b) => !ab.has(b.start)) ?? [];
  const eintragen = async () => {
    setFehler('');
    try {
      await api('/api/tag/eintragen', { body: { bloecke: gewaehlt.map((b) => ({ titel: `Lernen: ${titel}`, ...b })) } });
      setFertig(true);
      await qc.invalidateQueries({ queryKey: ['kalender'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  if (fertig) return <p className="plus">✅ {gewaehlt.length} Lernblöcke im Kalender – viel Erfolg!</p>;
  return (
    <>
      <div className="zeile">
        <label className="lernzeit-feld">
          insgesamt
          <select value={stunden} onChange={(e) => setStunden(Number(e.target.value))} aria-label="Stunden insgesamt">
            {[2, 3, 4, 6, 8, 10, 12, 15, 20, 25, 30].map((n) => (
              <option key={n} value={n}>
                {n} h
              </option>
            ))}
          </select>
        </label>
        <label className="lernzeit-feld">
          je Block
          <select value={dauer} onChange={(e) => setDauer(Number(e.target.value))} aria-label="Dauer je Block">
            <option value={60}>1 h</option>
            <option value={90}>1,5 h</option>
            <option value={120}>2 h</option>
            <option value={180}>3 h</option>
          </select>
        </label>
      </div>
      {q.isLoading && <p className="leise">Verteile auf freie Zeiten …</p>}
      {q.error && <p className="fehler">{q.error instanceof ApiFehler ? q.error.message : String(q.error)}</p>}
      {q.data && q.data.bloecke.length < q.data.gewuenscht && (
        <p className="hinweis">
          Bis zur Frist passen nur {q.data.bloecke.length} von {q.data.gewuenscht} Blöcken (je Tag einer, 9–20 Uhr) – längere Blöcke wählen oder früher anfangen.
        </p>
      )}
      <ul className="lernzeit-liste">
        {q.data?.bloecke.map((b) => (
          <li key={b.start}>
            <label className="lernzeit-wahl">
              <input
                type="checkbox"
                checked={!ab.has(b.start)}
                onChange={(e) =>
                  setAb((alt) => {
                    const n = new Set(alt);
                    if (e.target.checked) n.delete(b.start);
                    else n.add(b.start);
                    return n;
                  })
                }
                aria-label={`Block ${wann(b.start)}`}
              />
              {wann(b.start)}–{uhr(b.ende)}
            </label>
          </li>
        ))}
      </ul>
      {gewaehlt.length > 0 && (
        <button type="button" className="haupt" onClick={() => void eintragen()}>
          {gewaehlt.length} {gewaehlt.length === 1 ? 'Block' : 'Blöcke'} eintragen
        </button>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </>
  );
}

function Einzeln({ titel, bis }: { titel: string; bis: string }) {
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
    <>
      <div className="zeile">
        <select value={dauer} onChange={(e) => setDauer(Number(e.target.value))} aria-label="Dauer">
          <option value={45}>45 min</option>
          <option value={60}>1 h</option>
          <option value={90}>1,5 h</option>
          <option value={120}>2 h</option>
          <option value={180}>3 h</option>
        </select>
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
    </>
  );
}
