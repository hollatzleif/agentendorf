// E240 (Bereich C – Gebäude & Wissen): kleine Bausteine, die nur in der Apple-Oberfläche anders aussehen.
// Im Dorf-Design geben sie genau den bisherigen Text zurück (keine zusätzlichen Elemente, gleiche zugänglichen Namen).
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDesign } from './design';
import { Ikon } from './Ikon';
import { Sheet } from './Sheet';

/** Emoji im Dorf-Design als schlichter Text (wie bisher), in Apple als Linien-Symbol */
export function Em({ e }: { e: string }) {
  return useDesign() === 'apple' ? <Ikon e={e} /> : <>{e}</>;
}

/** Text nur für Bildschirmleser (Apple: runde Knöpfe zeigen ein Symbol, der Name bleibt) */
export function Unsichtbar({ children }: { children: ReactNode }) {
  return <span className="a-unsichtbar">{children}</span>;
}

/** Chevron wie in iOS-Listen und Zurück-Knöpfen */
export function Chevron({ richtung = 'rechts', groesse = '0.85em' }: { richtung?: 'links' | 'rechts' | 'unten' | 'oben'; groesse?: string }) {
  const d = richtung === 'links' ? 'M15 5l-7 7 7 7' : richtung === 'unten' ? 'M5 9l7 7 7-7' : richtung === 'oben' ? 'M5 15l7-7 7 7' : 'M9 5l7 7-7 7';
  return (
    <svg className="a-chevron" viewBox="0 0 24 24" width={groesse} height={groesse} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Fortschrittsring (Aktivität/Health-Stil) – anteil 0…1 */
export function Ring({ anteil, groesse = 44, staerke = 5, farbe = 'var(--a-blau)', children }: { anteil: number; groesse?: number; staerke?: number; farbe?: string; children?: ReactNode }) {
  const r = (groesse - staerke) / 2;
  const u = 2 * Math.PI * r;
  const a = Math.max(0, Math.min(1, anteil));
  return (
    <span className="a-ring" style={{ width: groesse, height: groesse }} aria-hidden>
      <svg viewBox={`0 0 ${groesse} ${groesse}`} width={groesse} height={groesse}>
        <circle cx={groesse / 2} cy={groesse / 2} r={r} fill="none" stroke="var(--a-fuellung2)" strokeWidth={staerke} />
        {a > 0 && (
          <circle
            className="a-ring-wert"
            cx={groesse / 2}
            cy={groesse / 2}
            r={r}
            fill="none"
            stroke={farbe}
            strokeWidth={staerke}
            strokeLinecap="round"
            strokeDasharray={`${u * a} ${u}`}
            transform={`rotate(-90 ${groesse / 2} ${groesse / 2})`}
          />
        )}
      </svg>
      {children !== undefined && <span className="a-ring-innen">{children}</span>}
    </span>
  );
}

/** Pfeil nach oben im runden Senden-Knopf (wie in Nachrichten) */
export function PfeilHoch() {
  return (
    <svg className="a-pfeil-hoch" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

/**
 * Sheet (nur Apple): das gemeinsame Sheet aus apple/Sheet.tsx, ans Ende von <body> gehängt – sonst läge es in der
 * Stapelebene der Seite (Seitenleisten darüber). Der Inhalt bleibt dieselbe Komponente wie im Dorf-Design.
 */
export function Blatt({ titel, schliessen, children }: { titel: string; schliessen: () => void; children: ReactNode }) {
  return createPortal(
    <Sheet titel={titel} onSchliessen={schliessen}>
      <div className="a-blatt-inhalt">{children}</div>
    </Sheet>,
    document.body,
  );
}
