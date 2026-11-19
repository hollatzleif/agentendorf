# 50 Aktivitäten für den Bürgermeister, wenn er aufwacht (E192)

Stand 19.11.2026. Leifs Wunsch: Der Bürgermeister soll beim Aufwachen nicht nur auf den Schreibtisch schauen und sich wieder hinlegen, sondern von selbst arbeiten – Vault pflegen, aus alten Protokollen Leifs Arbeitsweise lernen, Offenes aus alten Aufträgen nachhalten.

**Was davon gebaut ist:** 18 Aktivitäten stehen im Katalog (`apps/server/src/rundgang.ts`, an-/abschaltbar in `00_Stadtordnung/rundgang.md`) und sind unten mit ✅ und ihrer ID markiert. Nr. 1 (eigene To-do-Liste abarbeiten) ist fest eingebaut und läuft bei jedem Aufwachen zuerst. Die übrigen 31 sind Ideen für später.

**Für alle gilt die Leine:** kein Senden, Abgeben, Zahlen oder Handeln; Schreiben nur in `Rathaus/`, auf Leifs Listen (To-dos: Löschen = Papierkorb) und als Mail-Entwurf; was er direkt tut, kann Leif zurücknehmen. Keine Aktivität braucht Leifs Klick. Werkzeuge: siehe `docs/werkzeuge-heute.md`.

**Kosten-Gewicht** (API, Bürgermeister-Lauf): klein ≈ 0,08 $, mittel ≈ 0,25 $, groß ≈ 0,80 $ – grobe Annahmen für die Auswahl nach Restbudget. Bei den ✅-Aktivitäten prüft der Code vorher ohne KI, ob es einen Anlass gibt; ohne Anlass kosten sie nichts.

## Die zehn wichtigsten

1. Eigene To-do-Liste abarbeiten (Nr. 1)
2. Offene Aufträge nachhalten (Nr. 2)
3. Leif kennenlernen (Nr. 15)
4. Uni-Fristen vorbereiten (Nr. 21)
5. Unbeantwortete Mails nachfassen (Nr. 29)
6. Kalender: Konflikte und Vorbereitung (Nr. 33)
7. Überfällige To-dos zerlegen (Nr. 37)
8. Vault pflegen (Nr. 7)
9. Skills verbessern, die oft scheitern (Nr. 49)
10. Dorf-Gesundheit prüfen (Nr. 50)

---

## A. Offene Aufträge nachhalten

**1. Eigene To-do-Liste abarbeiten** ✅ fest eingebaut
- Was: Fällige Einträge aus `Rathaus/buergermeister-todos/` zuerst: Bezug prüfen (Chat, Protokoll), erledigen und abhaken oder mit neuem Datum verschieben.
- Nutzen: Nichts aus einem alten Auftrag bleibt liegen („Hat Leif die Mail abgeschickt?“, „Ist der Helfer fertig?“).
- Werkzeuge: `meine_todos_*`, dazu je nach Punkt · Häufigkeit: jedes Aufwachen · Kosten: klein · Ergebnis: dieselbe Liste
- Leine: nur seine eigene Liste; nach 3× Vorlegen ohne Veränderung legt das Dorf den Eintrag eine Woche weg (keine Endlosschleife).

**2. Offene Aufträge nachhalten** ✅ `auftraege-nachhalten`
- Was: Schreibtisch-Aufgaben, die seit über 24 h „in Arbeit“/„Helfer laufen“/„Plan wartet“ sind oder in den letzten 7 Tagen gescheitert sind: Protokoll lesen, Kurzes sofort erledigen, Rest als eigenes To-do.
- Nutzen: Aufträge versanden nicht mehr still.
- Werkzeuge: `vault_suchen`, `vault_lesen`, `meine_todos_anlegen`, `todo_liste`/`todo_anlegen` · täglich · klein · Ergebnis: eigene Liste, höchstens ein To-do für Leif
- Leine: startet nichts neu, was Leif abgelehnt hat.

