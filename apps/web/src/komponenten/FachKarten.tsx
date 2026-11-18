import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FachStand, KartenFach } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick, navigieren } from '../router';

const bis = (iso: string) => {
  const tage = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  const wann = new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { wann, tage };
};
const stunden = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Uni (Nacht 18./19.11.): eine Karte je Fach – nächste Frist, offene Abgaben, Fokuszeit der Woche, Schnellstart */
export function FachKarten() {
  // hängt an ['uni', …] und wird mit uni.geaendert frisch geholt; Fokuszeit kommt beim nächsten Laden dazu
  const q = useQuery({ queryKey: ['uni', 'faecher-stand'], queryFn: () => api<FachStand[]>('/api/uni/faecher-stand') });
  const karten = useQuery({ queryKey: ['uni', 'karten'], queryFn: () => api<KartenFach[]>('/api/karten') });
  const [meldung, setMeldung] = useState('');
  if (!q.data?.length) return null;
  const fokus = async (f: FachStand) => {
    setMeldung('');
    try {
      await api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: `Lernen: ${f.titel}`, gruppe: f.titel } });
      setMeldung(`🍅 Fokus für ${f.titel} läuft – Restzeit im Kirchturm.`);
    } catch (e) {
      setMeldung(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  return (
    <>
      <div className="fach-karten">
        {q.data.map((f) => {
          const n = f.naechsteFrist ? bis(f.naechsteFrist.frist) : null;
          return (
            <section key={f.name} className="karte innen fach-karte" aria-label={`Fach ${f.titel}`}>
              <h3>
                <a href={bibliothekUrl(f.ordner)} onClick={linkKlick}>
                  📁 {f.titel}
                </a>
              </h3>
              {f.naechsteFrist && n ? (
                <p className={n.tage <= 2 ? 'fach-frist dringend' : 'fach-frist'}>
                  {f.naechsteFrist.art === 'test' ? '📝' : '⏰'} {f.naechsteFrist.titel}
                  <br />
                  <span className="leise">
                    {n.wann} · {n.tage <= 0 ? 'heute' : n.tage === 1 ? 'morgen' : `in ${n.tage} Tagen`}
                  </span>
                </p>
              ) : (
                <p className="leise">Keine offene Frist.</p>
              )}
              <div className="fach-zahlen">
                <span title="Offene Übungsblätter in aufgaben/">📄 {f.offeneAbgaben} offen</span>
                <span title="Pomodoro-Fokuszeit der letzten 7 Tage">🍅 {stunden(f.fokus7Tage)}</span>
                {(() => {
                  const k = karten.data?.find((x) => x.fach === f.name);
                  return k ? (
                    <a href={`/gebaeude/Uni?reiter=karten&fach=${encodeURIComponent(f.name)}`} onClick={linkKlick} title="Karteikarten, die heute dran sind">
                      🃏 {k.faellig} dran
                    </a>
                  ) : null;
                })()}
              </div>
              <div className="zeile">
                <button type="button" className="klein" onClick={() => void fokus(f)} aria-label={`Fokus starten: ${f.titel}`}>
                  🍅 Fokus
                </button>
                <button type="button" className="klein" onClick={() => navigieren(`/gebaeude/Uni?reiter=aktionen&aktion=${encodeURIComponent('Uni/lernen')}`)}>
                  📚 Lernen
                </button>
                {f.moodleUrl && (
                  <a href={f.moodleUrl} target="_blank" rel="noopener noreferrer" className="leise">
                    Moodle
                  </a>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {meldung && <p className="hinweis">{meldung}</p>}
    </>
  );
}
