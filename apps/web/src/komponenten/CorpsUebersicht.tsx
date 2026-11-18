import { useQuery } from '@tanstack/react-query';
import type { CorpsUebersicht as Daten } from '@dorf/shared';
import { api } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const wann = (t: Daten['termine'][number]) =>
  new Date(t.start).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', ...(t.ganztags ? {} : { hour: '2-digit', minute: '2-digit' }) });

/** Corpshaus (Etappe 7): Corps-Termine aus dem Hauptkalender (Stichworte) + Verweis auf die Terminübersicht aus Mails */
export function CorpsUebersicht() {
  const q = useQuery({ queryKey: ['corps'], queryFn: () => api<Daten>('/api/corps') });
  const d = q.data;
  if (!d) return <p className="leise">Lade …</p>;
  return (
    <div>
      {d.fehler && <p className="fehler">{d.fehler}</p>}
      <h3>Termine aus deinem Kalender</h3>
      {!d.kalenderEingerichtet ? (
        <p className="leise">Der Hauptkalender ist noch nicht eingerichtet (GOOGLE_TERMINE_ICS).</p>
      ) : d.termine.length === 0 ? (
        <p className="leise">Keine Corps-Termine in den nächsten 6 Wochen (erkannt an: {d.stichworte.join(', ') || 'noch keine Stichworte'}).</p>
      ) : (
        <ul className="chatliste">
          {d.termine.map((t) => (
            <li key={`${t.start}-${t.titel}`}>
              <strong>{wann(t)}</strong> {t.titel}
            </li>
          ))}
        </ul>
      )}
      <p className="leise">
        Termine aus Corps-Mails sammelt der Skill „Termine aus Mails“ (montags und donnerstags) in{' '}
        <a href={bibliothekUrl('Corpshaus/00_Termine.md')} onClick={linkKlick}>
          Corpshaus/00_Termine.md
        </a>
        . Absender und Stichworte stellst du in{' '}
        <a href={bibliothekUrl('Corpshaus/einstellungen.md')} onClick={linkKlick}>
          Corpshaus/einstellungen.md
        </a>{' '}
        ein{d.absender.length ? ` (Absender: ${d.absender.join(', ')})` : ' – noch keine Absender eingetragen'}.
      </p>
    </div>
  );
}
