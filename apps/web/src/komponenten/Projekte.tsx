import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TodoInfo } from '@dorf/shared';
import { minutenText, projekteAus } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { navigieren } from '../router';

/**
 * E161: Projekte – To-dos mit derselben Gruppe als Projekt gesehen: Fortschritt, nächster Schritt (mit 🍅),
 * Fokuszeit und „ruht seit …“. Eine Gruppe vergibst du im To-do-Brett beim Bearbeiten (Feld „Gruppe“).
 */
export function Projekte() {
  const q = useQuery({ queryKey: ['liste', 'todo', 'alle'], queryFn: () => api<TodoInfo[]>('/api/todos?alle=1') });
  const [fehler, setFehler] = useState('');
  if (q.isLoading) return <p className="leise">Lade …</p>;
  if (q.isError) return <p className="fehler">{q.error.message}</p>;
  const projekte = projekteAus(q.data ?? [], Date.now());
  const los = async (p: ReturnType<typeof projekteAus>[number]) => {
    if (!p.naechster) return;
    setFehler('');
    try {
      await api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: p.naechster.titel.slice(0, 200), gruppe: p.name.slice(0, 60), pfad: p.naechster.pfad } });
      navigieren('/fokus');
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  if (!projekte.length)
    return (
      <div className="karte projekte-leer">
        <p>Noch keine Projekte.</p>
        <p className="leise">Gib zusammengehörigen To-dos im To-do-Brett dieselbe <b>Gruppe</b> (z. B. „Bachelorarbeit“) – ab drei To-dos erscheint hier das Projekt mit Fortschritt und nächstem Schritt.</p>
      </div>
    );
  return (
    <section className="projekte" aria-label="Projekte">
      {fehler && <p className="fehler">{fehler}</p>}
      {projekte.map((p) => {
        const anteil = p.gesamt ? Math.round((p.erledigt / p.gesamt) * 100) : 0;
        return (
          <article key={p.name} className={`karte projekt${p.offen === 0 ? ' fertig' : ''}`} aria-label={`Projekt ${p.name}`}>
            <div className="projekt-kopf">
              <h3>📁 {p.name}</h3>
              <span className="leise">
                {p.erledigt}/{p.gesamt} erledigt{p.dieseWoche ? ` · +${p.dieseWoche} diese Woche` : ''}
                {p.fokusMin ? ` · 🍅 ${minutenText(p.fokusMin)}` : ''}
              </span>
            </div>
            <div className="projekt-balken" role="progressbar" aria-valuenow={anteil} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name}: ${anteil} %`}>
              <span style={{ width: `${anteil}%` }} />
            </div>
            {p.ruhtMelden && <p className="warnung-text">💤 Ruht seit {p.ruhtTage} Tagen – ein kleiner Schritt heute bringt es wieder in Gang.</p>}
            {p.naechster ? (
              <div className="projekt-naechster">
                <span>
                  👉 <strong>{p.naechster.titel}</strong>
                  {p.naechster.schritt && <span className="leise"> · nächster Schritt: {p.naechster.schritt}</span>}
                  {p.naechster.faellig && <span className="leise"> · fällig {p.naechster.faellig}</span>}
                </span>
                <button type="button" className="klein haupt" onClick={() => void los(p)} aria-label={`Fokus starten: ${p.naechster.titel}`}>
                  🍅 Los
                </button>
              </div>
            ) : (
              <p className="leise">✓ Alles erledigt – Projekt abgeschlossen. 🎉</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