**3. Eigene Liste aufräumen** ✅ `eigene-liste-aufraeumen`
- Was: Einträge, die seit über 14 Tagen offen sind: erledigt/überholt abhaken, Doppeltes zusammenlegen, ehrliches neues Datum.
- Nutzen: Die Liste bleibt kurz und glaubwürdig.
- Werkzeuge: `meine_todos_lesen`, `meine_todos_erledigen` · wöchentlich · klein · Ergebnis: eigene Liste
- Leine: nur eigene Liste.

**4. Eigene Mail-Entwürfe nachfassen**
- Was: Entwürfe, die er vor über 3 Tagen angelegt hat (aus dem `werkzeug_log`): Liegen sie noch? Dann To-do „Entwurf an X prüfen und senden“ für Leif.
- Nutzen: Entwürfe verstauben nicht im Gmail-Ordner.
- Werkzeuge: bräuchte ein neues Lese-Werkzeug „Entwurf noch da?“ (Gmail `drafts.get`) · täglich · klein · Ergebnis: To-do
- Leine: liest nur eigene Entwürfe, sendet nie.

**5. Helfer-Ergebnisse gegenlesen**
- Was: Helfer, die in den letzten 24 h fertig wurden: Liegt die versprochene Datei am Ablageort, ist sie brauchbar (nicht leer, Thema getroffen)? Sonst Diagnose und eigenes To-do.
- Nutzen: Leif bekommt keine halbfertigen Lernzettel als „erledigt“ gemeldet.
- Werkzeuge: `vault_lesen`, `vault_liste`, `meine_todos_anlegen` · täglich · mittel · Ergebnis: `Rathaus/aufraeumen/`
- Leine: startet höchstens einen neuen Versuch.

**6. „Wartet auf …“ nachfassen**
- Was: Leifs To-dos mit `wartet`, deren Nachfass-Tag erreicht ist: eine höfliche Nachfass-Mail als Entwurf, To-do bekommt den Hinweis „Entwurf liegt bereit“.
- Nutzen: Nachfassen kostet Leif einen Klick statt einer Viertelstunde.
- Werkzeuge: `todo_liste`, `kontakt_suchen`, `post_suchen`, `post_entwurf`/`post_entwurf_neu`, `todo_bearbeiten` · täglich · mittel · Ergebnis: Gmail-Entwurf
- Leine: nur Entwurf.

## B. Vault pflegen

**7. Vault pflegen: Konfliktkopien, Doppeltes, tote Links** ✅ `vault-pflegen`
- Was: Der Code durchsucht den Vault (Konfliktkopien, inhaltsgleiche Notizen, Wikilinks ohne Ziel, leere Notizen). Er prüft Stichproben und schreibt eine Vorschlagsliste, die Leif in zwei Minuten abarbeitet; in `Rathaus/` räumt er selbst auf.
- Nutzen: Obsidian bleibt sauber, Syncthing-Konflikte verschwinden.
- Werkzeuge: `vault_lesen`, `vault_schreiben`, `vault_aendern`, `vault_verschieben` · wöchentlich · klein · Ergebnis: `Rathaus/aufraeumen/…_vault-pflege.md`
- Leine: außerhalb von `Rathaus/` nur Vorschläge; Änderungen in `Rathaus/` mit „Rückgängig“.

**8. Verwaiste Notizen finden**
- Was: Notizen ohne eingehenden Link, älter als 60 Tage: je Notiz Vorschlag „verlinken von …“, „ins Archiv“ oder „kann weg“.
- Nutzen: Wissen geht nicht in Ordnern verloren.
- Werkzeuge: `vault_suchen`, `vault_lesen`, `vault_schreiben` (Code müsste Rückverweise zählen) · monatlich · klein · Ergebnis: `Rathaus/aufraeumen/`
- Leine: nur Vorschläge.

