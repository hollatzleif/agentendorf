import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SchreibtischAufgabe, SchreibtischStatus } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { zeitKurz } from '../texte';

export const SCHREIBTISCH_STATUS: Record<SchreibtischStatus, string> = {
  neu: 'neu – noch nicht bearbeitet',
  in_arbeit: 'Bürgermeister arbeitet',
  plan_wartet: 'Plan wartet auf dich',
  helfer_laufen: 'Helfer arbeiten',
  erledigt: 'erledigt',
  beantwortet: 'beantwortet',
  abgelehnt: 'Plan abgelehnt',
  fehler: 'Fehler',
};
const QUELLE = { app: '💻', telegram: '📱', vault: '📝' } as const;

/** Schreibtisch des Bürgermeisters: Aufgabe hinlegen (Text + Dateien), Liste mit Status. */
export function Schreibtisch() {
  const qc = useQueryClient();
  const liste = useQuery({ queryKey: ['schreibtisch'], queryFn: () => api<SchreibtischAufgabe[]>('/api/schreibtisch') });
  const [text, setText] = useState('');
  const [dateien, setDateien] = useState<File[]>([]);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);

  const ablegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaeuft(true);
    setFehler('');
    try {
      const f = new FormData();
      f.append('text', text);
      for (const d of dateien) f.append('datei', d, d.name);
      await api('/api/schreibtisch', { formular: f });
      setText('');
      setDateien([]);
      if (eingabe.current) eingabe.current.value = '';
      await qc.invalidateQueries({ queryKey: ['schreibtisch'] });
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div>
      <form className="formspalte breit" onSubmit={ablegen}>
        <label>
          Neue Aufgabe für den Bürgermeister
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Was soll erledigt werden? Einfache Fragen beantwortet er direkt, für größere Aufgaben legt er dir einen Plan vor."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ablegen(e);
            }}
          />
        </label>
        <div className="werkzeuge">
          <input ref={eingabe} type="file" multiple onChange={(e) => setDateien(Array.from(e.target.files ?? []))} aria-label="Dateien anhängen" />
          <button type="submit" className="haupt" disabled={laeuft || (!text.trim() && !dateien.length)}>
            {laeuft ? 'Lege hin …' : 'Auf den Schreibtisch'}
          </button>
        </div>
        {fehler && <p className="fehler">{fehler}</p>}
      </form>

      <h3>Auf dem Schreibtisch</h3>
      {liste.data?.length === 0 && <p className="leise">Leer. Du kannst Aufgaben auch per Telegram an den Dorf-Bot schicken.</p>}
      <ul className="chatliste">
        {liste.data?.map((a) => (
          <li key={a.id}>
            <span title={a.quelle}>{QUELLE[a.quelle]}</span>{' '}
            {a.chatId ? (
              <a href={`/chats/${a.chatId}`} onClick={linkKlick}>
                {a.titel}
              </a>
            ) : (
              <a href={bibliothekUrl(a.pfad)} onClick={linkKlick}>
                {a.titel}
              </a>
            )}
            <div className="leise">
              {zeitKurz(a.erstellt)} · <span className={`lauf-chip sd-${a.status}`}>{SCHREIBTISCH_STATUS[a.status]}</span>
              {a.planId && (
                <>
                  {' · '}
                  <a href="/gebaeude/Rathaus?reiter=plaene" onClick={linkKlick}>
                    Plan
                  </a>
                </>
              )}
              {a.status === 'neu' && !a.chatId && (
                <button
                  className="klein"
                  onClick={() =>
                    api(`/api/schreibtisch/${a.id}/bearbeiten`, { body: {} })
                      .then(() => qc.invalidateQueries({ queryKey: ['schreibtisch'] }))
                      .catch((e: Error) => setFehler(e.message))
                  }
                >
                  Bearbeiten lassen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
