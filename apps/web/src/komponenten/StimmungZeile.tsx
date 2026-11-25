import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Statistik } from '@dorf/shared';
import { api } from '../api';
import { E } from '../apple/tag';

/** E107 in der App: „Wie war dein Tag?“ – ein Tipp speichert 1–5 für heute (wie im Telegram-Tagesabschluss) */
const GESICHTER = ['😞', '😕', '😐', '🙂', '😄'];

export function StimmungZeile() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['statistik', 7], queryFn: () => api<Statistik>('/api/statistik?tage=7') });
  const heute = q.data?.tage.at(-1)?.stimmung ?? null;
  const setzen = async (wert: number) => {
    await api('/api/stimmung', { body: { wert } });
    await qc.invalidateQueries({ queryKey: ['statistik'] });
  };
  return (
    <div className="stimmung-zeile" role="group" aria-label="Wie war dein Tag?">
      <span className="stimmung-frage">
        <E e="💭" /> Wie war dein Tag?
      </span>
      {GESICHTER.map((g, i) => (
        <button key={g} type="button" className={`stimmung-knopf${heute === i + 1 ? ' an' : ''}`} aria-pressed={heute === i + 1} aria-label={`Stimmung ${i + 1} von 5`} onClick={() => void setzen(i + 1)}>
          {g}
        </button>
      ))}
    </div>
  );
}
