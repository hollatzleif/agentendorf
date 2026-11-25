import { useEffect, useRef, useState } from 'react';
import type { DorfStatus } from '@dorf/shared';
import { Zeichen } from '../apple/werkzeug-symbole';

export interface TickerEintrag {
  id: number;
  text: string;
  symbol: string;
  ziel: { art: 'gebaeude'; id: string } | { art: 'figur'; id: string } | null;
  zeit: number;
  /** erfolgreich fertig → Konfetti über dem Gebäude */
  feier?: boolean;
}

let zaehler = 0;

/** Was hat sich zwischen zwei Ständen getan? (ohne Netz, nur Vergleich) */
export function aenderungen(alt: DorfStatus, neu: DorfStatus, name: (id: string) => string): Omit<TickerEintrag, 'id' | 'zeit'>[] {
  const aus: Omit<TickerEintrag, 'id' | 'zeit'>[] = [];
  const altF = new Map(alt.figuren.map((f) => [f.laufId, f]));
  const neuF = new Map(neu.figuren.map((f) => [f.laufId, f]));
  for (const f of neu.figuren) {
    const vorher = altF.get(f.laufId);
    if (!vorher) {
      if (f.buergermeister) aus.push({ symbol: '🎩', text: 'Der Bürgermeister denkt nach …', ziel: { art: 'gebaeude', id: 'Rathaus' } });
      else if (f.ausloeser === 'buergermeister') aus.push({ symbol: '🧭', text: `Helfer läuft zur ${name(f.gebaeude)}: ${f.titel}`, ziel: { art: 'figur', id: f.laufId } });
      else aus.push({ symbol: '🚶', text: `Agent geht zur ${name(f.gebaeude)}: ${f.titel}`, ziel: { art: 'figur', id: f.laufId } });
    } else if (vorher.status !== 'wartet_freigabe' && f.status === 'wartet_freigabe') {
      aus.push({ symbol: '✉️', text: `${name(f.gebaeude)} wartet auf deine Freigabe`, ziel: { art: 'gebaeude', id: f.gebaeude } });
    }
  }
  const enden = new Map((neu.zuletzt ?? []).map((e) => [e.laufId, e]));
  for (const f of alt.figuren) {
    if (neuF.has(f.laufId) || f.buergermeister) continue;
    const e = enden.get(f.laufId);
    const ziel = { art: 'gebaeude' as const, id: f.gebaeude };
    if (e?.status === 'fertig') aus.push({ symbol: '✅', text: `Fertig in ${name(f.gebaeude)}: ${f.titel}`, ziel, feier: true });
    else if (e?.status === 'fehler') aus.push({ symbol: '❌', text: `Fehler in ${name(f.gebaeude)}: ${f.titel}`, ziel });
    else if (e?.status === 'abgebrochen') aus.push({ symbol: '⏹️', text: `Abgebrochen in ${name(f.gebaeude)}: ${f.titel}`, ziel });
    else aus.push({ symbol: '🏁', text: `Zurück aus ${name(f.gebaeude)}: ${f.titel}`, ziel });
  }
  for (const [id, s] of Object.entries(neu.gebaeude)) {
    const a = alt.gebaeude[id];
    if ((s.freigaben ?? 0) > (a?.freigaben ?? 0)) aus.push({ symbol: '✉️', text: `Neue Freigabe in ${name(id)}`, ziel: { art: 'gebaeude', id } });
    if (s.frist && s.frist.titel !== a?.frist?.titel) aus.push({ symbol: '⏰', text: `Frist bald: ${s.frist.titel}`, ziel: { art: 'gebaeude', id } });
    if ((s.aufgaben ?? 0) > (a?.aufgaben ?? 0)) aus.push({ symbol: '🚧', text: `Neue Aufgabe für ${name(id)}`, ziel: { art: 'gebaeude', id } });
  }
  // doppelte Freigabe-Meldungen (Figur + Gebäude) zusammenfassen
  const gesehen = new Set<string>();
  return aus.filter((e) => (gesehen.has(e.text) ? false : (gesehen.add(e.text), true)));
}

/** Kleine Meldungen oben links, verschwinden nach 9 s; Klick schwenkt die Kamera dorthin */
export function DorfTicker({
  status,
  name,
  zeigen,
  feiern,
}: {
  status?: DorfStatus;
  name: (id: string) => string;
  zeigen: (z: TickerEintrag['ziel']) => void;
  feiern?: (gebaeude: string) => void;
}) {
  const vorher = useRef<DorfStatus | null>(null);
  const [eintraege, setEintraege] = useState<TickerEintrag[]>([]);
  useEffect(() => {
    if (!status) return;
    const alt = vorher.current;
    vorher.current = status;
    if (!alt) return; // erster Stand: nichts melden
    const neu = aenderungen(alt, status, name).map((e) => ({ ...e, id: ++zaehler, zeit: Date.now() }));
    if (neu.length) setEintraege((l) => [...neu, ...l].slice(0, 4));
    for (const e of neu) if (e.feier && e.ziel?.art === 'gebaeude') feiern?.(e.ziel.id);
  }, [status, name, feiern]);
  useEffect(() => {
    if (!eintraege.length) return;
    const t = setTimeout(() => setEintraege((l) => l.filter((e) => Date.now() - e.zeit < 9000)), 1000);
    return () => clearTimeout(t);
  }, [eintraege]);
  if (!eintraege.length) return null;
  return (
    <ul className="dorf-ticker" aria-live="polite" aria-label="Was im Dorf passiert">
      {eintraege.map((e) => (
        <li key={e.id}>
          <button onClick={() => zeigen(e.ziel)}>
            <span aria-hidden className="ticker-symbol">
              <Zeichen e={e.symbol} />
            </span>{' '}
            <span className="ticker-text">{e.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
