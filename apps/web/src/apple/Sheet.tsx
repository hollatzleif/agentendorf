// E240: Sheet der Apple-Oberfläche – am Handy von unten (mit Griff, nach unten wegziehen), am Desktop in der Mitte; Scrim dahinter.
// Wegziehen folgt dem Finger 1:1; beim Loslassen entscheidet die projizierte Endlage (Geschwindigkeit, wie in UIKit), ob es zugeht
// oder per Feder zurückfedert. Esc und Klick auf den Scrim schließen. Für alle Bereiche nutzbar.
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Apples Projektion der Endlage aus der Geschwindigkeit (px/s), Verzögerung wie beim normalen Scrollen */
const projizieren = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);

export function Sheet({ titel, onSchliessen, children, fertigText = 'Fertig', label }: { titel: string; onSchliessen: () => void; children: ReactNode; fertigText?: string; label?: string }) {
  const [zu, setZu] = useState(false);
  const blatt = useRef<HTMLDivElement>(null);
  const zug = useRef<{ start: number; y: number; t: number; v: number; id: number } | null>(null);
  const schliessen = () => {
    if (zu) return;
    setZu(true);
    const reduziert = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(onSchliessen, reduziert ? 0 : 230);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && schliessen();
    window.addEventListener('keydown', k);
    const vorher = document.activeElement as HTMLElement | null;
    blatt.current?.focus();
    return () => {
      window.removeEventListener('keydown', k);
      vorher?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runter = (e: React.PointerEvent) => {
    // nur am Griff/Kopf – der Inhalt bleibt frei scrollbar
    const ziel = e.target as HTMLElement;
    if (window.innerWidth >= 700 || !ziel.closest('.a-sheet-kopf, .a-sheet-griff') || ziel.closest('button, a, input, select, textarea')) return;
    zug.current = { start: e.clientY, y: e.clientY, t: performance.now(), v: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (blatt.current) blatt.current.style.transition = 'none';
  };
  const ziehen = (e: React.PointerEvent) => {
    const z = zug.current;
    if (!z || !blatt.current) return;
    const jetzt = performance.now();
    z.v = ((e.clientY - z.y) / Math.max(1, jetzt - z.t)) * 1000;
    z.y = e.clientY;
    z.t = jetzt;
    const dy = e.clientY - z.start;
    // nach oben: Gummiband statt harter Grenze
    const weg = dy >= 0 ? dy : -((-dy * 0.55 * 300) / (300 + 0.55 * -dy));
    blatt.current.style.transform = `translateY(${weg}px)`;
  };
  const los = () => {
    const z = zug.current;
    zug.current = null;
    if (!z || !blatt.current) return;
    const dy = z.y - z.start;
    const hoehe = blatt.current.offsetHeight;
    const b = blatt.current;
    if (dy + projizieren(z.v) > hoehe * 0.45) {
      b.style.transition = `transform 0.26s cubic-bezier(0.25, 1, 0.5, 1)`;
      b.style.transform = `translateY(${hoehe + 40}px)`;
      window.setTimeout(onSchliessen, 240);
      return;
    }
    b.style.transition = `transform var(--a-dauer) var(--a-feder)`;
    b.style.transform = '';
  };

  return (
    <div className={`a-sheet-hintergrund${zu ? ' zu' : ''}`} onClick={schliessen}>
      <div
        ref={blatt}
        className="a-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label ?? titel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={runter}
        onPointerMove={ziehen}
        onPointerUp={los}
        onPointerCancel={los}
      >
        <div className="a-sheet-griff" aria-hidden="true" />
        <div className="a-sheet-kopf">
          <h2>{titel}</h2>
          <button type="button" className="a-sheet-fertig" onClick={schliessen}>
            {fertigText}
          </button>
        </div>
        <div className="a-sheet-inhalt">{children}</div>
      </div>
    </div>
  );
}
