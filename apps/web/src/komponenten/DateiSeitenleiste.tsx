import { lazy, Suspense, useEffect } from 'react';
import type { DateiKarte } from '@dorf/shared';
import { rohUrl } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { dateiSymbol, groesseText } from './Anhaenge';
import { Em } from '../apple/wissen-teile';

// dieselbe Vorschau wie in der Bibliothek (Markdown, Text, PDF, HTML abgeschottet, Bilder, Audio/Video)
const DateiAnsicht = lazy(() => import('../seiten/Bibliothek').then((m) => ({ default: m.DateiAnsicht })));

/** Seitenleiste im Chat: erzeugte Dateien und Anhänge ansehen, ohne den Chat zu verlassen (Esc oder ✕ schließt). */
export function DateiSeitenleiste({ datei, schliessen }: { datei: DateiKarte; schliessen: () => void }) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') schliessen();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [schliessen]);
  return (
    <aside className="datei-seitenleiste" role="dialog" aria-label={`Datei ${datei.name}`}>
      <header className="datei-seitenleiste-kopf">
        <span className="datei-symbol">
          <Em e={dateiSymbol(datei.name)} />
        </span>
        <strong className="datei-name" title={datei.pfad}>
          {datei.name}
        </strong>
        {datei.groesse !== undefined && <span className="leise">{groesseText(datei.groesse)}</span>}
        <span className="abstand" />
        <a className="knopf klein" href={bibliothekUrl(datei.pfad)} onClick={linkKlick} title="In der Bibliothek öffnen (dort auch bearbeiten)" aria-label="In der Bibliothek öffnen">
          <Em e="📚" />
        </a>
        <a className="knopf klein" href={rohUrl(datei.pfad, true)} download={datei.name} title="Herunterladen" aria-label="Herunterladen">
          <Em e="⬇" />
        </a>
        <a className="knopf klein" href={rohUrl(datei.pfad)} target="_blank" rel="noopener noreferrer" title="In neuem Tab" aria-label="In neuem Tab">
          ↗
        </a>
        <button type="button" className="klein" onClick={schliessen} aria-label="Seitenleiste schließen" title="Schließen (Esc)">
          <Em e="✕" />
        </button>
      </header>
      <div className="datei-seitenleiste-inhalt">
        <Suspense fallback={<p className="leise">Lade …</p>}>
          <DateiAnsicht key={datei.pfad} pfad={datei.pfad} />
        </Suspense>
      </div>
    </aside>
  );
}
