import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CodingUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { VsCodeKnopf, vscodeLink, vscodeSeiteLink } from '../komponenten/CodehausUebersicht';
import { Erweiterungen } from '../komponenten/Erweiterungen';
import { linkKlick, navigieren, useOrt } from '../router';

/**
 * VS Code als Seite der Dorf-App (E205): das echte VS Code des Codehauses (openvscode-server auf code.<Dorf-Adresse>)
 * in einem eingebetteten Fenster – auch im Programm und am Handy. Daneben das Erweiterungs-Panel (Open VSX).
 *
 * Sicherheitsgrenze bleibt der eigene Ursprung von VS Code:
 * - Die App lädt nur eine Adresse in den Rahmen: die Einmal-Adresse vom Dorf (/api/coding/oeffnen?json=1 → Karte, 60 s,
 *   einmalig). Das Sitzungs-Cookie des Dorfs geht dabei nie an den Code-Host.
 * - Die App kann den Rahmen nicht steuern oder auslesen (anderer Ursprung) und hört auf keine Nachrichten von ihm
 *   (kein postMessage-Kanal) – VS Code und seine Erweiterungen bekommen in der App keinerlei Rechte.
 * - `sandbox` gibt dem Rahmen nur, was VS Code braucht (siehe RAHMEN_RECHTE); vor allem KEIN allow-top-navigation:
 *   Nichts im Rahmen kann die Dorf-App durch eine andere Seite ersetzen (etwa eine nachgemachte Anmeldung).
 * - Caddy erlaubt das Einbetten von code.… nur dem Ursprung des Dorfs (frame-ancestors), die App darf nur code.… einbetten.
 */

/**
 * allow-scripts: VS Code ist eine JavaScript-Anwendung. allow-same-origin: sein EIGENER Ursprung (Cookies dorf_coding und
 * vscode-tkn, IndexedDB, Service Worker, WebSocket) – ohne das wäre es ein undurchsichtiger Ursprung ohne Cookies; das
 * Dorf erreicht es damit nicht. allow-forms: Eingabeformulare in VS Code. allow-popups (+ -to-escape-sandbox): Links aus
 * VS Code (Doku, GitHub) öffnen als gewöhnlicher Tab. allow-downloads: Dateien aus dem Explorer herunterladen.
 * allow-modals: Rückfragen des Browsers (z. B. „Seite verlassen?“ bei Ungespeichertem).
 */
export const RAHMEN_RECHTE = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
/** Zwischenablage (Kopieren/Einfügen in Editor und Terminal), Tastaturbelegung (VS Code erkennt so die deutsche Tastatur), Vollbild */
export const RAHMEN_ERLAUBT = 'clipboard-read; clipboard-write; keyboard-map; fullscreen';

