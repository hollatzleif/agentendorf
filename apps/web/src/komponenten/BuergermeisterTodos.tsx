import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuergermeisterTodo, RundgangStand } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { zeitKurz } from '../texte';

const GEWICHT = { klein: '·', mittel: '··', gross: '···' } as const;

/**
 * E192: Die eigene To-do-Liste des Bürgermeisters (Rathaus/buergermeister-todos/) – was aus Aufträgen noch offen ist.
 * Leif sieht sie, hakt ab, wirft weg (Papierkorb) und kann ihm selbst etwas daraufsetzen. Darunter der Aktivitäten-Katalog
 * für den Rundgang (Einstellen in 00_Stadtordnung/rundgang.md; Fehler dort werden hier angezeigt).
 */
export function BuergermeisterTodos() {
  const qc = useQueryClient();
  // Schlüssel beginnt mit „schreibtisch“ → das Live-Ereignis schreibtisch.geaendert lädt auch diese Liste neu
  const q = useQuery({ queryKey: ['schreibtisch', 'bm-todos'], queryFn: () => api<{ todos: BuergermeisterTodo[]; rundgang: RundgangStand }>('/api/buergermeister/todos') });
  const [titel, setTitel] = useState('');
  const [fehler, setFehler] = useState('');
  const neuLaden = () => qc.invalidateQueries({ queryKey: ['schreibtisch', 'bm-todos'] });
  const tun = (p: Promise<unknown>) =>
    p
      .then(() => setFehler(''))
      .catch((e: unknown) => setFehler(e instanceof ApiFehler ? e.message : String(e)))
      .finally(() => void neuLaden());
  const offen = q.data?.todos.filter((t) => !t.erledigt) ?? [];
  const fertig = q.data?.todos.filter((t) => t.erledigt) ?? [];
  const r = q.data?.rundgang;

  return (
    <section className="bm-todos" aria-label="Eigene To-dos des Bürgermeisters">
      <h3>📋 Eigene To-dos des Bürgermeisters</h3>
      <p className="leise">
        Was aus deinen Aufträgen noch offen ist, hält er hier nach und arbeitet es beim Aufwachen zuerst ab. Die Einträge liegen in{' '}
        <a href={bibliothekUrl('Rathaus/buergermeister-todos')} onClick={linkKlick}>
          Rathaus/buergermeister-todos
        </a>
        .
      </p>
      <form
        className="todo-neu"
        onSubmit={(e) => {
          e.preventDefault();
          if (titel.trim().length < 3) return;
          void tun(api('/api/buergermeister/todos', { body: { titel: titel.trim() } }).then(() => setTitel('')));
        }}
      >
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Ihm etwas auf die Liste setzen, z. B. „Nachfassen: Antwort vom Prüfungsamt“" aria-label="Neues To-do für den Bürgermeister" />
        <button type="submit" disabled={titel.trim().length < 3} title="Auf seine Liste">
          +
        </button>
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
      {q.data && offen.length === 0 && <p className="leise">Nichts offen.</p>}
      <ul className="todo-liste">
        {[...offen, ...fertig.slice(0, 5)].map((t) => (
          <li key={t.pfad} className={`todo${t.erledigt ? ' fertig' : ''}`}>
            <label className="todo-haken">
              <input
                type="checkbox"
                checked={t.erledigt}
                aria-label={`${t.titel} ${t.erledigt ? 'wieder öffnen' : 'abhaken'}`}
                onChange={(e) => void tun(api('/api/buergermeister/todos/erledigt', { body: { pfad: t.pfad, erledigt: e.target.checked, version: t.version } }))}
              />
            </label>
            <div className="todo-text">
              <a className="todo-titel" href={bibliothekUrl(t.pfad)} onClick={linkKlick}>
                {t.titel}
              </a>
              <div className="todo-meta leise">
                {!t.erledigt && <span className={`lauf-chip ${t.faellig ? 'sd-plan_wartet' : 'sd-erledigt'}`}>{t.faellig ? 'fällig' : `wieder ansehen ${t.wiederAm}`}</span>}
                {t.chatId ? (
                  <a href={`/chats/${t.chatId}`} onClick={linkKlick}>
                    {t.bezug?.replace(/\s*\(\[\[.*\]\]\)/, '') ?? 'Chat'}
                  </a>
                ) : (
                  t.bezug && <span>{t.bezug}</span>
                )}
                {t.quelle && t.quelle !== 'Bürgermeister' && <span>von: {t.quelle}</span>}
                {t.erstellt && <span>{zeitKurz(t.erstellt)}</span>}
                <button className="klein" title="In den Papierkorb" onClick={() => void tun(api('/api/buergermeister/todos/loeschen', { body: { pfad: t.pfad } }))}>
                  🗑
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {r && (
        <details className="bm-rundgang">
          <summary>
            🧭 Rundgang: {r.aktivitaeten.filter((a) => a.aktiv).length} von {r.aktivitaeten.length} Aktivitäten an, höchstens {r.jeRundgang} je Rundgang
            {r.fehler ? ' – ⚠️ Fehler in rundgang.md' : ''}
          </summary>
          {r.fehler && <p className="fehler">00_Stadtordnung/rundgang.md: {r.fehler}</p>}
          <p className="leise">
            Das Dorf wählt je Rundgang die fälligsten Aktivitäten, für die es einen Anlass findet und die ins Tagesbudget passen. An- und abschalten in{' '}
            <a href={bibliothekUrl('00_Stadtordnung/rundgang.md')} onClick={linkKlick}>
              00_Stadtordnung/rundgang.md
            </a>
            ; was er getan hat, steht in{' '}
            <a href={bibliothekUrl('Rathaus/rundgang')} onClick={linkKlick}>
              Rathaus/rundgang
            </a>
            .
          </p>
          <ul className="chatliste">
            {r.aktivitaeten.map((a) => (
              <li key={a.id} className={a.aktiv ? '' : 'leise'}>
                <b>{a.titel}</b> <span className="leise">({a.gruppe})</span>
                <div className="leise">
                  {a.aktiv ? a.haeufigkeit : 'aus'} · Kosten {GEWICHT[a.gewicht]}{r.kosten ? ` (≈ ${r.kosten[a.gewicht].toFixed(2).replace('.', ',')} $)` : ''} · {a.nachts ? 'auch nachts' : 'nur tagsüber'} · {a.zuletzt ? `zuletzt ${zeitKurz(a.zuletzt)}` : 'noch nie'} · <code>{a.id}</code>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
