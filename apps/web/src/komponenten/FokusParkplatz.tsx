import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { todoAusText } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * E148: Gedanken parken – was während des Fokus dazwischenfunkt („Mail an Prof.“, „Milch kaufen“), kommt mit einem
 * Enter in die Tagesnotiz und ist aus dem Kopf. Die geparkten Gedanken dieser Sitzung stehen darunter; in der Pause
 * (oder danach) wird mit „→ To-do“ eine Aufgabe daraus. Gemerkt je Gerät in sessionStorage, damit ein Neuladen sie nicht verliert.
 */
const SCHLUESSEL = 'dorf-fokus-geparkt';

interface Geparkt {
  text: string;
  todo?: boolean;
}

function laden(): Geparkt[] {
  try {
    const x = JSON.parse(sessionStorage.getItem(SCHLUESSEL) ?? '[]') as unknown;
    return Array.isArray(x) ? (x as Geparkt[]).filter((g) => typeof g?.text === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}

export function FokusParkplatz({ arbeit }: { arbeit: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [liste, setListeRoh] = useState<Geparkt[]>(laden);
  const [fehler, setFehler] = useState('');
  const setListe = (n: Geparkt[]) => {
    setListeRoh(n);
    sessionStorage.setItem(SCHLUESSEL, JSON.stringify(n));
  };
  const parken = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setFehler('');
    try {
      await api('/api/notiz', { body: { text: `💭 ${t}` } });
      setListe([...liste, { text: t }].slice(-20));
      setText('');
    } catch (e2) {
      setFehler(e2 instanceof ApiFehler ? e2.message : String(e2));
    }
  };
  const zumTodo = async (i: number) => {
    setFehler('');
    try {
      const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      await api('/api/todos', { body: todoAusText(liste[i]!.text, heute) });
      setListe(liste.map((g, j) => (j === i ? { ...g, todo: true } : g)));
      await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
    } catch (e2) {
      setFehler(e2 instanceof ApiFehler ? e2.message : String(e2));
    }
  };
  return (
    <div className="fokus-parkplatz" role="group" aria-label="Gedanken parken">
      <form onSubmit={(e) => void parken(e)}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="💭 Gedanke dazwischen? Hier parken – Enter, weiter geht's" aria-label="Gedanke parken" />
      </form>
      {liste.length > 0 && (
        <ul>
          {liste.map((g, i) => (
            <li key={i}>
              <span>💭 {g.text}</span>
              {g.todo ? (
                <span className="leise">✓ To-do</span>
              ) : (
                !arbeit && (
                  <button type="button" className="klein" onClick={() => void zumTodo(i)} aria-label={`${g.text} als To-do`}>
                    → To-do
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {liste.length > 0 && !arbeit && (
        <button type="button" className="klein leise" onClick={() => setListe([])}>
          Liste leeren (Notizen bleiben)
        </button>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}
