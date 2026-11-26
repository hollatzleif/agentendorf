// E240: Schale der Apple-Oberfläche – dieselben Ziele wie die Kopfleiste des Dorf-Designs, nur anders angeordnet:
// Handy = Tab-Leiste unten (Glas, 4 Ziele + „Mehr“), Desktop (≥ 900 px) = Seitenleiste wie in macOS; oben eine Kopfleiste,
// die erst beim Scrollen Material bekommt (Scroll-Kante) und dann den Seitentitel klein zeigt (Large Title steht in der Seite).
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Gebaeude } from '@dorf/shared';
import { api } from '../api';
import { linkKlick } from '../router';
import { schnellDunkelUmschalten } from '../aussehen';
import { Ikon, Symbol } from './Ikon';
import type { SymbolName } from './symbole';
import { Sheet } from './Sheet';
import { LetzteChats } from '../komponenten/LetzteChats';

type Ziel = { href: string; text: string; symbol: SymbolName };

const PLANEN: Ziel[] = [
  { href: '/planen', text: 'Woche planen', symbol: 'liste' },
  { href: '/abschluss', text: 'Tag abschließen', symbol: 'mond' },
  { href: '/fokus', text: 'Fokus', symbol: 'timer' },
];
const WERKZEUGE: Ziel[] = [
  { href: '/atelier', text: 'Atelier', symbol: 'pinsel' },
  { href: '/codehaus/editor', text: 'Code-Editor', symbol: 'terminal' },
  { href: '/schriftprobe', text: 'Schriftprobe', symbol: 'feder' },
  { href: '/paketwerk', text: 'Paketwerk', symbol: 'paket' },
];
const SYSTEM: Ziel[] = [
  { href: '/anleitung', text: 'Anleitung', symbol: 'kompass' },
  { href: '/einstellungen', text: 'Einstellungen', symbol: 'zahnrad' },
];

const TITEL: Record<string, string> = {
  '/': 'Dorf',
  '/heute': 'Heute',
  '/bibliothek': 'Bibliothek',
  '/einstellungen': 'Einstellungen',
  '/planen': 'Woche planen',
  '/abschluss': 'Tag abschließen',
  '/fokus': 'Fokus',
  '/atelier': 'Atelier',
  '/anleitung': 'Anleitung',
  '/schriftprobe': 'Schriftprobe',
  '/paketwerk': 'Paketwerk',
  '/codehaus/editor': 'Code-Editor',
  '/codehaus/vscode': 'VS Code',
  '/hafen/muster': 'Muster',
};

export function seitenTitel(pfad: string, gebaeude?: Gebaeude[]) {
  if (TITEL[pfad]) return TITEL[pfad]!;
  if (pfad.startsWith('/gebaeude/')) {
    const id = decodeURIComponent(pfad.slice('/gebaeude/'.length));
    return gebaeude?.find((g) => g.id === id)?.name ?? id;
  }
  if (pfad.startsWith('/hafen/')) return 'Kielwasser';
  if (pfad.startsWith('/chats/')) return 'Chat';
  return 'Agentendorf';
}

const istRathaus = (pfad: string) => pfad === '/gebaeude/Rathaus';
const istDorf = (pfad: string) => pfad === '/' || (pfad.startsWith('/gebaeude') && !istRathaus(pfad)) || pfad.startsWith('/chats') || pfad.startsWith('/codehaus') || pfad === '/atelier' || pfad === '/schriftprobe' || pfad.startsWith('/hafen/');

