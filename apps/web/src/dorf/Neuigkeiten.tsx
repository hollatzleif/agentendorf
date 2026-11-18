import { useState } from 'react';

/** Bei jeder neuen Ausgabe den Schlüssel ändern – dann erscheint die Karte einmal pro Gerät */
const AUSGABE = '2026-11-18g';
const SCHLUESSEL = 'dorf-neuigkeiten-gesehen';

const PUNKTE: [string, string][] = [
  ['🧺', 'To-do-Brett: Tipp auf den Marktplatz – deine Liste, immer aktuell, zum Abhaken. Auch per Telegram (/todo), und alle Agenten können sie pflegen.'],
  ['💬', 'Ablehnen mit Begründung: In der App ins Feld „warum?“ schreiben oder in Telegram nach ❌ einfach antworten – der Bürgermeister macht dann einen besseren Vorschlag.'],
  ['📚', 'Kursübersichten aktualisieren sich jeden Montag früh von selbst – für jedes Fach.'],
  ['🧑‍💼', 'Frist-Wächter: Bei Erinnerungen kurz vor der Frist gibt es in Telegram „Vorbereiten lassen“.'],
  ['🎨', 'Neuer Look: Fenster, Reiter, Knöpfe und Seiten sehen jetzt aus wie die Spielknöpfe im Dorf.'],
  ['⏱️', 'Pläne des Bürgermeisters starten nach 10 Minuten von selbst, wenn du nicht antwortest (einstellbar). Senden, Löschen, Abgeben warten weiter immer auf dich.'],
  ['🧠', 'Der Bürgermeister lernt: Er führt ein Gedächtnis (Rathaus/memory.md) und hat eine Persönlichkeit (Rathaus/personality.md) – Änderungen daran nur mit deinem Ja.'],
  ['🔁', 'Nach deinem Ja zu einer Freigabe und wenn seine Helfer fertig sind, macht er von selbst weiter.'],
  ['🧩', 'Eigene Skills: Gebäude → Aktionen → „+ Neue Aktion“ – auch mit Zeitplan (z. B. täglich 06:00) und Ergebnis-Datei mit Archiv. Oder den Bürgermeister fragen.'],
  ['✅', 'Checkliste: jeden Morgen um 06:00 frisch in der Bibliothek (00_Checkliste.html), deine Häkchen bleiben gespeichert. Kursübersicht in der Uni: Folien + Übersicht je Kurs.'],
  ['🎩', 'Der Bürgermeister ist rund um die Uhr wach: stündlich geht er seine Runde durchs Dorf, nachts schläft er (Zz), wenn nichts los ist.'],
  ['🧭', 'Schickt er Helfer los, laufen sie als Figuren mit Rucksack zu ihrem Gebäude. Sind sie fertig, gibt es Konfetti.'],
  ['🔘', 'Gebäude antippen: runde Knöpfe wie im Spiel, dazu Schnellknöpfe (Uni: Moodle, Lernen · Post: Antworten).'],
  ['🌦️', 'Wetter wie in Konstanz (Tipp aufs Schild), Jahreszeiten, Tag und Nacht nach der Uhr.'],
  ['📰', 'Zeitungs-Knopf mit rotem Punkt, solange die Morgenzeitung ungelesen ist.'],
  ['🌐', 'Moodle-Browser: einmal auf dem Server „dorf moodle-browser-zugang“, dann Uni → Moodle.'],
  ['📱', 'Telegram: /heute (dein Tag), /fristen (mit Erledigt-Knöpfen) und /moodle <Fach>.'],
];

/** Kleine Karte „Neu im Dorf“ – einmal pro Gerät und Ausgabe, blockiert nichts */
export function Neuigkeiten() {
  const [zu, setZu] = useState(() => {
    try {
      return navigator.webdriver || localStorage.getItem(SCHLUESSEL) === AUSGABE;
    } catch {
      return true; // ohne Speicher würde die Karte bei jedem Öffnen erscheinen – dann lieber nie
    }
  });
  if (zu) return null;
  const schliessen = () => {
    try {
      localStorage.setItem(SCHLUESSEL, AUSGABE);
    } catch {
      /* egal */
    }
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
