import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CodingUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { istProgramm } from '../programm/desktop';
import { linkKlick } from '../router';
import { zeitKurz } from '../texte';
import { ChatListe } from './ChatListe';
import { Erweiterungen } from './Erweiterungen';
import { Em } from '../apple/wissen-teile';

/** Adresse, die VS Code über das Dorf öffnet (Einmal-Karte → eigener Ursprung des Code-Hosts), optional gleich im Projektordner */
export const vscodeLink = (projekt?: string) => `/api/coding/oeffnen${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ''}`;

/** Das echte VS Code als Seite der Dorf-App (E205) – eingebettet, eigener Ursprung bleibt */
export const vscodeSeiteLink = (projekt?: string) => `/codehaus/vscode${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ''}`;

/** Editor in der Dorf-App (E197) – eigene Seite, Monaco wird erst dort geladen */
export const editorLink = (projekt?: string) => `/codehaus/editor${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ''}`;

/**
 * Knopf „VS Code öffnen“ (Fix 20.11.): holt die Einmal-Adresse als JSON und öffnet genau sie.
 * - Browser: Tab sofort beim Klick öffnen (sonst blockiert der Popup-Schutz nach dem await), dann dorthin leiten.
 * - Programm: window.open geht an den normalen Browser – der hat keine Dorf-Sitzung, die Einmal-Karte reicht dort aber.
 * - Fehler (nicht eingerichtet, abgemeldet …) stehen unter dem Knopf statt still zu verschwinden.
 */
export function VsCodeKnopf({ projekt, klein, text, testid }: { projekt?: string; klein?: boolean; text?: string; testid?: string }) {
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const oeffnen = async () => {
    setFehler('');
    setLaeuft(true);
    const tab = istProgramm() ? null : window.open('about:blank', '_blank');
    try {
      const { url } = await api<{ url: string }>(`${vscodeLink(projekt)}${projekt ? '&' : '?'}json=1`);
      // Programm: window.open geht genau EINMAL an den normalen Browser (kein Ausweichen auf location.href – das würde die
      // Hülle ein zweites Mal nach außen schicken und die Einmal-Karte wäre beim zweiten Öffnen verbraucht)
      if (istProgramm()) window.open(url, '_blank');
      else if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = url;
      } else if (!window.open(url, '_blank')) location.href = url;
    } catch (e) {
      tab?.close();
      setFehler(e instanceof ApiFehler ? e.message : 'VS Code ließ sich nicht öffnen.');
    } finally {
      setLaeuft(false);
    }
  };
  return (
    <>
      <button type="button" className={klein ? 'klein' : undefined} onClick={() => void oeffnen()} disabled={laeuft} data-testid={testid ?? (projekt ? undefined : 'vscode-oeffnen')}>
        {text ?? (klein ? 'in VS Code öffnen' : <><Em e="💻" /> VS Code öffnen</>)}
      </button>
      {fehler && <span className="fehler"> {fehler}</span>}
    </>
  );
}

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
          <VsCodeKnopf />{' '}
          <span className="leise">öffnet {d.adresse} in einem neuen Tab – mit Terminal, Git und Erweiterungen.</span>{' '}
          {d.einbettbar && (
            <a href={vscodeSeiteLink()} onClick={linkKlick} data-testid="vscode-in-app">
              Oder hier in der App öffnen
            </a>
          )}
        </p>
      )}
      {d.fehler && <p className="fehler">{d.fehler}</p>}

      <h3>Projekte</h3>
      {d.projekte.length === 0 ? (
        <p className="leise" data-testid="projekte-leer">
          {d.erreichbar ? 'Noch keine Projekte. Hol eins mit der Aktion „Repository holen“ oder klone es im VS-Code-Terminal nach /arbeit/<name>.' : 'Projektliste nicht verfügbar.'}
        </p>
      ) : (
        <ul className="chatliste projekte-liste" data-testid="projekte">
          {d.projekte.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> {p.git && <span className="abzeichen">git</span>}
              <div className="leise">
                geändert {zeitKurz(p.geaendert)}
                {d.eingerichtet && (
                  <>
                    {' · '}
                    <VsCodeKnopf projekt={p.name} klein />
                    {d.einbettbar && (
                      <>
                        {' · '}
                        <a href={vscodeSeiteLink(p.name)} onClick={linkKlick}>
                          VS Code in der App
                        </a>
                      </>
                    )}
                  </>
                )}
                {' · '}
                <a href={editorLink(p.name)} onClick={linkKlick}>
                  im Editor öffnen
                </a>
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

/** Reiter „Editor“ im Codehaus (E197): Einstieg in den Editor der Dorf-App – die Seite selbst lädt Monaco erst beim Öffnen. */
export function CodehausEditorStart() {
  const q = useQuery({ queryKey: ['coding'], queryFn: () => api<CodingUebersicht>('/api/coding'), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <div className="codehaus">
      <p>
        <a className="knopf" href={editorLink()} onClick={linkKlick} data-testid="editor-oeffnen">
          <Em e="📝" /> Editor öffnen
        </a>{' '}
        <span className="leise">Programmieren direkt im Dorf – Editor, Dateien, Terminal, Git und der Coding-Agent daneben. Geht auch am Handy.</span>
      </p>
      {q.isError && <p className="fehler">{q.error.message}</p>}
      {d?.fehler && <p className="fehler">{d.fehler}</p>}
      {d && d.projekte.length > 0 && (
        <ul className="chatliste">
          {d.projekte.map((p) => (
            <li key={p.name}>
              <a href={editorLink(p.name)} onClick={linkKlick}>
                {p.name}
              </a>{' '}
              {p.git && <span className="abzeichen">git</span>}
              <div className="leise">geändert {zeitKurz(p.geaendert)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reiter „VS Code“ im Codehaus (E205): das echte VS Code in der App öffnen und Erweiterungen aus Open VSX verwalten. */
export function CodehausVsCodeStart() {
  const q = useQuery({ queryKey: ['coding'], queryFn: () => api<CodingUebersicht>('/api/coding'), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <div className="codehaus">
      {q.isError && <p className="fehler">{q.error.message}</p>}
      {d && !d.eingerichtet && (
        <p className="karte">
          Das Codehaus ist noch nicht eingerichtet. Auf dem Server: <code>{d.befehl}</code> (Anleitung: EINRICHTUNG.md → „Codehaus einrichten“).
        </p>
      )}
      {d?.eingerichtet && (
        <p>
          {d.einbettbar && (
            <>
              <a className="knopf" href={vscodeSeiteLink()} onClick={linkKlick} data-testid="vscode-seite-oeffnen">
                <Em e="🖥️" /> VS Code in der App öffnen
              </a>{' '}
            </>
          )}
          <VsCodeKnopf klein text="↗ in neuem Tab" testid="vscode-tab-start" />{' '}
          <span className="leise">Das vollständige VS Code des Codehauses – mit Erweiterungen, Debugger und Terminal. Geht auch im Programm und am Handy.</span>
        </p>
      )}
      {d?.fehler && <p className="fehler">{d.fehler}</p>}
      {d?.eingerichtet && (
        <>
          <h3>Erweiterungen</h3>
          <Erweiterungen />
        </>
      )}
    </div>
  );
}