export function AppleSchale({ pfad, freigaben, konflikte, live, children }: { pfad: string; freigaben: number; konflikte: number; live: string; children: ReactNode }) {
  const gebaeude = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const [scroll, setScroll] = useState(0);
  const [mehr, setMehr] = useState(false);
  const [, neu] = useState(0);
  useEffect(() => {
    const s = () => setScroll(window.scrollY);
    s();
    window.addEventListener('scroll', s, { passive: true });
    return () => window.removeEventListener('scroll', s);
  }, []);
  useEffect(() => setMehr(false), [pfad]);
  const dunkel = document.documentElement.dataset.dunkel === 'ja';
  const titel = seitenTitel(pfad, gebaeude.data);
  const imMehr = [...PLANEN, ...WERKZEUGE, ...SYSTEM].some((z) => z.href === pfad) && !istDorf(pfad);

  const link = (z: Ziel, extra?: ReactNode, aktiv = pfad === z.href) => (
    <a key={z.href} href={z.href} onClick={linkKlick} className={aktiv ? 'aktiv' : ''} aria-current={aktiv ? 'page' : undefined}>
      <Symbol name={z.symbol} />
      <span className="a-nav-text">{z.text}</span>
      {extra}
    </a>
  );

  return (
    <div className="rahmen a-schale">
      <aside className="a-seitenleiste" aria-label="Seitenleiste">
        <div className="a-seitenleiste-innen">
          <div className="a-seitenleiste-kopf">
            <a href="/" onClick={linkKlick} className="a-kopf-marke">
              <img src="/favicon.svg" alt="" width={28} height={28} /> Agentendorf
            </a>
            <span className={`a-live ${live}`} title={live === 'verbunden' ? 'Live verbunden' : live === 'verbinde' ? 'Verbinde …' : 'Getrennt – verbinde neu'} />
          </div>
          <button type="button" className="a-seitenleiste-suche" onClick={() => window.dispatchEvent(new Event('dorf:palette'))}>
            <Symbol name="suche" /> Suchen <kbd>⌘K</kbd>
          </button>
          <nav aria-label="Navigation">
            {link({ href: '/', text: 'Dorf', symbol: 'haus' }, undefined, istDorf(pfad) && !(gebaeude.data ?? []).some((g) => pfad === `/gebaeude/${encodeURIComponent(g.id)}`))}
            {link({ href: '/heute', text: 'Heute', symbol: 'kalender' })}
            {link({ href: '/gebaeude/Rathaus', text: 'Rathaus', symbol: 'rathaus' }, freigaben > 0 ? <span className="a-nav-zahl rot" title="Freigaben warten auf dich">{freigaben}</span> : undefined, istRathaus(pfad))}
            {link({ href: '/bibliothek', text: 'Bibliothek', symbol: 'buch' })}
            <div className="a-seitenleiste-abschnitt">Planen</div>
            {PLANEN.map((z) => link(z))}
            {!!gebaeude.data?.length && <div className="a-seitenleiste-abschnitt">Gebäude</div>}
            {gebaeude.data
              ?.filter((g) => g.id !== 'Rathaus')
              .map((g) => {
                const href = `/gebaeude/${encodeURIComponent(g.id)}`;
                return (
                  <a key={g.id} href={href} onClick={linkKlick} className={pfad === href ? 'aktiv' : ''} aria-current={pfad === href ? 'page' : undefined}>
                    <span className="a-nav-emoji">
                      <Ikon e={g.symbol} />
                    </span>
                    <span className="a-nav-text">{g.name}</span>
                  </a>
                );
              })}
            <div className="a-seitenleiste-abschnitt">Werkzeuge</div>
            {WERKZEUGE.map((z) => link(z))}
            <div className="a-seitenleiste-abschnitt">Dorf</div>
            {SYSTEM.map((z) => link(z, z.href === '/einstellungen' && konflikte > 0 ? <span className="a-nav-zahl rot">{konflikte}</span> : undefined))}
          </nav>
        </div>
      </aside>

      <div className="a-spalte">
        <header className={`a-kopfleiste${scroll > 2 ? ' gescrollt' : ''}${scroll > 44 ? ' titel-sichtbar' : ''}`}>
          <div className="a-kopf-links">
            <a href="/" onClick={linkKlick} className="a-kopf-marke" aria-label="Agentendorf">
              <img src="/favicon.svg" alt="" width={28} height={28} />
            </a>
          </div>
          <div className="a-kopf-titel" aria-hidden={scroll > 44 ? undefined : true}>
            {titel}
          </div>
          <div className="a-kopf-rechts">
            {freigaben > 0 && (
              <a href="/gebaeude/Rathaus?reiter=freigaben" onClick={linkKlick} className="a-glasknopf" title="Freigaben warten auf dich" aria-label={`${freigaben} Freigaben warten`}>
                <Symbol name="brief" />
                <span className="a-plakette">{freigaben}</span>
              </a>
            )}
            {konflikte > 0 && (
              <a href="/einstellungen?bereich=konflikte" onClick={linkKlick} className="a-glasknopf" title="Konflikte zwischen Geräten" aria-label={`${konflikte} Konflikt${konflikte === 1 ? '' : 'e'}`}>
                <Symbol name="warnung" />
                <span className="a-plakette">{konflikte}</span>
              </a>
            )}
            <LetzteChats variante="apple" kinder={<Symbol name="sprechblase" />} />
            <button type="button" className="a-glasknopf" aria-label="Suchen" title="Suchen (⌘K)" onClick={() => window.dispatchEvent(new Event('dorf:palette'))}>
              <Symbol name="suche" />
            </button>
            <button
              type="button"
              className="a-glasknopf"
              title={dunkel ? 'Hell (dieses Gerät)' : 'Dunkel (dieses Gerät)'}
              aria-label={dunkel ? 'Hell schalten' : 'Dunkel schalten'}
              onClick={() => {
                schnellDunkelUmschalten();
                neu((x) => x + 1);
              }}
            >
              <Symbol name={dunkel ? 'sonne' : 'mond'} />
            </button>
          </div>
        </header>
        {children}
      </div>

      <nav className="a-tableiste" aria-label="Tabs">
        <Tab href="/" text="Dorf" symbol="haus" aktiv={istDorf(pfad)} />
        <Tab href="/heute" text="Heute" symbol="kalender" aktiv={pfad === '/heute'} />
        <Tab href="/gebaeude/Rathaus" text="Rathaus" symbol="rathaus" aktiv={istRathaus(pfad)} zahl={freigaben} />
        <Tab href="/bibliothek" text="Bibliothek" symbol="buch" aktiv={pfad === '/bibliothek'} />
        <button type="button" className={`a-tab${imMehr || mehr ? ' aktiv' : ''}`} onClick={() => setMehr(true)} aria-haspopup="dialog" aria-expanded={mehr}>
          <Symbol name="mehr" />
          <span>Mehr</span>
          {konflikte > 0 && <span className="a-plakette">{konflikte}</span>}
        </button>
      </nav>

      {mehr && (
        <Sheet titel="Mehr" onSchliessen={() => setMehr(false)}>
          <MehrListe titel="Planen" ziele={PLANEN} pfad={pfad} />
          <section className="a-abschnitt" aria-label="Gebäude">
            <h3 className="a-abschnitt-titel">Gebäude</h3>
            <div className="a-gruppe">
              {gebaeude.data?.map((g) => (
                <a key={g.id} href={`/gebaeude/${encodeURIComponent(g.id)}`} onClick={linkKlick} className="a-zelle">
                  <span className="a-zelle-symbol a-farbe-blau">
                    <Ikon e={g.symbol} />
                  </span>
                  <span className="a-zelle-text">{g.name}</span>
                  <Symbol name="pfeil_rechts" groesse="0.95rem" />
                </a>
              ))}
            </div>
          </section>
          <MehrListe titel="Werkzeuge" ziele={WERKZEUGE} pfad={pfad} />
          <MehrListe titel="Dorf" ziele={SYSTEM} pfad={pfad} />
          <section className="a-abschnitt">
            <div className="a-gruppe">
              <button
                type="button"
                className="a-zelle"
                onClick={() => {
                  setMehr(false);
                  window.dispatchEvent(new Event('dorf:palette'));
                }}
              >
                <span className="a-zelle-symbol a-farbe-grau">
                  <Symbol name="suche" />
                </span>
                <span className="a-zelle-text">Suchen und Befehle</span>
              </button>
            </div>
          </section>
        </Sheet>
      )}
    </div>
  );
}

