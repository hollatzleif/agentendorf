# Entscheidungen

Jede Entscheidung mit Datum, Begründung und – wo sinnvoll – verworfener Alternative.

## 2026-11-16 – Grundlagen (Planfreigabe durch Leif)

**E1 – Stack: TypeScript durchgehend, Fastify, SQLite, React/Vite, PWA, später PixiJS und Tauri.** Ein Typensystem für alles, geteilte Typen in `packages/shared`. SQLite statt Postgres: ein Nutzer, kleiner Server (KVM 1, 4 GB), Backup = eine Datei.

**E2 – Server: Hostinger KVM 1 bleibt.** 1 vCPU / 4 GB reichen mit Obergrenze 2 `claude-code`- und 4 `api`-Agenten gleichzeitig. Auslastung wird gemessen; KVM 2 erst, wenn es klemmt.

**E3 – Bauweg: GitHub + Actions.** Die Cloud-Sitzung, in der gebaut wird, erreicht den VPS nicht per SSH. Actions testet, baut das Docker-Image und schickt ein Bündel (`VERSION`, `deploy/`, `image.tar.gz`) per SSH. Der CI-Schlüssel ist auf dem Server per `command=` auf `empfangen` beschränkt. Keine Container-Registry nötig, kein Git auf dem Server. *Folge:* Wer das GitHub-Repo bzw. die Actions-Secrets kontrolliert, kann Code auf dem Server ausführen → GitHub-Konto mit 2FA schützen.

**E4 – Backup nur auf dem Server, genau 7 Tage.** restic, täglich 03:30, `forget --keep-within-daily 7d --prune`, danach `restic check`. Gesichert: Vault, konsistente DB-Kopie, Syncthing-Konfiguration, `.env`. Leif hat sich bewusst gegen eine Kopie außer Haus entschieden (schützt nicht vor Serverausfall). Getestet: Rotation (11 Sicherungen → 7 Stände), Wiederherstellungstest, echte Wiederherstellung.

**E5 – Handy ohne Vault.** Nur PWA; Syncthing auf MacBook, Windows-PC und Windows-Laptop.

**E6 – Modellstufen:** klein = `claude-sonnet-5-5`, mittel = `claude-opus-5-5`, groß = `claude-fable-5-2` (Leifs Festlegung). Steht in `00_Stadtordnung/modelle.md`. Aufwand je Stufe ausdrücklich gesetzt, weil die Standardwerte je Modell verschieden sind.

**E7 – `claude-code`-Motor = unverändertes `claude`-CLI im Headless-Modus, nicht das Agent SDK.** Laut Anthropic-Doku (Legal & Compliance, Authentication; geprüft 16.11.2026): Abo-Login ist für normale, persönliche Nutzung gedacht; erlaubt ist, dass der Nutzer sich selbst am unveränderten Claude-Code-Programm anmeldet, auch auf einem Server. Für selbstgebaute Anwendungen mit dem Agent SDK verlangt Anthropic API-Schlüssel. Daher: `claude setup-token` durch Leif selbst, Token nur im Werkstatt-Container. Abo nur für Läufe, die Leif per Klick startet; alles Zeitgesteuerte über `api`. Notschalter `alle_auf` in `00_Stadtordnung/motoren.md`. *(Umsetzung in Etappe 2a.)*

**E8 – Etappenplan angepasst.** Etappe 2 geteilt (2a Agenten-Kern, 2b Bürgermeister + Telegram); To-do-Daten in Etappe 4 vorgezogen (der Bürgermeister braucht sie beim Aufwachen); PWA-Grundgerüst schon in Etappe 1.

## 2026-11-16 – Etappe 1

**E9 – Keine Drizzle-ORM, sondern handgeschriebene SQL-Migrationen** (`src/db.ts`, `PRAGMA user_version`). Die paar Tabellen rechtfertigen keine zusätzliche Abstraktion; better-sqlite3 ist synchron und typisiert genug. Abweichung vom Plan.

