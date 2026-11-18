import { useState } from 'react';
import { navigieren } from '../router';

/** Bei jeder neuen Ausgabe den Schlüssel ändern – dann erscheint die Karte einmal pro Gerät */
const AUSGABE = '2026-11-19s';
const SCHLUESSEL = 'dorf-neuigkeiten-gesehen';

const PUNKTE: [string, string][] = [
  ['👉', '„Jetzt dran“ auf Heute: ein To-do, das in die Lücke bis zum nächsten Termin passt – „🍅 Los“ startet den Fokus. Am To-do steht jetzt auch die Fokuszeit (🍅 / ⏱).'],
  ['🗓️', 'Wochenplan auf dem Marktplatz: To-dos auf Mo–So ziehen, je Tag Auslastung aus Schätzungen und Terminen – ideal für die Planung am Sonntag.'],
  ['⏱', 'Zeitschätzung am To-do („… 30 min“ in Telegram) – „Heute“ zeigt, ob der Tag reicht, „Tag planen“ nimmt die Schätzung als Blocklänge.'],
  ['☑', 'To-dos in Teilschritte zerlegen – selbst oder per „✂️ Vorschlagen“ (KI); „Heute“ zeigt den nächsten Schritt. Notizen werden mit einem Klick zum To-do.'],
  ['🔔', 'Börse: Kursalarm – Grenze unter/über setzen, Telegram meldet sich einmal, wenn ein Schlusskurs sie überschreitet.'],
  ['📷', 'Foto mit „notiz: …“ in Telegram landet samt Bild in der Tagesnotiz. Gewohnheiten lassen sich jetzt bearbeiten (Tage, Uhrzeit).'],
  ['🧭', 'Neu: „So nutzt du das Dorf“ (/anleitung) – der Tages- und Wochenrhythmus mit allen Bausteinen auf einer Seite.'],
  ['🌸', 'Das Dorf blüht, wenn du aktiv bist: Blumen, Licht, eine Fahne am Rathaus bei erreichten Wochenzielen, Feuerwerk an starken Tagen.'],
  ['📶', 'Offline angelegte To-dos und Notizen werden gemerkt und von selbst gesendet.'],
  ['🚀', '„Heute“ zeigt „Erste Schritte“ – fünf Dinge zum Ausprobieren, die sich von selbst abhaken.'],
  ['⛶', 'Fokus-Vollbild (/fokus oder „⛶ Vollbild“ auf Heute): nur Uhr, Thema und Knöpfe.'],
  ['📝', 'Rathaus → Notizen, Countdown zur nächsten Prüfung auf „Heute“, Stimmung als Diagramm, sonntags die nächste Woche planen.'],
  ['🔌', 'Einstellungen → Anschlüsse: was verbunden ist und was fehlt – mit dem Befehl für den Server.'],
  ['📚', 'Prüfungs-Wächter: steht eine Prüfung an und noch keine Lernzeit im Kalender, fragt Telegram – zwei Tipps und der Lernplan ist eingetragen.'],
  ['💭', 'Abends fragt Telegram „Wie war dein Tag?“ – die Stimmung steht in /statistik und im Wochenrückblick.'],
  ['🔁', 'Gewohnheiten jetzt auch „3× pro Woche“ (Serie in Wochen) und mit Uhrzeit – dann läutet der Kirchturm.'],
  ['📱', 'Telegram: /woche, /statistik, /suche, „todo: …“ ohne Schrägstrich, Knöpfe in der Morgenzeitung, Vorschläge aus dem Wochenrückblick als Wochenziel.'],
  ['🍅', 'Nach dem Pomodoro an einem To-do: „✓ To-do erledigt“ direkt im Kirchturm-Hinweis.'],
  ['🎓', 'Neu: Uni → Noten – ECTS, Noten, gewichteter Schnitt und Fortschritt zu deinem Ziel (z. B. 180 ECTS). Steht auch in Uni/noten.md.'],
  ['🧹', 'Neu: Überfälliges aufräumen – /aufraeumen in Telegram (heute, morgen, nächste Woche, erledigt …) oder „→ heute/→ morgen“ direkt auf „Heute“.'],
  ['📚', 'Neu: Lernplan bis zur Prüfung – 📅 am To-do → „Lernplan bis zur Frist“: Stunden wählen, das Dorf verteilt die Blöcke gleichmäßig in freie Zeiten, du trägst ein.'],
  ['📝', 'Neu: schnelle Notizen – „notiz …“ in der Befehlspalette oder /notiz in Telegram. Landen in der Tagesnotiz Rathaus/notizen/ (auch in Obsidian).'],
  ['🔔', 'Neu: Erinnerungen an To-dos – beim Bearbeiten eine Zeit wählen oder in Telegram „/erinner morgen 9 Uhr Mama anrufen“. Der Kirchturm läutet, Telegram schickt Erledigt / +1 h / Morgen.'],
  ['📊', 'Neu: Rathaus → Statistik – erledigte To-dos, Fokus und Gewohnheiten der letzten 4 Wochen oder 3 Monate.'],
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
  const [alle, setAlle] = useState(false);
  if (zu) return null;
  const gezeigt = alle ? PUNKTE : PUNKTE.slice(0, 8);
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
        {gezeigt.map(([s, t]) => (
          <li key={t}>
            <span aria-hidden>{s}</span> {t}
          </li>
        ))}
      </ul>
      {!alle && PUNKTE.length > 8 && (
        <button type="button" className="klein" onClick={() => setAlle(true)}>
          Ältere Neuigkeiten ({PUNKTE.length - 8})
        </button>
      )}
      <p className="leise">
        Wie alles zusammenspielt:{' '}
        <a href="/anleitung" onClick={(e) => (e.preventDefault(), schliessen(), navigieren('/anleitung'))}>
          So nutzt du das Dorf
        </a>
      </p>
      <button className="dorf-knopf text haupt" onClick={schliessen}>
        Alles klar
      </button>
    </section>
  );
}
