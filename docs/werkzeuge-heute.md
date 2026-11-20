# Werkzeuge der Agenten – Stand 20.11.2026 (nach E199)

Aus `apps/server/src/agenten/werkzeuge.ts` und `werkzeuge-extra.ts` (E199) zusammengestellt: 62 Dorf-Werkzeuge plus die eingebauten Fähigkeiten der Motoren.
Wer welches Werkzeug bekommt, regelt `agenten/leine.ts`: Der **Bürgermeister** hat Vault, To-dos, Kalender, Post, Adressbuch, Kirchturm, Notizen, Web und seine Organisations-Werkzeuge immer; **Helfer** bekommen, was ihre Aktion nennt (`werkzeuge: [...]`) bzw. freie Helfer per `faehigkeiten`; To-dos, Kirchturm, Notizen und Termine haben alle.

**Nie möglich:** Mails senden, bezahlen, Abgaben einreichen, Shell/Schreiben außerhalb der Leine. Was sich zurückholen lässt, tun Agenten direkt (Leif bekommt „Rückgängig“).

## Vault (Dateien, Notizen, Wissen)

| Werkzeug | Was es tut |
|---|---|
| `vault_lesen` | Liest eine Textdatei aus dem Vault (Markdown, TXT, CSV, JSON) |
| `vault_liste` | Listet Dateien und Ordner eines Vault-Ordners (eine Ebene) |
| `vault_suchen` | Volltextsuche im Vault |
| `vault_schreiben` | Legt eine Markdown-Datei im eigenen Gebäude an (oder auf Rathaus/schreibtisch/) |
| `vault_aendern` | Ändert eine bestehende Textdatei im eigenen Gebäude: entweder genau EINE Stelle ersetzen (suchen + ersetzen; „suchen“ muss genau einmal vorkommen) oder Text ans Ende anhängen (anhaengen) |
| `vault_verschieben` | Verschiebt oder benennt eine Datei im eigenen Gebäude um (zum Sortieren) |
| `notiz_anlegen` | Hängt eine schnelle Notiz an Leifs Tagesnotiz Rathaus/notizen/JJJJ-MM-TT.md an („- HH:MM Text“) – für Gedanken oder Infos, die Leif festhalten will |

## Bürgermeister (Organisation, Helfer, Lernen)

| Werkzeug | Was es tut |
|---|---|
| `aktionen_liste` | Nur für den Bürgermeister: Liste aller Aktionen in allen offenen Gebäuden (ID, Name, Beschreibung, Eingaben, Stufe, Motor) |
| `helfer_starten` | Nur für den Bürgermeister: startet einen Helfer ohne Rückfrage – nur für große oder lange Arbeit, Kurzes erledigst du selbst |
| `plan_vorlegen` | Nur für den Bürgermeister: Plan mit 1–10 Teilaufgaben für mehrere Helfer |
| `aktion_anlegen` | Nur für den Bürgermeister: legt einen Skill (Aktion) für ein Gebäude an oder ersetzt mit ersetzen: true einen bestehenden (alte Fassung ins Archiv) – nur, wenn Leif das wünscht oder eine Aufgabe regelmäßig wiederkommt; NIE für … |
| `gedaechtnis_schreiben` | Nur für den Bürgermeister: ersetzt dein Gedächtnis Rathaus/memory.md durch die GANZE neue Fassung (die alte kommt automatisch ins Archiv Rathaus/archiv/memory/) |
| `persoenlichkeit_vorschlagen` | Nur für den Bürgermeister: schlägt Leif eine neue Fassung deiner Persönlichkeit Rathaus/personality.md vor (wie du auftrittst: Ton, Länge, Art der Antworten) |
| `meine_todos_lesen` | Nur für den Bürgermeister (E192): seine EIGENE To-do-Liste lesen (Rathaus/buergermeister-todos/) – was aus früheren Aufträgen noch offen ist, fällige zuerst |
| `meine_todos_anlegen` | Nur für den Bürgermeister (E192): trägt am Ende eines Laufs Offenes auf seine eigene Liste ein (mit „wieder ansehen am“; Bezug zur Schreibtisch-Aufgabe bzw. zum Chat automatisch) |
| `meine_todos_erledigen` | Nur für den Bürgermeister (E192): hakt einen eigenen Eintrag ab (mit Ergebnis) oder legt ihn mit `wieder_am` auf später |
| `rueckfrage` | Stellt Leif EINE kurze Frage (App und Telegram, mit Antwort-Knöpfen für die optionen) – nur wenn du es wirklich nicht selbst herausfinden kannst |

## To-dos und Listen