function Tab({ href, text, symbol, aktiv, zahl = 0 }: { href: string; text: string; symbol: SymbolName; aktiv: boolean; zahl?: number }) {
  return (
    <a href={href} onClick={linkKlick} className={`a-tab${aktiv ? ' aktiv' : ''}`} aria-current={aktiv ? 'page' : undefined}>
      <Symbol name={symbol} />
      <span>{text}</span>
      {zahl > 0 && (
        <span className="a-plakette" aria-label={`${zahl} offen`}>
          {zahl}
        </span>
      )}
    </a>
  );
}

const FARBE: Record<string, string> = {
  '/planen': 'indigo', '/abschluss': 'lila', '/fokus': 'rot', '/atelier': 'pink', '/codehaus/editor': 'grau', '/schriftprobe': 'braun', '/paketwerk': 'orange', '/anleitung': 'tuerkis', '/einstellungen': 'grau',
};

function MehrListe({ titel, ziele, pfad }: { titel: string; ziele: Ziel[]; pfad: string }) {
  return (
    <section className="a-abschnitt" aria-label={titel}>
      <h3 className="a-abschnitt-titel">{titel}</h3>
      <div className="a-gruppe">
        {ziele.map((z) => (
          <a
            key={z.href}
            href={z.href}
            onClick={(e) => {
              if (pfad === z.href) e.preventDefault();
              linkKlick(e);
            }}
            className="a-zelle"
            aria-current={pfad === z.href ? 'page' : undefined}
          >
            <span className={`a-zelle-symbol a-farbe-${FARBE[z.href] ?? 'blau'}`}>
              <Symbol name={z.symbol} />
            </span>
            <span className="a-zelle-text">{z.text}</span>
            <Symbol name="pfeil_rechts" groesse="0.95rem" />
          </a>
        ))}
      </div>
    </section>
  );
}

