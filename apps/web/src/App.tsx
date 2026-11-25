import { lazy, Suspense, useEffect, useState } from 'react';
import { schnellDunkelUmschalten, useAussehen } from './aussehen';
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
import { useDesign } from './apple/design';
import { AppleSchale } from './apple/Schale';

// Seiten erst laden, wenn man sie öffnet – der Start (Dorf) bleibt klein
const GebaeudeSeite = lazy(() => import('./seiten/Gebaeude').then((m) => ({ default: m.GebaeudeSeite })));
const Bibliothek = lazy(() => import('./seiten/Bibliothek').then((m) => ({ default: m.Bibliothek })));
const Heute = lazy(() => import('./seiten/Heute').then((m) => ({ default: m.Heute })));
const Einstellungen = lazy(() => import('./seiten/Einstellungen').then((m) => ({ default: m.Einstellungen })));
const ChatSeite = lazy(() => import('./seiten/Chat').then((m) => ({ default: m.ChatSeite })));
const Anleitung = lazy(() => import('./seiten/Anleitung').then((m) => ({ default: m.Anleitung })));
const WochePlanen = lazy(() => import('./seiten/WochePlanen').then((m) => ({ default: m.WochePlanen })));
const TagAbschliessen = lazy(() => import('./seiten/TagAbschliessen').then((m) => ({ default: m.TagAbschliessen })));
// E197: Editor im Codehaus – Monaco und xterm werden nur hier geladen
const CodeEditorSeite = lazy(() => import('./codeeditor/CodeEditor'));
// E205: das echte VS Code des Codehauses, eingebettet (eigener Ursprung) + Erweiterungen
const VsCodeSeite = lazy(() => import('./seiten/VsCodeSeite'));
// E198: der Bildeditor (und sein Stylesheet) wird nur auf dieser Seite geladen
// E239: Muster-Kielwasser (/hafen/muster) – vor der Bot-Route, „muster“ ist keine Bot-Id
const MusterKielwasserSeite = lazy(() => import('./hafen/MusterKielwasser').then((m) => ({ default: m.MusterKielwasserSeite })));
const KielwasserSeite = lazy(() => import('./hafen/Terminal').then((m) => ({ default: m.KielwasserSeite })));
const PaketwerkSeite = lazy(() => import('./seiten/Paketwerk').then((m) => ({ default: m.PaketwerkSeite })));
const AtelierSeite = lazy(() => import('./atelier/Atelier').then((m) => ({ default: m.AtelierSeite })));
// E216: Schriftprobe – Leifs Hand für handschrift_schreiben
const Schriftprobe = lazy(() => import('./seiten/Schriftprobe').then((m) => ({ default: m.Schriftprobe })));
const FokusVollbild = lazy(() => import('./seiten/FokusVollbild').then((m) => ({ default: m.FokusVollbild })));

export function App() {
  const qc = useQueryClient();
  const ich = useQuery({ queryKey: ['ich'], queryFn: () => api<Ich>('/api/ich'), retry: false, staleTime: 60_000 });
  const angemeldet = ich.isSuccess;
  useLiveVerbindung(qc, angemeldet);
  useAussehen(angemeldet); // E224

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
  const design = useDesign();
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
  else if (pfad === '/atelier') seite = <AtelierSeite />;
  else if (pfad === '/hafen/muster') seite = <MusterKielwasserSeite />;
  else if (/^\/hafen\/[0-9a-f-]{36}$/.test(pfad)) seite = <KielwasserSeite botId={pfad.slice('/hafen/'.length)} />;
  else if (pfad === '/schriftprobe') seite = <Schriftprobe />;
  else if (pfad === '/anleitung') seite = <Anleitung />;
  else if (pfad === '/planen') seite = <WochePlanen />;
  else if (pfad === '/abschluss') seite = <TagAbschliessen />;
  else if (pfad === '/codehaus/editor') seite = <CodeEditorSeite />;
  else if (pfad === '/codehaus/vscode') seite = <VsCodeSeite />;
  else if (pfad === '/bibliothek') seite = <Bibliothek />;
  else if (pfad === '/einstellungen') seite = <Einstellungen />;
  else if (pfad === '/paketwerk') seite = <PaketwerkSeite />;
  else if (pfad.startsWith('/chats/')) seite = <ChatSeite key={pfad} id={decodeURIComponent(pfad.slice('/chats/'.length))} />;
  else seite = <p className="karte">Diese Seite gibt es nicht.</p>;

  // E240: Apple-Oberfläche – gleiche Seiten, andere Schale (Tab-Leiste/Seitenleiste statt Kopfleiste)
  if (design === 'apple')
    return (
      <AppleSchale pfad={pfad} freigaben={nf} konflikte={n} live={live}>
        <OfflineSchlange />
        <main>
          <SeitenFehler schluessel={pfad}>
            <Suspense fallback={<p className="leise a-laden-seite"><span className="a-spinner" /> Lade …</p>}>{seite}</Suspense>
          </SeitenFehler>
        </main>
      </AppleSchale>
    );

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
          {nav('/', 'Dorf', pfad === '/' || pfad.startsWith('/gebaeude') || pfad.startsWith('/chats') || pfad.startsWith('/codehaus') || pfad === '/atelier' || pfad === '/schriftprobe' || pfad.startsWith('/hafen/'))}
          {nav('/heute', 'Heute', pfad === '/heute')}
          {nav('/bibliothek', 'Bibliothek', pfad === '/bibliothek')}
          {nav('/einstellungen', 'Einstellungen', pfad === '/einstellungen' || pfad === '/paketwerk')}
        </nav>
        <div className="status">
          <DunkelSchalter />
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

/** E224: 🌙/☀️ – schnell hell/dunkel auf diesem Gerät (Einstellungen → Aussehen für alles Weitere) */
function DunkelSchalter() {
  const [, neu] = useState(0);
  const dunkel = document.documentElement.dataset.dunkel === 'ja';
  return (
    <button
      type="button"
      className="dunkel-schalter"
      title={dunkel ? 'Hell (dieses Gerät)' : 'Dunkel (dieses Gerät)'}
      aria-label={dunkel ? 'Hell schalten' : 'Dunkel schalten'}
      onClick={() => {
        schnellDunkelUmschalten();
        neu((x) => x + 1);
      }}
    >
      {dunkel ? '☀️' : '🌙'}
    </button>
  );
}
