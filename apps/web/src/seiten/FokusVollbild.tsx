import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KirchturmZustand, TodoInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick, navigieren } from '../router';
import { dauerText, useKirchturm } from '../komponenten/KirchturmUhr';
import { FokusParkplatz } from '../komponenten/FokusParkplatz';

/**
 * Fokus-Vollbild (/fokus): nur die Zeit, das Thema und die nötigen Knöpfe – sonst nichts. Der Pomodoro läuft im
 * Kirchturm (Server), diese Seite ist nur eine ruhige Ansicht davon. Esc führt zurück zu „Heute“.
 */
const PHASE: Record<string, string> = { arbeit: '🍅 Fokus', kurz: '☕ Kurze Pause', lang: '🌿 Lange Pause', aus: 'Bereit' };

export function FokusVollbild() {
  const qc = useQueryClient();
  const q = useKirchturm();
  const [, neu] = useState(0);
  const [fehler, setFehler] = useState('');
  const p = q.data?.pomodoro;
  const laeuft = p?.status === 'laeuft';
  useEffect(() => {
    if (!laeuft) return;
    const t = setInterval(() => neu((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [laeuft]);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && navigieren('/heute');
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, []);
  const rest = !p ? 0 : laeuft && p.ende ? Date.parse(p.ende) - (Date.now() + (q.data?.versatz ?? 0)) : (p.restMs ?? p.einstellungen.arbeitMin * 60_000);
  useEffect(() => {
    document.title = p && p.phase !== 'aus' ? `${dauerText(rest)} · ${PHASE[p.phase]}` : 'Fokus';
  });
  // beim Verlassen den Reiter-Titel zurückgeben (sonst bleibt „12:34 · Fokus“ stehen, Review)
  // beim Verlassen den Titel von vorher zurück (mit Freigabe-Zähler „(2) Agentendorf“), nicht eine Konstante (Review);
  // beim ersten Rendern gemerkt – vor dem Effekt, der den Titel auf die Restzeit setzt
  const [vorher] = useState(() => document.title);
  useEffect(() => () => void (document.title = vorher), [vorher]);
  const befehl = async (b: Record<string, unknown>) => {
    setFehler('');
    try {
      const z = await api<KirchturmZustand>('/api/kirchturm', { body: b });
      qc.setQueryData(['kirchturm'], { ...z, versatz: Date.parse(z.jetzt) - Date.now() });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  const erledigt = async () => {
    if (!p?.einstellungen.todoPfad) return;
    setFehler('');
    try {
      await api('/api/todos', { methode: 'PATCH', body: { pfad: p.einstellungen.todoPfad, erledigt: true } });
    } catch (e) {
      // nicht verschlucken: Fokus läuft weiter, Leif sieht, warum das Häkchen fehlt
      setFehler(`To-do nicht abgehakt: ${e instanceof ApiFehler ? e.message : String(e)}`);
      return;
    }
    await befehl({ befehl: 'pomodoro', aktion: 'stopp' });
    await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
  };
  return (
    <section className={`fokus-vollbild phase-${p?.phase ?? 'aus'}`} aria-label="Fokus">
      <a href="/heute" onClick={linkKlick} className="fokus-zurueck">
        ← Heute
      </a>
      {q.isError && <p className="fehler">{q.error.message}</p>}
      {p && (
        <>
          <div className="fokus-phase">{PHASE[p.phase]}</div>
          <div className="fokus-zeit" role="timer" aria-live="off">
            {dauerText(Math.max(0, rest))}
          </div>
          {p.einstellungen.thema && <div className="fokus-thema">{p.einstellungen.thema}</div>}
          {p.phase !== 'aus' && (
            <div className="fokus-runden" aria-label={`Runde ${Math.min(p.erledigt + 1, p.einstellungen.runden)} von ${p.einstellungen.runden}`}>
              {Array.from({ length: p.einstellungen.runden }, (_, i) => (
                <span key={i} className={i < p.erledigt ? 'an' : ''} />
              ))}
            </div>
          )}
          <div className="fokus-knoepfe">
            {p.phase === 'aus' && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'start' })}>
                🍅 Fokus starten
              </button>
            )}
            {p.phase !== 'aus' && laeuft && (
              <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'pause' })}>
                ⏸ Pause
              </button>
            )}
            {p.phase !== 'aus' && !laeuft && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: p.status === 'pause' ? 'weiter' : 'start' })}>
                ▶ Weiter
              </button>
            )}
            {p.phase !== 'aus' && (
              <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'stopp' })}>
                ⏹ Stopp
              </button>
            )}
            {p.einstellungen.todoPfad && p.phase !== 'aus' && (
              <button type="button" onClick={() => void erledigt()}>
                ✓ To-do erledigt
              </button>
            )}
          </div>
          {p.einstellungen.todoPfad && <FokusSchritte pfad={p.einstellungen.todoPfad} />}
          <FokusParkplatz arbeit={p.phase === 'arbeit' && laeuft} />
          <p className="leise fokus-hinweis">Telegram hält Meldungen zurück, solange du arbeitest. Esc = zurück.</p>
        </>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </section>
  );
}

/**
 * E136: die Teilschritte des To-dos, an dem gerade gearbeitet wird – direkt hier abhaken, ohne den Fokus zu verlassen.
 * Ohne Schritte: ein Feld, um den nächsten Schritt festzuhalten.
 */
function FokusSchritte({ pfad }: { pfad: string }) {
  const qc = useQueryClient();
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const t = todos.data?.find((x) => x.pfad === pfad);
  const [lokal, setLokal] = useState<Record<string, boolean>>({});
  const [neu, setNeu] = useState('');
  const [fehler, setFehler] = useState('');
  if (!t || t.erledigt) return null;
  const sch = t.schritte ?? [];
  const aufruf = async (f: () => Promise<unknown>) => {
    setFehler('');
    try {
      await f();
      return true;
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
      return false;
    } finally {
      await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
    }
  };
  return (
    <div className="fokus-schritte" role="group" aria-label="Schritte im Fokus">
      {sch.length > 0 && (
        <ul>
          {sch.map((x, i) => {
            const k = `${t.version}:${i}`;
            const an = lokal[k] ?? x.erledigt;
            return (
              <li key={k} className={an ? 'fertig' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={an}
                    aria-label={`Schritt erledigt: ${x.text}`}
                    onChange={(e) => {
                      const wert = e.target.checked;
                      setLokal((l) => ({ ...l, [k]: wert }));
                      void aufruf(() => api('/api/todos/schritt', { body: { pfad, nr: i, erledigt: wert, text: x.text } })).then((ok) => !ok && setLokal((l) => ({ ...l, [k]: x.erledigt })));
                    }}
                  />
                  <span>{x.text}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="fokus-schritt-neu"
        onSubmit={(e) => {
          e.preventDefault();
          if (!neu.trim()) return;
          void aufruf(() => api('/api/todos/schritte', { body: { pfad, schritte: [neu.trim()] } })).then((ok) => ok && setNeu(''));
        }}
      >
        <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder={sch.length ? 'Noch ein Schritt …' : 'Was ist der nächste Schritt?'} maxLength={200} aria-label="Schritt hinzufügen" />
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}
