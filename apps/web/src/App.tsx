import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FreigabeInfo, Ich, Konflikt } from '@dorf/shared';
import { api } from './api';
import { linkKlick, useOrt } from './router';
import { useLiveVerbindung, useLiveZustand } from './live';
import { Anmelden } from './seiten/Anmelden';
import { Dorfplatz } from './seiten/Dorfplatz';
import { GebaeudeSeite } from './seiten/Gebaeude';
import { Bibliothek } from './seiten/Bibliothek';
import { Einstellungen } from './seiten/Einstellungen';
import { ChatSeite } from './seiten/Chat';
import { Schnelleingabe } from './programm/Schnelleingabe';
import { ProgrammMeldungen } from './programm/Meldungen';
import { KirchturmGlocke } from './programm/KirchturmGlocke';

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
      <Rahmen />
    </>
  );
}

function Rahmen() {
  const { pfad } = useOrt();
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
      <main>{seite}</main>
    </div>
  );
}
