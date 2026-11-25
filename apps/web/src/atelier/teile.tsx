import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MISCHMODI, ctxVon, type Dokument, type Ebene, type Mischmodus } from './kern';
import * as filter from './filter';
import { Zeichen } from '../apple/werkzeug-symbole';

/** E198 Atelier: kleine Bausteine der Oberfläche – Menü, Fenster, Ebenen-/Verlaufs-Fenster, Regler der Anpassungen */

export type MenuePunkt = { t: string; k?: string; tun: () => void; aus?: string | false | null; test?: string } | 'trenner';

export function Menue({ titel, punkte, offen, setOffen, beiGesperrt }: { titel: string; punkte: MenuePunkt[]; offen: string | null; setOffen: (t: string | null) => void; beiGesperrt: (grund: string) => void }) {
  const auf = offen === titel;
  const knopf = useRef<HTMLButtonElement>(null);
  // die Liste hängt am Fenster (nicht in der scrollenden Menüzeile) – Ort vom Knopf nehmen, am rechten Rand einrücken
  const r = auf ? knopf.current?.getBoundingClientRect() : undefined;
  return (
    <div className="at-menue-gruppe">
      <button ref={knopf} type="button" className={auf ? 'aktiv' : ''} aria-haspopup="menu" aria-expanded={auf} onClick={() => setOffen(auf ? null : titel)} onPointerEnter={(e) => e.pointerType === 'mouse' && offen && !auf && setOffen(titel)}>
        {titel}
      </button>
      {auf && (
        <div className="at-menue-liste" role="menu" aria-label={titel} style={r ? { left: Math.max(4, Math.min(r.left, window.innerWidth - 248)), top: r.bottom } : undefined}>
          {punkte.map((p, i) =>
            p === 'trenner' ? (
              <hr key={i} />
            ) : (
              <button
                key={p.t}
                type="button"
                role="menuitem"
                data-testid={p.test}
                aria-disabled={p.aus ? true : undefined}
                title={p.aus || undefined}
                className={p.aus ? 'aus' : ''}
                onClick={() => {
                  setOffen(null);
                  if (p.aus) beiGesperrt(p.aus);
                  else p.tun();
                }}
              >
                <span>{p.t}</span>
                {p.k && <kbd>{p.k}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Fenster über dem Editor (aria-modal: die Tastenkürzel der App und des Editors ruhen) */
export function Fenster({ titel, zu, children, schmal, seitlich }: { titel: string; zu: () => void; children: ReactNode; schmal?: boolean; seitlich?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        zu();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [zu]);
  return (
    <div className={`at-fenster-grund${seitlich ? ' seitlich' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && !seitlich && zu()}>
      <div className={`at-fenster${schmal ? ' schmal' : ''}`} role="dialog" aria-modal="true" aria-label={titel}>
        <header>
          <strong>{titel}</strong>
          <button type="button" onClick={zu} aria-label="Schließen">
            <Zeichen e="✕" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Miniatur({ ebene, stand }: { ebene: Ebene; stand: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = ctxVon(c);
    k.clearRect(0, 0, c.width, c.height);
    const f = Math.min(c.width / ebene.leinwand.width, c.height / ebene.leinwand.height);
    const b = ebene.leinwand.width * f;
    const h = ebene.leinwand.height * f;
    k.drawImage(ebene.leinwand, (c.width - b) / 2, (c.height - h) / 2, b, h);
  }, [ebene, stand, ebene.leinwand]);
  return <canvas ref={ref} width={40} height={30} className="at-miniatur" />;
}

export function EbenenFenster({ doc, hinweis }: { doc: Dokument; hinweis: (t: string) => void }) {
  const a = doc.aktiv;
  const versuch = (f: () => void) => {
    try {
      f();
    } catch (e) {
      hinweis((e as Error).message);
    }
  };
  // Deckkraft-Regler: beim Ziehen nur anzeigen, beim Loslassen ein Verlaufsschritt
  return (
    <section className="at-feld" data-testid="ebenen">
      <h3>Ebenen</h3>
      <div className="at-zeile">
        <select aria-label="Mischmodus" value={a.modus} onChange={(e) => doc.ebeneSetzen(a.id, { modus: e.target.value as Mischmodus }, 'Mischmodus')}>
          {MISCHMODI.map(([m, t]) => (
            <option key={m} value={m}>
              {t}
            </option>
          ))}
        </select>
        <label className="at-regler-klein" title="Deckkraft der Ebene">
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Deckkraft der Ebene"
            value={Math.round(a.deckkraft * 100)}
            onChange={(e) => doc.ebeneSetzen(a.id, { deckkraft: Number(e.target.value) / 100 }, null)}
            onPointerUp={() => doc.festhalten('Deckkraft')}
            onKeyUp={() => doc.festhalten('Deckkraft')}
          />
          <span>{Math.round(a.deckkraft * 100)} %</span>
        </label>
      </div>
      <ul className="at-ebenen">
        {[...doc.ebenen].reverse().map((e) => (
          <li key={e.id} className={e.id === doc.aktivId ? 'aktiv' : ''} data-ebene={e.name}>
            <button type="button" className="at-auge" aria-label={e.sichtbar ? `${e.name} ausblenden` : `${e.name} einblenden`} aria-pressed={e.sichtbar} onClick={() => doc.ebeneSetzen(e.id, { sichtbar: !e.sichtbar }, e.sichtbar ? 'Ebene ausblenden' : 'Ebene einblenden')}>
              <Zeichen e={e.sichtbar ? '👁' : '·'} />
            </button>
            <button
              type="button"
              className="at-ebene-name"
              onClick={() => {
                doc.aktivId = e.id;
                doc.melden();
              }}
              onDoubleClick={() => {
                const n = window.prompt('Name der Ebene', e.name)?.trim();
                if (n) doc.ebeneSetzen(e.id, { name: n.slice(0, 100) }, 'Ebene umbenennen');
              }}
              title="Klick: auswählen · Doppelklick: umbenennen"
            >
              <Miniatur ebene={e} stand={e.stand} />
              <span>{e.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="at-zeile at-knoepfe">
        <button type="button" title="Neue Ebene (Strg+Umschalt+N)" aria-label="Neue Ebene" onClick={() => doc.neueEbene()}>
          <Zeichen e="＋" />
        </button>
        <button type="button" title="Ebene duplizieren (Strg+J)" aria-label="Ebene duplizieren" onClick={() => doc.ebeneDuplizieren()}>
          <Zeichen e="⧉" />
        </button>
        <button type="button" title="Nach oben" aria-label="Ebene nach oben" onClick={() => doc.ebeneVerschieben(a.id, 1)}>
          <Zeichen e="↑" />
        </button>
        <button type="button" title="Nach unten" aria-label="Ebene nach unten" onClick={() => doc.ebeneVerschieben(a.id, -1)}>
          <Zeichen e="↓" />
        </button>
        <button type="button" title="Mit darunterliegender vereinen (Strg+E)" aria-label="Nach unten vereinen" onClick={() => versuch(() => doc.nachUntenVereinen())}>
          <Zeichen e="⤓" />
        </button>
        <button type="button" title="Ebene löschen" aria-label="Ebene löschen" onClick={() => versuch(() => doc.ebeneLoeschen())}>
          <Zeichen e="🗑" />
        </button>
      </div>
    </section>
  );
}

export function VerlaufFenster({ doc }: { doc: Dokument }) {
  const ende = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // in geschweiften Klammern: neuere Browser geben von scrollIntoView ein Promise zurück – das wäre kein gültiger Aufräumer
    void ende.current?.scrollIntoView({ block: 'nearest' });
  }, [doc.verlaufPos, doc.verlauf.length]);
  return (
    <section className="at-feld" data-testid="verlauf">
      <h3>Verlauf</h3>
      <ol className="at-verlauf">
        {doc.verlauf.map((s, i) => (
          <li key={i} ref={i === doc.verlaufPos ? ende : undefined} className={i === doc.verlaufPos ? 'aktiv' : i > doc.verlaufPos ? 'spaeter' : ''}>
            <button type="button" onClick={() => doc.springen(i)}>
              {s.name}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- Anpassungen und Filter mit Reglern ------------------------------------------------------------
export interface Regler {
  id: string;
  t: string;
  min: number;
  max: number;
  schritt?: number;
  start: number;
  /** Ankreuzfeld statt Regler (0/1) */
  schalter?: boolean;
}
export interface Anpassung {
  titel: string;
  regler: Regler[];
  tun: (d: ImageData, w: Record<string, number>) => void;
}
export const ANPASSUNGEN: Record<string, Anpassung> = {
  helligkeit: {
    titel: 'Helligkeit/Kontrast',
    regler: [
      { id: 'h', t: 'Helligkeit', min: -100, max: 100, start: 0 },
      { id: 'k', t: 'Kontrast', min: -100, max: 100, start: 0 },
    ],
    tun: (d, w) => filter.helligkeitKontrast(d.data, w.h!, w.k!),
  },
  farbton: {
    titel: 'Farbton/Sättigung',
    regler: [
      { id: 'f', t: 'Farbton', min: -180, max: 180, start: 0 },
      { id: 's', t: 'Sättigung', min: -100, max: 100, start: 0 },
      { id: 'l', t: 'Helligkeit', min: -100, max: 100, start: 0 },
    ],
    tun: (d, w) => filter.farbtonSaettigung(d.data, w.f!, w.s!, w.l!),
  },
  belichtung: {
    titel: 'Belichtung',
    regler: [
      { id: 'e', t: 'Belichtung (Blendenstufen)', min: -3, max: 3, schritt: 0.05, start: 0 },
      { id: 'g', t: 'Gamma', min: 0.2, max: 3, schritt: 0.05, start: 1 },
    ],
    tun: (d, w) => filter.belichtung(d.data, w.e!, w.g!),
  },
  kurven: {
    titel: 'Gradationskurve (Tiefen/Mitten/Lichter)',
    regler: [
      { id: 't', t: 'Tiefen', min: -100, max: 100, start: 0 },
      { id: 'm', t: 'Mitten', min: -100, max: 100, start: 0 },
      { id: 'l', t: 'Lichter', min: -100, max: 100, start: 0 },
    ],
    tun: (d, w) => filter.kurven(d.data, w.t!, w.m!, w.l!),
  },
  weichzeichnen: {
    titel: 'Gaußscher Weichzeichner',
    regler: [{ id: 'r', t: 'Radius (Pixel)', min: 0.5, max: 60, schritt: 0.5, start: 4 }],
    tun: (d, w) => filter.weichzeichnen(d.data, d.width, d.height, w.r!),
  },
  schaerfen: {
    titel: 'Schärfen (Unscharf maskieren)',
    regler: [
      { id: 's', t: 'Stärke (%)', min: 0, max: 300, start: 100 },
      { id: 'r', t: 'Radius (Pixel)', min: 0.5, max: 10, schritt: 0.5, start: 1.5 },
    ],
    tun: (d, w) => filter.schaerfen(d.data, d.width, d.height, w.s!, w.r!),
  },
  rauschen: {
    titel: 'Rauschen hinzufügen',
    regler: [
      { id: 'm', t: 'Menge', min: 1, max: 100, start: 15 },
      { id: 'e', t: 'Einfarbig', min: 0, max: 1, start: 1, schalter: true },
    ],
    tun: (d, w) => filter.rauschen(d.data, w.m!, w.e === 1, 20261120),
  },
  sepia: { titel: 'Sepia', regler: [{ id: 's', t: 'Stärke', min: 0, max: 100, start: 100 }], tun: (d, w) => filter.sepia(d.data, w.s!) },
  schwellenwert: { titel: 'Schwellenwert', regler: [{ id: 's', t: 'Schwelle', min: 1, max: 255, start: 128 }], tun: (d, w) => filter.schwellenwert(d.data, w.s!) },
};

/**
 * Regler einer Anpassung mit Vorschau direkt im Bild. Rechnet immer von der unveränderten Ebene aus (Verlaufsbild) –
 * OK hält das Ergebnis als einen Schritt fest, Abbrechen stellt die Ebene wieder her.
 */
export function AnpassungFenster({ art, doc, neuMalen, zu }: { art: string; doc: Dokument; neuMalen: () => void; zu: () => void }) {
  const a = ANPASSUNGEN[art]!;
  const ebene = useRef(doc.aktiv).current;
  const quelle = useRef(doc.gespeichert(ebene)).current;
  const gross = doc.breite * doc.hoehe > 3_000_000;
  const [werte, setWerte] = useState<Record<string, number>>(() => Object.fromEntries(a.regler.map((r) => [r.id, r.start])));
  const fertig = useRef(false);
  const rechnen = (w: Record<string, number>) => {
    doc.anpassen(ebene, quelle, (d) => a.tun(d, w));
    neuMalen();
  };
  useEffect(() => {
    rechnen(werte);
    // beim Schließen ohne OK: Ebene wiederherstellen
    return () => {
      if (!fertig.current) {
        doc.zuruecksetzen(ebene);
        neuMalen();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setzen = (id: string, v: number, sofort: boolean) => {
    const w = { ...werte, [id]: v };
    setWerte(w);
    if (sofort) rechnen(w);
  };
  return (
    <Fenster titel={a.titel} zu={zu} schmal seitlich>
      <form
        className="at-formular"
        onSubmit={(e) => {
          e.preventDefault();
          rechnen(werte);
          fertig.current = true;
          doc.festhalten(a.titel);
          zu();
        }}
      >
        {a.regler.map((r) =>
          r.schalter ? (
            <label key={r.id} className="at-haken">
              <input type="checkbox" checked={werte[r.id] === 1} onChange={(e) => setzen(r.id, e.target.checked ? 1 : 0, true)} /> {r.t}
            </label>
          ) : (
            <label key={r.id}>
              <span>
                {r.t} <output>{werte[r.id]}</output>
              </span>
              <input
                type="range"
                aria-label={r.t}
                min={r.min}
                max={r.max}
                step={r.schritt ?? 1}
                value={werte[r.id]}
                onChange={(e) => setzen(r.id, Number(e.target.value), !gross)}
                onPointerUp={() => gross && rechnen(werte)}
                onKeyUp={() => gross && rechnen(werte)}
              />
            </label>
          ),
        )}
        {gross && <p className="at-leise">Großes Bild: Die Vorschau rechnet beim Loslassen des Reglers.</p>}
        {doc.auswahl && <p className="at-leise">Wirkt nur in der Auswahl.</p>}
        <div className="at-zeile at-ende">
          <button type="button" onClick={zu}>
            Abbrechen
          </button>
          <button type="submit" className="haupt">
            Anwenden
          </button>
        </div>
      </form>
    </Fenster>
  );
}