const PROJEKT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export default function VsCodeSeite() {
  const { suche } = useOrt();
  const roh = suche.get('projekt') ?? '';
  const projekt = PROJEKT.test(roh) ? roh : '';
  const q = useQuery({ queryKey: ['coding'], queryFn: () => api<CodingUebersicht>('/api/coding') });
  const [panel, setPanel] = useState(suche.get('erweiterungen') === '1');
  const [rahmen, setRahmen] = useState<{ url: string; nr: number } | null>(null);
  const [fehler, setFehler] = useState('');
  const [geladen, setGeladen] = useState(false);
  const [haengt, setHaengt] = useState(false);
  const [geaendert, setGeaendert] = useState(false);
  const nr = useRef(0);
  const bereit = !!q.data?.eingerichtet && q.data.einbettbar;

  // Jedes Laden braucht eine frische Einmal-Adresse (die Karte gilt 60 s und nur einmal)
  const laden = useCallback(async () => {
    const meine = ++nr.current;
    setFehler('');
    setGeladen(false);
    setHaengt(false);
    setGeaendert(false);
    try {
      const { url } = await api<{ url: string }>(`${vscodeLink(projekt || undefined)}${projekt ? '&' : '?'}json=1`);
      if (meine === nr.current) setRahmen({ url, nr: meine });
    } catch (e) {
      if (meine === nr.current) setFehler(e instanceof ApiFehler ? e.message : 'VS Code ließ sich nicht öffnen.');
    }
  }, [projekt]);
  useEffect(() => {
    if (bereit) void laden();
  }, [bereit, laden]);
  // Kommt nach einer Weile nichts an (ältere Programm-Version, Browser sperrt Cookies im Rahmen …): Ausweg anbieten
  useEffect(() => {
    if (!rahmen || geladen) return;
    const t = setTimeout(() => setHaengt(true), 12_000);
    return () => clearTimeout(t);
  }, [rahmen, geladen]);

  const d = q.data;
  return (
    <div className={`vscode-seite${panel ? ' mit-panel' : ''}`} data-testid="vscode-seite">
      <div className="vs-kopf">
        <a href="/gebaeude/Codehaus" onClick={linkKlick} className="zurueck" title="Zurück zum Codehaus">
          ← <span className="vs-breit">Codehaus</span>
        </a>
        <strong className="vs-breit">🖥️ VS Code</strong>
        {d && d.projekte.length > 0 && (
          <select value={projekt} onChange={(e) => navigieren(vscodeSeiteLink(e.target.value || undefined))} aria-label="Projektordner" title="Projektordner in VS Code öffnen">
            <option value="">alle Projekte (/arbeit)</option>
            {d.projekte.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="vs-kopf-rechts">
          <button type="button" className={`klein${geaendert ? ' vs-hinweis' : ''}`} onClick={() => void laden()} disabled={!bereit} title="VS Code neu laden (z. B. nach dem Installieren einer Erweiterung)" data-testid="vscode-neu-laden">
            ↻ <span className="vs-breit">Neu laden</span>
          </button>
          <button type="button" className={`klein${panel ? ' aktiv' : ''}`} aria-pressed={panel} onClick={() => setPanel((p) => !p)} data-testid="erweiterungen-knopf">
            🧩 <span className="vs-breit">Erweiterungen</span>
          </button>
          {d?.eingerichtet && <VsCodeKnopf projekt={projekt || undefined} klein text="↗ in neuem Tab" testid="vscode-neuer-tab" />}
        </span>
      </div>
      <div className="vs-mitte">
        <div className="vs-buehne">
          {q.isPending && <p className="leise vs-text">Lade …</p>}
          {q.isError && <p className="fehler vs-text">{q.error.message}</p>}
          {d && !d.eingerichtet && (
            <p className="vs-text">
              Das Codehaus ist noch nicht eingerichtet. Auf dem Server: <code>{d.befehl}</code> (Anleitung: EINRICHTUNG.md → „Codehaus einrichten“).
            </p>
          )}
          {d?.eingerichtet && !d.einbettbar && (
            <p className="vs-text" data-testid="vscode-nicht-einbettbar">
              VS Code läuft unter einer Adresse, die nicht zum Dorf gehört ({d.adresse}) – im eingebetteten Fenster schickt der Browser dorthin keine Cookies. Öffne es in einem
              eigenen Tab: <VsCodeKnopf projekt={projekt || undefined} klein text="VS Code in neuem Tab öffnen" testid="vscode-neuer-tab-2" />
            </p>
          )}
          {fehler && <p className="fehler vs-text">{fehler}</p>}
          {bereit && rahmen && (
            <iframe
              key={rahmen.nr}
              src={rahmen.url}
              title="VS Code"
              className="vs-rahmen"
              sandbox={RAHMEN_RECHTE}
              allow={RAHMEN_ERLAUBT}
              referrerPolicy="no-referrer"
              onLoad={() => setGeladen(true)}
              data-testid="vscode-rahmen"
            />
          )}
          {haengt && !geladen && (
            <p className="vs-haengt" role="status">
              VS Code erscheint nicht? Öffne es in einem eigenen Tab (Knopf oben rechts). Im Programm für den Mac braucht das eingebettete VS Code die neueste Programm-Version.
            </p>
          )}
        </div>
        {panel && (
          <aside className="vs-panel" aria-label="Erweiterungen">
            <div className="vs-panel-kopf">
              <strong>🧩 Erweiterungen</strong>
              <button type="button" className="klein" onClick={() => setPanel(false)} aria-label="Erweiterungen schließen">
                ✕
              </button>
            </div>
            <Erweiterungen beiAenderung={() => setGeaendert(true)} />
          </aside>
        )}
      </div>
    </div>
  );
}