**E10 – Eigener Mini-Router und eigene TOTP-Implementierung.** Statt React Router bzw. otplib: wenige Zeilen, keine Abhängigkeit, deren API sich zwischen Hauptversionen ändert. TOTP gegen die RFC-6238-Testvektoren getestet.

**E11 – Konflikte werden nie still aufgelöst.** Speichert die App eine Datei, die seit dem Öffnen woanders geändert wurde (Prüfsumme weicht ab), entsteht `name.konflikt-JJJJMMTT-HHMMSS.md` daneben. Syncthing legt eigene `.sync-conflict-…`-Dateien an. Beide erscheinen in den Einstellungen und als Hinweis im Kopf der App.

**E12 – Löschen = Papierkorb.** `.papierkorb/<zeit>/<pfad>` im Vault, von Syncthing ausgenommen (`.stignore`), in der App ausgeblendet, aber im Backup enthalten.

**E13 – Neue Dateinamen werden bereinigt** (Umlaute → ae/oe/ue/ss, Sonderzeichen → `-`, reservierte Windows-Namen vermieden), damit Syncthing zwischen macOS, Windows und Linux keine Probleme macht. Bestehende Dateien mit Umlauten (z. B. aus Obsidian) bleiben unangetastet. Die Suche findet „Übung“ und „Uebung“ gegenseitig.

**E14 – Sicherheit der Sitzungen:** Cookie-Wert nur als SHA-256 in der DB, 30 Tage gleitend, Widerruf trennt auch die WebSocket-Verbindungen sofort. Login-Drossel: 5 freie Fehlversuche je IP, dann 30 s, 60 s, 2 min … max. 15 min; global ab 30 Fehlversuchen in 15 min eine Minute Pause. Während der Sperre wird das Passwort gar nicht geprüft.

**E15 – TOTP-Geheimnis liegt unverschlüsselt in der SQLite-Datei.** Wer Dateizugriff auf den Server hat, kontrolliert das Dorf ohnehin; das Backup ist von restic verschlüsselt. Notfall ohne Handy: `dorf totp-aus` auf dem Server.

**E16 – Docker-Container `dorf` läuft schreibgeschützt** (`read_only`, keine Capabilities, `no-new-privileges`, eigener Benutzer), nur `/vault` und `/daten` sind beschreibbar; kein Port nach außen, nur Caddy spricht mit ihm. Syncthing-Oberfläche nur über `127.0.0.1` (SSH-Tunnel).

**E17 – Strenge Content-Security-Policy (Caddy).** Nur eigene Skripte, keine externen Bilder/Skripte/Verbindungen. Folge: Bilder aus dem Internet in Notizen (`![](https://…)`) werden nicht angezeigt – bewusst, damit Fremdinhalte (Mails, Webseiten) keine Tracking-Pixel nachladen. Bilder gehören in den Vault.

**E18 – Domain: kostenlose DuckDNS-Subdomain** (Leif, 16.11.2026). Eigene Domain gibt es nicht; die Hostinger-Adresse `srv….hstgr.cloud` wird verworfen, weil sich dort alle Hostinger-Kunden die Let's-Encrypt-Grenzen teilen. duckdns.org steht auf der Public-Suffix-Liste. Die IP wird einmalig im DuckDNS-Konto gesetzt (VPS-IP ist fest). Domain steht nur in `/srv/dorf/.env` und ist jederzeit austauschbar.

## 2026-11-16 – Etappe 2a (Agenten-Kern)

Leifs Vorgaben: Protokoll eins pro Chat; Web nur pro Aktion und nie mit Fremdinhalten; Abo: Max.

**E19 – claude-code-Motor ohne `--bare`.** Laut Doku liest `--bare` kein `CLAUDE_CODE_OAUTH_TOKEN` (nur API-Schlüssel). Stattdessen: eigenes `CLAUDE_CONFIG_DIR` im Werkstatt-Volume, `--setting-sources user`, `--strict-mcp-config`, `--disable-slash-commands`, Arbeitsordner außerhalb des Vaults (`/arbeit/<lauf>`), Vault nur per `--add-dir /vault` und read-only gemountet.

