import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatDetail, ChatNachricht, DateiKarte, LaufInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { useLiveText } from '../live';
import { Markdown } from '../komponenten/Markdown';
import { laufStatusText, stufeText } from '../texte';
import { AnhangWahl, DateiKarten, DateiOeffnenKontext, dateienAus, dateienHinzufuegen, nachrichtTeilen } from '../komponenten/Anhaenge';
import { DateiSeitenleiste } from '../komponenten/DateiSeitenleiste';

/** `eingebettet` (E197): als Seitenleiste im Editor – ohne Rücksprung und Kopfzeilen */
export function ChatSeite({ id, eingebettet }: { id: string; eingebettet?: boolean }) {
  const qc = useQueryClient();
  const chat = useQuery({ queryKey: ['chat', id], queryFn: () => api<ChatDetail>(`/api/chats/${id}`) });
  const [text, setText] = useState('');
  const [dateien, setDateien] = useState<File[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [ziehen, setZiehen] = useState(false);
  const [fehler, setFehler] = useState('');
  // Datei in der Seitenleiste (nur in der vollen Chat-Seite; eingebettet – z. B. im Editor – bleibt es beim neuen Tab)
  const [seite, setSeite] = useState<DateiKarte | null>(null);
  const seiteSchliessen = useCallback(() => setSeite(null), []);
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
    if (!text.trim() && !dateien.length) return;
    setFehler('');
    // Feld sofort leeren (E187): Leif tippt gleich die nächste Nachricht – die darf die Antwort des Servers nicht wegwischen
    const gesendet = text;
    const mit = dateien;
    setText('');
    setDateien([]);
    try {
      if (mit.length) {
        // E190: Dateien gehen mit (multipart) – auch während ein Lauf läuft (dann in die Warteschlange)
        setLaedt(true);
        const f = new FormData();
        f.append('text', gesendet);
        for (const d of mit) f.append('datei', d, d.name);
        await api(`/api/chats/${id}/nachricht`, { formular: f });
      } else await api(`/api/chats/${id}/nachricht`, { body: { text: gesendet } });
      await qc.invalidateQueries({ queryKey: ['chat', id] });
    } catch (err) {
      setText((jetzt) => jetzt || gesendet);
      setDateien((jetzt) => (jetzt.length ? jetzt : mit));
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    } finally {
      setLaedt(false);
    }
  };
  const laufVon = new Map(c.laeufe.map((l) => [l.id, l]));
  // erzeugte Dateien eines Laufs nach seiner letzten Nachricht zeigen
  const letzteJeLauf = new Map<string, number>();
  for (const n of c.nachrichten) if (n.laufId) letzteJeLauf.set(n.laufId, n.id);

  return (
    <DateiOeffnenKontext.Provider value={eingebettet ? null : setSeite}>
    {seite && !eingebettet && <DateiSeitenleiste datei={seite} schliessen={seiteSchliessen} />}
    <section
      className={`chat${ziehen ? ' ziehen' : ''}${eingebettet ? ' eingebettet' : ''}${seite && !eingebettet ? ' mit-seitenleiste' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setZiehen(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setZiehen(false);
      }}
      onDrop={(e) => {
        const neu = dateienAus(e.dataTransfer);
        setZiehen(false);
        if (!neu.length) return;
        e.preventDefault();
        dateienHinzufuegen(dateien, neu, setDateien, setFehler);
      }}
    >
      {eingebettet ? (
        <p className="leise">
          <a href={`/chats/${id}`} onClick={linkKlick}>
            {c.titel}
          </a>
        </p>
      ) : (
        <>
          <a href={`/gebaeude/${encodeURIComponent(c.gebaeude)}?reiter=chats`} onClick={linkKlick} className="zurueck">
            ← {c.gebaeude}
          </a>
          <h1>{c.titel}</h1>
        </>
      )}
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
        {c.nachrichten.map((n) => {
          const l = n.laufId ? laufVon.get(n.laufId) : undefined;
          const istLetzte = !!n.laufId && letzteJeLauf.get(n.laufId) === n.id;
          return (
            <Fragment key={n.id}>
              <Nachricht n={n} anhaenge={n.rolle === 'nutzer' ? l?.anhaenge : undefined} />
              {istLetzte && l?.dateien?.length ? (
                <div className="nachricht agent erzeugt">
                  <DateiKarten karten={l.dateien} titel="📂 Erzeugte Dateien" />
                </div>
              ) : null}
            </Fragment>
          );
        })}
        {aktiv && (
          <div className="nachricht agent laufend">
            <LaufKopf l={aktiv} />
            {live ? <Markdown inhalt={live} pfad="" /> : <p className="leise">{aktiv.status === 'laeuft' ? 'Der Agent arbeitet …' : laufStatusText(aktiv.status)}</p>}
          </div>
        )}
        {/* E185: nachgeschobene Nachrichten warten sichtbar, bis der aktuelle Schritt fertig ist */}
        {(c.wartend ?? []).map((w) => (
          <div key={`w${w.id}`} className="nachricht nutzer wartend">
            <div className="leise">
              ⏳ wartet – kommt nach dem aktuellen Schritt dran{' '}
              <button
                type="button"
                className="klein"
                title="Diese Nachricht doch nicht schicken"
                aria-label="Wartende Nachricht entfernen"
                onClick={() =>
                  api(`/api/chats/${id}/wartend/${w.id}`, { methode: 'DELETE' })
                    .then(() => qc.invalidateQueries({ queryKey: ['chat', id] }))
                    .catch((e: Error) => setFehler(e.message))
                }
              >
                ✕
              </button>
            </div>
            <p className="nutzertext">{w.text}</p>
            {w.anhaenge && <DateiKarten karten={w.anhaenge} />}
          </div>
        ))}
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
          onPaste={(e) => {
            // E190: Bildschirmfoto oder kopierte Datei einfügen (Strg/Cmd + V)
            const neu = dateienAus(e.clipboardData);
            if (!neu.length) return;
            e.preventDefault();
            dateienHinzufuegen(dateien, neu, setDateien, setFehler);
          }}
          placeholder={aktiv ? 'Noch etwas vergessen? Schreib es dazu – es kommt nach dem aktuellen Schritt dran …' : 'Weiter im Gespräch …'}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void senden(e);
          }}
        />
        <div className="werkzeuge">
          <button type="submit" className="haupt" disabled={laedt || (!text.trim() && !dateien.length)}>
            {laedt ? 'Lade hoch …' : aktiv ? 'Dazuschreiben' : 'Senden'}
          </button>
          <AnhangWahl dateien={dateien} setDateien={setDateien} setFehler={setFehler} />
          {aktiv && (
            <button type="button" className="gefahr" onClick={() => api(`/api/laeufe/${aktiv.id}/abbrechen`, { body: {} }).catch((e: Error) => setFehler(e.message))}>
              Abbrechen
            </button>
          )}
          <span className="leise">Strg/Cmd + Enter sendet · Dateien hineinziehen oder einfügen (je bis 25 MB)</span>
        </div>
        {fehler && <p className="fehler">{fehler}</p>}
      </form>
    </section>
    </DateiOeffnenKontext.Provider>
  );
}

function LaufKopf({ l }: { l: LaufInfo }) {
  return (
    <div className="leise lauf-kopf">
      Lauf {l.nummer} · {laufStatusText(l.status)} · {l.motor} · {l.modell}
    </div>
  );
}

function Nachricht({ n, anhaenge }: { n: ChatNachricht; anhaenge?: DateiKarte[] }) {
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
        <NutzerText text={n.text} />
      ) : n.rolle === 'hinweis' ? (
        <div className="hinweis">
          <Markdown inhalt={n.text} pfad="" />
        </div>
      ) : (
        <Markdown inhalt={n.text} pfad="" />
      )}
      {anhaenge?.length ? <DateiKarten karten={anhaenge} /> : null}
      <div className="leise zeit">{new Date(n.erstellt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
    </div>
  );
}

/** E190: Was der Agent an Anhang-Inhalt mitbekommen hat, steht eingeklappt unter Leifs Text */
function NutzerText({ text }: { text: string }) {
  const [vorne, hinten] = nachrichtTeilen(text);
  return (
    <>
      <p className="nutzertext">{vorne}</p>
      {hinten && (
        <details className="anhang-inhalt">
          <summary className="leise">Anhänge, wie der Agent sie sieht</summary>
          <pre>{hinten}</pre>
        </details>
      )}
    </>
  );
}
