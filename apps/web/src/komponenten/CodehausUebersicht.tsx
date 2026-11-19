import { useQuery } from '@tanstack/react-query';
import type { CodingUebersicht } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { zeitKurz } from '../texte';
import { ChatListe } from './ChatListe';

/** Adresse, die VS Code über das Dorf öffnet (Einmal-Karte → eigener Ursprung des Code-Hosts), optional gleich im Projektordner */
export const vscodeLink = (projekt?: string) => `/api/coding/oeffnen${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ''}`;

/**
 * Codehaus (E191): VS Code im Browser öffnen, Projektordner im Coding-Container, laufende Coding-Agenten.
 * VS Code läuft auf einer eigenen Adresse; der Knopf geht über das Dorf, damit nur der angemeldete Leif hineinkommt.
 */
export function CodehausUebersicht() {
  const q = useQuery({ queryKey: ['coding'], queryFn: () => api<CodingUebersicht>('/api/coding'), refetchInterval: 60_000 });
  const d = q.data;
  if (q.isError) return <p className="fehler">{q.error.message}</p>;
  if (!d) return <p className="leise">Lade …</p>;
  return (
    <div className="codehaus">
      {!d.eingerichtet ? (
        <p className="karte">
          Das Codehaus ist noch nicht eingerichtet. Auf dem Server: <code>{d.befehl}</code> (Anleitung: EINRICHTUNG.md → „Codehaus einrichten“).
        </p>
      ) : (
        <p>
          <a className="knopf" href={vscodeLink()} target="_blank" rel="noopener" data-testid="vscode-oeffnen">
            💻 VS Code öffnen
          </a>{' '}
          <span className="leise">öffnet {d.adresse} in einem neuen Tab – mit Terminal, Git und Erweiterungen.</span>
        </p>
      )}
      {d.fehler && <p className="fehler">{d.fehler}</p>}

      <h3>Projekte</h3>
      {d.projekte.length === 0 ? (
        <p className="leise" data-testid="projekte-leer">
          {d.erreichbar ? 'Noch keine Projekte. Hol eins mit der Aktion „Repository holen“ oder klone es im VS-Code-Terminal nach /arbeit/<name>.' : 'Projektliste nicht verfügbar.'}
        </p>
      ) : (
        <ul className="chatliste" data-testid="projekte">
          {d.projekte.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> {p.git && <span className="abzeichen">git</span>}
              <div className="leise">
                geändert {zeitKurz(p.geaendert)}
                {d.eingerichtet && (
                  <>
                    {' · '}
                    <a href={vscodeLink(p.name)} target="_blank" rel="noopener">
                      in VS Code öffnen
                    </a>
                  </>
                )}
                {' · '}
                <a href={`/gebaeude/Codehaus?reiter=aktionen`} onClick={linkKlick}>
                  Agent beauftragen
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Coding-Agenten</h3>
      <p className="leise">
        Aufträge startest du unter „Aktionen“ (Programmieren, Repository holen, Pull Request prüfen) oder gibst sie dem Bürgermeister. Die Agenten arbeiten im selben
        Ordner wie du in VS Code – mit Shell, Internet und GitHub.
      </p>
      <ChatListe gebaeude="Codehaus" />
    </div>
  );
}