| Werkzeug | Was es tut |
|---|---|
| `todo_liste` | Eine von Leifs Listen lesen (Standard: To-do-Liste vom Marktplatz; auch Einkaufsliste, Wunschliste, Corps-Aufgaben): offene Einträge (fällige zuerst), dazu Erledigtes der letzten 14 Tage |
| `todo_anlegen` | Neuer Eintrag auf einer von Leifs Listen (Standard: To-do-Liste; „einkauf“ für die Einkaufsliste) |
| `todo_bearbeiten` | Ein To-do ändern oder abhaken (erledigt: true) bzw |
| `todo_loeschen` | Ein To-do entfernen (landet im Papierkorb, Leif kann es wiederherstellen) |

## Kalender

| Werkzeug | Was es tut |
|---|---|
| `kalender_lesen` | Liest Leifs Termine der nächsten Tage: Hauptkalender (auch Privates), Uni-Fristen (Abgaben, Prüfungen – mit „erledigt“, wenn Leif sie abgehakt hat) und Pflichttermine |
| `termin_anlegen` | Trägt einen Termin direkt in Leifs eigenen Hauptkalender ein – ohne Gäste, nie mit Einladungen |
| `termin_aendern` | Verschiebt oder ändert einen Termin in Leifs Kalender |
| `termin_loeschen` | Löscht einen Termin aus Leifs Kalender (gefunden über Tag und Titel) |
| `freie_zeiten` | Freie Lücken in Leifs Kalender (08–20 Uhr, mit Puffer zu anderen Terminen), je Tag höchstens ein Vorschlag – um Termine sinnvoll zu legen. |

## Post (Gmail – nie senden)

| Werkzeug | Was es tut |
|---|---|
| `post_suchen` | Sucht in Leifs Posteingang (Mails, die das Dorf kennt): Absender, Betreff und Kurzfassung enthalten den Suchtext (mehrere Wörter = alle müssen vorkommen) |
| `post_lesen` | Liest eine Mail aus Leifs Posteingang vollständig (Absender, Betreff, Text) |
| `post_entwurf` | Legt in Leifs Gmail einen ENTWURF als Antwort auf genau diese Mail an (an den Absender, im selben Verlauf) |
| `post_entwurf_neu` | Legt in Leifs Gmail einen NEUEN Entwurf an (ohne Bezug zu einer Mail) |
| `post_entwurf_aendern` | Ersetzt Text (und auf Wunsch Betreff) eines Entwurfs, den DIESER Chat angelegt hat – statt einen zweiten anzulegen |
| `kontakt_suchen` | Sucht eine Mail-Adresse zu einem Namen: in Leifs Adressbuch (Rathaus/kontakte.md), in den Absendern seines Posteingangs und in seinen gesendeten Mails |
| `kontakt_merken` | Trägt eine gefundene Adresse in Leifs Adressbuch ein, damit sie beim nächsten Mal sofort da ist |
| `post_anhang_lesen` | E199: Anhänge einer Mail auflisten; mit `nr` speichern (Post/anhaenge/) und lesen wie `vault_lesen` – Fremdinhalt |

## Kirchturm (Uhren)

| Werkzeug | Was es tut |
|---|---|
| `kirchturm_lesen` | Zeigt, was im Kirchturm (Leifs Uhren auf dem Server) läuft: Pomodoro mit Phase, Restzeit und Einstellungen, Timer, Wecker, Stoppuhr und was gerade klingelt – mit den IDs für kirchturm_timer und kirchturm_wecker. |
| `kirchturm_timer` | Timer im Kirchturm (läuft auf dem Server und klingelt in App, Programm und Cardputer) |
| `kirchturm_wecker` | Wecker im Kirchturm (Ortszeit Wien) |
| `pomodoro` | Pomodoro im Kirchturm steuern: start (mit titel oder todo_pfad beginnt eine neue Fokusrunde genau dafür – die Fokuszeit zählt für dieses To-do), pause, weiter, ueberspringen (nächste Phase), stopp |
| `pomodoro_einstellen` | Pomodoro-Einstellungen ändern – nur die angegebenen Felder, der Rest bleibt (aktuelle Werte zeigt kirchturm_lesen) |

## Moodle (JKU, nur lesen)

| Werkzeug | Was es tut |
|---|---|
| `moodle_oeffnen` | Öffnet eine Seite in Leifs JKU-Moodle (eigener Browser, angemeldet als Leif, NUR LESEN) |
| `moodle_klicken` | Folgt Link/Knopf Nummer [nr] der zuletzt gezeigten Moodle-Seite und gibt die neue Seite zurück. |
| `moodle_seite` | Zeigt die aktuelle Moodle-Seite noch einmal (Text + nummerierte Links). |
| `moodle_zurueck` | Eine Seite zurück (wie der Zurück-Knopf). |
| `moodle_bild` | Bildschirmfoto der aktuellen Moodle-Seite – wenn der Text allein nicht reicht (Tabellen, Fortschrittsanzeigen, Bilder). |
| `moodle_herunterladen` | Lädt die Datei hinter Link [nr] (Folien, Übungsblätter, PDFs) in den Vault: nach Uni/faecher/<fach>/moodle/, wenn ein bestehendes Fach angegeben ist, sonst nach Uni/moodle/ |

