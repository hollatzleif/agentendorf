// E245: „Letzte Chats“ in der Kopfleiste (Dorf und Apple) – beim Überfahren (oder Antippen) die 5 Chats, in denen Leif zuletzt
// geschrieben oder ein Modell geantwortet hat, über alle Gebäude (auch Bürgermeister); ein Klick springt in den Chat.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LetzterChat } from '@dorf/shared';
import { api } from '../api';
import { navigieren } from '../router';
import { laufStatusText } from '../texte';

function vor(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'gerade';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86_400) return `vor ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
}

export function LetzteChats({ variante, kinder }: { variante: 'dorf' | 'apple'; kinder: React.ReactNode }) {
  const [offen, setOffen] = useState(false);
  const zu = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // „chats“ im Schlüssel: Live-Ereignisse (chat.geaendert, lauf.status) laden die Liste neu
  const q = useQuery({ queryKey: ['chats', 'letzte'], queryFn: () => api<LetzterChat[]>('/api/chats/letzte?anzahl=5'), staleTime: 15_000 });
  // Überfahren öffnet nur mit echter Maus – auf Touch-Geräten löst ein Tippen irgendwo sonst „mouseenter“ aus und die Liste
  // legte sich über die Seite; dort öffnet nur das Antippen des Knopfs
  const hover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const oeffnen = () => {
    if (zu.current) clearTimeout(zu.current);
    setOffen(true);
  };
  const spaeterZu = () => {
    if (zu.current) clearTimeout(zu.current);
    zu.current = setTimeout(() => setOffen(false), 180);
  };
  useEffect(() => {
    if (!offen) return;
    const weg = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOffen(false);
    };
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && setOffen(false);
    document.addEventListener('pointerdown', weg);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('pointerdown', weg);
      document.removeEventListener('keydown', taste);
    };
  }, [offen]);
  const liste = q.data ?? [];
  return (
    <div className={`letzte-chats letzte-chats-${variante}`} ref={box} onMouseEnter={hover ? oeffnen : undefined} onMouseLeave={hover ? spaeterZu : undefined} data-testid="letzte-chats">
      <button
        type="button"
        className={variante === 'apple' ? 'a-glasknopf' : `letzte-chats-knopf${offen ? ' aktiv' : ''}`}
        aria-haspopup="menu"
        aria-expanded={offen}
        title="Letzte Chats"
        aria-label="Letzte Chats"
        onClick={() => (hover ? oeffnen() : offen ? setOffen(false) : oeffnen())}
        onFocus={hover ? oeffnen : undefined}
      >
        {kinder}
      </button>
      {offen && (
        <div className="letzte-chats-liste" role="menu" aria-label="Letzte Chats" onMouseEnter={oeffnen}>
          {q.isLoading ? (
            <p className="leise">Lade …</p>
          ) : !liste.length ? (
            <p className="leise">Noch keine Chats.</p>
          ) : (
            liste.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className="letzte-chats-eintrag"
                data-testid="letzter-chat"
                onClick={() => {
                  setOffen(false);
                  navigieren(`/chats/${encodeURIComponent(c.id)}`);
                }}
              >
                <span className="letzte-chats-kopf">
                  <span className="letzte-chats-gebaeude">{c.gebaeude}</span>
                  <span className="leise">
                    {vor(c.zuletzt)}
                    {c.status === 'laeuft' || c.status === 'wartend' ? ` · ${laufStatusText(c.status)}` : ''}
                  </span>
                </span>
                <span className="letzte-chats-titel">{c.titel}</span>
                <span className="letzte-chats-vorschau leise">
                  {c.von === 'nutzer' ? 'Du: ' : ''}
                  {c.vorschau}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
