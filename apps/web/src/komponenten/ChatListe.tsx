import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatInfo } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { laufStatusText, zeitKurz } from '../texte';

export function ChatListe({ gebaeude }: { gebaeude?: string }) {
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (gebaeude) params.set('gebaeude', gebaeude);
  if (q.trim()) params.set('q', q.trim());
  const chats = useQuery({ queryKey: ['chats', gebaeude ?? '', q.trim()], queryFn: () => api<ChatInfo[]>(`/api/chats?${params}`) });
  return (
    <div className="chat-uebersicht">
      <input type="search" placeholder="Chats durchsuchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chats durchsuchen" />
      {chats.data?.length === 0 && <p className="leise">Noch keine Chats.</p>}
      <ul className="chatliste chats">
        {chats.data?.map((c) => (
          <li key={c.id}>
            <a href={`/chats/${c.id}`} onClick={linkKlick}>
              {c.titel}
            </a>
            <div className="leise">
              {!gebaeude && `${c.gebaeude} · `}
              {zeitKurz(c.geaendert)} · {c.motor}
              {c.status && c.status !== 'fertig' && <span className={`lauf-chip ${c.status}`}> {laufStatusText(c.status)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