**9. Rathaus aufräumen**
- Was: Vorschläge, Vorbereitungen und Recherchen älter als 30 Tage in Monatsordner sortieren (`Rathaus/ablage/JJJJ-MM/`).
- Nutzen: Das Rathaus bleibt übersichtlich.
- Werkzeuge: `vault_liste`, `vault_verschieben` · monatlich · klein · Ergebnis: `Rathaus/ablage/`
- Leine: nur eigenes Gebäude, jede Verschiebung mit „Rückgängig“; nie `schreibtisch/`, `protokolle/`, `chats/`.

**10. Tags und Frontmatter vereinheitlichen**
- Was: Schreibweisen von Tags (#uni/#Uni/#studium) und fehlende `titel:`-Felder zählen, eine Zuordnung vorschlagen.
- Nutzen: Suche und Obsidian-Ansichten finden alles.
- Werkzeuge: `vault_suchen`, `vault_lesen`, `vault_schreiben` · monatlich · klein · Ergebnis: `Rathaus/aufraeumen/`
- Leine: ändert fremde Dateien nicht.

**11. Übersichtsseiten je Gebäude**
- Was: Je Gebäude eine Seite mit den zehn wichtigsten und den zuletzt geänderten Dateien, verlinkt.
- Nutzen: Einstieg in jedes Gebäude ohne Suchen.
- Werkzeuge: `vault_liste`, `vault_schreiben`/`vault_aendern` · wöchentlich · klein · Ergebnis: `Rathaus/uebersichten/…`
- Leine: schreibt nur im Rathaus.

**12. Leifs Notizen der Woche sichten** ✅ `notizen-sichten`
- Was: Die schnellen Notizen der letzten 7 Tage lesen; klare Aufgaben, die noch nicht auf der To-do-Liste stehen, anlegen (höchstens drei), wiederkehrende Themen nennen.
- Nutzen: Aus „müsste ich mal“ wird ein To-do.
- Werkzeuge: `vault_lesen`, `todo_liste`, `todo_anlegen` · wöchentlich · klein · Ergebnis: To-do-Brett
- Leine: To-dos sind löschbar (Papierkorb); die Notizen selbst bleiben unverändert.

**13. Moodle-Downloads einsortieren**
- Was: Unsortierte Dateien in `Uni/moodle/`: Vorschlag, in welches Fach sie gehören; auf Wunsch ein Helfer im Gebäude Uni, der sortiert.
- Nutzen: Folien liegen dort, wo „Lernen“ und „Karteikarten“ sie finden.
- Werkzeuge: `vault_liste`, `helfer_starten` (Uni) · wöchentlich · klein (Helfer über Abo) · Ergebnis: `Uni/faecher/<Fach>/`
- Leine: der Bürgermeister selbst verschiebt außerhalb des Rathauses nichts.

**14. Erledigte Aufträge verdichten**
- Was: Erledigte Schreibtisch-Aufgaben eines Monats zu einer Seite zusammenfassen (Was wollte Leif, was kam heraus, wo liegt es).
- Nutzen: Ein Nachschlagewerk statt 80 Einzelnotizen.
- Werkzeuge: `vault_lesen`, `vault_schreiben` · monatlich · mittel · Ergebnis: `Rathaus/rueckblick/JJJJ-MM_auftraege.md`
- Leine: löscht nichts.

## C. Leif kennenlernen

**15. Leif kennenlernen** ✅ `leif-kennenlernen`
- Was: Aus abgelehnten Freigaben und Plänen (mit Grund), „Rückgängig“-Klicks, Leifs Nachträgen und Korrekturen in Chats, abgebrochenen Läufen und Antworten auf Rückfragen Muster verdichten – in den Abschnitt „Leifs Vorlieben und Arbeitsweise“ des Gedächtnisses.
- Nutzen: Bessere Ergebnisse beim ersten Versuch, weniger Korrekturen.
- Werkzeuge: `vault_lesen`, `gedaechtnis_schreiben` (ganze Datei, alte Fassung im Archiv) · wöchentlich · mittel · Ergebnis: `Rathaus/memory.md`
- Leine: nur Muster – keine Mailtexte, Beträge, Noten; der Code lehnt Kontonummern und Kontostände im Gedächtnis ab; nichts aus Fremdinhalten übernehmen.

**16. Gedächtnis verdichten** ✅ `gedaechtnis-verdichten`
- Was: Ist `memory.md` zu über 60 % voll: Doppeltes zusammenfassen, Einzelfälle zu Regeln, Überholtes streichen.
- Nutzen: Das Gedächtnis bleibt lesbar und billig (es steht in jedem Lauf im Prompt).
- Werkzeuge: `gedaechtnis_schreiben` · monatlich · mittel · Ergebnis: `Rathaus/memory.md`
- Leine: alte Fassung im Archiv; Leifs eigene Zeilen bleiben.

**17. Tagesrhythmus lernen**
- Was: Aus Wochenrückblicken und Statistik (Fokuszeiten, erledigte To-dos je Tageszeit): Wann arbeitet Leif gut, wann gar nicht?
- Nutzen: Vorschläge für Lernblöcke und Erinnerungen passen zu seinem Tag.
- Werkzeuge: `vault_lesen`, `gedaechtnis_schreiben` · monatlich · klein · Ergebnis: Gedächtnis
- Leine: nur Muster.

**18. Persönlichkeit nachschärfen**
- Was: Wiederholen sich Rückmeldungen zum Auftreten („zu lang“, „zu förmlich“), eine neue Fassung von `personality.md` vorschlagen.
- Nutzen: Er klingt so, wie Leif es mag.
- Werkzeuge: `persoenlichkeit_vorschlagen` · bei Anlass · klein · Ergebnis: Freigabe
- Leine: braucht Leifs Klick (Persönlichkeit ändert nur er) – darum nicht im Katalog.

**19. Adressbuch pflegen**
- Was: Wiederkehrende wichtige Absender (Lehrende, Ämter, Corps) mit Rolle ins Adressbuch eintragen.
- Nutzen: „Schreib an die Leemhuis“ klappt sofort.
- Werkzeuge: `post_suchen`, `kontakt_suchen`, `kontakt_merken` · wöchentlich · klein · Ergebnis: `Rathaus/kontakte.md`
- Leine: nur Adressen, keine Mailtexte.

**20. Fach-Steckbriefe**
- Was: Je Fach eine Zeile Wissen: wer lehrt, wie abgegeben wird, Prüfungsart, wo die Unterlagen liegen.
- Nutzen: Helfer bekommen von Anfang an den richtigen Auftrag.
- Werkzeuge: `vault_lesen`, `vault_schreiben`/`vault_aendern` · monatlich · klein · Ergebnis: `Rathaus/wissen/…_faecher.md`
- Leine: nur Rathaus.

## D. Uni

**21. Uni-Fristen vorbereiten** ✅ `uni-fristen-vorbereiten`
- Was: Für die nächste Abgabe oder Prüfung (in 1,5–10 Tagen) ohne Vorbereitung: Fachordner ansehen, Notiz „Was ist verlangt, was liegt vor, was fehlt, Aufwand, 2–3 Arbeitsblöcke“; fehlen am To-do Teilschritte, 3–5 ergänzen.
- Nutzen: Leif fängt nicht am Vorabend bei null an.
- Werkzeuge: `vault_liste`, `vault_lesen`, `vault_schreiben`, `freie_zeiten`, `todo_liste`, `todo_bearbeiten` · täglich · mittel · Ergebnis: `Rathaus/vorbereitung/`
- Leine: trägt keine Termine ein, startet weder „Abgabe bearbeiten“ noch „Lernen“.

**22. Lernstand je Fach** ✅ `uni-lernstand`
- Was: Lernziele, Wochenrückblick, Noten, Lernsitzungen und Karten je Fach ansehen; eine Zeile je Fach, das schwächste nennen.
- Nutzen: Leif sieht früh, welches Fach hinterherhinkt.
- Werkzeuge: `vault_lesen`, `vault_schreiben` · wöchentlich · klein · Ergebnis: `Rathaus/vorbereitung/…_lernstand.md`
- Leine: startet nichts.

**23. Karteikarten aus Folien anstoßen** ✅ `karteikarten-luecken`
- Was: Fächer mit Folien, aber ohne `karten.md`: für EIN Fach (nächste Prüfung) einen Helfer „Karteikarten erstellen“ starten.
- Nutzen: Karten sind da, bevor die Lernphase beginnt.
- Werkzeuge: `kalender_lesen`, `aktionen_liste`, `helfer_starten` · wöchentlich · klein (Helfer über Abo) · Ergebnis: `Uni/faecher/<Fach>/karten.md`
- Leine: höchstens ein Helfer; die Aktion schreibt nur im Gebäude Uni.

**24. Prüfungs-Countdown**
- Was: 14, 7 und 3 Tage vor einer Prüfung: Lernplan-Vorschlag (Themen × Tage) aus Folien und Lernstand.
- Nutzen: Ein realistischer Plan statt Panik.
- Werkzeuge: `vault_lesen`, `freie_zeiten`, `vault_schreiben` · bei Anlass · mittel · Ergebnis: `Rathaus/vorbereitung/`
- Leine: Termine nur als Vorschlag (Leif nutzt „Lernplan“ in der App).

**25. Neue Moodle-Inhalte prüfen**
- Was: Wöchentlich für das Fach mit der nächsten Frist einen Helfer „Moodle durchsehen“ starten.
- Nutzen: Neue Übungsblätter und Ankündigungen entgehen Leif nicht.
- Werkzeuge: `helfer_starten` (Aktion mit Moodle, Abo) · wöchentlich · klein · Ergebnis: `Uni/faecher/<Fach>/`
- Leine: Moodle nur lesen.

**26. Altklausuren-Lücken**
- Was: Fächer mit Prüfung, aber leerem `altklausuren/`: To-do „Altklausuren besorgen“, dazu öffentlich Auffindbares recherchieren.
- Nutzen: Prüfungsvorbereitung mit echtem Material.
- Werkzeuge: `vault_liste`, Websuche, `todo_anlegen`, `vault_schreiben` · monatlich · mittel · Ergebnis: To-do, `Rathaus/recherche/`
- Leine: lädt nichts von fragwürdigen Seiten in den Vault.

**27. Noten und ECTS im Blick**
- Was: `Uni/noten.md` gegen das Semesterziel: fehlen ECTS, steht eine Note aus?
- Nutzen: Keine Überraschung bei Beihilfen und Fristen.
- Werkzeuge: `vault_lesen`, `vault_schreiben` · monatlich · klein · Ergebnis: `Rathaus/vorbereitung/`
- Leine: Noten kommen nicht ins Gedächtnis.

**28. Abgaben-Nachlese**
- Was: Zwei Tage nach einer Frist: abgehakt? Rückmeldung oder Note eingetragen? Sonst ein To-do.
- Nutzen: Nichts bleibt „fast abgegeben“.
- Werkzeuge: `kalender_lesen`, `todo_liste`, `todo_anlegen` · täglich · klein · Ergebnis: To-do
- Leine: gibt nie ab.

## E. Post

**29. Unbeantwortete Mails nachfassen** ✅ `post-unbeantwortet`
- Was: Wichtige Mails mit „Antwort nötig“, älter als zwei Tage: Entwurf, wenn klar ist, was Leif antworten würde – sonst To-do mit der offenen Entscheidung; eigenes To-do zum Nachsehen.
- Nutzen: Keine wichtige Mail bleibt eine Woche liegen.
- Werkzeuge: `post_lesen`, `post_entwurf`, `todo_liste`, `todo_anlegen`, `meine_todos_anlegen` · täglich · mittel · Ergebnis: Gmail-Entwurf / To-do
- Leine: nur Entwürfe, höchstens drei Mails je Rundgang.

**30. Fristen aus Mails sichern**
- Was: Mails, in denen der Postbote eine Frist erkannt hat, aber ohne To-do: To-do mit Fälligkeit anlegen.
- Nutzen: Anmeldefristen und Rückmeldungen gehen nicht unter.
- Werkzeuge: `post_suchen`, `todo_liste`, `todo_anlegen` · täglich · klein · Ergebnis: To-do
- Leine: To-do als „fremd“ markiert.

**31. Newsletter-Flut melden**
- Was: Absender mit vielen unwichtigen Mails im Monat auflisten („abbestellen?“).
- Nutzen: Ruhigerer Posteingang.
- Werkzeuge: `post_suchen`, `vault_schreiben` · monatlich · klein · Ergebnis: `Rathaus/aufraeumen/`
- Leine: bestellt nichts ab, markiert und löscht keine Mails.

**32. Corps-Termine aus der Post**
- Was: Corps-Mails gegen den Kalender: fehlt ein Termin, den Helfer „Termine aus Mails“ starten.
- Nutzen: Kneipen, Convente und Dienste stehen im Kalender.
- Werkzeuge: `post_suchen`, `kalender_lesen`, `helfer_starten` · wöchentlich · klein · Ergebnis: Kalender (über die Aktion, mit „Rückgängig“)
- Leine: nie Einladungen, nie Zusagen.

## F. Kalender

**33. Kalender: Konflikte und Vorbereitung** ✅ `kalender-vorschau`
- Was: Die nächsten 48 Stunden: Überschneidungen (der Code findet sie), unmögliche Wege (Konstanz ↔ Linz), Termine mit Vorbereitung → To-do oder Zeile in der Tagesnotiz.
- Nutzen: Kein „ach, das war ja heute“.
- Werkzeuge: `kalender_lesen`, `todo_anlegen`, `notiz_anlegen` · täglich · klein · Ergebnis: To-do / Tagesnotiz
- Leine: verschiebt und löscht keine Termine.

**34. Reise Konstanz ↔ Linz vorbereiten**
- Was: Pflichttermine in Linz in den nächsten 14 Tagen: zwei Verbindungen heraussuchen, To-do „Ticket buchen“.
- Nutzen: Günstige Tickets rechtzeitig.
- Werkzeuge: `kalender_lesen`, Websuche, `vault_schreiben`, `todo_anlegen` · wöchentlich · mittel · Ergebnis: `Rathaus/recherche/`
- Leine: bucht und bezahlt nie; keine privaten Daten in Suchanfragen.

**35. Wochenvorschau**
- Was: Sonntagabend eine Seite: Termine, Fristen, große To-dos der Woche, engste Tage.
- Nutzen: Ergänzt das Sonntags-Ritual `/planen`.
- Werkzeuge: `kalender_lesen`, `todo_liste`, `vault_schreiben` · wöchentlich · klein · Ergebnis: `Rathaus/vorbereitung/`
- Leine: plant nichts um.

**36. Volle Tage erkennen**
- Was: Tage mit über sechs Stunden Terminen und fälligen To-dos: Vorschlag, was sich verschieben ließe.
- Nutzen: Realistische Tage.
- Werkzeuge: `kalender_lesen`, `todo_liste`, `notiz_anlegen` · täglich · klein · Ergebnis: Tagesnotiz
- Leine: ändert keine Fälligkeiten.

## G. To-dos

**37. Überfällige To-dos zerlegen** ✅ `todos-ueberfaellig`
- Was: To-dos, die seit über drei Tagen überfällig sind oder dreimal verschoben wurden und keine Teilschritte haben: 3–5 kleine Schritte in die Notiz.
- Nutzen: Der erste Schritt dauert unter 15 Minuten – die Hürde ist weg.
- Werkzeuge: `todo_liste`, `todo_bearbeiten` (nur Notiz) · täglich · klein · Ergebnis: Notiz des To-dos
- Leine: Titel, Datum und Haken bleiben; höchstens drei To-dos je Rundgang.

**38. Doppelte To-dos zusammenführen** ✅ `todos-doppelt`
- Was: Offene To-dos mit gleichem Titel und Datum: Fehlendes ins ältere übernehmen, das jüngere in den Papierkorb.
- Nutzen: Ein aufgeräumtes Brett.
- Werkzeuge: `todo_liste`, `todo_bearbeiten`, `todo_loeschen` · wöchentlich · klein · Ergebnis: To-do-Brett
- Leine: Papierkorb – wiederherstellbar.

**39. Dauer schätzen**
- Was: To-dos dieser Woche ohne Schätzung: geschätzte Dauer ergänzen.
- Nutzen: „Tag planen“ und „Heute“ rechnen richtig.
- Werkzeuge: `todo_liste`, `todo_bearbeiten` (nur `dauer`) · wöchentlich · klein · Ergebnis: To-do
- Leine: nur das Feld `dauer`.

**40. Einkaufsliste vorbereiten**
- Was: Aus Essensplan und dem, was Leif regelmäßig kauft: Vorschlag, was auf die Liste gehört.
- Nutzen: Der Einkauf ist in einer Minute geplant.
- Werkzeuge: `vault_lesen`, `todo_liste` (einkauf), `vault_schreiben` · wöchentlich · klein · Ergebnis: `Rathaus/vorbereitung/` (oder direkt auf die Einkaufsliste)
- Leine: bestellt nichts.

## H. Gewohnheiten und Rückblick

**41. Wochenziele abgleichen** ✅ `wochenziele-abgleich`
- Was: Offene Wochenziele ohne To-do und ohne Termin finden; je Ziel einen ersten Schritt nennen (höchstens zwei).
- Nutzen: Ziele werden Mitte der Woche nicht vergessen.
- Werkzeuge: `vault_lesen`, `todo_liste`, `kalender_lesen` · wöchentlich · klein · Ergebnis: „Für Leif“ in der Morgenzeitung
- Leine: hakt nichts ab, legt nichts an.

**42. Gewohnheiten, die reißen**
- Was: Welche Gewohnheit ist seit zwei Wochen unter der Hälfte? Ein Vorschlag (kleiner, andere Uhrzeit, anderer Auslöser).
- Nutzen: Gewohnheiten werden angepasst statt aufgegeben.
- Werkzeuge: `vault_lesen` (Wochenrückblick, `gewohnheiten.md`) · wöchentlich · klein · Ergebnis: „Für Leif“
- Leine: ändert `gewohnheiten.md` nicht.

**43. Monatsrückblick**
- Was: Am Monatsanfang aus Wochenrückblicken, erledigten To-dos und Fokuszeit eine Seite schreiben.
- Nutzen: Fortschritt wird sichtbar.
- Werkzeuge: `vault_lesen`, `vault_schreiben` · monatlich · mittel · Ergebnis: `Rathaus/rueckblick/JJJJ-MM.md`
- Leine: keine Beträge aus der Bank.

## I. Geld

**44. Budget-Abweichung und Abos** ✅ `geld-budget-abos`
- Was: Budget-Kategorien ab 80 %: Steckt ein teurer gewordenes oder doppeltes Abo dahinter? Nur bei echtem Fund ein To-do.
- Nutzen: Geldlecks fallen im Monat auf, nicht am Ende.
- Werkzeuge: `vault_lesen` (Bank/), `todo_anlegen` · wöchentlich · klein · Ergebnis: To-do „Bank: …“
- Leine: bezahlt und kündigt nichts; Beträge weder ins Gedächtnis noch in die Sammelmeldung.

**45. Depot-Auffälligkeiten**
- Was: Positionen mit starker Wochenbewegung: kurze Nachrichtenlage dazu.
- Nutzen: Leif weiß, warum sich etwas bewegt.
- Werkzeuge: `vault_lesen` (Boerse/), Websuche, `vault_schreiben` · wöchentlich · mittel · Ergebnis: `Rathaus/recherche/`
- Leine: kein Handel, keine Empfehlung; keine Depotgrößen in Suchanfragen.

**46. Fixkosten-Kalender**
- Was: Wiederkehrende Zahlungen (ÖH-Beitrag, Miete, Versicherung, Corps) in den nächsten 14 Tagen: To-do, falls keins da ist.
- Nutzen: Keine Mahngebühren.
- Werkzeuge: `vault_lesen`, `todo_liste`, `todo_anlegen` · wöchentlich · klein · Ergebnis: To-do
- Leine: zahlt nie.

## J. Recherche auf Vorrat

**47. Recherche auf Vorrat** ✅ `recherche-auf-vorrat`
- Was: EIN Thema, das Leif in zwei Wochen sicher braucht (nahe Frist, To-do mit „recherchieren/vergleichen“): drei bis fünf Kernpunkte mit Quellen.
- Nutzen: Die Vorarbeit ist getan, wenn er anfängt.
- Werkzeuge: Websuche/-abruf (höchstens 6), `vault_lesen`, `vault_schreiben` · wöchentlich · groß · Ergebnis: `Rathaus/recherche/`
- Leine: nur tagsüber und nur mit mindestens dem halben Tagesbudget; keine privaten Daten in Suchanfragen (E185-Risiko bleibt, jeder Abruf steht im `werkzeug_log`).

**48. Förderungen und Fristen der JKU**
- Was: Stipendien, Beihilfen, Auslandssemester, Rückmelde- und Anmeldefristen: Was steht in den nächsten zwei Monaten an?
- Nutzen: Leif verpasst kein Geld und keine Frist.
- Werkzeuge: Websuche, `vault_schreiben`, `todo_anlegen` · monatlich · groß · Ergebnis: `Rathaus/recherche/`, To-do
- Leine: stellt keine Anträge.

## K. Selbstverbesserung und Dorf

**49. Skills verbessern, die oft scheitern** ✅ `skills-verbessern`
- Was: Skills mit zwei oder mehr gescheiterten Läufen oder drei Leinen-Ablehnungen in 14 Tagen: Ursache finden; liegt es an der Anweisung, verbesserte Fassung anlegen.
- Nutzen: Derselbe Fehler passiert nicht dreimal.
- Werkzeuge: `vault_lesen`, `aktion_anlegen` (ersetzen), `gedaechtnis_schreiben` · wöchentlich · mittel · Ergebnis: Skill bzw. `Rathaus/aufraeumen/`
- Leine: alte Fassung im Archiv, „Rückgängig“; Skills mit Zeitplan oder Schutz gehen wie immer als Freigabe an Leif; Werkzeuge und Motor bleiben.

**50. Dorf-Gesundheit prüfen** ✅ `dorf-gesundheit`
- Was: Der Code sammelt: Läufe mit Fehlern (24 h), wiederholt scheiternde System-Aufrufe, Skills mit Fehlern, Fehler in `rundgang.md`, Konfliktkopien, Freigaben älter als drei Tage. Er schätzt die Ursache ein und legt höchstens EIN gesammeltes To-do an.
- Nutzen: Leif erfährt von Störungen, bevor er sie selbst bemerkt.
- Werkzeuge: `vault_lesen`, `todo_liste`, `todo_anlegen`, `aktion_anlegen` · täglich · klein · Ergebnis: To-do „Dorf: …“
- Leine: ändert keine Einstellungen in `00_Stadtordnung/`.
