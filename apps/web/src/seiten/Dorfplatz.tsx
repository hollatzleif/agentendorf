import { NeuesGebaeude } from '../komponenten/NeuesGebaeude';
import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DorfStatus, Gebaeude } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { webglMoeglich } from '../dorf/gl';

// three.js wird nur geladen, wenn das Dorf wirklich gezeigt wird
const DorfAnsicht = lazy(() => import('../dorf/DorfAnsicht'));

const SCHLUESSEL = 'dorf-ansicht';

/** Startseite: das 3D-Dorf – oder die Liste (per Knopf, gemerkt; automatisch ohne WebGL) */
export function Dorfplatz() {
  const gl = webglMoeglich();
  const [ansicht, setAnsicht] = useState<'dorf' | 'liste'>(() => (!gl || localStorage.getItem(SCHLUESSEL) === 'liste' ? 'liste' : 'dorf'));
  const wechseln = (a: 'dorf' | 'liste') => {
    localStorage.setItem(SCHLUESSEL, a);
    setAnsicht(a);
  };
  if (ansicht === 'liste') return <DorfListe zumDorf={gl ? () => wechseln('dorf') : null} />;
  return (
    <Fehlergrenze ersatz={<DorfListe zumDorf={null} hinweis="Das 3D-Dorf konnte auf diesem Gerät nicht starten – hier die Liste." />}>
      <Suspense fallback={<div className="dorf-buehne"><div className="dorf-laden">Das Dorf wird aufgebaut …</div></div>}>
        <DorfAnsicht zurListe={() => wechseln('liste')} />
      </Suspense>
    </Fehlergrenze>
  );
}

class Fehlergrenze extends Component<{ ersatz: ReactNode; children: ReactNode }, { fehler: boolean }> {
  state = { fehler: false };
  static getDerivedStateFromError() {
    return { fehler: true };
  }
  componentDidCatch(e: unknown) {
    console.error('Dorf-Ansicht:', e);
  }
  render() {
    return this.state.fehler ? this.props.ersatz : this.props.children;
  }
}

export function DorfListe({ zumDorf, hinweis }: { zumDorf: (() => void) | null; hinweis?: string }) {
  const g = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const s = useQuery({ queryKey: ['dorf-status'], queryFn: () => api<DorfStatus>('/api/dorf/status'), refetchInterval: 60_000 });
  if (g.isPending) return <p>Lade Gebäude …</p>;
  if (g.isError) return <p className="fehler">{g.error.message}</p>;
  return (
    <section>
      <div className="zeile kopfzeile">
        <h1>Dorfplatz</h1>
        {zumDorf && (
          <button onClick={zumDorf} className="haupt">
            🏘️ Zum Dorf
          </button>
        )}
      </div>
      {hinweis && <p className="leise">{hinweis}</p>}
      <div className="gebaeude-raster">
        {g.data.map((x) => {
          const st = s.data?.gebaeude[x.id];
          const figuren = s.data?.figuren.filter((f) => f.gebaeude === x.id).length ?? 0;
          return (
            <a key={x.id} href={`/gebaeude/${encodeURIComponent(x.id)}`} onClick={linkKlick} className={`gebaeude-karte ${x.status}${x.fehler ? ' kaputt' : ''}`}>
              <span className="symbol">{x.symbol}</span>
              <span className="name">{x.name}</span>
              <span className="beschreibung">{x.fehler ?? (x.status === 'geschlossen' ? 'Noch nicht eröffnet' : x.beschreibung)}</span>
              <span className="karten-status">
                {x.aktionen > 0 && <span className="abzeichen">{x.aktionen} Aktionen</span>}
                {figuren > 0 && <span className="abzeichen gut" title="Agenten arbeiten">💨 {figuren}</span>}
                {st?.freigaben ? <span className="abzeichen warnung" title="Freigabe wartet">✉️ {st.freigaben}</span> : null}
                {st?.aufgaben ? <span className="abzeichen" title="Offene Aufgaben">🚧 {st.aufgaben}</span> : null}
                {st?.frist && <span className="abzeichen warnung" title={st.frist.titel}>⏰ Frist</span>}
              </span>
            </a>
          );
        })}
      </div>
      <NeuesGebaeude />
      <p className="leise">Oder in Obsidian: Ordner mit einer <code>gebaeude.md</code> anlegen – es erscheint sofort im Dorf.</p>
    </section>
  );
}
