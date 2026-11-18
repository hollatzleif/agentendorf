import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KirchturmZustand } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick, navigieren } from '../router';
import { dauerText, useKirchturm } from '../komponenten/KirchturmUhr';

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
    await api('/api/todos', { methode: 'PATCH', body: { pfad: p.einstellungen.todoPfad, erledigt: true } }).catch(() => undefined);
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
          <p className="leise fokus-hinweis">Telegram hält Meldungen zurück, solange du arbeitest. Esc = zurück.</p>
        </>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </section>
  );
}
