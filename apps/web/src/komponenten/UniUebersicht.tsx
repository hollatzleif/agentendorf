import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UniFrist, UniUebersicht as Daten } from '@dorf/shared';
import { FachKarten } from './FachKarten';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const TAG = 86_400_000;
const zeit = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const zeitText = (iso: string | null) => (iso ? zeit.format(new Date(iso)) : '–');
const ART: Record<UniFrist['art'], string> = { abgabe: 'Abgabe', test: 'Prüfung', termin: 'Termin', pflicht: 'Pflicht' };
const uhr = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

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
      <h2>Fristen und Pflichttermine</h2>
      {u.fristen.length === 0 ? (
        <p className="leise">{u.verbunden ? 'Nichts Anstehendes.' : 'Noch keine Termine – siehe „Kalender“ unten.'}</p>
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
              const laeuft = rest <= 0 && f.ende != null && Date.parse(f.ende) > Date.now();
              const abhakbar = f.art === 'abgabe' || f.art === 'test';
              const klasse = laeuft ? 'laeuft' : f.abgegeben ? 'erledigt' : abhakbar && rest < 3 * TAG ? 'dringend' : '';
              return (
                <tr key={f.id} className={klasse}>
                  <td>
                    {zeitText(f.frist)}
                    {f.ende && f.art !== 'abgabe' && <> – {uhr.format(new Date(f.ende))}</>}
                    <div className="leise">{laeuft ? 'läuft gerade' : restText(f.frist)}</div>
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
                    {abhakbar && (
                      <label className="haken">
                        <input type="checkbox" checked={f.abgegeben} onChange={(x) => void erledigt(f.id, x.target.checked)} /> erledigt
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="leise">
        Nur was gerade läuft oder noch kommt; Pflichttermine der nächsten 7 Tage. Nicht abgehakte Abgaben und Prüfungen erinnert dich der Telegram-Bot (3 Tage, 1 Tag, 3
        Stunden vorher, danach Nachfrage) – mit Knopf „Erledigt“. Ein ✅ vor dem Titel im Google-Kalender zählt auch.
      </p>

      <h2>Fächer</h2>
      <MoodleBrowserZeile />
      {u.faecher.length === 0 ? (
        <p className="leise">Noch keine Fächer. Leg unten eins an – dann Folien, Altklausuren und Übungsblätter hineinlegen.</p>
      ) : (
        <FachKarten />
      )}
      <form className="zeile" onSubmit={fachAnlegen}>
        <input value={neuesFach} onChange={(x) => setNeuesFach(x.target.value)} placeholder="z. B. Computational Data Analytics" aria-label="Neues Fach" required />
        <button type="submit">Fach anlegen</button>
      </form>
      <p className="leise">
        Je Fach: <code>folien/</code>, <code>altklausuren/</code>, <code>aufgaben/</code> (je Übungsblatt ein Ordner oder direkt das PDF; Erledigtes nach{' '}
        <code>aufgaben/erledigt/</code>). Hochladen in der Bibliothek oder per Obsidian.
      </p>

      <h2>Kalender</h2>
      {!u.verbunden ? (
        <p>
          Noch kein Kalender eingerichtet. In Google Kalender: Einstellungen → Kalender wählen → Kalender integrieren → Geheime Adresse im iCal-Format. Dann auf dem
          Server: <code>dorf google-kalender</code>
        </p>
      ) : (
        <>
          <p>
            {[
              u.google.fristen && 'Fristen aus „Moodle-Fristen (automatisch)“',
              u.google.pflicht && 'Pflichttermine aus „JKU Pflicht“',
              u.kalender && 'Fristen direkt aus dem Moodle-Kalender',
              u.appZugang && `Moodle-App-Zugang (${u.moodleUrl})`,
            ]
              .filter(Boolean)
              .join(' · ')}
            .{' '}
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

const BROWSER_TEXT: Record<string, string> = {
  bereit: '🌐 Moodle-Browser bereit – der Agent kann Moodle selbst durchsehen (nur lesen).',
  ohne_zugang: '🌐 Moodle-Browser läuft, aber ohne Zugang – auf dem Server: dorf moodle-browser-zugang',
  nicht_erreichbar: '🌐 Moodle-Browser startet gerade oder ist nicht erreichbar (dorf status).',
  aus: '🌐 Moodle-Browser ist auf diesem Server noch nicht eingerichtet.',
};

/** Zustand des Moodle-Browsers (E57) und Weg zur Aktion „Moodle durchsehen“ */
function MoodleBrowserZeile() {
  const q = useQuery({ queryKey: ['uni', 'moodle-browser'], queryFn: () => api<{ status: string }>('/api/uni/moodle-browser'), staleTime: 60_000 });
  if (!q.data) return null;
  return (
    <p className="leise">
      {BROWSER_TEXT[q.data.status] ?? q.data.status}
      {q.data.status === 'bereit' && (
        <>
          {' '}
          <a href="/gebaeude/Uni?reiter=aktionen" onClick={linkKlick}>
            Moodle durchsehen →
          </a>
        </>
      )}
    </p>
  );
}
