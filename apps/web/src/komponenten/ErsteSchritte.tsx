import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Anschluss, GewohnheitStand, NotenStand, TodoInfo, WochenzieleStand } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';

/**
 * Erste Schritte (Nacht 18./19.11.): die neuen Bausteine einmal ausprobieren. Jeder Punkt hakt sich von selbst ab,
 * sobald es ihn gibt; die Karte verschwindet, wenn alles erledigt oder weggeklickt ist (je Gerät).
 */
const WEG = 'dorf-erste-schritte-weg';

export function ErsteSchritte() {
  const [weg, setWeg] = useState(() => localStorage.getItem(WEG) === '1');
  const ziele = useQuery({ queryKey: ['liste', 'wochenziele'], queryFn: () => api<WochenzieleStand>('/api/wochenziele'), enabled: !weg });
  const gw = useQuery({ queryKey: ['liste', 'gewohnheiten'], queryFn: () => api<{ gewohnheiten: GewohnheitStand[] }>('/api/gewohnheiten'), enabled: !weg });
  const an = useQuery({ queryKey: ['anschluesse'], queryFn: () => api<Anschluss[]>('/api/anschluesse'), enabled: !weg });
  const noten = useQuery({ queryKey: ['uni', 'noten'], queryFn: () => api<NotenStand>('/api/uni/noten'), enabled: !weg });
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos'), enabled: !weg });
  if (weg) return null;
  // erst zeigen, wenn alles geantwortet hat; ein Schritt, dessen Abfrage scheitert, fällt einfach weg (Review)
  const alle = [ziele, gw, an, noten, todos];
  if (alle.some((x) => x.isPending)) return null;
  const moeglich: ([boolean, string, string, string] | null)[] = [
    ziele.data ? [ziele.data.ziele.length > 0, '🎯', 'Drei Wochenziele setzen', '#wochenziele'] : null,
    gw.data ? [gw.data.gewohnheiten.length > 0, '🔁', 'Eine Gewohnheit anlegen (z. B. „Sport 3× pro Woche“)', '#gewohnheiten'] : null,
    an.data ? [!!an.data.find((a) => a.name === 'Google-Kalender')?.ok, '📅', 'Google-Kalender verbinden – dann gehen Tag planen, Lernplan und Prüfungs-Wächter', '/einstellungen#anschluesse'] : null,
    todos.data ? [todos.data.some((t) => t.erinnerung || t.wiederholen), '🔔', 'Ein To-do mit Erinnerung oder Wiederholung (Bearbeiten → 🔔/🔁, oder „/erinner …“ in Telegram)', '/gebaeude/Marktplatz?reiter=todo'] : null,
    noten.data ? [noten.data.faecher.length > 0, '🎓', 'Noten & ECTS eintragen', '/gebaeude/Uni?reiter=noten'] : null,
  ];
  const schritte = moeglich.filter((x): x is [boolean, string, string, string] => x !== null);
  const offen = schritte.filter((x) => !x[0]).length;
  if (!offen) return null;
  return (
    <section className="karte heute-karte erste-schritte" aria-label="Erste Schritte">
      <div className="heute-karte-kopf">
        <h2>
          🚀 Erste Schritte <span className="wochenziele-stand">{schritte.length - offen}/{schritte.length}</span>
        </h2>
        <button
          type="button"
          className="klein"
          onClick={() => {
            localStorage.setItem(WEG, '1');
            setWeg(true);
          }}
        >
          Ausblenden
        </button>
      </div>
      <p className="leise">
        Wie alles zusammenspielt: <a href="/anleitung" onClick={linkKlick}>So nutzt du das Dorf</a>
      </p>
      <ul className="erste-schritte-liste">
        {schritte.map(([fertig, symbol, text, ziel]) => (
          <li key={text} className={fertig ? 'fertig' : ''}>
            <span aria-hidden>{fertig ? '✅' : symbol}</span>{' '}
            {fertig ? (
              <span>{text}</span>
            ) : ziel.startsWith('#') ? (
              <a href={ziel} onClick={(e) => (e.preventDefault(), document.querySelector(`[aria-label="${ziel === '#wochenziele' ? 'Wochenziele' : 'Gewohnheiten'}"]`)?.scrollIntoView({ behavior: 'smooth' }))}>
                {text}
              </a>
            ) : (
              <a href={ziel} onClick={linkKlick}>
                {text}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
