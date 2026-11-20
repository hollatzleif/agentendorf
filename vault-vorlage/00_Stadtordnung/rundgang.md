---
titel: Rundgang des Bürgermeisters
# Wie viele Aktivitäten er je Rundgang höchstens angeht (1–3). Seine fälligen eigenen To-dos kommen immer zuerst.
aktivitaeten_je_rundgang: 2
# Was er auf den Rundgängen für dich getan hat: einmal am Tag gebündelt in der Morgenzeitung (ja/nein). Einzelne Meldungen gibt es nie.
meldung: ja
# Geschätzte Kosten eines Laufs je Gewicht (US-Dollar) – danach wählt das Dorf nach Restbudget. Die echten Kosten jedes
# Laufs stehen in Rathaus/rundgang/; passen die Schätzungen nicht, hier anpassen.
kosten_usd:
  klein: 0.08
  mittel: 0.25
  gross: 0.8
# Je Aktivität: aus · jedes (bei jedem Rundgang) · täglich · wöchentlich · monatlich · alle N tage
# Eine Zeile löschen = Standard. Das Dorf wählt nur Aktivitäten, für die es gerade einen Anlass findet und die ins Restbudget passen.
aktivitaeten:
  auftraege-nachhalten: täglich
  dorf-gesundheit: täglich
  uni-fristen-vorbereiten: täglich
  post-unbeantwortet: täglich
  kalender-vorschau: täglich
  todos-ueberfaellig: täglich
  leif-kennenlernen: wöchentlich
  vault-pflegen: wöchentlich
  todos-doppelt: wöchentlich
  eigene-liste-aufraeumen: wöchentlich
  notizen-sichten: wöchentlich
  skills-verbessern: wöchentlich
  karteikarten-luecken: wöchentlich
  uni-lernstand: wöchentlich
  geld-budget-abos: wöchentlich
  wochenziele-abgleich: wöchentlich
  gedaechtnis-verdichten: monatlich
  recherche-auf-vorrat: wöchentlich
  wartet-nachfassen: täglich
  mail-fristen: täglich
  abgaben-nachlese: täglich
  pruefungs-countdown: täglich
  helfer-gegenlesen: täglich
  volle-tage: täglich
  dauer-schaetzen: wöchentlich
  altklausuren: wöchentlich
  moodle-neues: wöchentlich
  wochenvorschau: wöchentlich
  adressbuch-pflegen: wöchentlich
  gewohnheiten-reissen: wöchentlich
  fach-steckbriefe: wöchentlich
  moodle-einsortieren: wöchentlich
  tagesrhythmus: monatlich
  monatsrueckblick: monatlich
  auftraege-verdichten: monatlich
  rathaus-ablage: monatlich
  verwaiste-notizen: monatlich
  tags-vereinheitlichen: monatlich
  newsletter-flut: monatlich
  jku-fristen: monatlich
---

# Rundgang des Bürgermeisters

Wacht der Bürgermeister auf und es gibt nichts Neues, **arbeitet er von selbst**. Die Reihenfolge legt das Dorf fest:

1. **Eigene To-dos** – was er sich aus deinen Aufträgen notiert hat (`Rathaus/buergermeister-todos/`, im Rathaus unter „Schreibtisch“ zu sehen).
2. **Neue Anlässe** – Fristen, hängende Läufe, wichtige Mails (Lagebericht wie bisher).
3. **Aktivitäten aus diesem Katalog** – das Dorf wählt die, die am längsten fällig sind. Vorher prüft der Code ohne KI, ob es überhaupt etwas zu tun gibt; wenn nicht, kostet die Aktivität nichts.

