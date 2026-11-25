// E240: Symbol statt Emoji – im Dorf-Design bleibt das Emoji, in der Apple-Oberfläche erscheint ein Linien-Symbol
// (eigene SVG-Zeichnungen im Stil von SF Symbols – SF Symbols selbst dürfen nur auf Apple-Plattformen verwendet werden).
// Die Zeichnungen und die Zuordnung Emoji → Symbol liegen in symbole.tsx.
import { useDesign } from './design';
import { SYMBOLE, symbolFuer, type SymbolName } from './symbole';

export function Symbol({ name, groesse = '1.15em', titel }: { name: SymbolName; groesse?: string | number; titel?: string }) {
  const s = SYMBOLE[name];
  return (
    <svg className="a-symbol" viewBox="0 0 24 24" width={groesse} height={groesse} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role={titel ? 'img' : undefined} aria-label={titel} aria-hidden={titel ? undefined : true}>
      {s}
    </svg>
  );
}

/** Emoji im Dorf-Design, Symbol in der Apple-Oberfläche (unbekannte Emojis bleiben Emojis). Siehe auch apple/tag.tsx (<E>, <Ring>). */
export function Ikon({ e, titel, groesse }: { e: string; titel?: string; groesse?: string | number }) {
  const design = useDesign();
  const name = design === 'apple' ? symbolFuer(e) : null;
  // Dorf-Design (und unbekannte Emojis): genau der bisherige Text – gleiche Darstellung, gleicher zugänglicher Name
  if (!name) return titel ? <span aria-label={titel}>{e}</span> : <>{e}</>;
  return <Symbol name={name} titel={titel} groesse={groesse} />;
}

// Emoji-Folgen (mit Variationszeichen/ZWJ) und die Pfeil-/Formzeichen, für die es Symbole gibt
const EMOJI_RE = /(\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*|[←→↑↓↔↗↩↺↻↶↷⇄⇋⇔⇒⇧⇵▲▼▾▸☐□▢▫●○◯◐✓✗✕⌘⌫⏎☰⛶✥⬚▭▤])/u;

/**
 * Text mit eingestreuten Emojis (z. B. „🧮 rechnet“, „✅ Gespeichert“): im Dorf-Design unverändert, in der Apple-Oberfläche
 * wird jedes bekannte Emoji durch sein Symbol ersetzt (unbekannte bleiben). Für Texte aus Listen/Konstanten.
 */
export function IkonText({ text }: { text: string }) {
  const design = useDesign();
  if (design !== 'apple' || !EMOJI_RE.test(text)) return <>{text}</>;
  const teile = text.split(new RegExp(EMOJI_RE.source, 'gu'));
  return (
    <>
      {teile.map((t, i) => {
        if (i % 2 === 0) return t;
        const name = symbolFuer(t);
        return name ? <Symbol key={i} name={name} /> : t;
      })}
    </>
  );
}
