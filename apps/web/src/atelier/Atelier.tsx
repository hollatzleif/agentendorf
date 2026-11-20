import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ATELIER_MAX_BYTES, type AtelierStand, type SchreibErgebnis } from '@dorf/shared';
import { api } from '../api';
import { linkKlick, navigieren, useOrt } from '../router';
import { alleDateien, endung, ordnerVon, useBaum } from '../vaultHilfen';
import { Buehne, STANDARD_OPTIONEN, type Optionen, type Werkzeug } from './buehne';
import * as filter from './filter';
import { Dokument, MAX_KANTE, alsBlob, bildLaden, ctxVon, groessePruefen, leinwand } from './kern';
import { ANPASSUNGEN, AnpassungFenster, EbenenFenster, Fenster, Menue, VerlaufFenster, type MenuePunkt } from './teile';
import './atelier.css';

/**
 * E198 – Atelier: Bildbearbeitung in der App (Ebenen, Pinsel, Auswahl, Transformieren, Anpassungen, Filter, Text, Formen).
 * Diese Datei ist die Oberfläche; gerechnet wird in kern.ts (Dokument), buehne.ts (Zeiger/Werkzeuge) und filter.ts.
 * Gespeichert wird nur über /api/atelier/speichern (VaultDienst: basisVersion → Konfliktkopie).
 */

const WERKZEUGE: [Werkzeug, string, string, string][] = [
  ['verschieben', '✥', 'Verschieben', 'V'],
  ['auswahl-rechteck', '⬚', 'Auswahlrechteck', 'M'],
  ['auswahl-ellipse', '◯', 'Auswahlellipse', 'M'],
  ['lasso', '➰', 'Lasso', 'L'],
  ['zauberstab', '🪄', 'Zauberstab', 'W'],
  ['zuschneiden', '⛶', 'Zuschneiden', 'C'],
  ['pipette', '💧', 'Pipette', 'I'],
  ['pinsel', '🖌', 'Pinsel', 'B'],
  ['radierer', '🧽', 'Radierer', 'E'],
  ['fuellen', '🪣', 'Füllen', 'G'],
  ['verlauf', '▤', 'Verlauf', 'G'],
  ['text', 'T', 'Text', 'T'],
  ['form', '▭', 'Form', 'U'],
  ['hand', '✋', 'Hand', 'H'],
  ['zoom', '🔍', 'Zoom', 'Z'],
];
const TASTE_WERKZEUG: Record<string, Werkzeug[]> = {
  v: ['verschieben'],
  m: ['auswahl-rechteck', 'auswahl-ellipse'],
  l: ['lasso'],
  w: ['zauberstab'],
  c: ['zuschneiden'],
  i: ['pipette'],
  b: ['pinsel'],
  e: ['radierer'],
  g: ['fuellen', 'verlauf'],
  t: ['text'],
  u: ['form'],
  h: ['hand'],
  z: ['zoom'],
};
const SCHRIFTEN: [string, string][] = [
  ['system-ui, sans-serif', 'Serifenlos'],
  ['Georgia, "Times New Roman", serif', 'Serif'],
  ['ui-monospace, "Courier New", monospace', 'Schreibmaschine'],
  ['"Comic Sans MS", "Comic Neue", cursive', 'Handschrift'],
  ['Impact, "Arial Black", sans-serif', 'Plakat'],
];
const PALETTE = ['#000000', '#ffffff', '#d2352a', '#e8761a', '#f2b51e', '#2f8a2b', '#3aa0ff', '#2b3a55', '#8e44ad', '#ff7eb6'];
const SPEICHER_ENDUNGEN = ['atelier', 'png', 'jpg', 'jpeg', 'webp'];
const OEFFNEN_ENDUNGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'svg', 'atelier']);
type Format = 'atelier' | 'png' | 'jpg' | 'webp';

/** Die geöffnete Datei bleibt offen, wenn man im Dorf woanders hingeht und zurückkommt (nichts geht still verloren) */
interface Sitzung {
  doc: Dokument;
  /** Pfad im Vault, falls von dort geöffnet oder dorthin gespeichert; version = sha256 für basisVersion */
  pfad: string | null;
  version: string | null;
  name: string;
  opt: Optionen;
  werkzeug: Werkzeug;
}
let sitzung: Sitzung | null = null;
let zwischenablage: HTMLCanvasElement | null = null;

async function holeBlob(url: string, init?: RequestInit): Promise<{ blob: Blob; kopf: Headers }> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  if (!r.ok) {
    let text = `Fehler ${r.status}`;
    try {
      text = ((await r.json()) as { fehler?: string }).fehler ?? text;
    } catch {
      /* keine JSON-Antwort */
    }
    if (r.status === 401) window.dispatchEvent(new Event('dorf:abgemeldet'));
    throw new Error(text);
  }
  return { blob: await r.blob(), kopf: r.headers };
}
function formularMit(blob: Blob, name: string, felder: Record<string, string> = {}) {
  const f = new FormData();
  // Textfelder zuerst – der Server liest sie, bevor die Datei kommt
  for (const [k, v] of Object.entries(felder)) f.append(k, v);
  f.append('datei', blob, name);
  return f;
}
const namensTeil = (pfad: string) => pfad.slice(pfad.lastIndexOf('/') + 1);
const ohneEndung = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);

