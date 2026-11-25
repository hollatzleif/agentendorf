// E239: gemeinsame Chart-Bausteine im Kielwasser-Stil (Bot-Terminal und Muster-Kielwasser) – SVG ohne Bibliothek.
// Linien mit Fadenkreuz-Tooltip (Werte in Textfarbe, Farbe nur am Punkt), Hilfslinie, Legende ab zwei Linien,
// Kauf-/Verkaufs-Marker (▲/▼ wie im Terminal) mit eigenem Tooltip; die Breite folgt dem Platz (Schrift bleibt am Handy lesbar).
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Farben der kw-Tafeln für Chart-Elemente (Raster, Achsen) */
export const KW_RASTER = '#1c2236';
export const KW_ACHSE = '#8a90a8';
export const KW_GRUEN = '#22c55e';
export const KW_ROT = '#f43f5e';
export const KW_MONO = 'ui-monospace, monospace';

/**
 * Serienfarben auf dunklem Grund (feste Reihenfolge, nie zyklisch vergeben; validierte Kategorie-Palette, dunkle Stufen):
 * blau, orange, türkis, gelb, magenta, grün, violett, rot.
 */
export const SERIEN_FARBEN = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'] as const;

/** Pfad eines Kauf- (▲) bzw. Verkaufs-Markers (▼) um (x, y) */
export function markerPfad(x: number, y: number, kauf: boolean) {
  return kauf ? `M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4} Z` : `M${x} ${y + 5} L${x + 5} ${y - 4} L${x - 5} ${y - 4} Z`;
}

/** Breite eines Elements in px (ResizeObserver) – für viewBox = echte Pixel */
export function useBreite<T extends HTMLElement>(start = 640) {
  const ref = useRef<T>(null);
  const [b, setB] = useState(start);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const messen = () => setB(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    messen();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, b] as const;
}

export interface ChartPunkt {
  x: number;
  y: number;
  /** gefüllter Punkt (z. B. Modell aktiv); undefined = kein Punkt, nur Linie */
  voll?: boolean;
}
export interface ChartSerie {
  id: string;
  name: string;
  farbe: string;
  punkte: ChartPunkt[];
  gestrichelt?: boolean;
  /** Treppe statt Linie (Kapital nach Abschlüssen) */
  stufen?: boolean;
}
export interface ChartMarke {
  id: string;
  x: number;
  y: number;
  kauf: boolean;
  /** Tooltip-Inhalt */
  inhalt: ReactNode;
  /** Farbe des Markers (Standard: Kauf grün, Verkauf rot) */
  farbe?: string;
}

/**
 * Liniendiagramm mit EINER y-Achse. Fadenkreuz am nächsten x (alle Linien mit ihrem Wert), Klick wählt die nächste Linie
 * (onSerie), Marker mit eigenem Tooltip (Drüberfahren/Antippen).
 */
