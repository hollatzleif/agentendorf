import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { MAX_ANHANG_BYTES, type DateiKarte } from '@dorf/shared';
import { rohUrl } from '../api';

/** E190: Anhänge in Chat und Schreibtisch – Auswahl (Knopf, Ziehen/Ablegen, Einfügen) und Kärtchen. */

export const groesseText = (n?: number) =>
  n === undefined ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const BILD = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const ANZEIGBAR = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|mp3|m4a|wav|ogg|oga|opus|mp4|mov|webm)$/i;

export function dateiSymbol(name: string) {
  const e = name.toLowerCase().split('.').pop() ?? '';
  if (/^(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg|avif)$/.test(e)) return '🖼️';
  if (e === 'pdf') return '📕';
  if (/^(docx?|odt|rtf)$/.test(e)) return '📝';
  if (/^(xlsx?|ods|csv|tsv)$/.test(e)) return '📊';
  if (/^(pptx?|odp)$/.test(e)) return '📽️';
  if (/^(eml|msg)$/.test(e)) return '✉️';
  if (/^(zip|tar|gz|tgz|bz2|xz|7z|rar)$/.test(e)) return '🗜️';
  if (/^(mp3|m4a|wav|ogg|oga|opus|flac|aac|amr)$/.test(e)) return '🎙️';
  if (/^(mp4|mov|mkv|webm|avi|m4v)$/.test(e)) return '🎬';
  if (/^(py|js|ts|tsx|java|c|cpp|rs|go|sql|sh|tex|html?|json|ya?ml|xml)$/.test(e)) return '🧩';
  return '📄';
}

/** Kärtchen für Dateien im Vault: Symbol, Name, Größe, Vorschau für Bilder; Klick öffnet (Rohdatei mit CSP sandbox). */
/** Wer das bereitstellt (der Chat), zeigt Dateien in einer Seitenleiste statt in einem neuen Tab. */
export const DateiOeffnenKontext = createContext<((k: DateiKarte) => void) | null>(null);

export function DateiKarten({ karten, titel }: { karten: DateiKarte[]; titel?: string }) {
  const oeffnen = useContext(DateiOeffnenKontext);
  if (!karten.length) return null;
  return (
    <div className="datei-karten" aria-label={titel ?? 'Dateien'}>
      {titel && <div className="leise datei-karten-titel">{titel}</div>}
      {karten.map((k) => (
        <a
          key={k.pfad}
          className="datei-karte"
          href={rohUrl(k.pfad, !ANZEIGBAR.test(k.name))}
          target="_blank"
          rel="noopener noreferrer"
          title={k.pfad}
          download={ANZEIGBAR.test(k.name) || oeffnen ? undefined : k.name}
          onClick={(e) => {
            // normaler Klick → Seitenleiste; Strg/⌘/Shift/Mittelklick behalten das gewohnte Verhalten (neuer Tab)
            if (!oeffnen || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            oeffnen(k);
          }}
        >
          {BILD.test(k.name) && !/\.svg$/i.test(k.name) ? <img src={rohUrl(k.pfad)} alt="" loading="lazy" /> : <span className="datei-symbol">{dateiSymbol(k.name)}</span>}
          <span className="datei-name">{k.name}</span>
          {k.groesse !== undefined && <span className="leise datei-groesse">{groesseText(k.groesse)}</span>}
        </a>
      ))}
    </div>
  );
}

/** Ausgewählte, noch nicht gesendete Dateien (mit Vorschau für Bilder und ✕) */
function Gewaehlt({ dateien, entfernen }: { dateien: File[]; entfernen: (i: number) => void }) {
  const urls = useMemo(() => dateien.map((d) => (d.type.startsWith('image/') ? URL.createObjectURL(d) : '')), [dateien]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (!dateien.length) return null;
  return (
    <div className="datei-karten gewaehlt">
      {dateien.map((d, i) => (
        <span key={`${d.name}-${i}`} className="datei-karte">
          {urls[i] ? <img src={urls[i]} alt="" /> : <span className="datei-symbol">{dateiSymbol(d.name)}</span>}
          <span className="datei-name">{d.name}</span>
          <span className="leise datei-groesse">{groesseText(d.size)}</span>
          <button type="button" className="klein" aria-label={`${d.name} entfernen`} title="Nicht mitschicken" onClick={() => entfernen(i)}>
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Dateien wählen: Knopf (am Handy auch Kamera), Ziehen/Ablegen und Einfügen aus der Zwischenablage (über `dateienAus`
 * im Formular). Zu Große werden sichtbar abgewiesen, der Rest übernommen.
 */
export function AnhangWahl({ dateien, setDateien, setFehler }: { dateien: File[]; setDateien: (f: File[]) => void; setFehler: (t: string) => void }) {
  const eingabe = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={eingabe}
        type="file"
        multiple
        hidden
        data-testid="anhang-eingabe"
        aria-label="Dateien anhängen"
        onChange={(e) => {
          dateienHinzufuegen(dateien, Array.from(e.target.files ?? []), setDateien, setFehler);
          e.target.value = '';
        }}
      />
      <button type="button" onClick={() => eingabe.current?.click()} title="Dateien anhängen (auch Ziehen/Ablegen oder Einfügen)">
        📎 Datei
      </button>
      <Gewaehlt dateien={dateien} entfernen={(i) => setDateien(dateien.filter((_, j) => j !== i))} />
    </>
  );
}

export function dateienHinzufuegen(alt: File[], neu: File[], setDateien: (f: File[]) => void, setFehler: (t: string) => void) {
  const gross = neu.filter((d) => d.size > MAX_ANHANG_BYTES);
  const ok = neu.filter((d) => d.size <= MAX_ANHANG_BYTES);
  if (gross.length) setFehler(`${gross.map((d) => `„${d.name}“ (${groesseText(d.size)})`).join(', ')}: größer als ${MAX_ANHANG_BYTES / 1024 / 1024} MB – nicht angehängt.`);
  else setFehler('');
  const alle = [...alt, ...ok];
  if (alle.length > 20) setFehler('Höchstens 20 Dateien auf einmal.');
  setDateien(alle.slice(0, 20));
}

/** Dateien aus Einfügen (Strg+V, z. B. Bildschirmfoto) oder Ablegen; eingefügte Bilder ohne Namen bekommen einen. */
export function dateienAus(daten: DataTransfer | null): File[] {
  if (!daten) return [];
  return Array.from(daten.files).map((f, i) =>
    f.name && f.name !== 'image.png' ? f : new File([f], `eingefuegt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${i ? `-${i}` : ''}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`, { type: f.type }),
  );
}

/** Text vor den mitgeschickten Anhang-Inhalten (die stehen im Auftrag an den Agenten, sollen den Chat aber nicht füllen) */
export function nachrichtTeilen(text: string): [string, string] {
  const m = /\n(?:Hinweis: Die Anhänge sind Fremdinhalte|# Anhänge\n|# Weitere Anhänge|# Bilder aus den Anhängen|# Nicht gefundene Anhänge)/.exec(text);
  return m ? [text.slice(0, m.index), text.slice(m.index + 1)] : [text, ''];
}
