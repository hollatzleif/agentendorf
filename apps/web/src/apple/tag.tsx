// E240 (Bereich Tagesgeschäft): Emoji als Symbol – NUR in der Apple-Oberfläche. Im Dorf-Design bleibt exakt der bisherige
// Text (kein zusätzliches <span>, keine geänderte Zugänglichkeit: Knopf- und Überschriften-Namen bleiben wie gehabt).
import { useDesign } from './design';
import { Ikon } from './Ikon';

export function E({ e }: { e: string }) {
  return useDesign() === 'apple' ? <Ikon e={e} /> : <>{e}</>;
}

/** Fortschrittsring wie in der Uhr-App (nur Apple): anteil 0…1, Farbe über CSS (currentColor) */
export function Ring({ anteil, groesse = 120, dicke = 8, className = '' }: { anteil: number; groesse?: number; dicke?: number; className?: string }) {
  const r = (groesse - dicke) / 2;
  const u = 2 * Math.PI * r;
  const a = Math.min(1, Math.max(0, anteil));
  return (
    <svg className={`a-ring ${className}`} width={groesse} height={groesse} viewBox={`0 0 ${groesse} ${groesse}`} aria-hidden>
      <circle className="a-ring-spur" cx={groesse / 2} cy={groesse / 2} r={r} fill="none" strokeWidth={dicke} />
      <circle
        className="a-ring-wert"
        cx={groesse / 2}
        cy={groesse / 2}
        r={r}
        fill="none"
        strokeWidth={dicke}
        strokeLinecap="round"
        strokeDasharray={`${u} ${u}`}
        strokeDashoffset={u * (1 - a)}
        transform={`rotate(-90 ${groesse / 2} ${groesse / 2})`}
      />
    </svg>
  );
}

/** Text mit Emoji vorn („☑️ Erledigte To-dos“): in Apple wird das Emoji zum Symbol, im Dorf bleibt der Text genau so */
export function IkonText({ text }: { text: string }) {
  const apple = useDesign() === 'apple';
  const m = apple ? /^(\S+)\s(.*)$/u.exec(text) : null;
  if (!m || /^[\p{L}\p{N}]/u.test(m[1]!)) return <>{text}</>;
  return (
    <>
      <Ikon e={m[1]!} /> {m[2]}
    </>
  );
}
