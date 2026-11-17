import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UniFrist, UniUebersicht as Daten } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const TAG = 86_400_000;
const zeit = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const zeitText = (iso: string | null) => (iso ? zeit.format(new Date(iso)) : '–');
const ART: Record<UniFrist['art'], string> = { abgabe: 'Abgabe', test: 'Test', termin: 'Termin' };

function restText(iso: string | null) {
  if (!iso) return 'ohne Frist';
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return 'vorbei';
  const tage = Math.floor(ms / TAG);
  if (tage >= 1) return `noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'}`;
  const std = Math.floor(ms / 3_600_000);
  return std >= 1 ? `noch ${std} Std.` : 'gleich';
}

/** Uni-Startseite: Fristen, Kurse, Moodle-Abgleich */
export function UniUebersicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['uni'], queryFn: () => api<Daten>('/api/uni'), refetchInterval: (x) => (x.state.data?.laeuft ? 3000 : 60_000) });
  const [fehler, setFehler] = useState('');
  const [neuesFach, setNeuesFach] = useState('');
  if (!q.data) return <p className="leise">Lade …</p>;
  const u = q.data;
  const l = u.letzter;

  const abgleichen = async () => {
    setFehler('');
    try {
      await api('/api/uni/abgleichen', { body: {} });
      await qc.invalidateQueries({ queryKey: ['uni'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  const erledigt = async (id: string, wert: boolean) => {
    setFehler('');
    // sofort umschalten, der Server bestätigt danach (bei Fehler holt invalidate den echten Stand)
    qc.setQueryData<Daten>(['uni'], (alt) => (alt ? { ...alt, fristen: alt.fristen.map((f) => (f.id === id ? { ...f, abgegeben: wert } : f)) } : alt));
    try {
      await api('/api/uni/fristen/erledigt', { body: { id, erledigt: wert } });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await qc.invalidateQueries({ queryKey: ['uni'] });
  };

  const fachAnlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler('');
    try {
      await api('/api/uni/fach', { body: { name: neuesFach } });
      setNeuesFach('');
      await qc.invalidateQueries({ queryKey: ['uni'] });
      await qc.invalidateQueries({ queryKey: ['aktion-quellen'] });
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    }
  };

  return (
    <div className="uni">
      <h2>Fristen</h2>
      {u.fristen.length === 0 ? (
        <p className="leise">{u.verbunden ? 'Keine Fristen in den nächsten Wochen.' : 'Noch keine Fristen – siehe „Moodle“ unten.'}</p>
      ) : (
        <table className="tabelle fristen">
          <thead>
            <tr>
              <th>Wann</th>
              <th>Was</th>
              <th>Fach</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {u.fristen.map((f) => {
              const rest = f.frist ? Date.parse(f.frist) - Date.now() : Infinity;
              const klasse = f.abgegeben || rest < 0 ? 'erledigt' : rest < 3 * TAG ? 'dringend' : '';
              return (
                <tr key={f.id} className={klasse}>
                  <td>
                    {zeitText(f.frist)}
                    <div className="leise">{restText(f.frist)}</div>
                  </td>
                  <td>
                    <span className="abzeichen">{ART[f.art]}</span>{' '}
                    {f.pfad ? (
                      <a href={bibliothekUrl(`${f.pfad}/aufgabe.md`)} onClick={linkKlick}>
                        {f.titel}
                      </a>
                    ) : (
                      f.titel
                    )}
                    {f.url && (
                      <>
                        {' · '}
                        <a href={f.url} target="_blank" rel="noopener noreferrer">
                          Moodle
                        </a>
                      </>
                    )}
                  </td>
                  <td>{f.kurs}</td>
                  <td>
                    <label className="haken">
                      <input type="checkbox" checked={f.abgegeben} onChange={(x) => void erledigt(f.id, x.target.checked)} /> erledigt
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Fächer</h2>
      {u.faecher.length === 0 ? (
        <p className="leise">Noch keine Fächer. Leg unten eins an – dann Folien, Altklausuren und Übungsblätter hineinlegen.</p>
      ) : (
        <ul className="ordnerliste">
          {u.faecher.map((f) => (
            <li key={f.name}>
              <a href={bibliothekUrl(f.ordner)} onClick={linkKlick}>
                📁 {f.titel}
              </a>
              {f.moodleUrl && (
                <>
                  {' · '}
                  <a href={f.moodleUrl} target="_blank" rel="noopener noreferrer">
                    Moodle
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="zeile" onSubmit={fachAnlegen}>
        <input value={neuesFach} onChange={(x) => setNeuesFach(x.target.value)} placeholder="z. B. Computational Data Analytics" aria-label="Neues Fach" required />
        <button type="submit">Fach anlegen</button>
      </form>
      <p className="leise">
        Je Fach: <code>folien/</code>, <code>altklausuren/</code>, <code>aufgaben/</code> (je Übungsblatt ein Ordner oder direkt das PDF; Erledigtes nach{' '}
        <code>aufgaben/erledigt/</code>). Hochladen in der Bibliothek oder per Obsidian.
      </p>

      <h2>Moodle</h2>
      {!u.verbunden ? (
        <p>
          Fristen aus Moodle sind noch nicht eingerichtet. In Moodle: Kalender → Exportieren → Kalender-URL abrufen. Dann auf dem Server:{' '}
          <code>dorf moodle-kalender</code>
        </p>
      ) : (
        <>
          <p>
            {u.kalender ? 'Fristen kommen aus deinem Moodle-Kalender.' : `Verbunden mit ${u.moodleUrl}.`}{' '}
            {l ? (
              <>
                Letzter Abgleich: {zeitText(l.start)}
                {l.ok === null
                  ? ' – läuft …'
                  : l.ok
                    ? ` – ${u.appZugang ? `${l.neueDateien} ${l.neueDateien === 1 ? 'neue Datei' : 'neue Dateien'}, ` : ''}${l.neueFristen} ${l.neueFristen === 1 ? 'neue Frist' : 'neue Fristen'}.`
                    : ''}
              </>
            ) : (
              'Noch kein Abgleich.'
            )}
            {u.naechster && <span className="leise"> Nächster: {zeitText(u.naechster)}.</span>}
          </p>
          {l && l.ok === false && <p className="fehler">Fehler: {l.fehler}</p>}
          {l && l.hinweise.length > 0 && (
            <details>
              <summary>{l.hinweise.length} Hinweise</summary>
              <ul>
                {l.hinweise.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </details>
          )}
          <button onClick={() => void abgleichen()} disabled={u.laeuft}>
            {u.laeuft ? 'Abgleich läuft …' : 'Jetzt abgleichen'}
          </button>
        </>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}