**E20 – Die Werkstatt baut die claude-Argumente selbst** (`apps/werkstatt/src/auftrag.ts`), das Dorf schickt nur einen per Zod geprüften Auftrag. So kann auch ein Fehler im Dorf keine Flags wie `--dangerously-skip-permissions` einschleusen. Eingebaute Werkzeuge nur `Read,Glob,Grep` (+ `WebSearch,WebFetch`, wenn erlaubt); Schreiben ausschließlich über den MCP-Server `dorf` → interne Schnittstelle (Port 3001, nicht über Caddy) → `WerkzeugKiste` mit Leine. Das Werkzeug-Token gilt nur während des Laufs.

**E21 – Agenten dürfen ihre eigenen Anweisungen nicht ändern.** `gebaeude.md`, `aktionen/`, `protokolle/` und `chats/` sind für Agenten tabu – sonst könnte ein präparierter Inhalt sich dauerhaft in künftige Läufe einschreiben. Überschreiben nur von Dateien, die derselbe Chat angelegt hat; alles andere per Freigabe `datei_ueberschreiben`.

**E22 – Protokoll pro Chat, Fakten vom Code.** Motor, Modell, Token, Dauer, gelesene/geschriebene Dateien, Freigaben und Leinen-Verweigerungen kommen aus `laeufe` und `werkzeug_log`; der Agent liefert nur die Zusammenfassung. Jeder weitere Lauf hängt einen Abschnitt an.

**E23 – api-Motor: eigene Streaming-Schleife statt Tool Runner**, weil jeder Werkzeugaufruf durch die Leine laufen, live gemeldet und abbrechbar sein muss. Beta-Endpunkt mit `fallbacks: "default"` (serverseitige Ausweichmodelle bei Ablehnungen), Prompt-Caching, Aufwand je Stufe, kein erzwungenes `tool_choice`, Werkzeuge `strict`. Verlauf wird nur angehängt; fehlende `tool_result`s nach einem Abbruch werden als Fehler-Ergebnis nachgetragen.

**E24 – Motorwechsel in einem Chat:** Der neue Motor bekommt den bisherigen Verlauf als Text (claude-code-Sitzungen und API-Verläufe sind nicht ineinander übertragbar).

**E25 – Echter API-Test erst auf dem Server.** In der Cloud-Sitzung, in der gebaut wird, lässt sich für api.anthropic.com kein eigener Schlüssel hinterlegen. Beide Motoren sind hier gegen Nachbauten getestet (nachgebautes Modell; nachgebautes `claude`, das echt über MCP ins Dorf schreibt); echte Läufe sind Teil der Abnahme auf dem Server.

**E26 – Abo-Token-Weg:** `dorf claude-anmelden` startet `claude setup-token` in der Werkstatt (Anthropics eigener Anmeldeablauf); Leif fügt das Token ein, es landet nur in `/srv/dorf/werkstatt.env`. Die App sieht es nie.

## 2026-11-17 – Etappe 2b (Bürgermeister + Telegram)

**E27 – Grafik fürs Dorf (Etappe 5): freie CC0-Sets + selbst gezeichnete Effekte** (Leif). Gebäude aus einem CC0-Set (Kandidat: Polyy.AI „City Builder: Village Buildings“), Boden/Bäume aus einem passenden zweiten Set; Figuren, Rauch, Brief- und Baustellen-Symbole selbst gezeichnet. Keine Grafiken oder Nachbauten bestehender Spiele. Auswahl mit Probe-Bildschirmfotos zu Beginn von Etappe 5; Lizenzen in `LIZENZEN.md`.

**E28 – Reihenfolge bleibt:** 2b vor dem Dorf (Leif, 17.11.2026).

**E29 – Bürgermeister = Aktion mit `rolle: buergermeister`** (`Rathaus/aktionen/buergermeister.md`, in Obsidian und App bearbeitbar). Nur diese Rolle bekommt `aktionen_liste`, `helfer_starten`, `plan_vorlegen` – für beide Motoren über dieselbe WerkzeugKiste bzw. den MCP-Weg. Fehlt die Datei in einem älteren Vault, ergänzt das Dorf sie beim Start (nie überschreiben).

