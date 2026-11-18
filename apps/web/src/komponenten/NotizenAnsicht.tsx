import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

/** E95 in der App: die Tagesnotizen der letzten 7 Tage und ein Feld für die nächste */
type Tag = { tag: string; pfad: string; zeilen: string[] };
const tagText = (t: string) => new Date(`${t}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function NotizenAnsicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notizen', 7], queryFn: () => api<Tag[]>('/api/notizen?tage=7') });
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const speichern = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler('');
    try {
      await api('/api/notiz', { body: { text: text.trim() } });
      setText('');
      await qc.invalidateQueries({ queryKey: ['notizen'] });
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    }
  };
  return (
    <section className="notizen" aria-label="Notizen">
      <form className="heute-neu" onSubmit={(e) => void speichern(e)} aria-label="Neue Notiz">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Gedanke, Idee, Beobachtung …" maxLength={2000} aria-label="Neue Notiz" enterKeyHint="done" />
        <button type="submit" className="haupt" aria-label="Notiz speichern">
          +
        </button>
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
      <p className="leise">Auch per Telegram (/notiz oder „notiz: …“) und in der Befehlspalette. Jeder Tag ist eine Datei in Rathaus/notizen/.</p>
      {q.data && !q.data.length && <p className="leise">In den letzten 7 Tagen keine Notizen.</p>}
      {q.data?.map((t) => (
        <div key={t.tag} className="notizen-tag">
          <h3>
            <a href={bibliothekUrl(t.pfad)} onClick={linkKlick}>
              {tagText(t.tag)}
            </a>
          </h3>
          <ul>
            {t.zeilen.map((z, i) => (
              <li key={i}>
                <span className="notizen-zeit">{z.slice(2, 7)}</span> {z.slice(8)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