export function AtelierSeite() {
  const { suche } = useOrt();
  const wunschPfad = suche.get('pfad');
  const leinwandRef = useRef<HTMLCanvasElement>(null);
  const buehneRef = useRef<Buehne | null>(null);
  const [, neu] = useReducer((x: number) => x + 1, 0);
  const [bereit, setBereit] = useState(false);
  const [menue, setMenue] = useState<string | null>(null);
  const [fenster, setFenster] = useState<null | { art: string; daten?: unknown }>(null);
  const [hinweis, setHinweis] = useState<{ text: string; fehler?: boolean } | null>(null);
  const [arbeit, setArbeit] = useState<string | null>(null);
  const [seiteOffen, setSeiteOffen] = useState(false);
  const [text, setText] = useState('');
  const hinweisZeit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stand = useQuery({ queryKey: ['atelier', 'stand'], queryFn: () => api<AtelierStand>('/api/atelier/stand'), staleTime: 60_000 });

  const melden = useCallback((t: string, fehler = false) => {
    setHinweis({ text: t, fehler });
    clearTimeout(hinweisZeit.current);
    hinweisZeit.current = setTimeout(() => setHinweis(null), fehler ? 9000 : 4500);
  }, []);
  const b = buehneRef.current;
  const doc = sitzung?.doc;

  /** macht ein Dokument zum aktuellen */
  const zeigen = useCallback((d: Dokument, a: { pfad: string | null; version: string | null; name: string }) => {
    sitzung = { doc: d, ...a, opt: sitzung?.opt ?? { ...STANDARD_OPTIONEN }, werkzeug: sitzung?.werkzeug ?? 'pinsel' };
    buehneRef.current?.dokumentSetzen(d);
    // die Adresse nennt nur die Datei, die wirklich offen ist (sonst öffnete ein Zurückkommen wieder die alte)
    const inAdresse = new URLSearchParams(location.search).get('pfad');
    if (inAdresse && inAdresse !== a.pfad) navigieren('/atelier', true);
    neu();
  }, []);

  const verwerfenOk = () => !sitzung?.doc.geaendert || window.confirm('Das aktuelle Bild hat ungespeicherte Änderungen. Trotzdem ein anderes öffnen?');

  const ausBlob = useCallback(async (blob: Blob, name: string): Promise<Dokument> => {
    if (/\.atelier$/i.test(name)) return Dokument.ausProjekt(new Uint8Array(await blob.arrayBuffer()));
    const bild = await bildLaden(blob);
    try {
      groessePruefen(bild.width, bild.height);
      return Dokument.ausBild(bild, 'Hintergrund');
    } finally {
      bild.close();
    }
  }, []);

  /** Datei von diesem Gerät: was der Browser nicht lesen kann (HEIC, TIFF), wandelt der Rechenraum um */
  const lokalLesen = useCallback(async (datei: File): Promise<Blob> => {
    if (/\.atelier$/i.test(datei.name)) return datei;
    try {
      (await bildLaden(datei)).close();
      return datei;
    } catch {
      setArbeit('Wandle um … (Rechenraum)');
      return (await holeBlob('/api/atelier/umwandeln', { method: 'POST', body: formularMit(datei, datei.name) })).blob;
    }
  }, []);

  const ausVaultOeffnen = useCallback(
    async (pfad: string) => {
      setArbeit('Öffne …');
      try {
        const { blob, kopf } = await holeBlob(`/api/atelier/oeffnen?pfad=${encodeURIComponent(pfad)}`);
        const d = await ausBlob(blob, pfad);
        // umgewandelte Formate (HEIC …) lassen sich nicht zurückschreiben → beim Speichern entsteht eine neue Datei
        const umgewandelt = kopf.get('x-dorf-umgewandelt') === '1' || !SPEICHER_ENDUNGEN.includes(endung(pfad));
        zeigen(d, { pfad: umgewandelt ? null : pfad, version: umgewandelt ? null : kopf.get('x-dorf-version'), name: namensTeil(pfad) });
        if (umgewandelt) melden(`${namensTeil(pfad)} wurde zum Bearbeiten umgewandelt – beim Speichern entsteht eine neue Datei, das Original bleibt.`);
      } catch (e) {
        melden((e as Error).message, true);
      } finally {
        setArbeit(null);
      }
    },
    [ausBlob, melden, zeigen],
  );

  // ---- Bühne anlegen, erstes Dokument ----------------------------------------------------------------
  useEffect(() => {
    const c = leinwandRef.current;
    if (!c) return;
    const bu = new Buehne(c);
    buehneRef.current = bu;
    bu.beiZustand = neu;
    bu.beiHinweis = (t) => melden(t, true);
    if (!sitzung) sitzung = { doc: Dokument.leer(1280, 800, '#ffffff'), pfad: null, version: null, name: 'Unbenannt', opt: { ...STANDARD_OPTIONEN }, werkzeug: 'pinsel' };
    bu.opt = sitzung.opt;
    bu.werkzeug = sitzung.werkzeug;
    bu.dokumentSetzen(sitzung.doc);
    (window as unknown as { __atelier?: unknown }).__atelier = {
      buehne: bu,
      get doc() {
        return sitzung!.doc;
      },
      get sitzung() {
        return sitzung;
      },
      filter,
    };
    setBereit(true);
    return () => {
      bu.zerstoeren();
      buehneRef.current = null;
      delete (window as unknown as { __atelier?: unknown }).__atelier;
    };
  }, [melden]);

  // Dokument meldet Änderungen → neu zeichnen (Ebenenliste, Verlauf, Titel)
  useEffect(() => doc?.abonnieren(neu), [doc]);

  // ?pfad=… öffnet eine Datei aus dem Vault (z. B. aus der Bibliothek)
  useEffect(() => {
    if (!bereit || !wunschPfad) return;
    if (sitzung?.pfad === wunschPfad) return;
    if (verwerfenOk()) void ausVaultOeffnen(wunschPfad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bereit, wunschPfad]);

  useEffect(() => {
    const warnen = (e: BeforeUnloadEvent) => {
      if (sitzung?.doc.geaendert) e.preventDefault();
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, []);

  // ---- Aktionen ---------------------------------------------------------------------------------------
  const versuch = useCallback(
    (f: () => void) => {
      try {
        f();
      } catch (e) {
        melden((e as Error).message, true);
      }
    },
    [melden],
  );
  const werkzeug = (w: Werkzeug) => {
    if (!b || !sitzung) return;
    b.werkzeugSetzen(w);
    sitzung.werkzeug = w;
    neu();
  };
  const optSetzen = (a: Partial<Optionen>) => {
    if (!b) return;
    Object.assign(b.opt, a);
    b.neuZeichnen();
    neu();
  };

  /** Bild als neue Ebene einfügen – zu Großes wird eingepasst, alles landet in der Mitte */
  const alsEbene = useCallback(
    (bild: CanvasImageSource & { width: number; height: number }, name: string, ort?: { x: number; y: number; b: number; h: number }, schritt: string | null = 'Einfügen') => {
      const d = sitzung!.doc;
      const e = d.ebeneAnlegen(name.slice(0, 60));
      const c = ctxVon(e.leinwand);
      c.imageSmoothingQuality = 'high';
      if (ort) c.drawImage(bild, ort.x, ort.y, ort.b, ort.h);
      else {
        const f = Math.min(1, d.breite / bild.width, d.hoehe / bild.height);
        c.drawImage(bild, (d.breite - bild.width * f) / 2, (d.hoehe - bild.height * f) / 2, bild.width * f, bild.height * f);
      }
      d.beruehrt(e);
      if (schritt) d.festhalten(schritt);
      return e;
    },
    [],
  );

  const dateiGewaehlt = async (datei: File | undefined, ziel: 'neu' | 'ebene') => {
    if (!datei) return;
    setFenster(null);
    setArbeit('Öffne …');
    try {
      const blob = await lokalLesen(datei);
      if (ziel === 'ebene' && !/\.atelier$/i.test(datei.name)) {
        const bild = await bildLaden(blob);
        alsEbene(bild, ohneEndung(datei.name));
        bild.close();
      } else if (verwerfenOk()) zeigen(await ausBlob(blob, datei.name), { pfad: null, version: null, name: datei.name });
    } catch (e) {
      melden((e as Error).message, true);
    } finally {
      setArbeit(null);
    }
  };

  const kodieren = async (format: Format, qualitaet: number) => (format === 'atelier' ? sitzung!.doc.alsProjekt() : sitzung!.doc.exportieren(format, qualitaet));

  const imVaultSpeichern = async (pfad: string, format: Format, qualitaet: number) => {
    const s = sitzung!;
    setArbeit('Speichere …');
    try {
      const blob = await kodieren(format, qualitaet);
      if (blob.size > ATELIER_MAX_BYTES) throw new Error(`Zu groß zum Speichern (${Math.round(blob.size / 1024 / 1024)} MB, höchstens ${ATELIER_MAX_BYTES / 1024 / 1024} MB) – als JPG speichern oder das Bild verkleinern.`);
      // dieselbe Datei wie beim Öffnen: Version mitschicken – hat sie sich inzwischen geändert, legt das Dorf eine Konfliktkopie an
      const gleich = s.pfad === pfad && s.version;
      const r = await api<SchreibErgebnis>(`/api/atelier/speichern?pfad=${encodeURIComponent(pfad)}${gleich ? `&basisVersion=${s.version}` : ''}`, { formular: formularMit(blob, namensTeil(pfad)) });
      if (r.konflikt) {
        melden(`Die Datei wurde inzwischen woanders geändert. Deine Fassung liegt als Konfliktkopie daneben: ${r.konfliktPfad}`, true);
        s.pfad = r.konfliktPfad ?? null;
        s.version = null;
        s.name = namensTeil(r.konfliktPfad ?? pfad);
      } else {
        s.pfad = r.pfad;
        s.version = r.version;
        s.name = namensTeil(r.pfad);
        melden(format === 'atelier' ? `Gespeichert: ${r.pfad}` : `Gespeichert: ${r.pfad} (ein Bild ohne Ebenen – für späteres Weiterarbeiten als Projekt speichern)`);
      }
      // ein Bildformat hält keine Ebenen: mit mehreren Ebenen bleibt das Dokument „geändert“, bis es als Projekt gespeichert ist
      s.doc.geaendert = format !== 'atelier' && s.doc.ebenen.length > 1;
      setFenster(null);
      neu();
    } catch (e) {
      melden((e as Error).message, true);
    } finally {
      setArbeit(null);
    }
  };
  const speichern = () => {
    const s = sitzung!;
    const e = s.pfad ? endung(s.pfad) : '';
    if (s.pfad && SPEICHER_ENDUNGEN.includes(e)) void imVaultSpeichern(s.pfad, (e === 'jpeg' ? 'jpg' : e) as Format, 0.92);
    else setFenster({ art: 'speichern' });
  };
  const herunterladen = async (name: string, format: Format, qualitaet: number) => {
    try {
      const blob = await kodieren(format, qualitaet);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setFenster(null);
    } catch (e) {
      melden((e as Error).message, true);
    }
  };

  const kopieren = (ausschneiden: boolean) => {
    const d = sitzung!.doc;
    const a = d.ausschnitt();
    if (!a) return melden('Hier ist nichts zum Kopieren.', true);
    zwischenablage = a.bild;
    // zusätzlich in die Zwischenablage des Systems (wo der Browser es erlaubt)
    void alsBlob(a.bild)
      .then((blob) => navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]))
      .catch(() => undefined);
    if (ausschneiden) d.loeschen();
    else melden('Kopiert.');
  };
  const einfuegenIntern = () => {
    if (!zwischenablage) return melden('Die Zwischenablage ist leer.', true);
    alsEbene(zwischenablage, 'Eingefügt');
  };

  // ---- KI ----------------------------------------------------------------------------------------------
  const st = stand.data;
  const ohneRechenraum = !st ? 'Lade …' : !st.rechenraum ? 'Der Rechenraum ist auf diesem Server nicht erreichbar.' : null;
  const ausHintergrund = ohneRechenraum ?? (!st!.hintergrund ? 'Das Modell fehlt im Rechenraum – es kommt mit dem nächsten Deploy (neues Rechenraum-Image).' : null);
  const ausSkalieren = ohneRechenraum ?? (!st!.hochskalieren ? 'Das Modell fehlt im Rechenraum – es kommt mit dem nächsten Deploy (neues Rechenraum-Image).' : null);
  const ausGenerieren = !st ? 'Lade …' : !st.generieren ? 'Nicht eingerichtet. Auf dem Server: dorf bilder-einrichten (Cloudflare Workers AI, kostenloses Tageskontingent).' : null;

  const kiLauf = async (was: string, f: () => Promise<void>) => {
    setFenster(null);
    setArbeit(was);
    try {
      await f();
    } catch (e) {
      melden((e as Error).message, true);
    } finally {
      setArbeit(null);
    }
  };
  const hintergrundEntfernen = () =>
    kiLauf('Entferne den Hintergrund … (Rechenraum)', async () => {
      const d = sitzung!.doc;
      const e = d.aktiv;
      const { blob } = await holeBlob('/api/atelier/ki?art=hintergrund', { method: 'POST', body: formularMit(await alsBlob(e.leinwand), 'ebene.png') });
      const bild = await bildLaden(blob);
      const neuB = leinwand(d.breite, d.hoehe);
      ctxVon(neuB).drawImage(bild, 0, 0, d.breite, d.hoehe);
      bild.close();
      d.ersetzenMitAuswahl(e, neuB);
      d.festhalten('Hintergrund entfernen');
    });
  const hochskalieren = (faktor: 2 | 4) =>
    kiLauf('Skaliere hoch … (Rechenraum, bis zu einer Minute)', async () => {
      const d = sitzung!.doc;
      const { blob } = await holeBlob(`/api/atelier/ki?art=hochskalieren&faktor=${faktor}`, { method: 'POST', body: formularMit(await alsBlob(d.zusammengesetzt()), 'bild.png') });
      const bild = await bildLaden(blob);
      groessePruefen(bild.width, bild.height);
      // alle Ebenen werden zu einer – das Modell sieht nur das fertige Bild
      d.ebenen = [];
      d.aktivId = 0;
      d.auswahl = null;
      d.auswahlStand++;
      d.breite = bild.width;
      d.hoehe = bild.height;
      ctxVon(d.ebeneAnlegen('Hochskaliert').leinwand).drawImage(bild, 0, 0);
      bild.close();
      d.festhalten(`Hochskalieren ${faktor}×`);
      buehneRef.current?.einpassen();
    });
  const generieren = (prompt: string, breite: number, hoehe: number) =>
    kiLauf('Generiere ein Bild … (Cloudflare)', async () => {
      const { blob } = await holeBlob('/api/atelier/generieren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, breite, hoehe }) });
      const bild = await bildLaden(blob);
      alsEbene(bild, prompt);
      bild.close();
    });
  const generativFuellen = (prompt: string) =>
    kiLauf('Fülle die Auswahl … (Cloudflare)', async () => {
      const d = sitzung!.doc;
      const g = d.auswahlGrenzen();
      if (!g) throw new Error('Erst einen Bereich auswählen.');
      // Ausschnitt des fertigen Bildes, klein genug für das Modell (Vorlage höchstens 504 Pixel je Kante)
      const f = Math.min(1, 504 / Math.max(g.b, g.h));
      const vorlage = leinwand(Math.max(1, g.b * f), Math.max(1, g.h * f));
      const vc = ctxVon(vorlage);
      vc.fillStyle = '#ffffff';
      vc.fillRect(0, 0, vorlage.width, vorlage.height);
      vc.drawImage(d.zusammengesetzt(), g.x, g.y, g.b, g.h, 0, 0, vorlage.width, vorlage.height);
      const k = Math.min(1920 / Math.max(g.b, g.h), Math.max(1, 768 / Math.max(g.b, g.h)));
      const { blob } = await holeBlob('/api/atelier/fuellen', {
        method: 'POST',
        body: formularMit(await alsBlob(vorlage), 'vorlage.png', { prompt, breite: String(Math.round(g.b * k)), hoehe: String(Math.round(g.h * k)) }),
      });
      const bild = await bildLaden(blob);
      const e = alsEbene(bild, `Gefüllt: ${prompt}`, g, null);
      bild.close();
      // nur innerhalb der Auswahl stehen lassen
      const c = ctxVon(e.leinwand);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(d.auswahl!, 0, 0);
      c.globalCompositeOperation = 'source-over';
      d.beruehrt(e);
      d.festhalten('Generatives Füllen');
    });

  // ---- Tastatur ---------------------------------------------------------------------------------------
  const tastenRef = useRef<(e: KeyboardEvent) => void>(() => {});
  tastenRef.current = (e: KeyboardEvent) => {
    const bu = buehneRef.current;
    const d = sitzung?.doc;
    if (!bu || !d) return;
    const ziel = e.target as HTMLElement | null;
    const tippt = !!ziel && (ziel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ziel.tagName));
    if (document.querySelector('.atelier [aria-modal="true"]')) return;
    const strg = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (tippt) {
      // in Feldern nur Speichern und Rückgängig abfangen wäre überraschend – Felder behalten alle Tasten
      return;
    }
    const tun = (f: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      setMenue(null);
      versuch(f);
    };
    if (e.key === 'Escape') {
      if (menue) return tun(() => setMenue(null));
      if (bu.transform) return tun(() => bu.transformAbbrechen());
      if (bu.schnitt) return tun(() => bu.schnittAbbrechen());
      if (bu.beschaeftigt) return tun(() => bu.aktionAbbrechen());
      return;
    }
    if (e.key === 'Enter') {
      if (bu.transform) return tun(() => bu.transformAnwenden());
      if (bu.schnitt) return tun(() => bu.schnittAnwenden());
      return;
    }
    if (e.key === ' ') {
      bu.leertaste = true;
      e.preventDefault();
      return;
    }
    if (strg) {
      // Strg/⌘+K bleibt die Befehlspalette des Dorfs
      if (k === 'z') return tun(() => (e.shiftKey ? d.wiederholen() : d.rueckgaengig()));
      if (k === 'y') return tun(() => d.wiederholen());
      if (k === 's') return tun(() => (e.shiftKey ? setFenster({ art: 'speichern' }) : speichern()));
      if (k === 'o') return tun(() => setFenster({ art: 'oeffnen', daten: 'neu' }));
      if (k === 'a') return tun(() => d.allesAuswaehlen());
      if (k === 'd') return tun(() => d.auswahlSetzen(null, 'neu', 'Auswahl aufheben'));
      if (k === 'i') return tun(() => (e.shiftKey ? d.auswahlUmkehren() : sofort('invertieren')));
      if (k === 't') return tun(() => bu.transformStarten());
      if (k === 'j') return tun(() => d.ebeneDuplizieren());
      if (k === 'e') return tun(() => d.nachUntenVereinen());
      if (k === 'n' && e.shiftKey) return tun(() => d.neueEbene());
      if (k === 'c') return tun(() => kopieren(false));
      if (k === 'x') return tun(() => kopieren(true));
      if (k === '0') return tun(() => bu.einpassen());
      if (k === '1') return tun(() => bu.zoomSetzen(1));
      if (k === '+' || k === '=') return tun(() => bu.zoomen(1.25));
      if (k === '-') return tun(() => bu.zoomen(0.8));
      if (e.key === 'Backspace' || e.key === 'Delete') return tun(() => d.fuellen(bu.opt.hintergrund));
      return;
    }
    if (e.altKey) {
      if (e.key === 'Backspace' || e.key === 'Delete') return tun(() => d.fuellen(bu.opt.vordergrund));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return tun(() => d.loeschen());
    if (e.key.startsWith('Arrow')) {
      const n = e.shiftKey ? 10 : 1;
      return tun(() => bu.schieben(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0));
    }
    const liste = TASTE_WERKZEUG[k];
    if (liste) {
      // dieselbe Taste noch einmal wechselt zwischen den Werkzeugen der Gruppe (M: Rechteck/Ellipse, G: Füllen/Verlauf)
      const i = liste.indexOf(bu.werkzeug);
      return tun(() => werkzeug(liste[(i + 1) % liste.length]!));
    }
    if (k === 'x') return tun(() => optSetzen({ vordergrund: bu.opt.hintergrund, hintergrund: bu.opt.vordergrund }));
    if (k === 'd') return tun(() => optSetzen({ vordergrund: '#000000', hintergrund: '#ffffff' }));
    if (e.key === '[' || k === 'ö') return tun(() => optSetzen({ groesse: Math.max(1, Math.round(bu.opt.groesse * 0.8)) }));
    if (e.key === ']' || k === 'ä') return tun(() => optSetzen({ groesse: Math.min(500, Math.max(bu.opt.groesse + 1, Math.round(bu.opt.groesse * 1.25))) }));
    // einzelne Buchstaben ohne Bedeutung im Editor: nicht an die Kürzel des Dorfs („g h“, „n“) weiterreichen
    if (e.key.length === 1) e.stopPropagation();
  };
  useEffect(() => {
    const runter = (e: KeyboardEvent) => tastenRef.current(e);
    const hoch = (e: KeyboardEvent) => {
      if (e.key === ' ' && buehneRef.current) buehneRef.current.leertaste = false;
    };
    const einfuegen = (e: ClipboardEvent) => {
      const ziel = e.target as HTMLElement | null;
      if (ziel && ['INPUT', 'TEXTAREA'].includes(ziel.tagName)) return;
      if (document.querySelector('.atelier [aria-modal="true"]')) return;
      const datei = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (datei) {
        void bildLaden(datei).then(
          (bild) => {
            alsEbene(bild, 'Eingefügt');
            bild.close();
          },
          (f: Error) => melden(f.message, true),
        );
      } else if (zwischenablage) alsEbene(zwischenablage, 'Eingefügt');
    };
    window.addEventListener('keydown', runter, true);
    window.addEventListener('keyup', hoch, true);
    window.addEventListener('paste', einfuegen);
    return () => {
      window.removeEventListener('keydown', runter, true);
      window.removeEventListener('keyup', hoch, true);
      window.removeEventListener('paste', einfuegen);
    };
  }, [alsEbene, melden]);

  /** Anpassungen ohne Regler */
  const sofort = (art: 'graustufen' | 'invertieren') => {
    const d = sitzung!.doc;
    const e = d.aktiv;
    d.anpassen(e, d.gespeichert(e), (daten) => (art === 'graustufen' ? filter.graustufen(daten.data) : filter.invertieren(daten.data)));
    d.festhalten(art === 'graustufen' ? 'Graustufen' : 'Invertieren');
  };

  // ---- Menüs ------------------------------------------------------------------------------------------
  const menues = useMemo((): [string, MenuePunkt[]][] => {
    if (!doc || !b) return [];
    const d = doc;
    const anp = (art: string): MenuePunkt => ({ t: `${ANPASSUNGEN[art]!.titel} …`, tun: () => setFenster({ art: 'anpassung', daten: art }), aus: !d.aktiv.sichtbar && 'Die aktive Ebene ist ausgeblendet.' });
    return [
      [
        'Datei',
        [
          { t: 'Neu …', tun: () => setFenster({ art: 'neu' }) },
          { t: 'Öffnen …', k: 'Strg+O', tun: () => setFenster({ art: 'oeffnen', daten: 'neu' }) },
          { t: 'Als Ebene einfügen …', tun: () => setFenster({ art: 'oeffnen', daten: 'ebene' }) },
          'trenner',
          { t: 'Speichern', k: 'Strg+S', tun: speichern, test: 'menue-speichern' },
          { t: 'Speichern unter …', k: 'Strg+⇧+S', tun: () => setFenster({ art: 'speichern' }) },
          { t: 'Exportieren (herunterladen) …', tun: () => setFenster({ art: 'speichern', daten: 'export' }) },
        ],
      ],
      [
        'Bearbeiten',
        [
          { t: 'Rückgängig', k: 'Strg+Z', tun: () => d.rueckgaengig(), aus: !d.kannRueckgaengig && 'Nichts rückgängig zu machen.' },
          { t: 'Wiederholen', k: 'Strg+⇧+Z', tun: () => d.wiederholen(), aus: !d.kannWiederholen && 'Nichts zu wiederholen.' },
          'trenner',
          { t: 'Ausschneiden', k: 'Strg+X', tun: () => kopieren(true) },
          { t: 'Kopieren', k: 'Strg+C', tun: () => kopieren(false) },
          { t: 'Einfügen', k: 'Strg+V', tun: einfuegenIntern },
          { t: 'Löschen', k: 'Entf', tun: () => d.loeschen() },
          'trenner',
          { t: 'Mit Vordergrundfarbe füllen', k: 'Alt+⌫', tun: () => d.fuellen(b.opt.vordergrund) },
          { t: 'Mit Hintergrundfarbe füllen', k: 'Strg+⌫', tun: () => d.fuellen(b.opt.hintergrund) },
          { t: 'Frei transformieren', k: 'Strg+T', tun: () => b.transformStarten() },
        ],
      ],
      [
        'Bild',
        [
          { t: 'Bildgröße …', tun: () => setFenster({ art: 'bildgroesse' }) },
          { t: 'Arbeitsfläche …', tun: () => setFenster({ art: 'arbeitsflaeche' }) },
          { t: 'Auf Auswahl zuschneiden', tun: () => d.zuschneiden(d.auswahlGrenzen()!), aus: !d.auswahl && 'Erst einen Bereich auswählen (oder das Werkzeug Zuschneiden nehmen).' },
          'trenner',
          { t: 'Drehen 90° im Uhrzeigersinn', tun: () => (d.drehen(90), b.einpassen()) },
          { t: 'Drehen 90° gegen den Uhrzeigersinn', tun: () => (d.drehen(-90), b.einpassen()) },
          { t: 'Drehen 180°', tun: () => d.drehen(180) },
          { t: 'Horizontal spiegeln', tun: () => d.spiegeln(true) },
          { t: 'Vertikal spiegeln', tun: () => d.spiegeln(false) },
          'trenner',
          anp('helligkeit'),
          anp('farbton'),
          anp('belichtung'),
          anp('kurven'),
          { t: 'Graustufen', tun: () => sofort('graustufen') },
          { t: 'Invertieren', k: 'Strg+I', tun: () => sofort('invertieren') },
          anp('sepia'),
          anp('schwellenwert'),
        ],
      ],
      [
        'Ebene',
        [
          { t: 'Neue Ebene', k: 'Strg+⇧+N', tun: () => d.neueEbene() },
          { t: 'Ebene duplizieren', k: 'Strg+J', tun: () => d.ebeneDuplizieren() },
          { t: 'Ebene löschen', tun: () => d.ebeneLoeschen(), aus: d.ebenen.length <= 1 && 'Die letzte Ebene bleibt.' },
          'trenner',
          { t: 'Nach oben', tun: () => d.ebeneVerschieben(d.aktivId, 1) },
          { t: 'Nach unten', tun: () => d.ebeneVerschieben(d.aktivId, -1) },
          { t: 'Nach unten vereinen', k: 'Strg+E', tun: () => d.nachUntenVereinen(), aus: d.ebenen[0]?.id === d.aktivId && 'Darunter liegt keine Ebene.' },
          { t: 'Auf eine Ebene reduzieren', tun: () => d.aufEineReduzieren(), aus: d.ebenen.length <= 1 && 'Es gibt nur eine Ebene.' },
          'trenner',
          { t: 'Ebene horizontal spiegeln', tun: () => d.spiegeln(true, d.aktiv) },
          { t: 'Ebene vertikal spiegeln', tun: () => d.spiegeln(false, d.aktiv) },
        ],
      ],
      [
        'Auswahl',
        [
          { t: 'Alles auswählen', k: 'Strg+A', tun: () => d.allesAuswaehlen() },
          { t: 'Auswahl aufheben', k: 'Strg+D', tun: () => d.auswahlSetzen(null, 'neu', 'Auswahl aufheben'), aus: !d.auswahl && 'Es ist nichts ausgewählt.' },
          { t: 'Auswahl umkehren', k: 'Strg+⇧+I', tun: () => d.auswahlUmkehren() },
        ],
      ],
      ['Filter', [anp('weichzeichnen'), anp('schaerfen'), anp('rauschen')]],
      [
        'KI',
        [
          { t: 'Hintergrund entfernen', tun: () => void hintergrundEntfernen(), aus: ausHintergrund, test: 'ki-hintergrund' },
          { t: 'Hochskalieren …', tun: () => setFenster({ art: 'hochskalieren' }), aus: ausSkalieren, test: 'ki-hochskalieren' },
          'trenner',
          { t: 'Bild generieren …', tun: () => setFenster({ art: 'generieren' }), aus: ausGenerieren, test: 'ki-generieren' },
          { t: 'Generatives Füllen …', tun: () => setFenster({ art: 'fuellen' }), aus: ausGenerieren ?? (!d.auswahl ? 'Erst den Bereich auswählen, der neu gemalt werden soll.' : null), test: 'ki-fuellen' },
        ],
      ],
      [
        'Ansicht',
        [
          { t: 'Einpassen', k: 'Strg+0', tun: () => b.einpassen() },
          { t: '100 %', k: 'Strg+1', tun: () => b.zoomSetzen(1) },
          { t: 'Vergrößern', k: 'Strg++', tun: () => b.zoomen(1.25) },
          { t: 'Verkleinern', k: 'Strg+−', tun: () => b.zoomen(0.8) },
          'trenner',
          { t: 'Tastenkürzel und Hinweise', tun: () => setFenster({ art: 'hilfe' }) },
        ],
      ],
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, b, doc?.verlaufPos, doc?.verlauf.length, doc?.aktivId, doc?.auswahlStand, doc?.ebenen.length, st, b?.opt.vordergrund, b?.opt.hintergrund]);

  const o = b?.opt ?? STANDARD_OPTIONEN;
  const w = b?.werkzeug ?? 'pinsel';
  const zahl = (titel: string, wert: number, min: number, max: number, setzen: (v: number) => void, einheit = '') => (
    <label className="at-opt" title={titel}>
      <span>{titel}</span>
      <input type="range" min={min} max={max} value={wert} aria-label={titel} onChange={(e) => setzen(Number(e.target.value))} />
      <input type="number" min={min} max={max} value={wert} aria-label={`${titel} (Zahl)`} onChange={(e) => setzen(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
      {einheit}
    </label>
  );
  const haken = (titel: string, an: boolean, setzen: (v: boolean) => void) => (
    <label className="at-opt at-haken">
      <input type="checkbox" checked={an} onChange={(e) => setzen(e.target.checked)} /> {titel}
    </label>
  );
  const modusWahl = (
    <span className="at-opt at-gruppe" role="group" aria-label="Auswahlmodus">
      {(
        [
          ['neu', '▢', 'Neue Auswahl'],
          ['plus', '＋', 'Zur Auswahl hinzufügen (Umschalt)'],
          ['minus', '−', 'Von der Auswahl abziehen (Alt)'],
        ] as const
      ).map(([m, z, t]) => (
        <button key={m} type="button" className={o.auswahlModus === m ? 'aktiv' : ''} title={t} aria-label={t} aria-pressed={o.auswahlModus === m} onClick={() => optSetzen({ auswahlModus: m })}>
          {z}
        </button>
      ))}
    </span>
  );
  const t = b?.transform;
  const optionen = !b || !doc ? null : t ? (
    <>
      <strong>Transformieren</strong>
      <label className="at-opt">
        B <input type="number" aria-label="Breite" value={Math.round(Math.abs(t.bw))} onChange={(e) => b.transformSetzen({ bw: Math.sign(t.bw || 1) * Math.max(1, Number(e.target.value) || 1) })} />
      </label>
      <label className="at-opt">
        H <input type="number" aria-label="Höhe" value={Math.round(Math.abs(t.bh))} onChange={(e) => b.transformSetzen({ bh: Math.sign(t.bh || 1) * Math.max(1, Number(e.target.value) || 1) })} />
      </label>
      <label className="at-opt">
        ∠ <input type="number" aria-label="Winkel" value={Math.round((t.winkel * 180) / Math.PI)} onChange={(e) => b.transformSetzen({ winkel: ((Number(e.target.value) || 0) * Math.PI) / 180 })} /> °
      </label>
      <button type="button" title="Horizontal spiegeln" aria-label="Horizontal spiegeln" onClick={() => b.transformSetzen({ bw: -t.bw })}>
        ⇋
      </button>
      <button type="button" title="Vertikal spiegeln" aria-label="Vertikal spiegeln" onClick={() => b.transformSetzen({ bh: -t.bh })}>
        ⇵
      </button>
      <button type="button" className="haupt" onClick={() => b.transformAnwenden()}>
        ✓ Anwenden
      </button>
      <button type="button" onClick={() => b.transformAbbrechen()}>
        ✕ Abbrechen
      </button>
    </>
  ) : w === 'pinsel' || w === 'radierer' ? (
    <>
      {zahl('Größe', o.groesse, 1, 500, (v) => optSetzen({ groesse: v }), 'px')}
      {zahl('Härte', o.haerte, 0, 100, (v) => optSetzen({ haerte: v }), '%')}
      {zahl('Deckkraft', o.deckkraft, 1, 100, (v) => optSetzen({ deckkraft: v }), '%')}
      {haken('Stiftdruck', o.druck, (v) => optSetzen({ druck: v }))}
    </>
  ) : w === 'fuellen' || w === 'zauberstab' ? (
    <>
      {zahl('Toleranz', o.toleranz, 0, 255, (v) => optSetzen({ toleranz: v }))}
      {haken('Zusammenhängend', o.zusammenhaengend, (v) => optSetzen({ zusammenhaengend: v }))}
      {haken('Alle Ebenen', o.alleEbenen, (v) => optSetzen({ alleEbenen: v }))}
      {w === 'fuellen' ? zahl('Deckkraft', o.deckkraft, 1, 100, (v) => optSetzen({ deckkraft: v }), '%') : modusWahl}
    </>
  ) : w === 'auswahl-rechteck' || w === 'auswahl-ellipse' || w === 'lasso' ? (
    <>
      {modusWahl}
      <button type="button" onClick={() => doc.allesAuswaehlen()}>
        Alles
      </button>
      <button type="button" onClick={() => doc.auswahlSetzen(null, 'neu', 'Auswahl aufheben')} disabled={!doc.auswahl}>
        Aufheben
      </button>
      <button type="button" onClick={() => doc.auswahlUmkehren()}>
        Umkehren
      </button>
    </>
  ) : w === 'verschieben' ? (
    <>
      <button type="button" onClick={() => b.transformStarten()}>
        Frei transformieren (Strg+T)
      </button>
      <span className="at-leise">Ziehen verschiebt die Ebene bzw. den Inhalt der Auswahl · Pfeiltasten: 1 px (Umschalt: 10)</span>
    </>
  ) : w === 'zuschneiden' ? (
    b.schnitt ? (
      <>
        <span>
          {b.schnitt.b} × {b.schnitt.h} px
        </span>
        <button type="button" className="haupt" onClick={() => versuch(() => b.schnittAnwenden())}>
          ✓ Zuschneiden
        </button>
        <button type="button" onClick={() => b.schnittAbbrechen()}>
          ✕ Abbrechen
        </button>
      </>
    ) : (
      <span className="at-leise">Rahmen aufziehen, an den Griffen anpassen, dann „Zuschneiden“ (Enter).</span>
    )
  ) : w === 'form' ? (
    <>
      <select className="at-opt" aria-label="Form" value={o.form} onChange={(e) => optSetzen({ form: e.target.value as Optionen['form'] })}>
        <option value="rechteck">Rechteck</option>
        <option value="ellipse">Ellipse</option>
        <option value="linie">Linie</option>
      </select>
      {o.form !== 'linie' && haken('Gefüllt', o.gefuellt, (v) => optSetzen({ gefuellt: v }))}
      {(o.form === 'linie' || !o.gefuellt) && zahl('Strich', o.strich, 1, 200, (v) => optSetzen({ strich: v }), 'px')}
      {zahl('Deckkraft', o.deckkraft, 1, 100, (v) => optSetzen({ deckkraft: v }), '%')}
    </>
  ) : w === 'verlauf' ? (
    <>
      <select className="at-opt" aria-label="Verlaufsart" value={o.verlaufArt} onChange={(e) => optSetzen({ verlaufArt: e.target.value as Optionen['verlaufArt'] })}>
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>
      {haken('Vordergrund → transparent', o.verlaufTransparent, (v) => optSetzen({ verlaufTransparent: v }))}
      {zahl('Deckkraft', o.deckkraft, 1, 100, (v) => optSetzen({ deckkraft: v }), '%')}
    </>
  ) : w === 'text' ? (
    <>
      <select className="at-opt" aria-label="Schrift" value={o.schrift} onChange={(e) => optSetzen({ schrift: e.target.value })}>
        {SCHRIFTEN.map(([f, n]) => (
          <option key={f} value={f}>
            {n}
          </option>
        ))}
      </select>
      {zahl('Größe', o.schriftGroesse, 6, 600, (v) => optSetzen({ schriftGroesse: v }), 'px')}
      {haken('Fett', o.fett, (v) => optSetzen({ fett: v }))}
      {haken('Kursiv', o.kursiv, (v) => optSetzen({ kursiv: v }))}
      <span className="at-leise">Ins Bild klicken, tippen, mit Strg+Enter oder ✓ setzen.</span>
    </>
  ) : w === 'pipette' ? (
    <span className="at-leise">Klick nimmt die Vordergrundfarbe auf, Alt+Klick die Hintergrundfarbe.</span>
  ) : w === 'zoom' ? (
    <span className="at-leise">Klick vergrößert, Alt+Klick verkleinert. Strg+Mausrad zoomt mit jedem Werkzeug; am Handy mit zwei Fingern.</span>
  ) : (
    <span className="at-leise">Ziehen verschiebt die Ansicht (auch: Leertaste halten, mittlere Maustaste, zwei Finger).</span>
  );

  const textFeld = b?.textOrt && doc ? b.zuAnsicht(b.textOrt) : null;
  const textFertig = () => {
    const tx = text;
    setText('');
    buehneRef.current?.textSetzen(tx);
  };

  return (
    <div className="atelier" data-testid="atelier" data-werkzeug={w} onPointerDown={(e) => menue && !(e.target as HTMLElement).closest('.at-menue-gruppe') && setMenue(null)}>
      <div className="at-kopf">
        <a href="/gebaeude/Atelier" onClick={linkKlick} className="at-zurueck" title="Zurück ins Atelier">
          ←
        </a>
        <nav className="at-menues" aria-label="Menü">
          {menues.map(([titel, punkte]) => (
            <Menue key={titel} titel={titel} punkte={punkte} offen={menue} setOffen={setMenue} beiGesperrt={(g) => melden(g, true)} />
          ))}
        </nav>
        <span className="at-datei" data-testid="at-datei" title={sitzung?.pfad ?? 'noch nicht im Vault gespeichert'}>
          {sitzung?.name}
          {doc?.geaendert ? ' •' : ''}
        </span>
        <span className="at-gruppe">
          <button type="button" aria-label="Rückgängig" title="Rückgängig (Strg+Z)" disabled={!doc?.kannRueckgaengig} onClick={() => doc?.rueckgaengig()}>
            ↶
          </button>
          <button type="button" aria-label="Wiederholen" title="Wiederholen (Strg+Umschalt+Z)" disabled={!doc?.kannWiederholen} onClick={() => doc?.wiederholen()}>
            ↷
          </button>
          <button type="button" className="haupt" onClick={speichern} title="Speichern (Strg+S)">
            Speichern
          </button>
          <button type="button" className="at-nur-schmal" aria-label="Ebenen, Farbe, Verlauf" aria-pressed={seiteOffen} onClick={() => setSeiteOffen(!seiteOffen)}>
            ☰
          </button>
        </span>
      </div>
      <div className="at-optionen" data-testid="at-optionen">
        {optionen}
      </div>
      <div className="at-mitte">
        <div className="at-werkzeuge" role="toolbar" aria-label="Werkzeuge">
          {WERKZEUGE.map(([id, zeichen, titel, taste]) => (
            <button key={id} type="button" className={w === id ? 'aktiv' : ''} aria-pressed={w === id} aria-label={titel} title={`${titel} (${taste})`} data-werkzeug={id} onClick={() => werkzeug(id)}>
              {zeichen}
            </button>
          ))}
          <span className="at-farben" title="Vordergrund- und Hintergrundfarbe (X tauscht, D setzt Schwarz/Weiß)">
            <input type="color" aria-label="Vordergrundfarbe" value={o.vordergrund} onChange={(e) => optSetzen({ vordergrund: e.target.value })} />
            <input type="color" aria-label="Hintergrundfarbe" value={o.hintergrund} onChange={(e) => optSetzen({ hintergrund: e.target.value })} />
          </span>
        </div>
        <div className="at-buehne">
          <canvas ref={leinwandRef} className="at-leinwand" data-testid="at-leinwand" />
          {textFeld && (
            <div className="at-text" style={{ left: textFeld.x, top: textFeld.y }}>
              <textarea
                autoFocus
                aria-label="Text"
                value={text}
                rows={Math.max(1, text.split('\n').length)}
                placeholder="Text …"
                style={{ font: b!.textSchrift(Math.max(8, o.schriftGroesse * b!.zoom)), color: o.vordergrund, lineHeight: 1.25 }}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    textFertig();
                  } else if (e.key === 'Escape') {
                    setText('');
                    b!.textOrt = null;
                    neu();
                  }
                  e.stopPropagation();
                }}
                onBlur={textFertig}
              />
            </div>
          )}
          {hinweis && (
            <div className={`at-hinweis${hinweis.fehler ? ' fehler' : ''}`} role="status" data-testid="at-hinweis" onClick={() => setHinweis(null)}>
              {hinweis.text}
            </div>
          )}
          {arbeit && (
            <div className="at-arbeit" role="status" data-testid="at-arbeit">
              <span className="at-kreisel" /> {arbeit}
            </div>
          )}
        </div>
        <aside className={`at-seite${seiteOffen ? ' offen' : ''}`}>
          {doc && b && (
            <>
              <section className="at-feld">
                <h3>Farbe</h3>
                <div className="at-palette">
                  {PALETTE.map((f) => (
                    <button key={f} type="button" style={{ background: f }} aria-label={`Farbe ${f}`} title={f} className={o.vordergrund === f ? 'aktiv' : ''} onClick={() => optSetzen({ vordergrund: f })} />
                  ))}
                </div>
                <div className="at-zeile">
                  <button type="button" onClick={() => optSetzen({ vordergrund: o.hintergrund, hintergrund: o.vordergrund })} title="Farben tauschen (X)">
                    ⇄ Tauschen
                  </button>
                  <button type="button" onClick={() => optSetzen({ vordergrund: '#000000', hintergrund: '#ffffff' })} title="Schwarz/Weiß (D)">
                    ◐ Standard
                  </button>
                </div>
              </section>
              <EbenenFenster doc={doc} hinweis={(x) => melden(x, true)} />
              <VerlaufFenster doc={doc} />
            </>
          )}
        </aside>
      </div>
      <div className="at-status">
        <button type="button" aria-label="Verkleinern" onClick={() => b?.zoomen(0.8)}>
          −
        </button>
        <button type="button" onClick={() => b?.einpassen()} title="Einpassen (Strg+0)" data-testid="at-zoom">
          {Math.round((b?.zoom ?? 1) * 100)} %
        </button>
        <button type="button" aria-label="Vergrößern" onClick={() => b?.zoomen(1.25)}>
          ＋
        </button>
        <span data-testid="at-groesse">
          {doc?.breite} × {doc?.hoehe} px
        </span>
        <span className="at-leise at-nur-breit">{doc?.aktiv.name}</span>
      </div>

      {fenster?.art === 'anpassung' && doc && b && <AnpassungFenster art={fenster.daten as string} doc={doc} neuMalen={() => b.schmutzig()} zu={() => setFenster(null)} />}
      {fenster?.art === 'neu' && <NeuFenster zu={() => setFenster(null)} anlegen={(bb, hh, grund) => verwerfenOk() && (zeigen(Dokument.leer(bb, hh, grund), { pfad: null, version: null, name: 'Unbenannt' }), setFenster(null))} melden={melden} />}
      {fenster?.art === 'oeffnen' && <OeffnenFenster ziel={fenster.daten as 'neu' | 'ebene'} zu={() => setFenster(null)} lokal={dateiGewaehlt} ausVault={(p) => (setFenster(null), fenster.daten === 'ebene' ? void ebeneAusVault(p) : verwerfenOk() && void ausVaultOeffnen(p))} />}
      {fenster?.art === 'speichern' && sitzung && (
        <SpeichernFenster nurExport={fenster.daten === 'export'} sitzung={sitzung} zu={() => setFenster(null)} vault={(p, f, q) => void imVaultSpeichern(p, f, q)} laden={(n, f, q) => void herunterladen(n, f, q)} />
      )}
      {fenster?.art === 'bildgroesse' && doc && <GroesseFenster titel="Bildgröße" doc={doc} zu={() => setFenster(null)} anwenden={(bb, hh) => versuch(() => (doc.bildgroesse(bb, hh), b?.einpassen(), setFenster(null)))} verhaeltnis />}
      {fenster?.art === 'arbeitsflaeche' && doc && <GroesseFenster titel="Arbeitsfläche" doc={doc} zu={() => setFenster(null)} anwenden={(bb, hh, anker) => versuch(() => (doc.arbeitsflaeche(bb, hh, anker), b?.einpassen(), setFenster(null)))} anker />}
      {fenster?.art === 'hochskalieren' && doc && (
        <Fenster titel="Hochskalieren (KI)" zu={() => setFenster(null)} schmal>
          <div className="at-formular">
            <p>
              Rechnet im Rechenraum des Dorfs (Real-ESRGAN, ohne Internet). Jetzt: {doc.breite} × {doc.hoehe} px.
            </p>
            {doc.breite * doc.hoehe > (st?.skalierenMaxPixel ?? 0) ? (
              <p className="at-fehler">Zu groß für das Modell (höchstens etwa 1024 × 1024). Vorher unter Bild → Bildgröße verkleinern oder zuschneiden.</p>
            ) : (
              <>
                {doc.ebenen.length > 1 && <p className="at-leise">Alle Ebenen werden dabei zu einer (Rückgängig holt sie zurück).</p>}
                <div className="at-zeile at-ende">
                  <button type="button" onClick={() => void hochskalieren(2)}>
                    2× → {doc.breite * 2} × {doc.hoehe * 2}
                  </button>
                  <button type="button" className="haupt" onClick={() => void hochskalieren(4)}>
                    4× → {doc.breite * 4} × {doc.hoehe * 4}
                  </button>
                </div>
              </>
            )}
          </div>
        </Fenster>
      )}
      {fenster?.art === 'generieren' && doc && <PromptFenster titel="Bild generieren" hinweis="Der Text geht an Cloudflare Workers AI (FLUX.2 klein). Das Ergebnis kommt als neue Ebene." masse={[doc.breite, doc.hoehe]} zu={() => setFenster(null)} los={(p, bb, hh) => void generieren(p, bb, hh)} />}
      {fenster?.art === 'fuellen' && doc && <PromptFenster titel="Generatives Füllen" hinweis="Der ausgewählte Bildausschnitt und der Text gehen an Cloudflare Workers AI. Beschreibe, wie der Ausschnitt aussehen soll – das Ergebnis kommt als neue Ebene, nur innerhalb der Auswahl." zu={() => setFenster(null)} los={(p) => void generativFuellen(p)} />}
      {fenster?.art === 'hilfe' && <HilfeFenster zu={() => setFenster(null)} />}
    </div>
  );

  async function ebeneAusVault(pfad: string) {
    setArbeit('Öffne …');
    try {
      const { blob } = await holeBlob(`/api/atelier/oeffnen?pfad=${encodeURIComponent(pfad)}`);
      if (/\.atelier$/i.test(pfad)) throw new Error('Ein Projekt lässt sich nicht als Ebene einfügen – bitte ein Bild wählen.');
      const bild = await bildLaden(blob);
      alsEbene(bild, ohneEndung(namensTeil(pfad)));
      bild.close();
    } catch (e) {
      melden((e as Error).message, true);
    } finally {
      setArbeit(null);
    }
  }
}

// ---- Fenster ---------------------------------------------------------------------------------------------

function NeuFenster({ zu, anlegen, melden }: { zu: () => void; anlegen: (b: number, h: number, grund: string | null) => void; melden: (t: string, fehler?: boolean) => void }) {
  const [b, setB] = useState(1920);
  const [h, setH] = useState(1080);
  const [grund, setGrund] = useState('weiss');
  const vorgaben: [string, number, number][] = [
    ['Full HD', 1920, 1080],
    ['Quadrat', 1080, 1080],
    ['Hochformat', 1080, 1350],
    ['A4 (150 dpi)', 1240, 1754],
  ];
  return (
    <Fenster titel="Neues Bild" zu={zu} schmal>
      <form
        className="at-formular"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            groessePruefen(b, h);
            anlegen(b, h, grund === 'weiss' ? '#ffffff' : grund === 'schwarz' ? '#000000' : null);
          } catch (f) {
            melden((f as Error).message, true);
          }
        }}
      >
        <div className="at-zeile">
          {vorgaben.map(([n, vb, vh]) => (
            <button key={n} type="button" onClick={() => (setB(vb), setH(vh))}>
              {n}
            </button>
          ))}
        </div>
        <label>
          Breite (px) <input type="number" min={1} max={MAX_KANTE} value={b} onChange={(e) => setB(Number(e.target.value))} />
        </label>
        <label>
          Höhe (px) <input type="number" min={1} max={MAX_KANTE} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <label>
          Hintergrund
          <select value={grund} onChange={(e) => setGrund(e.target.value)}>
            <option value="weiss">Weiß</option>
            <option value="schwarz">Schwarz</option>
            <option value="transparent">Transparent</option>
          </select>
        </label>
        <div className="at-zeile at-ende">
          <button type="button" onClick={zu}>
            Abbrechen
          </button>
          <button type="submit" className="haupt">
            Anlegen
          </button>
        </div>
      </form>
    </Fenster>
  );
}

