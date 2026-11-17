import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';

/**
 * CodeMirror-Editor für Markdown. Strg/Cmd+S speichert.
 * `wert` ist nur der Startwert: Von außen wird der Text nie ersetzt (neu laden = Komponente mit neuem key).
 */
export function Editor({ wert, beiAenderung, beiSpeichern }: { wert: string; beiAenderung: (t: string) => void; beiSpeichern: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const rueckrufe = useRef({ beiAenderung, beiSpeichern });
  rueckrufe.current = { beiAenderung, beiSpeichern };

  useEffect(() => {
    view.current = new EditorView({
      doc: wert,
      parent: box.current!,
      extensions: [
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (rueckrufe.current.beiSpeichern(), true) }]),
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) rueckrufe.current.beiAenderung(u.state.doc.toString());
        }),
      ],
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={box} />;
}
