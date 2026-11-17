import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatDetail, ChatNachricht, LaufInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { useLiveText } from '../live';
import { Markdown } from '../komponenten/Markdown';
import { laufStatusText, stufeText } from '../texte';

export function ChatSeite({ id }: { id: string }) {
  const qc = useQueryClient();
  const chat = useQuery({ queryKey: ['chat', id], queryFn: () => api<ChatDetail>(`/api/chats/${id}`) });
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState('');
  const unten = useRef<HTMLDivElement>(null);
  const aktiv = chat.data?.laeufe.find((l) => ['wartend', 'laeuft', 'wartet_freigabe'].includes(l.status));
  const live = useLiveText(aktiv?.status === 'laeuft' ? aktiv.id : undefined);

  useEffect(() => {
    unten.current?.scrollIntoView({ block: 'end' });
  }, [chat.data?.nachrichten.length, live.length > 0]);

  if (chat.isPending) return <p>Lade Chat …</p>;
  if (chat.isError) return <p className="fehler">{chat.error.message}</p>;
  const c = chat.data;

  const senden = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler('');
    try {
      await api(`/api/chats/${id}/nachricht`, { body: { text } });
      setText('');
      await qc.invalidateQueries({ queryKey: ['chat', id] });
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    }
  };

  return (
    <section className="chat">
      <a href={`/gebaeude/${encodeURIComponent(c.gebaeude)}?reiter=chats`} onClick={linkKlick} className="zurueck">
        ← {c.gebaeude}
      </a>
      <h1>{c.titel}</h1>
      {c.elternChatId && (
        <p className="leise">
          Helfer des{' '}
          <a href={`/chats/${c.elternChatId}`} onClick={linkKlick}>
            Bürgermeisters
          </a>
          {c.planId ? ' (aus einem Plan)' : ''}
        </p>
      )}
      <p className="leise">
        {c.motor} · {c.modell} ({stufeText(c.stufe)})
        {c.spiegelPfad && (
          <>
            {' · '}
            <a href={bibliothekUrl(c.spiegelPfad)} onClick={linkKlick}>
              Chat im Vault
            </a>
          </>
        )}
        {c.protokollPfad && (
          <>
            {' · '}
            <a href={bibliothekUrl(c.protokollPfad)} onClick={linkKlick}>
              Protokoll
            </a>
          </>
        )}
      </p>

      <div className="nachrichten">
        {c.nachrichten.map((n) => (
          <Nachricht key={n.id} n={n} />
        ))}
        {aktiv && (
          <div className="nachricht agent laufend">
            <LaufKopf l={aktiv} />
            {live ? <Markdown inhalt={live} pfad="" /> : <p className="leise">{aktiv.status === 'laeuft' ? 'Der Agent arbeitet …' : laufStatusText(aktiv.status)}</p>}
          </div>
        )}
        <div ref={unten} />
      </div>

      <div className="laeufe leise">
        {c.laeufe.map((l) => (
          <span key={l.id} className={`lauf-chip ${l.status}`} title={l.fehler ?? ''}>
            Lauf {l.nummer}: {laufStatusText(l.status)} · {l.einToken + l.cacheLesen + l.cacheSchreiben} ein / {l.ausToken} aus
            {l.motor === 'api' && l.kostenUsd > 0 ? ` · ~${l.kostenUsd.toFixed(3)} $` : ''}
          </span>
        ))}
      </div>

      <form className="chat-eingabe" onSubmit={senden}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={aktiv ? 'Warte, bis der Agent fertig ist …' : 'Weiter im Gespräch …'}
          disabled={!!aktiv}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void senden(e);
          }}
        />
        <div className="werkzeuge">
          <button type="submit" className="haupt" disabled={!!aktiv || !text.trim()}>
            Senden
          </button>
          {aktiv && (
            <button type="button" className="gefahr" onClick={() => api(`/api/laeufe/${aktiv.id}/abbrechen`, { body: {} }).catch((e: Error) => setFehler(e.message))}>
              Abbrechen
            </button>
          )}
          <span className="leise">Strg/Cmd + Enter sendet</span>
        </div>
        {fehler && <p className="fehler">{fehler}</p>}
      </form>
    </section>
  );
}

function LaufKopf({ l }: { l: LaufInfo }) {
  return (
    <div className="leise lauf-kopf">
      Lauf {l.nummer} · {laufStatusText(l.status)} · {l.motor} · {l.modell}
    </div>
  );
}

function Nachricht({ n }: { n: ChatNachricht }) {
  if (n.rolle === 'werkzeug')
    return (
      <details className="nachricht werkzeug">
        <summary>🔧 Werkzeuge</summary>
        <pre>{n.text}</pre>
      </details>
    );
  if (n.rolle === 'agent' && !n.text.trim()) return null;
  return (
    <div className={`nachricht ${n.rolle}`}>
      {n.rolle === 'nutzer' ? (
        <p className="nutzertext">{n.text}</p>
      ) : n.rolle === 'hinweis' ? (
        <div className="hinweis">
          <Markdown inhalt={n.text} pfad="" />
        </div>
      ) : (
        <Markdown inhalt={n.text} pfad="" />
      )}
      <div className="leise zeit">{new Date(n.erstellt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
    </div>
  );
}