function OeffnenFenster({ ziel, zu, lokal, ausVault }: { ziel: 'neu' | 'ebene'; zu: () => void; lokal: (f: File | undefined, ziel: 'neu' | 'ebene') => void; ausVault: (pfad: string) => void }) {
  const baum = useBaum();
  const [q, setQ] = useState('');
  const dateien = useMemo(() => alleDateien(baum.data).filter((p) => OEFFNEN_ENDUNGEN.has(endung(p)) && !p.includes('.konflikt-')), [baum.data]);
  const treffer = dateien.filter((p) => p.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200);
  return (
    <Fenster titel={ziel === 'ebene' ? 'Als Ebene einfügen' : 'Bild öffnen'} zu={zu}>
      <div className="at-formular">
        <label className="at-datei-knopf">
          📁 Von diesem Gerät …
          <input type="file" data-testid="at-datei-wahl" accept="image/*,.heic,.heif,.tif,.tiff,.atelier" onChange={(e) => lokal(e.target.files?.[0], ziel)} />
        </label>
        <label>
          Aus dem Vault
          <input type="search" placeholder="Suchen … (Name oder Ordner)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        <ul className="at-dateiliste" data-testid="at-vault-liste">
          {treffer.map((p) => (
            <li key={p}>
              <button type="button" onClick={() => ausVault(p)}>
                <strong>{namensTeil(p)}</strong>
                <span>{ordnerVon(p)}</span>
              </button>
            </li>
          ))}
          {!treffer.length && <li className="at-leise">{baum.isPending ? 'Lade …' : 'Keine Bilder gefunden.'}</li>}
        </ul>
      </div>
    </Fenster>
  );
}

