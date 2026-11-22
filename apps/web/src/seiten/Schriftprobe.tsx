import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';
import { linkKlick } from '../router';

/**
 * E216 – Schriftprobe: Leif schreibt jedes Zeichen ein paar Mal mit Stift/Finger/Maus. Gespeichert als echte Striche
 * (x, y, Zeit, Druck) in Versalhöhen-Einheiten (Grundlinie y = 0, Versalhöhe y = -1) in Atelier/schriftprobe.json –
 * handschrift_schreiben schreibt damit in seiner Hand (Rechenraum, handformel.py).
 */
type Punkt = number[]; // [x, y, t, druck]
type Strich = Punkt[];
type Variante = Strich[];
type Zeichen = Record<string, Variante[]>;
type Antwort = { vorhanden: boolean; probe: { version: 1; zeichen: Zeichen } | null };

export const GRUPPEN: { titel: string; zeichen: string; ziel: number }[] = [
  { titel: 'Kleinbuchstaben', zeichen: 'abcdefghijklmnopqrstuvwxyz', ziel: 3 },
  { titel: 'Großbuchstaben', zeichen: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ziel: 2 },
  { titel: 'Ziffern', zeichen: '0123456789', ziel: 3 },
  { titel: 'Umlaute', zeichen: 'äöüÄÖÜß', ziel: 2 },
  { titel: 'Satzzeichen', zeichen: '.,:;!?-()"\'/', ziel: 2 },
  { titel: 'Mathe', zeichen: '+=×·÷<>≤≥≠≈±√∫∑∞^|[]{}%', ziel: 1 },
  { titel: 'Logik', zeichen: '∧∨¬→↔⇒⇔⊢⊨⊤⊥∀∃∈∅□', ziel: 1 },
  { titel: 'Griechisch', zeichen: 'αβγδελμπσφωΔΣΩ', ziel: 1 },
];
const ALLE = GRUPPEN.flatMap((g) => Array.from(g.zeichen).map((z) => ({ z, ziel: g.ziel })));
const ZIEL = new Map(ALLE.map((a) => [a.z, a.ziel]));
const MAX_VARIANTEN = 8;
const MAX_STRICHE = 40;
const MAX_PUNKTE = 4000;

