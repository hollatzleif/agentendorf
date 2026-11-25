import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PruefungStand } from '@dorf/shared';
import { minutenText } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick, navigieren } from '../router';
import { LernzeitPlaner } from './LernzeitPlaner';
import { Em } from '../apple/wissen-teile';

/**
 * E140: Prüfungs-Cockpit – je anstehende Prüfung alles, was zur Vorbereitung zählt: Countdown, Schritte des Uni-To-dos,
 * Fokuszeit der letzten 14 Tage aufs Fach (gegen das Lernziel), Karteikarten. Dazu: Lernen starten, Lernplan.
 */
export function PruefungsCockpit() {
  const q = useQuery({ queryKey: ['uni', 'pruefungen'], queryFn: () => api<PruefungStand[]>('/api/uni/pruefungen') });
  const [planen, setPlanen] = useState<string | null>(null);
  const [meldung, setMeldung] = useState('');
  const lernen = async (p: PruefungStand) => {
    setMeldung('');
    try {
      await api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: `Lernen: ${p.fach}`, gruppe: p.fach.slice(0, 60) } });
      navigieren('/fokus');
    } catch (e) {
      setMeldung(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  if (q.isPending) return <p className="leise">Lade …</p>;
  if (q.isError) return <p className="fehler">Prüfungen nicht erreichbar: {q.error.message}</p>;
  if (!q.data.length)
    return <p className="leise">Keine Prüfung in Sicht. Prüfungen kommen aus deinem Kalender „JKU Pflicht“/„Moodle-Fristen“ (📝 im Titel).</p>;
  return (
    <section className="pruefungen" aria-label="Prüfungs-Cockpit">
      {meldung && <p className="fehler">{meldung}</p>}
      {q.data.map((p) => {
        const wann = new Date(p.frist).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const ziel14 = p.lernzielMin ? p.lernzielMin * 2 : undefined;
        return (
          <article key={p.id} className={`karte innen pruefung${p.tage <= 3 ? ' bald' : ''}`} aria-label={`Prüfung ${p.titel}`}>
            <div className="pruefung-kopf">
              <div className="pruefung-tage" aria-label={p.tage <= 0 ? 'heute' : `in ${p.tage} Tagen`}>
                <strong>{p.tage <= 0 ? 'heute' : p.tage}</strong>
                {p.tage > 0 && <span>{p.tage === 1 ? 'Tag' : 'Tage'}</span>}
              </div>
              <div>
                <h3>
                  <Em e="📝" /> {p.titel}
                </h3>
                <p className="leise">
                  {p.fach} · {wann}
                </p>
              </div>
            </div>
            <ul className="pruefung-stand">
              {p.todo && (
                <li>
                  <Em e="☑" /> Schritte {p.todo.schritteFertig}/{p.todo.schritte}
                  {p.todo.naechster && <span className="leise"> · als Nächstes: {p.todo.naechster}</span>}
                </li>
              )}
              <li>
                <Em e="🍅" /> {minutenText(p.fokus14Tage)} gelernt (14 Tage){ziel14 ? <span className="leise"> · Ziel {minutenText(ziel14)}</span> : null}
              </li>
              {p.karten && (
                <li>
                  <Em e="🃏" /> {p.karten.gelernt}/{p.karten.gesamt} Karten sitzen{p.karten.faellig ? <span className="leise"> · {p.karten.faellig} heute dran</span> : null}
                </li>
              )}
            </ul>
            <div className="zeile">
              {!p.ohneFach && (
                <button type="button" className="haupt klein" onClick={() => void lernen(p)} aria-label={`Lernen starten: ${p.fach}`}>
                  <Em e="🍅" /> Lernen
                </button>
              )}
              <button type="button" className="klein" onClick={() => setPlanen(planen === p.id ? null : p.id)}>
                <Em e="📅" /> Lernplan
              </button>
              {p.karten && (
                <a href={`/gebaeude/Uni?reiter=karten&fach=${encodeURIComponent(p.karten.fach)}`} onClick={linkKlick} className="leise">
                  Karten üben
                </a>
              )}
            </div>
            {planen === p.id && <LernzeitPlaner titel={p.fach} bis={p.frist} fristTag={new Date(p.frist).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })} schliessen={() => setPlanen(null)} />}
          </article>
        );
      })}
    </section>
  );
}