function SpeichernFenster({ sitzung: s, nurExport, zu, vault, laden }: { sitzung: Sitzung; nurExport: boolean; zu: () => void; vault: (pfad: string, f: Format, q: number) => void; laden: (name: string, f: Format, q: number) => void }) {
  const [ordner, setOrdner] = useState(s.pfad ? ordnerVon(s.pfad) : 'Atelier/bilder');
  const [name, setName] = useState(ohneEndung(s.name).replace(/[^\p{L}\p{N} ._-]+/gu, '-') || 'bild');
  const start = s.pfad ? endung(s.pfad) : '';
  const [format, setFormat] = useState<Format>(nurExport ? 'png' : start === 'atelier' || s.doc.ebenen.length > 1 ? 'atelier' : start === 'jpg' || start === 'jpeg' ? 'jpg' : start === 'webp' ? 'webp' : 'png');
  const [q, setQ] = useState(92);
  const pfad = `${ordner.replace(/^\/+|\/+$/g, '')}/${name.trim()}.${format}`;
  return (
    <Fenster titel={nurExport ? 'Exportieren' : 'Speichern unter'} zu={zu} schmal>
      <form
        className="at-formular"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (nurExport) laden(name.trim(), format, q / 100);
          else vault(pfad, format, q / 100);
        }}
      >
        {!nurExport && (
          <label>
            Ordner im Vault <input value={ordner} onChange={(e) => setOrdner(e.target.value)} aria-label="Ordner im Vault" />
          </label>
        )}
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
            <option value="atelier">Projekt mit Ebenen (.atelier)</option>
            <option value="png">PNG – verlustfrei, mit Durchsichtigkeit</option>
            <option value="jpg">JPG – klein, ohne Durchsichtigkeit</option>
            <option value="webp">WebP – klein, mit Durchsichtigkeit</option>
          </select>
        </label>
        {(format === 'jpg' || format === 'webp') && (
          <label>
            <span>
              Qualität <output>{q}</output>
            </span>
            <input type="range" min={30} max={100} value={q} onChange={(e) => setQ(Number(e.target.value))} />
          </label>
        )}
        {format !== 'atelier' && s.doc.ebenen.length > 1 && <p className="at-leise">Dieses Format speichert das fertige Bild – die {s.doc.ebenen.length} Ebenen bleiben nur im Projektformat erhalten.</p>}
        {!nurExport && <p className="at-leise">Ziel: {pfad}</p>}
        <div className="at-zeile at-ende">
          <button type="button" onClick={zu}>
            Abbrechen
          </button>
          {!nurExport && (
            <button type="button" onClick={() => name.trim() && laden(name.trim(), format, q / 100)}>
              Herunterladen
            </button>
          )}
          <button type="submit" className="haupt">
            {nurExport ? 'Herunterladen' : 'Im Vault speichern'}
          </button>
        </div>
      </form>
    </Fenster>
  );
}