**E30 – Helfer-Regel (Leif): ein Helfer ohne Rückfrage, ab zwei Helfern nur mit freigegebenem Plan (max. 10).** Im Code durchgesetzt (`MAX_HELFER_OHNE_PLAN`, `MAX_HELFER_PRO_PLAN`). Nach Leifs Okay startet der **Code** genau die Teilaufgaben des Plans – der Agent kann nach dem Vorlegen nichts mehr starten. Ausgelöst als `buergermeister` → Motor der Aktion (Abo), weil Leifs Klick zugrunde liegt. Abschluss (Liste der Helfer mit Links) schreibt der Code genau einmal, ohne weiteren Modellaufruf.

**E31 – Schreibtisch:** Aufgaben aus App und Telegram starten den Bürgermeister sofort (Leif). Notizen aus Obsidian oder von Agenten werden nur aufgenommen (Status `neu`) und per „Bearbeiten lassen“ bzw. ab Etappe 4 beim Aufwachen bearbeitet. Weitergeleitete Telegram-Nachrichten sind Fremdinhalt: Ihr Text kommt nie direkt in den Auftrag, nur als Anhang in der Fremdinhalt-Hülle.

**E32 – Telegram ohne Bibliothek, mit Long Polling:** kein offener Port, nur `fetch`. Nur EIN gekoppelter Chat (`dorf telegram-einrichten`: Token prüfen, `/start` abwarten, Chat-ID bestätigen); alles andere wird ignoriert. Knöpfe tragen eine HMAC-Signatur (Schlüssel aus dem Werkstatt-Geheimnis abgeleitet) und gehen über `freigaben.entscheiden` – genau einmal, auch bei Doppelklick oder zweitem Gerät. Meldungen (Freigaben, Entwürfe, Fehler, jede beendete Aufgabe; Mails aus) schaltbar in `00_Stadtordnung/telegram.md`. Senden blockiert nie das Dorf; Ausfälle der Bot-API werden protokolliert und mit wachsendem Abstand erneut versucht. Sprachnachrichten: noch nicht (Hinweis an Leif).

**E33 – Bearbeiten in der Bibliothek:** Während Leif bearbeitet, ersetzt kein Serverstand seinen Text (vorher konnte ein verspäteter Stand Getipptes überschreiben – von Browser-Tests gefunden). Ändert sich die Datei woanders, erscheint nur ein Hinweis; beim Speichern entsteht notfalls eine Konfliktkopie.

## 2026-11-17 – Etappe 3 (Uni)

**E34 – Moodle über die offizielle App-Schnittstelle, kein ferngesteuerter Browser.** JKU-Moodle hat sie aktiv (`tool_mobile_get_public_config` am 17.11.2026: `typeoflogin 2`, SSO „JKU Single Sign On“, keine Funktionen abgeschaltet). `dorf moodle-anmelden` nutzt den Weg der Moodle-App: `launch.php` mit einem zufälligen Prüfwert, Weiterleitung auf `moodlemobile://token=BASE64(md5(wwwroot+prüfwert):::token…)`. Die Signatur wird geprüft. Vor dem Speichern prüft `core_webservice_get_site_info`, ob alle nötigen Funktionen erlaubt sind (sonst STOPP, Regel „nichts erfinden“). Das Token liegt nur in `/srv/dorf/.env`, nie im Vault und nie in Links. Dateien lädt das Dorf nur von der eigenen Moodle-Adresse (`webservice/pluginfile.php`). **Offen bis zur Abnahme:** ob die `moodlemobile://`-Weiterleitung im Browser wie beschrieben abzugreifen ist.