export function LinienChart({
  serien,
  xText,
  xLang,
  yText,
  hilfslinie,
  yMuss = [],
  hoehe = 240,
  onSerie,
  gewaehlt,
  marken = [],
  label,
  testid,
  zusatz,
}: {
  serien: ChartSerie[];
  /** Achsenbeschriftung x (kurz) */
  xText: (x: number) => string;
  /** Kopf des Tooltips (Standard xText) */
  xLang?: (x: number) => string;
  yText: (y: number) => string;
  hilfslinie?: { y: number; text: string };
  /** diese Werte muss die y-Achse zeigen */
  yMuss?: number[];
  hoehe?: number;
  onSerie?: (id: string) => void;
  /** hervorgehobene Serie (dicker) */
  gewaehlt?: string | null;
  marken?: ChartMarke[];
  label: string;
  testid?: string;
  /** weitere Zeilen im Tooltip am Fadenkreuz (z. B. Euro) */
  zusatz?: (x: number, werte: { serie: ChartSerie; y: number }[]) => ReactNode;
}) {
  const [huelle, B] = useBreite<HTMLDivElement>();
  const H = hoehe;
  const R = 58; // Skala rechts
  const L = 6;
  const O = 12;
  const U = 22;
  const [zeiger, setZeiger] = useState<number | null>(null); // x-Wert unter dem Zeiger
  const [marke, setMarke] = useState<ChartMarke | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const alle = serien.flatMap((s) => s.punkte);
  const xs = [...new Set(alle.map((p) => p.x))].sort((a, b) => a - b);
  if (!xs.length)
    return (
      <div className="kw-chart" ref={huelle}>
        <p className="leise mono kw-leer">keine Daten</p>
      </div>
    );
  let x0 = xs[0]!;
  let x1 = xs.at(-1)!;
  for (const m of marken) ((x0 = Math.min(x0, m.x)), (x1 = Math.max(x1, m.x)));
  if (x1 === x0) ((x0 -= 1), (x1 += 1));
  const werte = [...alle.map((p) => p.y), ...yMuss, ...(hilfslinie ? [hilfslinie.y] : []), ...marken.map((m) => m.y)].filter(Number.isFinite);
  let lo = Math.min(...werte);
  let hi = Math.max(...werte);
  if (hi - lo < 1e-12) ((lo -= Math.abs(lo) * 0.05 || 0.5), (hi += Math.abs(hi) * 0.05 || 0.5));
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const px = (x: number) => L + 8 + ((x - x0) / (x1 - x0)) * (B - R - L - 16);
  const py = (y: number) => O + ((hi - y) / (hi - lo)) * (H - O - U);
  const skala = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const xTicks = Math.max(2, Math.min(6, Math.floor(B / 140)));
  const xSkala = Array.from({ length: xTicks }, (_, i) => x0 + ((x1 - x0) * i) / (xTicks - 1));

  const pfad = (s: ChartSerie) => {
    const p = [...s.punkte].sort((a, b) => a.x - b.x);
    return p
      .map((q, i) => {
        if (i === 0) return `M${px(q.x)} ${py(q.y)}`;
        return s.stufen ? `H${px(q.x)} V${py(q.y)}` : `L${px(q.x)} ${py(q.y)}`;
      })
      .join(' ');
  };
  const vbPunkt = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * B, y: ((cy - r.top) / r.height) * H };
  };
  const naechstesX = (vx: number) => {
    let best = xs[0]!;
    for (const x of xs) if (Math.abs(px(x) - vx) < Math.abs(px(best) - vx)) best = x;
    return best;
  };
  /** Wert einer Serie bei x (genau, sonst bei Stufen der letzte davor) */
  const wertBei = (s: ChartSerie, x: number): number | null => {
    const genau = s.punkte.find((p) => p.x === x);
    if (genau) return genau.y;
    if (!s.stufen) return null;
    let v: number | null = null;
    for (const p of s.punkte) if (p.x <= x) v = p.y;
    return v;
  };
  const zw = zeiger != null ? serien.map((s) => ({ serie: s, y: wertBei(s, zeiger) })).filter((w): w is { serie: ChartSerie; y: number } => w.y != null) : [];
  const links = (x: number) => `${Math.max(0, Math.min(B - 200, px(x) + 12))}px`;

  return (
    <div className="kw-chart kw-linien" ref={huelle} data-testid={testid}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${B} ${H}`}
        width={B}
        height={H}
        role="img"
        aria-label={label}
        style={{ touchAction: 'pan-y', cursor: onSerie ? 'pointer' : 'crosshair' }}
        onPointerMove={(e) => setZeiger(naechstesX(vbPunkt(e.clientX, e.clientY).x))}
        onPointerLeave={() => setZeiger(null)}
        onClick={(e) => {
          if (!onSerie || !serien.length) return;
          const p = vbPunkt(e.clientX, e.clientY);
          const x = naechstesX(p.x);
          let best: ChartSerie | null = null;
          let d = Infinity;
          for (const s of serien) {
            const y = wertBei(s, x);
            if (y == null) continue;
            const dd = Math.abs(py(y) - p.y);
            if (dd < d) ((d = dd), (best = s));
          }
          if (best) onSerie(best.id);
        }}
      >
        {skala.map((v) => (
          <g key={v}>
            <line x1={L} x2={B - R} y1={py(v)} y2={py(v)} stroke={KW_RASTER} strokeWidth={1} />
            <text x={B - R + 6} y={py(v) + 4} fill={KW_ACHSE} fontSize={10.5} fontFamily={KW_MONO}>
              {yText(v)}
            </text>
          </g>
        ))}
        {xSkala.map((x, i) => (
          <text key={i} x={px(x)} y={H - 6} fill={KW_ACHSE} fontSize={10.5} fontFamily={KW_MONO} textAnchor={i === 0 ? 'start' : i === xSkala.length - 1 ? 'end' : 'middle'}>
            {xText(x)}
          </text>
        ))}
        {hilfslinie && hilfslinie.y > lo && hilfslinie.y < hi && (
          <g data-testid="chart-hilfslinie">
            <line x1={L} x2={B - R} y1={py(hilfslinie.y)} y2={py(hilfslinie.y)} stroke={KW_ACHSE} strokeDasharray="4 4" strokeWidth={1} />
            <rect x={B - R - 8 - hilfslinie.text.length * 6.4} y={py(hilfslinie.y) - 16} width={hilfslinie.text.length * 6.4 + 6} height={14} rx={3} fill="#10131f" opacity={0.85} />
            <text x={B - R - 5} y={py(hilfslinie.y) - 5} fill={KW_ACHSE} fontSize={10.5} fontFamily={KW_MONO} textAnchor="end">
              {hilfslinie.text}
            </text>
          </g>
        )}
        {serien.map((s) => (
          <g key={s.id} data-serie={s.id}>
            <path d={pfad(s)} fill="none" stroke={s.farbe} strokeWidth={gewaehlt === s.id ? 3 : 2} strokeDasharray={s.gestrichelt ? '6 4' : undefined} strokeLinejoin="round" opacity={gewaehlt && gewaehlt !== s.id ? 0.55 : 1} />
            {s.punkte
              .filter((p) => p.voll !== undefined)
              .map((p) => (
                <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r={4} fill={p.voll ? s.farbe : '#10131f'} stroke={s.farbe} strokeWidth={2} data-voll={p.voll ? '1' : '0'} />
              ))}
          </g>
        ))}
        {zeiger != null && (
          <g pointerEvents="none">
            <line x1={px(zeiger)} x2={px(zeiger)} y1={O} y2={H - U} stroke="#c4b5fd" strokeDasharray="3 3" strokeWidth={1} />
            {zw.map((w) => (
              <circle key={w.serie.id} cx={px(zeiger)} cy={py(w.y)} r={4.5} fill={w.serie.farbe} stroke="#0d1117" strokeWidth={2} />
            ))}
          </g>
        )}
        {marken.map((m) => (
          <g
            key={m.id}
            className="kw-marker"
            data-testid={m.kauf ? 'rl-marker-kauf' : 'rl-marker-verkauf'}
            onPointerEnter={() => setMarke(m)}
            onPointerLeave={() => setMarke(null)}
            onPointerDown={(e) => {
              e.stopPropagation();
              setMarke(m);
            }}
          >
            <circle cx={px(m.x)} cy={py(m.y) + (m.kauf ? 11 : -11)} r={9} fill="transparent" />
            <path d={markerPfad(px(m.x), py(m.y) + (m.kauf ? 11 : -11), m.kauf)} fill={m.farbe ?? (m.kauf ? KW_GRUEN : KW_ROT)} stroke="#0d1117" strokeWidth={1} />
          </g>
        ))}
      </svg>
      {zeiger != null && !marke && zw.length > 0 && (
        <div className="kw-fadenkreuz" style={{ left: links(zeiger), top: '0.4rem' }} data-testid="chart-zeiger">
          <b>{(xLang ?? xText)(zeiger)}</b>
          {[...zw]
            .sort((a, b) => b.y - a.y)
            .map((w) => (
              <div key={w.serie.id} className="kw-tip-zeile">
                <i style={{ background: w.serie.farbe }} aria-hidden />
                {w.serie.name}: <b>{yText(w.y)}</b>
              </div>
            ))}
          {zusatz?.(zeiger, zw)}
        </div>
      )}
      {marke && (
        <div className="kw-fadenkreuz" style={{ left: links(marke.x), top: `${Math.min(H - 120, Math.max(4, py(marke.y) - 40))}px` }} data-testid="chart-marker">
          {marke.inhalt}
        </div>
      )}
      {serien.length >= 2 && (
        <div className="kw-legende" aria-label="Legende">
          {serien.map((s) => (
            <button key={s.id} type="button" className={gewaehlt === s.id ? 'an' : ''} onClick={onSerie ? () => onSerie(s.id) : undefined} disabled={!onSerie} aria-pressed={onSerie ? gewaehlt === s.id : undefined}>
              <i className={s.gestrichelt ? 'gestrichelt' : ''} style={{ ['--farbe' as string]: s.farbe }} aria-hidden />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
