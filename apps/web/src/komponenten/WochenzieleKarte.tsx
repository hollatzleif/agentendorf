import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WochenzieleStand } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * Wochenziele (E91): wenige Ziele für diese Kalenderwoche – Obsidian-Checkliste in Rathaus/wochenziele/JJJJ-KWnn.md.
 * Abhaken, ergänzen, entfernen; am Wochenanfang zeigt die Karte die Bilanz der letzten Woche.
 */
const KEY = ['liste', 'wochenziele'];

export function WochenzieleKarte() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<WochenzieleStand>('/api/wochenziele') });
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const [bearbeiten, setBearbeiten] = useState(false);
  const aufruf = async (f: () => Promise<WochenzieleStand>) => {
    setFehler('');
    try {
      qc.setQueryData(KEY, await f());
      return true;
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
      void qc.invalidateQueries({ queryKey: KEY });
      return false;
    }
  };
  const s = q.data;
  const fertig = s?.ziele.filter((z) => z.erledigt).length ?? 0;
  const letzte = s?.letzte.ziele ?? [];
  const kw = s ? Number(s.woche.slice(-2)) : 0;

  return (
    <section className="karte heute-karte" aria-label="Wochenziele">
      <div className="heute-karte-kopf">
        <h2>
          🎯 Wochenziele{s ? ` · KW ${kw}` : ''}
          {s && s.ziele.length > 0 && <span className="wochenziele-stand"> {fertig}/{s.ziele.length}</span>}
        </h2>
        {s && s.ziele.length > 0 && (
          <button type="button" className="klein" onClick={() => setBearbeiten(!bearbeiten)} aria-expanded={bearbeiten}>
            {bearbeiten ? 'Fertig' : 'Bearbeiten'}
          </button>
        )}
      </div>
      {q.isError && <p className="fehler">Wochenziele nicht erreichbar: {q.error.message}</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      {s && s.ziele.length > 0 && (
        <div className="wochenziele-balken" aria-hidden>
          <span style={{ width: `${(fertig / s.ziele.length) * 100}%` }} />
        </div>
      )}
      {s && !s.ziele.length && (
        <p className="leise heute-leer">
          Welche 3 Dinge sollen diese Woche fertig werden?
          {letzte.length > 0 && ` Letzte Woche: ${letzte.filter((z) => z.erledigt).length}/${letzte.length} erreicht.`}
        </p>
      )}
      {s && s.ziele.length > 0 && (
        <ul className="wochenziele">
          {s.ziele.map((z, i) => (
            <li key={`${i}-${z.text}`} className={z.erledigt ? 'erledigt' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={z.erledigt}
                  onChange={(e) => {
                    const erledigt = e.target.checked;
                    qc.setQueryData<WochenzieleStand>(KEY, (a) => a && { ...a, ziele: a.ziele.map((x, j) => (j === i ? { ...x, erledigt } : x)) });
                    void aufruf(() => api<WochenzieleStand>('/api/wochenziele/haken', { body: { nr: i, erledigt } }));
                  }}
                  aria-label={`Ziel erreicht: ${z.text}`}
                />
                <span>{z.text}</span>
              </label>
              {bearbeiten && (
                <button type="button" className="klein" aria-label={`Ziel entfernen: ${z.text}`} onClick={() => void aufruf(() => api<WochenzieleStand>(`/api/wochenziele?nr=${i}`, { methode: 'DELETE' }))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {s && s.ziele.length < 7 && (
        <form
          className="heute-neu wochenziele-neu"
          aria-label="Neues Wochenziel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void aufruf(() => api<WochenzieleStand>('/api/wochenziele', { body: { text: text.trim() } })).then((ok) => ok && setText(''));
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={s.ziele.length ? 'Noch ein Ziel …' : 'z. B. Blatt 6 abgeben'} maxLength={200} aria-label="Neues Wochenziel" enterKeyHint="done" />
          <button type="submit" className="haupt" aria-label="Ziel hinzufügen">
            +
          </button>
        </form>
      )}
    </section>
  );
}