**E35 – Abgleich ohne Modell, alle 3 Stunden** (Leif). Nur Kurse „inprogress“ (aktuelles Semester). Pro Kurs: `kurs.md`, `folien/<NN Abschnitt>/` (Ressourcen und Ordner), `aufgaben/<Abgabe>/aufgabe.md` mit `fremdinhalt: true`, Frist und Status, Anhänge daneben. Geladen wird nur Neues oder Geändertes (Zeitstempel+Größe), über 100 MB wird übersprungen und gemeldet. Hat Leif eine abgeglichene Datei geändert, bleibt seine Fassung; die neue kommt als Konfliktkopie daneben. Gelöschtes kommt erst wieder, wenn Moodle es ändert. Fristen kommen aus Abgaben und Kalender (Tests); ein gleichbleibender Fehler wird per Telegram nur einmal gemeldet. Zwischen Anfragen liegt eine kurze Pause, um JKU zu schonen.

**E36 – HTML von Agenten nur abgeschottet.** `.html` ist jetzt im Agenten-Schema erlaubt. Angezeigt wird es über `/api/vault/seite` mit `CSP: sandbox allow-scripts` (ohne `allow-same-origin` → undurchsichtiger Ursprung, kein Zugriff auf App, Cookies, Speicher), `default-src 'none'` und `connect-src 'none'` (kein Nachladen, kein Hinausschicken) sowie im iframe `sandbox="allow-scripts"`. Caddy setzt `X-Frame-Options: DENY` nur noch, wenn das Dorf nichts anderes schickt. Restrisiko: Ein Skript könnte den eigenen Rahmen auf eine fremde Adresse umleiten und dabei nur Inhalte der Seite selbst mitgeben. Die Lern-Prompts verlangen deshalb eigenständige Seiten (inline CSS/JS, MathML, SVG), kein `localStorage` und den Report im Textfeld statt in der Zwischenablage.

**E37 – Rechenraum statt Shell in der Werkstatt.** Für LaTeX und Python gibt es einen eigenen Container: internes Docker-Netz ohne Internet, kein Vault, Dateisystem schreibgeschützt, Arbeitsordner pro Chat in tmpfs, 120 s pro Befehl, Grenzen für CPU, RAM und Prozesse, eigenes Geheimnis. Die Werkzeuge `rechenraum_*` gibt es nur für Aktionen mit `werkzeuge: [rechenraum]`, für beide Motoren über die WerkzeugKiste. Weil der Raum kein Netz hat, ist er auch mit Fremdinhalten erlaubt (Web und Fremdinhalte bleiben getrennt). Heraus kommen nur `.pdf`/`.tex` über `rechenraum_ablegen`, in einen **vom Code** bestimmten Ordner (`Uni/faecher/<Fach>/entwuerfe/JJJJ-MM-TT_HHMM_<abgabe>/`). PDF-Seiten gehen als Bild an das Modell (api: image-Block im tool_result; claude-code: MCP-Bildinhalt).

**E38 – Aktions-Eingaben vom Server (`quelle: uni.faecher | uni.abgaben`).** Die Auswahl liefert der Server, und beim Start wird gegen genau diese Liste geprüft. So kommen keine erfundenen Pfade in Prompt oder Anhänge.

**E39 – „Lernen“ und „Abgabe bearbeiten“ mit Leifs Prompts**, Stufe groß (Fable 5.2), Motor claude-code (Abo), Werkstatt `--max-turns 200`. Schritt 3/4 des Lern-Prompts laufen durch Fortsetzen des Chats. Leifs LaTeX-Präambel steht wörtlich in der Aktion, die CI kompiliert sie im echten Image. „Schick mir die PDFs“ wurde zu „leg sie ab“, abgegeben wird nie automatisch. Beide Aktionen ergänzt das Dorf in bestehenden Vaults (nie überschreiben).

**E40 – Rechenraum-Image nur bei Bedarf ausliefern.** Kennung = Hash über Dockerfile und Runner. Die CI fragt per erzwungenem SSH-Befehl `hat-image <kennung>`, ob der Server es schon hat (ältere `dorf`-Skripte kennen die Frage nicht, dann gilt „nein“). Fehlt das Image auf dem Server und im Bündel, schaltet `dorf empfangen` nicht um. Nicht mehr gebrauchte Rechenraum-Images werden aufgeräumt.