// Kästchen: Versalhöhe = 42 % der Höhe, Grundlinie bei 68 % – darunter Platz für g, j, p, q, y
const EM = 0.42;
const GRUND = 0.68;
const X_HOEHE = 0.62; // Hilfslinie für Kleinbuchstaben (Anteil der Versalhöhe)

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function Schriftprobe() {
  const qc = useQueryClient();
  const geladen = useQuery({ queryKey: ['schriftprobe'], queryFn: () => api<Antwort>('/api/atelier/schriftprobe') });
  const [zeichen, setZeichen] = useState<Zeichen | null>(null);
  const [aktuell, setAktuell] = useState(ALLE[0]!.z);
  const [striche, setStriche] = useState<Variante>([]);
  const [status, setStatus] = useState<{ text: string; fehler?: boolean } | null>(null);
  const [vorschauText, setVorschauText] = useState('The quick brown fox jumps over the lazy dog. 3x + 5 = 20');
  const leinwand = useRef<HTMLCanvasElement>(null);
  const zug = useRef<{ start: number; strich: Strich | null; id: number | null }>({ start: 0, strich: null, id: null });
  const speichernLaeuft = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (zeichen === null && geladen.data) {
      const z = geladen.data.probe?.zeichen ?? {};
      setZeichen(z);
      const offen = ALLE.find((a) => (z[a.z]?.length ?? 0) < a.ziel);
      if (offen) setAktuell(offen.z);
    }
  }, [geladen.data, zeichen]);

  const anzahl = (z: string) => zeichen?.[z]?.length ?? 0;
  const fortschritt = useMemo(() => {
    let fertig = 0;
    let ziel = 0;
    for (const a of ALLE) {
      ziel += a.ziel;
      fertig += Math.min(a.ziel, zeichen?.[a.z]?.length ?? 0);
    }
    return { fertig, ziel };
  }, [zeichen]);

  // ---- Zeichnen ----------------------------------------------------------------------------------------------------
  const malen = useCallback(() => {
    const c = leinwand.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const b = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(b * dpr)) c.width = Math.round(b * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b, h);
    const em = EM * h;
    const g = GRUND * h;
    const linie = (y: number, farbe: string, strich: number[] = []) => {
      ctx.beginPath();
      ctx.setLineDash(strich);
      ctx.strokeStyle = farbe;
      ctx.lineWidth = 1.5;
      ctx.moveTo(0, y);
      ctx.lineTo(b, y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    linie(g - em, '#9fb3cf', [6, 6]);
    linie(g - X_HOEHE * em, '#c9d6e6', [3, 5]);
    linie(g, '#2b3a55');
    // Vorlage ganz blass, damit man weiß, was dran ist
    ctx.fillStyle = 'rgb(43 58 85 / 0.07)';
    ctx.font = `${em * 1.38}px system-ui, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(aktuell, 0.12 * b, g);
    ctx.strokeStyle = '#1d4fa3';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of striche) {
      ctx.beginPath();
      s.forEach((p, i) => {
        const x = p[0]! * em;
        const y = g + p[1]! * em;
        ctx.lineWidth = 1.5 + 3.5 * (p[3] ?? 0.5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (s.length === 1) ctx.lineTo(s[0]![0]! * em + 0.5, g + s[0]![1]! * em);
      ctx.stroke();
    }
  }, [aktuell, striche]);

  useEffect(() => {
    malen();
    const c = leinwand.current;
    if (!c) return;
    const ro = new ResizeObserver(() => malen());
    ro.observe(c);
    return () => ro.disconnect();
  }, [malen]);

  const punktVon = (e: PointerEvent | React.PointerEvent): Punkt => {
    const c = leinwand.current!;
    const r = c.getBoundingClientRect();
    const em = EM * r.height;
    const druck = e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5;
    return [r3((e.clientX - r.left) / em), r3((e.clientY - r.top - GRUND * r.height) / em), Math.round(performance.now() - zug.current.start), Math.round(druck * 100) / 100];
  };

  const runter = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (zug.current.id !== null || striche.length >= MAX_STRICHE) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (striche.length === 0) zug.current.start = performance.now();
    zug.current.id = e.pointerId;
    zug.current.strich = [punktVon(e)];
    setStriche((s) => [...s, zug.current.strich!]);
  };
  const bewegen = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (zug.current.id !== e.pointerId || !zug.current.strich) return;
    const ereignisse = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const s = zug.current.strich;
    for (const ev of ereignisse.length ? ereignisse : [e.nativeEvent]) {
      if (s.length >= MAX_PUNKTE) break;
      const p = punktVon(ev);
      const l = s[s.length - 1]!;
      if (p[2]! < l[2]!) p[2] = l[2]!;
      if (Math.hypot(p[0]! - l[0]!, p[1]! - l[1]!) < 0.004) continue;
      s.push(p);
    }
    setStriche((alt) => [...alt.slice(0, -1), [...s]]);
  };
  const hoch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (zug.current.id !== e.pointerId) return;
    zug.current.id = null;
    zug.current.strich = null;
  };

  // ---- Speichern ---------------------------------------------------------------------------------------------------
  const speichern = (neu: Zeichen, meldung: string) => {
    setZeichen(neu);
    // nacheinander (die App schickt immer die ganze Probe – die zuletzt gesendete gilt)
    speichernLaeuft.current = speichernLaeuft.current
      .catch(() => undefined)
      .then(() => api('/api/atelier/schriftprobe', { methode: 'PUT', body: { version: 1, zeichen: neu } }))
      .then(
        () => {
          setStatus({ text: meldung });
          void qc.invalidateQueries({ queryKey: ['schriftprobe-stand'] });
        },
        (err: unknown) => setStatus({ text: `Nicht gespeichert: ${err instanceof ApiFehler ? err.message : String(err)}`, fehler: true }),
      );
  };

  const naechstes = (z: Zeichen, ab: string) => {
    const i = ALLE.findIndex((a) => a.z === ab);
    for (let k = 1; k <= ALLE.length; k++) {
      const a = ALLE[(i + k) % ALLE.length]!;
      if ((z[a.z]?.length ?? 0) < a.ziel) return a.z;
    }
    return ab;
  };

  const uebernehmen = () => {
    if (!zeichen || striche.length === 0) return;
    const alt = zeichen[aktuell] ?? [];
    const varianten = [...alt, striche].slice(-MAX_VARIANTEN);
    const neu = { ...zeichen, [aktuell]: varianten };
    setStriche([]);
    // gleiches Zeichen weiter, bis das Ziel erreicht ist – dann zum nächsten offenen
    const ziel = ZIEL.get(aktuell) ?? 1;
    const weiter = varianten.length >= ziel ? naechstes(neu, aktuell) : aktuell;
    speichern(neu, `„${aktuell}“ gespeichert (${varianten.length}×).`);
    setAktuell(weiter);
  };

  const varianteLoeschen = (z: string, i: number) => {
    if (!zeichen) return;
    const rest = (zeichen[z] ?? []).filter((_, k) => k !== i);
    const neu = { ...zeichen };
    if (rest.length) neu[z] = rest;
    else delete neu[z];
    speichern(neu, `Eine Variante von „${z}“ gelöscht.`);
  };

  const waehlen = (z: string) => {
    setStriche([]);
    setAktuell(z);
    // aus der Zeichenliste (weiter unten) zurück zum Schreibfeld – am Handy sonst außer Sicht
    const c = leinwand.current;
    if (c) {
      const r = c.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) c.scrollIntoView({ block: 'center' });
    }
  };

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        uebernehmen();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        setStriche((s) => s.slice(0, -1));
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  });

  if (geladen.isError) return <p className="karte">Die Schriftprobe lässt sich gerade nicht laden: {(geladen.error as Error).message}</p>;
  if (!zeichen) return <p className="karte leise">Lade …</p>;

  const ziel = ZIEL.get(aktuell) ?? 1;
  return (
    <div className="schriftprobe">
      <section className="karte">
        <h1>✍️ Schriftprobe</h1>
        <p>
          Schreib jedes Zeichen so, wie du es sonst auch schreibst – nicht schöner. Am besten mit Stift auf dem Tablet. Grundlinie ist die
          durchgezogene Linie, Großbuchstaben reichen bis zur oberen gestrichelten, Kleinbuchstaben bis zur unteren. Mehrere Varianten je
          Zeichen machen die Schrift lebendig; das Dorf wechselt sie ab.
        </p>
        <p className="leise">
          Danach schreibt <code>handschrift_schreiben</code> von selbst in deiner Hand. Zeichen, die fehlen, ergänzt die erfundene Hand.
          Gespeichert in <code>Atelier/schriftprobe.json</code>. <a href="/gebaeude/Atelier" onClick={linkKlick}>Zurück zum Atelier</a>
        </p>
        <div className="sp-fortschritt" data-testid="sp-fortschritt">
          <progress max={fortschritt.ziel} value={fortschritt.fertig} />
          <span>
            {fortschritt.fertig} von {fortschritt.ziel}
          </span>
        </div>
      </section>

      <section className="karte sp-schreiben">
        <div className="sp-kopf">
          <span className="sp-zeichen" data-testid="sp-aktuell">
            {aktuell}
          </span>
          <span className="leise">
            {anzahl(aktuell)} von {ziel} {anzahl(aktuell) >= ziel ? '✓ – gern noch mehr (bis 8)' : ''}
          </span>
        </div>
        <canvas
          ref={leinwand}
          className="sp-leinwand"
          data-testid="sp-leinwand"
          onPointerDown={runter}
          onPointerMove={bewegen}
          onPointerUp={hoch}
          onPointerCancel={hoch}
          aria-label={`Hier „${aktuell}“ schreiben`}
        />
        <div className="knopfreihe">
          <button type="button" onClick={() => setStriche((s) => s.slice(0, -1))} disabled={!striche.length}>
            ↶ Strich zurück
          </button>
          <button type="button" onClick={() => setStriche([])} disabled={!striche.length}>
            Neu
          </button>
          <button type="button" className="haupt" onClick={uebernehmen} disabled={!striche.length} data-testid="sp-uebernehmen">
            Übernehmen ⏎
          </button>
          <button type="button" onClick={() => waehlen(naechstes(zeichen, aktuell))}>
            Überspringen →
          </button>
        </div>
        {status && (
          <p className={status.fehler ? 'fehler' : 'leise'} role="status" data-testid="sp-status">
            {status.text}
          </p>
        )}
        {(zeichen[aktuell]?.length ?? 0) > 0 && (
          <div className="sp-varianten" data-testid="sp-varianten">
            {zeichen[aktuell]!.map((v, i) => (
              <span key={i} className="sp-variante">
                <Mini variante={v} />
                <button type="button" aria-label={`Variante ${i + 1} löschen`} onClick={() => varianteLoeschen(aktuell, i)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="karte">
        <h2>Alle Zeichen</h2>
        {GRUPPEN.map((g) => (
          <div key={g.titel} className="sp-gruppe">
            <h3>
              {g.titel} <span className="leise">({g.ziel}× je Zeichen)</span>
            </h3>
            <div className="sp-raster">
              {Array.from(g.zeichen).map((z) => {
                const n = anzahl(z);
                return (
                  <button
                    key={z}
                    type="button"
                    className={`sp-feld${z === aktuell ? ' aktiv' : ''}${n >= g.ziel ? ' fertig' : n > 0 ? ' teil' : ''}`}
                    onClick={() => waehlen(z)}
                    title={`${z}: ${n} von ${g.ziel}`}
                    data-testid={`sp-feld-${z}`}
                  >
                    {z}
                    {n > 0 && <small>{n}</small>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="karte">
        <h2>Probelesen</h2>
        <p className="leise">So ungefähr sehen deine Zeichen nebeneinander aus (ohne Feinschliff – den macht der Rechenraum).</p>
        <input value={vorschauText} onChange={(e) => setVorschauText(e.target.value)} aria-label="Text zum Probelesen" />
        <Vorschau text={vorschauText} zeichen={zeichen} />
      </section>
    </div>
  );
}

function grenzen(v: Variante) {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const s of v) for (const p of s) (x0 = Math.min(x0, p[0]!)), (x1 = Math.max(x1, p[0]!));
  return { x0, x1 };
}

function striche(ctx: CanvasRenderingContext2D, v: Variante, dx: number, grund: number, em: number) {
  const { x0 } = grenzen(v);
  for (const s of v) {
    ctx.beginPath();
    s.forEach((p, i) => {
      const x = dx + (p[0]! - x0) * em;
      const y = grund + p[1]! * em;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (s.length === 1) ctx.lineTo(dx + (s[0]![0]! - x0) * em + 0.5, grund + s[0]![1]! * em);
    ctx.stroke();
  }
}

function Mini({ variante }: { variante: Variante }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 56 * dpr;
    c.height = 56 * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#1d4fa3';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { x0, x1 } = grenzen(variante);
    const em = 56 * EM;
    striche(ctx, variante, Math.max(2, (56 - (x1 - x0) * em) / 2), 56 * GRUND, em);
  }, [variante]);
  return <canvas ref={ref} style={{ width: 56, height: 56 }} />;
}

function Vorschau({ text, zeichen }: { text: string; zeichen: Zeichen }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const b = c.clientWidth || 600;
    const em = 22;
    const zeilenHoehe = em * 2.1;
    const dpr = window.devicePixelRatio || 1;
    // erst setzen (Umbruch an Wortgrenzen), dann zeichnen
    const woerter = text.split(/(\s+)/);
    const zeilen: { v: Variante | null; z: string; w: number }[][] = [[]];
    let x = 0;
    const benutzt: Record<string, number> = {};
    for (const wort of woerter) {
      if (!wort) continue;
      const teile = Array.from(wort).map((z) => {
        if (/\s/.test(z)) return { v: null, z, w: em * 0.5 };
        const vs = zeichen[z];
        if (!vs?.length) return { v: null, z, w: em * 0.6 };
        const i = (benutzt[z] = ((benutzt[z] ?? -1) + 1) % vs.length);
        const { x0, x1 } = grenzen(vs[i]!);
        return { v: vs[i]!, z, w: (x1 - x0) * em + 0.18 * em };
      });
      const w = teile.reduce((n, t) => n + t.w, 0);
      if (x + w > b - 8 && x > 0 && !/^\s+$/.test(wort)) {
        zeilen.push([]);
        x = 0;
      }
      if (x === 0 && /^\s+$/.test(wort)) continue;
      zeilen[zeilen.length - 1]!.push(...teile);
      x += w;
    }
    const h = Math.max(1, zeilen.length) * zeilenHoehe + em * 0.6;
    c.style.height = `${h}px`;
    c.width = Math.round(b * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    zeilen.forEach((zeile, n) => {
      const grund = (n + 1) * zeilenHoehe - em * 0.4;
      let dx = 4;
      for (const t of zeile) {
        if (t.v) {
          ctx.strokeStyle = '#1d4fa3';
          ctx.lineWidth = 1.7;
          striche(ctx, t.v, dx + 0.09 * em, grund, em);
        } else if (!/\s/.test(t.z)) {
          ctx.fillStyle = 'rgb(210 53 42 / 0.55)';
          ctx.font = `${em}px system-ui, sans-serif`;
          ctx.fillText(t.z, dx, grund);
        }
        dx += t.w;
      }
    });
  }, [text, zeichen]);
  return (
    <>
      <canvas ref={ref} className="sp-vorschau" data-testid="sp-vorschau" />
      <p className="leise">Rot = noch nicht geschrieben (dort nimmt das Dorf die erfundene Hand).</p>
    </>
  );
}
