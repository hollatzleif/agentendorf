import { lazy, Suspense, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FreigabeInfo, Ich, Konflikt } from '@dorf/shared';
import { api } from './api';
import { linkKlick, navigieren, useOrt } from './router';
import { useLiveVerbindung, useLiveZustand } from './live';
import { Anmelden } from './seiten/Anmelden';
import { Dorfplatz } from './seiten/Dorfplatz';
import { Schnelleingabe } from './programm/Schnelleingabe';
import { ProgrammMeldungen } from './programm/Meldungen';
import { KirchturmGlocke } from './programm/KirchturmGlocke';
import { Befehlspalette } from './komponenten/Befehlspalette';
import { OfflineSchlange } from './komponenten/OfflineSchlange';
import { SeitenFehler } from './komponenten/SeitenFehler';
import { Tastenkuerzel } from './komponenten/Tastenkuerzel';

// Seiten erst laden, wenn man sie öffnet – der Start (Dorf) bleibt klein
const GebaeudeSeite = lazy(() => import('./seiten/Gebaeude').then((m) => ({ default: m.GebaeudeSeite })));
const Bibliothek = lazy(() => import('./seiten/Bibliothek').then((m) => ({ default: m.Bibliothek })));
const Heute = lazy(() => import('./seiten/Heute').then((m) => ({ default: m.Heute })));
const Einstellungen = lazy(() => import('./seiten/Einstellungen').then((m) => ({ default: m.Einstellungen })));
const ChatSeite = lazy(() => import('./seiten/Chat').then((m) => ({ default: m.ChatSeite })));
const Anleitung = lazy(() => import('./seiten/Anleitung').then((m) => ({ default: m.Anleitung })));
const WochePlanen = lazy(() => import('./seiten/WochePlanen').then((m) => ({ default: m.WochePlanen })));
const TagAbschliessen = lazy(() => import('./seiten/TagAbschliessen').then((m) => ({ default: m.TagAbschliessen })));
const FokusVollbild = lazy(() => import('./seiten/FokusVollbild').then((m) => ({ default: m.FokusVollbild })));

export function App() {
  const qc = useQueryClient();
  const ich = useQuery({ queryKey: ['ich'], queryFn: () => api<Ich>('/api/ich'), retry: false, staleTime: 60_000 });
  const angemeldet = ich.isSuccess;
  useLiveVerbindung(qc, angemeldet);

  useEffect(() => {
    const ab = () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: ['ich'] });
    };
    window.addEventListener('dorf:abgemeldet', ab);
    return () => window.removeEventListener('dorf:abgemeldet', ab);
  }, [qc]);

  if (ich.isPending) return <div className="laden">Das Dorf erwacht …</div>;
  if (!angemeldet) return <Anmelden />;
  // Schnelleingabe (Desktop-Programm, Tastenkürzel): ohne Kopfleiste
  if (location.pathname === '/schnell') return <Schnelleingabe />;
  return (
    <>
      <ProgrammMeldungen />
      <KirchturmGlocke />
      <Befehlspalette />
      <Tastenkuerzel />
      <Rahmen />
    </>
  );
}

/** Startseite: „Heute“ statt Dorf, wenn so eingestellt (nur beim ersten Aufruf von „/“ nach dem Laden) */
let startGeprueft = false;

function Rahmen() {
  const { pfad } = useOrt();
  useEffect(() => {
    if (startGeprueft) return;
    startGeprueft = true;
    if (pfad === '/' && !location.search && localStorage.getItem('dorf-start') === 'heute') navigieren('/heute', true);
  }, [pfad]);
  const live = useLiveZustand();
  const konflikte = useQuery({ queryKey: ['konflikte'], queryFn: () => api<Konflikt[]>('/api/vault/konflikte') });
  const n = konflikte.data?.length ?? 0;
  const freigaben = useQuery({ queryKey: ['freigaben', 'offen'], queryFn: () => api<FreigabeInfo[]>('/api/freigaben?status=offen') });
  const nf = freigaben.data?.length ?? 0;
  // Plakette am App-Symbol (installierte PWA am Handy/PC): offene Freigaben auf einen Blick; Titel im Browser-Reiter
  useEffect(() => {
    if (!freigaben.data) return;
    const n = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (nf > 0) void n.setAppBadge?.(nf).catch(() => undefined);
    else void n.clearAppBadge?.().catch(() => undefined);
    document.title = nf > 0 ? `(${nf}) Agentendorf` : 'Agentendorf';
  }, [nf, freigaben.data]);
  // Abmelden: Plakette und Titel zurücksetzen
  useEffect(
    () => () => {
      void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
      document.title = 'Agentendorf';
    },
    [],
  );

  let seite: React.ReactNode;
  if (pfad === '/') seite = <Dorfplatz />;
  else if (pfad.startsWith('/gebaeude/')) seite = <GebaeudeSeite id={decodeURIComponent(pfad.slice('/gebaeude/'.length))} />;
  else if (pfad === '/heute') seite = <Heute />;
  else if (pfad === '/fokus') seite = <FokusVollbild />;
  else if (pfad === '/anleitung') seite = <Anleitung />;
  else if (pfad === '/planen') seite = <WochePlanen />;
  else if (pfad === '/abschluss') seite = <TagAbschliessen />;
  else if (pfad === '/bibliothek') seite = <Bibliothek />;
  else if (pfad === '/einstellungen') seite = <Einstellungen />;
  else if (pfad.startsWith('/chats/')) seite = <ChatSeite key={pfad} id={decodeURIComponent(pfad.slice('/chats/'.length))} />;
  else seite = <p className="karte">Diese Seite gibt es nicht.</p>;

  const nav = (href: string, text: string, aktiv: boolean) => (
    <a href={href} onClick={linkKlick} className={aktiv ? 'aktiv' : ''}>
      {text}
    </a>
  );

  return (
    <div className="rahmen">
      <header className="kopf">
        <a href="/" onClick={linkKlick} className="marke">
          <img src="/favicon.svg" alt="" width={28} height={28} /> Agentendorf
        </a>
        <nav>
          {nav('/', 'Dorf', pfad === '/' || pfad.startsWith('/gebaeude') || pfad.startsWith('/chats'))}
          {nav('/heute', 'Heute', pfad === '/heute')}
          {nav('/bibliothek', 'Bibliothek', pfad === '/bibliothek')}
          {nav('/einstellungen', 'Einstellungen', pfad === '/einstellungen')}
        </nav>
        <div className="status">
          {nf > 0 && (
            <a href="/gebaeude/Rathaus?reiter=freigaben" onClick={linkKlick} className="abzeichen brief" title="Freigaben warten auf dich">
              ✉️ {nf}
            </a>
          )}
          {n > 0 && (
            <a href="/einstellungen#konflikte" onClick={linkKlick} className="abzeichen warnung" title="Konflikte zwischen Geräten">
              {n} Konflikt{n === 1 ? '' : 'e'}
            </a>
          )}
          <span className={`live ${live}`} title={live === 'verbunden' ? 'Live verbunden' : live === 'verbinde' ? 'Verbinde …' : 'Getrennt – verbinde neu'} />
        </div>
      </header>
      <OfflineSchlange />
      <main>
        <SeitenFehler schluessel={pfad}>
          <Suspense fallback={<p className="leise">Lade …</p>}>{seite}</Suspense>
        </SeitenFehler>
      </main>
    </div>
  );
}