**E41 – JKU sperrt den Moodle-App-Zugang → Fristen über den Kalender-Export, Dateien legt Leif selbst ab** (Leif, 17.11.2026). `launch.php` antwortet mit „Der WebService ist nicht verfügbar (existiert nicht oder ist gesperrt)“: Der Dienst `moodle_mobile_app` ist ausgeschaltet. `tool_mobile_get_public_config` hatte das nicht verraten (E34 schloss daraus zu viel). Kein ferngesteuerter Browser und keine übernommenen Sitzungs-Cookies: Beides wäre brüchig, Leifs JKU-Passwort läge auf dem Server, und es verstößt vermutlich gegen die Nutzungsregeln.
- Fristen: Moodle-Kalender-Export (iCal, `calendar/export_execute.php?…authtoken=…`), alle 3 h. Die Adresse ist ein Geheimnis und steht nur in `/srv/dorf/.env` (`dorf moodle-kalender` prüft sie vor dem Speichern). Eigener iCal-Leser (Faltung, Escapes, Zeitzonen). „Erledigt“ hakt Leif ab, ein Abgleich ändert das nicht. Verschwundene Termine fallen aus der Liste. Telegram meldet nur bevorstehende neue Fristen. Die Art (Abgabe/Test/Termin) kommt aus dem Titel („ist fällig“, „schließt“ …).
- Fächer = Ordner unter `Uni/faecher/` (in der App: „Fach anlegen“). Abgaben = Unterordner oder PDFs in `aufgaben/`, ohne `aufgaben/erledigt/`. `quelle: uni.faecher/uni.abgaben` kommen daraus. Der Ablageordner im Rechenraum lässt `.pdf` im Namen weg.
- Der App-Weg (E34/E35) bleibt im Code, falls die JKU ihn freischaltet.
- Vorlagen: Aktualisiert werden nur Dateien, die byte-genau einer früheren Vorlagenfassung entsprechen (Hashes in `dorf.ts`). Von Leif Geändertes bleibt unangetastet.

**E42 – `dorf` bricht nie still ab.** `tr </dev/urandom | head` scheiterte mit `pipefail` ohne Meldung (`dorf moodle-anmelden` tat nichts). Zufallswerte kommen jetzt aus einer endlichen Quelle (`zufall`), eine ERR-Falle nennt Zeile und Befehl. Ein Test startet das Skript als eigenen Prozess.

**E43 – Abgaben „erledigt?“ = Leifs Haken; Telegram erinnert** (Leif). Ob abgegeben wurde, kann das Dorf an der JKU nicht prüfen: Der App-Zugang ist gesperrt, der Kalender-Export enthält keinen Status. Die Fristenliste ist darum die To-do-Liste. Für nicht Abgehaktes kommen Erinnerungen (Abgaben 3 Tage, 1 Tag, 3 Stunden vorher, Tests 1 Tag und 3 Stunden vorher) und eine Stunde nach der Frist die Nachfrage „erledigt?“ (bis 7 Tage danach). Jede Nachricht hat den Knopf „✅ Erledigt“ (HMAC-signiert wie die Freigabe-Knöpfe, nur aus Leifs Chat). Pro Frist kommt höchstens eine Nachricht auf einmal: Beim Nachholen zählt nur die dringendste Stufe. Wird eine Frist verschoben, wird neu erinnert. Geprüft wird alle 10 Minuten, schaltbar über `erinnerungen` in `00_Stadtordnung/telegram.md`.