function GroesseFenster({ titel, doc, zu, anwenden, verhaeltnis, anker }: { titel: string; doc: Dokument; zu: () => void; anwenden: (b: number, h: number, anker: number) => void; verhaeltnis?: boolean; anker?: boolean }) {
  const [b, setB] = useState(doc.breite);
  const [h, setH] = useState(doc.hoehe);
  const [fest, setFest] = useState(!!verhaeltnis);
  const [a, setA] = useState(4);
  const v = doc.breite / doc.hoehe;
  return (
    <Fenster titel={titel} zu={zu} schmal>
      <form
        className="at-formular"
        onSubmit={(e) => {
          e.preventDefault();
          anwenden(b, h, a);
        }}
      >
        <label>
          Breite (px)
          <input type="number" min={1} max={MAX_KANTE} value={b} aria-label="Breite" autoFocus onChange={(e) => (setB(Number(e.target.value)), fest && setH(Math.max(1, Math.round(Number(e.target.value) / v))))} />
        </label>
        <label>
          Höhe (px)
          <input type="number" min={1} max={MAX_KANTE} value={h} aria-label="Höhe" onChange={(e) => (setH(Number(e.target.value)), fest && setB(Math.max(1, Math.round(Number(e.target.value) * v))))} />
        </label>
        {verhaeltnis && (
          <label className="at-haken">
            <input type="checkbox" checked={fest} onChange={(e) => setFest(e.target.checked)} /> Seitenverhältnis beibehalten
          </label>
        )}
        {anker && (
          <div>
            <span>Der Inhalt bleibt …</span>
            <div className="at-anker" role="group" aria-label="Anker">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <button key={i} type="button" className={a === i ? 'aktiv' : ''} aria-pressed={a === i} aria-label={`Anker ${i + 1}`} onClick={() => setA(i)}>
                  {a === i ? '●' : '·'}
                </button>
              ))}
            </div>
          </div>
        )}
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