| Aktivität | Was er tut | Kosten |
|---|---|---|
| `auftraege-nachhalten` | hängende oder gescheiterte Schreibtisch-Aufgaben aufgreifen | klein |
| `dorf-gesundheit` | fehlgeschlagene Läufe, kaputte Skills, Konfliktkopien, alte Freigaben | klein |
| `uni-fristen-vorbereiten` | Vorbereitungs-Notiz zur nächsten Abgabe/Prüfung, Teilschritte am To-do | mittel |
| `post-unbeantwortet` | wichtige Mails ohne Antwort: Entwurf oder To-do (nie senden) | mittel |
| `kalender-vorschau` | Überschneidungen und Vorbereitung für die nächsten 48 Stunden | klein |
| `todos-ueberfaellig` | lange überfällige To-dos in kleine Schritte zerlegen | klein |
| `leif-kennenlernen` | aus deinen Korrekturen, Ablehnungen und „Rückgängig“-Klicks Muster ins Gedächtnis | mittel |
| `vault-pflegen` | Konfliktkopien, inhaltsgleiche Dateien, tote Links, leere Notizen → Vorschläge | klein |
| `todos-doppelt` | doppelte To-dos zusammenführen (Papierkorb, wiederherstellbar) | klein |
| `eigene-liste-aufraeumen` | seine eigene Liste ausmisten | klein |
| `notizen-sichten` | aus deinen schnellen Notizen der Woche klare Aufgaben herausziehen | klein |
| `skills-verbessern` | Skills, die oft scheitern: Ursache finden, Anweisung verbessern (mit „Rückgängig“) | mittel |
| `karteikarten-luecken` | Fach mit Folien, aber ohne Karten → ein Helfer über dein Abo | klein |
| `uni-lernstand` | kurzer Lernstand je Fach | klein |
| `geld-budget-abos` | Budget ab 80 %: steckt ein Abo oder Ausreißer dahinter? | klein |
| `wochenziele-abgleich` | Wochenziele ohne To-do und ohne Termin | klein |
| `gedaechtnis-verdichten` | sein Gedächtnis kürzen, wenn es lang geworden ist | mittel |
| `recherche-auf-vorrat` | zu einer nahen Frist im Web recherchieren (nur tagsüber, nur mit halbem Tagesbudget) | groß |
| `wartet-nachfassen` | To-dos „wartet auf …“ am Nachfass-Tag: höflicher Nachfass-Entwurf (nie senden), Hinweis am To-do | mittel |
| `mail-fristen` | Fristen, die der Postbote in Mails erkannt hat, als To-do sichern | klein |
| `abgaben-nachlese` | 2–7 Tage nach einer Frist: abgegeben? Hinweis am offenen Uni-To-do | klein |
| `pruefungs-countdown` | 14, 7 und 3 Tage vor einer Prüfung: Lernplan-Vorschlag bzw. Stand (nichts eingetragen) | mittel |
| `helfer-gegenlesen` | fertige Helfer ohne oder mit fast leerer Ergebnisdatei aufgreifen | klein |
| `volle-tage` | morgen/übermorgen über 6 h verplant: Vorschlag in deiner Tagesnotiz, was sich schieben ließe | klein |
| `dauer-schaetzen` | To-dos der nächsten 7 Tage ohne Schätzung: Dauer eintragen (nur dieses Feld) | klein |
| `altklausuren` | Prüfung in Sicht, `altklausuren/` leer → To-do „Altklausuren besorgen“ | klein |
| `moodle-neues` | Fach mit der nächsten Frist: Helfer „Moodle durchsehen“ (über dein Abo, nur mit Moodle-Browser) | klein |
| `wochenvorschau` | Samstag bis Montagfrüh: eine Seite zur kommenden Woche | klein |
| `adressbuch-pflegen` | wichtige Absender, die öfter schreiben, ins Adressbuch (nur Name, Adresse, Rolle) | klein |
| `gewohnheiten-reissen` | Gewohnheiten unter der Hälfte: ein Vorschlag in der Morgenzeitung (ändert nichts) | klein |
| `fach-steckbriefe` | eine Zeile Wissen je Fach (Lehrende, Abgabe, Prüfung, Unterlagen) in `Rathaus/wissen/` | klein |
| `moodle-einsortieren` | Dateien in `Uni/moodle/` ohne Fach: Vorschlag, wohin sie gehören | klein |
| `tagesrhythmus` | aus Fokuszeiten und erledigten To-dos deinen Tagesrhythmus ins Gedächtnis | klein |
| `monatsrueckblick` | in der ersten Woche des Monats: Rückblick auf den Vormonat | mittel |
| `auftraege-verdichten` | erledigte Aufträge des Vormonats auf einer Seite | mittel |
| `rathaus-ablage` | Notizen im Rathaus älter als 30 Tage nach `Rathaus/ablage/JJJJ-MM/` (mit „Rückgängig“) | klein |
| `verwaiste-notizen` | Notizen ohne Verweis, seit 60 Tagen unverändert → Vorschläge | klein |
| `tags-vereinheitlichen` | Tags in mehreren Schreibweisen → Vorschlag alt → neu | klein |
| `newsletter-flut` | Absender mit vielen unwichtigen Mails → „abbestellen?“ (bestellt nichts ab) | klein |
| `jku-fristen` | Fristen und Förderungen der JKU im Web (nur tagsüber, nur mit halbem Tagesbudget) | groß |

**Budget:** Alles läuft im Tagesbudget aus `aufwachen.md`. Teure Aktivitäten kommen nur dran, wenn noch genug übrig ist; je Rundgang höchstens eine mittlere oder große. Die Schätzungen je Gewicht stehen oben unter `kosten_usd`, die echten Kosten jedes Laufs im Rundgang-Protokoll.
**Nachts** (22–7 Uhr) macht er nur stille Pflege – keine Recherche, keine Rückfragen, keine Meldungen.
**Leine:** Er sendet, bezahlt und gibt nichts ab. Außerhalb des Rathauses ändert er nichts außer deinen Listen (To-dos mit Papierkorb) und Mail-Entwürfen.

Steht hier ein Tippfehler (unbekannte Aktivität, unbekannte Häufigkeit), zeigt das Rathaus den Fehler an, und bis dahin gelten die Standardwerte.

Alle 50 Ideen (40 umgesetzt, die übrigen mit Begründung): `docs/buergermeister-aktivitaeten.md` im Repository.