**E44 – Studium zeigt Leifs Google-Kalender: Fristen aus seinem Skript und Pflichttermine; nur Laufendes und Kommendes** (Leif, 17.11.2026). Welche Lehrveranstaltung Anwesenheitspflicht hat, steht in keinem Moodle-Export. Leifs Google-Apps-Skript „Moodle-Fristen-Wächter“ ordnet das bereits ein, das Dorf liest deshalb dessen Ergebnis (geheime iCal-Adressen, nur in `/srv/dorf/.env`, `dorf google-kalender`):
- Kalender „Moodle-Fristen (automatisch)“: `⏰ Kurs: …` = Abgabe (Eintrag endet zur Frist → Frist = Ende), `📝 Kurs: …` = Prüfung/Test, `✅ …` = erledigt. Erledigt gilt in beide Richtungen nur als „an“: Ein Haken im Dorf bleibt, auch wenn Google kein ✅ hat. Das Dorf kann nicht in Google schreiben.
- Kalender „JKU Pflicht“: nur `Pflicht: …` (Art `pflicht`) und `Prüfung: …` (Art `test`). Alles andere, auch Privates, wird weder gespeichert noch angezeigt.
- Serientermine: eigener RRULE-Leser (DAILY/WEEKLY mit BYDAY/MONTHLY/YEARLY ohne BY…, INTERVAL, COUNT, UNTIL, EXDATE, RECURRENCE-ID, abgesagt). Gerechnet wird in Ortszeit, damit die Zeitumstellung stimmt. Unbekannte Regeln liefern nur den ersten Termin plus Hinweis.
- Anzeige: nur Laufendes oder Kommendes (`COALESCE(ende, frist) ≥ jetzt`). Pflichttermine nur für die nächsten 7 Tage, Abgaben und Prüfungen alle. Vorlesungen haben keinen Haken und keine Erinnerung. Neue Abgaben und Prüfungen meldet Telegram, nicht jede einzelne Vorlesung einer Serie.
- Der direkte Moodle-Kalender (E41) würde dieselben Fristen doppelt liefern: `dorf google-kalender` entfernt ihn, seine Einträge räumt der nächste Abgleich weg.

**E45 – Telegram: Gesprächszusammenhang** (Leif). Bisher wurde jede Nachricht eine neue Aufgabe ohne Kontext. Jetzt gilt für reinen Text: (1) Antwort auf eine Bot-Nachricht → genau deren Chat, egal wie alt. (2) Sonst wird das Gespräch mit dem Bürgermeister fortgesetzt, solange der letzte Austausch weniger als 60 Minuten zurückliegt. (3) Sonst und nach `/neu` entsteht eine neue Aufgabe. Fortsetzen = `nachrichtSenden` im selben Chat (api: Verlauf wird angehängt, claude-code: `--resume`). Die Bestätigung sagt, was passiert ist („↪️ Weiter im Gespräch“ / „📥 Neue Aufgabe“). Weitergeleitetes und Dateien werden immer neue Aufgaben, damit Fremdinhalt nie direkt in einen Auftrag gelangt. Antwortet Leif auf eine Dorf-Nachricht ohne Chat (z. B. eine Erinnerung), geht deren Text als Bezug in der Fremdinhalt-Hülle mit. Die Zuordnung Nachricht → Chat steht in `telegram_verlauf` (Migration 7).

## 2026-11-17 – Etappe 4 (Post, Kalender, Morgenzeitung, Aufwachen)

**E46 – Gmail per OAuth, nur `gmail.readonly` + `gmail.compose`** (Leif). Eigenes Google-Cloud-Projekt von Leif, Desktop-Client, PKCE (S256) und `state`. Rückleitung auf `http://127.0.0.1:8765/`: Dort lauscht nichts, Leif kopiert die Adresse ins Terminal (`dorf gmail-anmelden`, wie bei Moodle). Client-ID, -Schlüssel und Refresh-Token stehen nur in `/srv/dorf/.env`. Senden ist nicht angefragt, das Dorf kann technisch nicht senden. **Ungeprüft:** Die offizielle Google-Doku war aus der Bauumgebung nicht erreichbar. Laut Foren laufen Refresh-Tokens im Status „Testing“ nach 7 Tagen ab, in „Production“ nicht (unverifizierte App mit Warnhinweis). Das prüfen wir bei der Einrichtung. Läuft die Anmeldung ab, sagt das Dorf das klar (`invalid_grant` → „dorf gmail-anmelden“).