function PromptFenster({ titel, hinweis, masse, zu, los }: { titel: string; hinweis: string; masse?: [number, number]; zu: () => void; los: (prompt: string, b: number, h: number) => void }) {
  const [p, setP] = useState('');
  const [m, setM] = useState('bild');
  const wahl: Record<string, [number, number]> = { bild: masse ?? [1024, 1024], quadrat: [1024, 1024], quer: [1280, 720], hoch: [768, 1024] };
  return (
    <Fenster titel={titel} zu={zu}>
      <form
        className="at-formular"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.trim()) los(p.trim(), ...wahl[m]!);
        }}
      >
        <label>
          Beschreibung
          <textarea value={p} onChange={(e) => setP(e.target.value)} rows={4} maxLength={2000} autoFocus placeholder="z. B. ein Fachwerkhaus im Morgennebel, Aquarell" aria-label="Beschreibung" />
        </label>
        {masse && (
          <label>
            Format
            <select value={m} onChange={(e) => setM(e.target.value)}>
              <option value="bild">wie das Bild ({masse[0]} × {masse[1]})</option>
              <option value="quadrat">Quadrat 1024 × 1024</option>
              <option value="quer">Querformat 1280 × 720</option>
              <option value="hoch">Hochformat 768 × 1024</option>
            </select>
          </label>
        )}
        <p className="at-leise">{hinweis} Kostenlos im Tageskontingent von Cloudflare (10 000 „Neuronen“, rund 90 Bilder in 1024 × 1024).</p>
        <div className="at-zeile at-ende">
          <button type="button" onClick={zu}>
            Abbrechen
          </button>
          <button type="submit" className="haupt" disabled={!p.trim()}>
            Los
          </button>
        </div>
      </form>
    </Fenster>
  );
}

