import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DIAGRAMM_FARBEN, type Punkt } from '@dorf/shared';
import { useDesign } from '../apple/design';

/** E240: Reihenfolge der Reihen-Farben in der Apple-Oberfläche (Systemfarben; Grün/Rot bleiben für Plus/Minus) */
const FARBEN_APPLE = ['var(--a-blau)', 'var(--a-orange)', 'var(--a-mint)', 'var(--a-lila)', 'var(--a-pink)', 'var(--a-gelb)', 'var(--a-indigo)', 'var(--a-cyan)'];

/** E223: Farben je Reihe – feste Reihenfolge (geprüfte Kategorie-Palette), nie nach Rang; E225: wählbar unter Aussehen → Diagramme */
export const FARBEN = new Proxy([] as string[], {
  get(_z, k) {
    const p =
      document.documentElement.dataset.design === 'apple'
        ? FARBEN_APPLE
        : (DIAGRAMM_FARBEN[(document.documentElement.dataset.diagramme as keyof typeof DIAGRAMM_FARBEN) || 'standard'] ?? DIAGRAMM_FARBEN.standard);
    return (p as unknown as Record<string | symbol, unknown>)[k];
  },
});

/** Privatsphäre: Beträge verbergen (Gerät merkt es sich; auch in Einstellungen → Aussehen) */
export function usePrivat(): [boolean, (x: boolean) => void] {
  const [an, setAn] = useState(() => localStorage.getItem('dorf-privat') === '1');
  useEffect(() => {
    const f = () => setAn(localStorage.getItem('dorf-privat') === '1');
    window.addEventListener('dorf-privat', f);
    return () => window.removeEventListener('dorf-privat', f);
  }, []);
  return [
    an,
    (x) => {
      localStorage.setItem('dorf-privat', x ? '1' : '0');
      window.dispatchEvent(new Event('dorf-privat'));
    },
  ];
}

export function geldFormat(privat: boolean, waehrung = 'EUR', nachkomma = 2) {
  return (n: number | null | undefined, vorzeichen = false) => {
    if (n == null || !Number.isFinite(n)) return '–';
    if (privat) return '•••';
    const t = Math.abs(n).toLocaleString('de-DE', { style: 'currency', currency: waehrung, maximumFractionDigits: nachkomma, minimumFractionDigits: nachkomma });
    return `${n < 0 ? '−' : vorzeichen ? '+' : ''}${t}`;
  };
}
export const prozentText = (a: number | null | undefined, stellen = 1) => (a == null || !Number.isFinite(a) ? '–' : `${a > 0 ? '+' : a < 0 ? '−' : ''}${Math.abs(a * 100).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} %`);
export const datumKurz = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });

export interface Reihe {
  schluessel: string;
  name: string;
  farbe: string;
  punkte: Punkt[];
  /** gestrichelt (z. B. Summe, geschätzt) */
  strich?: boolean;
}

/**
 * Liniendiagramm mit Achsen, Fadenkreuz und Tooltip (alle sichtbaren Reihen am Tag unter dem Zeiger).
 * `format` beschriftet die y-Achse und den Tooltip.
 */
