import { useEffect, useRef, useState } from 'react';
import { api, ApiFehler, offlineGemerkt } from '../api';
import { istProgramm, schnellSchliessen } from './desktop';

type Ziel = 'buergermeister' | 'todo';

/**
 * Schnelleingabe (Etappe 6): kleines Fenster, das das Desktop-Programm per Tastenkürzel öffnet – auch im Browser
 * unter /schnell nutzbar. Enter schickt ab, Umschalt+Enter macht eine neue Zeile, Esc schließt.
 */
export function Schnelleingabe() {
  const [text, setText] = useState('');
  const [ziel, setZiel] = useState<Ziel>(() => (localStorage.getItem('dorf-schnell-ziel') === 'todo' ? 'todo' : 'buergermeister'));
  const [meldung, setMeldung] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const feld = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const fokus = () => feld.current?.focus();
    fokus();
    window.addEventListener('focus', fokus);
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void schnellSchliessen();
    };
    window.addEventListener('keydown', taste);
    return () => {
      window.removeEventListener('focus', fokus);
      window.removeEventListener('keydown', taste);
    };
  }, []);

  const waehlen = (z: Ziel) => {
    setZiel(z);
    localStorage.setItem('dorf-schnell-ziel', z);
    feld.current?.focus();
  };

  const abschicken = async () => {
    const t = text.trim();
    if (!t || laeuft) return;
    setLaeuft(true);
    setMeldung('');
    try {
      if (ziel === 'todo') await api('/api/todos', { body: { titel: t.split('\n')[0]!.slice(0, 200), ...(t.includes('\n') ? { notiz: t.split('\n').slice(1).join('\n') } : {}) } });
      else await api('/api/schreibtisch', { body: { text: t } });
      setText('');
      setMeldung(ziel === 'todo' ? '✓ Auf der To-do-Liste' : '✓ Beim Bürgermeister');
      if (istProgramm()) setTimeout(() => void schnellSchliessen().then(() => setMeldung('')), 700);
    } catch (e) {
      if (offlineGemerkt(e)) {
        setText('');
        setMeldung(`📶 ${(e as ApiFehler).message}`);
      } else setMeldung(`⚠️ ${e instanceof ApiFehler ? e.message : String(e)}`);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <main className="schnell">
      <form
        aria-label="Schnelleingabe"
        onSubmit={(e) => {
          e.preventDefault();
          void abschicken();
        }}
      >
        <div className="schnell-ziele" role="radiogroup" aria-label="Wohin?">
          <button type="button" role="radio" aria-checked={ziel === 'buergermeister'} className={ziel === 'buergermeister' ? 'aktiv' : ''} onClick={() => waehlen('buergermeister')}>
            🎩 Bürgermeister
          </button>
          <button type="button" role="radio" aria-checked={ziel === 'todo'} className={ziel === 'todo' ? 'aktiv' : ''} onClick={() => waehlen('todo')}>
            🧺 To-do
          </button>
        </div>
        <textarea
          ref={feld}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void abschicken();
            }
          }}
          placeholder={ziel === 'todo' ? 'Was steht an? (Enter = auf die Liste)' : 'Aufgabe für den Bürgermeister (Enter = abschicken)'}
          aria-label="Text"
          maxLength={20_000}
        />
        <div className="schnell-fuss">
          <span className="leise">{meldung || 'Enter schickt ab · Umschalt+Enter neue Zeile · Esc schließt'}</span>
          <button type="submit" className="haupt" disabled={laeuft || !text.trim()}>
            Abschicken
          </button>
        </div>
      </form>
    </main>
  );
}
