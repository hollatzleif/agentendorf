import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PostUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';

const KATEGORIEN = ['Uni', 'Corps', 'Finanzen', 'Persönlich', 'Termine', 'Newsletter', 'Werbung', 'Sonstiges'];
const zeit = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Post: eingeordnete Mails (nur Kurzfassungen – die Mails selbst bleiben in Gmail) */
/** fest: nur diese Kategorie zeigen (z. B. „Corps“ im Corpshaus) – ohne Auswahl */
export function PostEingang({ fest }: { fest?: string } = {}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['post'], queryFn: () => api<PostUebersicht>('/api/post'), refetchInterval: (x) => (x.state.data?.laeuft ? 3000 : 60_000) });
  const [kategorieWahl, setKategorie] = useState('');
  const kategorie = fest ?? kategorieWahl;
  const [nurWichtig, setNurWichtig] = useState(false);
  const [fehler, setFehler] = useState('');
  if (!q.data) return <p className="leise">Lade …</p>;
  const p = q.data;
  const mails = p.mails.filter((m) => (!kategorie || m.kategorie === kategorie) && (!nurWichtig || m.wichtig));

  const abholen = async () => {
    setFehler('');
    try {
      await api('/api/post/abholen', { body: {} });
      await qc.invalidateQueries({ queryKey: ['post'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  if (!p.verbunden)
    return (
      <p>
        Gmail ist noch nicht verbunden. Auf dem Server: <code>dorf gmail-anmelden</code> (Anleitung in EINRICHTUNG.md, Abschnitt Post).
      </p>
    );

  return (
    <div className="post">
      <div className="zeile">
        <button onClick={() => void abholen()} disabled={p.laeuft}>
          {p.laeuft ? 'Hole ab …' : 'Jetzt abholen'}
        </button>
        <span className="leise">
          {p.letzter
            ? `Zuletzt: ${zeit.format(new Date(p.letzter.zeit))}${p.letzter.ok ? ` – ${p.letzter.neu} neu, ${p.letzter.eingeordnet} eingeordnet` : ''}`
            : 'Noch nicht abgeholt.'}{' '}
          Automatisch alle 10 Minuten.
        </span>
      </div>
      {p.letzter && !p.letzter.ok && <p className="fehler">Fehler: {p.letzter.fehler}</p>}
      {!p.einordnungMoeglich && <p className="fehler">Ohne API-Schlüssel werden Mails nur abgeholt, nicht eingeordnet (dorf api-schluessel).</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      <div className="zeile">
        {!fest && (
          <select value={kategorie} onChange={(e) => setKategorie(e.target.value)} aria-label="Kategorie">
            <option value="">Alle Kategorien</option>
            {KATEGORIEN.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        )}
        <label className="haken">
          <input type="checkbox" checked={nurWichtig} onChange={(e) => setNurWichtig(e.target.checked)} /> nur wichtige
        </label>
      </div>
      {mails.length === 0 ? (
        <p className="leise">Keine Mails.</p>
      ) : (
        <ul className="mailliste">
          {mails.map((m) => (
            <li key={m.id} className={m.wichtig ? 'wichtig' : ''}>
              <div className="kopf">
                <span className="leise">{zeit.format(new Date(m.datum))}</span> {m.wichtig && '⭐'}{' '}
                <span className="abzeichen">{m.kategorie ?? 'wartet'}</span> {m.antwortNoetig && <span className="abzeichen brief">Antwort nötig</span>}{' '}
                {m.frist && <span className="abzeichen">Frist {m.frist}</span>}
              </div>
              <div>
                <strong>{m.betreff}</strong> <span className="leise">– {m.von}</span>
              </div>
              {m.zusammenfassung && <div>{m.zusammenfassung}</div>}
              <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.threadId)}`} target="_blank" rel="noopener noreferrer">
                In Gmail öffnen
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
