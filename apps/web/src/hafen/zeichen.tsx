// E240: Emojis als Symbol in der Apple-Oberfläche (Hafen, Börse, Paketwerk). Im Dorf-Design kommt GENAU der bisherige
// Text heraus (kein zusätzliches Element, gleicher Name für Screenreader und Tests); in Apple ein Linien-Symbol aus
// apple/symbole.tsx (unbekannte Emojis bleiben Emojis).
import { Symbol } from '../apple/Ikon';
import { useDesign } from '../apple/design';
import { symbolFuer } from '../apple/symbole';

/** ein Emoji: Dorf = Text, Apple = Symbol (Screenreader lesen es dann nicht vor – es ist Schmuck) */
export function Em({ e }: { e: string }) {
  const design = useDesign();
  const name = design === 'apple' ? symbolFuer(e) : null;
  if (!name) return <>{e}</>;
  return <Symbol name={name} />;
}

/** „📈 Sparplan“ – führendes Emoji in Apple als Symbol, Rest als Text; im Dorf-Design unverändert der ganze Text */
export function EmText({ t }: { t: string }) {
  const design = useDesign();
  if (design !== 'apple') return <>{t}</>;
  const m = /^(\S+)\s+(.*)$/s.exec(t);
  const name = m ? symbolFuer(m[1]!) : null;
  if (!m || !name) {
    // unbekanntes Emoji vorne: in Apple weglassen, wenn es nur Schmuck ist (Bildzeichen), sonst Text lassen
    return m && /\p{Extended_Pictographic}/u.test(m[1]!) ? <>{m[2]}</> : <>{t}</>;
  }
  return (
    <>
      <Symbol name={name} /> {m[2]}
    </>
  );
}