## Rechenraum (LaTeX, Python, PDF – ohne Internet)

| Werkzeug | Was es tut |
|---|---|
| `rechenraum_befehl` | Führt einen Shell-Befehl im eigenen Arbeitsordner des Rechenraums aus (bash, Zeitlimit 120 s), z |
| `rechenraum_schreiben` | Schreibt eine Textdatei in den Arbeitsordner des Rechenraums (z |
| `rechenraum_vault_kopieren` | Kopiert eine Datei aus dem Vault (z |
| `rechenraum_seite_ansehen` | Rendert eine Seite eines PDFs im Arbeitsordner als Bild und zeigt sie dir – für die Sichtprüfung (Ränder, Layout, Vergleich mit dem Original). |
| `rechenraum_ablegen` | Legt eine fertige Datei aus dem Arbeitsordner im Vault ab (PDF, TeX, Office, CSV, Bilder, ZIP, ICS, Anki …) |
| `pdf_bearbeiten` | E199: PDFs zusammenfügen, teilen, Seiten drehen/löschen/ordnen, komprimieren, Wasserzeichen, Formular lesen/ausfüllen – Ergebnis im Ablage-Ordner |
| `diagramm_zeichnen` | E199: Graphviz-DOT → SVG/PNG/PDF (Mermaid nur als Block in einer Notiz) |
| `daten_abfragen` | E199: SQL (DuckDB) über CSV/Excel/ODS/JSON/Parquet aus dem Vault; ohne SQL Spalten und erste Zeilen; Ergebnis auf Wunsch als CSV |
| `qr_code` | E199: QR-Code (PNG/SVG) für Link, Text, WLAN, vCard |
| `karten_anki` | E199: Karteikarten eines Fachs als Anki-Paket (.apkg) – auch als Knopf „Für Anki“ in der App |

## Recherche, Unterwegs, Alltag (E199)

| Werkzeug | Wer | Was es tut |
|---|---|---|
| `literatur_suchen` | nur mit Web | Echte Literatur: Crossref (DOI, Zitationen), arXiv (Preprints mit Abstract), Open Library (Bücher mit ISBN) |
| `doi_bibtex` | nur mit Web | BibTeX zu einer DOI (doi.org); mit `merken` an `Uni/literatur.bib` (jede DOI einmal, „Rückgängig“) |
| `verbindung_suchen` | nur mit Web | Zug-/Öffi-Verbindungen (Transitous): Abfahrt, Ankunft, Dauer, Umstiege, Gleise – nur Auskunft, kein Buchen |
| `wetter_vorhersage` | nur mit Web | Vorhersage bis 16 Tage für einen Ort (Open-Meteo) |
| `feiertage` | alle | Gesetzliche Feiertage Österreich + Baden-Württemberg (lokal gerechnet) |
| `umrechnen` | alle | Einheiten (lokal) und Währungen zum EZB-Referenzkurs |

## Freigaben (nur echte Außenwirkung)

| Werkzeug | Was es tut |
|---|---|
| `freigabe_beantragen` | Nur für das Wenige, das Leif freigeben muss: datei_loeschen {pfad} und datei_ueberschreiben {pfad, inhalt} (Dateien außerhalb deines Gebäudes oder geschützte Dateien) |

## Eingebaut in den Motoren (keine Dorf-Werkzeuge)

| Fähigkeit | Wo | Was es tut |
|---|---|---|
| `web_search` | api-Motor (Bürgermeister, Aktionen mit `web`) | Websuche von Anthropic (bis 8 je Lauf) |
| `web_fetch` | api-Motor | Webseite/PDF einer Adresse abrufen (bis 8 je Lauf) |
| `WebSearch`, `WebFetch` | claude-code-Motor (Werkstatt) | dasselbe im Abo-Motor, wenn die Aktion Web erlaubt |
| `Read`, `Glob`, `Grep` | claude-code-Motor | Vault lesen und durchsuchen (Read kann auch PDFs und Bilder ansehen) |
| Bilder/PDFs ansehen | beide Motoren | Anhänge eines Chats werden dem Modell gezeigt (siehe Anhänge) |

Insgesamt: **62 Dorf-Werkzeuge** + die eingebauten Fähigkeiten der beiden Motoren.
