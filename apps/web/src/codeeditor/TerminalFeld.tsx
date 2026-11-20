import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEingabe, TerminalMeldung } from '@dorf/shared';
import type { Thema } from './monaco';

/**
 * Terminal im Editor (E197): xterm.js (MIT) ↔ WebSocket zum Dorf (/api/coding/terminal, Sitzung + Herkunft wie /api/live)
 * ↔ Shell am PTY im Coding-Container. Eine Verbindung = eine Shell; schließt man das Terminal, endet die Shell.
 */
const FARBEN: Record<Thema, NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme']> = {
  hell: {
    background: '#fffdf6', foreground: '#2b3a55', cursor: '#e8761a', cursorAccent: '#fffdf6', selectionBackground: '#cfe8c0',
    black: '#2b3a55', red: '#c2281d', green: '#2f8a2b', yellow: '#9a6a00', blue: '#1d6fa5', magenta: '#8a3fa0', cyan: '#147a7a', white: '#8a93a3',
    brightBlack: '#5c677a', brightRed: '#d2352a', brightGreen: '#3fa63a', brightYellow: '#b85c00', brightBlue: '#2d85c4', brightMagenta: '#a352bd', brightCyan: '#1b9a9a', brightWhite: '#2b3a55',
  },
  dunkel: { background: '#1b2538', foreground: '#e8edf5', cursor: '#f2b51e', cursorAccent: '#1b2538', selectionBackground: '#3d5a8a' },
};

export function TerminalFeld({ projekt, thema, sichtbar }: { projekt: string; thema: Thema; sichtbar: boolean }) {
  const kasten = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const passen = useRef<FitAddon | null>(null);
  const [zustand, setZustand] = useState<'verbinde' | 'bereit' | 'beendet'>('verbinde');
  const [fehler, setFehler] = useState('');
  const [runde, setRunde] = useState(0);

  useEffect(() => {
    const el = kasten.current!;
    const t = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', cursorBlink: true, scrollback: 5000, theme: FARBEN[thema], allowProposedApi: false });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    term.current = t;
    passen.current = fit;
    try {
      fit.fit();
    } catch {
      /* noch unsichtbar */
    }
    setZustand('verbinde');
    setFehler('');
    const frage = new URLSearchParams({ projekt, spalten: String(t.cols), zeilen: String(t.rows) });
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/coding/terminal?${frage}`);
    ws.binaryType = 'arraybuffer';
    const senden = (m: TerminalEingabe) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return t.write(new Uint8Array(e.data as ArrayBuffer));
      const m = JSON.parse(e.data) as TerminalMeldung;
      if (m.typ === 'bereit') {
        setZustand('bereit');
        senden({ typ: 'groesse', spalten: t.cols, zeilen: t.rows });
      } else if (m.typ === 'fehler') setFehler(m.text);
    };
    ws.onclose = (e) => {
      setZustand('beendet');
      if (e.code === 4001) return; // abgemeldet – die App springt ohnehin zur Anmeldung
      t.write('\r\n\x1b[2m[Terminal beendet]\x1b[0m\r\n');
    };
    // Eingabe in Stücken (ein großes Einfügen passt sonst nicht in eine WebSocket-Nachricht)
    const tippen = t.onData((daten) => {
      for (let i = 0; i < daten.length; i += 16_000) senden({ typ: 'eingabe', daten: daten.slice(i, i + 16_000) });
    });
    const groesse = t.onResize(({ cols, rows }) => senden({ typ: 'groesse', spalten: cols, zeilen: rows }));
    const beobachter = new ResizeObserver(() => {
      if (!el.offsetParent) return;
      try {
        fit.fit();
      } catch {
        /* während des Umbaus */
      }
    });
    beobachter.observe(el);
    // Testhilfe (wie window.__dorf): Text des sichtbaren Puffers
    (el as HTMLDivElement & { __text?: () => string }).__text = () => {
      const b = t.buffer.active;
      const z: string[] = [];
      for (let i = 0; i < b.length; i++) z.push(b.getLine(i)?.translateToString(true) ?? '');
      return z.join('\n');
    };
    return () => {
      beobachter.disconnect();
      tippen.dispose();
      groesse.dispose();
      ws.onclose = null;
      ws.close();
      t.dispose();
      term.current = null;
    };
    // thema bewusst nicht: ein Themenwechsel soll die Shell nicht beenden (siehe unten)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projekt, runde]);

  useEffect(() => {
    if (term.current) term.current.options.theme = FARBEN[thema];
  }, [thema]);

  useEffect(() => {
    if (!sichtbar) return;
    try {
      passen.current?.fit();
    } catch {
      /* egal */
    }
    term.current?.focus();
  }, [sichtbar]);

  return (
    <div className={`ce-terminal ${thema}`} style={{ display: sichtbar ? undefined : 'none' }}>
      <div className="ce-terminal-kasten" ref={kasten} data-testid="terminal" data-zustand={zustand} />
      {(fehler || zustand === 'beendet') && (
        <div className="ce-terminal-meldung">
          {fehler && <span className="fehler">{fehler} </span>}
          {zustand === 'beendet' && (
            <button type="button" className="klein" onClick={() => setRunde((r) => r + 1)}>
              Neu starten
            </button>
          )}
        </div>
      )}
    </div>
  );
}
