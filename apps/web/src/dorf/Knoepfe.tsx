import type { DorfGebaeudeStatus, Gebaeude } from '@dorf/shared';
import { reiterFuer } from '../seiten/Gebaeude';
import { Zeichen } from '../apple/werkzeug-symbole';
import { useDesign } from '../apple/design';

/** Symbol und Farbe je Reiter – runde Spielknöpfe (eigene Gestaltung) */
const KNOPF: Record<string, { symbol: string; farbe: string; titel?: string }> = {
  uebersicht: { symbol: 'ℹ️', farbe: 'blau', titel: 'Info' },
  aktionen: { symbol: '⚡', farbe: 'gelb' },
  chats: { symbol: '💬', farbe: 'tuerkis' },
  dateien: { symbol: '📁', farbe: 'braun' },
  schreibtisch: { symbol: '🗂️', farbe: 'gruen' },
  morgenzeitung: { symbol: '📰', farbe: 'grau', titel: 'Zeitung' },
  plaene: { symbol: '📋', farbe: 'lila' },
  freigaben: { symbol: '✉️', farbe: 'rot' },
  'alle-chats': { symbol: '🗨️', farbe: 'tuerkis', titel: 'Alle Chats' },
  verbrauch: { symbol: '📊', farbe: 'grau' },
  agenten: { symbol: '⚙️', farbe: 'grau', titel: 'Agenten' },
  studium: { symbol: '🎓', farbe: 'lila' },
  eingang: { symbol: '📬', farbe: 'gelb' },
};

/** E240: Apple-Oberfläche – Symbol und Systemfarbe je Reiter (auch für Reiter ohne eigenen Spielknopf, die sonst „•“ zeigen) */
const APPLE_KNOPF: Record<string, [string, string]> = {
  uebersicht: ['ℹ️', 'blau'], aktionen: ['⚡', 'gelb'], chats: ['💬', 'tuerkis'], dateien: ['📁', 'blau'], schreibtisch: ['🗂️', 'gruen'],
  morgenzeitung: ['📰', 'grau'], woche: ['📅', 'rot'], statistik: ['📊', 'lila'], notizen: ['📝', 'gelb'], plaene: ['📋', 'lila'],
  freigaben: ['✉️', 'rot'], 'alle-chats': ['🗨️', 'tuerkis'], verbrauch: ['📈', 'grau'], agenten: ['⚙️', 'grau'],
  studium: ['🎓', 'lila'], pruefungen: ['⏳', 'rot'], karten: ['⧉', 'orange'], noten: ['⭐', 'gelb'], eingang: ['📬', 'blau'],
  todo: ['✅', 'blau'], wochenplan: ['📆', 'rot'], projekte: ['🗂️', 'orange'], kalender: ['📅', 'rot'], konto: ['🏦', 'gruen'],
  depot: ['📈', 'gruen'], analyse: ['📊', 'lila'], rechner: ['🎛️', 'grau'], berater: ['🧠', 'lila'], uhr: ['⏰', 'orange'],
  code: ['💻', 'grau'], editor: ['📝', 'blau'], vscode: ['🖥️', 'blau'], bilder: ['🖼️', 'orange'], flotte: ['⚓', 'blau'],
  termine: ['📅', 'rot'], aemter: ['👤', 'braun'], corpspost: ['✉️', 'blau'], einkauf: ['🛒', 'gruen'], wunsch: ['❤️', 'rot'],
};

/** Schnellknöpfe: die meistgenutzten Aktionen direkt am Gebäude (öffnen die Aktion schon ausgewählt) */
const SCHNELL: Record<string, { symbol: string; titel: string; aktion: string }[]> = {
  Uni: [
    { symbol: '🌐', titel: 'Moodle', aktion: 'Uni/moodle-durchsehen' },
    { symbol: '📚', titel: 'Lernen', aktion: 'Uni/lernen' },
  ],
  Post: [{ symbol: '✍️', titel: 'Antworten', aktion: 'Post/antwort-entwerfen' }],
  Rathaus: [{ symbol: '❓', titel: 'Frage', aktion: 'Rathaus/frage-stellen' }],
};