function HilfeFenster({ zu }: { zu: () => void }) {
  const k: [string, string][] = [
    ['V', 'Verschieben'],
    ['M', 'Auswahlrechteck / -ellipse'],
    ['L', 'Lasso'],
    ['W', 'Zauberstab'],
    ['C', 'Zuschneiden'],
    ['I', 'Pipette'],
    ['B', 'Pinsel'],
    ['E', 'Radierer'],
    ['G', 'Füllen / Verlauf'],
    ['T', 'Text'],
    ['U', 'Form'],
    ['H / Leertaste', 'Hand'],
    ['Z', 'Zoom'],
    ['X · D', 'Farben tauschen · Schwarz/Weiß'],
    ['Ö Ä bzw. [ ]', 'Pinsel kleiner / größer'],
    ['Strg+Z · Strg+⇧+Z', 'Rückgängig · Wiederholen'],
    ['Strg+S · Strg+⇧+S', 'Speichern · Speichern unter'],
    ['Strg+A · Strg+D · Strg+⇧+I', 'Alles · Aufheben · Auswahl umkehren'],
    ['Strg+T', 'Frei transformieren (Enter/Esc)'],
    ['Strg+J · Strg+E · Strg+⇧+N', 'Ebene duplizieren · vereinen · neu'],
    ['Strg+C / X / V', 'Kopieren / Ausschneiden / Einfügen (auch Bilder von außen)'],
    ['Entf · Alt+⌫ · Strg+⌫', 'Löschen · mit Vorder-/Hintergrundfarbe füllen'],
    ['Strg+0 · Strg+1 · Strg+Mausrad', 'Einpassen · 100 % · Zoom'],
    ['Pfeiltasten', '1 px schieben (Umschalt: 10)'],
  ];
  return (
    <Fenster titel="Tastenkürzel und Hinweise" zu={zu}>
      <div className="at-formular">
        <table className="at-tasten">
          <tbody>
            {k.map(([t, was]) => (
              <tr key={t}>
                <td>
                  <kbd>{t}</kbd>
                </td>
                <td>{was}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="at-leise">
          Am Handy: ein Finger benutzt das Werkzeug, zwei Finger zoomen und verschieben die Ansicht. Umschalt bzw. Alt beim Auswählen fügt hinzu bzw. zieht ab (am Handy: die Knöpfe ▢ ＋ − oben).
        </p>
        <p className="at-leise">
          Was es (noch) nicht gibt: Text bleibt nach dem Setzen ein Bild (nicht nachträglich editierbar), keine Einstellungsebenen, Ebenenmasken, Smartobjekte, CMYK oder PSD-Dateien. Projekte mit Ebenen speichert das Atelier als „.atelier“ (ein ZIP mit PNG-Ebenen).
        </p>
      </div>
    </Fenster>
  );
}
