import { useState } from 'react';

/** Bei jeder neuen Ausgabe den Schlüssel ändern – dann erscheint die Karte einmal pro Gerät */
const AUSGABE = '2026-11-19e';
const SCHLUESSEL = 'dorf-neuigkeiten-gesehen';

const PUNKTE: [string, string][] = [
  ['🔁', 'Neu: wiederkehrende To-dos – beim Bearbeiten „Wiederholen“ wählen oder in Telegram „/todo Wäsche jeden Montag“. Abhaken legt das nächste an.'],
  ['🎯', 'Neu: Wochenziele auf „Heute“ (oder /ziel in Telegram) – 3 Dinge, die diese Woche fertig werden sollen. Stehen in der Morgenzeitung, Bilanz im Wochenrückblick, als Checkliste auch in Obsidian.'],
  ['🧭', 'Telegram /plan (oder /plan morgen): Tagesplan als Knöpfe – antippen trägt den Block in deinen Kalender ein.'],
  ['🔁', 'Neu: Gewohnheiten auf „Heute“ – Sport, Lesen, Vokabeln … mit 🔥 Serie. Abhaken auch abends in Telegram (/gewohnheiten), Bilanz im Wochenrückblick.'],
  ['⌨️', 'Strg/⌘+K: Befehlspalette – suchen, „todo …“, „termin morgen 14 Uhr …“, „fokus …“, „timer 10“, „frag …“.'],
  ['⭐', 'Stern an To-dos: das Wichtigste steht oben auf „Heute“, kommt beim Tagesplanen zuerst und in die Morgenzeitung. Abends um 21 Uhr fragt Telegram, was morgen wichtig ist.'],
  ['🧭', 'Tag planen (Kalender oder „Heute“): deine dringendsten To-dos als Blöcke in freie Lücken – du wählst, was eingetragen wird.'],
  ['📅', 'Kalender: Termine ziehen und verlängern, „morgen 14 Uhr Zahnarzt“ als Schnelleingabe, /termin in Telegram, 📅 am To-do sucht Lernzeit bis zur Frist.'],
  ['🃏', 'Karteikarten je Fach (Uni → Karteikarten, /karten in Telegram); „Karteikarten erstellen“ macht sie aus deinen Folien.'],
  ['🍅', 'Fokus: 🍅 an jedem To-do, Fokuszeit je Fach im Kirchturm, Nicht stören hält Telegram während der Arbeit zurück.'],
  ['🎓', 'Uni: Karten je Fach mit nächster Frist, offenen Blättern, Fokuszeit – und Mails mit „✓ Als To-do“ in der Post.'],
  ['🗓️', 'Sonntags 18:30: Wochenrückblick im Rathaus (und in Telegram).'],
  ['📋', 'Neu: „Heute“ – dein Tag auf einen Blick (oben in der Leiste oder der 📋-Knopf im Dorf): Termine, fällige To-dos zum Abhaken, Fokus-Start, Wetter und Zeitung.'],
  ['🔔', 'Neu: der Kirchturm. Wecker, Timer, Pomodoro (voll einstellbar) und Stoppuhr – die Glocke läutet im Desktop-Programm, sonst siehst du es.'],
  ['📅', 'Marktplatz → Kalender: dein Google Kalender mit Monat, Woche, Tag und Liste, zum Anlegen und Bearbeiten (einmal „dorf gmail-anmelden“ mit Kalender).'],
  ['🎓', 'Uni-Abgaben und -Prüfungen landen von selbst auf dem To-do-Brett – abhaken geht in beide Richtungen.'],
  ['🏡', 'Mehr Leben im Dorf: kleine Häuschen und neue Deko, im Bau-Modus verschiebbar.'],
  ['🇨🇭', 'Börse: Schweizer Werte (SIX, Franken) und – nach Einrichtung – dein echtes Saxo-Depot mit Rendite, nur lesen.'],
  ['📈', 'Börse ist offen: Depot und Watchlist mit Kursen (nach „dorf boerse-schluessel“), sonntags ein Wochenbericht – gehandelt wird nie.'],
  ['🛡️', 'Corpshaus: Corps-Termine, Corps-Mails, Ämter & Aufgaben; Skills für Veranstaltungen und Übergaben. Absender und Stichworte in Corpshaus/einstellungen.md.'],
  ['🏦', 'Bank ist offen: Kontoauszug (CSV oder PDF) hochladen → Monatsübersicht, Kategorien, Abos, Budget und Sparziele. Rechnungen aus Mails landen als To-do.'],
  ['🛒', 'Einkaufsladen ist offen: Einkaufsliste (auch /einkauf), Wunschliste mit Preisvergleich, sonntags ein Essensplan, der die Zutaten gleich auf die Liste setzt.'],
  ['🏗️', 'Neue Gebäude baust du jetzt selbst (Liste oder Bau-Modus), geschlossene eröffnest du per Knopf.'],
  ['💻', 'Programme für Mac und Windows: Einstellungen → Programme. Eigenes Fenster, Meldungen, Symbol in der Leiste, Schnelleingabe (Strg/⌘+Umschalt+Leertaste), Autostart.'],
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