export function LinienDiagramm({ reihen, format, hoehe = 280, nullLinie, referenz }: { reihen: Reihe[]; format: (n: number) => string; hoehe?: number; nullLinie?: number; referenz?: { wert: number; text: string } }) {
  // Breite = echte Breite des Rahmens (Schrift bleibt lesbar, am Handy wie am PC)
  const [B, setB] = useState(820);
  const rahmen = useRef<HTMLDivElement>(null);
  const apple = useDesign() === 'apple';
  const verlaufId = `dgv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useEffect(() => {
    const el = rahmen.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setB(Math.max(300, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = B < 500 ? Math.round(hoehe * 0.8) : hoehe;
  const L = B < 500 ? 62 : 78;
  const R = 12;
  const O = 12;
  const U = 28;
  const ref = useRef<SVGSVGElement>(null);
  const [zeiger, setZeiger] = useState<number | null>(null);
  const tage = useMemo(() => [...new Set(reihen.flatMap((r) => r.punkte.map(([d]) => d)))].sort(), [reihen]);
  const werte = reihen.flatMap((r) => r.punkte.map(([, v]) => v)).filter(Number.isFinite);
  if (tage.length < 2 || !werte.length)
    return (
      <div className="diagramm" ref={rahmen}>
        <p className="leise">Für diesen Zeitraum gibt es zu wenige Daten.</p>
      </div>
    );
  const extra = [...(nullLinie != null ? [nullLinie] : []), ...(referenz ? [referenz.wert] : [])];
  let min = Math.min(...werte, ...extra);
  let max = Math.max(...werte, ...extra);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const rand = (max - min) * 0.06;
  const nieNegativ = Math.min(...werte) >= 0;
  min = nieNegativ ? Math.max(0, min - rand) : min - rand;
  max += rand;
  const t0 = Date.parse(tage[0]!);
  const t1 = Date.parse(tage.at(-1)!);
  const x = (d: string) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (B - L - R);
  const y = (v: number) => O + (1 - (v - min) / (max - min)) * (H - O - U);
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const nx = B < 500 ? 3 : 5;
  const xTicks = Array.from({ length: nx }, (_, i) => tage[Math.round(((tage.length - 1) * i) / (nx - 1))]!);
  const pfad = (p: Punkt[]) => p.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const tagUnter = zeiger == null ? null : tage[zeiger]!;
  const wertAm = (r: Reihe, tag: string) => {
    let v: number | null = null;
    for (const [d, w] of r.punkte) {
      if (d > tag) break;
      v = w;
    }
    return v;
  };
  const bewegen = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * B;
    const t = t0 + ((px - L) / (B - L - R)) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < tage.length; i++) if (Math.abs(Date.parse(tage[i]!) - t) < Math.abs(Date.parse(tage[best]!) - t)) best = i;
    setZeiger(best);
  };
  return (
    <div className="diagramm" ref={rahmen}>
      <svg ref={ref} viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`Diagramm: ${reihen.map((r) => r.name).join(', ')}`} onPointerMove={bewegen} onPointerLeave={() => setZeiger(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={B - R} y1={y(v)} y2={y(v)} className="diagramm-gitter" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="diagramm-achse">
              {format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={`${d}${i}`} x={x(d)} y={H - 8} textAnchor={i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'} className="diagramm-achse">
            {datumKurz(d)}
          </text>
        ))}
        {nullLinie != null && <line x1={L} x2={B - R} y1={y(nullLinie)} y2={y(nullLinie)} className="diagramm-null" />}
        {referenz && (
          <g>
            <line x1={L} x2={B - R} y1={y(referenz.wert)} y2={y(referenz.wert)} className="diagramm-referenz" />
            <text x={B - R - 4} y={y(referenz.wert) - 5} textAnchor="end" className="diagramm-achse diagramm-referenz-text">
              {referenz.text}
            </text>
          </g>
        )}
        {/* E240: Apple – eine Linie bekommt eine Verlaufsfläche darunter (Aktien-Stil) */}
        {apple && reihen.length === 1 && reihen[0]!.punkte.length > 1 && (
          <g aria-hidden>
            <defs>
              <linearGradient id={verlaufId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={reihen[0]!.farbe} stopOpacity={0.26} />
                <stop offset="100%" stopColor={reihen[0]!.farbe} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path className="diagramm-flaeche" d={`${pfad(reihen[0]!.punkte)} L${x(reihen[0]!.punkte.at(-1)![0]).toFixed(1)},${(H - U).toFixed(1)} L${x(reihen[0]!.punkte[0]![0]).toFixed(1)},${(H - U).toFixed(1)} Z`} fill={`url(#${verlaufId})`} stroke="none" />
          </g>
        )}
        {reihen.map((r) => (
          <path key={r.schluessel} d={pfad(r.punkte)} fill="none" stroke={r.farbe} strokeWidth={apple ? 1.75 : 2} strokeDasharray={r.strich ? '6 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
        {tagUnter && (
          <g>
            <line x1={x(tagUnter)} x2={x(tagUnter)} y1={O} y2={H - U} className="diagramm-zeiger" />
            {reihen.map((r) => {
              const v = wertAm(r, tagUnter);
              return v == null ? null : <circle key={r.schluessel} cx={x(tagUnter)} cy={y(v)} r={4.5} fill={r.farbe} stroke={apple ? 'var(--a-flaeche)' : 'var(--flaeche, #fff)'} strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {tagUnter && (
        <div className="diagramm-tip" style={{ left: `${Math.min(80, Math.max(2, (x(tagUnter) / B) * 100 - 8))}%` }} role="status">
          <strong>{datumKurz(tagUnter)}</strong>
          {reihen.map((r) => {
            const v = wertAm(r, tagUnter);
            return (
              <div key={r.schluessel}>
                <span className="diagramm-punkt" style={{ background: r.farbe }} /> {r.name}: <strong>{v == null ? '–' : format(v)}</strong>
              </div>
            );
          })}
        </div>
      )}
      {reihen.length > 1 && (
        <ul className="diagramm-legende" aria-label="Legende">
          {reihen.map((r) => (
            <li key={r.schluessel}>
              <span className={`diagramm-punkt${r.strich ? ' strich' : ''}`} style={{ background: r.farbe }} /> {r.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Gestapelter Balken (Anteile) mit Liste – für Allokationen */
export function AnteilBalken({ teile, format }: { teile: { name: string; wert: number; farbe: string }[]; format: (n: number) => string }) {
  const summe = teile.reduce((s, t) => s + Math.max(0, t.wert), 0);
  if (!summe) return <p className="leise">Keine Werte.</p>;
  return (
    <div className="anteile">
      <div className="anteile-balken" role="img" aria-label={teile.map((t) => `${t.name} ${((t.wert / summe) * 100).toFixed(0)} %`).join(', ')}>
        {teile.map((t) => (
          <span key={t.name} style={{ width: `${(Math.max(0, t.wert) / summe) * 100}%`, background: t.farbe }} title={`${t.name}: ${((t.wert / summe) * 100).toFixed(1)} %`} />
        ))}
      </div>
      <ul className="anteile-liste">
        {teile.map((t) => (
          <li key={t.name}>
            <span className="diagramm-punkt" style={{ background: t.farbe }} />
            <span className="anteile-name">{t.name}</span>
            <span className="anteile-zahl">{((t.wert / summe) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</span>
            <span className="anteile-zahl leise">{format(t.wert)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mini-Verlauf (z. B. 3 Monate) – Farbe nach Richtung, mit Text für Screenreader */
export function Sparkline({ punkte, breite = 90, hoehe = 26 }: { punkte: Punkt[]; breite?: number; hoehe?: number }) {
  if (punkte.length < 3) return null;
  const w = punkte.map(([, v]) => v);
  const min = Math.min(...w);
  const max = Math.max(...w);
  const sp = max - min || 1;
  const d = punkte.map(([, v], i) => `${i ? 'L' : 'M'}${((i / (punkte.length - 1)) * breite).toFixed(1)},${(hoehe - 2 - ((v - min) / sp) * (hoehe - 4)).toFixed(1)}`).join(' ');
  const plus = w.at(-1)! >= w[0]!;
  const pr = (w.at(-1)! / w[0]! - 1) * 100;
  return (
    <svg className="sparkline" width={breite} height={hoehe} viewBox={`0 0 ${breite} ${hoehe}`} role="img" aria-label={`Verlauf: ${pr >= 0 ? '+' : ''}${pr.toFixed(1)} %`}>
      <path d={d} fill="none" stroke={plus ? 'var(--gruen)' : 'var(--rot)'} strokeWidth={1.8} strokeLinejoin="round" className={plus ? 'sparkline-plus' : 'sparkline-minus'} />
    </svg>
  );
}
