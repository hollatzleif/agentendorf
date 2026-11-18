import { useState } from 'react';

/** Bei jeder neuen Ausgabe den Schlüssel ändern – dann erscheint die Karte einmal pro Gerät */
const AUSGABE = '2026-11-18';
const SCHLUESSEL = 'dorf-neuigkeiten-gesehen';

const PUNKTE: [string, string][] = [
  ['🎩', 'Der Bürgermeister ist rund um die Uhr wach: stündlich geht er seine Runde durchs Dorf, nachts schläft er (Zz), wenn nichts los ist.'],
  ['🧭', 'Schickt er Helfer los, laufen sie als Figuren mit Rucksack zu ihrem Gebäude. Sind sie fertig, gibt es Konfetti.'],
  ['🔘', 'Gebäude antippen: runde Knöpfe wie im Spiel, dazu Schnellknöpfe (Uni: Moodle, Lernen · Post: Antworten).'],
  ['🌦️', 'Wetter wie in Linz (Tipp aufs Schild), Jahreszeiten, Tag und Nacht nach der Uhr.'],
  ['📰', 'Zeitungs-Knopf mit rotem Punkt, solange die Morgenzeitung ungelesen ist.'],
  ['🌐', 'Moodle-Browser: einmal auf dem Server „dorf moodle-browser-zugang“, dann Uni → Moodle.'],
  ['📱', 'Telegram: /fristen (mit Erledigt-Knöpfen) und /moodle <Fach>.'],
];

/** Kleine Karte „Neu im Dorf“ – einmal pro Gerät und Ausgabe, blockiert nichts */
export function Neuigkeiten() {
  const [zu, setZu] = useState(() => navigator.webdriver || localStorage.getItem(SCHLUESSEL) === AUSGABE);
  if (zu) return null;
  const schliessen = () => {
    localStorage.setItem(SCHLUESSEL, AUSGABE);
    setZu(true);
  };
  return (
    <section className="dorf-neuigkeiten" aria-label="Neu im Dorf">
      <div className="dorf-neuigkeiten-kopf">
        <strong>✨ Neu im Dorf</strong>
        <button className="spiel-zu" onClick={schliessen} aria-label="Neuigkeiten schließen">
          ×
        </button>
      </div>
      <ul>
        {PUNKTE.map(([s, t]) => (
          <li key={t}>
            <span aria-hidden>{s}</span> {t}
          </li>
        ))}
      </ul>
      <button className="dorf-knopf text haupt" onClick={schliessen}>
        Alles klar
      </button>
    </section>
  );
}
