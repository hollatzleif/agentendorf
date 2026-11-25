import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { offlineSchlange, offlineSenden } from '../api';
import { Ikon } from '../apple/Ikon';

/** Zeigt, was offline gemerkt wurde, und sendet es, sobald die Verbindung zurück ist (online-Ereignis + alle 30 s). */
export function OfflineSchlange() {
  const qc = useQueryClient();
  const [n, setN] = useState(() => offlineSchlange().length);
  useEffect(() => {
    const zaehlen = () => setN(offlineSchlange().length);
    const senden = async () => {
      if (!offlineSchlange().length) return;
      const gesendet = await offlineSenden();
      if (gesendet) await qc.invalidateQueries();
    };
    const online = () => void senden();
    window.addEventListener('dorf:offline-schlange', zaehlen);
    window.addEventListener('online', online);
    const t = setInterval(() => void senden(), 30_000);
    void senden();
    return () => {
      window.removeEventListener('dorf:offline-schlange', zaehlen);
      window.removeEventListener('online', online);
      clearInterval(t);
    };
  }, [qc]);
  if (!n) return null;
  return (
    <div className="offline-schlange" role="status">
      <Ikon e="📶" /> {n} {n === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Verbindung
      <button type="button" className="klein" onClick={() => void offlineSenden().then((x) => (x ? qc.invalidateQueries() : undefined))}>
        Jetzt senden
      </button>
    </div>
  );
}
