import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TodoInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const datumText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' });

/**
 * To-do-Brett auf dem Marktplatz (E65): immer aktuell (Live-Ereignis), abhaken, anlegen, bearbeiten, löschen.
 * Jedes To-do ist eine Datei in Marktplatz/todos/ – auch Agenten und Telegram pflegen sie.
 */
export function TodoBrett() {
  const qc = useQueryClient();
  const liste = useQuery({ queryKey: ['todos'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const [titel, setTitel] = useState('');
  const [faellig, setFaellig] = useState('');
  const [fehler, setFehler] = useState('');
  const neu = () => qc.invalidateQueries({ queryKey: ['todos'] });
  const ausfuehren = async (f: () => Promise<unknown>) => {
    setFehler('');
    try {
      await f();
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await neu();
  };

  const anlegen = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titel.trim()) return;
    void ausfuehren(async () => {
      await api('/api/todos', { body: { titel: titel.trim(), ...(faellig ? { faellig } : {}) } });
      setTitel('');
      setFaellig('');
    });
  };

  const offen = liste.data?.filter((t) => !t.erledigt) ?? [];
  const erledigt = liste.data?.filter((t) => t.erledigt) ?? [];
  return (
    <div className="todo-brett">
      <form className="todo-neu" onSubmit={anlegen} aria-label="Neues To-do">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neues To-do …" maxLength={200} aria-label="Neues To-do" />
        <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
        <button type="submit" className="haupt">
          +
        </button>
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
      {liste.isLoading && <p className="leise">Lade …</p>}
      {liste.data && !offen.length && <p className="leise">Nichts offen. 🎉</p>}
      <ul className="todo-liste">
        {offen.map((t) => (
          <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} />
        ))}
      </ul>
      {erledigt.length > 0 && (
        <details>
          <summary>Erledigt ({erledigt.length})</summary>
          <ul className="todo-liste erledigt">
            {erledigt.map((t) => (
              <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} />
            ))}
          </ul>
        </details>
      )}
      <p className="leise">Auch in Obsidian unter Marktplatz/todos/ – und per Telegram: /todo. Gelöschtes liegt im Papierkorb.</p>
    </div>
  );
}

function TodoZeile({ t, ausfuehren }: { t: TodoInfo; ausfuehren: (f: () => Promise<unknown>) => Promise<void> }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [titel, setTitel] = useState(t.titel);
  const [faellig, setFaellig] = useState(t.faellig ?? '');
  const [notiz, setNotiz] = useState(t.notiz ?? '');
  // Häkchen sofort zeigen; die Zeile wird mit der neuen Version vom Server ohnehin neu aufgebaut
  const [haken, setHaken] = useState(t.erledigt);
  const aendern = (a: Record<string, unknown>) => ausfuehren(() => api('/api/todos', { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, ...a } }));
  const ueberfaellig = !t.erledigt && t.faellig && t.faellig < heute();
  const vonAgent = t.quelle && t.quelle !== 'Leif' && t.quelle !== 'Telegram';

  if (bearbeiten)
    return (
      <li className="todo bearbeiten">
        <form
          className="formspalte"
          onSubmit={(e) => {
            e.preventDefault();
            void aendern({ titel, faellig, notiz }).then(() => setBearbeiten(false));
          }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} aria-label="Titel" />
          <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
          <textarea rows={3} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz" aria-label="Notiz" />
          <div className="zeile">
            <button type="submit" className="haupt">
              Speichern
            </button>
            <button type="button" onClick={() => setBearbeiten(false)}>
              Abbrechen
            </button>
            <button type="button" className="gefahr" onClick={() => void ausfuehren(() => api(`/api/todos?pfad=${encodeURIComponent(t.pfad)}`, { methode: 'DELETE' }))}>
              Löschen
            </button>
          </div>
        </form>
      </li>
    );
  return (
    <li className={`todo${t.erledigt ? ' fertig' : ''}${ueberfaellig ? ' ueberfaellig' : ''}`}>
      <label className="todo-haken">
        <input
          type="checkbox"
          checked={haken}
          onChange={(e) => {
            setHaken(e.target.checked);
            void aendern({ erledigt: e.target.checked });
          }}
          aria-label={`${t.titel} erledigt`}
        />
      </label>
      <div className="todo-text">
        <button type="button" className="todo-titel" onClick={() => setBearbeiten(true)} title="Bearbeiten">
          {t.titel}
        </button>
        <span className="todo-meta">
          {t.faellig && <span className={`abzeichen${ueberfaellig ? ' warnung' : ''}`}>📅 {datumText(t.faellig)}</span>}
          {t.gebaeude && <span className="abzeichen">{t.gebaeude}</span>}
          {vonAgent && <span className="abzeichen" title={t.quelle}>🤖 {t.quelle}</span>}
          {t.notiz && (
            <a href={bibliothekUrl(t.pfad)} onClick={linkKlick} className="leise">
              Notiz
            </a>
          )}
        </span>
      </div>
    </li>
  );
}
