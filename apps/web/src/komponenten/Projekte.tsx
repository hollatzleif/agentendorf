import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Projekt } from '@dorf/shared';
import { minutenText } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { navigieren } from '../router';
import { E } from '../apple/tag';

/**
 * E161: Projekte – To-dos mit derselben Gruppe als Projekt gesehen: Fortschritt, nächster Schritt (mit 🍅),
 * Fokuszeit und „ruht seit …“. Eine Gruppe vergibst du im To-do-Brett beim Bearbeiten (Feld „Gruppe“).
 */
function fristText(frist: string) {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const tage = Math.round((Date.parse(`${frist}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86_400_000);
  return tage < 0 ? `vor ${-tage} ${tage === -1 ? 'Tag' : 'Tagen'}` : tage === 0 ? 'heute' : tage === 1 ? 'morgen' : `in ${tage} Tagen`;
}

export function Projekte() {
  // E167: Auswertung vom Server – hängt an ['liste', 'todo'], wird also bei jeder To-do-Änderung frisch geholt
  const q = useQuery({ queryKey: ['liste', 'todo', 'projekte'], queryFn: () => api<Projekt[]>('/api/projekte') });
  const [fehler, setFehler] = useState('');
  if (q.isLoading) return <p className="leise">Lade …</p>;
  if (q.isError) return <p className="fehler">{q.error.message}</p>;
  const projekte = q.data ?? [];
  const los = async (p: Projekt) => {
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
              <h3>
                <E e="📁" /> {p.name}
              </h3>
              <span className="leise">
                {p.erledigt}/{p.gesamt} erledigt{p.dieseWoche ? ` · +${p.dieseWoche} diese Woche` : ''}
                {p.fokusMin ? ` · 🍅 ${minutenText(p.fokusMin)}` : ''}
              </span>
            </div>
            <div className="projekt-balken" role="progressbar" aria-valuenow={anteil} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name}: ${anteil} %`}>
              <span style={{ width: `${anteil}%` }} />
            </div>
            {(p.frist || p.hinterher > 0) && p.offen > 0 && (
              // E172: im Plan? Frist mit Countdown, überfällige Schritte
              <p className={p.hinterher ? 'warnung-text' : 'leise'}>
                {p.frist && `🏁 Frist ${p.frist} (${fristText(p.frist)})`}
                {p.frist && p.hinterher > 0 && ' · '}
                {p.hinterher > 0 && `⚠️ ${p.hinterher} ${p.hinterher === 1 ? 'Schritt' : 'Schritte'} hinterher`}
              </p>
            )}
            {p.ruhtMelden && <p className="warnung-text">💤 Ruht seit {p.ruhtTage} Tagen – ein kleiner Schritt heute bringt es wieder in Gang.</p>}
            {p.naechster ? (
              <div className="projekt-naechster">
                <span>
                  <E e="👉" /> <strong>{p.naechster.titel}</strong>
                  {p.naechster.schritt && <span className="leise"> · nächster Schritt: {p.naechster.schritt}</span>}
                  {p.naechster.faellig && <span className="leise"> · fällig {p.naechster.faellig}</span>}
                </span>
                <button type="button" className="klein haupt" onClick={() => void los(p)} aria-label={`Fokus starten: ${p.naechster.titel}`}>
                  <E e="🍅" /> Los
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
