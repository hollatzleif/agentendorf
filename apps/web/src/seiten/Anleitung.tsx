import { linkKlick } from '../router';
import { Em } from '../apple/wissen-teile';

/**
 * „So nutzt du das Dorf“ (Nacht 18./19.11.): der Tages- und Wochenrhythmus mit den Bausteinen der App –
 * kurz, mit Links. Kein Handbuch, sondern ein Vorschlag, wie alles zusammenspielt.
 */
const L = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} onClick={linkKlick}>
    {children}
  </a>
);

export function Anleitung() {
  return (
    <article className="karte anleitung">
      <h1>So nutzt du das Dorf</h1>
      <p className="leise">Ein Vorschlag für den Rhythmus – nimm, was dir hilft. Alles geht auch per Telegram (/hilfe).</p>

      <h2>
        <Em e="☀️" /> Morgens (5 Minuten)
      </h2>
      <ol>
        <li>
          <b>Morgenzeitung</b> lesen (Telegram, 06:30): Termine, Fristen, ⭐ Wichtiges, Wochenziele, Gewohnheiten.
        </li>
        <li>
          <b>🧭 Tag planen</b> (Knopf in der Zeitung, /plan oder auf <L href="/heute">Heute</L>): die wichtigsten To-dos landen als Blöcke in freien Kalenderlücken – du wählst, was eingetragen wird.
        </li>
        <li>
          Liegt etwas Überfälliges herum: <b>🧹 Aufräumen</b> (/aufraeumen) – heute, morgen, nächste Woche oder weg.
        </li>
        <li>
          Die <b>Tagesleiste</b> über den Terminen auf <L href="/heute">Heute</L> zeigt auf einen Blick, wo heute noch Platz ist (gestrichelt = frei).
        </li>
      </ol>

      <h2>
        <Em e="🍅" /> Tagsüber
      </h2>
      <ul>
        <li>
          Nicht lange überlegen: <b>👉 Jetzt dran</b> auf „Heute“ (Telegram: <b>/jetzt</b> oder „👉 Was zuerst?“ unter der Morgenzeitung) zeigt, was in die Zeit bis zum nächsten Termin passt – „🍅 Los“.
        </li>
        <li>
          Am wichtigsten To-do mit <b>🍅 Fokus</b> arbeiten – am besten im <L href="/fokus">Vollbild</L>. Telegram hält solange Meldungen zurück; danach fragt es, ob das To-do erledigt ist. Im Vollbild: <b>💭 Gedanken parken</b> (Enter – landet in der Tagesnotiz) und <b>🔊 Rauschen</b> gegen Ablenkung.
        </li>
        <li>
          Gedanken sofort festhalten: <b>„notiz: …“</b> in Telegram oder Strg/⌘+K → „notiz …“. Aufgaben: <b>„todo: …“</b>, auch „… jeden Montag“.
        </li>
        <li>
          Realistisch planen: am To-do <b>⏱ Dauer</b> schätzen (Telegram: „/todo Referat üben 45 min“) – „Heute“ warnt, wenn die geplanten To-dos nicht bis 22 Uhr passen.
        </li>
        <li>
          Wartest du auf jemanden? „Note Mathe <b>wartet auf</b> Prof. Müller“ – das To-do ruht unter <b>⏳ Wartet auf</b>, bis der Tag zum Nachfassen da ist (Datum im To-do).
        </li>
        <li>
          Große Abgabe in zwei Wochen? Im To-do-Brett <b>🪜</b> verteilt sie rückwärts in Etappen bis zur Frist – daraus wird automatisch ein Projekt mit Fortschritt.
        </li>
        <li>
          <b>🧠 / 🪶 Energie</b> am To-do (im Brett beim Bearbeiten): „Jetzt dran“ schlägt Schweres in deiner besten Tageszeit vor (Rathaus → Statistik), Leichtes abends und in kurzen Lücken.
        </li>
        <li>
          Am PC: <b>n</b> neues To-do, <b>f</b> Fokus, <b>g w</b> Wochenplan, <b>?</b> alle Tastenkürzel.
        </li>
        <li>
                    Großes To-do, kein Anfang? <b>☑ +</b> am To-do → Teilschritte eintragen oder <b>✂️ Vorschlagen</b> lassen. „Heute“ zeigt dann nur den nächsten Schritt. Notizen werden unter Rathaus → Notizen mit <b>→ To-do</b> zur Aufgabe.
        </li>
        <li>
          Zeitgebundenes: <b>/erinner morgen 9 Uhr …</b> – der Kirchturm läutet, Telegram meldet sich.
        </li>
        <li>
          Lernen: <L href="/gebaeude/Uni?reiter=karten">Karteikarten</L> (/karten) in Pausen; vor Prüfungen fragt der Prüfungs-Wächter nach einem Lernplan.
        </li>
      </ul>

      <h2>
        <Em e="🌙" /> Abends (2 Minuten)
      </h2>
      <ol>
        <li>
          <b>Tagesabschluss</b> (Telegram, 21:00): Erledigtes, Fokus, was morgen fällig ist. Früher fertig? <b>/morgen</b> zeigt den nächsten Tag jederzeit – samt Warnung, wenn sich Termine überschneiden.
        </li>
        <li>
          <b>⭐ Was ist morgen wichtig?</b> antippen – dann steht es morgen ganz oben.
        </li>
        <li>
          <b>🔁 Gewohnheiten</b> abhaken und <b>💭 Wie war dein Tag?</b> – ein Tipp.
        </li>
      </ol>
      <p>
        Lieber am PC? <L href="/abschluss">Tag abschließen</L> macht das Gleiche auf einer Seite – plus Liegengebliebenes neu verteilen und den Kopf in die Tagesnotiz leeren (ab 19 Uhr auf „Heute“ verlinkt).
      </p>

      <h2>
        <Em e="🗓️" /> Sonntags (10 Minuten)
      </h2>
      <p>
        Alles auf einer Seite: <L href="/planen">Woche planen</L> führt durch die vier Schritte.
      </p>
      <ol>
        <li>
          <b>Wochenrückblick</b> (18:30): Bilanz von Zielen, Gewohnheiten, Fokus, Stimmung – und Vorschläge.
        </li>
        <li>
          Vorschläge mit einem Tipp als <b>🎯 Wochenziele</b> übernehmen – oder auf <L href="/heute">Heute</L> selbst drei setzen.
        </li>
        <li>
          Woche verteilen im <L href="/gebaeude/Marktplatz?reiter=wochenplan">Wochenplan</L>: To-dos aus dem Eingang auf die Tage ziehen oder mit <b>✨ Woche verteilen</b> vorschlagen lassen – die Leiste zeigt, welcher Tag schon voll ist.
        </li>
        <li>
          Ein Blick auf die <L href="/gebaeude/Rathaus?reiter=statistik">Statistik</L> und ins Dorf: Je aktiver die Woche, desto mehr blüht es. 🌸 Ab ein paar Wochen Stimmung zeigt <b>💡 Was gute Tage ausmacht</b>, was deine guten Tage gemeinsam haben.
        </li>
        <li>
          <b>📁 Projekte</b> (<L href="/gebaeude/Marktplatz?reiter=projekte">Marktplatz → Projekte</L>, /projekte): To-dos mit derselben <b>Gruppe</b> sind ein Projekt – mit Fortschritt, nächstem Schritt und „💤 ruht“, wenn eine Woche nichts passiert ist.
        </li>
      </ol>

      <h2>
        <Em e="🎓" /> Im Semester
      </h2>
      <ul>
        <li>
          Je Fach ein <b>Lernziel pro Woche</b> (🎯 auf der Fach-Karte) – <b>/lernen</b> in Telegram startet den Pomodoro dafür. Vor Prüfungen: <L href="/gebaeude/Uni?reiter=pruefungen">Prüfungs-Cockpit</L>.
        </li>
        <li>
          Uni-Fristen kommen von selbst als To-dos; <b>📅 am To-do</b> plant Lernzeit oder einen ganzen Lernplan bis zur Prüfung.
        </li>
        <li>
          <L href="/gebaeude/Uni?reiter=noten">Noten & ECTS</L> eintragen – Schnitt und Fortschritt rechnet das Dorf.
        </li>
        <li>„Karteikarten erstellen“ macht aus deinen Folien abfragbare Karten.</li>
      </ul>

      <h2>
        <Em e="🔌" /> Was fehlt noch?
      </h2>
      <p>
        Unter <L href="/einstellungen#anschluesse">Einstellungen → Anschlüsse</L> siehst du, was verbunden ist – und den Befehl für den Server, falls nicht (z. B. Google-Kalender für Tag planen und Lernplan).
      </p>
    </article>
  );
}
