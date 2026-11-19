import { useEffect, useRef, useState } from 'react';
import { navigieren } from '../router';

/**
 * E138: Tastenkürzel am PC – nur, wenn nicht gerade in ein Feld getippt wird und ohne Strg/Alt/⌘
 * (Strg/⌘+K bleibt die Befehlspalette). „g“ + Buchstabe springt, „n“ legt ein To-do an, „?“ zeigt die Übersicht.
 */
const SPRUENGE: Record<string, [string, string]> = {
  h: ['/heute', 'Heute'],
  d: ['/', 'Dorf'],
  t: ['/gebaeude/Marktplatz?reiter=todo', 'To-dos'],
  w: ['/gebaeude/Marktplatz?reiter=wochenplan', 'Wochenplan'],
  k: ['/gebaeude/Marktplatz?reiter=kalender', 'Kalender'],
  p: ['/planen', 'Woche planen'],
  u: ['/gebaeude/Uni', 'Uni'],
  r: ['/gebaeude/Rathaus', 'Rathaus'],
  b: ['/bibliothek', 'Bibliothek'],
};

const tippt = (z: EventTarget | null) => {
  const e = z as HTMLElement | null;
  return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName));
};

/** sucht das Feld „Neues To-do“ – auf Heute oder im To-do-Brett; sonst nach Heute und dort fokussieren */
function neuesTodo() {
  // nur ein sichtbares Feld zählt (ausgeblendete Reiter bleiben teils im DOM)
  const feld = () => [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Neues To-do"]')].find((x) => x.offsetParent !== null && x.getClientRects().length > 0) ?? null;
  if (feld()) return feld()!.focus();
  navigieren('/heute');
  let n = 0;
  const t = setInterval(() => {
    if (feld() || ++n > 40) {
      clearInterval(t);
      feld()?.focus();
    }
  }, 50);
}

export function Tastenkuerzel() {
  const [hilfe, setHilfe] = useState(false);
  const g = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || tippt(e.target)) return;
      if (e.key === 'Escape') return setHilfe(false);
      // „g“ und dann innerhalb von 1,5 s ein Buchstabe
      if (g.current && Date.now() - g.current < 1500) {
        g.current = 0;
        const z = SPRUENGE[e.key.toLowerCase()];
        if (z) {
          e.preventDefault();
          setHilfe(false);
          navigieren(z[0]);
        }
        return;
      }
      if (e.key === 'g') {
        g.current = Date.now();
        return;
      }
      if (e.key === 'n') {
        e.preventDefault();
        setHilfe(false);
        return neuesTodo();
      }
      if (e.key === 'f') {
        e.preventDefault();
        return navigieren('/fokus');
      }
      if (e.key === '?') {
        e.preventDefault();
        setHilfe((x) => !x);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  if (!hilfe) return null;
  return (
    <div className="fenster-hintergrund" onClick={() => setHilfe(false)}>
      <div className="karte tasten-hilfe" role="dialog" aria-label="Tastenkürzel" onClick={(e) => e.stopPropagation()}>
        <h2>⌨️ Tastenkürzel</h2>
        <dl>
          <dt>
            <kbd>n</kbd>
          </dt>
          <dd>Neues To-do</dd>
          <dt>
            <kbd>f</kbd>
          </dt>
          <dd>Fokus-Vollbild</dd>
          <dt>
            <kbd>Strg</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd>
          </dt>
          <dd>Befehlspalette</dd>
          {Object.entries(SPRUENGE).map(([t, [, name]]) => (
            <div key={t} className="tasten-zeile">
              <dt>
                <kbd>g</kbd> <kbd>{t}</kbd>
              </dt>
              <dd>{name}</dd>
            </div>
          ))}
          <dt>
            <kbd>?</kbd>
          </dt>
          <dd>Diese Übersicht</dd>
        </dl>
        <button type="button" onClick={() => setHilfe(false)}>
          Schließen
        </button>
      </div>
    </div>
  );
}