**E47 – Postbote: Abruf alle 10 Minuten, Einordnung ohne Werkzeuge, nur Kurzfassungen.** Erster Abruf: Posteingang der letzten 7 Tage. Danach Gmail-Verlauf (`history`), ist er zu alt, die letzten 3 Tage. Nur `INBOX` (kein Spam, Papierkorb, Entwurf, Gesendet). Eingeordnet wird in Stapeln bis 20 über `SystemAufrufe` (api, Stufe klein, `output_config.format` JSON-Schema, `fallbacks: default`, **kein `tools`-Feld**). Mails stehen in der Fremdinhalt-Hülle, Texte gekürzt auf 4000 Zeichen. In DB und Vault landen nur Kopfdaten und eine Ein-Satz-Zusammenfassung (entschärft: keine Zeilenumbrüche, kein HTML, keine Wikilinks). Mailtexte werden nicht gespeichert. Scheitert die Einordnung, wird sie bis zu 3-mal nachgeholt. Tagesdatei `Post/eingang/JJJJ-MM-TT.md` mit `fremdinhalt: true`: Hat Leif sie bearbeitet, kommt die neue Fassung als Konfliktkopie.

**E48 – Automatische KI-Aufrufe werden als System-Chat verbucht.** Ein Chat pro Gebäude und Monat (`rolle: system`, z. B. „Post: Einordnung · 2026-11“), jeder Aufruf ist ein Lauf mit Token und Kosten. So erscheinen sie in der Verbrauchsanzeige und sind nachvollziehbar, ohne Inhalte (nur „20 Mails einordnen“ → „20 eingeordnet (3 wichtig) – Uni 5, …“).

**E49 – Morgenzeitung: Fakten vom Code, Einleitung von der KI, 06:30 Linzer Zeit** (Leif). Abschnitte: Heute (Hauptkalender + Pflicht/Prüfungen der Uni), Fristen der nächsten 7 Tage (nicht abgehakt), wichtige Mails seit der letzten Ausgabe, seit gestern erledigt (ohne System-Chats), wartet auf dich (Freigaben, Schreibtisch). Die 2–3 Sätze Einleitung kommen von `SystemAufrufe` (api, Stufe klein, ohne Werkzeuge, Fakten in der Fremdinhalt-Hülle). Fehlt der Schlüssel oder scheitert der Aufruf, erscheint die Zeitung ohne Einleitung. Ausgabe in `Rathaus/morgenzeitung/JJJJ-MM-TT.md` (Leifs Änderungen bleiben, Konfliktkopie), im Rathaus-Reiter und per Telegram (Schalter `morgenzeitung`). Eine verpasste Ausgabe (Server aus) wird bis 12 Uhr nachgeholt. Der Hauptkalender (dritte geheime iCal-Adresse) wird nur beim Drucken gelesen und **nie gespeichert**, dort steht Privates.

**E50 – Aufwachen: Code prüft, KI nur bei Neuem** (Leif: „bearbeiten an der Leine“). Weckzeiten 7, 9, …, 21 Uhr (Linz). Der Code geht neue Schreibtisch-Aufgaben (z. B. aus Obsidian) selbst an, höchstens 3 pro Aufwachen. Dann sammelt er Anlässe ohne KI: Abgaben/Prüfungen < 72 h ohne Haken, Freigaben > 24 h, Läufe mit Fehler, hängende Läufe, wichtige Mails mit „Antwort nötig“. Nur bei **neuen** Anlässen (Schlüssel gemerkt, Fristen einmal pro Tag) entsteht eine Schreibtisch-Aufgabe „Lagebericht“ (Quelle `aufwachen`, Punkte in der Fremdinhalt-Hülle) für den Bürgermeister. Er darf höchstens einen Helfer starten und schlägt sonst Pläne vor. „Abgabe bearbeiten“, „Lernen“ und Antwortentwürfe gibt es nur per Plan. Telegram meldet sich nur, wenn er etwas getan oder vorgeschlagen hat.

**E51 – Was von selbst startet, läuft über api – auch die Helfer.** Startet der Bürgermeister aus einem Lauf mit Auslöser `zeitplan` einen Helfer, bekommt der Helfer ebenfalls `zeitplan` und damit `api`. Nur Pläne, die Leif per Klick freigibt, dürfen wie bisher (E30) Leifs Abo nutzen.