/**
 * Leiste unten in der Mitte, wenn ein Gebäude angetippt ist: Namensbanner, Statuszeile und runde Knöpfe,
 * die direkt in den passenden Reiter führen. Die wichtigsten zuerst; am Handy scrollt die Reihe.
 */
export function GebaeudeKnoepfe({
  g,
  status,
  freigaben,
  figuren,
  oeffnen,
  bauen,
  schliessen,
}: {
  g: Gebaeude;
  status?: DorfGebaeudeStatus;
  freigaben: number;
  figuren: number;
  oeffnen: (reiter: string) => void;
  bauen: () => void;
  schliessen: () => void;
}) {
  const apple = useDesign() === 'apple';
  const reiter = reiterFuer(g.id).filter(([k]) => !(g.status === 'geschlossen' && k === 'aktionen'));
  const zeile: string[] = [];
  if (g.status === 'geschlossen') zeile.push('noch nicht eröffnet');
  if (figuren) zeile.push(`${figuren} ${figuren === 1 ? 'Agent arbeitet' : 'Agenten arbeiten'}`);
  if (status?.freigaben) zeile.push(`${status.freigaben} Freigabe${status.freigaben === 1 ? '' : 'n'} warten`);
  if (status?.aufgaben) zeile.push(`${status.aufgaben} offene Aufgabe${status.aufgaben === 1 ? '' : 'n'}`);
  if (status?.frist) zeile.push(`Frist: ${status.frist.titel}`);
  if (!zeile.length) zeile.push(g.beschreibung || 'Alles ruhig.');
  const abzeichen = (k: string) => (k === 'freigaben' ? freigaben : k === 'aktionen' ? 0 : 0);
  return (
    <div className="spiel-auswahl" role="group" aria-label={`Gebäude ${g.name}`}>
      <div className="spiel-banner">
        <span className="spiel-name">
          {g.symbol} {g.name}
        </span>
        <span className="spiel-zeile">{zeile.join(' · ')}</span>
        <button className="spiel-zu" onClick={schliessen} aria-label="Auswahl aufheben">
          <Zeichen e="×" />
        </button>
      </div>
      <div className="spiel-knoepfe">
        {reiter.map(([k, t], i) => {
          const dorfKnopf = KNOPF[k] ?? { symbol: '•', farbe: 'grau' };
          const a = apple ? APPLE_KNOPF[k] : undefined;
          const kn = a ? { ...dorfKnopf, symbol: a[0], farbe: a[1] } : dorfKnopf;
          const n = abzeichen(k);
          return (
            <button key={k} className={`spiel-knopf ${kn.farbe}`} data-reiter={k} style={{ animationDelay: `${i * 35}ms` }} onClick={() => oeffnen(k)} aria-label={kn.titel ?? t}>
              <span className="spiel-kreis">
                <span className="spiel-symbol" aria-hidden>
                  <Zeichen e={kn.symbol} />
                </span>
                {n > 0 && <span className="spiel-abzeichen">{n}</span>}
              </span>
              <span className="spiel-text">{kn.titel ?? t}</span>
            </button>
          );
        })}
        {g.status !== 'geschlossen' &&
          (SCHNELL[g.id] ?? []).map((x, i) => (
            <button
              key={x.aktion}
              className="spiel-knopf gelb"
              style={{ animationDelay: `${(reiter.length + i) * 35}ms` }}
              onClick={() => oeffnen(`aktionen&aktion=${encodeURIComponent(x.aktion)}`)}
              aria-label={x.titel}
            >
              <span className="spiel-kreis">
                <span className="spiel-symbol" aria-hidden>
                  <Zeichen e={x.symbol} />
                </span>
              </span>
              <span className="spiel-text">{x.titel}</span>
            </button>
          ))}
        <button className="spiel-knopf orange" style={{ animationDelay: `${reiter.length * 35}ms` }} onClick={bauen} aria-label="Versetzen">
          <span className="spiel-kreis">
            <span className="spiel-symbol" aria-hidden>
              <Zeichen e="🔨" />
            </span>
          </span>
          <span className="spiel-text">Versetzen</span>
        </button>
      </div>
    </div>
  );
}
