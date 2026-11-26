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

**E27 – Grafik fürs Dorf (Etappe 5): freie CC0-Sets + selbst gezeichnete Effekte** (Leif). *Ersetzt durch E52 (3D, alles selbst modelliert).* Gebäude aus einem CC0-Set (Kandidat: Polyy.AI „City Builder: Village Buildings“), Boden/Bäume aus einem passenden zweiten Set; Figuren, Rauch, Brief- und Baustellen-Symbole selbst gezeichnet. Keine Grafiken oder Nachbauten bestehender Spiele. Auswahl mit Probe-Bildschirmfotos zu Beginn von Etappe 5; Lizenzen in `LIZENZEN.md`.

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

## 2026-11-17 – Etappe 5 (Dorf)

**E52 – Das Dorf ist echtes 3D im Browser, alles selbst im Code modelliert (ersetzt E27)** (Leif). Die Proben „CC0-Set (Kenney)“ und „flache Isometrie im eigenen Stil“ gefielen Leif nicht. Er wollte den Look von Aufbauspielen wie SimCity BuildIt. Umgesetzt mit three.js (MIT): echtes 3D, schräg von oben, Straßennetz, Grundstücke, Wald und Hügel. **Keine fremden Grafiken:** Alle Häuser, Figuren, Autos und Symbole entstehen aus Grundformen im Code (`apps/web/src/dorf/modelle.ts`). Spielgrafik, Symbole oder Oberfläche von SimCity oder anderen Spielen werden nicht übernommen, nur das Genre. Den Kenney-Download hätte Leif selbst laden müssen (Downloadschutz, nicht umgangen). Er ist damit hinfällig. Lizenzen in `LIZENZEN.md`.
- Jedes Gebäude der Vorlage hat ein eigenes Modell: Rathaus mit Uhrturm, Uni mit Säulenportal, Bibliothek mit Kuppel, Post mit Lieferwagen, Marktplatz mit Ständen, Corpshaus in Fachwerk, Bank, Börse, Laden. Gebäude ohne eigenes Modell werden Wohnhäuser mit Farben und Form aus dem Namen. „Noch nicht eröffnet“ und kaputte `gebaeude.md` erscheinen als Baustelle mit Kran.
- Rote Dächer sind dem Fristsignal vorbehalten. Kein Gebäude hat von sich aus ein rotes Dach.
- Leistung: Pro Haus werden alle Teile je Material zu einem Mesh zusammengefasst (`bausatz.ts`), der Wald ist instanziert. three.js (ca. 175 KB gz) wird nur für die Dorfseite nachgeladen. Bei Software-Grafik (Testbrowser, sehr schwache Geräte) zeichnet die Szene nur bei Änderungen neu, ohne Daueranimation (`sparsam`). „Bewegung reduzieren“ des Geräts wird beachtet. Ohne WebGL oder bei einem Fehler erscheint automatisch die Liste.

**E53 – Layout auf dem Server, mit Versionsnummer statt Überschreiben.** Das Layout (Gebäude-Grundstücke 4×4 Felder, Straßen, Wasser, Deko) liegt in der DB (`dorf_layout`, Migration 10), nicht im Vault: Es ist App-Zustand, nicht Leifs Notiz. Jede Änderung erhöht die Version und geht live an alle Geräte (`dorf.geaendert`). Speichert ein Gerät mit veralteter Version, gibt es 409 und den aktuellen Stand zurück. Die App lädt ihn und sagt es. Geprüft wird mit derselben Funktion auf Server und Gerät (`layoutPruefen` in `packages/shared`): keine Doppelbelegung, Grenzen ±60 Felder, nur bekannte Gebäude, Obergrenzen.
- Neue Gebäude aus dem Vault kommen automatisch auf den freien Block nahe der Mitte und bekommen einen Straßenring. Fehlt beim Speichern ein Gebäude, z. B. von einem Gerät mit älterem Stand, setzt der Server es wieder hin.
- **„Entfernen“ = ins Lager** (Leif): Das Gebäude verschwindet aus dem Dorf, der Ordner im Vault bleibt unberührt. Aus dem Lager wird es wieder hingestellt. Gebäude löscht man nur im Vault.

**E54 – Statusanzeigen kommen nur aus DB-Fakten, ohne Modell** (`GET /api/dorf/status`):
- Rauch: Lauf mit Status `laeuft` in einem Chat dieses Gebäudes.
- Baustellenschild: offene Schreibtisch-Aufgaben (Rathaus) bzw. Teilaufgaben eines noch nicht freigegebenen Plans für dieses Gebäude.
- Brief: offene Freigaben dieses Gebäudes.
- Rotes Dach und Uhr: nicht abgehakte Abgabe/Prüfung der Uni mit Frist in weniger als 3 Tagen. Andere Gebäude haben (noch) keine Fristen.
- Figuren: jeder Lauf in `laeuft`, `wartend` (Sanduhr) oder `wartet_freigabe` (Brief). Eine Figur läuft vom Rathaus über die Straßen (A*) zum Gebäude, arbeitet dort und geht nach dem Ende zurück. Hemd blau = api, orange = claude-code. Der Bürgermeister steht immer am Rathaus und geht beim Arbeiten nachdenklich auf und ab. Ein Klick zeigt Aufgabe, Motor, Modell, Token, Laufzeit, Chat-Link und „Abbrechen“ (mit Rückfrage, über den bestehenden Abbruch).

**E55 – Startseite ist das Dorf, die Liste gibt es per Knopf** (Leif). Die Wahl wird je Gerät gemerkt. Ein Klick auf ein Gebäude öffnet sein Menü über dem Dorf: am PC als Seitenleiste, am Handy als Blatt von unten, mit denselben Reitern wie die Gebäudeseite (`GebaeudeInhalt`) und „Ganze Seite ↗“. Steuerung:
- Ziehen verschiebt die Kamera, das Mausrad bzw. zwei Finger zoomen, Rechtsklick bzw. zwei Finger drehen.
- Knöpfe gibt es für Drehen um 90° und „Zum Rathaus“.
- Der Bau-Modus ist eine Leiste: Auswählen/Ziehen/Drehen/Ins Lager, Straße und Wasser malen, Deko setzen, Abreißen, Lager, Rückgängig (50 Schritte). Jede Geste ist ein Schritt und wird sofort gespeichert.

## 2026-11-18 – Nachtarbeit (Leif schläft, Freigabe vorab)

**E56 – Bürgermeister rund um die Uhr; seine Helfer laufen über Leifs Abo (ersetzt E51)** (Leif: „der ist 24/7 wach … 5 $ pro Tag, wenn der dann Aufgaben oder Chats triggert, soll er es über mein Claude-Max-Abo machen“). Einstellungen in `00_Stadtordnung/aufwachen.md`:
- **Weckzeiten:** jede volle Stunde, Tag und Nacht. Der Code prüft wie bisher ohne KI (E50).
- **Tagesbudget** (`tagesbudget_usd`, Standard 5 $): Summe aller api-Läufe ohne Leifs Klick (Auslöser `zeitplan`, also auch Post-Einordnung und Zeitung) seit Linzer Mitternacht. Ist das Budget erreicht, prüft er bis Mitternacht nur noch ohne KI. Die Post-Einordnung läuft weiter, sie ist klein und wichtig.
- **Rundgang** (`eigene_aufgaben`, `rundgang_abstand_stunden` = 3): Gibt es nichts Neues und wurde nichts angefangen, legt der Code höchstens alle 3 Stunden eine Schreibtisch-Aufgabe „Rundgang HH:MM“ mit Fakten an (Fristen 7 Tage, Chats der letzten 24 h, offene Freigaben, alte erledigte Notizen, frühere Rundgänge, alles in der Fremdinhalt-Hülle). Der Bürgermeister tut höchstens eine Sache: einen Helfer zum Vorbereiten starten, Aufräumvorschläge als Notiz nach `Rathaus/aufraeumen/` schreiben (nie selbst löschen oder verschieben) oder „Nichts zu tun“. „Abgabe bearbeiten“ und „Lernen“ bleiben Plan-pflichtig.
- **Motoren:** Der Bürgermeister selbst denkt beim Aufwachen über api (Budget). Helfer, die er startet, laufen mit dem Motor ihrer Aktion bzw. Stufe, also meist **claude-code über Leifs Abo**. Das gilt auch, wenn er von selbst aufgewacht ist. Der Notschalter `alle_auf` übersteuert weiterhin alles. Höchstens ein Helfer ohne Plan pro Aufgabe (unverändert).
- **Nachtruhe** (`nachtruhe`, 22–7 Uhr Linz): Der Telegram-Bot sendet nachts nur Dringendes, also Erinnerungen der Stufe „in wenigen Stunden“ sowie Antworten auf Leifs eigene Nachrichten. Fertig-/Fehler-/Mail-/Moodle-Meldungen werden gesammelt, Freigaben vorgemerkt. Ab 7 Uhr kommt alles in einer Nachricht „🌙 Über Nacht“, danach die Freigaben mit Knöpfen. Die Morgenzeitung (06:30) kommt wie bestellt.
- In der App zeigt der Schreibtisch den Tagesverbrauch. Erledigte Rundgänge und Lageberichte, die älter als 12 Stunden sind, werden ausgeblendet (auf Knopfdruck sichtbar).

**E57 – Moodle-Browser-Agent: eigener Chromium-Container, nur lesen** (Leif: „ein Agent wie Claude in Chrome, der Moodle richtig durchforsten kann … ein Browser auf dem Server, wo meine Moodle-Logindaten hinterlegt sind“). Die JKU sperrt die App-Schnittstelle (E41), die Moodle-Weboberfläche ist aber erreichbar. Leifs Angabe: JKU-Login nur mit Benutzername und Passwort, ohne zweiten Faktor.
- **Container `browser`** (`apps/browser`): playwright-core 1.65.1 und Chromium, ein HTTP-Runner nur fürs Dorf (Bearer-Geheimnis). Kein Vault, keine anderen Schlüssel. Netz mit Internet (`browsernetz`), weil moodle.jku.at erreichbar sein muss.
- **Zugangsdaten** nur in `/srv/dorf/browser.env`, gesetzt mit `dorf moodle-browser-zugang` (Passwort unsichtbar eingegeben). Die Datei wird als Datei eingebunden, nicht als `env_file`, damit das Dorf sie nie sieht. Das Modell bekommt sie nie, auch nicht im Seitentext: Ein dort erscheinendes Passwort wird durch •••• ersetzt.
- **Leine im Runner** (`leine.ts`, jede Anfrage über `page.route`):
  - Erlaubt sind nur Domains aus `BROWSER_HOSTS` (Standard `jku.at` samt Unterdomains).
  - GET ist erlaubt, außer Abmelden und Links mit `sesskey` (Moodle-Aktionen wie „als erledigt markieren“).
  - POST geht nur in zwei Fällen: als Seitennavigation während der Anmeldung (das Absenden des Anmeldeformulars) oder an Moodles Ajax-Dienst, wenn **alle** Funktionen nur lesen. Geprüft wird nach Wortteilen: Ein Lese-Verb muss vorkommen, kein Schreib-Verb.
  - Alles andere wird abgebrochen, also Abgaben, Forenbeiträge, Tests starten und Einstellungen. Der Agent sieht in der Seite, was abgefangen wurde.
  - **Fund beim Test:** Während der Anmeldung waren zunächst *alle* POSTs erlaubt, und ein schreibender Ajax-Aufruf der direkt danach geladenen Seite kam durch. Jetzt zählt nur noch die Seitennavigation als Anmeldung, ein Test hält das fest.
- **Unabhängige Prüfung (18.11., vor dem ersten echten Login):** Die Leine war an mehreren Stellen zu durchlässig. Alles ist geschlossen und getestet:
  - Downloads liefen nicht über die Seite und damit an der Leine vorbei; ein sesskey-Link wäre ausgeführt worden. Jetzt geht jede Download-Adresse und jede Weiterleitung durch die Leine.
  - Die Leine sitzt jetzt am Browser-**Kontext** statt an der einzelnen Seite. Popups werden sofort geschlossen und ihre Anfragen geprüft, WebSockets werden nie verbunden, Service Worker sind gesperrt.
  - Der Anmeldemodus gilt nur noch für die **eine** Sitzung, die sich gerade anmeldet. Anmeldungen laufen nacheinander. Eine Sitzung, die währenddessen auf einer Fehlerseite landet, wartet und lädt neu.
  - Das Passwort wird nur noch auf Moodles `/login/` und beim Identitätsanbieter eingetragen (`shibboleth.im.jku.at` und `access.jku.at`, einstellbar über `BROWSER_ANMELDE_HOSTS`), nie in andere Passwortfelder wie das Test-Kennwort eines Quiz. Maskiert wird es in Adressen, Titeln, Linktexten, Meldungen und im Log.
  - sesskey wird auch verschleiert erkannt (`%20sesskey`, `sesskey%00`, `%73esskey`). Funktionsnamen mit Sonderzeichen gelten als schreibend, http ist nur lokal erlaubt.
  - **Ajax per GET:** Der nächste Rauchtest zeigte, dass JKU-Moodle Texte, Vorlagen und Symbole per GET über `service-nologin.php?args=…` lädt. Diese Funktionen werden jetzt genauso geprüft wie bei POST: lesende gehen durch, schreibende nicht (auch nicht, wenn sie bei POST in `?args=` versteckt sind). Andere Ajax-Skripte per GET bleiben gesperrt.
  - **CDNs:** Eine JKU-Seite lädt jQuery von `code.jquery.com`. Skripte, Styles, Schriften und Bilder dürfen von einer festen Liste bekannter CDNs geladen werden (jQuery, jsDelivr, cdnjs, Google Fonts), nur per GET und nie als Seite. Alles andere zu fremden Domains bleibt gesperrt.
- **Werkzeuge** (`moodle_oeffnen`, `_klicken`, `_seite`, `_zurueck`, `_bild`, `_herunterladen`) gibt es nur bei `werkzeuge: [moodle]` **und** `fremdinhalte: ja`, nie zusammen mit `web`. Seiten gehen in der Fremdinhalt-Hülle ans Modell, Links und Knöpfe nummeriert. Links werden direkt per GET geöffnet, nicht angeklickt. Herunterladen geht nur nach `Uni/faecher/<Fach>/moodle/` (das Fach muss existieren) oder nach `Uni/moodle/` und überschreibt nie (Name-2 …). Die Sitzung ist der Lauf, die Seite wird am Ende des Laufs geschlossen. Die Anmeldung bleibt im Browser erhalten, nach 20 Minuten Leerlauf wird er beendet.
- **Aktion „Moodle durchsehen“** (Uni, claude-code, Stufe mittel): Kurs finden, Aufgaben mit Frist und Abgabestatus erfassen, Fehlendes herunterladen, Übersicht als Notiz schreiben.
- **Nichts erfunden:** Wie die JKU-Anmeldung genau aussieht (Moodle-Formular, SSO-Knopf, ein- oder zweistufig), ist ungeprüft. Der Runner versucht die üblichen Formen. Klappt es nicht, meldet `dorf moodle-browser-zugang` die Seite, auf der es hängt. Landet die Anmeldung auf einer fremden Domain, nennt die Leine sie, und Leif kann sie ausdrücklich erlauben.
- **Fund aus der CI (18.11.):** Der Rauchtest erreichte das echte `moodle.jku.at`. Zwei Dinge waren anders als angenommen: (1) Nicht-Angemeldete werden **nicht** auf die Login-Seite umgeleitet, die JKU zeigt ein Gast-Dashboard („Dashboard (Gast)“). Der Runner erkennt die Gast-Ansicht jetzt (Body-Klasse `notloggedin`, „(Gast)“ im Titel oder ein Anmelde-Link ohne Abmelde-Link) und geht dann selbst zur Login-Seite. (2) Das Dashboard ruft `block_recentlyaccesseditems_get_recent_items` auf, und die Leine hielt `block` für ein Verb. Die Leine prüft jetzt erst den Teil **nach** der Moodle-Komponente (`core_<Teilsystem>`, `<Plugintyp>_<Plugin>`); die Verben zählen weiter, im Zweifel bleibt gesperrt. Beides ist getestet (nachgebautes Moodle mit Gast-Dashboard, Namensliste). (3) Ein zweiter CI-Lauf zeigte: `/login/index.php` leitet sofort zu **Shibboleth** (`shibboleth.im.jku.at`) weiter, und dort schickt die Seite per Skript ein Formular mit Sitzungsdaten ab. Der Weg zur Login-Seite zählt deshalb schon zur Anmeldung (Formular-Navigation erlaubt, Ajax weiter geprüft). Das nachgebaute Moodle macht es jetzt genauso, und ohne den Fix scheitern die Tests. (4) **Leifs erste echte Anmeldung (18.11.):** Das Anmeldeformular steht auf `access.jku.at/nidp/saml2/sso` („JKU Login Service“, NetIQ). Der Host fehlte in der Liste der Anmelde-Hosts, deshalb hat der Browser dort nichts eingetragen und blieb Gast. Der Host ist jetzt im Standard; die Zugangsdaten stimmten.
- **Auslieferung:** Das Image wird über einen Inhalts-Hash nur bei Änderung geschickt (`hat-browser`, wie beim Rechenraum). Der Dienst läuft im Compose-Profil `browser` und startet erst, wenn die Version eine `BROWSER_VERSION` hat. Damit funktioniert auch der erste Deploy, den noch das alte Skript annimmt. Ein fehlgeschlagener Browser-Bau in der CI blockiert den übrigen Deploy nicht.

**E58 – Dorf wie ein Aufbauspiel: Spielknöpfe, Helfer-Figuren, Tag/Nacht, Ticker** (Leif: „Knöpfe wie bei Clash of Clans … Subagents als kleine Figur zur Uni laufen“). Eigene Gestaltung im Genre-Stil; keine Grafiken, Symbole oder Layouts eines bestimmten Spiels.
- **Gebäude antippen:**
  - Das Gebäude hüpft kurz und bekommt einen goldenen Rahmen.
  - Unten erscheinen ein Namensbanner mit Statuszeile und eine Reihe runder Knöpfe mit Symbol und Beschriftung, einer je Reiter, dazu „Versetzen“ (öffnet den Bau-Modus mit dem Gebäude ausgewählt).
  - Ein Knopf öffnet das Menü direkt im passenden Reiter, × hebt die Auswahl auf.
  - Die Dorf-Knöpfe oben und unten haben denselben Stil.
- **Helfer des Bürgermeisters:**
  - Helfer (Auslöser `buergermeister`) tragen einen Rucksack mit goldenem Wimpel und laufen vom Rathaus über die Straßen zum Ziel.
  - Der Bürgermeister winkt ihnen nach.
  - Die Infokarte nennt sie „Helfer des Bürgermeisters in …“.
  - Agenten stehen auf dem Gehsteig vor dem Grundstück, nicht in der Deko.
- **Tag und Nacht** nach Linzer Uhrzeit:
  - Sonnenauf- und -untergang werden je Jahreszeit für 48° N berechnet, mit Sommerzeit.
  - Der Himmel geht über Abendrot in die Nacht über, nachts gibt es einen bläulichen Mond und Sterne.
  - Fenster und Laternen leuchten nachts.
  - Ziehende Wolken am Rand und kreisende Vögel gibt es nur tagsüber.
  - Zum Ausprobieren: `/?uhr=22`.
- **Dorf-Ticker** oben links:
  - Meldungen entstehen aus dem Vergleich zweier Status-Stände: „Helfer läuft zur Uni“, „Zurück aus …“, „Freigabe wartet“, „Frist bald“, „Bürgermeister denkt nach“.
  - Sie verschwinden nach 9 Sekunden, ein Klick schwenkt die Kamera dorthin.
- **Klicks und Bildschirmpunkte** rechnen mit aktuellen Kameramatrizen, auch wenn seit der letzten Bewegung noch kein Bild gezeichnet wurde. Der Fehler zeigte sich bei langsamer Software-Grafik in den Tests.

**E59 – Wetter wie in Konstanz, Jahreszeiten, Zeitungs-Knopf** (Nachtarbeit, eigene Empfehlung; Ort am 18.11. auf Leifs Wunsch von Linz auf **Konstanz** umgestellt – er wohnt dort)
- **Wetter:** Der Server holt das Wetter für Leifs Wohnort **Konstanz** (`WETTER_ORT`, Koordinaten in `WETTER_URL`) von **Open-Meteo**. Die Schnittstelle ist frei, braucht keinen Schlüssel und kein Konto; am 18.11. ist sie geprüft. Hinaus geht nur die feste Ortsangabe (Konstanz: 47,66 / 9,18), keine Daten über Leif. Auch der Sonnenstand im Dorf (Tag/Nacht) gilt für Konstanz; Fristen und Uni-Zeiten bleiben in Linzer Zeit (gleiche Zeitzone).
  - Geholt wird nur bei Bedarf (Dorf-Ansicht, Morgenzeitung) und höchstens alle 30 Minuten. Bei Fehlern bleibt der letzte Stand (höchstens 6 Stunden alt, danach lieber gar kein Wetter), ein neuer Versuch kommt nach 5 Minuten.
  - Eingeschaltet über `WETTER_URL` in `deploy/compose.yml`; ohne diese Variable ist das Wetter aus, so gehen Tests und Entwicklung nie ins Netz.
  - Im Dorf: Regen als Streifen, Schnee als Flocken, bei Bewölkung kaum Sonne und weiche Schatten, Nebel rückt näher, bei Gewitter ab und zu ein Blitz. Oben rechts steht ein kleines Schild „🌧️ 7°“.
  - In der Morgenzeitung steht unter „Heute“ die erste Zeile, z. B. „🌧️ Wetter in Konstanz: Regen, 6–14 °C, Regen 93 % – Schirm mitnehmen“. Der Schirm-Hinweis kommt ab 60 %.
  - Zum Ausprobieren: `/?wetter=regen` (oder `schnee`, `gewitter`, `nebel`, `bedeckt`).
- **Jahreszeiten** nach dem Linzer Kalender: Frühling mit Blüten, Herbstlaub, im Winter Schnee auf Wiesen, Hügeln, Rasenflächen, Dächern und Tannenspitzen (das rote Frist-Dach geht vor). Zum Ausprobieren: `/?jahreszeit=winter`.
- **Zeitungs-Knopf 📰** oben rechts: Ein roter Punkt zeigt, dass die neueste Morgenzeitung auf diesem Gerät noch nicht geöffnet wurde. Ein Tipp öffnet sie im Rathaus.
- **Bürgermeister schläft nachts sichtbar** (Zz-Blase), wenn er gerade nichts zu tun hat. **Wasser glitzert** (treibende Lichtwellen).
- **Wie ein Lauf endete** (`zuletzt` im Dorf-Status, 10 Minuten): Der Ticker meldet „✅ Fertig in …“, „❌ Fehler in …“ oder „⏹️ Abgebrochen in …“ statt nur „Zurück aus …“. Nur bei Erfolg regnet über dem Gebäude Konfetti.
- **Rundgang sichtbar:** Weckt sich der Bürgermeister selbst (Auslöser `zeitplan`), läuft er von Gebäude zu Gebäude und zwischendurch zum Rathaus. Ist der Lauf vorbei, geht er heim.
- **Plakette am App-Symbol:** Bei installierter PWA zeigt das App-Symbol die Zahl offener Freigaben, der Fenstertitel lautet „(n) Agentendorf“.
- **Telegram:** `/heute` zeigt den Tagesüberblick wie in der Morgenzeitung: Wetter, Termine, Pflichttermine, Fristen und was wartet. Es ist jederzeit abrufbar, ohne KI und ohne Speichern. `/fristen` zeigt die offenen Abgaben und Prüfungen der nächsten 7 Tage zu jeder einen „✅ Erledigt“-Knopf (signiert wie bei den Erinnerungen). Beim Start meldet der Bot sein Befehlsmenü an (`setMyCommands`), damit die Befehle in Telegram unter „/“ erscheinen.
- **Schnellknöpfe** am angetippten Gebäude für die wichtigsten Aktionen (Uni: Moodle, Lernen · Post: Antworten · Rathaus: Frage). Sie öffnen die Aktion gleich ausgewählt (`?aktion=…`).
- **„Neu im Dorf“:** eine kleine Karte, einmal pro Gerät und Ausgabe nach einem Update. Sie blockiert nichts und ist im Testbrowser aus.
- **Bürgermeister-Karte** im Ruhezustand: zuletzt wach (mit Link zur Runde), nächste Runde, Budget heute.
- **Akku:** Bei offenem Gebäude-Menü zeichnet das Dorf nur ~8 Bilder pro Sekunde.
- **Zweite unabhängige Prüfung** (3D/Web): keine Abstürze, zehn kleinere Befunde behoben. Dazu gehörten Umwege des Bürgermeisters beim Nachdenken, nicht freigegebene Autos, Himmel und Lampenlicht, Figuren nach dem Drehen eines Gebäudes und ungesichertes `localStorage`.
- **Knopf „Agenten“** oben (neben Wetter, Zeitung, Liste, Bauen; 18.11. auf Leifs Wunsch): zeigt mit Zahl, wie viele Agenten gerade laufen. Ein Tipp öffnet die Übersicht mit Gebäude, Auftrag, Status, Laufzeit und dem aktuellen Werkzeug, dazu „Zeigen“ (Kamera zur Figur, Figurenkarte) und „Chat“, darunter die zuletzt fertigen Läufe (✅/❌/⏹️). Am Handy zeigen die oberen Knöpfe nur Symbole, damit alle in eine Reihe passen.

**E60 – Skills: selbst anlegen, von selbst laufen lassen, Ergebnis mit Archiv** (18.11., Leifs Wunsch: „einfach Skills anlegen und automatisch ausführen lassen, auch zu Gebäuden hinzufügen“; Anlass: tägliche Checkliste)
- **Skill = Aktion** (Markdown in `<Gebäude>/aktionen/`). Neu im Kopf:
  - `zeitplan` in einfacher Sprache, z. B. „täglich 06:00“, „werktags 07:00, 18:00“ oder „mo, mi 08:00“ (mitteleuropäische Zeit).
  - `ablage`: Ergebnis-Datei im eigenen Gebäude, auch mit Platzhaltern wie `Uni/faecher/{fach}/00_Kursuebersicht.html`.
  - `standard` für Eingaben.
- **Zeitplaner** (`agenten/automatik.ts`): prüft jede Minute und startet jeden Termin genau einmal (DB). Verpasste Termine holt er bis 3 h nach. Neue oder geänderte Zeitpläne zählen erst ab dann. Läuft dieselbe Aktion noch, wird der Termin ausgelassen. Auslöser `automatik` → **Motor der Aktion** (meist dein Abo), nicht das API-Budget des Bürgermeisters. Pflicht-Eingaben brauchen dann einen `standard`.
- **Ablage mit Archiv:**
  - Der Agent schreibt nach einem vom Code vorgegebenen Entwurfsnamen (Agenten-Schema).
  - Erst wenn der Lauf **erfolgreich** war, legt der Code die alte Fassung nach `<Ordner>/archiv/<Name>/` und setzt die neue an ihre Stelle, z. B. `Bibliothek/00_Checkliste.html` (die `00_` hält sie oben).
  - Scheitert der Lauf, bleibt alles, wie es war.
- **Häkchen-Brücke:** Abgeschottete HTML-Seiten können per `postMessage` einen kleinen Stand (≤ 64 KB) über die App im Dorf speichern (`seiten_stand`). Häkchen bleiben so auf allen Geräten erhalten. Beim Ablösen wandert der Stand als `_haekchen.json` mit ins Archiv, der nächste Lauf bekommt ihn im Auftrag (als Fremdinhalt) und erkennt so Erledigtes. Weiter gilt: kein Netz, kein Zugriff auf die App.
- **Neue Werkzeuge:**
  - `kalender_lesen` (`werkzeuge: [kalender]`, nur mit Fremdinhalten): Hauptkalender, Uni-Fristen (mit „erledigt“) und Pflichttermine, nur lesen.
  - `post_suchen` (in `post`): durchsucht die Mails, die der Postbote kennt, und liefert die IDs für `post_lesen`.
- **Anlegen auf drei Wegen**, alle als normale Markdown-Datei und alle wie jede Aktion geprüft (Leine, Zeitplan, Ablage), Fehlerhaftes wird nicht gespeichert:
  - App-Formular „+ Neue Aktion“ in jedem Gebäude
  - `00_Stadtordnung/aktion-vorlage.md` für Obsidian
  - Werkzeug `aktion_vorschlagen` des Bürgermeisters: Er legt eine **Freigabe** vor, erst Leifs Ja legt die Datei an.
- **Telegram:** `/aktion [Name]` startet Skills, die ohne Eingaben (oder mit Standardwerten) laufen.
- **Mitgeliefert:**
  - „Checkliste“ (Bibliothek, täglich 06:00, Moodle + Mails + Kalender + Häkchen → `Bibliothek/00_Checkliste.html`, Vorlage `Bibliothek/vorlagen/checkliste-vorlage.html` ohne persönliche Daten).
  - „Kursübersicht“ (Uni): Folien eines Kurses holen und `Uni/faecher/<Kurs>/00_Kursuebersicht.html` schreiben, mit ECTS-Anforderungen, Stand und Anstehendem.
- **Fehlerbild des claude-CLI:** Bei `error_during_execution` zeigt der Chat jetzt den Grund (`errors` aus dem Ergebnis bzw. das Ende von stderr) statt des letzten Satzes.

**E61 – Gedächtnis und Persönlichkeit des Bürgermeisters; er macht nach Ereignissen selbst weiter** (18.11., Leif: „Der Bürgermeister soll eine memory.md und eine personality.md haben, die er pflegt, und lernen, wie er effektiv arbeitet und Aufgaben formuliert.“)
- **`Rathaus/memory.md`** enthält sein Arbeitswissen in den Abschnitten Über Leif · So arbeite ich in der Bibliothek · Aufträge, die funktionieren · Fehler und Lehren · Offen.
  - Er pflegt die Datei selbst mit `gedaechtnis_schreiben` und ersetzt dabei immer die ganze Datei. Die alte Fassung legt der Code vorher nach `Rathaus/archiv/memory/`.
  - Die Datei hat höchstens 15.000 Zeichen, also muss er verdichten. `<fremdinhalt>` wird abgelehnt.
  - Hat Leif die Datei während des Laufs geändert, wird abgelehnt (Version), statt seine Änderung zu überschreiben.
- **`Rathaus/personality.md`** beschreibt, wie er auftritt. Ändern geht nur über `persoenlichkeit_vorschlagen` und eine Freigabe (Leifs Wahl). Ausgeführt wird nur, wenn die Datei seit dem Vorschlag unverändert ist.
- Beide Dateien stehen in **jedem** Bürgermeister-Lauf im Systemprompt, egal ob Schreibtisch, Aufwachen oder Rundgang. Die Stadtordnung geht vor. Leif kann beide jederzeit in Obsidian bearbeiten.
- **Lernen aus Fakten:** Beim Aufwachen (Lagebericht oder Rundgang) stellt der Code eine **Rückschau** seit dem letzten Mal zusammen und legt sie in die Fremdinhalt-Hülle, weil Fehlertexte von außen stammen können:
  - Helfer mit Aktion, Stufe, Ergebnis/Fehler, Dauer und Leinen-Ablehnungen
  - eigene gescheiterte Läufe
  - abgelehnte Pläne und Freigaben
  - gescheiterte Ausführungen

  Daraus schreibt er Lehren ins Gedächtnis.
- **Weitermachen nach Ereignissen** (Lücke, die der Bürgermeister selbst benannt hat: Ein angenommener Skill-Vorschlag startete nichts, niemand weckte ihn):
  - Wird eine Freigabe aus seinem Chat **angenommen**, setzt das Dorf diesen Chat mit dem Ergebnis fort. Er kann dann z. B. den neuen Skill gleich als Helfer starten.
  - **Abgelehnt** erzeugt nur einen Hinweis.
  - Sind **alle seine Helfer fertig**, setzt das Dorf seinen Chat mit ihren Zusammenfassungen fort (Fremdinhalt-Hülle). So kann er den nächsten Schritt gehen, z. B. erst Kursordner anlegen lassen, dann den Plan für die Kursübersichten vorlegen.
  - Der Lauf geht über den Motor des Chats. Der Auslöser ist der des ersten Laufs, damit Aufwachen-Chats im Tagesbudget bleiben.
  - Höchstens 8 solcher Fortsetzungen je Chat (Schutz vor Schleifen), danach nur ein Hinweis.
- **Leine unverändert:** Er schreibt weiter nur im Rathaus. Neu geschützt ist `<Gebäude>/archiv/`, das schreibt nur das Dorf.
- **Startwissen in der Vorlage** enthält die Vault-Karte, die Dateinamen-Regel, Rezepte für Helfer-Aufträge und die Lehre aus der gescheiterten Folien-Aufgabe.
- **Vorlagen:** `stadtordnung.md`, `Rathaus/gebaeude.md` und `Rathaus/aktionen/buergermeister.md` werden aktualisiert, falls sie byte-gleich einer früheren Vorlagenfassung sind.
- **Fehler behoben:** Beim Prüfen von Plänen und `helfer_starten` fehlten die Auswahl-Quellen. Deshalb war jede Auswahl-Eingabe ungültig, etwa `fach` aus `uni.faecher`, obwohl die Ordner in `Uni/faecher/` existierten. Der Plan „Kursübersicht je Kurs“ wurde so abgelehnt. Jetzt prüft der Code gegen dieselben Quellen wie beim Start.

**E62 – Pläne ohne Antwort nach 10 Minuten automatisch annehmen** (18.11., Leifs Wunsch)
- Ein Plan des Bürgermeisters bekommt beim Vorlegen einen Zeitpunkt `automatischUm` (jetzt + `plan_automatisch_nach_minuten` aus `00_Stadtordnung/aufwachen.md`, Standard 10, 0 = nie). Der Hinweis im Plan (App, Telegram) nennt die Uhrzeit.
- Jede Minute nimmt der Code fällige Pläne über `freigaben.entscheiden(id, true, 'automatisch')` an. Das ist atomar: Klickt Leif gleichzeitig, gewinnt genau einer. In der DB steht `entschieden_von = automatisch` (Migration 12); App, Telegram und Spiegel zeigen „automatisch“. Im Chat des Bürgermeisters erscheint ein Hinweis.
- **Nur Pläne.** Ein Plan startet Helfer im Vault. Senden, Löschen, Abgeben, Überschreiben, Skills und Persönlichkeit bleiben eigene Freigaben und warten immer auf Leifs Klick.
- Die Einstellung gilt für Pläne, die nach einer Änderung vorgelegt werden. Ältere behalten ihren Zeitpunkt.

**E63 – Spiel-Look für alle Fenster und Seiten** (18.11., Leif: „die ganzen Fenster … sollten auch in diesem Look sein und nicht so plain“)
- Kopfleiste, Gebäude-Fenster, Karten, Reiter, Knöpfe, Eingabefelder, Chat-Nachrichten und Tabellen sehen jetzt aus wie die Knöpfe im Dorf: heller Grund, dunkelblauer Rand, runde Ecken und ein „Boden“-Schatten, der beim Drücken einsinkt.
- Der aktive Reiter und Hauptknöpfe sind grün, Gefahr-Knöpfe rot, Schließen ist ein roter Kreis. Die Fensterköpfe sind dunkelblau wie das Gebäude-Banner.
- Das Aussehen ist immer hell, auch wenn das Gerät auf dunkel steht. Das Dorf ist hell, ein dunkles Fenster daneben passte nicht.
- Umgesetzt nur in `stil.css`, ohne neue Abhängigkeiten oder Schriften von außen.

**E64 – Ablehnen mit Begründung, Zeitplan „je Fach“, Frist-Wächter** (18.11., Leifs Auswahl aus den Vorschlägen; außerdem: Pläne starten auch nachts und auch große Pläne nach 10 min von selbst, Dunkelmodus entfällt)
- **Ablehnen mit Begründung:**
  - In der App gibt es beim Ablehnen ein optionales Feld „warum?“.
  - In Telegram fragt der Bot nach ❌ „Magst du kurz sagen, warum?“. Als Grund gilt die Antwort auf diese Nachricht oder die nächste Textnachricht innerhalb von 10 Minuten. Ein Befehl beendet die Frage.
  - Der Grund wird an der Freigabe gespeichert (Migration 13, `grund`, genau einmal nachreichbar).
  - Stammt die Freigabe vom Bürgermeister, arbeitet er im selben Chat mit dem Grund weiter: Er legt einen überarbeiteten Vorschlag vor oder fragt nach und hält die Lehre im Gedächtnis fest.
  - Ohne Grund gibt es wie bisher nur einen Hinweis. Die Rückschau nennt den Grund ebenfalls.
- **`zeitplan_je: <eingabe>`:**
  - Der Zeitplan startet je Wert einer Auswahl-Eingabe einen Lauf, z. B. je Fach aus `uni.faecher`, höchstens 30 pro Termin.
  - Werte, für die noch ein Lauf dieser Aktion läuft, werden ausgelassen.
  - Die Kursübersicht läuft so jeden Montag um 05:00 für jedes Fach und lädt nur Neues.
  - Die Vorlagen `kursuebersicht.md` und `aktion-vorlage.md` werden aktualisiert, falls unverändert.
- **Frist-Wächter:**
  - Die Telegram-Erinnerungen 1 Tag bzw. wenige Stunden vor der Frist bekommen den Knopf „🧑‍💼 Vorbereiten lassen“ (signiert wie „Erledigt“).
  - Er legt eine Aufgabe für den Bürgermeister an, mit der Frist als Fremdinhalt. Der Bürgermeister bereitet vor, etwa mit „Abgabe bearbeiten“, „Lernen“ oder „Moodle durchsehen“.
  - Abgegeben wird nie automatisch.

**E65 – To-do-Brett auf dem Marktplatz, für Leif und alle Agenten** (18.11., Leif: „wenn man auf den Marktplatz klickt, die Todoliste immer aktuell … abhaken“ und „Skills für alle Agenten, damit sie abhaken, anlegen, bearbeiten oder löschen können“; zieht den Kern von Etappe 7 vor)
- **Speicherort:** Ein To-do ist eine Markdown-Datei in `Marktplatz/todos/` mit dem Frontmatter `titel`, `status: offen|erledigt`, `faellig`, `gebaeude`, `quelle`, `erstellt`, `erledigt_am`; darunter steht die Notiz.
  - So lässt es sich in Obsidian bearbeiten, wird per Syncthing gespiegelt und von Dataview gelesen.
  - Von Hand angelegte Dateien ohne Titel erscheinen mit dem Dateinamen als Titel.
- **`TodoDienst`** (`src/todos.ts`) ist die einzige Stelle für Änderungen:
  - nur direkt in `Marktplatz/todos/`
  - Ändern mit Version, sonst 409 statt überschreiben
  - Löschen legt die Datei in den **Papierkorb** des Vaults und lässt sich wiederherstellen
  - jede Änderung sendet `todos.geaendert` an alle Geräte
- **App:** Der Marktplatz öffnet direkt den Reiter „To-do“. Dort kannst du anlegen (mit Datum), abhaken, wieder öffnen, bearbeiten (Titel, Datum, Notiz) und löschen.
  - Überfällige To-dos sind rot umrandet, To-dos von Agenten tragen 🤖 mit ihrer Quelle.
  - Erledigtes der letzten 14 Tage steht eingeklappt darunter.
- **Agenten:** `todo_liste`, `todo_anlegen`, `todo_bearbeiten` (auch abhaken) und `todo_loeschen` hat **jeder** Agent in seinem Werkzeugprofil, auch ohne `vault_schreiben`.
  - Die Liste kommt als Fremdinhalt zurück, weil To-dos aus Mails stammen können.
  - Das Löschen von To-dos geht ohne Freigabe, weil es wiederherstellbar ist. Das ist eine bewusste Ausnahme auf Leifs Wunsch, Dateien bleiben bei der Freigabe-Regel.
  - Die Stadtordnung sagt: nur anlegen, was Leif wirklich tun muss, vorher auf Doppeltes prüfen, Erledigtes abhaken statt löschen.
- **Telegram:** `/todo` zeigt die offenen To-dos mit signierten ✅-Knöpfen, ein Knopf hakt ab und aktualisiert die Nachricht. `/todo <Text>` legt ein To-do an.
- Vorlagen `Marktplatz/gebaeude.md` und Stadtordnung werden aktualisiert, falls unverändert.

**E66 – Etappe 6: Programme für Mac und Windows (Tauri v2)** (18.11., Leifs Wahl: unsigniert, Download vom Dorf-Server, alle Extras, automatische Updates)
- **Hülle statt zweiter Oberfläche:** `apps/programm` öffnet die Dorf-Adresse in einem eigenen Fenster.
  - Die Oberfläche kommt immer vom Server, jedes Deploy ist sofort auf allen Geräten. Fürs Handy bleibt die PWA.
  - Die Adresse fragt das Programm beim ersten Start ab (lokale Einrichtungsseite). Erlaubt ist nur `https`, `http` nur für localhost.
  - Gespeichert wird nur der Ursprung in `einstellungen.json` im Konfigurationsordner des Programms. Nichts Persönliches liegt im Repo.
- **Leine im Programm:**
  - Seiten vom Server dürfen nur `melden`, `zaehler_setzen` und `schnell_schliessen` aufrufen. Freigegeben wird das zur Laufzeit mit `add_capability` (CapabilityBuilder, `remote` = genau der Ursprung, nur Fenster `main`/`schnell`).
  - Alle anderen Befehle und Plugin-Befehle sind gesperrt, denn seit Tauri 2.11 gilt für fremde Ursprünge immer die ACL.
  - Die Einrichtungsseite darf nur `adresse_lesen`, `adresse_speichern` und `neu_verbinden`.
  - Fremde Links öffnen im normalen Browser (`on_navigation`/`on_new_window`). Ein Adresswechsel startet das Programm neu, damit die alte Freigabe wegfällt.
  - **Selbsttest** (`apps/programm/test/selbsttest.sh`, nur Debug-Build): Das Programm läuft unter Linux mit virtuellem Bildschirm gegen den e2e-Server. Die Dorf-Seite ruft einen erlaubten Befehl und vier verbotene auf; nur der erlaubte darf durchgehen. Er läuft in der CI.
- **Extras:**
  - Systemmeldungen für neue Freigaben und fertige oder fehlgeschlagene Aufgaben, nur wenn das Fenster nicht im Vordergrund ist. Die Web-App ruft dafür `melden`.
  - Symbol in der Leiste mit Menü, Tooltip „N Freigaben warten“, am Mac zusätzlich Zahl und Dock-Plakette.
  - Schnelleingabe mit `CommandOrControl+Shift+Space`: ein kleines Fenster mit `/schnell`, Aufgabe für den Bürgermeister oder To-do.
  - Autostart: beim ersten Start eingeschaltet, umschaltbar in der Leiste. Mit `--autostart` startet das Programm unsichtbar und versucht es ohne Netz alle 30 s erneut.
  - Ein zweiter Start zeigt das vorhandene Fenster (single-instance). Die Fenstergröße wird gemerkt.
  - Schließen blendet das Fenster nur aus, das Programm bleibt in der Leiste.
- **Updates:**
  - Das Programm prüft 20 s nach dem Start und dann alle 6 h `<Dorf>/programme/latest.json`.
  - Der Server erzeugt diese Datei aus `programme.json` und nennt dabei seine eigene Adresse.
  - Updates sind mit einem eigenen Tauri-Schlüssel signiert: öffentlicher Teil in `tauri.conf.json`, privater als GitHub-Secret `TAURI_SIGNING_PRIVATE_KEY`.
  - Fehlt das Secret, baut die CI die Programme ohne Update-Dateien (Warnung), und der Server bietet dann kein Update an.
- **Download ohne Anmeldung:** `/programme/datei/*` und `latest.json` liegen nicht unter `/api`, weil der Updater keine Sitzung hat. Die Programme enthalten nichts Persönliches. Die Download-Knöpfe stehen angemeldet unter Einstellungen → Programme.
- **Unsigniert:** Mac ist ad-hoc signiert (`signingIdentity: "-"`, empfohlen für Apple Silicon). Beim ersten Öffnen braucht es einmal „Dennoch öffnen“ bzw. „Trotzdem ausführen“; die Anleitung steht in den Einstellungen.
- **CI:**
  - `programm-selbsttest` (Linux) prüft das Programm.
  - `programme-pruefen` bildet einen Hash über das Programm und fragt den Server mit `hat-programme <16 Hex>` (neuer erzwungener SSH-Befehl).
  - Nur wenn neu, baut `programme` auf macos-latest (`--target aarch64-apple-darwin`, `app,dmg`) und windows-latest (`nsis`); `macos-14` bietet GitHub nicht mehr an. Die Version ist `0.1.<Laufnummer>`, für beide gleich.
  - `ausliefern` legt sie mit `deploy/programme-manifest.sh` ins Bündel; `dorf empfangen` ersetzt `daten/programme/` als Ganzes.
  - Scheitert der Programmbau, wird das Dorf trotzdem ausgeliefert.
- **Caddy:** Die CSP erlaubt zusätzlich `ipc: http://ipc.localhost` bei `connect-src`. Das ist der schnelle IPC-Weg; ohne ihn weicht Tauri auf postMessage aus.
- **Nicht dokumentiert, darum offen:** ob Systemmeldungen eines ad-hoc-signierten Mac-Programms ohne Weiteres erscheinen. Das prüft Leif bei der Abnahme.

**E67 – Etappe 7 (Teil 1): Gebäude anlegen und eröffnen, Listen allgemein, Einkaufsladen** (18.11., Leifs Wahl: alle Vorschläge für Bank, Börse, Einkaufsladen und Corpshaus)
- **Gebäude in der App:**
  - „🏗️ Neues Gebäude“ gibt es in der Liste und im Bau-Modus: Name, Symbol, Beschreibung. Daraus entstehen der Ordner (ASCII), `gebaeude.md` und `aktionen/`, und der Dorfplan platziert das Gebäude automatisch.
  - Geschlossene Gebäude lassen sich per Knopf eröffnen. Unter „Gebäude einstellen“ im Reiter Übersicht ändert man Name, Symbol und Beschreibung oder schließt das Gebäude; das Rathaus bleibt immer offen.
  - Der Text der Arbeitsanweisung bleibt dabei unangetastet. Bearbeitet wird er in der Bibliothek.
- **Listen allgemein:** Der TodoDienst bekommt einen Ordner je Liste: `todo` (Marktplatz/todos), `einkauf` (Einkaufsladen/liste), `wunsch` (Einkaufsladen/wunschliste), `corps` (Corpshaus/aufgaben).
  - Neues Feld `gruppe`, etwa die Abteilung im Laden oder das Amt im Corps.
  - API unter `/api/listen/<name>`; `/api/todos` bleibt erhalten.
  - Die Agenten nutzen dieselben `todo_*`-Werkzeuge mit dem Parameter `liste`.
  - Telegram hat zusätzlich `/einkauf`. Die Abhak-Knöpfe sind je Liste signiert, alte To-do-Knöpfe bleiben gültig.
- **Leine für Listen:** Einträge, die ein Lauf mit Fremdinhalten anlegt oder inhaltlich ändert, bekommen `fremd: true` (Abhaken allein markiert nicht).
  - Läufe mit Internet sehen solche Einträge nicht und dürfen sie nicht ändern. Sonst käme Fremdes über eine Liste ins Netz, z. B. ein präparierter Mailtext über die Wunschliste zum Preisvergleich.
  - In der App tragen sie den Hinweis „✉️ aus Mail“.
- **Einkaufsladen (jetzt offen):**
  - Reiter Einkaufsliste (nach Abteilung sortiert) und Wunschliste (je Eintrag ein Knopf „🔎 Preise“).
  - Skill „Essensplan“ jeden Sonntag 17:00: Er nimmt die Vorgaben aus `einstellungen.md` (schnell und günstig, Meal-Prep) und den Kalender, schreibt `Einkaufsladen/00_Essensplan.md` (Archiv) und setzt Zutaten auf die Einkaufsliste.
  - Skill „Preisvergleich“ (Internet, ohne Fremdinhalte) schreibt `preisvergleiche/` und ergänzt die Wunschliste.
  - Bestellt und bezahlt wird nie.

**E68 – Etappe 7 (Teil 2): Bank** (18.11.; Leifs Wahl: Kontoauszüge, Rechnungen aus Mails, Budget & Sparziele)
- **Nur lesen und auswerten.** Es gibt kein Werkzeug zum Bezahlen. Kontodaten bleiben im Vault (`Bank/auszuege/`) und in der DB (Migration 14).
- **Kontoauszüge:**
  - Leif lädt CSV-Exporte hoch (Konto-Reiter oder Bibliothek). Der Code erkennt Kodierung (UTF-8 oder Latin-1), Trennzeichen, Vorspann vor der Kopfzeile und die Spalten (deutsche und englische Kopfnamen, Betrag oder Soll/Haben), dazu Zahlen- und Datumsformate.
  - Unbekanntes Format: Leif ordnet die Spalten einmal zu. Das wird je Kopfzeile gemerkt, also je Bank.
  - Doppelte Buchungen aus überlappenden Exporten zählen nur einmal (Kennung aus Inhalt plus laufender Nummer).
  - PDF-Auszüge: Landet ein PDF in `Bank/auszuege/`, startet von selbst der Skill „Kontoauszug (PDF) einlesen“ (claude-code, Fremdinhalt). Er schreibt eine CSV im festen Format mit `# Quelle:`-Zeile und prüft die Salden.
- **Kategorien** (17 feste):
  - Reihenfolge: Leifs Umstellung je Gegenseite (gilt für alle, auch künftige) → eigene Regeln in `Bank/einstellungen.md` → eingebaute Regeln (REWE, Spotify, DB …) → Eingänge = Einkommen → KI → „Sonstiges“.
  - Die KI ist abschaltbar (`ki_kategorien`). Sie bekommt als Fremdinhalt nur Gegenseite, Zweck-Anfang und Betrag, ohne IBAN, und läuft als SystemAufruf auf Stufe klein. Das Ergebnis wird je Gegenseite gemerkt.
  - „Sparen & Umbuchung“ zählt weder als Einnahme noch als Ausgabe.
- **Abos:** gleiche Gegenseite, Betrag ±15 %. Monatlich bei mindestens 3 Buchungen im Abstand von 20–40 Tagen, jährlich bei einem Abstand um 365 Tage. Verschwunden, wenn seit 1,5 Rhythmen nichts kam.
- **Budget und Sparziele** stehen im Frontmatter von `Bank/einstellungen.md`. Sparziele: `bisher` plus erkannte Überweisungen aufs Sparkonto (`muster`, `seit`).
  - Warnungen ab 80 % und 100 % gibt es je Monat, Kategorie und Stufe genau einmal: per Telegram (Schalter `bank`, nachts gesammelt) und als Abschnitt „Budget“ in der Morgenzeitung.
- **Rechnungen aus Mails:**
  - Die Einordnung des Postboten liefert zusätzlich `rechnung_betrag`, `rechnung_faellig` und `rechnung_empfaenger`, aber nur für offene Rechnungen oder Zahlungsaufforderungen.
  - Daraus wird je Mail genau einmal ein To-do „Rechnung: … – Betrag“ mit Fälligkeit und Gebäude Bank, markiert als aus der Mail (`fremd`).
  - Die Bank zeigt offene Rechnungen. Abgehakt wird auf dem Marktplatz, bezahlen tut Leif.

**E69 – Etappe 7 (Teil 3): Corpshaus** (18.11.; Leifs Wahl: Termine aus Mails und Hauptkalender, Corps-Mails per KI und Absenderliste, Ämter & Aufgaben)
- **Einstellungen** stehen in `Corpshaus/einstellungen.md`: `absender` (Adresse oder Teil wie „@mein-corps.de“) und `stichworte` für Kalendertitel.
- **Corps-Mails:** Die KI-Kategorie „Corps“ gab es schon. Neu ist die Absenderliste, die die KI überstimmt (Postbote: `kategorieFest`). Der Reiter „Corps-Mails“ zeigt den Posteingang gefiltert, mit denselben Antwort-Entwürfen wie bei der Post.
- **Termine:**
  - Corps-Termine aus dem Hauptkalender, erkannt an den Stichworten (nächste 6 Wochen), nur lesen.
  - Skill „Termine aus Mails“ (montags und donnerstags 07:00): `post_suchen` jetzt mit `kategorie`, dazu Kalender-Abgleich. Ergebnis ist `Corpshaus/00_Termine.md` (Ablage mit Archiv), markiert ist, was im Kalender fehlt.
  - Anmeldefristen und Ähnliches werden Aufgaben. Kalendereinträge legt nur Leif an.
- **Ämter & Aufgaben:** Liste `corps` (Corpshaus/aufgaben), das Amt steht als Gruppe. Das Bearbeiten-Formular aller Listen hat jetzt das Feld „Gruppe“.
- **Skills** „Veranstaltung planen“ (Checkliste rückwärts vom Datum als Aufgaben mit Fälligkeit, Planungsdokument) und „Übergabe-Notiz“ (je Amt, aus Aufgaben, Notizen und Corps-Mails).

**E70 – Etappe 7 (Teil 4): Börse** (18.11.; Leifs Wahl: Depot & Watchlist, Wochenbericht, Kurse automatisch über EODHD kostenlos)
- **Anbieter:** Recherchiert wurden EODHD, Twelve Data, Alpha Vantage, FMP, Finnhub, Marketstack, Tiingo, Polygon/Massive, Yahoo und Börse-Daten.
  - Kostenlos deckt nur **EODHD** sicher Xetra **und** US ab: 20 Abrufe am Tag, Kürzel `VWCE.XETRA` bzw. `AAPL.US`, ISIN-Suche `/search/{ISIN}`, Schlusskurse `/eod/{SYM}`.
  - Twelve Data gibt Xetra erst ab 29 $ im Monat. Yahoo verbietet automatischen Zugriff (ToS).
  - Euro/Dollar kommt von der **EZB** (Referenzkurs, ohne Schlüssel).
- **Depot und Watchlist** stehen in `Boerse/depot.md` (Frontmatter: name, isin oder symbol, boerse, stueck, einstand je Stück in €). Gepflegt wird in der App (Börse → Depot) oder in Obsidian.
- **Kurse:**
  - Stündlich prüft der Code, abgerufen wird je Wert höchstens einmal am Tag (Schlusskurse). Das Tageslimit liegt bei 19 Abrufen (DB `boerse_abrufe`), einer bleibt Reserve.
  - Wer am längsten keinen Kurs hatte, kommt zuerst dran; der Rest folgt am nächsten Tag.
  - Eine ISIN wird einmal gesucht und das Ergebnis gemerkt.
  - Bewertung in Euro (US über EZB): Wert, Gewinn absolut und in %, Veränderung zum Vortag.
  - Morgenzeitung, Abschnitt „Depot“: Gesamtwert plus Werte, die sich um mindestens 3 % bewegt haben.
- **Schlüssel:** `EODHD_API_KEY` nur in `/srv/dorf/.env`. `dorf boerse-schluessel` fragt ihn unsichtbar ab, prüft ihn mit einem Abruf und startet das Dorf neu.
  - Ohne Schlüssel zeigt die Börse Depot und Einstand mit einem Hinweis.
  - **Gegen das echte EODHD noch nicht geprüft.** Getestet ist gegen einen nachgebauten Server nach der offiziellen Doku; die Abnahme kommt mit Leifs Schlüssel.
- **Wochenbericht** (Skill, sonntags 18:00, Internet ohne Fremdinhalte, Ablage `Boerse/00_Wochenbericht.md`): Woche je Wert, Märkte, Termine, höchstens zwei sachliche Denkanstöße, **keine Kauf- oder Verkaufsempfehlung**.
- Gehandelt wird nie. Dafür gibt es weder Schnittstelle noch Werkzeug.
- **Etappe 7 damit fertig:** Alle Vorlage-Gebäude sind eröffnet.


## E71 – Uni-Fristen als To-dos (18.11.)

- **Was:** Jede künftige, offene Abgabe oder Prüfung aus „Studium“ wird **genau einmal** ein To-do auf dem Marktplatz.
  - Titel „Abgabe: …“ oder „Prüfung: …“, fällig am Tag der Frist (Linzer Zeit).
  - Kurs als Gruppe, Gebäude „Uni“, Quelle „Uni“.
  - Markiert als `fremd`, weil die Titel aus Moodle bzw. dem Kalender stammen.
- **Abhaken in beide Richtungen:** `uni_todos` (Migration 16) merkt sich den zuletzt abgeglichenen Stand. Wer sich seitdem bewegt hat – To-do oder Frist –, gewinnt.
  - Abgeglichen wird nach jedem Uni-Abgleich, nach Änderungen am To-do-Brett (1,5 s gebündelt), nach dem Abhaken in der Uni und zusätzlich alle 10 min (Abhaken in Obsidian kommt ohne Ereignis an).
- Verschiebt sich eine Frist, zieht das Fälligkeitsdatum nach.
- **Gelöschte To-dos kommen nicht wieder** (Leifs Entscheidung zählt).
- Vergangenes, schon Erledigtes und Pflichtvorlesungen werden keine To-dos.

## E72 – Häuschen, mehr Deko, Kirchturm-Modell (18.11.)

- **Was:** Leif wollte „kleinere Häuser zwischendrin und mehr Deko“, automatisch verstreut. Dazu ein eigenes Modell für das Gebäude „Kirchturm“ mit Turmuhr.
- **Häuschen belegen 2 × 2 Felder** (`DEKO_GROESSE` in `packages/shared/src/dorf.ts`). Auf einem Feld (1,25) wären sie neben den Figuren Puppenhäuser.
  - Belegung, Prüfung (`layoutPruefen`) und Bau-Modus rechnen über `dekoFelder()`. Server und Oberfläche nutzen dieselben Regeln.
  - Aussehen fest aus der Position: Wand-/Dachfarbe, Dachform (trauf-, giebelständig, Zeltdach), Schornstein, Fensterläden, Blumenkästen, Fachwerk.
  - Fenster leuchten nachts über das bestehende Glas-Material. Keine eigenen Lichter.
- **Neue Deko (1 Feld):** Gartenhütte, Gartenzaun, Steinmauer, Briefkasten, Blumenkübel, Holzstapel, Wegweiser, Bienenstock, Seerosenteich, Pilze, Heuballen.
  - Alles aus Grundformen im Bausatz, mit der übrigen Deko zu wenigen Meshes zusammengefasst (Handy).
- **Verstreuen einmalig, Markierung im Layout selbst:** `verstreut` (Stand `VERSTREUT_STAND`) im gespeicherten Layout-JSON.
  - Keine DB-Migration: die Markierung gehört zum Layout und wandert mit Version/409.
  - Ein Gerät mit altem Stand kann sie nicht zurücksetzen; der Server übernimmt beim Speichern den höheren Wert.
  - Leifs Abriss bleibt also. Neue Dörfer bekommen es gleich im Standardlayout. Bestehende beim nächsten Laden (Version +1, Live-Ereignis).
- **Wohin:** Häuschen nur mit Straße an einer Seite, Eingang zur Straße, ein Feld Luft zueinander, lieber nahe der Dorfmitte. Daneben Briefkasten und ein, zwei Gartendinge; sonstige Deko bis zwei Felder neben Straßen, nie zwei direkt nebeneinander.
  - Nie auf Straßen, Wasser, Grundstücke oder den Ring direkt um ein Grundstück (Eingänge, Gehsteig der Figuren).
  - Figuren und Autos laufen nur über Straßen – Deko blockiert keinen Weg.
  - Deterministisch (fester Seed, feste Reihenfolge).
- **Verstreute Deko weicht neuen Gebäuden:** Sie trägt `auto: true`. `freienBlockFinden` zählt sie als frei, `fehlendePlatzieren` räumt Block und Straßenring.
  - Sonst würden die Häuschen die Blöcke neben dem Dorf belegen und ein neues Gebäude (z. B. der Kirchturm) landete weit draußen oder im Lager.
  - Was Leif im Bau-Modus verschiebt oder dreht, verliert `auto` und gehört ihm. Seine eigene Deko wird nie geräumt.
- **Kirchturm:** schlanker Turm (Gebäude-ID „Kirchturm“ → `modellArt` „kirchturm“), Zifferblatt auf allen vier Seiten, offene Glockenstube mit Glocke, Ziergiebel, Helm mit Kugel und Kreuz.
  - Zeiger sind eigene Objekte (`Modell.zeiger`). `szene.ts` stellt sie auf die Wiener Zeit (`?uhr=` gilt auch).
  - Der Minutenzeiger springt wie bei echten Turmuhren jede Minute: höchstens ein neues Bild pro Minute statt Daueranimation (Akku, Software-Grafik).
  - Kein Ton, sonst keine Animation. Die Vorlage `Kirchturm/gebaeude.md` kommt aus dem Hauptstrang.
- **Nachtrag beim Zusammenführen:** Hohe Gebäude (`HOHE_GEBAEUDE`, derzeit der Kirchturm) kommen auf einen Block, hinter dem (kleineres z) kein Gebäude steht. Sonst stand der Turm direkt vor der Uni und verdeckte sie aus der Startansicht.

## E73 – Börse: SIX/Franken und Saxo (nur lesen) (18.11.)

- **SIX:** Börse `SW` (EODHD-Kürzel `.SW`), Währung CHF. Die Wechselkurse liegen jetzt je Währung in `boerse_wechselkurse` (Migration 17, Dollar-Kurse übernommen). Geholt werden sie von der EZB, nur für Währungen im Depot. Der Einstand bleibt in Euro.
- **Saxo OpenAPI**, nach der Doku auf developer.saxo und im Saxo-Hilfe-Center (beides am 18.11. gelesen):
  - Anmeldung über „Authorization Code Grant“: `live.logonvalidation.net/authorize` bzw. `/token`, App-Schlüssel und Secret als HTTP-Basic.
  - Rückleitung an `/api/boerse/saxo/rueckruf`. Dieser Endpunkt ist ohne Dorf-Cookie erreichbar, weil SameSite=Strict den Cookie bei der Rückkehr von saxo nicht mitschickt. Geschützt ist er über einen einmaligen `state`, der 15 min gilt und den nur Leifs angemeldete Sitzung erzeugt.
  - **Tokens:** Der Access-Token lebt ~20 min, der Refresh-Token ~40 min, und jedes Erneuern macht den alten Refresh-Token ungültig. Deshalb liegt die Sitzung in der DB (`dorf_stand`, nicht in `.env`) und wird jede Minute geprüft, 5 min vor Ablauf erneuert. Ist der Refresh-Token abgelaufen oder lehnt Saxo ab, ist die Sitzung weg und Leif bekommt **eine** Telegram-Meldung (Schalter `bank`). Automatisch ohne Login geht laut Saxo für Privatkunden nicht.
  - **Leine:** `Saxo.lesen` kennt nur GET und nur vier Pfade (clients/me, balances/me, netpositions/me, performance/timeseries). Dazu kommt die Empfehlung, eine Live-App ohne Handelsrecht anzulegen (bei Saxo „NOT enabled for trading“). Getestet sind gesperrte Pfade, Pfad-Tricks und dass nur GET vorkommt.
  - Den Stand holt das Dorf alle 30 min, die Performance (Kontowert, zeitgewichtete Rendite) einmal am Tag. Die Rendite seit Jahresbeginn wird aus der kumulierten Reihe berechnet: (1+r_jetzt)/(1+r_31.12.)−1.
- **Offen:** Ob Saxo Schweiz die Live-API für Leifs Konto freischaltet, lässt sich nur mit seinem Login prüfen. Getestet ist gegen einen nachgebauten Server nach der Doku, die Feldnamen der Positionen stammen aus Saxos eigenem Beispielcode.

## E74 – Kirchturm: Wecker, Timer, Pomodoro, Stoppuhr (18.11.)

- **Alles läuft auf dem Server** (`kirchturm.ts`, Takt jede Sekunde, Zustand als JSON in `dorf_stand`). So zeigen alle Geräte dasselbe, und es klingelt auch, wenn gerade kein Fenster offen ist.
- **Wecker:** in Ortszeit Europe/Vienna, mit Sommerzeit (über `naechsterTermin` aus `zeitplan.ts`). Wochentage einstellbar; ohne Tage klingelt er einmal und geht danach aus.
  - Schlummern ist je Wecker einstellbar.
  - War der Server aus, holt der Wecker höchstens 15 Minuten nach; Älteres wird übersprungen.
- **Timer:** bis zu 20 gleichzeitig, mit Pause, Weiter, +1 min und Neustart, dazu Vorlagen (Tee, Nudeln, Powernap – anpassbar).
- **Pomodoro, voll einstellbar:** Arbeits-, kurze und lange Pause, „lange Pause nach n Runden“, Rundenzahl, automatisch weiter oder auf Start warten, dazu ein Thema (mit Vorschlägen aus den To-dos). Pause, Überspringen und Stopp gehen jederzeit.
- **Stoppuhr** mit Runden, ebenfalls auf dem Server.
- **Klingeln** löst das Live-Ereignis `kirchturm.klingelt` aus:
  - Auf **allen** Geräten erscheint ein Hinweis mit „Aus“ bzw. „Schlummern“; „Aus“ auf einem Gerät stoppt überall.
  - **Hörbar nur im Desktop-Programm** (Leifs Wunsch). Klingeln, die keiner ausschaltet, verschwinden nach 10 min.
- **Glocke = der einzige Ton im Dorf:**
  - Ein Schlag für Timer, Pomodoro und (abschaltbar) Mitteilungen; ein Geläut aus zwei Glocken für den Wecker, wiederholt bis „Aus“ (Anzahl einstellbar).
  - Die Töne sind selbst erzeugt (`apps/programm/src-tauri/toene/erzeugen.py`, additive Synthese) und im Programm eingebaut.
  - Abgespielt wird mit Bordmitteln (macOS `afplay`, Windows `Media.SoundPlayer`, Linux `paplay`/`aplay`). Das klingt auch bei verstecktem Fenster und kommt ohne Audio-Bibliothek aus.
  - Neue Programm-Befehle `glocke` und `glocke_stopp` nehmen nur die Namen „schlag“ und „gelaeut“ an – keine Pfade (Rust-Test + Selbsttest).
- Kein Telegram (Leifs Wahl: nur im Programm). Agenten stellen keine Uhren.

## E75 – Kalender auf dem Marktplatz: Leifs Google Calendar (18.11.)

- **Calendar API v3** (Doku developers.google.com, am 18.11. gelesen) über dieselbe Google-Anmeldung wie Gmail. Neue Bereiche: `calendar.events` (Termine lesen und ändern) und `calendar.calendarlist.readonly` (Kalenderliste). Leif muss die Calendar API im Cloud-Projekt aktivieren und sich mit `dorf gmail-anmelden` neu anmelden. Fehlt das, kommt ein verständlicher Hinweis, und der Kalender zeigt nur zum Lesen über die iCal-Adresse.
- **Ansichten:** Monat, Woche, Tag, Liste (30 Tage). Alle Kalender lassen sich einzeln ein- und ausblenden. Uni-Fristen sind eingeblendet, nur zum Ansehen. Alle Zeiten gelten für Europe/Vienna.
- **Bearbeiten:** anlegen, ändern, in einen anderen Kalender verschieben, löschen. Möglich sind ganztägige Termine, Serien (täglich, wöchentlich, werktags, monatlich, jährlich; enden nie, an einem Datum oder nach n Mal), bis zu 5 Erinnerungen und die 11 Google-Farben. Bei Serien wählt Leif „nur dieser Termin“ oder „ganze Serie“.
- **Leine:**
  - Geschrieben wird nur über die App-Routen, also mit Leifs Klick. Agenten bekommen weiter kein Schreibwerkzeug.
  - Einladungen gehen nie raus (`sendUpdates=none` bei jedem Schreiben). Teilnehmer werden nur angezeigt.
  - Kalender, die Leif nur lesen darf (z. B. Feiertage), sind gesperrt. Wiederholungsregeln prüft der Server gegen ein festes Muster.
- Kein Zwischenspeicher der Termine auf dem Server; nur die Kalenderliste wird 10 min im Speicher gehalten.

## E76 – Programme: Teil-Bau ausliefern (18.11.)

- **Anlass:** GitHub hat zweimal keinen Mac-Rechner zugeteilt („not acquired by Runner … even after multiple attempts“, nach 15 min abgebrochen). Damit blieb auch das fertige Windows-Programm liegen.
- **Jetzt:** Was gebaut ist, wird ausgeliefert. Fehlt eine Plattform, behält der Server deren bisherige Fassung zum Herunterladen, mit ihrer alten Versionsnummer in `programme.json`. Die Update-Datei bietet sie dann nicht an, sonst würde das Programm dieselbe alte Fassung immer wieder installieren.
- Ein Teil-Bau bekommt die Kennung `0000000000000000`, deshalb baut der nächste Lauf beide Plattformen neu. Getestet in `empfangen-test.sh` und `programme.test.ts`.
- **Nachtrag:** Auf Leifs Wunsch baut die CI vorerst **nur das Windows-Programm**, weil Mac-Minuten zehnfach zählen. Die letzte Mac-Fassung bleibt zum Herunterladen, bekommt aber keine Updates (also auch keine Glocke). Wieder einschalten: Mac-Eintrag in `ci.yml` (Matrix `programme`) und die Vollständigkeitsprüfung.
- **Nachtrag (Nacht 18./19.11.):**
  - Woche/Tag: Termine lassen sich ziehen (Zeit in 15-min-Schritten, auch auf einen anderen Tag) und am unteren Rand verlängern. Im Monat zieht man einen Termin auf einen anderen Tag. Bei Serien bewegt das nur diesen einen Termin.
  - Ist Google verbunden, lesen auch Morgenzeitung, Corps-Termine und `kalender_lesen` der Agenten über die API (alle Kalender). Geht das schief, nehmen sie die iCal-Adresse.

## E78 – Fokus: Pomodoro am To-do, Fokus-Statistik, Nicht stören (Nacht 18./19.11.)

- **🍅 an jedem offenen To-do** startet einen Pomodoro dafür: Thema = Titel, Fach = Gruppe des To-dos, der Pfad wird gemerkt.
- **Fokus-Protokoll** (Migration 18, `fokus_sitzungen`): Jede Arbeitsphase wird gespeichert. Abgebrochene oder übersprungene Phasen zählen mit der tatsächlich gearbeiteten Zeit, wenn es mindestens 1 min war.
  - Die Statistik (`/api/kirchturm/fokus`) zeigt heute, 7 Tage, je Tag, je Fach/Thema und eine Serie. Gezählt werden Tage in Folge mit mindestens einer fertigen Phase; der heutige Tag zählt erst, wenn dort eine fertig ist, sonst reißt die Serie schon morgens.
  - Die Morgenzeitung hat einen Abschnitt „Fokus“.
- **Nicht stören** (Standard an, im Pomodoro einstellbar): Während einer laufenden Arbeitsphase gilt für Telegram dasselbe wie in der Nachtruhe. Meldungen werden gesammelt, Dringendes (Fristen in wenigen Stunden) kommt trotzdem. Endet die Phase, kommt alles sofort in einer Nachricht „🍅 Während deiner Fokuszeit“.
- Warum: Die App soll beim Arbeiten helfen, nicht ablenken. Fokuszeit je Fach macht sichtbar, wo die Lernzeit wirklich hingeht.

## E79 – Lernzeit einplanen (Nacht 18./19.11.)

- An To-dos mit Fälligkeitsdatum (auch den automatischen Uni-Fristen) gibt es **📅**. Das Dorf sucht freie Blöcke im Google-Kalender, von jetzt bis zum Ende des Fälligkeitstags:
  - nur 08–20 Uhr Linzer Zeit, mit 15 min Puffer zu Terminen
  - je Tag höchstens ein Vorschlag, frühe Tage zuerst, Dauer wählbar (45 min bis 3 h)
  - ganztägige Termine und als „frei“ markierte Termine blockieren nicht; Pflichtvorlesungen und Prüfungen aus der Uni schon
- **Eintragen erst mit Leifs Klick** („Kalendereinträge legt nur Leif an“): Der Block kommt in den Hauptkalender als „📚 <Titel>“ mit 10 min Erinnerung, ohne Einladungen. Agenten haben dafür kein Werkzeug.

## E80 – Wochenrückblick (Nacht 18./19.11.)

- **Sonntags 18:30 (Linz)** schreibt das Dorf `Rathaus/wochenrueckblick/JJJJ-KWnn.md` (ISO-Kalenderwoche). War der Server aus, holt es den Rückblick bis zu 18 h später nach.
  - Vom **Code**: erledigte To-dos der Woche, offene und überfällige, Fokus (Stunden, stärkster Tag, Fächer), Fristen/Termine/fällige To-dos der nächsten 7 Tage, Budget-Zeilen der Bank und erledigte Agenten-Aufträge.
  - Von der **KI** (klein, ohne Werkzeuge, Fakten als Fremdinhalt): 2–3 Sätze Einschätzung und 2–3 kleine Vorschläge für die nächste Woche, als Checkliste in der Datei.
- In der App unter Rathaus → Wochenrückblick (auch „Jetzt erstellen“) und per Telegram; der Schalter ist derselbe wie bei der Morgenzeitung.
- Warum: Ein wöchentlicher Rückblick (wie das „Weekly Review“) hält die Listen sauber und lenkt den Blick auf die kommende Woche – das Dorf erledigt das Zusammentragen.

## E81 – Mail → To-do (Nacht 18./19.11.)

- Im Post-Eingang hat jede Mail **„✓ Als To-do“**. Das To-do bekommt den Betreff („Antworten: …“, wenn eine Antwort nötig ist), die Frist der Mail als Fälligkeit (wenn es ein Datum ist), Absender, Zusammenfassung und einen Link zurück in Gmail. Gebäude: Post.
- Der Server baut das To-do selbst aus der gespeicherten Mail (`/api/post/todo`, nur Mail-ID) und markiert es als **fremd**: Agenten mit Internet sehen es nicht, wie bei Rechnungen aus Mails.

## E82 – Termin aus Text (Nacht 18./19.11.)

- `terminAusText` (packages/shared, **ohne KI**, damit es sofort und verlässlich geht) versteht:
  - Datum: heute, morgen, übermorgen, Wochentage (auch „nächsten …“), „20.11.“ (ohne Jahr: ist das Datum schon vorbei, nächstes Jahr), „in 3 Tagen“
  - Zeit: Uhrzeiten und Bereiche wie „9-11“, „von 9 bis 11:30“
  - Dauer („für 2h“, „90 min“, „1,5 Stunden“, sonst 1 h) und Ort mit „@…“
  - Ohne Uhrzeit wird der Termin ganztägig; nur eine Uhrzeit heißt heute, oder morgen, wenn die Zeit schon vorbei ist.
- **App:** Feld „morgen 14 Uhr Zahnarzt …“ im Marktplatz-Kalender. Es füllt nur das Formular, Leif speichert selbst.
- **Telegram:** `/termin <Text>` zeigt eine Vorschau mit „✅ Eintragen“ (HMAC-signiert, höchstens 20 Vorschläge, 24 h gültig, kein Doppel-Eintrag). Eingetragen wird erst mit dem Klick, in den Hauptkalender, ohne Einladungen.

## E83 – Fach-Karten in der Uni (Nacht 18./19.11.)

- Statt einer Ordnerliste zeigt die Uni je Fach eine Karte mit:
  - der nächsten offenen Frist (rot ab 2 Tagen vorher),
  - offenen Übungsblättern in `aufgaben/`,
  - der Fokuszeit der letzten 7 Tage,
  - Knöpfen „🍅 Fokus“ (Pomodoro mit dem Fach als Gruppe) und „📚 Lernen“, dazu der Moodle-Link.
- Fristen und Fokus-Gruppen gehören zu einem Fach, wenn die Namen ungefähr passen: Groß-/Kleinschreibung und Sonderzeichen zählen nicht, ab 4 Zeichen reicht „enthält“. Grund: Kursnamen im Kalender („Mathe III“) und Ordnernamen weichen oft leicht voneinander ab.

## E84 – Tag planen (Nacht 18./19.11.)

- **„🧭 Tag planen“** im Marktplatz-Kalender: Das Dorf legt die dringendsten offenen To-dos in die freien Lücken eines Tages. Nach 18 Uhr ist der vorgeschlagene Tag morgen.
  - Rangfolge: überfällig → heute fällig → bald fällig (Uni zuerst) → ohne Datum (nur bei kurzer Liste).
  - Blocklänge: Abgaben und Prüfungen 90 min, sonst 45 min; 15 min Pause dazwischen, höchstens 5 Blöcke.
  - Freie Zeit: 8–20 Uhr, 15 min Puffer um Termine; Pflichtvorlesungen und Prüfungen der Uni zählen als belegt.
- **Ohne KI**, damit der Plan nachvollziehbar und sofort da ist (`tagesplan.ts`, getestet). Leif hakt ab, was er will; eingetragen wird als „📚 …“ in den Hauptkalender, ohne Einladungen.

## E77 – Mein Tag: die Seite „Heute“ (19.11.)

- **Wozu:** ein Blick am Morgen und zwischendurch – was steht an, was ist fällig, womit fange ich an. Eigene Seite `/heute` („Heute“ in der Kopfleiste zwischen Dorf und Bibliothek) und ein 📋-Knopf im 3D-Dorf.
- **Nur Anzeige, kein neuer Server-Code:** Die Seite nutzt die bestehenden Endpunkte und dieselben Query-Schlüssel wie die Gebäude-Reiter (`['kalender', von, bis]`, `['liste','todo']`, `['kirchturm']`, `['dorf-status']`, `['morgenzeitung']`, `['freigaben','offen']`). Dadurch hält `live.ts` sie ohne Zutun aktuell.
- **Inhalt:**
  - Kopf: Gruß, Datum, Wetter am Wohnort und „Als Nächstes“. Das ist der laufende oder nächste Termin von heute; gibt es keinen, das erste überfällige bzw. heute fällige To-do.
  - Termine heute und morgen (Europe/Vienna, Uni-Fristen inklusive). Vergangenes ist blass, Laufendes trägt „jetzt“. Antippen führt in den Marktplatz-Kalender. Kalender, die Leif dort ausgeblendet hat, fehlen auch hier.
  - To-dos: überfällig, heute, nächste 7 Tage, dazu die 5 neuesten ohne Datum. Abhaken direkt; Schnell-Anlegen mit Schalter „heute“ (ein Tipp statt Datumsfeld). Bearbeiten und Löschen bleiben auf dem To-do-Brett.
  - Fokus: Pomodoro starten, Pause, Stopp, Restzeit; laufende Timer und der nächste Wecker. Klingeln zeigt weiter nur die globale Glocke.
  - Offene Freigaben und die Morgenzeitung von heute (erster Absatz als Anreißer) erscheinen nur, wenn es sie gibt.
- **Aufbau:** am PC zwei Spalten (Termine + Fokus | To-dos), am Handy eine Spalte in der Reihenfolge Termine, To-dos, Fokus. Die Kopfleiste ist am Handy etwas enger gesetzt, damit vier Reiter und das Brief-Abzeichen Platz haben.
- **Bewusst nicht:** kein eigener Endpunkt, der alles bündelt (sechs kleine Abfragen sind schnell genug und bleiben live), und die Startseite bleibt das Dorf.
- Getestet mit Playwright (Desktop und Handy): Termine aus nachgebautem Kalender, To-do anlegen und abhaken, Fokus starten und stoppen, Sprung in den Kalender.

## E85 – Befehlspalette (Nacht 18./19.11.)

- **Strg/⌘+K** öffnet überall ein Feld für alles. Es sucht Seiten, Gebäude, offene To-dos und Aktionen (Name, Gebäude, Beschreibung), ab 3 Zeichen auch den Volltext der Bibliothek.
- **Befehle:**
  - `todo …` legt ein To-do an.
  - `termin morgen 14 Uhr …`: Das erste Enter zeigt die Vorschau, das zweite trägt ein (Hauptkalender, keine Einladungen).
  - `fokus [Thema]` startet einen Pomodoro, `timer 10 [Name]` einen Timer.
  - `frag …` legt eine Aufgabe auf den Schreibtisch des Bürgermeisters.
  - Ohne Befehlswort werden passende Befehle unter den Treffern angeboten.
- Zusätzlich auf „Heute“: Fokusminuten von heute und „🧭 Tag planen“.
- Warum: Weniger Klicks für das, was man zehnmal am Tag macht. Die Palette ist der schnellste Weg vom Gedanken zum Eintrag.

## E86 – ⭐ wichtig (Nacht 18./19.11.)

- Jedes offene To-do hat einen **Stern** (Marktplatz und „Heute“). Markierte To-dos (Frontmatter `wichtig: true`, auch in Obsidian setzbar):
  - stehen auf dem Brett und auf „Heute“ ganz oben (eigene Gruppe „⭐ Wichtig“),
  - kommen beim „Tag planen“ direkt nach Überfälligem dran,
  - erscheinen in der Morgenzeitung als erster Abschnitt „⭐ Heute wichtig“ und in Telegram `/todo` mit ⭐.
- Warum: Die „1–3 wichtigsten Dinge des Tages“ zu benennen ist die einfachste Produktivitäts-Regel. Das Dorf sorgt dafür, dass sie nicht in der langen Liste untergehen.

## E87 – Karteikarten (Nacht 18./19.11.)

- **Karten liegen als Markdown im Fach-Ordner** (`Uni/faecher/<Fach>/karten.md`), damit Leif sie in Obsidian lesen und bearbeiten kann. Zwei Schreibweisen: `Frage :: Antwort` oder `### Frage` mit der Antwort darunter. `##`-Überschriften gliedern nur und sind keine Karten.
- **Lernstand in der DB** (Migration 19, `karten_stand`). Der Schlüssel ist Fach + Frage, also darf sich die Antwort ändern, ohne dass der Fortschritt verloren geht.
  - Wiederholung in wachsenden Abständen (vereinfachtes SM-2): **Nochmal** kommt nach 10 min wieder, **Gut** nach 1 → 3 → 7,5 → … Tagen, **Leicht** ab 4 Tagen. Höchstens 15 neue Karten je Fach und Tag.
- **Uni → Karteikarten:** Übersicht je Fach (heute dran, neu, sitzt) und eine Lernansicht mit Tastatur (Leertaste = Antwort zeigen, 1–4 = bewerten). Die Fach-Karten und „Heute“ zeigen, wie viele Karten dran sind.
- **Aktion „Karteikarten erstellen“** (claude-code, mittel): Der Agent liest die Unterlagen des Fachs und ergänzt `karten.md` um 30–60 Karten, ohne bestehende zu ändern. Er schreibt nur im Uni-Gebäude, ohne Internet; die Unterlagen gelten als Fremdinhalt.
- Warum: Lernen mit Wiederholung in Abständen ist die wirksamste Prüfungsvorbereitung, und das Dorf hat die Unterlagen schon. Aus Folien werden so mit einem Klick abfragbare Karten.
- **Nachtrag Telegram:** `/karten [Fach]` zeigt die nächste fällige Karte. „Antwort zeigen“ deckt sie auf, danach bewertest du mit Nochmal/Schwer/Gut/Leicht, und die nächste Karte kommt in dieselbe Nachricht. Die Knöpfe sind HMAC-signiert. `/fokus [Thema]` startet einen Pomodoro, mit Nicht stören wie in der App.

## E88 – Tagesabschluss um 21 Uhr (Nacht 18./19.11.)

- Telegram schickt einmal am Abend (21:00–21:59 Linz, Schalter `abend`, Standard an) einen kurzen **Tagesabschluss**: was heute erledigt wurde, die Fokusminuten (mit Serie), wie viele Karteikarten noch dran sind und was morgen fällig ist.
- Darunter: **„⭐ Was ist morgen wichtig?“** mit Knöpfen für die nächsten offenen To-dos. Antippen setzt bzw. entfernt den Stern, die Knöpfe aktualisieren sich (HMAC-signiert). So steht morgen früh das Wichtige oben auf „Heute“ und in der Morgenzeitung.
- Warum: Der Abend ist der beste Moment, den nächsten Tag festzulegen. Morgens fängt man dann ohne Nachdenken mit dem Richtigen an.

## E89 – Gewohnheiten mit Serien (Nacht 18./19.11.)

- **Liste im Vault:** `Marktplatz/gewohnheiten.md`, Frontmatter `gewohnheiten:` mit `name`, `symbol` und `tage`. `tage` ist `täglich`, `werktags`, `wochenende` oder eine Liste wie `[mo, mi, fr]`. Die Datei lässt sich in Obsidian oder in der App pflegen. Ist sie fehlerhaft, wird der Fehler angezeigt; Anlegen ist dann gesperrt, damit nichts überschrieben wird.
- **Häkchen in der DB** (Migration 20, `gewohnheit_log`), je Gewohnheit und Tag eines. Abhaken geht für heute und nachträglich, nie für die Zukunft.
- **Serie:** zählt fällige Tage in Folge. Tage, an denen die Gewohnheit nicht dran ist, unterbrechen die Serie nicht. Ist heute noch offen, zählt die Serie bis gestern, damit sie nicht schon morgens „reißt“.
- **Wo sie auftaucht:**
  - **Heute:** eine Karte mit Haken, 🔥 Serie und sieben Punkten für die letzte Woche; Anlegen und Entfernen gehen dort auch.
  - **Telegram:** `/gewohnheiten`, und der Tagesabschluss schickt die offenen Gewohnheiten des Tages gleich mit, mit HMAC-signierten Abhak-Knöpfen.
  - **Wochenrückblick:** ein Abschnitt „Gewohnheiten“, z. B. „Sport 2/3 · Lesen 6/7 (🔥 12)“.
- Das Telegram-Befehlsmenü kennt jetzt auch `/termin`, `/karten`, `/fokus` und `/gewohnheiten`.
- Warum: Produktiv sein heißt nicht nur To-dos abarbeiten, sondern auch kleine Dinge regelmäßig tun (Sport, Lesen, Vokabeln). Die Serie motiviert, und der Abend in Telegram ist der natürliche Moment zum Abhaken.

## E90 – Telegram /plan und Gewohnheiten in der Morgenzeitung (Nacht 18./19.11.)

- **`/plan`** (heute) bzw. **`/plan morgen`** rechnet denselben Vorschlag wie „🧭 Tag planen“ in der App (E84, ohne KI) und schickt die Blöcke mit Begründung. Je Block gibt es einen Knopf; dazu „📅 Alle eintragen“.
  - Eingetragen wird erst per Knopf, jeder Block genau einmal. Er wird vor dem Eintragen vermerkt; schlägt das Eintragen fehl, wird der Vermerk zurückgenommen.
  - Die Knöpfe sind HMAC-signiert, ein Vorschlag gilt 24 h (`dorf_stand`, höchstens 10).
- **Morgenzeitung:** Ein Abschnitt „Gewohnheiten heute“ zeigt, was heute dran ist, mit Serie.
- Warum: Den Tag zu planen geht morgens am schnellsten im Bett mit dem Handy. Und wer morgens sieht, dass „Sport 🔥 6“ dran ist, reißt die Serie seltener.

## E91 – Wochenziele (Nacht 18./19.11.)

- **Datei je Kalenderwoche:** `Rathaus/wochenziele/JJJJ-KWnn.md` als normale Obsidian-Checkliste (`- [ ] Ziel` / `- [x] Ziel`). Die App ändert nur die Checkbox-Zeilen; Notizen, die Leif dazuschreibt, bleiben stehen. Geschrieben wird mit `basisVersion`, bei einem Konflikt kommt 409 statt Überschreiben.
- **Höchstens 7 Ziele**, gedacht sind 3. Doppelte werden abgelehnt.
- **Wo sie auftauchen:**
  - auf „Heute“ als Karte mit Fortschrittsbalken (anlegen, abhaken, entfernen)
  - in Telegram mit `/ziel <Text>` (setzt eines) bzw. `/ziel` (zeigt sie mit Abhak-Knöpfen). Ein Knopf trägt Woche, Nummer und den Hash des Zieltexts in sich und ist HMAC-signiert; hat sich die Liste inzwischen geändert, wird nichts falsch abgehakt.
  - in der Morgenzeitung oben, mit den offenen Zielen; montags ohne Ziele kommt ein Anstoß
  - im Wochenrückblick als Bilanz (✓/✗)
- **Sonntags** zeigt die Karte zusätzlich „📆 Nächste Woche“: Ziele für die kommende Woche lassen sich dann schon festlegen (API `naechsteWoche: true`).
- Der Bürgermeister kennt den Ort (Orientierung im Systemprompt) und kann seine Vorschläge daran ausrichten. Schreiben kann er dort nicht: Die Datei liegt im Rathaus, nicht in seinem Schreibbereich, und die Ziele setzt Leif.
- Warum: To-dos sagen, was ansteht; Wochenziele sagen, was zählt. Der Sonntag (Rückblick) und der Montag (Zeitung) bilden zusammen den kleinsten sinnvollen Wochenrhythmus.

## E92 – Wiederkehrende To-dos (Nacht 18./19.11.)

- **Neues Feld `wiederholen`** im Frontmatter eines To-dos. Erlaubt sind `täglich`, `werktags`, `wöchentlich`, `monatlich`, `jährlich` oder `alle N tage/wochen/monate`. Andere Werte werden abgelehnt (Zod), damit nichts stillschweigend falsch wiederholt wird.
- **Abhaken legt das Nächste an:** gleicher Titel, gleiche Gruppe, gleiches Gebäude, gleiche Notiz, gleiche Regel. Der Stern wird nicht übernommen, er gilt nur für den Tag.
  - Das neue Datum wird von der alten Fälligkeit aus weitergezählt und liegt immer nach heute. Ein überfälliges „täglich“ springt also nicht in die Vergangenheit.
  - Monatlich bleibt beim Tag: Ein To-do vom 31. landet im Februar auf dem 28., im März wieder auf dem 31.
- **Genau einmal:** Das erledigte To-do bekommt den Vermerk `wiederholt: <Pfad>`. Wer das Häkchen hin- und herklickt, erzeugt deshalb keine Doppelten.
- **Wo es geht:**
  - In der App unter „Bearbeiten“ → „Wiederholen“; in der Liste zeigt ein Abzeichen „🔁 wöchentlich“.
  - In Obsidian direkt im Frontmatter.
  - In Telegram mit `/todo Wäsche jeden Montag` (ebenso `täglich`, `werktags`, `jede Woche`, `jeden Monat`, `alle 3 Tage` …). Das erste Datum ist der nächste passende Tag.
  - Agenten über `todo_anlegen`/`todo_bearbeiten` – laut Werkzeugbeschreibung nur, wenn Leif es so will.
- Warum: Viele Pflichten kommen regelmäßig wieder (Wäsche, Miete, Vokabeln, Corps-Abend). Ohne Wiederholung müsste Leif sie jedes Mal neu anlegen oder sie fehlen auf „Heute“ und im Tagesplan.

## E93 – Statistik im Rathaus (Nacht 18./19.11.)

- **Neuer Rathaus-Reiter „Statistik“** (auch in der Befehlspalette). Er zeigt vier Kennzahlen: erledigte To-dos der letzten 7 Tage, Fokus, Gewohnheiten (Anteil der fälligen, die erledigt sind) und aktive Tage.
- **Darunter je Kennzahl ein eigenes Balkendiagramm**, also kleine Vielfache statt eines Diagramms mit zwei Achsen. Es gibt nur eine Reihe je Diagramm, deshalb keine Legende; der Titel sagt, was gezeigt wird.
  - Darstellung: dünne Balken mit 2 px Abstand und zurückhaltendem Gitter. Hover oder Tippen zeigt den Wert; die Trefferfläche ist breiter als der Balken.
  - Eine „Tabelle“ zeigt alle Zahlen, wählbar sind 4 Wochen oder 3 Monate.
- **Datenquellen:** nur vorhandene Daten (`erledigt_am` der To-dos, `fokus_sitzungen`, `gewohnheit_log`), keine KI, kein neuer Speicher.
- Eine Gewohnheit zählt erst ab ihrem ersten Häkchen. So drückt eine heute angelegte Gewohnheit die Quote der letzten Wochen nicht.
- Warum: Was man sieht, verbessert man. Und Leif kann prüfen, ob das Dorf ihn tatsächlich produktiver macht – oder ob es nur gut aussieht.

## E94 – Erinnerungen an To-dos (Nacht 18./19.11.)

- **Neues Feld `erinnerung: JJJJ-MM-TTTHH:MM`** (Ortszeit Wien) am To-do. Es ist lesbar und in Obsidian änderbar.
- **Prüfung alle 30 s** (`todo-erinnerungen.ts`): Ist die Zeit da, läutet der **Kirchturm**. Im Programm sind das Glocke und Systemmeldung, in der App ein Hinweis mit „✓ Erledigt“ und „+10 min“. Damit bleibt es bei Leifs Regel, dass nur der Kirchturm für Zeit und Mitteilungen läutet.
- **Telegram** schickt dazu „🔔 Erinnerung“ mit den Knöpfen ✅ Erledigt, ⏰ +1 h und 🌅 Morgen 9:00 (HMAC-signiert). Das gilt auch in der Nachtruhe und während Fokus, denn die Zeit hat Leif selbst gewählt.
- **Genau einmal:** Vor dem Läuten wird `erinnert: <Zeitpunkt>` vermerkt. Erst ein neuer Zeitpunkt (Verschieben, Bearbeiten) läutet wieder. Wurde ein Zeitpunkt mehr als 12 h verpasst (z. B. weil der Server aus war), läutet er nicht mehr nach.
- **Wiederkehrende To-dos** übernehmen die Uhrzeit auf den neuen Tag.
- **Anlegen:**
  - in der App beim Bearbeiten
  - in Telegram mit `/erinner morgen 9 Uhr Mama anrufen`, `/erinner in 30 min Wäsche` oder `/erinner Fr 14:00 Bericht`; daraus wird ein To-do mit Fälligkeit und Erinnerung
  - von Agenten über `todo_*` – laut Beschreibung nur, wenn Leif es will
- Warum: Ein To-do ohne Zeit geht im Tag leicht unter. Eine Erinnerung zur richtigen Minute am Handy und am PC schließt diese Lücke – ohne eine zweite App.

## E95 – Schnelle Notizen (Nacht 18./19.11.)

- **Ein Gedanke soll in Sekunden festgehalten sein**, ohne dass Leif entscheiden muss, wohin er gehört. Dafür gibt es je Tag eine Datei `Rathaus/notizen/JJJJ-MM-TT.md` mit Zeilen „- HH:MM Text“.
- **Wege dorthin:**
  - Telegram `/notiz <Text>`; ohne Text zeigt der Befehl die Notizen von heute.
  - In der Befehlspalette „notiz …“.
  - Die API `POST /api/notiz`.
- **Angehängt wird mit `basisVersion`**: Schreibt Obsidian gleichzeitig, versucht das Dorf es einmal neu; Leifs eigener Text bleibt stehen. Zeilenumbrüche werden zu „⏎“, damit jede Notiz eine Zeile bleibt.
- **Unterschied zu `/todo` und zum Bürgermeister:** Eine Notiz ist weder Aufgabe noch Auftrag, nur ein Merkzettel. Der Bürgermeister kennt den Ort (Orientierung) und kann die Notizen bei Rückblicken oder auf Nachfrage lesen.

## E96 – Lernplan bis zur Prüfung (Nacht 18./19.11.)

- **„📅 Lernzeit“ hat zwei Modi:** wie bisher „Ein Block“ und neu **„Lernplan bis zur Frist“**. Leif wählt die Gesamtstunden (z. B. 6 h) und die Länge je Block (z. B. 1,5 h). Das Dorf verteilt die nötige Zahl an Blöcken möglichst gleichmäßig auf die Tage bis zum Vorabend der Frist, höchstens einen pro Tag, jeweils die früheste freie Lücke zwischen 9 und 20 Uhr. Puffer und belegte Zeiten werden wie bei „Ein Block“ beachtet.
- **Passt nicht alles hinein**, sagt die Ansicht das offen („nur 3 von 4 Blöcken“) und schlägt längere Blöcke oder einen früheren Start vor.
- **Nur ein Vorschlag:** Leif kann einzelne Blöcke abwählen. Eingetragen wird erst mit seinem Klick, über denselben Weg wie „Tag planen“: Hauptkalender, „📚 Lernen: …“, Erinnerung 10 min vorher, nie Einladungen.
- **Technik:** API `GET /api/kalender/lernplan?bisTag=JJJJ-MM-TT&stunden=…&dauer=…`. Die Verteilung `gleichmaessigVerteilen` ist eine reine Funktion und getestet.
- Warum: Verteiltes Lernen schlägt Pauken am Vorabend. Mit diesem Modus wird aus „Prüfung am 23.“ in einem Klick ein Plan im Kalender.

## E97 – Überfälliges aufräumen (Nacht 18./19.11.)

- **Telegram `/aufraeumen`:** Die überfälligen To-dos kommen eines nach dem anderen in derselben Nachricht, mit Angabe „seit N Tagen überfällig“. Knöpfe: 📌 Heute, ➡️ Morgen, 📆 Nächste Woche (kommender Montag), ✅ Erledigt, ➖ Ohne Datum, 🗑 Löschen (Papierkorb). Alle sind HMAC-signiert. Nach jedem Tipp kommt das nächste, am Ende „Nichts überfällig 🎉“.
- **Tagesabschluss** zeigt „⚠️ N überfällig – /aufraeumen …“, sobald etwas liegen geblieben ist.
- **„Heute“:** Überfällige To-dos haben „→ heute“ und „→ morgen“ direkt in der Zeile.
- Warum: Ein Stapel Überfälliges macht jede Liste unbrauchbar und demotiviert. Eine Minute Aufräumen am Abend hält „Heute“ ehrlich: Dort steht, was wirklich heute dran ist.

## E98 – Noten & ECTS (Nacht 18./19.11.)

- **Datei `Uni/noten.md`** mit Frontmatter `faecher:` (fach, ects, note, semester) und optional `ziel_ects`. Sie ist in Obsidian lesbar und änderbar; ist sie fehlerhaft, kommt eine klare Meldung statt stillem Überschreiben. Absichtlich nicht in `kurs.md`, denn die schreibt der Moodle-Abgleich.
- **Österreichische Skala:**
  - 1–4 bestanden, 5 „Nicht genügend“ (zählt weder für ECTS noch für den Schnitt).
  - „bestanden“ steht für „mit Erfolg teilgenommen“ ohne Note: Die ECTS zählen, der Schnitt nicht.
  - Ein leerer Eintrag ist noch offen.
- **Schnitt:** nach ECTS gewichtet über die benoteten, bestandenen Fächer.
- **Uni → Noten:** Kennzahlen (Schnitt, ECTS bestanden und offen, Fortschritt zum Ziel, z. B. 180 ECTS) und eine Tabelle zum Pflegen. Fächer aus `Uni/faecher/` erscheinen beim Hinzufügen als Vorschläge.
- Warum: Den Überblick über ECTS und Schnitt braucht man ständig – für Stipendien, Bewerbungen, Studienplanung –, und er liegt sonst verstreut im Uni-Portal.

## E99 – „Fokus geschafft – erledigt?“ (Nacht 18./19.11.)

- Läuft ein Pomodoro für ein To-do (🍅 am To-do), trägt das Klingeln nach jeder Arbeitsrunde den Bezug zum To-do (`todo: { pfad, titel }`). Der Kirchturm-Hinweis bietet dann neben „Aus“ auch **„✓ To-do erledigt“** an.
- Ist die ganze Pomodoro-Folge vorbei (`sitzungEnde`), fragt **Telegram** einmal: „🍅 Fokus geschafft: … – erledigt?“, mit einem Knopf zum Abhaken (HMAC-signiert, derselbe Weg wie bei Erinnerungen). Nach einzelnen Runden fragt Telegram nicht, das wäre zu viel.
- Warum: Der Moment nach der Fokusrunde ist der natürliche Zeitpunkt zum Abhaken. Wer es dann vergisst, hat ein erledigtes To-do, das weiter auf „Heute“ steht.

## E100 – Telegram /woche (Nacht 18./19.11.)

- **`/woche`** zeigt jederzeit die Woche auf einen Blick: Wochenziele (offen ☐ / erreicht ✓), die nächsten 7 Tage (Fristen, Termine, fällige To-dos) und die Gewohnheiten-Bilanz.
- Die Fakten kommen aus derselben Funktion wie der Wochenrückblick, aber ohne KI und ohne etwas zu speichern.
- Warum: `/heute` beantwortet „Was jetzt?“, `/woche` beantwortet „Was kommt?“. Das ist die Frage am Sonntagabend oder vor dem Planen.

## E101 – Morgenzeitung mit Schnellknöpfen (Nacht 18./19.11.)

- Die Morgenzeitung in Telegram bekommt bis zu drei Knöpfe:
  - **🧭 Tag planen**, wenn der Google-Kalender verbunden ist
  - **🧹 Aufräumen (N)**, wenn etwas überfällig ist
  - **🔁 Gewohnheiten**, wenn heute eine dran ist
- Ein Tipp führt genau den Befehl aus, den man sonst tippen würde (`/plan`, `/aufraeumen`, `/gewohnheiten`). Die Knöpfe sind HMAC-signiert und lösen nichts anderes aus.
- Warum: Morgens liest Leif die Zeitung auf dem Handy. Von dort ist der nächste Schritt, nämlich den Tag einzuteilen, so nur einen Tipp entfernt.

## E102 – Vorschläge aus dem Wochenrückblick als Wochenziel (Nacht 18./19.11.)

- Der Wochenrückblick in Telegram (sonntags 18:30) hängt an jeden KI-Vorschlag für die nächste Woche einen Knopf **„🎯 …“** (höchstens drei). Ein Tipp schreibt den Vorschlag als Checkbox-Ziel in die Wochenziele-Datei. Sonntags ist das die Datei der neuen Woche (`JJJJ-KWnn+1`), ab Montag die der laufenden Woche.
- Die Vorschläge werden für 8 Tage in `dorf_stand` gemerkt, die Knöpfe sind HMAC-signiert. Für Wochenziele gilt weiter die Obergrenze von 7.
- Warum: Aus dem Rückblick wird so ohne Umweg der Plan für die nächste Woche. Die KI schlägt nur vor, entscheiden tut Leif mit einem Tipp.

## E103 – Telegram-Kurzformen ohne Schrägstrich (Nacht 18./19.11.)

- `todo: …`, `notiz: …`, `ziel: …` und `einkauf: …` (Groß-/Kleinschreibung egal) wirken wie der jeweilige Befehl. Am Handy tippt sich ein Doppelpunkt schneller als ein Schrägstrich, und die Nachricht geht nicht als Auftrag an den Bürgermeister (spart KI-Läufe).
- **Nur Leifs eigene Textnachrichten.** Weitergeleitetes ist Fremdinhalt und geht wie bisher als Aufgabe auf den Schreibtisch. So kann eine weitergeleitete Nachricht, die mit „todo:“ beginnt, nichts von selbst auf die Liste setzen.

## E104 – Telegram /statistik (Nacht 18./19.11.)

- **`/statistik`** zeigt die letzten 7 Tage als kleine Balken aus Blockzeichen (▁▂▃▄▅▆▇█, `·` = nichts), eine Zeile je Kennzahl: erledigte To-dos, Fokus, Anteil erledigter Gewohnheiten. Darüber stehen die Wochentage, darunter die Summen und die Zahl der aktiven Tage. Ein Link führt zur ausführlichen Statistik im Rathaus.
- Dieselbe Berechnung wie in der App (`statistik.ts`), ohne KI.

## E105 – Prüfungs-Wächter (Nacht 18./19.11.)

- Alle 10 Minuten, aber nur zwischen 9 und 20 Uhr, prüft der Telegram-Bot jedes offene To-do „Prüfung: …“ mit Termin in 3–14 Tagen. Steht im Google-Kalender bis dahin **kein** Block „📚 …<Name>“, fragt er **einmal**: „📚 Statistik ist in 7 Tagen – noch keine Lernzeit. Lernplan vorschlagen?“ mit den Knöpfen 6 h, 10 h und 15 h. Gemerkt wird je Pfad und Datum; eine verschobene Prüfung zählt also neu.
- **Ein Tipp** rechnet den Lernplan wie in der App (E96: Blöcke à 1,5 h, gleichmäßig bis zum Vorabend, 9–20 Uhr) und zeigt ihn mit einem Knopf je Block und „📅 Alle eintragen“. Eingetragen wird erst damit, als „📚 Lernen: <Name>“. Dadurch erkennt der Wächter beim nächsten Mal, dass es schon Lernzeit gibt.
- Alles ohne KI; Kalendereinträge entstehen nur durch Leifs Tipp. Alle Knöpfe sind HMAC-signiert.
- Warum: Der häufigste Prüfungsfehler ist, zu spät anzufangen. Der Wächter fragt rechtzeitig und macht den Plan mit zwei Tipps.

## E106 – Gewohnheiten mit Uhrzeit (Nacht 18./19.11.)

- **Neues optionales Feld `uhrzeit: HH:MM`** (Wien) an einer Gewohnheit in `Marktplatz/gewohnheiten.md`, z. B. „Vitamine 08:00“.
- **Wann geläutet wird:** Ist die Gewohnheit heute dran, noch offen und die Uhrzeit erreicht (höchstens 3 h danach), läutet der **Kirchturm** einmal. Schlummern gibt es dafür nicht; abgehakt verstummt die Glocke.
- **Telegram** schickt dazu „🔁 💊 Vitamine – Zeit dafür!“ mit genau ihrem Abhak-Knopf.
- **Höchstens einmal am Tag** je Gewohnheit (Vermerk in `dorf_stand`). Was mehr als 3 h verpasst ist, läutet nicht nach – eine Gewohnheit um 8 Uhr soll nicht um 15 Uhr klingeln.
- Geprüft wird im selben 30-Sekunden-Takt wie die To-do-Erinnerungen (E94). Es gilt dieselbe Regel: Läuten tut nur der Kirchturm.

## E107 – Stimmung des Tages (Nacht 18./19.11.)

- **Frage im Tagesabschluss:** Nach dem Tagesabschluss (21 Uhr) fragt Telegram „💭 Wie war dein Tag?“ mit fünf Gesichtern (😞 😕 😐 🙂 😄). Ein Tipp speichert 1–5 für den Tag (Migration 21, Tabelle `stimmung`); ein zweiter Tipp überschreibt. Die Knöpfe sind HMAC-signiert und tragen das Datum, also landet ein später Tipp auf dem richtigen Tag.
- **Auch per API:** `POST /api/stimmung` (für eine spätere App-Ansicht).
- **Wo die Werte auftauchen:**
  - Die Statistik (`/api/statistik`) liefert je Tag `stimmung` und den Schnitt.
  - `/statistik` in Telegram zeigt eine Stimmungszeile.
  - Der Wochenrückblick hat einen Abschnitt „Stimmung: Ø 3,8 · 🙂 😐 😄 …“.
- Warum: Produktivität ohne Befinden ist die halbe Wahrheit. Neben Fokus, Gewohnheiten und Erledigtem zeigt die Stimmung über Wochen, was guttut und was nicht. Ein Tipp am Abend kostet nichts.

## E108 – Telegram /suche (Nacht 18./19.11.)

- **`/suche <Begriff>`** (oder `/s`) durchsucht den ganzen Vault über den vorhandenen Volltextindex (FTS5): Notizen, Uni-Unterlagen, To-dos, Protokolle. Bis zu 8 Treffer kommen mit Titel und Pfad, jeder als Link in die Bibliothek mit hervorgehobenem Begriff.
- Die Ausschnitte aus den Dateien werden absichtlich nicht mitgeschickt. Vault-Dateien können Fremdinhalt sein, und Telegram zeigt nur Titel und Pfad (HTML-escaped).

## E109 – Anschlüsse in den Einstellungen (Nacht 18./19.11.)

- **Neuer Abschnitt ganz oben in den Einstellungen:** Er zeigt für jeden Anschluss, ob er verbunden ist, wofür er gebraucht wird und – falls nicht – den Befehl auf dem Server (mit „kopieren“). Erfasst sind KI-Schlüssel, Werkstatt, Telegram, Gmail, Google-Kalender, Uni-Fristen, Moodle-Browser, EODHD und Saxo.
- **Zwischenstände** werden als „teilweise“ markiert, mit konkretem Hinweis. Beispiel Kalender: nur die iCal-Adresse, also lesen ohne API, dazu der Hinweis „Calendar API aktivieren, dann `dorf gmail-anmelden`“. Beispiel Saxo: App-Schlüssel da, aber noch nicht angemeldet.
- **Sicherheit:** `GET /api/anschluesse` liefert nur Ja/Nein und feste Texte, nie Geheimnisse oder Teile davon (getestet). Ohne Anmeldung gibt es 401.
- Warum: Einige Funktionen der Nacht (Tag planen, Lernplan, Prüfungs-Wächter, Saxo) hängen an Anschlüssen, die noch fehlen. So sieht Leif auf einen Blick, was zu tun ist.

## E110 – Gewohnheiten „N× pro Woche“ (Nacht 18./19.11.)

- **`tage: 3x pro woche`** (1–6): Die Gewohnheit hat keinen festen Tag. Sie ist jeden Tag „dran“, bis das Wochenziel (Montag bis Sonntag) erreicht ist; danach nicht mehr, außer sie wurde heute schon abgehakt.
- **Serie in Wochen:** Gezählt werden die aufeinanderfolgenden Wochen, in denen das Ziel erreicht wurde. Die laufende Woche zählt erst mit, wenn das Ziel geschafft ist, deshalb reißt die Serie montags nicht.
- **Anzeige:** Telegram zeigt „2/3 diese Woche“, der Wochenrückblick „Sport 3/3 (🔥 2 Wochen)“.
- In der Tagesquote der Statistik zählen solche Gewohnheiten nicht mit, weil kein Tag „fällig“ ist. Sonst sähe ein freier Tag wie ein verpasster aus.
- Warum: Viele Vorsätze lauten „dreimal die Woche“, nicht „jeden Montag, Mittwoch, Freitag“. Ohne diese Form wäre die Serie bei Sport ständig gerissen.

## E111 – Review der Nacht: Korrekturen (Nacht 18./19.11.)

Ein unabhängiger Prüfdurchgang über die neuen Server-Teile ergab nichts an Sicherheit oder Leine, aber diese echten Fehler. Alle sind behoben und mit Tests abgesichert:

- **Eigene Felder blieben nicht erhalten:** Was Leif in Obsidian in `Uni/noten.md` oder `Marktplatz/gewohnheiten.md` zusätzlich an einen Eintrag schreibt (z. B. `pruefer`, `notiz`), ging beim nächsten Speichern aus der App verloren. Jetzt wird die rohe Liste weitergeschrieben bzw. der Eintrag ergänzt statt ersetzt. Standardwerte (`symbol: ✅`) landen nicht mehr in der Datei.
- **Sommerzeit:** „morgen“, „nächste Woche“ und die Tagesreihen der Statistik wurden mit `jetzt ± 24 h` gerechnet. An 23- bzw. 25-Stunden-Tagen lag das einen Tag daneben, z. B. landete „🌅 Morgen 9:00“ am falschen Tag oder die Statistik zeigte einen Tag doppelt. Neu ist `zeit.ts` (`tagVonJetzt`, `tagPlus`): Es wird mit Kalendertagen in Wien gerechnet.
- **Lernzeit bis zur Frist:** Lag die Frist am Fristtag früher als die aktuelle Uhrzeit, fiel der ganze Fristtag aus dem Vorschlag. Jetzt läuft die Suche über Kalendertage bis einschließlich zum Fristtag.
- **Monatlich ab dem 31.:** Die Wiederholung blieb nach dem Februar dauerhaft beim 28. Jetzt merkt sich das To-do den ursprünglichen Tag (`wiederholen_tag`): 31.01. → 28.02. → 31.03.
- **Wiederkehrendes halb abgehakt:** Der Nachfolger wird jetzt geprüft, *bevor* das Original als erledigt gespeichert wird; zu lange Felder aus Obsidian werden gekürzt. Der Vermerk `wiederholt` wird bei gleichzeitigem Schreiben neu versucht, damit kein zweiter Nachfolger entsteht.
- **Wochenziele nach Nummer:** Abhaken und Entfernen in der App schicken jetzt auch den angezeigten Text mit. Hat sich die Datei inzwischen geändert, gibt es 409 statt eines falsch getroffenen Ziels.
- **Telegram:**
  - Lange Nachrichten werden an einer ganzen Zeile gekürzt statt mitten in einem Tag; Telegram hätte sie sonst ganz abgelehnt.
  - Knopftexte werden nach Zeichen gekürzt, damit kein Emoji zerteilt wird.
  - Gewohnheits-Knöpfe tragen das Datum: Ein Tipp nach Mitternacht auf die Nachricht von gestern hakt gestern ab. Ältere Knöpfe gelten weiter für heute.
  - Der Prüfungs-Wächter merkt sich jede Frage sofort und fragt nicht während einer Fokusphase.
- **Erinnerungen in allen Listen:** Einkauf, Wunsch und Corps läuten jetzt auch, und „Erledigt“ bzw. „+1 h“ trifft die richtige Liste.
- **Notizen:** Bei gleichzeitigem Schreiben kommt die überflüssige Konfliktkopie (nur die doppelte Notiz) in den Papierkorb.
- **Wackelnder Test:** Der Test „Freigabe-Knöpfe“ wartet jetzt, bis die Meldung da ist, statt fest 20 ms.

## E112 – Das Dorf blüht (Nacht 18./19.11.)

- **Sinn der App:** Das Dorf ist nicht nur Kulisse, es spiegelt, wie es Leif geht. Neu: `bluete` im Dorfstatus. Ein Wert 0–1 aus den letzten 7 Tagen, gewichtet:
  - aktive Tage 35 %
  - Gewohnheiten 25 %
  - Fokus 20 % (≈ 2 Pomodoros am Tag = voll)
  - Erledigtes 20 % (≈ 2 am Tag = voll)
- **Stufen:** karg, grün, blühend, prächtig.
- **Fahne am Rathaus,** wenn alle Wochenziele erreicht sind; **Feuerwerk** an Tagen mit ≥ 5 erledigten To-dos.
- **Wirkung im 3D-Dorf:** mehr Blumen, Laub, Licht und Leben je Stufe – wie die Wetter-Darstellung, aber aus Leifs eigenen Zahlen.
- **Absicht:** motivieren, nicht bestrafen. Schon ein paar aktive Tage machen das Dorf grün; nichts geht kaputt, wenn eine Woche schlecht war. Ohne KI, nur aus vorhandenen Zahlen. Ein Fehler in der Berechnung verhindert den Dorfstatus nie.
- **Darstellung im 3D-Dorf** (`apps/web/src/dorf/bluete.ts`, nur Anzeige – der Server bleibt unverändert):
  - **Blumen:** ein instanziertes Mesh auf freien Feldern und den Wiesen ringsum, an Wegen dichter. Alle Plätze werden einmal fest verteilt; die Stufe bestimmt nur, wie viele gezeichnet werden (karg 6 %, grün 30 %, blühend 65 %, prächtig 100 %; höchstens 1600, Handy 900, Software-Grafik 450). Im Winter wenige helle Winterblüher.
  - **Farben:** Wiesen und Rasen werden getönt (prächtig satter, karg etwas blasser) – im Winter nicht, Schnee bleibt weiß.
  - **Fenster nachts:** je Stufe sind mehr Häuser hell erleuchtet (karg die Hälfte, prächtig alle); die übrigen haben gedämpftes Licht, keines ist dunkel. Das Rathaus leuchtet immer.
  - **„karg“ heißt in der Anzeige „Das Dorf ruht“** – ruhig und schlicht, nichts fehlt oder verfällt.
  - **Fahne:** eigener Mast vor dem Rathaus in den Rathausfarben; das Tuch weht, wenn animiert wird.
  - **Feuerwerk:** fünf Raketen kurz nach dem Laden, dann alle 4 Minuten eine Runde – nur mit Animation (nicht bei „Bewegung reduzieren“ und nicht mit Software-Grafik).
  - **Schild** neben dem Wetter (Symbol + Stufe, am Handy nur das Symbol); Tipp zeigt die Gründe.
  - **Vorschau:** `?bluete=karg|gruen|bluehend|praechtig`, `?fahne`, `?feuerwerk` (auch `=0`) übersteuern den Serverwert in Szene und Schild. Tests lesen `window.__dorf.blueteStand()`.

## E113 – Blüte in Zeitung und Rückblick, Telegram /noten (Nacht 18./19.11.)

- Morgenzeitung und Wochenrückblick haben einen Abschnitt **„Dein Dorf“**, z. B. „🌸 blühend – 5 von 7 Tagen aktiv, Gewohnheiten 80 %, 150 min Fokus · 🚩 alle Wochenziele erreicht“. Berechnet wird er genauso wie im Dorfstatus (E112).
- **`/noten`** in Telegram zeigt Schnitt, bestandene, offene und Ziel-ECTS sowie die Fächer mit Note (E98).

## E114 – Offline-Warteschlange und schnellerer Start (Nacht 18./19.11.)

- **Offline-Warteschlange:** Scheitert das Anlegen eines To-dos, eines Listeneintrags (Einkauf, Wunsch, Corps) oder einer Notiz an fehlender Verbindung, merkt die App den Eintrag im Gerät (`localStorage`). Sie sendet ihn von selbst, sobald die Verbindung zurück ist, und zusätzlich alle 30 s. Ein gelber Hinweis zeigt, wie viele Einträge warten.
- **Bewusst nur Anlegen:** Abhaken, Löschen oder Ändern werden nicht nachgeholt. Ein verspätetes Löschen könnte etwas treffen, das inzwischen anders aussieht.
- **Verworfen statt wiederholt:** Antwortet der Server später mit 4xx (ungültig), wird der Eintrag verworfen; bei 5xx bleibt er.
- **Lazy Loading:** Die Seiten Heute, Gebäude, Bibliothek, Einstellungen, Chat und Fokus werden erst beim Öffnen geladen. Das Haupt-Bündel schrumpft von 668 auf 296 KB, der Start am Handy wird spürbar schneller.

## E115 – Foto/Datei als Notiz, Mail-Hinweis, Anleitung (Nacht 18./19.11.)

- **Foto/Datei mit „notiz: …“:** Ein Foto oder eine Datei in Telegram mit der Bildunterschrift „notiz: …“ (z. B. Tafelbild, Buchseite) landet in der Tagesnotiz: Das Bild liegt unter `Rathaus/notizen/anhaenge/`, in der Notiz steht es als `![[…]]` (Obsidian zeigt es an). Das wird keine Aufgabe für den Bürgermeister. Weitergeleitetes ist Fremdinhalt und bleibt ausgenommen.
- **„Heute“** zeigt „✉️ N Mails warten auf Antwort“ – Mails der letzten 3 Tage, die die Einordnung als „Antwort nötig“ markiert hat.
- **`/anleitung`:** „So nutzt du das Dorf“ – der Tages- und Wochenrhythmus mit allen Bausteinen auf einer Seite. Verlinkt ist sie aus „Erste Schritte“, den Einstellungen und der Befehlspalette.

## E116 – Gewohnheiten bearbeiten, Schreiben nacheinander (Nacht 18./19.11.)

- **Gewohnheiten bearbeiten:** Unter „Bearbeiten“ lassen sich Tage (auch „N× pro Woche“) und die Uhrzeit ändern (`PATCH /api/gewohnheiten`). Die Häkchen hängen am Namen und bleiben erhalten, ebenso eigene Felder aus Obsidian.
- **Behobener Fehler:** Wer nur die Uhrzeit änderte, setzte die Tage still auf „täglich“ zurück. Der Standardwert des Schemas griff auch beim Ändern; jetzt gilt er nur beim Anlegen.
- **Schreiben nacheinander:** `gewohnheiten.md`, die Wochenziele-Dateien und `noten.md` werden je Dienst in einer Warteschlange geschrieben. Zwei schnelle Änderungen hintereinander, etwa Tage und gleich danach die Uhrzeit, führten sonst zu einem Konflikt: Die zweite überschrieb die erste oder hinterließ eine Konfliktkopie.

## E117 – Kursalarm in der Börse (Nacht 18./19.11.)

- Positionen und Watchlist-Werte können `alarm_unter` und/oder `alarm_ueber` bekommen, in der Währung des Kurses. Das geht in der App (Börse → „+ Beobachten“) oder in `Boerse/depot.md`.
- **Wann gemeldet wird:** Nach jedem Kursabruf (Schlusskurse, ≤ 19 Abrufe am Tag) prüft das Dorf die Grenzen. Telegram meldet „🔔 Kursalarm – 📉 All-World: 95 EUR – unter deiner Grenze 100“, und zwar **einmal je Überschreiten**. Erst wenn der Kurs wieder auf der anderen Seite war, meldet dieselbe Grenze erneut. Der Zustand liegt in `dorf_stand`. Es gilt derselbe Schalter wie für Saxo-Meldungen, und die Nachtruhe wird beachtet.
- **Nur Information:** Die Börse handelt nie, daran ändert sich nichts.
- **Eigene Felder bleiben:** Was Leif in `depot.md` zusätzlich an einen Wert schreibt (z. B. `notiz`), bleibt beim Speichern aus der App erhalten (wie E111).

## E118 – Zweites Review: Offline-Schlange, Fehlerseite, Album-Notiz (Nacht 18./19.11.)

- **Offline-Schlange abgesichert (ergänzt E114):**
  - Jeder Eintrag hat eine ID.
  - Gesendet wird nie zweimal gleichzeitig, auch nicht aus zwei Reitern (Web Locks).
  - Am Ende wird die Schlange frisch gelesen, und es fallen nur die gesendeten oder verworfenen Einträge weg. Was während des Sendens dazukam, bleibt erhalten. Vorher konnte ein Eintrag doppelt ankommen oder ein neuer verloren gehen.
- **Wann ein Eintrag verworfen wird:**
  - Nur bei 400/404/409/413/422.
  - Bei 401 bleibt er, und die App geht zur Anmeldung. Nach dem Anmelden wird gesendet.
  - Bei 403/408/429/5xx bleibt er für später.
- **Feld wird geleert:** Ist ein Eintrag offline gemerkt, leert die App das Eingabefeld (To-do-Brett, Heute, Notizen, Schnelleingabe, Befehlspalette). Sonst tippt man ihn ein zweites Mal ab.
- **Offline-Notizen behalten ihre Uhrzeit:** Der Server übernimmt `zeit` aus der Schlange, wenn sie in den letzten 7 Tagen und nicht in der Zukunft liegt.
- **Fehlerseite statt weißer Seite:** Nach einem Deploy fehlen die alten, nachgeladenen Seiten-Dateien.
  - Bei `vite:preloadError` lädt die App einmal neu (Merker: 1 min, damit keine Schleife entsteht).
  - Hilft das nicht, zeigt `SeitenFehler` „Diese Seite ließ sich nicht laden“ mit dem Knopf „Neu laden“.
  - Beim Seitenwechsel wird der Fehler zurückgesetzt.
- **Telegram-Album mit „notiz:“:** Telegram schickt jedes Bild einzeln, und nur eines trägt die Bildunterschrift.
  - Die übrigen Bilder desselben Albums (`media_group_id`, innerhalb von 60 s) kommen in dieselbe Notiz, statt je einen Bürgermeister-Lauf zu starten.
  - Anhänge tragen die `message_id` im Namen, damit gleichnamige Dateien derselben Minute sich nicht überschreiben.
  - Einschränkung: Kommt ein Bild ohne Unterschrift *vor* dem mit Unterschrift an, gilt es als normale Nachricht. In der Praxis trägt das erste Bild die Unterschrift.
- **Kleinigkeiten:**
  - Zwei gleichzeitige Anlegen derselben Gewohnheit ergeben nur noch einen Eintrag, weil die Doppelt-Prüfung jetzt in der Schreib-Warteschlange läuft.
  - Fokus-Vollbild gibt beim Verlassen den Reitertitel zurück und zeigt, wenn das To-do nicht abgehakt werden konnte.
  - „Erste Schritte“ verschwindet nicht mehr ganz, wenn eine Abfrage scheitert. Nur der betroffene Schritt fällt weg.

## E119 – Teilschritte, „In Schritte zerlegen“, Notiz → To-do (Nacht 18./19.11.)

- **Teilschritte = Obsidian-Checkliste im To-do-Text:** Zeilen wie `- [ ] Gliederung` stehen in der Datei des To-dos. Es gibt kein neues Feld, deshalb sieht und bearbeitet Leif sie in Obsidian genauso.
  - In der App klappt **☑ 1/3** am To-do die Schritte auf: abhaken, ergänzen, entfernen.
  - Neue Schritte kommen direkt hinter den letzten vorhandenen; sonst Geschriebenes bleibt stehen.
  - Abhaken prüft den angezeigten Text gegen die Nummer. Passt er nicht mehr, kommt 409 statt eines falschen Häkchens (wie bei den Wochenziele, E111). Änderungen laufen nacheinander und mit `basisVersion`.
- **Höchstens 30 Schritte** je To-do.
- **Wiederkehrende To-dos:** Der Nachfolger beginnt mit wieder offenen Schritten.
- **Anzeige außerhalb des Bretts:**
  - „Heute“ zeigt „☑ 1/3 · *nächster Schritt*“, also die eine Sache, mit der man anfängt.
  - Telegram /todo zeigt dasselbe.
  - Agenten sehen „(1/3 Schritte)“ in `todo_liste` und können Schritte über die Notiz anlegen.
- **„✂️ Vorschlagen“:** Ein KI-Aufruf ohne Werkzeuge (`SystemAufrufe`, Stufe klein, verbucht im System-Chat „Marktplatz: Schritte“) schlägt 3–7 kleine Schritte vor.
  - **Geschrieben wird nichts:** Die App zeigt die Vorschläge zum Abwählen, erst „Übernehmen“ legt sie an.
  - Einträge aus Mails oder Moodle (`fremd`) gehen nur in der Fremdinhalt-Hülle an das Modell.
  - Ohne API-Schlüssel antwortet der Server mit 503 und einem Hinweis.
- **Notiz → To-do:** In Rathaus → Notizen hat jede Zeile den Knopf „→ To-do“. Der Titel ist der Text der Notiz, ohne Bild und ohne Quelle. Die Notiz des neuen To-dos verweist auf den Tag; Bilder werden mitgenommen. So bleibt das Erfassen schnell, und entschieden wird später.

## E120 – Zeitschätzung für To-dos (Nacht 18./19.11.)

- **Feld `dauer`:** Gemeint ist die geschätzte Dauer in Minuten (5–600) im Frontmatter des To-dos.
  - App: beim Bearbeiten (15 min bis 4 h).
  - Telegram: „/todo Referat üben 45 min“ oder „… 1,5 h“, auch zusammen mit „jeden Montag“.
  - Agenten: `todo_anlegen`/`todo_bearbeiten`.
  - Erkannt wird nur am Ende des Textes und nur mit Einheit (min/h/Std.). „Laufen 10 m“ oder „Kapitel 3“ bleiben Titel.
  - Bei Einkaufs-, Wunsch- und Corps-Liste wird keine Dauer erkannt.
- **„Heute“ prüft den Tag:** Es zeigt „⏱ Heute ≈ 2 h 15 min geschätzt · frei bis 22 Uhr ≈ 3 h 40 min“.
  - Gezählt werden überfällige und heute fällige To-dos.
  - Frei ist die Zeit bis 22 Uhr Ortszeit abzüglich der restlichen Termine von heute.
  - Reicht sie nicht, kommt der Hinweis „mehr, als in den Tag passt. Etwas auf morgen schieben?“. Die Knöpfe „→ morgen“ gibt es schon (E97).
  - Ohne eine einzige Schätzung erscheint die Zeile nicht, damit sie nicht stört.
- **Tag planen (E84)** nimmt die Schätzung als Blocklänge, sonst wie bisher 90 bzw. 45 min.
- **Morgenzeitung:** Unter „Heute“ steht „☑️ 3 To-dos dran (≈ 2 h geschätzt) · frei 8–22 Uhr ≈ 6 h“. Ist es zu viel, folgt der Hinweis zum Verschieben.
- **Wiederkehrende To-dos:** Der Nachfolger übernimmt die Schätzung.

## E121 – Wochenplan (Nacht 18./19.11.)

- Neuer Reiter **Marktplatz → Wochenplan** mit den Spalten Mo–So und links dem Eingang (ohne Datum sowie Überfälliges aus früheren Wochen). Mit ‹ › wechselt man die Woche.
- **Verschieben setzt nur `faellig`**, mit `basisVersion` und sofort angezeigt. Am PC zieht man die Karte, am Handy (und als Ausweichweg) wählt man den Tag in der Karte aus. „ohne Datum“ legt sie zurück in den Eingang.
- **Auslastung je Tag:** Die Leiste zeigt Termine (blau) und geschätzte To-dos (grün, rot wenn zu viel) gegen die Tageszeit 8–22 Uhr, dazu die Zahlen und Ganztägiges. Die Termine kommen aus derselben Kalenderquelle wie „Heute“, einschließlich ausgeblendeter Kalender. Das ist die Grundlage fürs Planen am Sonntag: Man sieht, welcher Tag schon voll ist.
- Oben stehen die Wochenziele dieser Woche, damit die Planung an ihnen ausgerichtet ist.
- **Bewusst ohne Uhrzeiten:** Zeitblöcke im Kalender macht weiterhin „Tag planen“ (E84) bzw. „Lernzeit einplanen“ (E79). Der Wochenplan verteilt nur auf Tage.

## E122 – Fokuszeit je To-do, Schätzung lernen (Nacht 18./19.11.)

- `GET /api/todos` liefert je To-do `fokusMin`, die Summe der Pomodoro-Minuten, die mit genau diesem To-do gestartet wurden (`fokus_sitzungen.todo`, gibt es seit E76). Die App zeigt „🍅 50 / ⏱ 90 min“. Ein wiederkehrendes To-do beginnt mit jedem Nachfolger bei 0, weil der Nachfolger einen neuen Pfad hat.
- **Wochenrückblick, Abschnitt „Schätzung“:** Verglichen werden die in der Woche erledigten To-dos, die eine Schätzung *und* mindestens 10 min Fokus haben, z. B. „Du hast im Schnitt 1,5× so lange gebraucht wie geschätzt – nächste Woche großzügiger planen.“ Dazu kommen bis zu 5 Beispiele. Wer seine Schätzungen sieht, plant realistischer. Ohne passende To-dos fehlt der Abschnitt.

## E123 – „Jetzt dran“ auf Heute (Nacht 18./19.11.)

- Unter „Als Nächstes“ schlägt „Heute“ **ein** To-do vor, das in die Lücke bis zum nächsten Termin passt, sonst bis 22 Uhr. Dazu kommt der nächste offene Teilschritt (E119). **„🍅 Los“** startet den Pomodoro für genau dieses To-do und öffnet das Fokus-Vollbild. Ziel: weniger Entscheiden, mehr Anfangen.
- **Reihenfolge:** überfällig → heute fällig → ⭐ ohne Datum → in 3 Tagen fällig, ⭐ jeweils zuerst.
- **Was „passt“:** Gerechnet wird mit der Restzeit, also Schätzung (E120, sonst 30 min) minus bisheriger Fokus (E122), mindestens 5 min. Passt keins ganz, reicht die Lücke aber für einen Pomodoro (≥ 25 min), wird das erste vorgeschlagen („für einen 🍅 reicht's“).
- **Kein Vorschlag:** während eines Termins, bei weniger als 10 min Lücke, nach 22 Uhr und während ein Pomodoro läuft.
- **Telegram /jetzt** liefert dasselbe mit dem signierten Knopf „🍅 Los“ (`jl:`). Termine kommen aus dem Google-Kalender, wenn er verbunden ist. Die Logik liegt in `packages/shared` und wird von App und Server gemeinsam genutzt.
- Rein im Code und nachvollziehbar, ohne KI. Getestet wird mit Server-Vitest (`test/tagesbudget.test.ts`), die Logik liegt in `packages/shared/src/tagesbudget.ts` und einem Browser-Test mit fester Uhrzeit.

## E124 – Drittes Review: Wochenplan, Offline, Teilschritte, Zeitrechnung (Nacht 18./19.11.)

- **Wochenplan:** Eine überfällige Karte, die man im Eingang wieder loslässt, verliert ihr Fälligkeitsdatum nicht mehr. Vorher ging ein PATCH mit `faellig: ''` raus.
- **Wochenplan, zweimal schnell verschieben:** Die neue Version aus der Antwort wird sofort übernommen. Vorher schickte das zweite Verschieben die alte Version mit und bekam 409.
- **Offline-Schlange idempotent:** Jede Anfrage, die offline gemerkt werden kann, trägt schon beim ersten Versuch eine Eintrags-ID (`x-dorf-id`).
  - Der Server merkt sich ID und Antwort 7 Tage lang (Tabelle `idempotenz`, Migration 22) und gibt bei Wiederholung dieselbe Antwort zurück.
  - So entsteht nichts doppelt, wenn die Anfrage ankam, die Antwort aber im Funkloch verloren ging.
  - Eine Notiz, die zweimal mit einem Schreibkonflikt scheitert, liefert jetzt 503 (vorher 409). Die Schlange behält sie also, statt sie zu verwerfen.
- **Teilschritte:**
  - Eingabefeld leeren und Vorschläge verwerfen nur bei Erfolg.
  - Ein abgelehntes Häkchen springt zurück.
  - KI-Vorschläge und „denkt …“ liegen im Query-Cache je To-do und überleben das Neuaufbauen der Zeile, wenn eine neue Version vom Server kommt.
- **Zeitrechnung:**
  - Überlappende Termine zählen einmal (`belegtMs` in `packages/shared`). Das gilt für Heute, die Morgenzeitung und den Wochenplan; vorher meldete etwa „Uni 13–18“ mit „Tutorium 14–16“ darin fälschlich „zu viel“.
  - Freie Zeit zählt erst ab 8 Uhr: Um 0:07 Uhr stand vorher „frei ≈ 21 h“.
  - Vor 6 Uhr schlägt „Jetzt dran“ nichts vor.
- **Tag planen:** Ein To-do mit großer Schätzung, das in keine Lücke passt, bekommt einen Teilblock in der größten Lücke (ab 30 min, „Teil von ⏱ 4 h“), statt still zu fehlen.
- **Fokus-Vollbild** stellt beim Verlassen den vorherigen Reitertitel wieder her, einschließlich Freigabe-Zähler.

## E125 – Filter im To-do-Brett (Nacht 18./19.11.)

- Ab 6 offenen Einträgen erscheint über der Liste eine Filterleiste. Sie hat eine Textsuche (Titel, Notiz, Gruppe, Gebäude) und Chips für „⭐“, „Heute & überfällig“, „Ohne Datum“ und je Gruppe bzw. Gebäude (z. B. „Uni“, ein Fach, ein Amt). Daneben steht „N von M“.
- Der Filter wirkt nur auf die Anzeige. Er wird nicht gespeichert und gilt für alle Listen (To-do, Einkauf, Wunsch, Corps).

## E126 – „Woche verteilen“ im Wochenplan (Nacht 18./19.11.)

- Der Knopf **„✨ Woche verteilen“** schlägt vor, die To-dos aus dem Eingang (ohne Datum, überfällig) auf die Tage ab heute zu legen, die noch Platz haben. Es braucht keine KI, und das Ergebnis ist nachvollziehbar (`wocheVerteilen` in `packages/shared`).
- **Platz je Tag:** 70 % der freien Zeit (8–22 Uhr minus Termine). Das ist bewusst Puffer, weil nie alles nach Plan läuft. Davon gehen die dort schon geplanten To-dos ab (Schätzung minus bisheriger Fokus, ohne Schätzung 30 min).
- **Reihenfolge:** ⭐ → überfällig (ältestes zuerst) → ohne Datum (ältestes zuerst). Jedes To-do kommt auf den frühesten Tag mit genug Platz. Was nicht mehr passt, wird genannt.
- **Leif entscheidet:** Er wählt einzelne Vorschläge ab, erst „Übernehmen“ setzt `faellig` (mit `basisVersion`, wie beim Ziehen).

## E127 – „… jeden Montag 30 min“ überall (Nacht 18./19.11.)

- Die Text-Erkennung für Wiederholung (E92) und Dauer (E120) liegt jetzt in `packages/shared/src/todotext.ts` (`todoAusText`). Telegram, das To-do-Brett, „Heute“, die Schnelleingabe des Programms und die Befehlspalette erkennen damit genau dasselbe.
- Beim Tippen zeigt die App unter dem Feld, was erkannt wurde, z. B. „→ „Wäsche“ · 🔁 wöchentlich ab Mo., 23.11. · ⏱ 30 min“. So gibt es keine Überraschung nach Enter.
- **Datum:** Ein im Feld gewähltes Datum gewinnt. Auf „Heute“ setzt „heute“ das Datum nur, wenn keine Wiederholung ein erstes Datum bestimmt.
- Einkaufs-, Wunsch- und Corps-Liste nehmen den Text weiterhin wörtlich. Dort wäre „Milch 2 h“ keine Dauer.

## E128 – /verteilen in Telegram (Nacht 18./19.11.)

- `/verteilen` macht dasselbe wie „✨ Woche verteilen“ (E126), aber am Handy. **Sonntags** plant es die nächste Woche (Mo–So), sonst den Rest dieser Woche ab heute.
- Die freie Zeit je Tag kommt aus dem Google-Kalender, wenn er verbunden ist; überlappende Termine zählen einmal. Ohne Kalender gilt der ganze Tag 8–22 Uhr, mit 70 % Puffer.
- Jeder Vorschlag ist ein Knopf, dazu kommt „🗓️ Alle übernehmen“. Die Knöpfe sind signiert (`vt:`), werden vor dem Schreiben vermerkt (ein Doppelklick ändert nichts doppelt) und laufen nach 2 Tagen ab. Es wird nur `faellig` gesetzt.

## E129 – Wochenplanung als Ritual (/planen) (Nacht 18./19.11.)

- Die neue Seite **„🗓️ Woche planen“** (`/planen`) führt in vier Schritten durch die Wochenplanung, ungefähr 10 Minuten:
  1. Wochenrückblick lesen
  2. Drei Wochenziele setzen (sonntags für die kommende Woche)
  3. Woche verteilen (Wochenplan, sonntags für die nächste Woche, mit „✨ Woche verteilen“)
  4. Gewohnheiten prüfen
- Alle vier Schritte nutzen vorhandene Bausteine; es gibt kein neues Datenmodell. Die abgehakten Schritte merkt sich das Gerät je Woche (`localStorage`). Ein Sonntag zählt dabei schon zur kommenden Woche.
- **Wo man darauf stößt:**
  - „Heute“ zeigt sonntags ab 12 Uhr und montags bis 12 Uhr den Hinweis „Zeit für die Wochenplanung“, bis alle vier Schritte erledigt sind.
  - Der Wochenrückblick in Telegram verlinkt die Seite.
  - Sie steht in der Befehlspalette und in der Anleitung.
- **Warum:** Die Bausteine gab es schon, aber verteilt auf Rathaus, Heute und Marktplatz. Ein fester, kurzer Ablauf macht aus Funktionen eine Gewohnheit.

## E130 – Abgaben und Prüfungen kommen mit Teilschritten (Nacht 18./19.11.)

- Neue Uni-To-dos (E71) bekommen Teilschritte (E119) als Checkliste in der Notiz. „Jetzt dran“, „Heute“ und Telegram zeigen damit sofort den nächsten Schritt.
  - **Abgabe:** Angabe lesen, Fragen notieren → Aufgaben lösen → Lösung sauber aufschreiben → in Moodle hochladen und prüfen.
  - **Prüfung:** Stoff und Altklausuren sammeln → Lernplan anlegen → Karteikarten → Probeklausur unter Zeitdruck → am Vortag Ort, Zeit, Ausweis, Hilfsmittel.
- **Eigene Vorlage:** `Uni/vorlagen/schritte-abgabe.md` bzw. `schritte-pruefung.md` mit Zeilen „- [ ] Schritt“. Übernommen wird nur der Text, nicht das Häkchen. Eine Datei ohne solche Zeilen schaltet die Schritte ab.
- Das gilt nur für **neu** angelegte Uni-To-dos; bestehende bleiben, wie sie sind.

## E132 – Feinschliff nach Screenshot-Durchsicht (Nacht 18./19.11.)

- **„Jetzt dran“:** Der Name `heute-jetzt` war schon für das „jetzt“-Abzeichen laufender Termine vergeben. Die Box erbte dadurch weiße Großbuchstaben auf hellem Grund und war unlesbar. Sie heißt jetzt `heute-jetztdran`.
- **Nichts doppelt:** Steht kein Termin an, zeigt „Heute“ das To-do nicht zusätzlich unter „Als Nächstes“; „Jetzt dran“ sagt dasselbe und mehr.
- **Wochenplanung:** Plant man sonntags die nächste Woche, liegt Überfälliges auch dann im Eingang. Die Häkchen „erledigt“ stehen in einer Zeile.

## E131 – Das Dorf spiegelt den Tag

- **Sinn:** Die Blüte (E112) zeigt die Woche; jetzt zeigt das Dorf auch den heutigen Tag – zwei kleine Dinge, an denen man im Vorbeischauen sieht, wo man steht.
- **Tafel am Marktplatz:** Kreidetafel auf zwei Pfosten vorn am Platz, beidseitig beschrieben: „Heute ☑ 2/5“ = 2 von 5 erledigt (alles erledigt: grüne Kreide; nichts dran: „Heute frei“). Text als CanvasTexture, neu gezeichnet nur, wenn sich die Zahlen ändern.
- **Fokus am Kirchturm:** Solange ein Pomodoro in der Arbeitsphase läuft, schimmern die vier Zifferblätter warm, und über der Tür hängt eine kleine leuchtende Tomaten-Laterne. Ruhiges Dauerlicht, nichts blinkt; nachts etwas kräftiger. Angehalten, in Pausen und ohne Pomodoro aus. Kein Ton.
- **Daten:** Der Dorfstatus bekommt `tag: { dran, erledigt }` (offene To-dos mit Fälligkeit ≤ heute; heute Erledigtes – Kalendertag in Wien über `zeit.ts`) und `fokus` (Pomodoro `arbeit` + `laeuft`, unabhängig von „Nicht stören“). `Dorfplan` bekommt dafür `todos` und `kirchturm`; `status()` bleibt synchron (mit `fokus`), `statusMitTag()` liest zusätzlich die To-dos – die Route `/api/dorf/status` nutzt es (eine Zeile in `app.ts`). Ein Fehler beim Lesen der To-dos verhindert den Status nie. Keine Migration, kein neues Live-Ereignis.
- **Live:** Die Dorf-Ansicht lädt den Status bei `kirchturm.geaendert`, `todos.geaendert` (To-do-Liste) und Änderungen unter `Marktplatz/todos/` (Obsidian) neu.
- **Leistung:** Gestell und Laternenhalter je Material ein Mesh (Bausatz), nichts wird pro Bild erzeugt; beide Teile hängen am Gebäudemodell und werden mit ihm entsorgt.
- **Vorschau/Tests:** `?tafel=2/5` (erledigt/insgesamt) und `?fokus=1` (auch `=0`) übersteuern nur die Darstellung; Tests lesen `window.__dorf.tagStand()`.

## E133 – Telegram: „Was zuerst?“ am Morgen, „Woche verteilen“ im Rückblick (Nacht 18./19.11.)

- **Morgenzeitung:** Der erste Schnellknopf ist **„👉 Was zuerst?“** (wie `/jetzt`, E123). Er erscheint nur, wenn etwas dran ist (⭐ oder fällig bis heute). Die Knöpfe stehen jetzt höchstens zu zweit in einer Zeile, damit am Handy nichts abgeschnitten wird.
- **Wochenrückblick (sonntags):** Unter den 🎯-Vorschlägen steht **„🗓️ Woche verteilen“** (wie `/verteilen`, E128). Daneben verlinkt die Nachricht „🗓️ Woche planen“ (E129). So führt der Rückblick direkt in die Planung.
- Beide Knöpfe sind signierte Schnellknöpfe (`sb:`) wie die bisherigen, ohne neue Rechte.

## E134 – Fokus-Ziel pro Tag (Nacht 18./19.11.)

- In den Pomodoro-Einstellungen (Kirchturm) gibt es **„Fokus-Ziel pro Tag (min)“**. 0 bedeutet kein Ziel, das ist auch der Standard.
- **Heute:** Die Fokus-Karte zeigt einen Balken „50 min von 2 h Fokus heute“. Er wird grün mit „🎯 Ziel erreicht“, sobald das Ziel geschafft ist.
- **Tagesabschluss (Telegram):** „🍅 65 min Fokus – 🎯 Ziel (60 min) erreicht“ bzw. „… von 60 min Ziel“.
- **Wochenrückblick:** „🎯 Fokus-Ziel (2 h) an 4 von 7 Tagen erreicht“.
- Die Voreinstellungen „Klassisch/Lang“ behalten jetzt Ziel, Nicht-stören und Thema. Vorher setzten sie diese still zurück.

## E135 – Viertes Review: Woche verteilen, Filter (Nacht 18./19.11.)

- **/verteilen, alter Vorschlag:** Ein Knopf von gestern setzt kein Datum mehr in die Vergangenheit und überschreibt kein Datum, das Leif inzwischen in der App geändert hat (`basisVersion` je Vorschlag). Die Antwort sagt dann ehrlich „1 von 2 eingeplant – der Rest wurde inzwischen geändert oder der Tag ist vorbei“.
- **Heute zählt nur ab jetzt:** In App und Telegram rechnet „Woche verteilen“ für heute die freie Zeit ab jetzt (frühestens 8 Uhr) bis 22 Uhr, abzüglich der Termine ab jetzt. Um 22:30 landet nichts mehr auf heute.
- **Wiederkehrende To-dos werden nicht verteilt:** Die Serie rechnet vom Fälligkeitsdatum weiter, ein Verschieben würde sie dauerhaft auf einen anderen Wochentag legen.
- **/verteilen** zeigt und übernimmt höchstens 12 Vorschläge. Der Rest zählt zu „passen nicht mehr hinein“, nichts fällt still weg.
- **Wochenplan:** „✨ Woche verteilen“ ist gesperrt, bis der Kalender geladen ist. Sonst sähen alle Tage frei aus.
- **To-do-Brett-Filter:** Der Filter wirkt nur, solange die Leiste sichtbar ist (ab 6 offenen). Ist der gewählte Chip verschwunden (z. B. das letzte ⭐ erledigt), gilt „Alle“. Vorher blieb die Liste ohne Weg zurück gefiltert.

## E136 – Teilschritte im Fokus-Vollbild (Nacht 18./19.11.)

- Läuft ein Pomodoro für ein To-do, zeigt das Fokus-Vollbild (`/fokus`) dessen Teilschritte. Man kann sie dort abhaken und mit Enter ergänzen, ohne den Fokus zu verlassen. Hat das To-do noch keine Schritte, fragt ein Feld: „Was ist der nächste Schritt?“
- Dahinter stecken dieselben Wege wie im To-do-Brett (E119): Text-Prüfung gegen die Nummer, `basisVersion`, ein abgelehntes Häkchen springt zurück.

## E137 – Lernziel je Fach pro Woche (Nacht 18./19.11.)

- **Wo:** In der Uni unter „Studium“ hat jede Fach-Karte einen Knopf **🎯**: „Stunden Fokus pro Woche“, 0 bedeutet kein Ziel. Gespeichert wird in `Uni/lernziele.md` (Frontmatter `ziele: { "Mathe III": 6 }`). Die Datei lässt sich in Obsidian ändern; eigener Text bleibt. Geschrieben wird nacheinander mit `basisVersion`.
- **Gemessen** wird die Fokuszeit (Pomodoro mit Fach als Gruppe, z. B. über „🍅 Fokus“ auf der Fach-Karte) **dieser Woche ab Montag 0:00 Wien**. Die Karte zeigt einen Balken „2 h 30 min von 6 h diese Woche“, grün sobald erreicht.
- **Wochenrückblick:** Abschnitt „Lernziele“ mit „✓ Mathe III: 6 h 10 min von 6 h“ bzw. „✗ …“ über die letzten 7 Tage.
- **Warum:** Fristen allein sagen nicht, ob man genug lernt. Ein Wochenziel je Fach macht Lernen planbar, auch wenn gerade keine Abgabe drückt.

## E138 – Tastenkürzel am PC (Nacht 18./19.11.)

- `n` neues To-do: Es nimmt das sichtbare Feld der Seite, sonst springt es nach „Heute“. Weitere Kürzel:
  - `f` Fokus-Vollbild
  - `g` + Buchstabe springt: `h` Heute, `d` Dorf, `t` To-dos, `w` Wochenplan, `k` Kalender, `p` Woche planen, `u` Uni, `r` Rathaus, `b` Bibliothek
  - `?` zeigt die Übersicht
- Die Kürzel wirken nur, wenn nicht gerade in ein Feld getippt wird und ohne Strg/Alt/⌘; Strg/⌘+K bleibt die Befehlspalette. Am Handy (ohne Hover) wird die Übersicht nicht gezeigt.

## E139 – Lernziele in Morgenzeitung und Telegram (/lernen) (Nacht 18./19.11.)

- **Morgenzeitung:** Der Abschnitt „Lernen diese Woche“ zeigt je Lernziel (E137) „Mathe III: 2 h von 6 h“, erreichte Ziele mit ✓. Gezählt wird ab Montag 0:00 Wien.
- **`/lernen`:** zeigt je Fach einen Balken und „30 min von 2 h“. Dazu gibt es je Fach einen Knopf **„🍅 Mathe III“**, der einen Pomodoro mit dem Fach als Gruppe startet. Diese Zeit zählt fürs Lernziel.
- Die Knöpfe sind signiert über den Fachnamen. Ändern sich die Ziele inzwischen, passt der alte Knopf nicht mehr und wird abgelehnt, statt ein falsches Fach zu starten.
- Stand je Fach (`lernStand` in `dorf.ts`) ist eine Rechnung für Morgenzeitung, Telegram und Wochenrückblick (dort über 7 Tage).

## E140 – Prüfungs-Cockpit (Nacht 18./19.11.)

- Der neue Reiter **Uni → Prüfungen** zeigt je anstehende Prüfung (aus den Uni-Fristen, Art „test“, höchstens 8):
  - die Tage bis zur Prüfung (ab 3 Tagen rot), Fach und Uhrzeit
  - die Teilschritte des Uni-To-dos (E130) mit dem nächsten Schritt
  - die Fokuszeit der letzten 14 Tage aufs Fach, gegen das Lernziel (E137 × 2 Wochen)
  - den Stand der Karteikarten (sitzen / heute dran)
- Knöpfe: **„🍅 Lernen“** startet den Pomodoro fürs Fach und öffnet das Fokus-Vollbild. **„📅 Lernplan“** öffnet den Lernzeit-Planer bis zur Prüfung (E79/E96).
- Der Prüfungs-Countdown auf „Heute“ führt dorthin.
- Es gibt keine neuen Daten, nur eine Sicht auf vorhandene (`GET /api/uni/pruefungen`). Der Fach-Abgleich ist derselbe ungefähre Namensvergleich wie bei den Fach-Karten.

## E141 – Morgen im Blick (Nacht 18./19.11.)

- **Tagesabschluss (Telegram, 21 Uhr):** „🌅 Morgen: 3 To-dos (≈ 2 h 30 min) · 2 Termine · frei ≈ 9 h“. Wird es eng (mehr als 70 % der freien Zeit verplant), steht dahinter „eng, vielleicht etwas verschieben“. Mitgezählt wird auch Überfälliges, weil es morgen sonst einfach mitwandert.
- **„Heute“ ab 18 Uhr:** Die Karte „🌅 Morgen“ zeigt dasselbe, dazu die ersten 5 To-dos und einen Link zum Wochenplan.
- **Warum:** Ein kurzer Blick auf morgen ist der beste Feierabend-Abschluss. Man legt den Tag gedanklich ab und startet morgens ohne Überraschung.

## E143 – Anstoß nach Terminen (Nacht 18./19.11.)

- Ist gerade ein Termin zu Ende gegangen (vor höchstens 12 min) und danach Zeit frei, schickt Telegram einmal: „✅ **Vorlesung** ist vorbei. 👉 Jetzt dran: Blatt 4 – passt in die 2 h bis Tutorium“, mit **„🍅 Los“**. Das ist derselbe Vorschlag wie `/jetzt` (E123).
- **Grenzen:**
  - je Termin einmal und höchstens 3× am Tag
  - nicht während eines Pomodoros und nicht in der Nachtruhe; dann verfällt der Anstoß, er ist nur im Moment nützlich
  - nur mit verbundenem Google-Kalender
- **Schalter** „luecken“ in `00_Stadtordnung/telegram.md` bzw. unter Agenten-Einstellungen → Telegram, standardmäßig an. Geprüft wird alle 5 Minuten.
- **Warum:** Der schwierigste Moment ist der Übergang. Nach der Vorlesung bleibt man leicht hängen; ein konkreter nächster Schritt im richtigen Moment hilft beim Weitermachen.

## E142 – Heute neu geordnet (19.11.)

- **Nur Anordnung und Optik**, keine neue Logik, keine neuen Daten. Die Seite war über die Nacht gewachsen; jetzt liest sich der Tag wieder von oben nach unten.
- **Kopf:** „👉 Jetzt dran“ und „Als Nächstes“ stehen in einer Zeile (am Handy untereinander, Jetzt dran zuerst). Der Schalter „Beim Öffnen zuerst ‚Heute‘ zeigen“ ist ans Seitenende gewandert – man stellt ihn einmal ein.
- **PC (zwei Spalten):** links (etwas breiter) To-dos, darunter Wochenziele und Erste Schritte; rechts Termine, Fokus, Gewohnheiten. Der Hinweis auf die Wochenplanung (So/Mo) liegt als Band über beiden Spalten.
- **Handy (eine Spalte):** Termine (kurz), To-dos, Fokus, Gewohnheiten, Wochenziele, Erste Schritte.
- **Abends (ab 18 Uhr, Klasse `abend`):** Stimmung und „🌅 Morgen“ rücken direkt unter die Termine (am Handy noch vor die To-dos), der Fokus ans Ende. Ein laufender Fokus steht dagegen immer ganz oben in seiner Spalte.
- **Ruhiger:** „In den nächsten 7 Tagen“ und „Ohne Datum“ sind schlichte Zeilen ohne Kästchen-Rahmen, damit Wichtig/Überfällig/Heute hervortreten. „Erste Schritte“ ist gestrichelt und ohne Schatten. Die Stimmungs-Knöpfe füllen am Handy eine Zeile.
- **Technik:** Die Reihenfolge im DOM ist die des PCs; Handy und Abend ordnen per CSS `order` um (`.heute-spalte` ist am Handy `display: contents`). Abstände kommen einheitlich aus `gap` auf `.heute`; leere Bänder verschwinden über `:empty`. Neue Klassen: `heute-jetzt-zeile`, `heute-band`, `heute-fuss`, `heute-todos-karte`, `heute-termine-karte`, `heute-gewohnheiten`, `heute-wochenziele`, Gruppe `spaeter`. Bestehende Klassen, Rollen, Texte und testids sind unverändert.

## E144 – Wann bin ich am konzentriertesten? (Nacht 18./19.11.)

- **Statistik (Rathaus):** Ein neues Diagramm „🕘 Fokus nach Tageszeit“ zeigt 24 Balken mit den Fokusminuten je Stunde (Wien) im gewählten Zeitraum. Die beste zusammenhängende 2-Stunden-Spanne ist hervorgehoben, darüber steht „am konzentriertesten: 9–11 Uhr“.
- **Wochenrückblick, Abschnitt Fokus:** „Am konzentriertesten (4 Wochen): 9–11 Uhr – leg Wichtiges in diese Zeit“.
- **Rechnung:** Eine Sitzung über eine Stundengrenze wird anteilig aufgeteilt (5-Minuten-Schritte). Eine Aussage gibt es erst ab 2 h Fokus insgesamt, darunter wäre es Zufall.
- **Warum:** Wer seine beste Zeit kennt, plant das Schwere dorthin. Die Daten (Pomodoro-Sitzungen) gab es schon.

## E145 – Review 5: Fristen sind keine Termine, Fächer passen nur mit ganzen Wörtern (19.11.)

- **Fristen-Blöcke:** Einträge „⏰ … ist fällig“ aus dem Kalender „Moodle-Fristen (automatisch)“ zählen nicht mehr als belegte Zeit (`istFristBlock` in packages/shared). Das gilt für Heute (Budget, Jetzt dran), „Morgen im Blick“, Wochenplan, Tag planen/`freiAmTag`, /verteilen und den Tagesabschluss. Sie lösen auch keinen Anstoß „… ist vorbei“ mehr aus. Prüfungen (📝) bleiben belegte Zeit.
- **Anstöße nach Terminen:** Die Grenze von drei pro Tag zählt nur, was wirklich verschickt wurde (`gesendet`). Jeder Termin wird trotzdem nur einmal geprüft.
- **Fächer vergleichen (`fachPasst`/`fachZuordnen`):**
  - Gleich sind Namen mit gleichen Wörtern, oder wenn die Wörter des kürzeren Namens zusammenhängend im längeren vorkommen (mind. 4 Buchstaben).
  - Ein einzelnes Wort passt nur als erstes Wort nach Kürzeln wie „VL“.
  - Ein exakter Name hat Vorrang. Jede Frist, Fokus-Gruppe und Lernziel-Zeile gehört zu genau einem Fach.
  - Bisher gab „Mathe I“ ⊂ „Mathe II“ einem Fach die Zeit eines anderen.
  - Gilt für Uni → Studium, Prüfungs-Cockpit und Lernstand (Morgenzeitung, /lernen, Rückblick).
- **Prüfungs-Cockpit:**
  - Ohne Kursnamen wird das Fach über den Titel gesucht. Ohne Fach gibt es keinen „🍅 Lernen“-Knopf.
  - „Karten üben“ nutzt den Ordnernamen der Karten.
  - Der Fristtag für den Lernplan ist der Wiener Tag.
- **Lernziel:** Wird ein Ziel unter dem Moodle-Titel gesetzt, ersetzt es ein Ziel unter dem Ordnernamen desselben Fachs (und umgekehrt), statt es zu verdoppeln.
- **Tastenkürzel:**
  - Sie ruhen, solange ein Fenster oder Dialog offen ist oder der Fokus in einem Formular steht.
  - „n“ springt nur ins To-do-Feld (`data-todo-neu`), nicht in Einkauf, Wunschliste oder Ämter.
- **Bewusst gelassen:** Der Wochenrückblick zählt Lernziele über die letzten 7 Tage. Er läuft sonntags abends, da ist das fast dieselbe Woche, und von Hand am Montag erzeugt bleibt er so aussagekräftig.

## E146 – Tag abschließen: das Abend-Ritual in der App (19.11.)

- **Seite /abschluss** („🌙 Tag abschließen“), das Gegenstück zu /planen. Vier Schritte, ca. 5 Minuten:
  1. **Geschafft:** Was heute erledigt wurde, Fokuszeit, Serie und Stimmung.
  2. **Offenes verteilen:** Alles, was heute oder früher fällig war: ✓ erledigt, → morgen, → Montag, ↩ Eingang (ohne Datum; nicht bei wiederkehrenden). Dazu der Knopf „Alle auf morgen“.
  3. **Die drei für morgen:** To-dos bis morgen und ⭐ ohne Datum, mit Stern-Knopf. Bei mehr als drei ⭐ gibt es einen Hinweis.
  4. **Kopf leeren:** Ein Gedanke geht in die Tagesnotiz (Rathaus/notizen/). Danach ist der Schritt abgehakt.
- **Abgehakte Schritte** merkt sich das Gerät je Tag (`dorf-abschluss-JJJJ-MM-TT`), wie bei /planen.
- **Erreichbar über:**
  - Heute ab 19 Uhr (Hinweiskarte, bis alle Schritte erledigt sind)
  - Befehlspalette
  - Link im Telegram-Tagesabschluss (21 Uhr)
- **Warum:** Morgens helfen Morgenzeitung und „Jetzt dran“, sonntags /planen. Am Abend fehlte ein bewusster Schluss. Wer Offenes aktiv neu einplant, statt es überfällig liegen zu lassen, startet morgens ohne roten Berg. Wer die drei Wichtigsten am Vorabend wählt, verliert morgens keine Zeit mit Entscheiden. Alles bleibt Leifs Klick, die App schlägt nichts automatisch vor.

## E147 – Wartet auf … (19.11.)

- **Neues Feld `wartet`** am To-do (Frontmatter, max. 80 Zeichen): auf wen oder was Leif wartet (Prof., Sekretariat, Corps, Lieferung). `faellig` ist dann der **Nachfass-Tag**.
- **Ruhen (`ruht` in packages/shared):** Bis zum Nachfass-Tag, oder ohne Datum dauerhaft, zählt das To-do nicht als „dran“:
  - nicht in „Jetzt dran“
  - nicht in „Woche verteilen“ und /verteilen
  - nicht in „Tag planen“
  - nicht im Tagesbudget
  
  Auf „Heute“ steht es unten unter **„⏳ Wartet auf“**. Ab dem Nachfass-Tag ist es ein normales To-do mit dem Hinweis „⏳ nachfassen: …“. Dort zählt es auch als überfällig, wenn es liegen bleibt.
- **Eingabe:**
  - Im To-do-Brett gibt es beim Bearbeiten das Feld „⏳ Wartet auf …“.
  - Im Text überall: „Note Mathe wartet auf Prof. Müller“ oder „… (wartet auf Sekretariat)“, nur am Ende und mit Titel davor. Die Vorschau zeigt es vor dem Enter.
  - Agenten haben `wartet` in `todo_anlegen`/`todo_bearbeiten`.
- **Warum:** Viele Uni- und Corps-Dinge hängen an anderen. Als normales To-do verstopfen sie „Jetzt dran“ und machen den Tag rot, obwohl Leif nichts tun kann. Ganz weglassen geht auch nicht: Dann vergisst man das Nachfassen. Ein eigener Status mit Nachfass-Tag löst beides, ohne neue Liste und ohne neue Datei.

## E148 – Gedanken parken im Fokus (19.11.)

- **Fokus-Vollbild (/fokus):** Das Feld „💭 Gedanke parken“ nimmt einen Gedanken mit Enter auf und schreibt ihn als „💭 …“ in die Tagesnotiz (Rathaus/notizen/). Der Fokus läuft weiter.
- **Geparkte Gedanken** der Sitzung stehen darunter. In der Pause oder nach dem Fokus lässt sich jeder mit „→ To-do“ als Aufgabe anlegen; die Texterkennung gilt wie überall, also auch „… 15 min“ oder „wartet auf …“. Während der Arbeitsphase gibt es bewusst keinen Knopf, damit nicht doch umsortiert wird.
- **Speicher:** Die Liste liegt nur im sessionStorage des Geräts. Die Notiz im Vault bleibt die Quelle.
- **Warum:** Der häufigste Fokus-Killer ist der Gedanke „ich muss noch …“. Wer ihn sicher ablegen kann, muss ihn nicht sofort erledigen und nicht im Kopf behalten.

## E149 – Review 6 (19.11.)

- **Fach-Zuordnung:** Ohne exakten Treffer gewinnt der längste passende Name, nicht der erste in der Liste. „VL Mathe III UE“ gehört also zu „Mathe III UE“, auch wenn „Mathe III“ alphabetisch davor steht.
- **Prüfung ohne Kursnamen:** Das Fach wird über den Titel gefunden, ohne „Klausur/Prüfung/Test/VO/VL …“ am Anfang.
- **„wartet auf“** wird nur noch als eigenes Wort erkannt („Zahlung erwartet auf Konto“ bleibt ein Titel).
- **Erledigte Fristen-Blöcke** mit ✔/☑/„erledigt“ vor dem ⏰ zählen ebenfalls nicht als Termin.
- **Tag abschließen:**
  - „↩ Eingang“ ist bei wartenden To-dos gesperrt, sonst würde das Nachfassen verloren gehen.
  - „→ Mo“ ist bei wiederkehrenden gesperrt.
  - „Alle auf morgen“ lässt wiederkehrende aus, damit die Serie nicht auf einen anderen Wochentag wandert.
- **Tastenkürzel:** Sie ruhen nur bei echten Fenstern (`dialog[open]`, `aria-modal`, `.fenster-hintergrund`), nicht bei der eigenen Hilfe, nicht bei den kleinen Karten im Dorf und nicht nach einem Klick auf einen Knopf in einem Formular. Die Felder für Einkauf, Wunschliste und Ämter heißen wieder „Neues To-do“ (Browser-Tests); „n“ unterscheidet über `data-todo-neu`.
- **Leine:** Setzt ein Fremdinhalt-Lauf `wartet`, wird das To-do „fremd“ (wie bei Titel/Notiz).
- **/verteilen** zählt ruhende To-dos nicht als Eingang.

## E150 – Wartet auf … rundum (19.11.)

- **Morgenzeitung:** Unter „Heute“ steht die Zeile „⏳ Heute nachfassen: Titel (bei Person)“ für Wartendes, dessen Nachfass-Tag da ist. Fristen-Blöcke zählen auch hier nicht als belegte Zeit.
- **Wochenrückblick:** Unter „Erledigt und offen“ steht „⏳ N wartend“, mit „seit N Tagen“ ab einer Woche und „ohne Nachfass-Tag“ als Hinweis, einen zu setzen.
- **Telegram /wartet:** Zeigt alles Wartende mit Nachfass-Tag. Je Eintrag gibt es drei signierte Knöpfe (`wa:`):
  - 📨 +3 T: nachgefasst, in 3 Tagen wieder
  - ✅ Erledigt
  - ▶️ Selbst: wartet nicht mehr, heute dran
- **Bürgermeister:** Kennt /abschluss und das Feld `wartet` (Systemkontext).

## E151 – Energie je To-do (19.11.)

- **Feld `energie`:** `hoch` (🧠 braucht Konzentration) oder `niedrig` (🪶 geht nebenbei). Gesetzt wird es im To-do-Brett beim Bearbeiten oder von Agenten über `todo_anlegen`/`todo_bearbeiten`. Wiederkehrende geben es an den Nachfolger weiter.
- **„Jetzt dran“** (Heute, /jetzt, Anstoß nach Terminen):
  - In Leifs bester Tageszeit (E144, 4 Wochen) kommt 🧠 zuerst.
  - Ab 19 Uhr oder in Lücken unter 30 min kommt 🪶 zuerst.
  - Das gilt nur innerhalb derselben Dringlichkeit, Überfälliges und ⭐ bleiben vorn.
  - Der Grund steht dabei: „🧠 deine beste Zeit“ bzw. „🪶 etwas Leichtes“.
- **Warum:** Nicht jede Stunde ist gleich viel wert. Wer das Schwere in seine konzentrierteste Zeit legt und das Leichte in die Randzeiten, schafft mehr mit weniger Kraft. Die Daten (beste Zeit) gab es schon, jetzt werden sie genutzt.

## E153 – Aufschiebe-Zähler (19.11.)

- **`verschoben`** (Frontmatter, vom Code gepflegt) zählt, wie oft ein **fälliges oder überfälliges** To-do auf später gelegt wurde: auf einen späteren Tag oder ohne Datum. Das gilt von überall (App, Wochenplan, /aufraeumen, Abschluss, Agenten). Nicht gezählt werden Vorausplanen (noch nicht fällig), nach vorn Holen und Erledigen. Nachfolger wiederkehrender To-dos beginnen bei 0.
- **Anzeige ab 3×:**
  - Heute: rotes „↻ 3×“; „Jetzt dran“ ohne Schritte rät „fang mit 10 Minuten an oder zerleg es“.
  - Tag abschließen
  - /aufraeumen: „zerlegen oder löschen ist auch eine Entscheidung“
  - Wochenrückblick: „↻ Oft verschoben: … – zerlegen, delegieren oder streichen?“
- **Warum:** Was immer wieder geschoben wird, ist fast nie Faulheit, sondern zu groß, zu unklar oder eigentlich unwichtig. Der Zähler macht das sichtbar, und die Lösung (Teilschritte, E119) gibt es schon.

## E154 – Nachbereiten nach der Vorlesung (19.11.)

- **Anstoß nach Terminen (E143):** Passt der Titel des gerade beendeten Termins zu einem Uni-Fach (`fachZuordnen`, z. B. „VL Statistisches Lernen“), kommt der Knopf **„📝 Nachbereiten (15 min)“** dazu. Der Anstoß kommt dann auch, wenn gerade kein To-do in die Lücke passt.
- **Ein Tipp** legt „Nachbereiten: <Termin>“ an: heute fällig, 15 min, Gruppe = Fach (Fokuszeit zählt fürs Lernziel), Gebäude Uni. Das geschieht genau einmal je Termin; die Zuordnung liegt im Tagesstand `telegram_luecken.nach` (max. 10, nur heute). Signierter Knopf `nb:`.
- **Warum:** Wiederholen kurz nach der Vorlesung ist der billigste Lernschritt überhaupt (Vergessenskurve). Gesendet wird es nur, wenn Leif die Anstöße eingeschaltet hat, wie bei allen Anstößen nach Terminen höchstens 3 am Tag.

## E155 – Rauschen im Fokus (19.11.)

- **Fokus-Vollbild:** „🔊 Rauschen“ mit braunem (tief, wie Regen) oder rosa Rauschen (heller) und einem Lautstärke-Regler. Der Ton wird im Browser über Web Audio erzeugt, ohne Datei und ohne Netz. Er startet nur auf Klick und endet beim Verlassen der Seite. Art und Lautstärke merkt sich das Gerät.
- **Kein Klingeln:** Das ist kein Signal, sondern Hintergrund; Glocke und Wecker bleiben Sache des Kirchturms.

## E156 – Telegram /morgen (19.11.)

- **/morgen** zeigt den nächsten Tag auf einen Blick:
  - Ganztägiges, Termine (ohne Fristen-Blöcke) und Fristen (Abgaben/Prüfungen, Wiener Tag)
  - die dran-To-dos bis morgen (⭐ zuerst; ruhendes Wartendes nicht, Nachfassen schon) mit Schätzung
  - freie Zeit 8–22 Uhr mit „eng“-Hinweis
  - darunter die bekannten ⭐-Knöpfe aus dem Tagesabschluss (`st:`)
- **Warum:** Der Tagesabschluss kommt um 21 Uhr. Wer früher Schluss macht oder abends noch etwas einschiebt, will den Morgen jederzeit sehen können.
- **Bürgermeister:** Er kennt den Aufschiebe-Zähler und bietet Zerlegen an.

## E158 – Filter „⏳ Wartet“ und „↻ Oft verschoben“ im To-do-Brett (19.11.)

- Zwei neue Filter-Chips (nur, wenn es passende To-dos gibt): alles Wartende bzw. alles, was mindestens dreimal verschoben wurde. Damit lässt sich die Liste gezielt durchgehen, z. B. beim Wochenrückblick.

## E159 – Gewohnheiten im Tagesabschluss (19.11.)

- Unter /abschluss → „1 · Geschafft“ steht die Gewohnheiten-Karte von Heute: abends abhaken, was erledigt ist, damit die Serie nicht reißt. Wie im Telegram-Tagesabschluss, nur in der App.

## E157 – Tagesleiste auf Heute (19.11.)

- **Was:** In der Karte „📅 Termine“ auf /heute steht über der Liste eine schmale Leiste für heute 8–22 Uhr (Wiener Zeit): Termine mit Uhrzeit als Blöcke in ihrer Kalenderfarbe, freie Lücken ab 30 min gestrichelt (Tooltip „frei 14:00–15:30“), eine rote Jetzt-Linie, Vergangenes abgedunkelt, Stundenmarken alle 2 h.
- **Warum:** Die Liste zeigt, *was* ansteht, aber nicht, *wo Platz ist*. Die Leiste macht die freien Fenster auf einen Blick sichtbar – ohne Rechnen und ohne den Kalender zu öffnen.
- **Regeln wie überall:** Fristen-Blöcke („⏰ … ist fällig“) und Ganztägiges sind keine Termine; frei = 14 h minus belegte Zeit (`belegtMs`, Überlappungen zählen einmal). Die Zahl gilt für den ganzen Tag, nicht ab jetzt – „frei bis 22 Uhr“ ab jetzt steht schon im Tagesbudget.
- **Nur Anzeige:** `role="img"` mit Text („Tagesleiste: 3 Termine, frei ≈ 10 h“); bedient wird weiter über die Liste darunter. Ohne Termine ist die Leiste ganz frei; ohne verbundenen Kalender gibt es sie nicht.
- **Eigene Komponente** `TagesLeiste.tsx`, in `Heute.tsx` nur eine Zeile – bestehende Texte und aria-labels bleiben unverändert.

## E160 – Review 7 (19.11.)

- **Leine:** Das Nachbereiten-To-do trägt einen Kalendertitel und wird darum als „fremd“ angelegt, wie die Uni-Brücke.
- **Aufschiebe-Zähler:**
  - Nachfassen bei Wartendem zählt nicht, ebenso wenig das Setzen von `wartet` zusammen mit einem späteren Datum.
  - Code-Abgleiche (Uni-Frist verlängert, `aendern(…, { abgleich: true })`) zählen auch nicht.
- **Nachbereiten-Anstoß ohne To-do-Vorschlag** kommt nur, wenn gerade Luft ist: kein laufender Termin, der nächste nicht in unter 10 min. Der Knopf gilt nur am selben Tag und wird vor dem Anlegen vermerkt (gegen Doppelklick). Der Tagesstand wird vor dem Schreiben frisch gelesen, damit kein Vermerk verloren geht.
- **/wartet-Knöpfe** aus alten Nachrichten schieben nichts mehr, wenn das To-do nicht mehr wartet.
- **„seit N Tagen“** im Wochenrückblick zählt ab dem Setzen von `wartet` (`wartet_seit`), nicht ab der Anlage des To-dos.
- **Energie:** Eine kurze Lücke (< 30 min) schlägt die beste Zeit; dann kommt 🪶 zuerst.
- **Rauschen:** Ende und Anfang des Puffers werden 250 ms überblendet, damit es am Schleifenpunkt nicht knackt.

## E161 – Projekte (19.11.)

- **Ein Projekt ist eine Gruppe** im To-do-Brett (Feld „Gruppe“), sobald sie mindestens 3 To-dos insgesamt oder 2 offene hat. Es gibt kein neues Feld und keine neue Datei, nur eine Auswertung (`projekteAus` in packages/shared).
- **Marktplatz → Projekte:** Je Projekt stehen dort:
  - Fortschritt (erledigt/gesamt, Balken) und „+N diese Woche“
  - die Fokuszeit
  - der nächste Schritt (⭐ → Datum → älteste) mit „🍅 Los“
  - „💤 Ruht seit N Tagen“, wenn eine Woche lang nichts angelegt oder erledigt wurde
- **Wochenrückblick:** „📁 Projekte: Bachelorarbeit 4/10 (+2), Umzug …, ruht seit 12 Tagen“.
- **Warum:** Große Vorhaben (Bachelorarbeit, Umzug, ein Corps-Amt) zerfallen in viele To-dos. In der Tagesliste sieht man nie, ob das Ganze vorankommt. Die Projektansicht zeigt genau das und stupst an, was einschläft.

## E162 – Was gute Tage ausmacht (19.11.)

- **Statistik (Rathaus) und Wochenrückblick („Gute Tage“, 4 Wochen):** Die Stimmung (E107) an Tagen mit und ohne eine Sache wird verglichen: mindestens 1 h Fokus, alle Gewohnheiten erledigt (nur Statistik), 3 oder mehr erledigte To-dos. Ein Ergebnis sieht so aus: „An Tagen mit mindestens 1 h Fokus: Stimmung ⌀ 4,3 – sonst 3,1“.
- **Nur mit Aussagekraft:** Verglichen wird nur, wenn es auf beiden Seiten mindestens 3 Tage mit Stimmung gibt und der Unterschied mindestens 0,5 beträgt. Ehrlich formuliert: ein Zusammenhang, kein Beweis.
- **Warum:** Die Stimmung des Tages wird schon erfasst, aber nirgends genutzt. Wer sieht, dass Fokus-Tage gute Tage sind, fängt eher wieder mit einem 🍅 an. Das ist Motivation aus den eigenen Daten statt aus Ratgebern.

## E163 – Projekte in Telegram und Morgenzeitung (19.11.)

- **/projekte:** Offene Projekte mit Balken (▰▱), „erledigt/gesamt“, „+N diese Woche“, „💤 N Tage“ und dem nächsten Schritt. Je Projekt gibt es einen „🍅“-Knopf, der den Fokus auf den nächsten Schritt startet (derselbe signierte Knopf wie „Jetzt dran“, `jl:`).
- **Morgenzeitung:** Ruht ein offenes Projekt seit mindestens 7 Tagen, steht das am längsten ruhende unter „Heute“: „💤 Umzug ruht seit 12 Tagen – nächster Schritt: …“. Nur eins, damit es ein Anstoß bleibt und keine Liste wird.

## E165 – Projekte in der Wochenplanung (19.11.)

- /planen → „2 · Drei Ziele“: Unter den Wochenzielen lassen sich die Projekte aufklappen („📁 Deine Projekte ansehen“). Wochenziele entstehen oft aus Projekten, und ein ruhendes Projekt ist beim Planen genau richtig aufgehoben.

## E164 – Feinschliff Projekte und Einsichten (nur Stil, 19.11.)

- Projekte erscheinen als kleine Tafeln mit Fortschrittsbalken (Prozent per CSS aus `aria-valuenow`). „💤 Ruht“ steht als gelber Hinweis, der nächste Schritt in einem eigenen Kästchen. „💡 Was gute Tage ausmacht“ ist ein warmer Hinweiskasten neben den Diagrammen.

## E166 – Review 8 (19.11.)

- **Projekte:**
  - Wartendes (E147) ist kein nächster Schritt.
  - „💤 ruht“ (`ruhtMelden`) gibt es nur, wenn etwas Machbares offen ist und der nächste Schritt nicht erst später fällig ist. Sonst würde jeder Uni-Kurs mit Fristen in drei Wochen täglich angestupst.
  - Fokussitzungen zählen als Bewegung (`fokusZuletzt`, vom Server über `mitFokus` angehängt).
  - Wiederkehrende To-dos sind keine Projektschritte.
- **/morgen:** Das Tagesende wird über das Datum berechnet (Umstell-Tage haben 23 oder 25 h). Die ⭐-Auswahl lässt ruhendes Wartendes auch nach dem ersten Tippen draußen; das gilt auch für den Tagesabschluss.
- **Gute Tage:** Der laufende Tag zählt nicht mit, denn eine morgens gesetzte Stimmung bei noch 0 min Fokus würde verzerren.
- **Wochenrückblick:** Wartendes wird nach `wartetSeit` sortiert.
- **Rauschen:** Die Überblendung hält die Leistung gleich, ohne Lautstärkeloch.
- **Bewusst gelassen:** `/api/todos?alle=1` für den Projekte-Reiter liefert alle erledigten To-dos. Das Lesen kostet nichts extra (`liste()` liest ohnehin alle Dateien), nur die Antwort wächst mit der Zeit. Bei Bedarf kommt ein schlanker `/api/projekte`-Endpunkt.

## E167 – /api/projekte (19.11.)

- Der Projekte-Reiter holt nur noch die Auswertung vom Server (`GET /api/projekte` → `projekteAus(mitFokus(…))`), nicht mehr alle je erledigten To-dos. Die Antwort bleibt damit klein, auch nach Jahren. Der Query-Schlüssel hängt an `['liste', 'todo']` und wird bei jeder To-do-Änderung frisch geholt.

## E168 – Terminüberschneidungen (19.11.)

- **`ueberschneidungen()`** (packages/shared) findet sich überlappende Termine mit Uhrzeit; Fristen-Blöcke und Ganztägiges sind ausgenommen, aneinandergrenzende zählen nicht.
- **Gemeldet in:** /morgen („⚠️ Überschneidung: 10:00 Vorlesung ↔ 11:30 Zahnarzt“), Tagesabschluss 21 Uhr und „🌅 Morgen im Blick“ auf Heute.
- **Warum:** Doppelt Gebuchtes fällt sonst erst auf, wenn man schon unterwegs ist. Am Vorabend lässt es sich noch in Ruhe klären.

## E169 – Morgen im Blick im Tagesabschluss, Anleitung (19.11.)

- /abschluss → „3 · Die drei für morgen“ zeigt unter der ⭐-Auswahl die Karte „🌅 Morgen im Blick“ von Heute: dran-To-dos, Termine, freie Zeit 8–22 Uhr, „eng“ und Überschneidungen. Die Komponente ist dieselbe (`MorgenKarte`), nur exportiert.
- Die Anleitung erklärt jetzt auch Tagesleiste, Projekte, „Was gute Tage ausmacht“ und die Überschneidungs-Warnung.

## E170 – In Etappen planen (19.11.)

- **Wo:** im To-do-Brett der Knopf „🪜“ bei offenen, nicht wiederkehrenden To-dos mit mindestens 2 h Schätzung und einer Frist frühestens übermorgen.
- **Vorschau:** Die Etappen werden erst gezeigt, bevor etwas angelegt wird (`etappenPlan` in packages/shared).
  - Je angefangene Stunde eine Etappe, mindestens 2, höchstens 8 und nicht mehr als Tage bis zur Frist.
  - Die Etappen sind gleich groß (≥ 15 min, 5-Minuten-Schritte) und verteilen sich gleichmäßig von heute bis zum Vortag der Frist.
  - Ohne Schätzung wird mit 2 h gerechnet.
- **„Etappen anlegen“** (`POST /api/todos/etappen`, mit `basisVersion` und genau einmal):
  - Das Original bekommt die Gruppe (= Titel, falls noch keine) und bleibt als Abgabe-Termin stehen.
  - Die Etappen „Titel – Etappe i/n“ bekommen dieselbe Gruppe, also entsteht sofort ein Projekt (E161) mit Fortschritt.
  - Gebäude und Energie werden übernommen.
- **Warum:** Große Abgaben scheitern selten am Können, sondern daran, dass sie erst am Vorabend begonnen werden. Rückwärts geplante Etappen machen aus „Referat in 2 Wochen“ heute 1 Stunde, und „Jetzt dran“, Wochenplan und Projekte greifen automatisch.

## E171 – Uni-To-dos gruppieren nach Fachname (19.11.)

- Die Uni-Brücke (E71) setzt als Gruppe jetzt den Fachnamen aus Uni/faecher (`fachZuordnen` über Titel und Ordner), nicht mehr den Kursnamen aus dem Kalender. Gibt es kein passendes Fach, bleibt es beim Kursnamen.
- **Warum:** Fach-Karten, Lernziele, „Nachbereiten“ und der Pomodoro aus dem Fach nutzen den Fachnamen. Mit zwei Namen zerfiel ein Kurs in zwei Projekte, und Fokuszeit landete nicht sauber beim Lernziel. Bestehende To-dos behalten ihre Gruppe, weil das Dorf nichts umschreibt, was Leif vielleicht angepasst hat.
- **Bürgermeister:** Er kennt „🪜 Etappen“ und schlägt sie bei großen Abgaben vor.

## E172 – Projekte im Plan (19.11.)

- Jedes Projekt trägt jetzt `frist` (spätestes Datum unter den offenen To-dos, meist die Abgabe) und `hinterher` (offene, machbare Schritte mit Datum vor heute).
- **Marktplatz → Projekte:** „🏁 Frist 2026-11-26 (in 7 Tagen)“, rot bei „⚠️ 2 Schritte hinterher“. **Wochenrückblick:** „…, 2 hinterher“.
- **Warum:** Mit Etappen (E170) gibt es einen Plan, und man will sehen, ob man ihn hält, bevor die Frist kippt.

## E173 – Review 9 (19.11.)

- **Etappen:**
  - Sie erben „fremd“ vom Original (Uni-/Mail-Titel), wie bei Wiederholungen (Leine).
  - Der Server lehnt mit 409 ab, wenn es schon Etappen mit demselben Titelstamm gibt. Der Knopf ist während der Anfrage gesperrt.
  - Das Original wird zur Abgabe selbst: 15 min statt der ganzen Schätzung, sonst zählt die Arbeit doppelt in Tagesbudget, Wochenplan und „Jetzt dran“. Damit verschwindet auch 🪜 danach.
  - Es wird erst alles geprüft und dann geändert, damit kein halb umgebautes Original zurückbleibt. Eine bestehende Gruppe wird nicht gekürzt.
  - 🪜 erscheint auch bei Uni-Abgaben und Prüfungen ohne Schätzung; gerechnet wird dann mit 2 h.
- **Tagesabschluss:** Überschneidungen werden über den ganzen Tag geprüft (auch vor 8 Uhr) und auch dann gemeldet, wenn morgen keine To-dos dran sind.
- **Überschneidungen:** Termine über 24 h (Exkursion Fr–So) zählen nicht. Sonst überschneiden sie alles.
- **Uni-Gruppe:** Bestehende Uni-To-dos, deren Gruppe noch exakt der Kursname ist, werden einmal auf den Fachnamen gezogen. Von Leif geänderte Gruppen bleiben.

## E174 – Projekte auf Heute und in der Morgenzeitung (19.11.)

- **Heute:** Ein Hinweis bei den Planungs-Karten, wenn ein Projekt hinterher ist oder ruht. Gezeigt wird nur eins, zuerst das mit den meisten überfälligen Schritten, mit dem nächsten Schritt und einem Link zu Marktplatz → Projekte.
- **Morgenzeitung:** „⚠️ Referat: 2 Schritte hinterher (Frist …) – als Nächstes: …“ vor dem „💤 ruht“-Hinweis (dieser nur für ein anderes Projekt).

## E175 – /projekte mit Frist und „hinterher“ (19.11.)

- Telegram /projekte zeigt je Projekt „⚠️ N hinterher“ und „🏁 Frist“ (E172), wie die App.

## E176 – Review 10 (19.11.)

- **Überschneidungen:** Die Uni-Kopie einer Prüfung (Quelle `uni`, gleicher Start) überschneidet sich nicht mit dem Eintrag aus Leifs Moodle-Kalender. Der Tagesabschluss vergleicht nur Termine, die morgen beginnen (wie „Morgen im Blick“).
- **Etappen:**
  - Gesperrt wird nur durch **offene** Etappen derselben Gruppe. Eine gleichnamige Abgabe der nächsten Woche lässt sich wieder planen.
  - Eine Etappe selbst bekommt kein 🪜 (400 am Server).
- **„hinterher“** zählt nur, solange im Projekt noch eine offene Frist aussteht. Nach der Abgabe mahnt nichts mehr.
- **Uni-Gruppe nachziehen:** Das gilt für alle offenen Uni-To-dos mit der alten Gruppe (auch Etappen). Verglichen wird mit dem getrimmten Kursnamen.
- **Nachziehen nur einmal je Kurs:** Ein Vermerk in `dorf_stand.uni_gruppe_umgezogen` sorgt dafür, dass jeder Kurs nur einmal umgezogen wird. Das Ziel ist nie der alte Name eines anderen Kurses. Ohne das konnten sich zwei Kurse gegenseitig hin- und herschieben, und weil jede To-do-Änderung den nächsten Abgleich anstößt, lief das endlos. In den Browser-Tests hielt das den Server so beschäftigt, dass das 3D-Dorf in die Zeitüberschreitung lief.
- **Test-Befund:** Die roten 3D-Dorf-Tests seit 05:45 UTC kamen nicht von Code-Änderungen. Der Test „Gewohnheit bearbeiten“ legte eine Gewohnheit mit Erinnerung um 06:45 an, und ab 06:45 Wiener Zeit läutete sie im Testserver. Ihr Hinweis lag dann über dem Dorf und fing die Klicks ab. Der Test räumt die Gewohnheit jetzt am Ende wieder ab.

## E177 – Befehlspalette: Projekte und Wochenplan (19.11.)

- Strg/⌘+K kennt jetzt „📁 Projekte“ und „🗂️ Wochenplan“ als Sprungziele.

## E178 – Bürgermeister kennt /morgen, /projekte, /wartet (19.11.)

- Systemkontext um die Telegram-Befehle der Nacht ergänzt, damit der Bürgermeister bei Fragen wie „was steht morgen an?“ oder „wie weit bin ich mit der BA?“ darauf verweisen kann.

## E179 – Die App aktualisiert sich selbst (19.11.)

- **Problem:** Der Service Worker suchte nur beim Neuladen nach einer neuen Fassung. Eine App, die am Handy aus dem Hintergrund zurückkommt oder im Programm den ganzen Tag offen ist, lädt aber nie neu. Und selbst dann lief der alte Code weiter, bis man von Hand neu lud.
- **Lösung (`apps/web/src/aktualisierung.ts`):**
  - Der Service Worker wird selbst registriert (`injectRegister: false`, mit `skipWaiting` und `clientsClaim`).
  - Geprüft wird alle 30 min, beim Zurückkommen in den Vordergrund und nach jedem Wiederverbinden der Live-Verbindung (Server neu gestartet, meist ein Deploy).
  - Zusätzlich wird das eigene Haupt-Skript mit dem aktuellen `index.html` des Servers verglichen (`?v=` umgeht den Precache). Das greift auch dort, wo kein Service Worker läuft (Programm).
- **Neuladen ohne Datenverlust:** Ist die App im Hintergrund, lädt sie sofort neu. Sonst erscheint „🔄 Neue Version des Dorfs ist da – Jetzt neu laden“, und sie lädt beim nächsten Wechsel in den Hintergrund neu, nie mitten im Tippen.
- **Einstellungen:** Dort stehen jetzt „Dorf-Stand <Commit> · diese Seite gebaut am …“. Ist die Bauzeit alt, obwohl der Dorf-Stand neu ist, hängt eine alte Fassung im Zwischenspeicher. Die Programm-Version heißt jetzt ausdrücklich „Programm-Hülle“ und erklärt, dass sie nur bei Änderungen am Programm selbst neu gebaut wird (z. B. 0.1.136 vom 18.11.), während die Inhalte immer frisch vom Dorf kommen.

## E180 – strict-Werkzeuge innerhalb der API-Grenzen (19.11.)

- **Problem:** Seit `wartet` (E147) und `energie` (E151) an `todo_anlegen`/`todo_bearbeiten` hängen, lehnte die API jeden api-Lauf mit To-do-Werkzeugen ab: „Schemas contains too many optional parameters (39) … limit: 24“. Der Bürgermeister wachte auf und scheiterte sofort (Lagebericht 12:00).
- **Lösung (`motor-api.ts`, `strictAuswahl`):**
  - strict bekommen nur Werkzeuge, die zusammen innerhalb der Grenzen bleiben: höchstens 20 Werkzeuge, 24 optionale Felder und 16 Typ-Vereinigungen.
  - Werkzeuge mit wenigen optionalen Feldern kommen zuerst dran, die übrigen laufen ohne strict. Ihre Eingaben prüft die WerkzeugKiste ohnehin mit Zod.
  - Die Reihenfolge der Werkzeuge bleibt gleich, die Auswahl ist pro Werkzeugliste fest. Damit bleibt der Cache stabil.
- **Test:** Alle Werkzeuge auf einmal (schlimmster Fall) und die Bürgermeister-Werkzeuge bleiben unter den Grenzen. Der bisherige Motor-Test prüft jetzt auch die Summe. Er hätte den Fehler früher zeigen können, prüfte aber nur „strict-tauglich“, nicht „wie viele“.

## E181 – Der Bürgermeister wacht zu zufälligen Zeiten auf (19.11.)

- **Wunsch (Leif):** Der Bürgermeister soll wirklich zufällig aufwachen, nicht mehr zur vollen Stunde, sondern nach einer zufälligen Zeit von 3 bis 7 Stunden.
- **Umsetzung (`aufwachen.ts`):**
  - Nach jedem Aufwachen wird der nächste Termin zufällig zwischen `abstand_von_stunden` und `abstand_bis_stunden` gewählt (Standard 3 und 7, einstellbar in `00_Stadtordnung/aufwachen.md`), auf die Minute genau.
  - Der Termin steht in `dorf_stand` (`aufwachen_naechste`), damit ein Deploy oder Neustart ihn nicht ständig neu würfelt und verschiebt. War der Server zum Termin aus, wacht er eine Minute nach dem Start auf.
- **Folgen:**
  - Ein Rundgang findet jetzt bei fast jedem Aufwachen statt, an dem es nichts Neues gibt, weil der Abstand mindestens `rundgang_abstand_stunden` (3) beträgt.
  - Aufgaben aus App und Telegram startet er weiterhin sofort. Nur Notizen aus Obsidian und neue Anlässe (Fristen, Freigaben, Mails) warten bis zum nächsten Aufwachen, höchstens 7 Stunden. Fristen-Erinnerungen über Telegram laufen unabhängig davon weiter.
  - Die Vorlage `aufwachen.md` hat die beiden neuen Felder bekommen. Unveränderte Fassungen aktualisiert das Dorf selbst (Hash in `dorf.ts`).

## E182 – Geräte koppeln und Geräte-API für den Cardputer (19.11.)

- **Wunsch (Leif):** Sein M5Stack Cardputer soll per WLAN mit dem Dorf sprechen. Der Vertrag steht in `apps/cardputer/API.md`.
- **Anmeldung (`app.ts`, `geraete.ts`):**
  - Unter `/api/geraet/` gilt **nur** `Authorization: Bearer <Schlüssel>`: kein Cookie, keine Herkunftsprüfung (der Cardputer ist kein Browser). Umgekehrt gilt der Schlüssel nirgends sonst – alle anderen Pfade prüfen weiter nur das Sitzungs-Cookie. Pfad **und** gefundene Route müssen beide unter `/api/geraet/` liegen, sonst 404 (kein Umweg über Kodierungstricks).
  - Schlüssel = 32 Zufallsbytes hex, in der DB nur der sha256 (wie bei den Sitzungen). „Zuletzt gesehen“ und IP werden bei jeder Anfrage gemerkt.
  - Sperren in der App löscht das Gerät – der Schlüssel gilt sofort nicht mehr, der Cardputer zeigt „Neu koppeln“. Höchstens 20 Geräte.
- **Koppeln:** Einstellungen → Geräte → „Cardputer koppeln“ zeigt einen 6-stelligen Code (5 min, einmalig, mit Anleitung und Countdown). Ein neuer Code ersetzt den alten.
  - Die Codes stehen in der DB (`geraete_kopplung`, nur als Hash), nicht im Speicher: Ein Deploy mitten in der Kopplung verliert den Code nicht, und „genau einmal“ ist eine einzige DB-Transaktion.
  - `POST /api/geraet/koppeln` ist gedrosselt mit derselben `Drossel` wie die Anmeldung (je IP und global, 401/429 mit `Retry-After`). Zusätzlich verfällt der offene Code nach 10 Fehlversuchen von irgendwo – dann holt Leif sich einfach einen neuen.
- **Idempotenz:** `X-Vorgang` (8–64 Zeichen) läuft über dieselbe Funktion wie `x-dorf-id` der App (`idempotenz.ts`, Tabelle `idempotenz`, 7 Tage). Geräte-IDs bekommen das Präfix `geraet:<Gerät>:`, damit sie nie mit IDs der App oder eines anderen Geräts zusammenfallen.
- **Keine Logik doppelt:** Die Routen rufen nur die vorhandenen Dienste (To-dos, Google-Kalender, Kirchturm, Schreibtisch/Bürgermeister, Freigaben, Gewohnheiten, Notizen, Uni, Postbote). Live-Ereignisse und Telegram laufen darüber mit.
  - „Heute“ zählt wie die App: ⭐ wichtig, überfällig, heute fällig, ohne Wartendes. Die Zeilen: Termine und Uni-Fristen nach Uhrzeit (ganztägige zuerst), dann diese To-dos, dann die heute fälligen Gewohnheiten.
  - To-do aus Text: wie App und Telegram (`todoAusText`: Dauer, Wiederholung, „wartet auf“), dazu am Ende ein Datum (heute, morgen, übermorgen, Wochentag, „24.12.“) und „!“ = wichtig. Ein Wochentag am selben Tag heißt heute, „nächsten fr“ eine Woche später. Bewusst auch zweibuchstabig („fr“, „so“) – am Gerät tippt Leif knapp.
  - Termine legt Leif am Gerät selbst an → direkt in den Hauptkalender wie `POST /api/kalender/termin`, ohne Einladungen.
  - Bürgermeister: neue Nachricht = Aufgabe auf dem Schreibtisch (Quelle „app“), er startet sofort; mit `chatId` geht es im Gespräch weiter (nur Chats des Bürgermeisters). Am Gerät steht statt des langen Auftrags Leifs Aufgabe; Antworten ohne den Abschnitt „## Zusammenfassung“ (wie Telegram) und ohne Markdown.
- **Kleine Abweichungen/Ergänzungen zum Vertrag:** Bei Timer, Wecker und Stoppuhr fehlen `phase` und `runde`. Beim Wecker ist `endeMs` das nächste Klingeln, bei der Stoppuhr ist `restMs` die gemessene Zeit. Ein Timer als `fokus` in `/start` hat `phase: null`. In der Bürgermeister-Liste steht bei älteren Chats statt der Uhrzeit der Tag („18.11.“). `tage` bei Terminen geht bis 60. Ungültige Eingaben antworten wie überall mit `{ fehler, details }`.

## E183 – Agenten stellen Timer und Pomodoro, schreiben Notizen und Entwürfe; Termine nur per Freigabe (19.11.)

- **Wunsch (Leif):** Bürgermeister und Helfer (beide Motoren) sollen „alles können“: To-dos, Notizen, Timer/Wecker, Pomodoro einstellen und starten, Mail-Entwürfe – direkt. Termine nur so, dass Leif bestätigt.
- **Neue Werkzeuge (`werkzeuge.ts`, Regeln in `leine.ts`):**
  - `kirchturm_lesen`, `kirchturm_timer` (start/pause/weiter/loeschen), `kirchturm_wecker` (stellen/loeschen, einmal/täglich/werktags/Wochenende), `pomodoro` (start – mit Titel oder To-do wie „🍅 Fokus“ –, pause, weiter, ueberspringen, stopp), `pomodoro_einstellen` (nur die angegebenen Felder), `notiz_anlegen` (Tagesnotiz mit Quelle „Bürgermeister“ bzw. „Agent <Gebäude>“). Alles über `Kirchturm.ausfuehren` bzw. `Notizen.hinzufuegen` – dieselben Wege wie App, Telegram und Cardputer.
  - `termin_vorschlagen` legt eine Freigabe `termin_anlegen` an: Titel „Termin: <Titel> – <Tag> · <Uhrzeit> (<Dauer>)“, dazu die Vorschau im Inhalt. Erst nach Leifs Ja (App, Telegram oder Cardputer) trägt der Code über `inHauptkalender` ein – genau einmal (Freigaben sind atomar), nie mit Einladungen (`sendUpdates=none`). Ein Agent kann `termin_anlegen` nicht über `freigabe_beantragen` einschmuggeln.
  - `post_entwurf` (Antwort auf eine bekannte Mail) passte nicht für neue Mails. Neu ist `post_entwurf_neu`: genau eine schlichte Adresse, nur Entwurf, gesendet wird nie.
- **Wer bekommt was:**
  - Jede Aktion und jeder freie Helfer: To-dos (wie bisher) und der ganze Alltag. Freie Helfer hatten bisher nicht einmal die To-dos – jetzt wie jede Aktion ohne Fremdinhalte.
  - Läufe mit **Fremdinhalten** bekommen davon nur `kirchturm_lesen` und `termin_vorschlagen`. Timer-/Wecker-/Pomodoro-Namen und die Tagesnotiz liest später jeder Agent, auch einer mit Internet. Anders als bei To-dos (Markierung „fremd“) lässt sich das dort nicht abgrenzen. Termin-Vorschläge sieht Leif vor dem Eintragen, und Kalendertitel gelten ohnehin als Fremdinhalt. Die WerkzeugKiste prüft das zusätzlich selbst (doppelt gesichert).
  - `post_entwurf_neu`: Bürgermeister immer; Aktionen mit `werkzeuge: [post]` nur ohne Fremdinhalte – ein präparierter Mailtext soll sich keinen Empfänger aussuchen können. Antworten auf Mails bleiben bei „Antwort entwerfen“.
- **Beide Motoren:** Die Werkstatt holt die Werkzeugliste des Laufs über `intern.ts` – neue Werkzeuge kommen dort ohne Änderung an (Ende-zu-Ende-Test mit Fake-claude zeigt sie).
- **strict-Grenzen (E180):** Die neuen Schemas haben wenige optionale Felder (ohne `minimum`/`maximum`; Zod prüft). Weil sie billiger sind, wählt `strictAuswahl` sie vor `todo_anlegen` – das läuft jetzt wie schon `todo_bearbeiten` ohne strict. Die Grenzen bleiben eingehalten.
- **Kontext:** Der Systemprompt nennt die Werkzeuge, die der Lauf hat. Die Orientierung des Bürgermeisters sagt jetzt „Termine nie selbst eintragen, termin_vorschlagen“ statt „Einträge legt nur Leif an“ und dass er Pomodoro, Timer und Wecker selbst stellen kann, wenn Leif es will. Keine Vorlagendatei geändert (kein neuer Hash nötig).
- **Ersetzt E75 (Teil):** „Kalendereinträge: Agenten nie“ gilt nicht mehr – Agenten nur per Freigabe.

## E184 – Cardputer-Firmware 1.0: Fernbedienung + Agentendorf (19.11.)

- **Wunsch (Leif):** Auf dem M5Stack Cardputer Adv bleibt im Startmenü „Fernbedienung“ (HaloOS 0.3, Quellcode von Leif). „Cardo“ wird durch „Agentendorf“ ersetzt: alle Funktionen als Listen, über WLAN oder Handy-Hotspot, mit dem Bürgermeister reden.
- **Aufbau (`apps/cardputer/`):**
  - Die Logik liegt in `src/core/` (läuft auch am PC), die Hardware in `src/main.cpp`.
  - Die Fernbedienung ist unverändert. Der Cardo-Abgleich mit dem Hub bleibt drin, weil das Entfernen das Verhalten gegenüber dem ungetesteten Hub ändern würde.
  - Moduswechsel = Neustart. Im Agentendorf läuft kein BLE.
- **Netz:**
  - Ein eigener FreeRTOS-Task, damit Tasten, Countdown und Läuten während eines TLS-Handshakes weiterlaufen.
  - HTTPS mit eingebetteten Root-CAs (ISRG X1/X2, USERTrust RSA/ECC) und Prüfung des Hostnamens, nie `setInsecure`.
  - Das Ablaufdatum der Zertifikate prüft das mbedTLS des Core 2.0.17 nicht (ohne `MBEDTLS_HAVE_TIME_DATE`).
- **JSON:** Ein eigener Leser ohne Baum statt ArduinoJson, weil das Gerät kein PSRAM hat und 20-KB-Antworten sonst doppelt im RAM lägen.
- **Offline:** Schreibende Aktionen laufen immer über eine Warteschlangen-Datei mit fester `X-Vorgang`-id. Der Server führt nichts doppelt aus (E182).
- **Prüfung:**
  - `test/host-test.sh`: 115 Prüfungen gegen den Nachbau der API.
  - `test/vertrag_test.py`: die echte Geräte-API gegen den Nachbau. Felder und Typen stimmen überein, optionale Felder sind laut `API.md` erlaubt.
  - Nie auf echter Hardware gelaufen. Ungemessen bzw. unerprobt sind Heap mit WLAN+TLS, WLAN-Fehlertexte, Akku und Tastatur. Siehe `ANLEITUNG.md` → „Was geprüft ist“.
- **Auslieferung:**
  - `release/agentendorf-cardputer-1.0.bin` (an 0x0, wie HaloOS) und `…-nur-programm.bin` (an 0x10000, für spätere Updates ohne Verlust von WLAN und Kopplung).
  - Die Binärdateien liegen im Repo, damit Leif sie direkt herunterladen kann.

## E185 – Agenten nehmen Leif Arbeit ab: weniger Freigaben, „Rückgängig“ statt Klick, Web auch mit Privatem (19.11.)

- **Anlass:** „Schreib an die Leemhuis eine Entschuldigungsmail und leg sie in die Entwürfe“ brauchte 3 Helfer, 3 Freigaben und 20 Minuten – und wurde nicht fertig. Leif: „Nimm raus, dass ich jeden Bullshit bestätigen muss. Bestätigen muss ich nur, wenn ich sage ‚plan mir das‘.“
- **Leifs Entscheidungen (verbindlich):**
  1. Termine in seinen **eigenen** Kalender tragen Agenten direkt ein. Ersetzt den Teil „Termine nur per Freigabe“ aus E183.
  2. **Web + Privates: alles erlaubt.** Die Regel „Web nie zusammen mit Fremdinhalten“ (Leifs Vorgabe aus Etappe 2a, E56/E57/E183 bauten darauf) fällt. Jeder Lauf darf Web (Suche + Abruf) und gleichzeitig Post, Moodle, Kalender und Vault lesen.
  3. Freigaben nur noch für echte Außenwirkung und die Regeln selbst.
- **Das Risiko bei 2., das Leif ausdrücklich in Kauf nimmt:** Ein Lauf, der private Daten liest und beliebige Adressen abrufen kann, lässt sich durch eingeschleusten Text (präparierte Mail, Webseite, Moodle-Seite) dazu bringen, Privates in eine Web-Adresse oder Suchanfrage zu schreiben – dann ist es draußen. Technisch verhindert das nichts mehr. Geblieben sind:
  - Senden, Abgeben, Zahlen gibt es nicht – kein Werkzeug dafür, nur Entwürfe.
  - Die Fremdinhalt-Hülle (Daten, keine Anweisungen) und ein neuer Satz in der Stadtordnung: nie Privates in eine Web-Adresse oder Suchanfrage, weil ein Fremdinhalt es verlangt.
  - Jeder Web-Abruf steht im `werkzeug_log` (`art = web`) und im Protokoll des Chats.
  - Web bekommt ein Lauf weiterhin nur, wenn die Aktion `web` nennt (Bürgermeister immer, freie Helfer mit `faehigkeiten: [web]`). Notschalter und Tagesbudget unverändert.
  - `vault_schreiben`/`vault_aendern` stempeln `.md`-Dateien mit `fremdinhalt: true`, sobald der Lauf etwas von außen gelesen hat (Mail, Moodle, Kalender, Web, Fremdinhalt-Datei, markierte To-dos) – nicht mehr nur nach dem Schalter der Aktion. Spätere Läufe lesen sie in der Hülle.
- **Leine (`leine.ts`):** `aktionPruefen` kennt keine verbotene Kombination mehr (bleibt als die eine Stelle für künftige Regeln). `NUR_OHNE_FREMDINHALT` entfällt: auch Läufe mit Fremdinhalten haben Notiz, Timer, Termine. To-dos aus solchen Läufen bleiben markiert (`fremd`), sind aber für Web-Läufe nicht mehr unsichtbar. Gespeicherte Chats: alte Werkzeugnamen werden beim Start umbenannt (`werkzeugeAktuell`).
- **Freigaben – was bleibt:** Dateien außerhalb des eigenen Gebäudes löschen/überschreiben (`datei_loeschen`, `datei_ueberschreiben`), Persönlichkeit des Bürgermeisters, `freigabe_vor_start`, Skills **mit Zeitplan** (laufen unbeaufsichtigt und kosten dauerhaft), Termine **mit Gästen** ändern/löschen (`termin_aendern`, `termin_loeschen`), Pläne, die Leif ausdrücklich wollte oder die groß/teuer sind.
- **Was weg ist:**
  - `sonstiges` (der Ausführer tat nichts): Muss Leif selbst etwas tun, legt der Agent ein To-do an. Alte Einträge bleiben lesbar.
  - Helfer-Grenze 1 → **5 je Aufgabe** ohne Plan (`MAX_HELFER_JE_AUFGABE`), keine Freigabe.
  - Pläne starten **sofort**, außer `bestaetigen: true` (Leif wollte einen Plan), mehr als 5 Teilaufgaben oder über 2 $ API-Schätzung (`PLAN_OHNE_FRAGE_*`). E62 (automatisch nach 10 min) gilt nur noch für vorgelegte Pläne.
  - Skills ohne Zeitplan: `aktion_anlegen` (früher `aktion_vorschlagen`) legt direkt an; `ersetzen: true` überschreibt, alte Fassung nach `<Gebäude>/archiv/aktionen/`. Die Aktion des Bürgermeisters selbst ersetzt er nie.
  - Termine: `termin_anlegen` (früher `termin_vorschlagen`), `termin_aendern`, `termin_loeschen` direkt, immer `sendUpdates=none`.
- **„Rückgängig“ statt Klick (`agenten/rueckgaengig.ts`, Tabelle `rueckgaengig`):** Jede direkte Tat mit Rückweg wird gemerkt und vom Dorf – nie vom Agenten – genau einmal zurückgenommen (atomarer Statuswechsel wie bei Freigaben).
  - Termin angelegt → gelöscht; geändert → alte Zeiten zurück; gelöscht → wieder eingetragen. Skill angelegt → Papierkorb; ersetzt → alte Fassung zurück. Datei geändert → Archivfassung zurück, aber nur, wenn die Datei seither unverändert ist. Datei verschoben → zurück.
  - Meldung: Telegram „✅ Ohne Rückfrage erledigt … ↩️ Rückgängig“ (signierter Knopf, Nachtruhe wie andere Meldungen, Schalter `freigaben` in `telegram.md`) und App → Rathaus → Freigaben → „Ohne Rückfrage erledigt“ (7 Tage). Datei-Änderungen erscheinen nur in der App, nicht in Telegram – sonst käme je Zeile eine Meldung.
- **Texte:** Stadtordnung Abschnitt 2, 4, 5, 7, `buergermeister.md`, `aktion-vorlage.md` neu gefasst (frühere Hashes in `dorf.ts`). Leifs eigene `memory.md` nennt noch `aktion_vorschlagen` – harmlos, der Systemprompt nennt das richtige Werkzeug.
- **Tests:** `agenten-leine.test.ts` (Kombinationen, Stempel, `vault_aendern`/`vault_verschieben`, Rückgängig), `automatik.test.ts` (Skill mit/ohne Zeitplan, ersetzen, zurücknehmen), `alltag-werkzeuge.test.ts`, `e185.test.ts` (Termine, Gäste, Telegram-Knopf mit falscher Signatur, Routen).

## E186 – Der Bürgermeister erledigt Kurzes selbst; Pläne mit Reihenfolge (19.11.)

- **Ein Lauf statt drei:** Der Bürgermeister hat Post (`post_suchen`, `post_lesen`, Entwürfe), `kalender_lesen`, Adressbuch und Web jetzt direkt – unabhängig von der Aktionsdatei (`dienst.ts`). Systemprompt und `buergermeister.md`: erst selbst, Helfer nur für große oder lange Arbeit, kein Skill für Einmaliges, höchstens eine Rückfrage.
- **Adressbuch (`kontakte.ts`):** `kontakt_suchen` sucht in `Rathaus/kontakte.md` (eine Zeile je Kontakt, in Obsidian pflegbar), in den Absendern von `post_mails` und in gesendeten Mails (`in:sent to:(…)`, nur Buchstaben/Ziffern aus dem Namen; zurück kommen nur passende Adressen, nie Mailtext). `kontakt_merken` trägt ein, jede Adresse einmal. Für alle Agenten.
- **`rueckfrage`:** höchstens eine je Lauf. Hinweis im Chat, in Telegram mit Antwort-Knöpfen (signiert, genau einmal). Die Antwort ist die nächste Nachricht im Chat.
- **Freie Helfer** (`helfer_starten` ohne Aktion, Plan-Teilaufgaben) bekommen mit `faehigkeiten` Web, Post, Kalender, Moodle oder Rechenraum – dafür braucht es keinen neuen Skill mehr.
- **Aktionen als Helfer** bekommen den `auftrag` des Bürgermeisters als „Zusatz“ im Prompt. Früher ging er verloren (`teilaufgabeStarten` reichte nur `eingaben` weiter).
- **Reihenfolge (`nach`):** Eine Teilaufgabe nennt die Nummern früherer Teilaufgaben, die fertig sein müssen (nur nach vorn – keine Kreise). `planWeiter` startet sie nach deren Ende und hängt Zusammenfassung und abgelegte Dateien der Vorgänger in der Fremdinhalt-Hülle an. Scheitert ein Vorgänger, fällt sie aus (`plan_uebersprungen`, auch in Ketten); der Plan endet trotzdem genau einmal. Jede Teilaufgabe startet genau einmal (Marke im Speicher + `plan_helfer`).
- **Tests:** `buergermeister.test.ts` (5 Helfer, Plan ohne Freigabe, großer Plan mit Freigabe, Kette, gescheiterter Vorgänger, Kreis, Zusatz, Fähigkeiten), `e185.test.ts` (Mail in einem Lauf ohne Helfer und ohne Freigabe).

## E187 – Nachrichten-Warteschlange im Chat (19.11.)

- **Wunsch (Leif):** Im Chat weiterschreiben, während der Agent arbeitet, wenn er etwas vergessen hat.
- **Vorher:** `nachrichtSenden` warf 409, die App sperrte das Textfeld, Telegram sagte „schick nochmal“. Auch die Meldungen des Dorfs an den Bürgermeister („Helfer fertig“, „Freigabe angenommen“) gingen verloren, wenn sein Chat gerade lief – er erfuhr die Ergebnisse dann nie.
- **Jetzt (`dienst.ts`, Tabelle `chat_warteschlange`):** Läuft im Chat etwas, wird die Nachricht eingereiht (`{ wartend: n }`). Nach dem Lauf – auch nach Fehler oder Abbruch – wird alles Wartende als **ein** neuer Lauf übergeben (mehrere als „Nachricht 1/2/…“). `fortsetzen` des Bürgermeisters nutzt denselben Weg.
- **In den laufenden Lauf:** Der api-Motor holt Wartendes zwischen zwei Werkzeug-Runden (`nachschub`) und hängt es als Textblock hinter die `tool_result`-Blöcke derselben Nutzer-Nachricht – der Verlauf bleibt „nur angehängt“. Der claude-code-Motor kann das nicht (die Werkstatt schließt die Eingabe sofort); dort kommt es nach dem Lauf dran.
- **Anzeige:** App: Textfeld bleibt offen („Dazuschreiben“), wartende Nachrichten als graue Blasen mit ✕ (`DELETE /api/chats/:id/wartend/:nr`). Telegram: „📝 Notiert – kommt nach dem aktuellen Schritt dran“. Cardputer: kein 409 mehr, Antwort wie bisher `{ chatId }`.
- **Tests:** `agenten-lauf.test.ts` (einreihen, zusammenfassen, löschen, Abbruch, Fehler, Nachschub), `e185.test.ts` (Routen, api-Motor mit gültigem Verlauf beim Fortsetzen), `telegram.test.ts`, Browser-Test „E185 Chat“.

## E188 – Neue Werkzeuge für den Alltag (19.11.)

- `post_entwurf_neu` mit `cc` und `anhaenge` (bis 5 Dateien aus dem Vault, zusammen 15 MB; `rohNachricht` baut multipart/mixed, Dateinamen und Typen werden bereinigt). `post_entwurf_aendern` ersetzt einen Entwurf, den derselbe Chat angelegt hat (Gmail `drafts.update`, Empfänger und Anhänge bleiben) – statt bei „mach es kürzer“ einen zweiten anzulegen. Der Bereich `gmail.compose` reicht dafür.
- `termin_aendern`, `termin_loeschen` (gefunden über Tag + Titel, muss eindeutig sein), `freie_zeiten` (vorhandene Lückensuche).
- `vault_aendern` (genau eine Stelle ersetzen oder anhängen) und `vault_verschieben` im eigenen Gebäude, nie in `gebaeude.md`, `aktionen/`, `protokolle/`, `chats/`, `archiv/`, Gedächtnis oder Persönlichkeit. Alte Fassung nach `<Gebäude>/archiv/aenderungen/`.
- strict-Grenzen (E180): unverändert eingehalten – `strictAuswahl` wählt die billigsten Schemas, der Rest läuft ohne strict (Zod prüft).
- **Nicht gebaut (Restliste):** Posteingang aufräumen (`post_markieren`, braucht den Bereich `gmail.modify` und eine neue Google-Anmeldung), ganzen Mail-Verlauf lesen, Gebäude-Gedächtnis für Helfer, strukturierte Uni-Fristen/Bank-Umsätze als Werkzeug, Zahlschein-QR, Nachschub in laufende claude-code-Läufe, Antwort-Knöpfe für Rückfragen in der App.

## E189 – Review zu E185–E188: neun Funde behoben (19.11.)

Ein unabhängiger Review hat neun Fehler gefunden. Jeder ist behoben und hat einen Test in `test/e185-review.test.ts`, der in der Fassung davor scheitert.

- **Helfer-Abschluss je Helfer statt je Aufgabe:** Mit bis zu 5 Einzelhelfern ging das Ergebnis eines später fertigen Helfers verloren, weil der Abschluss am Schreibtisch-Status „erledigt“ hing. Jetzt merkt die Tabelle `helfer_gemeldet` (Migration 25), welcher Einzelhelfer dem Bürgermeister schon gemeldet ist – atomar je Helfer, genau einmal. „erledigt“ wird die Aufgabe erst, wenn kein Helfer mehr unterwegs ist. Alles, was vor der Migration fertig war, gilt als gemeldet.
- **Grenzen je Aufgabe, nicht je Plan:** 5 Helfer und 2 $ zählen über alle Einzelhelfer und Pläne einer Aufgabe (`helferJeAufgabe`). Der zweite kleine Plan im selben Lauf braucht Leifs Freigabe; ein Einzelhelfer über der Grenze wird abgelehnt mit dem Hinweis auf einen Plan, den Leif bestätigt.
- **Geschützte Skills ersetzen nur per Freigabe:** Hat die alte Fassung `freigabe_vor_start`, `zeitplan`, `zeitplan_je` oder `rolle`, legt `aktion_anlegen` das Ersetzen vor. Felder, die der Entwurf nicht kennt (`freigabe_vor_start`, `zeitplan_je`, `anhaenge`, `rolle`), bleiben in jedem Fall erhalten – vorher gingen sie still verloren.
- **Warteschlange hängt nicht mehr:** Nach einem Serverstart wird Wartendes übergeben (`AgentenDienst.nachStart`). Eine abgelehnte „Aktion starten“-Freigabe bricht den Lauf ab, statt ihn für immer auf `wartet_freigabe` zu lassen.
- **Abbruch eines wartenden Laufs** meldet jetzt ein Laufende wie jeder andere (Pläne mit `nach` warteten sonst ewig). Nach einem Neustart greift `Buergermeister.nachStart` laufende Pläne und ungemeldete Einzelhelfer auf.
- **Reihenfolge:** Wartet noch Älteres, wird auch eine neue Nachricht eingereiht und alles zusammen übergeben – sie überholt nichts mehr.
- **Nachschub ohne Antwort:** Scheitert oder endet ein api-Lauf, bevor das Modell auf den Nachschub geantwortet hat, kommt er zurück an den Anfang der Schlange und es gibt einen Folgelauf.
- **Zurücknehmen:** Ein Skill wird nur zurückgenommen, wenn er seither unverändert ist (wie bei Dateien). Scheitert das Zurücknehmen, bleibt der Eintrag offen und nennt den Grund – ein späterer Versuch ist möglich.
- **`vault_aendern`** schreibt mit `basisVersion`: Ändert jemand die Datei zwischen Lesen und Schreiben, entsteht eine Konfliktkopie statt eines Überschreibens. **Stempel:** `fremdinhalt: true` wird nur noch bei neu angelegten Dateien gesetzt, als eine eingefügte Zeile; das übrige Frontmatter bleibt Zeichen für Zeichen (kein Neuaufbau über gray-matter). `vault_aendern` stempelt bestehende Dateien nicht mehr. Ersetzt die Aussage in E185, auch `vault_aendern` stemple.

## E193 – Cardputer 1.1: bekannte Netze automatisch (19.11.)

- **Wunsch (Leif):** Heim-WLAN, Hotspot und andere bekannte Netze von selbst erkennen und verbinden.
- **Vorrang statt Signalstärke:** Die Reihenfolge der bis zu acht gespeicherten Netze ist der Vorrang (in der WLAN-Ansicht mit `,` / `/` änderbar). Sind mehrere sichtbar, gewinnt das obere, außer es kommt mit weniger als −85 dBm an. Zu Hause soll das Heimnetz gewinnen, auch wenn der Hotspot in der Tasche stärker ist.
- **Nicht gesehene Netze direkt versuchen:** iPhone-Hotspots und versteckte Netze fehlen oft in der Suche. Nach den gesehenen versucht die Automatik deshalb die gespeicherten, aber nicht gesehenen Netze der Reihe nach ohne Suche (je 8 s). Von Hand getippte Netze („Anderes Netz“) werden als versteckt gemerkt.
- **Akku vor Eile:** Nach einer erfolglosen Runde wächst die Pause von 15 s auf höchstens 5 min. „Neu suchen“ oder ein Verbindungsabriss setzen sie zurück. Am Netz mit dem höchsten Vorrang wird nie gesucht.
- **Wechsel unterwegs:**
  - Am Netz mit niedrigerem Vorrang sucht er höchstens alle 3 min und nur ohne laufende Anfrage. Ein besseres bekanntes Netz ab −75 dBm wird übernommen.
  - Scheitert der Wechsel, geht er zurück und prüft erst nach 15 min wieder.
  - Ein von Hand gewähltes Netz wird nicht automatisch verlassen.
  - Grenze: Ein versteckt sendendes besseres Netz löst keinen Wechsel aus.
- **Steuerung im Kern:** Das Auto-Reconnect des Arduino-Core bleibt aus. Die Automatik sitzt in `core/dorf.cpp` und ist damit am PC prüfbar (Host-Test: 140 Prüfungen, WLAN nachgestellt). Nie auf echter Hardware gelaufen.
- **Auslieferung:** `tools/zip.sh` packt die ZIP (Anleitung, beide `.bin`, SHA256, Bilder). Sie liegt nicht im Repo, und die Dorf-Adresse steht nicht in der Anleitung.

## E192 – Der Bürgermeister arbeitet von selbst (19.11.)

- **Wunsch (Leif):** 50 Aktivitäten für das Aufwachen, statt nur den Schreibtisch zu prüfen und wieder einzuschlafen. Dazu: Vault pflegen, aus alten Protokollen Leifs Verhaltensweisen lernen, eine eigene To-do-Liste, damit aus alten Aufträgen nichts offen bleibt.
- **50 Aktivitäten** stehen in `docs/buergermeister-aktivitaeten.md`. 18 sind im Katalog umgesetzt, eine ist fest eingebaut (eigene To-dos), 31 bleiben Ideen.
- **Eigene To-do-Liste (`agenten/meine-todos.ts`):**
  - Eine Datei je Eintrag in `Rathaus/buergermeister-todos/`, wie Leifs To-do-Brett (Obsidian, Konfliktkopie, Papierkorb). Jeder Eintrag hat `wieder_am` und einen Bezug zur Aufgabe bzw. zum Chat.
  - Werkzeuge `meine_todos_*` gibt es nur für den Bürgermeister: Kein Profil kennt sie, die Kiste lehnt sie ohne Rolle ab, und der Ordner ist für `vault_*` gesperrt.
  - Im Systemprompt steht die Regel „am Ende jedes Laufs Offenes eintragen“.
  - Nach jedem Lauf übernimmt der Code die Punkte unter „Offen“ aus der Zusammenfassung (höchstens 5 je Lauf, höchstens 60 offen, ohne Dubletten), wenn der Bürgermeister die Liste nicht selbst gepflegt hat.
  - Leif sieht und bearbeitet die Liste im Rathaus unter „Schreibtisch“.
- **Aufwachen, neue Reihenfolge:**
  1. Fällige eigene To-dos, auch bei `eigene_aufgaben: nein`.
  2. Neue Anlässe: Lagebericht.
  3. Sonst ein Rundgang mit 1–3 Aktivitäten aus dem Katalog, ausgewählt vom Code.
  - Ohne Anlass startet kein KI-Lauf mehr.
  - Ein To-do, das 3× ohne Fortschritt vorgelegt wurde, ruht eine Woche.
- **Katalog (`rundgang.ts`):**
  - 18 Aktivitäten, darunter: Aufträge nachhalten, Dorf-Gesundheit, Uni-Fristen vorbereiten, unbeantwortete Mails, Kalender-Vorschau, überfällige To-dos zerlegen, Leif kennenlernen, Vault pflegen, Skills verbessern, Budget/Abos, Recherche auf Vorrat. Die übrigen stehen in `rundgang.ts`.
  - Zu jeder Aktivität sammelt der Code die Fakten ohne KI. Ohne Anlass wird sie nicht gewählt und erst nach mindestens 20 Stunden wieder geprüft.
  - Auswahl: am längsten überfällige zuerst.
  - Budget: 10 % Reserve, große Aktivitäten erst ab halbem Tagesbudget, mittlere ab einem Viertel, höchstens eine nicht-kleine je Rundgang. Nachts nur stille Pflege.
  - Einstellungen in `00_Stadtordnung/rundgang.md`: Häufigkeit `aus`/`jedes`/`täglich`/`wöchentlich`/`monatlich`/`alle N tage`. Zod-geprüft, bei Fehlern gelten die Standardwerte, und der Fehler wird angezeigt.
- **Leif kennenlernen:**
  - Daraus lernt er: abgelehnte Freigaben und Pläne mit Grund, „Rückgängig“, Leifs Nachträge, Abbrüche, Antworten auf Rückfragen.
  - Das Ergebnis steht im Abschnitt „Leifs Vorlieben und Arbeitsweise“ in `Rathaus/memory.md`.
  - `textPruefen` sperrt IBAN und Kontostände im Gedächtnis.
- **Sichtbarkeit ohne Spam:**
  - Je Rundgang und Lagebericht schreibt der Code eine Zeile in `Rathaus/rundgang/JJJJ-MM-TT.md`.
  - Die Zeilen „Für Leif: …“ erscheinen gebündelt in der Morgenzeitung („Der Bürgermeister seit gestern“, abschaltbar mit `meldung: nein`).
  - Rundgänge melden sich nicht mehr einzeln per Telegram.
- **Kosten:** Die Gewichte (klein 0,08 $, mittel 0,25 $, groß 0,80 $) sind Annahmen. Nach einer Woche echter Läufe wird `KOSTEN_USD` angepasst.
- **Leine:** unverändert, nie senden, zahlen oder abgeben. Web nutzt nur „Recherche auf Vorrat“, dort gilt das Risiko aus E185.

## E190 – Anhänge in allen Formaten (19.11.)

- **Wunsch (Leif):** Dateien anhängen und so an den Bürgermeister übergeben. Er soll mit vielen Formaten arbeiten können.
- **Anhängen überall:**
  - **Chat:** Knopf, Ziehen/Ablegen, Einfügen; auch während eines Laufs (dann Warteschlange mit Kärtchen).
  - **Schreibtisch:** dieselbe Auswahl.
  - **Telegram:** Dokument, Foto, Sprachnachricht, Audio, Video. Im laufenden Gespräch hängt die Datei an der aktuellen Aufgabe, die Bildunterschrift ist der Text. Weitergeleitetes bleibt eine neue Aufgabe und Fremdinhalt.
  - **Ablage:** Chat in `<Gebäude>/chats/anhaenge/<zeit>/`, Schreibtisch in `Rathaus/schreibtisch/anhaenge/<zeit>/`, ASCII-Namen.
  - **Grenzen:** 25 MB je Datei, höchstens 20. Zu groß → 413 mit Namen, nichts bleibt liegen.
  - Migration 27: `anhaenge_json` an `laeufe` und `chat_warteschlange`.
- **Verstehen (`agenten/anhaenge.ts`):**
  - Text und Quelltext liest das Dorf selbst (nur dekodieren).
  - PDF und PNG/JPG/GIF/WEBP gehen nativ ans Modell, zusammen höchstens 22 MB je Lauf.
  - Alles andere ist Fremdinhalt und wird NUR im Rechenraum umgewandelt (`/umwandeln`: eigener Kindprozess, 420 s, RLIMIT_AS 1,5 GB, eigener Ordner, höchstens 2 gleichzeitig).
  - Zwischenspeicher je sha256 in `<daten>/umwandlung/`, nicht im Vault.
  - Umgewandeltes steht immer in der Fremdinhalt-Hülle. Unbekanntes kommt mit Name, Typ, Größe und Grund, nichts wird still verschluckt.
- **Formate:**
  - **Office, Dokumente, Archive:** Office/ODF/RTF/EPUB/HTML/.eml/ZIP/TAR mit der Python-Standardbibliothek (in der CI ohne Zusatzpakete testbar). Alte .doc/.ppt mit catdoc, .xls mit xlrd, .msg mit olefile.
  - **Bilder:** HEIC/BMP/TIFF/SVG werden zum verkleinerten Bild.
  - **Scan-PDF:** tesseract (deu+eng, erste 10 Seiten).
  - **Audio und Video:** Audio mit whisper.cpp v1.8.7 (Modell base-q5_1, im Image), höchstens 6 min. Video ergibt 4 Standbilder und ein Transkript.
  - **Archiv-Grenzen:** nie nach Pfad entpacken; höchstens 15 Dateien lesen, je 25 MB, zusammen 100 MB; Packrate über 200 wird nicht gelesen; Tiefe höchstens 2.
- **Nicht gemacht:**
  - LibreOffice (rund 500 MB): Folien gibt es deshalb nur als Text, nicht als Bild.
  - MarkItDown verworfen: viele ungepinnte Abhängigkeiten.
  - 7z/RAR nur gemeldet.
  - Gmail-Anhänge über `post_lesen` kommen später.
  - Die Transkription braucht AVX2.
- **Mit Dateien arbeiten:**
  - `vault_lesen` versteht jedes Format, in beiden Motoren.
  - Der Bürgermeister hat den Rechenraum und legt in `Rathaus/dateien/<stempel>_<titel>/` ab.
  - `rechenraum_ablegen` nimmt fertige Dateien (PDF, TeX, DOCX/XLSX/PPTX, ODF, CSV/TXT/MD/JSON, PNG/JPG/SVG, ZIP, ICS …), nie HTML, Skripte oder Makro-Dateien.
- **Anzeige:** Kärtchen unter Leifs Nachricht, „📂 Erzeugte Dateien“ nach dem Lauf, und eingeklappt, was der Agent vom Anhang sah.

## E191 – Codehaus: VS Code im Browser und Agenten, die selbst programmieren (19.11.)

- **Leifs Entscheidungen (verbindlich):**
  1. VS Code im Browser, erreichbar von PC, Tablet und Handy, geschützt durch die Dorf-Anmeldung.
  2. Agenten programmieren dort selbstständig: Dateien schreiben, Befehle ausführen, testen, mit Internet und **mit Vollzugriff (lesen und schreiben) auf den Vault**.
  3. GitHub: klonen, pushen, Pull Requests anlegen **und mergen**.
  - Dorf-Geheimnisse (`.env`, `browser.env`, `rechenraum.env`) kommen nicht in den Coding-Container.
- **Risiko, das Leif damit trägt:**
  - Im Coding-Container gilt die Leine nicht für das, was claude selbst tut (Bash/Edit/Write). Ein Agent dort kann jede Vault-Datei ändern, auch Stadtordnung, Skills, Gedächtnis und Persönlichkeit.
  - Er hat Internet, das Abo-Token und ein GitHub-Token. Eingeschleuster Text (Webseite, README, Paket-Skript, Issue) kann ihn dazu bringen, Privates hinauszutragen oder Code zu pushen und zu mergen.
  - Was bleibt: eigener Container, eigenes Netz, eigene Geheimnisse, kein root, `werkzeug_log` (Befehle, geschriebene Pfade), die Regeln in `Codehaus/gebaeude.md` sowie Branch-Schutz und Token-Zuschnitt bei GitHub (Leifs Sache).
- **Container `coding`** (`apps/coding/`):
  - **Inhalt:** openvscode-server 1.109.5 (MIT, sha256 im Dockerfile), Node 24, Python 3, git, gh, build-essential, claude-CLI in derselben Version wie die Werkstatt (ein Test prüft die Gleichheit).
  - **Schutz:** nur lesbar, DORF_UID, `cap_drop ALL`, `no-new-privileges`, 2 GB (`CODING_MEM`), halbes CPU-Gewicht, 1024 Prozesse.
  - **Eingehängt:** `/srv/dorf/coding` → `/arbeit`, Vault → `/vault` (rw).
  - **Netz `codingnetz`:** nur Caddy, Dorf und Coding.
  - **Geheimnisse:** `coding.env` enthält `CODING_GEHEIMNIS`, `VSCODE_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN`, `GIT_NAME`, `GIT_EMAIL`. Das GitHub-Token liegt in keiner Datei im Container (git fragt `gh auth git-credential`).
- **Runner:**
  - Derselbe wie in der Werkstatt, das Profil kommt aus `RUNNER_PROFIL=coding`. Das legt der Container fest, nie der Auftrag.
  - Coding-Profil: `--tools default`, `--permission-mode bypassPermissions`, `--setting-sources user,project`, `--add-dir /vault`, nur der MCP-Server „dorf“. Arbeitsordner `/arbeit/<projekt>` (geprüft), eigene Prozessgruppe.
  - Das Werkstatt-Profil bleibt unverändert streng.
- **Motor `coding`:**
  - `parallel.coding`: Standard 1, höchstens 3, 0 = aus.
  - Nur für Aktionen im Gebäude Codehaus. App-Formular und `aktion_anlegen` kennen ihn nicht.
  - Der Notschalter `alle_auf` ist nie „coding“ und verlegt Coding-Läufe nicht.
- **Bürgermeister:**
  - Startet Coding-Helfer über die Aktion `programmieren`.
  - Hat die Aufgabe etwas von außen gesehen, startet der Helfer erst nach Leifs Klick. Ein Plan mit Coding-Teil wird dann vorgelegt und nicht automatisch angenommen. Was als „von außen“ zählt, steht seit dem Review in E195.
  - Grund: „präparierte Mail → Bürgermeister → Shell mit Vault und GitHub“ soll nicht ohne Rückfrage durchgehen. Ohne Fremdinhalte startet er sofort.
- **Zugang `code.<Dorf-Adresse>`:**
  - Eigener Ursprung: Das Sitzungs-Cookie des Dorfs erreicht den Container nie.
  - DuckDNS löst Unteradressen von selbst auf (geprüft). `CODING_DOMAIN` übersteuert die Adresse.
  - Ablauf:
    1. `GET /api/coding/oeffnen` (mit Dorf-Sitzung) gibt eine Einmal-Karte (60 s, einmalig).
    2. `code.…/_dorf/eintritt` setzt das Cookie `dorf_coding` (HttpOnly, nur Hash in der DB, höchstens 7 Tage, gilt nur, solange die Dorf-Sitzung besteht).
    3. Weiter zu VS Code mit dessen Verbindungs-Token.
  - Caddy prüft jede Anfrage per `forward_auth` gegen `dorf:3001/intern/coding/zugang`. Die Prüfung liegt auf dem internen Port, weil `@fastify/websocket` auf dem öffentlichen Port Upgrade-Anfragen an normale Routen mit 101 beantwortet.
  - Verworfen: Port 8443 (Cookies gelten für alle Ports) und der Pfad `/code/` (gleicher Ursprung wie die App).
- **Gebäude:** `Codehaus/` mit den Aktionen `programmieren`, `repo-klonen` und `pr-pruefen`, ergänzt über `PFLICHT_DATEIEN`. Die App zeigt Projekte, „VS Code öffnen“ und die Coding-Chats. Das Codehaus hat ein eigenes 3D-Modell.
- **Deploy:**
  - Compose-Profil `coding`, aktiv nur mit `CODING_VERSION` und `CODING_AN=ja` (gesetzt von `dorf coding-einrichten`; `dorf coding-aus` hält an).
  - Das Image wird nur gebaut und ausgeliefert, wenn das Codehaus auf dem Server eingeschaltet ist und das Image dort fehlt (`hat-coding`: ja / nein / aus, E195).
  - Fehler im Codehaus blockieren weder den Deploy noch die Gesundheitsprüfung.
  - `/srv/dorf/coding` ist in der Sicherung.
- **Offen:**
  - Vorschau von Dev-Servern.
  - Speicherbedarf auf dem echten Server messen.
  - (`trustProxy` ist mit E195 erledigt.)

## E194 – Spracheingabe am Cardputer: Server-Teil (19.11.)

- `POST /api/geraet/sprache` (nur mit dem Geräte-Schlüssel): WAV im Körper (16 kHz, mono, 16 Bit, höchstens 2 MB ≈ 60 s) → `{ text }`.
- Abgeschrieben wird mit whisper.cpp im Rechenraum über `/umwandeln` (E190), ohne Cloud. Das Dorf gibt nur den Transkript-Abschnitt zurück, ohne Geräusch-Marken. Die Aufnahme wird nicht gespeichert.
- Fehler: 503 ohne Rechenraum, 400 kein WAV, 413 zu groß. Die Firmware (1.2) fügt den Text an der Schreibmarke ein, abgeschickt wird erst mit Enter.
- **Firmware 1.2:**
  - **Bedienung:** In jeder Texteingabe startet `Tab` die Aufnahme, `Tab` oder `Enter` stoppt, `Esc` verwirft. Es wird umgeschaltet statt gehalten, weil `fn`+Leertaste kein Zeichen liefert und die App keine Loslass-Ereignisse bekommt. Passwort-, Netznamen- und Adressfelder haben keine Sprache.
  - **Nichts geht von selbst raus:** Der Text wird ans Feld gehängt, abgeschickt wird erst mit Enter. Neu auf der Startseite: „Sprechen → Bürgermeister“.
  - **Mikrofon:** Cardputer Adv mit Codec ES8311 über I2S (M5Unified 0.2.29, Beispiel `mic_wav_record`). Mikrofon und Lautsprecher teilen sich Leitungen, deshalb ist der Lautsprecher während der Aufnahme aus.
  - **Speicher:** Aufgenommen wird in eine Datei statt ins RAM (drei Puffer, SD-Karte, sonst LittleFS mit etwa 40 s), danach stückweise hochgeladen. Höchstens 60 s.
  - **Upload:** direkt über TLS mit 120 s Wartezeit (`HTTPClient` bricht nach 65 s ab).
  - **Einstellungen bleiben:** NVS-Schlüssel, Formate und Partitionen sind unverändert, neu ist nur `mikro`. Update mit der Nur-Programm-Datei an 0x10000.
  - **Tests:** Host-Test mit 177 Prüfungen, das Mikrofon ist als WAV-Datei nachgestellt. Nie am Gerät erprobt.

## E195 – Review zu E190–E194 (19.11.)

Ein unabhängiger Review hat Lücken gefunden. Jede ist behoben und hat einen Test, der den Fehler vorher zeigt.

- **Symlink-Wettlauf im Vault (kritisch):**
  - **Lücke:** `absolut()` prüfte einen Pfad einmal, danach folgten `stat`/`readFile` Symlinks. Seit E191 schreibt ein Agent mit Shell in den Vault: Er konnte eine Datei in einer Schleife gegen einen Symlink auf `/proc/self/environ` tauschen und per `vault_lesen` die Schlüssel des Dorfs lesen, oder beim Schreiben einen Ordner nach draußen umbiegen.
  - **Lösung (`vault/pfade.ts`):** Jeder Zugriff geht Ordner für Ordner über Dateideskriptoren mit `O_NOFOLLOW` (auf Linux über `/proc/self/fd/<fd>/<name>`, das leistet dasselbe wie openat). Gelesen wird nur über den Deskriptor; geschrieben wird im geöffneten Zielordner (temporäre Datei mit `O_EXCL`, dann rename).
  - **Folge:** Symlinks im Vault werden nie mehr verfolgt, auch keine, die im Vault bleiben.
  - **Umgestellt:** alle Wege, die früher `vault.abs()` lasen: VaultDienst (lesen, roh, schreiben, verschieben, löschen, hochladen, Baum, Konflikte, Vorlage ergänzen), Anhänge, Suchindex, Gebäude- und Aktionsliste, Protokolle, Bank, Karteikarten, To-dos, Uni-Ordner, Rundgang. Der Dateiwächter folgt keinen Symlinks mehr.
  - **Nicht abgedeckt:** Hardlinks lassen sich so nicht erkennen. Sie gehen aber nur innerhalb desselben Dateisystems, und der Coding-Container sieht vom Server nur `/vault` und `/arbeit`. Die Werkstatt liest den Vault mit dem `Read` des claude-CLI, das Symlinks folgt; dort liegen aber nur ihr Abo-Token und ihr Runner-Geheimnis, kein Dorf-Schlüssel.
  - **Test:** `vault-symlink.test.ts` tauscht in einem eigenen Prozess pausenlos Datei bzw. Ordner gegen Symlinks. Mit dem alten Code kam das Geheimnis nach 38 ms heraus, und draußen entstanden 169 Dateien.
- **Freigabe vor Coding-Helfern ließ sich umgehen:**
  - **Lücke:** „Fremd“ galt nur, wenn ein Werkzeug des Bürgermeister-Chats etwas gelesen hatte. Nicht erfasst: weitergeleitete Telegram-Nachricht, Lagebericht/Rundgang beim Aufwachen, hochgeladene Anhänge, Ergebnisse von Helfern, Plan-Kette Web-Schritt → Coding-Schritt.
  - **Lösung:** neuer Merker `chats.fremd_beruehrt` (Migration 28). Gesetzt beim Laufstart, wenn der Auftrag eine Fremdinhalt-Hülle trägt oder ein Anhang hochgeladen, umgewandelt oder Fremdinhalt ist; und am Laufende, wenn ein Werkzeug Fremdes gelesen hat.
  - Für den Bürgermeister zählt die ganze Aufgabe: sein Chat und alle Helfer derselben Aufgabe.
  - Im Plan wartet ein Coding-Schritt auf Leif, wenn ein Vorgänger (auch über mehrere Stufen) Fremdes gesehen hat.
  - **Ausnahme, bewusst:** Coding-Helfer machen eine Aufgabe nicht „fremd“. Sie haben Shell, Internet und GitHub schon selbst; geschützt wird der Schritt von Agenten ohne Shell zu einem mit Shell. Sonst bräuchte jeder zweite Coding-Schritt einen Klick.
  - **Folge für Leif:** Beim Aufwachen startet der Bürgermeister Coding-Helfer nur noch mit Freigabe (der Lagebericht enthält Mail-Zusammenfassungen).
- **Hochgeladene Textdateien** (`…/anhaenge/…`) kommen über `vault_lesen` jetzt wie jedes andere Format in der Fremdinhalt-Hülle und stempeln den Lauf.
- **Speicher im Rechenraum:**
  - **Gemessen im Image** (whisper.cpp 1.8.7, `ggml-base-q5_1` = 56 MB Datei, 1 Thread): whisper belegt 197–208 MB und braucht 707–715 MB Adressraum; ffmpeg belegt 58 MB und braucht 690–738 MB Adressraum.
  - `RLIMIT_AS` begrenzt den Adressraum, nicht den belegten Speicher. Unter rund 740 MB bricht whisper ab und ffmpeg bleibt hängen. Die vorgeschlagenen 400–450 MB gehen deshalb nicht.
  - **Lösung:** Riegel je Umwandlung 1024 MB (statt 1536). `mem_limit` des Containers 1280 MB (statt 1 GB), gerechnet aus dem, was wirklich belegt wird: tmpfs 256 + 384, zwei Umwandlungen × 260, Runner und ein Befehl 120.
  - Reißt eine Umwandlung die Grenze, beendet der Kernel genau sie (`oom_score_adj` 1000), nie den Runner. Das Ergebnis gilt als vorübergehend und wird nicht gemerkt.
- **Rundgang:** Scheitert die Prüfung einer Aktivität, ist das kein Anlass mehr. Sie gilt nur als geprüft und wird gemeldet.
- **Aufwachen:** nie zwei gleichzeitig. Ein zweiter Aufruf (Zeitgeber + „Jetzt wecken“) wartet auf das laufende und bekommt dessen Bericht.
- **Spracheingabe:** 503, wenn nicht transkribiert wurde (whisper/Modell fehlt, Absturz, Zeitlimit, Rechenraum weg). 200 mit leerem Text nur, wenn wirklich nichts gesagt wurde.
- **Zwischenspeicher der Umwandlungen:** zusätzlich nach Größe begrenzt (300 MB), die ältesten Einträge fliegen zuerst.
- **X-Forwarded-For nur noch von Caddy:**
  - **Lücke:** `trustProxy: true` glaubte jedem. Werkstatt, Rechenraum, Browser und Coding-Container erreichen `dorf:3000` direkt und konnten so die Login-Drossel je IP umgehen oder Leifs Adresse aussperren.
  - **Lösung:** `VERTRAUTER_PROXY=caddy` (compose). Der Name wird über den DNS des Docker-Netzes aufgelöst, alle 30 s erneuert und bei einer unbekannten Adresse sofort nachgesehen (`proxy.ts`). Alle anderen zählen mit ihrer echten Adresse im Docker-Netz; die lässt sich dort ohne `CAP_NET_RAW` nicht fälschen.
  - Verworfen: ein eigenes Netz mit festem Adressbereich (kann mit vorhandenen Netzen des Servers zusammenstoßen).
- **Abmelden kappt offene VS-Code-Verbindungen:**
  - VS Code lauscht nur noch im Container selbst (Port 3100). Nach außen führt ein Tor im Runner (Port 3000, reine Durchleitung), das alle Verbindungen kennt.
  - Endet eine Sitzung, die VS Code geöffnet hatte, ruft das Dorf `POST /vscode/trennen`. Wer noch angemeldet ist, verbindet sich von selbst neu; Terminals laufen weiter.
  - Nicht erfasst: Sitzungen, die durch Zeitablauf oder über die Konsole (`dorf sitzungen-beenden`) enden. Dort hält eine offene Verbindung bis zum nächsten Neuverbinden.
- **Deploy:**
  - `hat-coding` antwortet „aus“, solange `CODING_AN=ja` fehlt. Die CI baut und überträgt das Image dann nicht; ältere dorf-Skripte zählen ebenfalls als „aus“. `dorf empfangen` lädt ein mitgeschicktes Image nicht, wenn das Codehaus aus ist.
  - `dorf coding-einrichten` geht jetzt ohne Image: Es richtet alles ein und sagt, dass das Image mit dem nächsten Deploy kommt. Danach startet das Codehaus von selbst.
  - `coding.env` wird als Datei eingehängt und von `start.sh` gelesen (nur die sechs bekannten Namen, Werte wörtlich). Die frühere Form `env_file` mit `required: false` braucht Compose ≥ 2.24; ob der Server das hat, ließ sich von hier nicht prüfen.


## E196 – Codehaus: „VS Code öffnen“ zuverlässig (20.11.)

- **Problem 1:** Der Knopf war ein einfacher Link mit `target=_blank`. Im Programm landet ein neues Fenster im normalen Browser, der keine Dorf-Sitzung hat. Fehler blieben unsichtbar.
- **Lösung 1:** Die App holt die Einmal-Adresse als JSON (`/api/coding/oeffnen?json=1`) und öffnet genau sie.
  - Im Browser öffnet sie einen sofort geöffneten Tab, wegen des Popup-Schutzes.
  - Im Programm öffnet sie nur einmal `window.open`, das an den normalen Browser geht.
  - Fehler stehen neben dem Knopf.
- **Problem 2:** Im Programm wurde die Adresse zweimal geöffnet (`window.open` und `location.href` → `on_navigation`). Der zweite Aufruf fand die Karte verbraucht und meldete „Dieser Link gilt nicht (mehr)“.
- **Lösung 2:** Nur noch `window.open`. Zusätzlich: Ist die Karte verbraucht, der Browser hat aber schon ein gültiges `dorf_coding`-Cookie, geht es direkt zu VS Code. Die Karte bleibt einmalig, ein erfundenes Cookie hilft nicht.

## E197 – Editor im Codehaus (20.11.)

Leif: „eine eigene Coding-Umgebung innerhalb der App, die einfach wie VS Code ist – alles aber nativ in der App“. VS Code im Browser (E191) bleibt daneben bestehen (Erweiterungen, Debugger); neu ist eine Seite der Dorf-App: `/codehaus/editor` (Codehaus → Reiter „Editor“).

- **Was es gibt:**
  - **Editor:** Monaco (MIT, das Editor-Herz von VS Code) mit Reitern, Marke für Ungespeichertes, Strg+S, Suchen/Ersetzen, Minimap, Thema „Dorf hell“ und dunkel (gemerkt).
  - **Dateibaum** der Projekte unter `/arbeit`: öffnen, neu, umbenennen, löschen (mit Rückfrage), hochladen, herunterladen; Projekt anlegen.
  - **Suche:** Strg+P über Dateinamen, Volltext mit ripgrep.
  - **Git-Leiste:** Status, Vergleich mit dem letzten Commit im Diff-Editor, vormerken/verwerfen, Commit, Push/Pull/Fetch, Branch wechseln und anlegen.
  - **Terminal:** xterm.js (MIT), mehrere gleichzeitig, Größe folgt dem Fenster.
  - **Coding-Agent daneben:** startet die vorhandene Aktion `Codehaus/programmieren` für das offene Projekt; der Chat steht in der Leiste. Nach dem Lauf werden offene Dateien neu geladen, die geänderten Dateien stehen zum Anklicken bereit.
  - **Handy:** immer ein Bereich sichtbar (Dateien, Suche, Git, Agent, Editor, Terminal), Leiste unten.
- **Weg der Daten:** Browser → Dorf (`/api/coding/editor/*`, WebSocket `/api/coding/terminal`) → Runner im Coding-Container (Profil coding, Runner-Geheimnis). Der Browser spricht nie selbst mit dem Container; es gibt kein neues Geheimnis und keine neue Adresse.
  - Das Dorf prüft Sitzung und Herkunft wie bei jeder anderen Route (keine Ausnahme), dazu Projektname und Pfad. Der Runner prüft alles noch einmal.
  - Im Werkstatt-Profil gibt es diese Endpunkte nicht (404, getestet).
- **Dateizugriff im Runner (`apps/werkstatt/src/editor.ts`), gleiche Sorgfalt wie E195:**
  - Pfade nur relativ unter `/arbeit/<projekt>`: kein `..`, kein absoluter Pfad, keine leeren Teile, keine Steuerzeichen.
  - **Symlinks werden nie verfolgt** (Ordner für Ordner über Deskriptoren mit `O_NOFOLLOW`, auch ein Projekt, das selbst ein Link ist). Grund: Im Projekt arbeiten Agenten mit Shell; ein untergeschobener Link soll den Editor weder zum Lesen noch zum Schreiben hinausführen. Folge: Links zeigt der Baum an, öffnen lässt sie nur das Terminal. Ein Wettlauf-Test tauscht eine Datei pausenlos gegen einen Link.
  - `.git` ist über den Editor nicht erreichbar (Hooks und Konfiguration ändert man bewusst im Terminal).
  - Grenzen: Text bis 2 MB, Hochladen bis 20 MB je Datei, Herunterladen bis 200 MB. Binärdateien nur als Download; das Dorf liefert sie als Anhang mit `Content-Security-Policy: sandbox` aus.
  - Speichern mit `basisVersion` (sha256 des geladenen Stands): Hat inzwischen ein Agent oder das Terminal die Datei geändert, kommt 409 und nichts wird überschrieben. Der Editor fragt dann: neu laden oder die eigene Fassung speichern. Geschrieben wird atomar, die Dateirechte bleiben.
  - Löschen verschiebt nach `/arbeit/.papierkorb/<projekt>/` (14 Tage) – wie der Papierkorb im Vault.
- **Git und Suche:** nur feste Befehle mit Argumentlisten, nie über eine Shell. Branch-Namen und Pfade sind geprüft, die Commit-Nachricht geht über die Standardeingabe, der Suchtext hinter `-e`. Pull nur `--ff-only`, kein force-push; alles andere macht Leif im Terminal. Fehler von git stehen als Ausgabe in der Leiste. `gh` braucht die Leiste nicht: git holt das Token wie bisher über `gh auth git-credential`.
- **Terminal ohne natives Modul:**
  - Node kann kein Pseudo-Terminal öffnen; `node-pty` müsste im Image gebaut werden. `script` kann die Größe nicht nachträglich ändern.
  - Gewählt: ein kleiner Helfer aus Pythons Standardbibliothek (`pty.fork`, `TIOCSWINSZ`), gestartet mit `python3 -c` – Python ist im Image schon da, es kommt keine Datei dazu. Getestet gegen ein echtes PTY (`test -t 0`, `stty size`).
  - Dorf ↔ Runner ohne WebSocket-Bibliothek: Die Ausgabe ist der Antwortstrom eines POST, Eingaben sind kleine POSTs, die das Dorf streng der Reihe nach schickt.
  - Die Shell bekommt dieselbe Umgebung wie der Agent (GitHub-Token ja, Runner-Geheimnis und VS-Code-Token nie). `bash` ohne `-l`, weil `/etc/profile` den PATH des Images ersetzen würde.
  - Eine Verbindung = eine Shell: Schließt man das Terminal oder lädt die Seite neu, endet sie. Wer etwas lange laufen lassen will, nimmt `nohup`/`tmux` oder VS Code.
  - **Abmelden kappt** die Terminals dieser Sitzung sofort (wie E195 bei VS Code); der Runner beendet dann die Shell. Wie dort nicht erfasst: Sitzungen, die durch Zeitablauf enden.
  - Höchstens 8 Terminals.
- **Was das am Risiko ändert:** nichts Grundsätzliches. Wer im Dorf angemeldet ist, hatte über VS Code schon Shell und Dateien im Coding-Container (E191). Neu ist nur, dass dieselbe Macht jetzt auch am Ursprung der Dorf-App hängt: Ein Fehler in der App (XSS) reichte dann bis zur Shell im Codehaus. Dagegen stehen die CSP der App, `SameSite=Strict` und die Herkunftsprüfung. Dateiinhalte aus Projekten zeigt nur Monaco (als Text) – nie als HTML.
- **Größe:** Monaco, Sprachen, Worker und xterm liegen in `assets/editor/` (rund 16 MB ohne Quelltext-Karten, die für diesen Ordner entfallen) und werden nur auf der Editor-Seite geladen. Der PWA-Vorrat lässt den Ordner aus; der Start der App bleibt gleich groß.
  - TypeScript/JavaScript: nur Syntaxprüfung. Der Editor sieht einzelne Dateien, nicht `node_modules`; eine Typprüfung würde jede Import-Zeile rot färben. Typen prüft `tsc` im Terminal.
  - Monaco läuft mit dem klassischen Eingabefeld (`editContext: false`), damit die Tastenkürzel der App („n“, „f“ …) es als Texteingabe erkennen.
- **Deploy:** Der Runner steckt im Coding-Image; dessen Kennung hängt an `apps/werkstatt/src/*.ts`. Ist das Codehaus eingeschaltet, baut und liefert die CI das neue Image mit demselben Deploy. Trifft der Editor noch auf ein altes Image, sagt er das („kommt mit dem nächsten Deploy“) statt zu scheitern.
- **Tests:** Runner (echter Runner im Profil coding und im Werkstatt-Profil), Dorf-Routen vor dem echten Runner (401, Herkunft, Pfad-Tricks, Symlinks, Größen, Terminal über WebSocket, Kappen beim Abmelden), Browser (Desktop + Handy) über die Attrappe, die an den echten Runner weiterreicht. Die Tests brauchen `ripgrep` (in der CI ergänzt).
- **Nicht gebaut / offen:**
  - Vault-Dateien im selben Editor (war optional) – dafür gibt es die Bibliothek.
  - Kein Sprachserver über Dateien hinweg, kein Debugger, keine Erweiterungen: dafür bleibt VS Code.
  - Pull Requests anlegen: im Terminal (`gh pr create`) oder über den Agenten.
  - Abnahme auf dem Server und an Leifs Handy steht aus.

## E198 – Atelier: Bildbearbeitung in der App (20.11.)

- **Wunsch (Leif):** „Jemand hat mit AI Adobe Photoshop kostenlos nachgebaut. Kannst du das implementieren? Alles aber nativ in der App.“ Gemeint ist vermutlich ArtCraft/PhotoCraft – ein Desktop-Programm in Rust im frühen Alpha, das sich nicht in eine Web-App einbetten lässt. Darum ein **eigener Bildeditor** in der Dorf-App.
- **Wo:** neues Gebäude **Atelier** (🎨, Vorlage, eigenes 3D-Modell, Reiter „Bilder“), Editor auf `/atelier`. Die Bibliothek bekommt „Im Atelier bearbeiten“.
- **Grundlage: Canvas 2D des Browsers, keine Bibliothek.**
  - Geprüft: Konva und Fabric.js (beide MIT) sind Szenengraphen für Objekte – Pinsel mit Härte, Zauberstab, Pixelfilter und Rasterebenen müsste man trotzdem selbst bauen, zahlt aber 150–300 KB. PixiJS (MIT) ist ein WebGL-Renderer; Pixel zurückzulesen (Filter, Füllen, Speichern) ist dort der teure Weg. miniPaint (MIT) ist ein ganzes Programm mit eigener Oberfläche und eigenem Dateidialog, kein Baustein für React, den Vault und die Handy-Bedienung.
  - Canvas 2D bringt alles Nötige mit: 16 Mischmodi (`globalCompositeOperation`), Pixelzugriff, Zeigerereignisse mit Stiftdruck.
  - Ergebnis: 29 KB (gzip), nur auf dieser Seite geladen; keine neue Abhängigkeit, keine GPL.
  - Die Einschätzung der Bibliotheken stammt aus meinem Wissen über sie, nicht aus einer frischen Messung.
- **Was der Editor kann:**
  - Ebenen: neu, duplizieren, löschen, Reihenfolge, Deckkraft, Sichtbarkeit, 16 Mischmodi, vereinen, reduzieren, umbenennen.
  - Werkzeuge: Pinsel und Radierer (Größe, Härte, Deckkraft, Stiftdruck), Formen, Text, Auswahl (Rechteck, Ellipse, Lasso, Zauberstab; hinzufügen/abziehen), Verschieben, frei Transformieren (skalieren, drehen, spiegeln), Zuschneiden, Pipette, Füllen, Verlauf, Zoom, Hand.
  - Bild: Bildgröße, Arbeitsfläche, drehen, spiegeln; Helligkeit/Kontrast, Farbton/Sättigung, Belichtung, Kurve (Tiefen/Mitten/Lichter), Graustufen, Invertieren, Sepia, Schwellenwert; Weichzeichnen, Schärfen, Rauschen – mit Vorschau, auf Wunsch nur in der Auswahl.
  - Verlauf mit 40 Schritten (unveränderte Ebenen werden zwischen den Schritten geteilt, Speichergrenze), Tastenkürzel wie in Photoshop, am Handy ein Finger = Werkzeug, zwei Finger = Zoomen/Verschieben.
- **Bewusst nicht (steht auch in der Hilfe im Editor):** Text ist nach dem Setzen ein Bild; keine Einstellungsebenen, Ebenenmasken, Smartobjekte, CMYK, PSD. Was beim Verschieben über den Bildrand geschoben wird, ist weg.
- **Dateien:**
  - Öffnen aus dem Vault und vom Gerät. Was der Browser nicht lesen kann (HEIC, TIFF, SVG), wandelt nur der Rechenraum um.
  - Speichern nur über `/api/atelier/speichern` → `VaultDienst.schreiben` mit `basisVersion`: Hat sich die Datei inzwischen geändert, entsteht eine Konfliktkopie. Erlaubt sind PNG, JPG, WebP und `.atelier`; der Inhalt muss zur Endung passen; höchstens 60 MB.
  - **Projektformat `.atelier` = eine ZIP-Datei** (unkomprimiert, `projekt.json` + je Ebene ein PNG + Vorschau). Begründung: Eine Datei bleibt atomar und die Konfliktkopie gilt fürs ganze Projekt; ein Ordner mit Einzeldateien könnte halb geschrieben oder von Syncthing halb übertragen sein. PNG ist schon komprimiert, darum reicht „store“ – ohne Bibliothek, und jedes ZIP-Programm kommt an die Ebenen.
  - Ungespeichertes bleibt offen, wenn man im Dorf woanders hingeht; beim Schließen des Fensters warnt der Browser.
- **KI ohne Kosten, im Rechenraum (`/bild`, ohne Internet):**
  - Hintergrund entfernen: U²-Net „u2netp“ (4,6 MB, Apache-2.0). Hochskalieren 2×/4×: Real-ESRGAN „general-x4v3“ (4,8 MB, BSD-3-Clause, ONNX von Qualcomm AI Hub) in Kacheln. Laufzeit: onnxruntime 1.19.2 (MIT), nur CPU. Alle drei mit fester Version bzw. Prüfsumme im Dockerfile.
  - rembg selbst verworfen (zieht viele Pakete nach) – die Vor- und Nachbereitung steht in `runner.py`.
  - **Gemessen** (onnxruntime 1.19.2, numpy 1.24.2, Python 3.11 wie im Image, 1 Kern, außerhalb des Containers): u2netp belegt 349 MB und braucht 0,6 s; Real-ESRGAN 76 MB und 0,36 s je Kachel (1024×1024 ≈ 30 s). Unter dem Riegel von 1024 MB Adressraum laufen beide.
  - Eine Bildbearbeitung belegt **beide** Umwandlungs-Plätze (2 × 260 MB), und es läuft immer nur eine: Die Rechnung für `mem_limit: 1280m` aus E195 bleibt gültig. Bilder bis 24 Megapixel, Hochskalieren bis etwa 1024×1024.
  - Ehrlich: u2netp findet das Hauptmotiv, feine Haare und Glas nicht zuverlässig. Fehlt ein Modell im Image, sind die Menüpunkte ausgegraut und nennen den Grund.
- **Bild generieren / generatives Füllen (optional):** Cloudflare Workers AI, `@cf/black-forest-labs/flux-2-klein-4b` (Text → Bild und Bild + Text → Bild, 256–1920 Pixel).
  - Frei sind 10 000 Neuronen pro Tag; ein Bild 1024×1024 kostet rund 104 → etwa 90 Bilder. Ohne Bezahlplan lehnt Cloudflare danach ab, Kosten entstehen nicht.
  - Zugang nur in `/srv/dorf/.env` (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) über `dorf bilder-einrichten`; ohne ihn ist der Knopf ausgegraut mit genau diesem Hinweis.
  - „Generatives Füllen“ ist kein Masken-Inpainting: Der Ausschnitt um die Auswahl geht (höchstens 504 Pixel groß) mit dem Text ans Modell, das Ergebnis kommt als neue Ebene nur innerhalb der Auswahl zurück. Das Inpainting-Modell von Cloudflare (Stable Diffusion 1.5) ist laut Modellliste zum 20.11.2026 abgekündigt.
  - FLUX.1 schnell wäre billiger (58 Neuronen), nimmt laut Schema aber weder Bildgröße noch Vorlage.
  - Das ist der einzige Weg, auf dem im Atelier etwas das Dorf verlässt – nur auf Leifs Klick. **Agenten haben dafür kein Werkzeug.**
  - **Nicht geprüft:** Es gab keinen Cloudflare-Zugang. Endpunkt, Felder und Preise stammen aus der Dokumentation; die Tests laufen gegen einen nachgebauten Endpunkt. Dass die Antwort das Bild als Base64 unter `result.image` trägt, ist eine Annahme nach der üblichen Hülle der REST-API – der Code nimmt auch `image` direkt und rohe Bilddaten. Auch die Prüfadresse in `dorf bilder-einrichten` (Modellliste) ist nicht gegen ein echtes Konto gelaufen; bei unerwarteter Antwort trägt der Befehl den Zugang trotzdem ein.
- **Agenten: `bild_bearbeiten`** (`agenten/bild.ts`): zuschneiden, Größe, drehen, spiegeln, Format, Hintergrund entfernen, hochskalieren, einfache Korrekturen.
  - Nur mit `werkzeuge: [rechenraum]` (der Bürgermeister hat es); gerechnet wird im Rechenraum.
  - Das Original bleibt. Das Ergebnis ist eine neue Datei im Ablage-Ordner des Chats, den der Code bestimmt (wie `rechenraum_ablegen`); fremde Dateien werden nie überschrieben.
  - Der Lauf bekommt eine Vorschau und gilt danach als „hat Fremdes gesehen“ (wie bei `vault_lesen` mit Bildern, E195).
  - Dazu die Aktion `Atelier/bild-bearbeiten`.
- **Quellen (20.11.2026):** cloudflare/cloudflare-docs auf GitHub (`workers-ai/platform/pricing.mdx`, Changelog „FLUX.2 [klein] 4B“ vom 15.01.2026, Modell-Schemata); huggingface.co/qualcomm/Real-ESRGAN-General-x4v3 (`release_assets.json`); github.com/danielgatis/rembg (Release v0.0.0, `u2netp.onnx`); onnxruntime 1.19.2 auf PyPI. developers.cloudflare.com war von hier nicht erreichbar.
- **Offen:** Das Rechenraum-Image wurde hier nicht gebaut (Vorgabe: kein Docker) – die neuen Zeilen im Dockerfile prüft erst die CI samt Rauchtest. Ist eine Modellquelle beim Bau nicht erreichbar, baut das Image trotzdem und der Runner meldet „Modell fehlt“. Stift mit Druck und echte Finger-Gesten sind nur mit nachgebauten Zeigerereignissen getestet.

## E199 – Neue Werkzeuge aus der Ideen-Liste (20.11.)

- **Auftrag:** Aus `docs/werkzeug-ideen.md` (Top 15 + Nutzen für Leif) bauen, was sauber mit Tests geht. Schon da waren Umwandeln/OCR/Transkript und Office erzeugen (E190) und Websuche. Bildbearbeitung (E198), Code-Editor (E197) und Rundgang (E200) bauen andere.
- **Zwölf neue Dorf-Werkzeuge** (beide Motoren; die Werkstatt bekommt sie über `intern.ts`). Code in eigenen Dateien (`agenten/leine-extra.ts`, `werkzeuge-extra.ts`, `extra-quellen.ts`), in `leine.ts`, `werkzeuge.ts`, `dienst.ts`, `kontext.ts` nur kleine Haken:
  - **Rechenraum** (wer den Rechenraum hat, auch der Bürgermeister): `pdf_bearbeiten` (info, zusammenfügen, teilen, drehen, löschen, ordnen, komprimieren, Wasserzeichen, Formular lesen/ausfüllen), `diagramm_zeichnen` (Graphviz → SVG/PNG/PDF), `daten_abfragen` (SQL mit DuckDB über CSV/Excel/ODS/JSON/Parquet; „;“-CSV mit Dezimalkomma und Tausenderpunkt wird zu Zahlen), `qr_code` (segno), `karten_anki` (`karten.md` → `.apkg` mit genanki; feste IDs/GUIDs, erneuter Import aktualisiert).
  - **Netz – nur Läufe mit Web** (Bürgermeister immer): `literatur_suchen` (Crossref, arXiv, Open Library), `doi_bibtex` (doi.org, mit `merken` → `Uni/literatur.bib`, jede DOI einmal, alte Fassung ins Archiv, „Rückgängig“), `verbindung_suchen` (Transitous/MOTIS 2), `wetter_vorhersage` (Open-Meteo, bis 16 Tage).
  - **Alltag – alle:** `feiertage` (AT bundesweit + Baden-Württemberg, lokal gerechnet), `umrechnen` (Einheiten lokal, Währungen zum EZB-Referenzkurs).
  - **Post:** `post_anhang_lesen` (Gmail `attachments.get`, Ablage `Post/anhaenge/<Tag>_<Mail>/`, Lesen wie `vault_lesen` → Hülle). `post_lesen` nennt jetzt die Anhänge.
- **Warum diese Einstufung:** Wer Suchwörter oder Orte frei bestimmt, kann Privates hinausschicken – das ist derselbe Abflussweg wie die Websuche, darum dieselbe Regel (nur mit `web`). `umrechnen` holt nur die feste EZB-Tabelle (kein Text des Agenten geht hinaus), `feiertage` rechnet lokal – beides für alle. Nichts davon sendet, zahlt, bucht oder reicht ein.
- **Rechenraum: `dorfwerk.py` über `/werkzeug`** statt Shell-Befehlen: JSON-Auftrag, Kindprozess mit den Regeln einer Umwandlung (eigene Sitzung, `oom_score_adj` 1000, eines nach dem anderen, 120 s). Adressraum 1536 MB statt 1024: DuckDB 2.0 reserviert beim Start rund 1,3 GB Adressraum, belegt aber nur ~80 MB (gemessen: VmPeak 1 372 MB, VmHWM 80 MB, unter 1 300 MB Absturz); belegter Speicher ist mit `memory_limit 256MB` begrenzt. Nach dem Laden der Tabellen `enable_external_access = false` – Abfragen lesen keine anderen Dateien (getestet: fremder Raum, `COPY … TO`). `mem_limit 1280m` bleibt; nur wenn alles gleichzeitig voll läuft, trifft der Kernel ein Werkzeug oder eine Umwandlung, nie den Runner.
- **Ergebnisse** landen im Ablage-Ordner des Chats (wie `rechenraum_ablegen`, Leif sieht sie als Download) und im Arbeitsordner (`rechenraum:<name>` für den nächsten Schritt). Eine fremde Datei gleichen Namens wird nie überschrieben (`_2`). Formularfelder/Tabellen aus hochgeladenen Dateien oder dem Arbeitsordner kommen in die Hülle.
- **Pakete** (Image, feste Version mit Prüfsumme über `pip --require-hashes`, ohne Nachladen): pypdf 7.1.1, segno 1.6.6, genanki 0.13.1 (+ chevron, cached-property, frozendict), duckdb 2.0.0; aus Debian: graphviz, ghostscript, python3-pandas, python3-yaml. Die Image-Kennung der CI umfasst jetzt `dorfwerk.py`.
- **Schnittstellen per Abruf geprüft (20.11.2026),** Antworten als Testdaten in `test/fixtures/e199/`: Crossref `works?query.bibliographic`, arXiv Atom, Open Library `search.json`, doi.org mit `Accept: application/x-bibtex`, Transitous `/api/v1/geocode` + `/api/v5/plan` (MOTIS v2.11.4; Konstanz → Linz liefert echte Verbindungen über St. Gallen/München/Salzburg bzw. Nightjet), Open-Meteo Geocoding + Forecast, EZB `eurofxref-daily.xml`. Alle ohne Schlüssel. User-Agent `Agentendorf/<Version> (privat, nicht kommerziell; +<Dorf-Adresse>)` – Transitous verlangt Name, Version und Kontakt.
- **Nicht gebaut und warum:**
  - **Mermaid als Bild:** mermaid-cli braucht Chromium (~300 MB) im Rechenraum; es gibt keinen geprüften Renderer ohne Browser. Mermaid bleibt ein Block in der Notiz (Obsidian zeigt ihn an); das Werkzeug erkennt Mermaid und sagt das.
  - **OpenAlex** (Schlüssel seit 02/2026), **Semantic Scholar** (geteiltes Limit ohne Schlüssel) – Crossref + arXiv + Open Library reichen ohne Konto.
  - **Übersetzen:** DeepL braucht Schlüssel und Kreditkarte; kurze Texte übersetzt das Modell selbst.
  - **db-vendo/ÖBB-HAFAS:** inoffiziell, niedriges Limit bzw. ungeklärt – Transitous deckt DB, ÖBB und SBB ab.
  - **Kalender-ICS, ZIP, Pint:** ICS und ZIP baut der Rechenraum schon mit Python (`icalendar` nicht nötig, `python3 -m zipfile`); Einheiten rechnet `umrechnen` ohne Paket.
  - **Schulferien:** keine freie, geprüfte Quelle ohne Schlüssel; `feiertage` nennt nur gesetzliche Feiertage und sagt das.
- **Geklärt (20.11.): Das Repo ist öffentlich.** Transitous erlaubt die Nutzung für **quelloffene**, nicht kommerzielle Projekte mit wenig Last („light prototype testing“ ausgenommen). Das Dorf begrenzt sich auf 100 Verbindungssuchen am Tag (Transitous nennt 720). Ist das Repo privat, sollte Leif es entweder veröffentlichen oder `verbindung_suchen` aus `EXTRA_NETZ` (`leine-extra.ts`) nehmen.
- **Tests:** `e199-werkzeuge.test.ts` (Leine, Prompt, Feiertage, Einheiten, EZB mit Zwischenspeicher, Literatur mit ausfallender Quelle, BibTeX mit Rückgängig, Transitous mit Ortszeit/Sommerzeit und Tagesgrenze, Wetter, Gmail-Anhänge), `e199-rechenraum.test.ts` (echter Runner: PDF, Fremdinhalt, Daten, QR ohne Inhalt im Protokoll, Anki + App-Route), `apps/rechenraum/test/test_dorfwerk.py` (alle Arten, Grenzen, DuckDB liest keine fremden Dateien), Rauchtest im Image, Browser-Test „Für Anki“. Fehlende Python-Pakete werden lokal übersprungen; mit allen Paketen (pip in einen eigenen Ordner, `PYTHONPATH`) liefen alle Python- und Server-Tests grün. `test/strict-grenzen.test.ts` unverändert grün – nur `pdf_bearbeiten` ist (wegen freier Formularfelder) nicht strict.

## E200 – Rundgang komplett (20.11.)

- **Wunsch (Leif):** die restlichen Aktivitäten aus `docs/buergermeister-aktivitaeten.md` umsetzen, soweit sinnvoll.
- **22 neue Aktivitäten** in `apps/server/src/rundgang-aktivitaeten.ts`, nach Nutzen sortiert (Rang bei Gleichstand): Wartet-auf nachfassen (Entwurf, mittel), Fristen aus Mails, Abgaben-Nachlese, Prüfungs-Countdown (mittel), Helfer gegenlesen, volle Tage, Dauer schätzen, Altklausuren-Lücken, neue Moodle-Inhalte (Helfer, nur mit Moodle-Browser), Wochenvorschau, Adressbuch, Gewohnheiten, Fach-Steckbriefe, Moodle-Downloads einsortieren, Tagesrhythmus, Monatsrückblick (mittel), Aufträge verdichten (mittel), Rathaus-Ablage, verwaiste Notizen, Tags, Newsletter, JKU-Fristen (Web, groß, nur tagsüber). Damit 40 von 50.
- **Kein Anlass zweimal:** Die Fakten-Sammler schließen aus, was schon erledigt ist – Marker in der To-do-Notiz („Nachfass-Entwurf JJJJ-MM-TT“, „Nachlese JJJJ-MM-TT“), vorhandene Datei (Wochenvorschau je KW, Rückblick je Monat, JKU-Notiz unter 25 Tagen), „seit dem letzten Lauf“ (Mails, Helfer, Countdown-Stufe, volle Tage). Sonst würde dieselbe Lage jeden Tag einen bezahlten Lauf auslösen.
- **Neun bleiben Ideen** (mit Grund in der Doku): Entwürfe nachfassen (kein Werkzeug „Entwurf noch da?“), Übersichtsseiten (Obsidian kann das), Persönlichkeit (braucht Leifs Klick), Noten (KUSSS nicht angebunden), Corps-Termine, Einkaufsliste und Depot (erledigen Aktionen mit eigenem Zeitplan), Reise Konstanz–Linz (Aufenthaltsort unbekannt, keine Buchungs-Schnittstelle), Fixkosten (Lastschriften laufen von selbst).
- **Leine unverändert:** nichts senden, zahlen, abgeben; Termine nie (nur Vorschläge in Notizen); außerhalb des Rathauses nur Leifs Listen (Notiz/Dauer am To-do, neue To-dos) und Entwürfe. Helfer nur bei „Moodle durchsehen“ und einem zweiten Versuch nach „Helfer gegenlesen“. Ein Test prüft, dass jede Aktivität nur Werkzeuge nennt, die der Bürgermeister hat.
- **Kosten:** `kosten_usd` (klein/mittel/gross) steht jetzt in `rundgang.md` statt nur als Konstante; die Protokollzeile in `Rathaus/rundgang/` zeigt die echten Kosten des Laufs (`laeufe.kosten_usd`). 17 der 22 neuen sind klein. Neu fix im Monat: JKU-Recherche ≈ 0,80 $ (beim ersten Rundgang am Tag mit vollem Budget gleich dabei).
- **Vorlage:** `rundgang.md` mit allen 40 und den Kosten; die Fassung aus E192 (sha256 `60d05e9a…`) wird beim Start ersetzt, geänderte Fassungen nicht (fehlende Einträge = Standard).

## E201 – Cardputer 1.3: Spracheingabe hört richtig zu und hängt nicht mehr (20.11.)

Leifs Befund mit 1.2: Der Pegel-Balken schlägt kaum aus, egal von welcher Seite er spricht; nach dem Stoppen (von Hand oder nach 60 s) hängt das Gerät und nichts wird abgeschickt.

- **Ursache leise:** M5Unified 0.2.29 (`_microphone_enabled_cb_cardputer_adv`) stellt den Codec ES8311 beim Cardputer Adv auf analoge Vorverstärkung 0 dB (REG14 = 0x10, im Quelltext „PGA GAIN (minimum)“) und ADC-Lautstärke 0 dB (REG17 = 0xBF). Für andere Geräte mit demselben Chip nimmt die Bibliothek +21 dB PGA (REG14 = 0x17, „SNR plateaus by this level“), +6 dB ADC (0xCB) und einen Hochpass (REG1C = 0x64) – `_microphone_enabled_cb_stopwatch`. Genau diese Werte setzen wir nach `Mic.begin()` per I2C nach. Die Einstellung Mikrofon leise/normal/laut wählt jetzt die ADC-Lautstärke (0/+6/+12 dB) statt der Software-Verstärkung der Bibliothek (die bleibt auf ihrer Vorgabe 16). Zusätzlich hebt der Server leise WAVs vor whisper an (`lautAngleichen`: Spitze ~70 %, höchstens ×16) – hilft auch Geräten, die noch 1.2 haben.
- **Pegel in dB:** Der Balken war linear (Sprache bei −30 dBFS = 3 %); jetzt −54…0 dBFS → 0…100 %, normale Sprache landet um die Hälfte. Neu gezeichnet alle 150 ms statt 500 ms.
- **Hängen:** Am PC nicht nachstellbar, darum alle Verdächtigen beseitigt statt einen erraten: Die Aufnahme-Aufgabe schaltete am Ende selbst den Codec um (`Mic.end`, `Speaker.begin`, I2C) – mit nur 4 KB Stack und parallel zur Hauptschleife. Jetzt nimmt sie nur auf und schreibt (8 KB Stack); umgeschaltet wird nur in der Hauptschleife. Jede Warterei hat eine Grenze (Puffer leeren 1,5 s, Stopp 4 s, Senden 90 s); hängt das Mikrofon, kommt „Aufnahme: Mikrofon antwortet nicht“ statt eines eingefrorenen Bildschirms, und die Hauptschleife räumt nach, sobald die Aufgabe doch fertig wird. Das Zeitlimit des Dorf-Kerns für eine Anfrage (30 s + Frist + 30 s = 180 s) war für Senden + Abschreiben zu knapp – bei Datei-Uploads kommen 90 s dazu; dahinter steht noch eine Wache der Eingabe (300 s).
- **Sichtbar:** „Sende Aufnahme … 45 %“ (Fortschritt aus der Netz-Aufgabe), danach „Schreibe ab … s“; Start/Stopp scheitern mit Grund.
- **Update ohne Neu-Einrichten:** Startlader und Partitionen (0x0–0x10000) sind Byte für Byte die von 1.2 (verglichen); gespeicherte Werte unverändert. Nur-Programm-Datei an 0x10000.
- **Geprüft:** Host-Test 184/184 (neu: Pegel einer −30-dBFS-Aufnahme ≈ 44 %, Start-/Stopp-Fehler mit Grund, Fortschritt, nie-antwortendes Netz → Meldung nach 4½ min), Server-Tests für `lautAngleichen`. Nie am echten Gerät gehört – die Register-Werte stammen aus dem Bibliotheks-Quelltext, nicht aus einer Messung am Cardputer.

## E202 – Review zu E199–E201 (20.11.)

Unabhängiges Review des Diffs E199–E201; behoben:

- **Fremdes über die Rechenraum-Werkzeuge (mittel):** `pdf_bearbeiten`/`daten_abfragen`/… erkannten Fremdes nur an `anhaenge/` oder `fremdinhalt: true` – PDF-Metadaten, Formularfelder, Excel aus Moodle kamen ohne Hülle zurück, der Lauf blieb ungestempelt (und damit ein Coding-Helfer ohne Freigabe möglich, E195). Neu `vaultDateiFremd` (anhaenge.ts): alles außer reinem Text, Hochgeladenes, `fremdinhalt: true|ja`, die Literaturliste. Gilt für die Dorfwerk-Werkzeuge und jetzt auch für `rechenraum_vault_kopieren` (stempelt den Lauf, weil das Fremde sonst über `rechenraum_befehl` ungehüllt herauskäme).
- **`doi_bibtex` mit merken (mittel):** schreibt `Uni/literatur.bib` nur noch aus dem Uni-Gebäude und für den Bürgermeister (sonst 403, ohne merken weiter überall); auch der erste Eintrag hat „Rückgängig“ (Liste wird erst mit Kopf angelegt, dann wie jede Änderung archiviert); nur bibliografische Felder (kein `abstract`/`keywords` – frei wählbarer Text des DOI-Inhabers), je ≤ 500 Zeichen; `vault_lesen` behandelt die Liste als fremd.
- **Kleineres:** Währungen gerundet statt abgeschnitten (`betragText`, Kleinstbeträge mit 3 gültigen Ziffern); `post_anhang_lesen` überschreibt nie (gleicher Inhalt → wiederverwendet, sonst `<nr>_name`, sonst 409); Antworten fremder Dienste höchstens 5 MB.
- **Firmware 1.3.1:** Speicherleck (24 KB je hängendem Mikrofon) weg – Puffer werden nach `Mic.end()` immer freigegeben. Die Aufnahme-Aufgabe wartet nicht mehr blind in `Mic.record()` (das ohne Ende wartet, wenn beide Plätze belegt bleiben): eigene Wartegrenze 2 s, dann „Mikrofon hängt“. In dem Fall ruft die Hauptschleife `Mic.end()` gar nicht erst auf (könnte selbst hängen) und rät zum Neustart, statt einzufrieren. Wache der Eingabe 420 s (die Anfrage kann vor dem Senden warten).
- **Bewusst offen:** gleichzeitige Rechenraum-Werkzeuge im selben Raum (feste Zwischennamen) – der api-Motor ruft nacheinander auf; Rundgang-Aktivitäten, die einen Vermerk der KI brauchen, feuern ohne Vermerk am nächsten Tag erneut (gedeckelt durch das Tagesbudget, sichtbar im Protokoll).


## E203 – Sicherheit: kodierte Pfade umgehen die Anmeldung nicht mehr (20.11.)

Gefunden im Review zu E197/E198, Fehler aber älter: Der Anmelde-Haken prüfte `req.url.startsWith('/api/')` auf der ROHEN URL, der Router (find-my-way) dekodiert den Pfad vor dem Routing. `/%61pi/vault/baum` erreichte so `/api/vault/baum` ohne Sitzung – lesen und schreiben (die Herkunftsprüfung setzt ein Angreifer ohne Browser selbst). Jetzt entscheidet Route ODER dekodierter Pfad: gehört eines davon zur API, braucht es eine Sitzung; offen ist nur, was wörtlich UND als Route in `OFFEN` steht; nicht dekodierbare Pfade → 400. Regressionstest mit `/%61pi/…`, `/%2561pi/…`, `/api/%76ault/…` (GET und PUT). Sofort einzeln gepusht. Nicht nachweisbar, ob die Lücke ausgenutzt wurde – Leif sollte nach dem Deploy unter Einstellungen → Sitzungen und im Vault-Verlauf (Syncthing/Obsidian) nach Ungewohntem schauen.

## E204 – Review zu E197/E198 (20.11.)

Unabhängiges Review des Editors im Codehaus (E197) und des Ateliers (E198); der kritische Befund (kodierte Pfade) war schon mit E203 behoben. Behoben, jeweils mit Test:

- **Terminal ohne Gegendruck (mittel):** `yes` mit einem Browser, der nicht mitliest, ließ das Dorf um ~85 MB/s wachsen (OOM bei `mem_limit 768m`). Jetzt wartet das Dorf, sobald im WebSocket mehr als 1 MB wartet (`bufferedAmount`, alle 25 ms nachsehen – `ws` kennt kein „drain“ am WebSocket), und liest den Strom vom Runner nicht weiter. Der Runner hält bei `res.write() === false` die Ausgabe der Shell an (`stdout.pause()`, weiter bei `drain`); dann blockiert der PTY-Helfer beim Schreiben und mit ihm die Shell. Strg+C kommt durch, sobald wieder gelesen wird.
- **Sitzungsende aus einem anderen Prozess (mittel):** `dorf sitzungen-beenden` und `dorf passwort` laufen als eigener Prozess – `beiEnde` griff dort nicht; abgelaufene Sitzungen meldete niemand. Neu `Sitzungen.abgleichen()` alle 30 s im Server: abgelaufene löschen und alle Sitzungen, für die noch jemand Verbindungen hält (Halter: Terminals, VS-Code-Zugänge, Live-Verbindungen), gegen die Datenbank prüfen; was fehlt, geht an dieselben Zuhörer wie beim Abmelden (Terminals 4001, VS Code `/vscode/trennen`, Live „sitzung.beendet“). Spätestens nach 30 s ist also alles gekappt.
- **Git-Pfade als Muster:** `GIT_LITERAL_PATHSPECS=1` für alle Befehle des Editors – „*“ verwerfen traf vorher jede Datei. Auch Pathspec-Magie (`:(glob)…`) ist jetzt nur ein Name.
- **Git nach dem Zeitlimit:** eigene Prozessgruppe (`detached`), beendet wird die ganze Gruppe – vorher liefen Hooks/ssh weiter und hielten die Antwort offen.
- **Atelier „Speichern unter“:** ein anderes Ziel als beim Öffnen geht mit `neu=1`; gibt es die Datei schon, antwortet das Dorf 409 mit ihrer Version, die App fragt „überschreiben?“ und speichert dann mit dieser `basisVersion` (hat sich die Datei bis dahin noch einmal geändert → Konfliktkopie).
- **Bilder unter dem Dorf-Ursprung:** Ergebnisse des Rechenraums gehen nur als `image/png` hinaus (Typ fest, PNG-Signatur geprüft, die Angabe im JSON zählt nicht); Cloudflare-Bilder nur PNG/JPEG/WebP, erkannt an den Anfangsbytes (kein SVG). Jede Bildantwort des Ateliers trägt `Content-Security-Policy: sandbox` und `nosniff`.
- **`bild_bearbeiten`** ersetzt nie mehr eine bestehende Datei, auch keine, die derselbe Chat geschrieben hat (Leif kann sie inzwischen bearbeitet haben) – immer `-2`, `-3` …, geschrieben mit `nurNeu`. (`rechenraum_ablegen` und die Dorfwerk-Ablage aus E190/E199 ersetzen eigene Dateien des Chats weiterhin – bewusst nicht angefasst, gleiche Frage dort offen.)
- **Kleineres:** Download aus dem Editor mit Zeitgrenze nur bis zu den Kopfzeilen (`holenMitKopfZeit`), der Körper ohne Gesamtlimit, Abbruch des Browsers bricht die Anfrage ab; PNG-Vorlage unter 24 Bytes → 400 statt 500; Speichern im Editor: JSON-Grenze 6 × 2 MB (Steuerzeichen werden zu `\u00XX`), die 2-MB-Grenze gilt nach dem Parsen; `POST /terminal/trennen` (nie benutzt) entfernt – das Dorf schickt beim Schließen ein `DELETE /terminal/<id>`; Rechenraum `/bild` liefert höchstens 40 MB, das Dorf liest Antworten des Rechenraums höchstens bis 80 MB (`koerperBegrenzt`); `dorf bilder-einrichten` gibt das Cloudflare-Token über die Standardeingabe an curl (`-H @-`), nicht auf der Kommandozeile.
- **Tests:** Werkstatt `editor.test.ts` (Gegendruck: RSS des Runners < 40 MB nach 2 s `yes`, `yes` im Zustand S; „*“ wörtlich; Hook-Prozesse nach dem Zeitlimit weg), Server `coding-editor.test.ts` (Gegendruck: `bufferedAmount` ≤ ~1,5 MB; Abgleich nach direktem Löschen der Sitzung und nach Zeitablauf; 2 MB Steuerzeichen; Download-Zeitgrenze), `coding.test.ts` (VS Code nach CLI/Ablauf gekappt), `atelier.test.ts` (Speichern unter, PNG/SVG-Prüfung, Antwortgrenze, kurze Vorlage, `bild_bearbeiten`), Python `BildAusgabeGrenzeTest`, Browser-Test „Speichern unter“ mit Rückfrage. Jeder neue Werkstatt-/Server-Test ist ohne den Fix rot (geprüft).
- **Nebenbei gefunden:** Die Server-Tests räumen die Datenordner von `testDorf()` nicht weg (rund 1 000 Ordner, ~3 GB je Lauf unter `/tmp/dorf-test-*`); hier war die Platte davon voll. Nicht in diesem Review geändert.

## E205 – VS Code in der App, Erweiterungen aus Open VSX (20.11.)

Leif: „im Editor alle VS-Code-Plugins herunterladen und installieren“. Der Editor der App (Monaco, E197) kann keine Erweiterungen ausführen – das kann nur ein ganzes VS Code. Leif hat gewählt: das echte VS Code des Codehauses in die App holen und Erweiterungen dort installieren.

- **Warum Open VSX und nicht der Marketplace von Microsoft:**
  - Die Nutzungsbedingungen des Visual Studio Marketplace erlauben seine Angebote nur in Microsoft-Produkten: „Marketplace Offerings are intended for use only with In-Scope Products and Services and you may not install, reverse-engineer, import or use Marketplace Offerings in products and services except for the In-Scope Products and Services“ (In-Scope: Visual Studio, Visual Studio Code, GitHub Codespaces, Azure DevOps …). Quelle: Microsoft Visual Studio Marketplace Terms of Use, https://aka.ms/vsmarketplace-ToU (am 20.11.2026 gelesen, Fassung M264). openvscode-server ist keines dieser Produkte.
  - Darum wird der Marketplace nirgends angefragt – keine Suche, kein VSIX-Download von marketplace.visualstudio.com, auch nicht „von Hand über das Dorf“.
  - Open VSX (open-vsx.org, Eclipse Foundation) ist das Verzeichnis, das openvscode-server von Haus aus nutzt. Geprüft im Release-Archiv 1.109.5 (sha256 wie im Dockerfile): `product.json` → `extensionsGallery.serviceUrl = https://open-vsx.org/vscode/gallery`.
  - Folge: Erweiterungen, die Microsoft nur im eigenen Marketplace anbietet (Pylance, C/C++, Remote-Erweiterungen, Copilot …), gibt es nicht. Vieles andere schon (Python, Prettier, ESLint, GitLens, Vim …). Das steht im Panel.
- **VS Code als Seite der App** (`/codehaus/vscode`, Codehaus → Reiter „VS Code“; auch im Programm und am Handy):
  - Eingebettet wird das vorhandene openvscode-server auf `code.<Dorf-Adresse>` in einem `iframe`. **Der eigene Ursprung bleibt** – er ist die Sicherheitsgrenze aus E191: Das Sitzungs-Cookie des Dorfs erreicht den Container nie, VS Code und seine Erweiterungen können die Dorf-App weder lesen noch steuern.
  - Hinein wie bisher: Die App holt `/api/coding/oeffnen?json=1` (Einmal-Karte, 60 s) und setzt genau diese Adresse als `src`. Jedes Laden/Neu-Laden braucht eine frische Karte. `forward_auth`, Code-Cookie, Verbindungs-Token, Kappen beim Abmelden und der Sitzungsabgleich (E195/E204) sind unverändert; der Knopf „in neuem Tab“ bleibt.
  - **Caddy:** Die Code-Adresse schickt jetzt `Content-Security-Policy: frame-ancestors 'self' https://<Dorf-Adresse>` (als zweite Policy neben der eigenen von VS Code – Browser halten beide ein) und kein `X-Frame-Options` mehr (kennt keine Liste erlaubter Ursprünge; `frame-ancestors` ersetzt es). Einbetten kann VS Code damit nur das Dorf, keine fremde Seite. Die Dorf-App bekommt `frame-src 'self' https://<Code-Adresse>` und bleibt selbst nicht einbettbar (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
  - **Rahmen-Rechte, so wenig wie möglich** (`sandbox`): `allow-scripts` (VS Code ist JavaScript), `allow-same-origin` (sein EIGENER Ursprung: Cookies, IndexedDB, Service Worker, WebSocket – nicht der des Dorfs), `allow-forms`, `allow-popups` + `allow-popups-to-escape-sandbox` (Links aus VS Code öffnen als normaler Tab), `allow-downloads`, `allow-modals`. **Nicht** `allow-top-navigation`: Nichts im Rahmen kann die Dorf-App durch eine andere Seite ersetzen (z. B. eine nachgemachte Anmeldung) – getestet. `allow`: Zwischenablage (Editor/Terminal), `keyboard-map` (VS Code erkennt die deutsche Tastatur), Vollbild.
  - Keine `postMessage`-Brücke: Die App hört auf nichts aus dem Rahmen.
  - **Cookies im Rahmen:** `dorf_coding` und `vscode-tkn` sind `SameSite=Lax`. Dorf und `code.<Dorf-Adresse>` gehören zur selben „Site“ (duckdns.org steht in der Public Suffix List, die eigene Adresse ist also die registrierbare Domain) – der Browser schickt und speichert die Cookies auch im Rahmen. Bei einer ganz anderen `CODING_DOMAIN` ginge das nicht; `/api/coding` meldet darum `einbettbar` (gleiche Site: Unteradresse des Dorfs, gleiches Schema), und die App bietet sonst nur „in neuem Tab“ an. `SameSite` bleibt `Lax` (nicht `None`).
  - **Geprüft mit dem echten openvscode-server 1.109.5:** Die Werkbank lädt in genau diesem Rahmen (Chromium, zwei Ursprünge derselben Site); der Zugangstest mit dem echten Caddyfile läuft auch gegen das echte Programm.
  - **Programm (Tauri):** WKWebView (Mac) und WebKitGTK fragen den Navigations-Filter auch für Rahmen (wry 0.57 prüft dort nicht auf das Hauptfenster; WebView2 unter Windows meldet nur das Hauptfenster). Darum lässt das Programm jetzt `code.<Dorf-Rechner>` (gleiches Schema, gleicher Port) durch (`adresse::codehaus`). Die Befehle des Programms bleiben dem Dorf-Ursprung vorbehalten (Freigabe `remote`), der Code-Host bekommt keine. Mit einer älteren Mac-Fassung öffnet sich VS Code stattdessen im normalen Browser (die Karte gilt dort) – die Seite weist nach 12 s darauf hin.
  - **Abwägung:** Ein Rahmen um einen fremden Ursprung gibt dessen Inhalt keine Rechte in der App; neu ist nur, dass VS Code optisch in der App sitzt. Ein Inhalt im Rahmen könnte ein Dorf-Fenster nachmalen (innerhalb seines Rechtecks) – Leif tippt sein Passwort dort nie ein, die App fragt im Rahmen nie danach. Verworfen: VS Code unter dem Ursprung des Dorfs (`/code/` – dann sähe jede Erweiterung das Sitzungs-Cookie-Umfeld und die Dorf-API), ein eigener Nachbau der Erweiterungs-Laufzeit im Monaco-Editor (gibt es nicht ohne das ganze VS Code).
- **Erweiterungs-Panel** (auf der VS-Code-Seite und im Reiter „VS Code“):
  - **Suche vom Dorf aus**, nicht vom Runner: `GET /api/coding/erweiterungen/suche` fragt `https://open-vsx.org/api/-/search` (feste Adresse, das Suchwort nur als Wert; 8 s, höchstens 1 MB, keine Weiterleitungen) und je Treffer die Einzelheiten für die Lizenz (eine Stunde gemerkt). Die Antwort wird per Zod gelesen; an die App gehen nur geprüfte Felder (Name, Herausgeber, Beschreibung, Version, Downloads, Bewertung, verifiziert, veraltet, Lizenz) – keine Adresse aus der Antwort, kein HTML; den Link zu open-vsx.org baut das Dorf aus den geprüften Namensteilen. Grund: Das Dorf hat schon Abrufe mit Grenzen (E199/E202), der Runner bleibt ein reiner Ausführer ohne Netz-Klienten, und die Suche geht auch, wenn der Coding-Container steht. Symbole der Erweiterungen zeigt die App nicht (die CSP lädt keine fremden Bilder).
  - „verifiziert“ heißt bei Open VSX: Der Namensraum gehört nachweislich dem, der veröffentlicht. Der Code ist damit nicht geprüft – so steht es am Abzeichen. Nicht verifizierte brauchen einen zweiten Klick.
  - **Installieren/Entfernen:** Dorf (`POST /api/coding/erweiterungen/installieren|entfernen`) → Runner im Profil coding (`/erweiterungen*`, `apps/werkstatt/src/erweiterungen.ts`) → `openvscode-server --server-data-dir … --install-extension <id> --force` bzw. `--uninstall-extension <id>`, Liste mit `--list-extensions --show-versions` (so geprüft am echten Programm). Feste Argumentlisten, keine Shell, eigene Prozessgruppe, 180 s, Ausgabe gekürzt, immer nur ein Aufruf zur selben Zeit.
  - **Kennung** in Dorf UND Runner: `^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(@[0-9][0-9A-Za-z.+-]*)?$`, höchstens 200 Zeichen – beginnt nie mit „-“ (keine Option), enthält weder „/“ noch „:“ (kein Pfad, keine Adresse). Großbuchstaben im Namensraum (Open VSX kennt sie) schreibt das Dorf klein; VS Code unterscheidet nicht (geprüft: `pkief.material-icon-theme`). Kennungen mit Unterstrich zeigt die Suche, installieren lassen sie sich nur in VS Code selbst.
  - **VSIX hochladen** (höchstens 50 MB, nur ZIP-Archive): Der Runner schreibt die Datei nach `/arbeit/.heim/vsix/<uuid>.vsix` (Name vom Runner, absoluter Pfad), installiert sie und löscht sie wieder. Für selbst gebaute Erweiterungen – nicht als Umweg zum Microsoft-Marketplace gedacht (siehe oben; das kann die Technik nicht erkennen, es steht bei Leif).
  - Der Runner nennt denselben Datenordner wie `start.sh` beim Start von VS Code (`$HOME/.openvscode-server`, der Start-Test prüft das). Ein schon offenes VS Code zeigt Neues nach „Neu laden“ (ob es ohne Neuladen erscheint, ist nicht geprüft).
  - Älteres Coding-Image: Die App sagt „kommt mit dem nächsten Deploy“ (501) – das neue Image kommt mit demselben Deploy (Kennung hängt an `apps/werkstatt/src/*.ts`).
- **Sicherheit:**
  - Alle Routen liegen unter `/api/` ohne Ausnahme: Sitzung und – für Schreibendes – Herkunft prüft der allgemeine Schutz (E203, getestet auch mit `/%61pi/…`). Im Werkstatt-Profil gibt es die Endpunkte nicht (404).
  - **Kein Agenten-Werkzeug** führt zum Installieren (Test über die Werkzeugliste). Fremdinhalte können also über die Leine keine Erweiterung installieren – nur Leifs Klick.
  - Erweiterungen laufen im Coding-Container mit dessen Rechten: Shell, Internet, GitHub-Token, Vault rw (E191, Leifs Entscheidung). Das Panel sagt es deutlich („nur Vertrauenswürdiges installieren“). Das Risiko ist dasselbe wie bei jedem `npm install` dort – neu ist, dass es einen bequemen Knopf gibt.
  - Unverändert: Ein Coding-Agent mit Shell (E191) konnte und kann `openvscode-server --install-extension` selbst aufrufen; das ist Teil der Codehaus-Ausnahme und kein neuer Weg.
- **Deploy:** `dorf deploy`/`empfangen` vergleicht jetzt den Caddyfile im Caddy-Container mit dem der aktuellen Version und erstellt Caddy bei Abweichung neu (`caddy_abgleichen`). Der Caddyfile ist als einzelne Datei über den Link `current` eingehängt; ob Compose den Container bei geänderter Datei sonst von selbst erneuert, ließ sich von hier nicht prüfen – ohne den neuen Kopf bliebe der Rahmen leer.
- **Tests:** Werkstatt `erweiterungen.test.ts` (echter Runner, nachgebautes openvscode-server: nur Profil coding, feste Argumente, über 40 Injektionsversuche ohne einen einzigen Aufruf, VSIX, Zeitlimit, nacheinander), Server `coding-erweiterungen.test.ts` (401 auch kodiert, Herkunft, Open VSX nachgebaut mit echten gespeicherten Antworten in `test/fixtures/openvsx`, untergeschobene Antworten, Größen-/Fehlergrenzen, kein Agenten-Werkzeug, `einbettbar`), `deploy/test/coding-zugang-test.sh` (echter Caddyfile: `frame-ancestors` genau das Dorf auf jeder Antwort, VS-Code-Policy bleibt, Dorf nicht einbettbar), `empfangen-test.sh` (Caddy neu bei geändertem Caddyfile), Browser `vscode.spec.ts` (Desktop + Handy: Rahmen mit Karte, Wegleiten gesperrt, Suche/Installieren/Entfernen/VSIX), Start-Test (Datenordner), Rauchtest im Image (`--list-extensions`, lokale Test-VSIX aus `test-vsix.py` – hier ohne Docker nur gegen das ausgepackte echte Programm geprobt), `cargo test` (`codehaus`).
- **Offen / nicht geprüft:** Mac-Programm und iPhone/iPad (WKWebView) am echten Gerät; Tastatur am Handy in VS Code; Open-VSX-Nutzungsgrenzen (die Antwort nennt `x-ratelimit-limit: 10800`, eine Suche kostet höchstens 11 Abrufe).
- **Review (20.11., unabhängig; alles behoben, je mit Test):**
  - **Programm, Webviews (mittel):** VS Code lädt Markdown-Vorschau, Einzelheiten einer Erweiterung und Erweiterungs-Panels als Rahmen von `https://<kennung>.vscode-cdn.net/…` (`product.json`: `webviewContentExternalBaseUrlTemplate`; im Archiv nachgesehen: die Kennung ist ein SHA-256 als 52 Zeichen 0–9/a–v). Auf Mac/Linux lief auch das durch den Navigations-Filter → leere Webview und je Mal ein Browser-Tab. Jetzt durchgelassen: nur https, Standard-Port, genau ein Namensteil aus `[a-z0-9]{1,64}` vor `vscode-cdn.net` (`adresse::vscode_webview`); keine Befehls-Freigabe.
  - **Caddy beim Deploy:** `caddy_abgleichen` schluckte Fehler (`|| true`), und lief Caddy nicht, wurde er nie erneuert. Jetzt: neuen Caddyfile vorher mit dem Caddy-Image prüfen (`compose run --rm --no-deps … caddy validate --config … --adapter caddyfile`; der Befehl selbst ist am Caddy-Programm 2.10.2 geprüft, der Aufruf über Compose mangels Docker nicht), dann neu erstellen, dann muss Caddy antworten (Verwaltungs-Schnittstelle `localhost:2019` im Container; antwortet sie nicht, der Container ist aber dreimal hintereinander ansprechbar, bleibt es bei einem Hinweis). Jeder Fehler lässt `cmd_deploy` scheitern → `empfangen` kehrt zur vorherigen Version zurück. Scheitert die Abfrage des laufenden Caddy, wird trotzdem geprüft und neu erstellt.
  - **Kennung auf „.vsix“:** VS Code hält jedes Argument mit dieser Endung für eine Datei relativ zu seinem Arbeitsordner (`server-main.js`); `a.vsix` oder `a.b@1.vsix` passten zur Regel. Dorf und Runner lehnen solche Kennungen jetzt ab, und jeder Aufruf läuft in einem frischen, leeren Arbeitsordner, der danach gelöscht wird.
  - **Zeitgrenzen:** Der Runner braucht je Auftrag höchstens Warten in der Reihe (60 s, danach 409 und der Auftrag wird nicht mehr ausgeführt) + Aufruf (180 s installieren, 60 s entfernen) + Liste (30 s); das Dorf wartet länger (300 s, 170 s, VSIX 330 s). Die Liste steht nicht mehr in der Reihe und antwortet auch während einer Installation. Nach einem Fehler lädt die App die Liste neu.
  - **Kleineres:** „Entfernen“ zeigt die App nur für Kennungen, die Dorf und Runner annehmen (`erweiterungEntfernbar` in `@dorf/shared`); die Liste führt jede Kennung einmal (keine doppelten Zeilen); das Dorf reicht vom Runner nur `{ id, version }` weiter, eine Antwort ohne Liste ist eine leere Liste; ein JSON-Körper, der kein Objekt ist (`null`, Zahl, Liste), ergibt am Runner 400 statt 500 – auch bei den Editor-Endpunkten.
  - **Nicht geändert:** der Hinweis „VS Code erscheint nicht?“ nach 12 s. Er greift, wenn der Rahmen gar nicht lädt (abgebrochene Navigation im älteren Mac-Programm). Lädt der Rahmen eine Fehlerseite (401), meldet der Browser trotzdem `load`; die App kann in den fremden Ursprung nicht hineinsehen und soll keine Nachrichten von dort annehmen. Dafür steht „↗ in neuem Tab“ immer in der Kopfleiste.

## E206 – Freie Kamera, Dateien im Chat-Seitenfenster, Cardputer 1.3.2 (20.11.)

- **Kamera (Leif: „mittlere Maustaste frei bewegen, nicht nur Draufsicht“):** Mittlere Maustaste + Ziehen dreht frei um das Dorf und schaltet die „freie Sicht“ ein: Kippen bis 1,5 rad (knapp über dem Horizont, normal 1,2) und näher heran (2,5 statt 7). Shift + mittlere Taste verschiebt (OrbitControls: ROTATE mit Shift = PAN); zoomen weiter mit dem Rad – die mittlere Taste zoomte vorher, das Rad kann es ohnehin. Die Kamera bleibt immer über dem Gelände (Hügelhöhe + 0,6). „Zum Rathaus“ (⌂) kehrt zur gewohnten Schrägansicht zurück. Handy unverändert. Browser-Test: echter Mittelklick-Zug am Desktop.
- **Dateien im Seitenfenster des Chats:** Ein Klick auf „Erzeugte Dateien“ oder einen Anhang öffnet die Datei rechts neben dem Chat (am Handy bildschirmfüllend) mit derselben Vorschau wie die Bibliothek (Markdown, Text, PDF, HTML abgeschottet, Bilder, Audio/Video); Knöpfe Bibliothek/Herunterladen/neuer Tab, Esc schließt. Strg/⌘/Mittelklick öffnen wie bisher einen neuen Tab. Eingebettete Chats (z. B. im Editor) behalten den neuen Tab – dort ist kein Platz.
- **Cardputer 1.3.2 (Leif: „nimmt auf, sagt Senden, aber beim Bürgermeister kommt nichts an; Feld bleibt leer, keine Meldung“):** Die Meldungen waren nur 2,2 s eingeblendet – „Nichts verstanden“ ging unter. Jetzt bleibt jede Sprach-Meldung im Eingabefeld stehen, „Nichts verstanden“ nennt den höchsten Pegel der Aufnahme, und die Einstellungen zeigen „Letzte Sprache: Dauer · Pegel · Ergebnis“. Leifs Wahl: Beim Bürgermeister (Nachricht, neues Gespräch, „Sprechen → Bürgermeister“) geht der erkannte Text **sofort** raus; To-dos, Notizen, Termine behalten ihn zum Korrigieren. Der Server protokolliert je Spracheingabe Größe, Dauer und Zahl der erkannten Zeichen (nie den Inhalt) – `dorf logs` zeigt so, ob Aufnahmen ankommen. Host-Test 185/185; Startlader/Partitionen unverändert (verglichen).

## E207 – Herunterladen im Programm, Vorschau für jedes Format (20.11.)

- **„Herunterladen“ tat im Programm nichts** (Leif, Bibliothek mit einer .docx). Im Browser lädt derselbe Link (geprüft mit Chromium, auch mit `CSP: sandbox` an der Antwort). Im Programm fehlte ein Download-Handler: WKWebView (Mac) lädt ohne ihn gar nichts, und die WebView zeigt nirgends, wo eine Datei landet. Jetzt `on_download`: nur Downloads vom eigenen Dorf, Ziel ist der Download-Ordner (Vorschlag der WebView, gleiche Namen bekommen „(1)“), danach Meldung „Heruntergeladen“ und der Ordner mit der Datei geht auf. Kommt mit dem nächsten Programm-Update (die CI baut es, das Programm aktualisiert sich selbst).
- **Vorschau für alle Formate:** Was keine eigene Anzeige hat (Word, Excel, PowerPoint, OpenDocument, Mails, Archive, RTF …), zeigt die Bibliothek – und damit auch das Seitenfenster im Chat – jetzt über die vorhandene Umwandlung im Rechenraum (E190, mit Zwischenspeicher): Text als Markdown (ohne HTML), Bilder als PNG/JPEG (höchstens 12, kein SVG), Hinweise eingeklappt, „Original herunterladen“. Neue Route `GET /api/vault/vorschau` (nur lesen, Sitzung wie alles unter /api). Audio/Video um wav/ogg/opus bzw. webm/mov ergänzt. Layout kann abweichen – das steht dabei.

## E208 – Cardputer 1.3.3: Mikrofon-Test, Codec-Register nur noch auf Wunsch (20.11.)

Leif mit 1.3.2: „Aufnahme: Mikrofon hängt – neu starten“, auch nach dem Neustart. Die Aufnahme-Aufgabe bekam also über 2 s keinen fertigen Puffer von der Bibliothek. Mit 1.2 kam Ton an (sehr leise); der einzige große Unterschied am Mikrofonweg seit 1.3 sind die ES8311-Register (E201). Darum: Register nur noch auf Wunsch (Vorgabe aus, NVS „mikroreg“) – ohne sie verstärkt wieder die Software der Bibliothek (magnification ×16/×32/×64 je Stufe, lauter als 1.2), der Server hebt leise Aufnahmen zusätzlich an (E201). Neu Einstellungen → **Mikrofon-Test**: nimmt auf ohne zu speichern, zeigt Puffer/Sekunde (Soll 3,9 – deutlich weniger hieße: Takt stimmt nicht, Ton kommt zu langsam; das würde auch die Beobachtungen aus 1.2 erklären), Pegel und Spitze; `Enter` schaltet die Codec-Register an/aus. So wird am Gerät gemessen statt geraten. Die Meldung beim Scheitern nennt die Zahl der erhaltenen Puffer und verweist auf den Test. Host-Test 189/189; Startlader unverändert.


## E209 – Cardputer 1.3.4: Aufnahme ohne nachträglichen WAV-Kopf (20.11.)

Leif mit 1.3.3: „Mikrofon liefert keinen Ton (33 Puffer)“, obwohl der Balken ausschlägt. 33 Puffer = 8,4 s Ton – das Mikrofon lief also. Die Meldung kam, weil die Aufnahme-Aufgabe nicht binnen 4 s „fertig“ wurde: Am Ende sprang sie an den Dateianfang und schrieb den WAV-Kopf neu. LittleFS (interner Speicher) kann nicht an Ort und Stelle überschreiben – eine Änderung am Anfang schreibt die ganze Datei neu (Sekunden, und es braucht noch einmal so viel freien Platz). Das erklärt auch das „Hängen nach dem Stoppen“ aus 1.2. Die Freigabe der Puffer in M5Unified 0.2.29 (`Mic_Class.inl`: Platz wird frei, sobald er gefüllt ist) ist in Ordnung. Jetzt: Die Datei enthält nur die Rohwerte (nur anhängen), `hochladen()` setzt den 44-Byte-Kopf beim Senden davor (Content-Length entsprechend; Dateien, die schon mit RIFF beginnen, bleiben unverändert). Warten beim Stoppen bis 6 s, und die Meldung unterscheidet „liefert keinen Ton“ (Bibliothek gibt keine Puffer zurück) von „Aufnahme wird nicht fertig“ (Speichern). Host-Test 189/189 (der Nachbau speichert weiter fertige WAVs, das Gerät nicht); Startlader unverändert.

## E210 – Wie der Bürgermeister antwortet (21.11.)

Leif: „unzufrieden mit der Art, wie der Bürgermeister antwortet – diese Unterpunkte“. Die Unterpunkte waren die Protokoll-Zusammenfassung (Auftrag, Getan, Entschieden, Offen, Auffälligkeiten), die Telegram und Cardputer schon abschnitten, die App aber voll zeigte. Neu im Prompt des Bürgermeisters (`ANTWORT_AN_LEIF` in `kontext.ts`, nur bei ihm – Helfer unverändert), nach Leifs Vorgabe: **Hat er etwas erledigt**, kommt zuerst „**Erledigt:** …“ (was er getan hat) und „**Für dich:** …“ (was Leif noch tun/beantworten muss, sonst „nichts“), darunter höchstens ein kurzer Absatz Fließtext. **Fragt Leif nur etwas oder will etwas wissen/haben**, antwortet er nur mit kurzem Fließtext – ohne diese Zeilen, ohne Überschriften und Stichpunkte (außer das Gewünschte ist selbst eine Liste). Fragen + Erledigen = erster Fall. Die Zusammenfassung bleibt (Protokoll, „Offen“ → eigene To-dos, Helfer-Ergebnisse), die App klappt sie jetzt unter „Protokoll“ ein. Im Prompt steht dazu, dass Leif sie nicht sieht und sie knapp bleiben soll. Aufwach-Läufe/Rundgänge behalten ihre Regel „Für Leif: …“. Bewusst im Code statt in `personality.md`: Leifs Persönlichkeitsdatei bleibt unberührt, die Regel gilt sofort.

## E211 – Keine „Fertig mit Entwurf“-Meldungen mehr (22.11.)

Leif: „Hör auf, mir immer die ‚Fertig mit Entwurf‘-Nachrichten zu schicken – ich brauch die nicht.“ Die Meldung kam bei jedem Lauf, der eine Datei geschrieben hatte – auch wenn der Bürgermeister nur sein Gedächtnis (`Rathaus/memory.md`) gepflegt hatte – und listete nur Pfade. Sie ist ganz entfernt (nicht nur abgeschaltet): Läufe mit Dateien melden sich wie alle anderen mit der normalen Fertig-Meldung samt Antwort (Schalter „beendet“). Der Schalter `entwuerfe` bleibt in `telegram.md` gültig, wirkt aber nicht mehr und ist aus den Agenten-Einstellungen der App verschwunden.

## E212 – Handschrift: Text als echt wirkende, ungleichmäßige Handschrift (22.11.)

Leif: „Such nach Möglichkeiten, Handschrift zu synthetisieren, und bau es ein – ein gutes Werkzeug, das inkonsistent schreibt und auch etwas gekritzelt.“

- **Recherche:** Schriftarten (immer gleiche Buchstaben) scheiden aus. Infrage kamen Graves' RNN-Modell (2013) in mehreren Umsetzungen und neuere Diffusions-/Transformer-Modelle (WordStylist, SDT, One-DM). Diese erzeugen Wortbilder, brauchen eine GPU, PyTorch und oft eine Schriftprobe – für den Rechenraum (nur CPU, ohne Netz) zu schwer. Der Klassiker sjvasquez/handwriting-synthesis hat **keine Lizenz**. Gewählt: **X-rayLaser/pytorch-handwriting-synthesis-toolkit** (MIT, vortrainierte Gewichte, 15 MB, Zeichensatz mit Ziffern und Satzzeichen).
- **Ohne PyTorch:** Die Rechnung (drei Peephole-LSTMs, Aufmerksamkeitsfenster, Mischverteilung) steht in `apps/rechenraum/handschrift.py`, nur NumPy. `model.pt` liest ein eigener Leser des torch.save-Formats, der nur drei harmlose Rekonstruktions-Funktionen zulässt – eine Pickle-Datei mit fremdem Code wird abgelehnt, nicht ausgeführt (Test). Das Image lädt `model.pt`, `meta.json` und `LICENSE` vom festen Commit mit Prüfsumme; fehlt die Quelle, baut es trotzdem und das Werkzeug sagt „Modell fehlt“. Seiten in Millimetern: PDF in echtem A4, PNG mit 150 dpi (1240 × 1754 px).
- **Gemessen statt geraten:** Mehr „bias“ (sauberer) lässt das Modell entgleisen: ab ~0,9 öfter Strichsalat, ab ~1,5 endlose Striche. Darum bias 0,75 (ordentlich) bis 0,1 (gekritzelt). Mit Prüfung und Neuversuchen dauert ein Brief (≈ 180 Zeichen) 3–5 s. Jede Zeile wird bewertet: ausgelassene Buchstaben (das Fenster hat sie nie besucht), kein Ende, entgleist (viel höher als breit), Schleife an einem Zeichen. Ist die Zeile schlecht, wird sie bis zu 4× neu erzeugt (Zeitbudget 95 s).
- **Ungleichmäßig:** Größe über die Buchstabenbreite. Jedes Wort wird zuerst auf die Grundlinie gesetzt (das Modell lässt sie wandern) und bekommt dann eigene Größe, Neigung und Grundlinie. Dazu Drift und Welle je Zeile, Strichstärke je Strich. Nach Grad der `unordnung` (0–1) wird ab und zu ein Wort verschrieben (vertauscht, doppelt, abgebrochen) und durchgestrichen oder zugekritzelt.
- **Deutsch:** Das Modell kennt keine Umlaute. ä/ö/ü werden als a/o/u geschrieben und die Punkte danach gesetzt: x aus Aufmerksamkeitsfenster und Lage im Wort, Höhe aus dem Wort; schnell geschrieben auch als Strich. ß wird „ss“, „ “ – … & € werden ersetzt, Unbekanntes fällt weg und wird gemeldet. Sehr kurze Zeilenreste („es.“) hängen an der vorigen Zeile, weil das Modell sie schlecht schreibt.
- **Ausgabe:** SVG je Seite (A4, 150 dpi, blanko/liniert/kariert oder „keins“ = durchsichtig und eng zugeschnitten), PNG/PDF über `rsvg-convert` (mehrseitig). Tinte blau, schwarz, Bleistift, rot, grün. Höchstens 1500 Zeichen und 4 Seiten je Aufruf.
- **Im Dorf:** Werkzeug `handschrift_schreiben` (Gruppe Rechenraum, also auch der Bürgermeister) über `dorfwerk.py`, Ablage wie alle Rechenraum-Ergebnisse. Der Text steht nicht im Werkzeug-Protokoll, nur seine Länge. Dazu die Aktion **Atelier → „In Handschrift schreiben“** (Text, Stil ordentlich/normal/hastig/gekritzelt, Papier, Stift, Format), in `PFLICHT_DATEIEN`.
- **Ehrlich:** Das Modell verschreibt sich manchmal selbst (vor allem bei Ziffern und Großbuchstaben, „Übung“ → „Vbung“). Das Ergebnis sagt das, und ein neuer Lauf gibt ein anderes Schriftbild. Es ist eine Handschrift aus dem IAM-Datensatz, nicht Leifs eigene; eine eigene Schriftprobe nachzuahmen kann dieses Modell nicht.

## E213 – Handschrift kann Mathe: Formeln, Rechenwege, Tabellen (22.11.)

Leif: „Schau, ob du damit gut Rechenwege und Formeln schreiben kannst – kann es Mathe oder Tabellen von Hand?“ Der Test mit dem echten Modell ergab: nein. „=“ kennt das Modell nicht – ich hatte es stillschweigend zu „-“ gemacht, das hat Rechnungen verfälscht. Kurze Formeln wurden verkrüppelt („x = 5“ → „T - J“, „3·5“ → „3 + 5“). Hochzahlen, Brüche, Wurzeln und Tabellen gingen gar nicht. Leifs Wahl: „Ja, alles bauen“.

- **Formelsatz statt Modell:** `apps/rechenraum/handformel.py` setzt Formeln wie TeX in Kästchen (Breite, Höhe, Tiefe; Mathe-Achse): Brüche mit gezogenem Bruchstrich, Wurzeln (auch n-te) mit Haken, Hoch- und Tiefzahlen, ∑/∏/∫/lim mit Grenzen, \\left/\\right-Klammern, die mitwachsen, Akzente (\\vec, \\bar, \\mathbb), griechische Buchstaben, Relationen, Pfeile, ⇒/⇔/∀/∅ selbst gezeichnet.
- **Zeichen:** Einstrich-Zeichen aus den **Hershey-Schriften** (futural, mathlow, greek; 164 Zeichen als `hershey/glyphen.json`, Erzeuger `hershey/erzeugen.py`). Nutzungsbedingung: jede Nutzung erlaubt, Danksagung muss mit (steht in der JSON, Test). Breiten proportional aus dem Strich, nicht aus Hersheys starrem Raster – sonst steht „12“ als „1 2“ da.
- **Von Hand:** Jedes Zeichen bekommt eigene Größe, Drehung, Neigung und Höhe. Striche werden geglättet und zittern leicht. Linien (Bruchstrich, Wurzeldach, Tabellengitter) sind leicht gebogen und stehen an den Enden über – alles nach Grad der `unordnung`.
- **Eingabe:** `$…$` (LaTeX-Teilmenge) oder einfache Schreibweise ohne $. Was eine Formel ist, wird Wort für Wort erkannt (Ziffern, Rechenzeichen, f(x) …; einzelne Buchstaben neben Formeln gehören dazu). Einfache Schreibweise: `3x + 5 = 20 | -5` (Umformungsstrich), `x^2`, `x^(n+1)`, `sqrt(2)`, `*`, `<=`, `>=`, `!=`, `=>`, `->`, Unicode (≤ ≥ ≠ · × ÷ ± → ⇒ ∞ π √ ² ³ ∫ ∑ ∂ ∈ °). Dezimalkomma ohne Lücke, bedeutsame Leerzeichen bleiben. Unbekannte Befehle werden gemeldet, nicht geraten.
- **Rechenwege:** Aufeinanderfolgende reine Formelzeilen werden am ersten „=“ (oder an `&`) untereinander ausgerichtet (`ausrichten`, Test). Zeilen mit Brüchen bekommen so viel Platz, wie sie brauchen (auf liniert/kariert in ganzen Zeilen).
- **Tabellen:** Markdown-Tabellen (`| a | b |`, Trennzeile = Kopfzeile) mit handgezogenem Gitter, Kopfzeile doppelt unterstrichen, Zahlen rechtsbündig, Formeln in Zellen möglich. Zu breit → verkleinert.
- **Text daneben:** Längere Textstücke schreibt weiter das Modell. Kurze Stücke zwischen Formeln (unter 12 Buchstaben) und Tabellenzellen kommen in Druckschrift (mit echten Umlaut-Punkten). Gemessen: Das Modell braucht ganze Zeilen als Kontext – „und“ wurde zu einem Punkt, „Wert“ fehlte, „also stimmt“ wurde Gekritzel. Reine Textabsätze laufen unverändert wie in E212.
- **Ehrlich:** Text und Formeln kommen aus zwei Quellen. Formeln sind immer korrekt lesbar, sehen aber eher nach sauberer Druckschrift aus als der Fließtext. Leif wurde gesagt, dass handschriftlich verlangte Abgaben damit zu „fälschen“ Täuschung wäre – für Lernzettel, Notizen, Karteikarten ist es gedacht.

## E214 – Handschrift realistischer: gerade Linien wie in GoodNotes, klare Rechnungen, Logik-Zeichen (22.11.)

Leif: „Realistischer – Tabellen oder gerade Linien sollen auch gerade sein können, als wenn man es mit GoodNotes schreibt. Fließtexte etwas weniger schön, aber Rechnungen deutlich lesbar.“

- **Gerade Linien:** Tabellengitter, Bruchstriche, Wurzeldächer und □ sind jetzt wirklich gerade, wie mit „Halten zum Begradigen“ in GoodNotes. Nur Anfang und Ende sitzen nicht auf den Punkt genau, dazu ein Hauch Schräglage. Zwei-Punkt-Striche lässt `zittern()` unangetastet (Test).
- **Rechnungen klar:** Größe, Drehung, Neigung und Höhe je Zeichen schwanken nur noch etwa halb so stark, das Zittern der Striche ist leiser.
- **Digitaler Stift:** gleichmäßige Strichstärke (±2,5 %) statt schwankendem Druck.
- **Fließtext freier:** Modell-bias höchstens 0,7 statt 0,75. Probiert wurde 0,6 – das brachte deutlich mehr Verschreiber („in“ → „ink“) und ist verworfen.
- **Logik (Computational Logic):** ∧ ∨ ¬ → ↔ ≡ ⊢ ⊨ ⊤ ⊥ □ (als LaTeX \\land \\lor \\neg \\leftrightarrow \\vdash \\models \\top \\bot \\Box, als Unicode oder `<->`). Mengenklammern `{¬p, q}` ohne $ bleiben Klammern. Wahrheitstafeln: Formeln und Zahlen in Tabellenzellen stehen mittig.
- **Platz:** Extra-Zeilen gibt es nur noch für Formeln (Brüche, ∑ …), nicht mehr für hohe Buchstaben im Fließtext. Nach Tabellen kein Extra-Abstand mehr.
- Leifs echte Bearbeitung (Computational Logic, grüne Lösungen) liegt nur im Vault auf dem Server – aus dieser Sitzung nicht erreichbar. Gezeigt wurde ein selbst geschriebenes Logik-Beispiel. Die echte Seite kann er hochladen oder auf dem Server vom Bürgermeister schreiben lassen.

## E215 – Eine Handschrift für alles (22.11.)

Leif: „Am Ende muss alles einheitlich eine Schriftart sein – nicht 100 % gleich, aber nicht acht verschiedene Arten, Buchstaben zu schreiben. Es soll aussehen wie von Hand, nicht offensichtlich vom Computer.“ Bis E214 stammten Fließtext (KI-Modell) und Formeln/Tabellen/kurze Wörter (Hershey) aus zwei Quellen. Dazu wechselt das KI-Modell seinen Stil von Zeile zu Zeile, weil jede Zeile ein neuer „Schreiber“ ist.

- **Neu Standard `stil: einheitlich`:** Alles – Fließtext, Formeln, Tabellen – kommt aus derselben Zeichengrundlage (Hershey futural/mathlow/greek) mit einem **Schreiber-Profil je Dokument** (Neigung, Breite, Abstände; der seed bestimmt den „Schreiber“). Jedes Zeichen wird einmalig verformt (weiches Verformungsfeld, Strichenden leicht verlängert oder gekürzt), so gleicht kein „o“ dem anderen. Wörter bekommen eigene Grundlinie, Größe und Lage, die Wortabstände schwanken. Bei höherer Unordnung wird ab und zu ein Wort verschrieben und gerade durchgestrichen. Unterschneiden für r/f/t/c …, sonst entstehen Lücken mitten im Wort („Ex er cis e“).
- **Vorteile:** Einheitlich, immer korrekt geschrieben (keine Modell-Verschreiber wie „gilt“ → „gill“), jede Sprache mit lateinischen Buchstaben (Englisch, Deutsch mit Umlauten), schnell (≈ 0,3 s je Seite statt mehrerer Sekunden), braucht das KI-Modell nicht.
- **`stil: ki`** bleibt für reinen Fließtext, der freier aussehen darf (Graves-Modell wie in E212–E214).
- Ehrlich: Es ist eine saubere Druck-Handschrift, keine verbundene Schreibschrift. Das Hershey-Skript (verbundene Schreibschrift) hat zu verschnörkelte Großbuchstaben.

## E216 – Schriftprobe: das Dorf schreibt in Leifs echter Hand (22.11.)

Leif: „Schau dir deine eigene Bearbeitung an, finde heraus, was du besser machen musst, und schau, was es schon gibt.“ Die Bilder von E215 waren als Computer zu erkennen. Gründe: dieselbe Grundform (Hershey) für jedes Zeichen, gleich dicker Strich, zu gleichmäßige Abstände. Gute Dienste und Projekte für Handschrift lösen das mit einer **Probe der echten Hand**: echte Striche je Zeichen in mehreren Varianten, die abgewechselt werden. Ein Modell, das eine fremde Hand aus wenigen Beispielen nachahmt, bräuchte Training oder eine GPU. Das passt nicht in den Rechenraum ohne Internet. Leif hat „Schriftprobe + Verbesserungen“ gewählt.

- **Erfundene Hand verbessert (E216a):**
  - Abstände: automatisches Unterschneiden über ein Tintenprofil je Höhenband, Ziel ≈ 0,22 em zwischen den Zeichen.
  - Feste Schreib-Gewohnheiten je Dokument: 7 mit Querstrich oder ohne, Schwung an Strichenden.
  - Strichdicke folgt dem Tempo: schnelle Stellen werden dünner.
  - Strichenden ohne Haken.
- **Schriftprobe (E216b/c):**
  - Neue Seite `/schriftprobe` (Einstieg: Atelier → „Schriftprobe schreiben“).
  - Kästchen mit Grundlinie, x-Höhe und Versalhöhe, dazu eine blasse Vorlage.
  - Aufnahme mit Pointer-Events (Stift mit Druck, Finger, Maus; zusammengefasste Ereignisse), x/y/Zeit/Druck, normiert auf Versalhöhen-Einheiten.
  - Übernehmen per Knopf oder ⏎. Das Zeichen bleibt, bis sein Ziel erreicht ist, dann springt die Seite zum nächsten offenen.
  - Varianten löschen, Fortschritt sehen, Probelesen mit eigenem Text.
  - Zeichensatz: a–z (3×), A–Z (2×), 0–9 (3×), Umlaute/ß, Satzzeichen, Mathe, Logik und Griechisch (je 1–2×); jeweils bis 8 Varianten.
- **Speicher:**
  - `Atelier/schriftprobe.json` über den VaultDienst. Sie landet also im Backup und in Obsidian.
  - `GET/PUT /api/atelier/schriftprobe` mit Anmeldung und Origin.
  - Zod prüft streng: je Schlüssel ein Zeichen, höchstens 200 Zeichen, 8 Varianten, 40 Striche, 4000 Punkte je Strich, 300 000 Punkte insgesamt; |x|, |y| ≤ 5, endliche Zahlen; Zeit 0–600 s, Druck 0–1.
  - Gerundet gespeichert. Eine leere Probe gilt als keine.
- **`handschrift_schreiben`:**
  - Gibt es eine Probe, schreibt der Standard in Leifs Hand.
  - `stil: eigene` erzwingt die Probe. Ohne Probe gibt es eine ehrliche Fehlermeldung.
  - `stil: einheitlich` nimmt bewusst die erfundene Hand, `stil: ki` das Graves-Modell.
- **Im Rechenraum:**
  - Die Probe wird noch einmal geprüft (`probe_laden`).
  - Striche mit Zeit werden alle 12 ms neu abgetastet. Dann ist der Punktabstand das echte Tempo und steuert die Strichdicke.
  - Varianten wechseln sich ab, nie zweimal dieselbe hintereinander. Dazu kommen kleine Schwankungen bei Größe und Drehung.
  - Auch gezeichnete Logikzeichen (∧ ∨ ¬ ⊢ ⊨ ⇒ …) kommen aus der Probe, wenn Leif sie geschrieben hat.
  - Fehlende Zeichen ergänzt die erfundene Hand.
- **Beim Nachsehen gefunden und behoben:**
  - Der Umbruch schätzte die Zeichenbreite wie beim KI-Modell. Die Druckschrift ist schmaler, darum brach der Text schon nach etwa 60 % der Zeile um. Jetzt wird die Breite an der Hand selbst gemessen; das gilt auch für Leifs Probe.
  - Kurze Tabelleneinträge (T/F, 0/1) stehen mittig wie in einer Wahrheitstafel.
  - Die Aktion „In Handschrift schreiben“ wurde in E213/E215 geändert, ohne die alte Fassung in `VORLAGE_FRUEHERE_FASSUNGEN` einzutragen. Leifs Vault hatte also noch die E212-Fassung. Jetzt sind alle drei eingetragen; die Aktion bekommt die Schrift-Wahl „automatisch/eigene/einheitlich/ki“.
- **Ehrlich:**
  - Es bleibt Druckschrift aus einzelnen Zeichen. Verbindungen zwischen Buchstaben (Schreibschrift) gibt es nicht.
  - Wie echt das Ergebnis wirkt, hängt von Leifs Probe ab. Mehr Varianten machen es lebendiger.

## E217 – Eine neue erfundene Hand: geschrieben statt verbogen (22.11.)

Leif zu E216 (Bild „Exercise 3: Resolution“): „Schau mal, wie kacke das aussieht. Die Zeichen ähneln sich zu viel, und es sieht nicht aus wie von Hand auf GoodNotes geschrieben. Recherchiere genau, was Handschrift menschlich aussehen lässt.“ Leif hat danach „Nur neue erfundene Hand“ gewählt und schreibt „teilweise verbunden“.

**Recherche** (Synthese-Forschung, Schriftgutachter):
- Jedes Vorkommen eines Buchstabens sieht anders aus („natürliche Variation“), bleibt aber erkennbar dieselbe Hand.
- Die Grundlinie wandert.
- Die Strichbreite lebt.
- Buchstaben werden teilweise verbunden.

Schrift entsteht aus schnellen Bewegungen: Nach dem Sigma-Lognormal-Modell (Plamondon) ist ein Zug eine Folge überlappender Stiftbewegungen mit lognormalem Tempo. Variation entsteht realistisch, wenn man die Bewegungsparameter verändert, nicht das Bild. Bis E216 haben wir genau das Falsche getan: eine Druckschrift-Vorlage (Hershey) verbogen. Dazu kamen Zierklammern aus dem Schriftsatz und ein Komma, das aussah wie ein Punkt.

**Neu (`apps/rechenraum/handbewegung.py`, nur NumPy):**
- **Bewegungsmodell:**
  - Schlüsselpunkte (Ramer-Douglas-Peucker), Ziele mit zusammenhängendem Fehler, je Strecke eine Lognormal-Bewegung.
  - An Kurven überlappen die Bewegungen stark (rund), an Ecken wenig, an Umkehrpunkten (n, m, k) gar nicht. Dort bleibt der Stift kurz stehen, und es entsteht eine Spitze.
  - Die Punkte liegen in gleichen Zeitabständen (10 ms), der Punktabstand ist also das Tempo. Das Zeichnen macht daraus eine milde Strichbreite wie in GoodNotes; An- und Absetzen werden nach Weglänge dünner.
  - Je Dokument eine `Schreibart` (Tempo, Weichheit, Rundung, Genauigkeit).
  - Auch gerade Buchstabenteile (l, i, Großbuchstaben) laufen durchs Modell. Lineal-gerade bleiben nur Linien aus `Hand.linie()` (Tabellen, Bruchstriche).
- **Eigene Skelette:**
  - Alle Kleinbuchstaben in echter Schreibreihenfolge: a, d, g, q als Bogen und Stamm in einem Zug; n, m, h, r als Stamm, zurück, Bogen.
  - Formvarianten mit Lieblingsform je Schreiber (80 %): a, d, i, l, t mit oder ohne Schwung, y gerade oder rund, g, k, f, b, p.
  - Klammern `{ } ( ) [ ]` schlicht in einem Zug, Komma mit Schwanz, Punkt und Doppelpunkt auf der Grundlinie (Hershey lässt sie schweben), ≥ ≤ mit einem Strich.
- **Teilweise verbunden** (Neigung je Schreiber 30–70 %):
  - Verbunden wird unten aus dem Buchstaben heraus, schräg hinauf in e, i, j, m, n, p, r, u.
  - Nie verbunden wird in runde Buchstaben (die Verbindung kreuzte den Bogen) oder aus c, o, r, v, w.
  - Keine Minimen-Ketten: „un“, „an“, „ar“ lesen sich verbunden wie „w“, „on“, „ae“. In m, n, p, r wird nur nach e, l, t, k, z verbunden.
- **Rhythmus:** Die Grundlinie läuft als Zufallsweg durch die Zeile, statt jedes Wort unabhängig springen zu lassen.

**Beim Prüfen mit drei Schreibern gefunden und behoben (betrifft auch Leifs Probe):**
- **Abstand-Profil:**
  - Gerade Striche wurden unabhängig von ihrer Länge in fünf Stücke geteilt, lange Linien ließen Höhenbänder aus. Folge: M rutschte in L.
  - Das Profil merkt sich alle früheren Buchstaben. Ein Komma richtete sich nach dem e zwei Stellen vor dem d („derive,d“). Jetzt darf ein Zeichen den direkten Vorgänger höchstens 0,3 em unterschneiden, Satzzeichen gar nicht.
  - Anführungszeichen werden nach dem Rechteck gesetzt.
  - Nach r ist die Luft kleiner, aber nicht so klein, dass „rn“ als „m“ gelesen wird.
- **Tupfer:** Kurze Tupfer (Punkte) werden kräftig gezeichnet, statt durch das Ausdünnen zu verschwinden.
- **Ein Test prüfte gar nichts:** `test_linien_sind_gerade_wie_in_goodnotes` setzte wegen `r"\\frac"` keinen Bruch und lief nur zufällig durch. Er ist korrigiert.

**Mit den Schriftproben für Leif (Mathe und Tabellen) gefunden:**
- Die obere Grenze eines Formelzeichens (∑) ragte in den Index der Zeile darüber (lim n→∞). Das Layout merkt sich jetzt die echte Unterkante der vorigen Zeile und rückt um ganze Kästchen weiter.
- Die obere Integralgrenze klebte am Haken.
- Griechische Buchstaben im Text, etwa in einer Tabellenzelle, galten als unbekannt.

**Kosten:** Eine volle A4-Seite braucht etwa 1,2 s statt 0,3 s; das SVG ist etwa 1 MB groß. PNG und PDF entstehen daraus wie bisher.

**Ehrlich:**
- Es bleibt eine Druckschrift mit Verbindungen, keine volle Schreibschrift.
- Lesbarkeit geht vor Natürlichkeit: Riskante Verbindungen sind bewusst verboten.
- Leifs Schriftprobe (E216) hat weiter Vorrang, wenn er sie schreibt. Ihre Striche fasst das Modell nicht an.
- Quellen: Plamondon et al. (Kinematic Theory, Sigma-Lognormal), Haines et al. „My Text in Your Handwriting“ (UCL 2016), Arbeiten zur Handschriftenprüfung (natürliche Variation, Verbindungen). Übernommen wurde kein Code, nur das Modell.

## E218 – Bürgermeister höchstens 0,50 $ am Tag: Abo + Haiku (23.11.)

Leif: „Mach, dass der Bürgermeister max. 0,50 $ pro Tag braucht. Günstigeres Modell oder dass die Sachen, die er macht, immer über das Abo gemacht werden.“ Gewählt: „Abo + Haiku“.

**Vorher:**
- Was Leif selbst anstieß, lief schon über das Abo (claude-code), ebenso die Helfer (E56).
- Geld kosteten drei Dinge:
  - das selbstständige Aufwachen (Lagebericht, Rundgang) über die API mit Opus 5.5, Budget 5 $;
  - die Systemaufrufe ohne Werkzeuge (Post-Einordnung alle 10 min, Zeitung, Wochenrückblick, Bank, Teilschritte) mit Sonnet 5.5;
  - die Post-Einordnung lief sogar über das Budget hinaus.

**Neu:**
- **Aufwachen über das Abo:** `aufwachen.md` → `denken_ueber: abo` (Standard; `api` = alter Weg).
  - Läufe mit Auslöser `zeitplan` im Chat des Bürgermeisters nehmen dann den Motor seiner Aktion (claude-code).
  - Das API-Budget bremst ihn nicht mehr, und der Rundgang-Katalog wählt wie mit vollem Budget. Die Häufigkeit bremst weiter.
  - Der Notschalter `alle_auf` übersteuert wie bisher.
- **Systemaufrufe mit Haiku 5.5** (`modelle.md` → `system`, Standard auch ohne den Schlüssel).
  - Preis laut Anthropic-Doku: 0,10/0,50 $ je Mio. Token bei Prompts bis 100K.
  - Ohne `fallbacks`: Für Haiku 5.5 gibt es keinen serverseitigen Fallback. Laut Doku soll man das Feld bei Haiku nicht senden.
  - Strukturierte Ausgaben (`output_config.format`) gibt es bei Haiku 5.5 weiterhin.
- **Harte Tagesgrenze** `tagesbudget_usd: 0.5` für alles, was ohne Leifs Klick noch über die API geht:
  - Ist sie erreicht, wirft `SystemAufrufe` `BudgetErreicht`, ohne Aufruf und ohne Buchung.
  - Die Post zählt das nicht als Fehlversuch und ordnet am nächsten Tag ein.
  - Zeitung und Rückblick erscheinen dann ohne KI-Teil.
- **Leifs Klicks bleiben außerhalb des Budgets.** „In Schritte zerlegen“ läuft mit seiner Stufe (klein) und wird als `klick` verbucht.
- Die App zeigt im Schreibtisch „(er selbst denkt über dein Abo)“.
- Vorlagen: `aufwachen.md` (E192-Fassung) und `modelle.md` werden aktualisiert, wenn Leif sie nicht geändert hat.

**Ehrlich:**
- Das Aufwachen verbraucht jetzt Abo-Kontingent, auch nachts (alle 3–7 h, nur wenn es etwas Neues oder einen Rundgang gibt).
- Ist die Werkstatt nicht erreichbar, scheitert ein Aufwachen-Lauf, statt auf die API auszuweichen.
- Hat Leif `aufwachen.md` selbst geändert, bleibt sein `tagesbudget_usd` stehen. `denken_ueber` ist dann trotzdem `abo` (Standard, wenn der Schlüssel fehlt).

## E219 – Saxo: Anmeldung nachvollziehbar und robuster (23.11.)

Leif: „Ich kann mich noch immer nicht mit Saxo verbinden. Schau nochmal, ob das alles richtig läuft.“

**Geprüft:** Der Ablauf entspricht Saxos Doku zum Authorization Code Grant:
- `/authorize` und `/token` auf `live.logonvalidation.net`;
- App-Schlüssel und Secret als HTTP-Basic;
- `redirect_uri` muss exakt der in der Saxo-App eingetragenen Adresse entsprechen.

Vom Code aus ist nicht zu sehen, woran es bei Leif scheitert: Das Dorf auf dem Server ist von hier nicht erreichbar, es gibt keine Protokolle. Gefunden wurden drei Schwächen, die eine fehlgeschlagene Anmeldung unsichtbar oder wahrscheinlicher machten:

- **Kein Grund sichtbar.**
  - Bei einer Ablehnung durch Saxo stand nur „abgelehnt (400)“. Saxos Begründung (`error`, `error_description`) wurde verworfen.
  - Kam Saxo mit `?error=…` zurück, wurde gar nichts gespeichert. Die App sagte nur „hat nicht geklappt“.
  - Jetzt steht Saxos Grund im Fehler unter Börse → Saxo: gekürzt, eine Zeile, nur druckbare Zeichen.
- **Zweimal geklickt:** Es gab nur EINE offene Anmeldung. Ein zweiter Klick (z. B. Handy und PC) machte die erste ungültig. Jetzt gelten bis zu 5 offene Anmeldungen, jede 15 min und genau einmal.
- **Rückweg ins Dorf:**
  - Saxo leitet von einer fremden Seite zurück. Bei einer Weiterleitungskette (303) schickt der Browser das Dorf-Cookie (`SameSite=Strict`) nicht mit, man landete auf der Anmeldung.
  - Jetzt antwortet `/api/boerse/saxo/rueckruf` mit einer kleinen Seite, die selbst weiterführt. Dieser Schritt gilt als „same-site“.
  - Das Ziel ist die Börsenseite `/gebaeude/Boerse?saxo=…` statt `/?g=Boerse`. Diese öffnete die Börse nur in der 3D-Ansicht.
- **Zum Vergleichen:** Solange keine Verbindung besteht, zeigt die App die genaue Redirect-URL, die das Dorf schickt, und den Anmelde-Server (live/Simulation).

**Offen:**
- Was genau bei Leif schiefgeht, zeigt erst der nächste Versuch: entweder Saxos Grund in der App, oder eine Fehlerseite bei Saxo selbst, dann stimmt meist die Redirect-URL nicht.
- In `EINRICHTUNG.md` stand Leifs echte DuckDNS-Adresse. Das Repo ist öffentlich. Ersetzt durch Platzhalter; in der Git-Geschichte steht sie weiter.

## E220 – To-do-Brett: zugeklappt, nach Frist, neuer Look (23.11.)

Leif: Die Tags sollen nur sichtbar sein, wenn man ein To-do aufklappt. Die Liste soll standardmäßig nach Deadline sortiert sein und cooler und übersichtlicher aussehen.

- **Zugeklappt** steht nur Stern, Häkchen, Titel, Frist (kurz: „heute“, „morgen“, „Mi.“, „05.12.“, „seit 3 T.“; ⏳ bei „wartet“) und ein Pfeil. Haben die Teilschritte einen Fortschritt, zeigt ihn ein dünner Balken.
- **Aufklappen:** Ein Klick auf den Titel klappt auf. Dann stehen da alle Abzeichen (Energie ausgeschrieben, Dauer, Fokus, Wiederholen, Gruppe, Gebäude, Quelle …) und alle Knöpfe, jetzt mit Text: Bearbeiten, Schritte, Fokus, Zeit finden, Etappen, Preise, Notiz öffnen.
  - Vorher öffnete der Titel direkt das Bearbeiten-Formular, jetzt geht das über „✏️ Bearbeiten“.
  - Aufgeklappt bleibt aufgeklappt, auch wenn die Zeile nach einer Änderung neu gebaut wird (wie bei den Schritten).
  - Die Bürgermeister-Liste im Rathaus behält die einfache Zeile.
- **Sortierung:** Standard ist „Nach Frist“: Frist aufsteigend, bei gleicher Frist ⭐ zuerst, ohne Datum am Ende. Der Server sortierte bisher ⭐ vor Frist.
  - Wählbar ist auch „⭐ zuerst“ (die alte Reihenfolge), „Neueste zuerst“ und „Nach Gruppe“. Die Wahl merkt sich das Gerät.
  - Wie der Filter gilt die Wahl nur, solange die Filterleiste sichtbar ist (ab 6 offenen To-dos), sonst gibt es keinen Weg zurück.
  - Einkaufsliste und andere gruppierte Listen bleiben nach Abteilung sortiert.
- **Abschnitte:** Bei „Nach Frist“ gibt es Überschriften mit Zahl: Überfällig, Heute, Morgen, Nächste 7 Tage, Später, Ohne Datum. Bei „Nach Gruppe“ gibt es eine Überschrift je Gruppe.
- **Look:**
  - Karte mit Farbstreifen links nach Dringlichkeit: rot überfällig, orange heute, gelb morgen, blau nächste 7 Tage, grau später.
  - Die Frist als farbige Pille.
  - Am Handy steht die Frist unter dem Titel, damit der Titel die ganze Breite hat.

**Saxo (Nachtrag zu E219):** Leifs Versuch endete bei Saxo mit `invalid_request – Value of redirect_uri parameter is not registered`. Die Adresse, die das Dorf schickt, steht also nicht (genau so) in seiner Saxo-App. Das ist eine Einstellung bei Saxo, kein Fehler im Dorf. Darum:
- Der Prüfkasten unter Börse → Saxo ist jetzt immer aufgeklappt, solange keine Verbindung besteht.
- Er hat einen „Kopieren“-Knopf für die Redirect URL.
- Er nennt genau diese Saxo-Meldung.

## E221 – Agenten pflegen die Notenliste (23.11.)

Leif bat den Bürgermeister, die Noten aus einem KUSSS-Screenshot in seine Notenübersicht zu übernehmen und „sehr gut“ usw. als Zahlen dazuzuschreiben. Das scheiterte dreimal, und Leif fragte, warum dem Bürgermeister schon wieder Rechte fehlen.

**Ursache:**
- Die Ansicht Uni → Noten (E98) liest genau `Uni/noten.md` mit Frontmatter `faecher: [{fach, ects, note, semester}]`. Es gab aber kein Agenten-Werkzeug dafür.
- `vault_schreiben` legt nur neue Dateien im eigenen Gebäude an, mit Namen nach Schema (Datum). Der Helfer schrieb deshalb `Uni/2026-11-23_1900_noten.md` in einem eigenen Tabellenformat, das die Ansicht nicht kennt.
- Der Bürgermeister kannte das Format nicht und schickte Leif los, „ein Fach in der App anzulegen“. Leif musste also selbst Hand anlegen, genau das Gegenteil von E185.

**Lösung:** Drei Werkzeuge für **jeden** Agenten (wie `todo_*`), nur über den Notendienst (feste Datei, Zod-geprüft):
- `noten_lesen`: liefert Fächer, Schnitt, ECTS und fehlende Fächer.
- `noten_eintragen`: bis 100 Fächer je Aufruf, in einem Schreibvorgang.
  - Gleicher Name ändert ein Fach (Groß-/Kleinschreibung egal), ein neuer Name legt es an.
  - Die Note darf eine Zahl 1–5 sein oder eine KUSSS-Bezeichnung: sehr gut 1, gut 2, befriedigend 3, genügend 4, nicht genügend 5. „mit Erfolg teilgenommen“ zählt als bestanden ohne Note, null als offen.
  - Unbekannte Bezeichnungen werden abgelehnt, ohne dass etwas geschrieben wird. Es wird nicht geraten.
- `noten_entfernen`: streicht ein Fach aus der Liste.

Jede Änderung legt die alte Fassung ins Archiv des Gebäudes und kommt leise in „Rückgängig“ (Art `datei_geaendert`; wurde die Datei seither geändert, wird nichts überschrieben).

Keine Freigabe nötig: Die Liste gehört Leif, die Änderung ist zurückholbar (E185). Der Systemprompt sagt: Noten nur so, nie per `vault_schreiben`.

## E222 – Depot-Bewegungen für Agenten + „📈 Saxo gestern“ in der Morgenzeitung (23.11.)

Leif hat Saxo verbunden und wollte zwei Dinge: Werkzeuge, mit denen Agenten ihm Bewegungen seiner Positionen erklären können, und ganz unten in der Morgenzeitung einen kurzen Bericht, was gestern auf dem Konto passiert ist und womit sich das erklären lässt (Schlagzeilen).

**Tagesstände statt neuer Saxo-Schnittstellen:**
- Bisher gab es nur den jeweils letzten Stand (alle 30 min überschrieben). Jetzt merkt sich das Dorf zusätzlich den letzten Stand **jedes Wiener Kalendertags** (`saxo_tage` in `dorf_stand`, 120 Tage): Kontowert sowie je Position Stück, Kurs und Wert.
- Eine Bewegung ist der Vergleich mit dem letzten Stand davor. Daraus ergeben sich die Wertänderung je Position, die Kursänderung in % und Käufe/Verkäufe (Stück vorher → nachher, neue oder verschwundene Positionen).
- Die Leine bleibt bei den 4 GET-Pfaden aus E73. Transaktions- oder Order-Endpunkte bindet das Dorf bewusst nicht an („nichts erfinden“, nur lesen).
- Erste Tage ohne früheren Stand: Die Änderung je Position kommt aus Saxos `InstrumentPriceDayPercentChange`, der Kontowert des Vortags aus der Performance-Reihe. Das wird so gekennzeichnet.

**Werkzeuge für jeden Agenten:**
- `depot_lesen`: Stand, Positionen, Rendite.
- `depot_bewegungen {von, bis}`: Standard gestern, höchstens 31 Tage.
- Beide lesen nur den gespeicherten Stand, kein eigener Abruf bei Saxo.
- Der Systemprompt sagt dazu: Erklärungen per Websuche, jede mit Quelle und Datum; Vermutung als Vermutung kennzeichnen; nie Kauf- oder Verkaufsempfehlungen.
- Web plus Depotdaten im selben Lauf hat Leif mit E185 bewusst erlaubt.

**Morgenzeitung, letzter Abschnitt „📈 Saxo gestern“:**
- Die Zahlen kommen vom Code: Kontowert ± seit dem Vortag, Käufe/Verkäufe, die drei größten Ausschläge.
- Das „Warum“ liefert ein Helfer, weil Schlagzeilen eine Websuche brauchen. Das soll nicht über die API und das Haiku-Budget (E218) laufen, sondern über Leifs Abo. Darum gibt es die neue Aktion **Boerse/Depot-Tagesbericht**:
  - claude-code, Stufe mittel, mit Web.
  - Läuft Di–Sa um 05:00 und schreibt nach `Boerse/00_Tagesbericht.md` (mit Archiv).
  - Frontmatter `tag:` (gestern), dazu `## Für die Zeitung` und `## Im Detail`.
- Die Zeitung (06:30) übernimmt „Für die Zeitung“ (höchstens 5 Zeilen) nur, wenn `tag` gestern ist. So steht kein veraltetes „Warum“ unter frischen Zahlen.
- Ruhige Wochenendtage (nichts gehandelt, keine Bewegung ≥ 1 €) fehlen in der Zeitung.

## E223 – Börse: Analyse über alle Zeiträume, Rechner, Aktien-/ETF-Berater (24.11., Nacht)

Leif (bis 8:00 ohne Rückfragen): In der Börse soll „ganz viel möglich“ sein. Das Depot soll sich über alle möglichen Zeiträume betrachten lassen, jeder Teil einzeln und ein- und ausblendbar, dazu weitere eigene Ideen. Außerdem sollen Aktien- und ETF-Berater eingebaut werden („ich weiß, Claude ist kein Anlageberater“).

**Daten (Server):**
- **Saxo-Konto:** Die Performance-Reihe (Kontowert + zeitgewichtete Rendite) holt das Dorf jetzt über 10 Jahre statt einem. Lehnt Saxo das ab, nimmt es wie bisher 1 Jahr. „12 Monate“ rechnet jetzt gegen den Wert vor einem Jahr, nicht gegen den Anfang der Reihe.
- **Kursverläufe je Wert:** Sie kommen über EODHD `/eod/{Kürzel}?from=…`, denselben Endpunkt, den die Tageskurse schon nutzen. Gespeichert werden sie je Kürzel in `dorf_stand` (`kurshist:<Kürzel>`, höchstens 12 Jahre). Ein Abruf je Kürzel.
  - Danach verlängern die täglichen Kursabrufe den Verlauf, ohne extra Abruf.
  - Nach den Tageskursen lädt das Dorf nebenbei höchstens 6 fehlende Verläufe; 3 Abrufe bleiben für Leifs Klicks frei. Das Limit von 19 am Tag wird nie überschritten.
  - Ein fehlgeschlagenes Kürzel wird leer gemerkt und erst nach 7 Tagen neu versucht, sonst kostet es jeden Tag einen Abruf.
- **Saxo-Positionen → EODHD-Kürzel:** Saxo liefert Symbole wie `NESN:xswx` (Börsenkennung nach ISO 10383). Die Tabelle MIC → EODHD-Endung steht in `boerse.ts`, unbekannte Börsen bleiben ohne Kürzel. Leif kann das Kürzel je Position selbst setzen (Analyse → Kursverläufe & Kürzel).
- **Ältere Werte einer Saxo-Position** = Kursverlauf × heutige Stückzahl × heutiger Umrechnungsfaktor, so auch in der App beschriftet. Ab dem Verbinden gelten die genauen Tagesstände (E222). Positionsgenaue Historie mit Käufen gibt es ohne Transaktions-Endpunkt nicht; den bindet das Dorf nicht an (nur lesen, nichts erfinden).
- `GET /api/boerse/analyse` liefert alles in einem: Konto-Reihe, Tagesstände, Positionen, eigenes Depot, Watchlist, Kursverläufe, Zuordnung. `POST /api/boerse/historie` lädt gezielt, `PUT /api/boerse/kuerzel` setzt ein Kürzel.

**Rechnungen** (`packages/shared/src/boerse.ts`, rein, getestet):
- Zeiträume 1W, 1M, 3M, 6M, YTD, 1J, 3J, 5J, Max und eigene Daten.
- Kennzahlen: Änderung in % und €, pro Jahr, größter Rückgang, Schwankung p. a., Hoch/Tief, bester/schlechtester Tag, Plus-Tage. Beim Konto zählt die zeitgewichtete Rendite, damit Einzahlungen nicht als Gewinn erscheinen.
- Monatsrenditen und Jahre, Summen, Index 100.
- Rechner: Sparplan mit Kosten, Dynamik und Inflation; Entnahme; Umschichten (Rebalancing, auf Wunsch nur kaufen); Kostenvergleich (TER); Sparziel; Konzentration (effektive Anzahl).

**App:** Börse hat drei neue Reiter.
- **Analyse:**
  - Zeitraum-Chips, Anzeige als Wert, % oder Index 100, Kennzahlen-Kacheln.
  - Diagramm mit Fadenkreuz und Tooltip für alle sichtbaren Reihen.
  - Tabelle aller Teile (Saxo gesamt, jede Position, Bargeld, eigenes Depot gesamt und je Position, Watchlist), je Teil ein- und ausblendbar, sortierbar. Optional „Summe der sichtbaren“.
  - Aufteilung nach Position, Art, Währung oder Depot, mit Klumpen-Hinweis.
  - Gewinner und Verlierer im Zeitraum, Monats-Heatmap mit Zahlen in jeder Zelle.
  - Zeitraum, Anzeige und Sichtbarkeit merkt sich das Gerät.
- **Rechner:** fünf Rechner; die Eingaben merkt sich das Gerät. Umschichten nimmt die echten Positionen.
- **Berater:** vier neue Aktionen (Vorlagen, claude-code, Stufe groß, Web + Depot-Werkzeuge, also über Leifs Abo): Aktie analysieren, ETF finden & vergleichen, Depot-Check (Ziel, Horizont, Risiko), Frag den Berater.
  - Schnellfragen aus dem eigenen Depot, zum Beispiel die größte Position oder der Wert, der sich heute am stärksten bewegt.
  - Die Berichte liegen in `Boerse/berater/`.
  - Die Berater sollen klar Stellung beziehen, so wie Leif es will („keine Ausflüchte“). Sie nennen Quellen mit Datum und sagen einmal, dass sie keine zugelassene Anlageberatung sind. Handeln kann das Dorf weiterhin nicht.
- **Beträge verbergen** (Privatsphäre, z. B. in der Bahn): ein Knopf in Depot und Analyse, gilt für die ganze Börse und wird vom Gerät gemerkt.
- Analyse, Rechner und Berater werden erst beim Öffnen geladen (eigenes Bündel).

## E224 – Aussehen: Farben, Schriften, Größen, Stile und Anzeigearten einstellbar (24.11., Nacht)

Leif: In den Einstellungen soll es ganz viele Möglichkeiten geben, das Aussehen von so ziemlich allem anzupassen: Farben, Stile, Größen, Schriftarten, Anzeigearten.

**Grundlage: alles läuft über Variablen.**
- `stil.css` hatte rund 400 fest eingetragene Farben. Die häufigen sind jetzt CSS-Variablen, umgestellt per Skript je Eigenschaft: Hintergrund-Weiß → `--flaeche`, Schrift-Weiß auf Farbe bleibt.
- Die übrigen hellen Tönungen laufen über `color-mix(… var(--hell-anteil), var(--flaeche))`. Im hellen Look ist der Anteil 100 %, also genau wie bisher; im Dunkelmodus 13 %, dadurch werden sie zu dunklen Tönungen. Dasselbe gilt für Rahmen und dunkle Schriftfarben.
- Der Spiel-Look ohne eigene Farben setzt keine einzige Variable: Er sieht genau aus wie vorher.

**Einstellungen → 🎨 Aussehen** (Live-Vorschau, Speichern oder Verwerfen):
- **11 Vorlagen:** Spiel (wie bisher), Schlicht, Nacht, Mitternacht, Pastell, Wald, Ozean, Abendrot, Papier, Terminal, Hoher Kontrast. Eine Vorlage setzt Farben und passenden Stil, zum Beispiel Terminal = Schreibmaschinenschrift ohne Schatten.
- **Farben:** 13 Rollen einzeln (Akzent, Hintergrund, Tafeln, Felder, Text, leiser Text, Rahmen, Linien, Plus, Minus, Warnung, Kopfleiste …) plus Akzent-Schnellwahl. Abgeleitete Töne (hell, dunkel, Schrift auf Akzent mit genug Kontrast) rechnet die App.
- **Schrift:** 7 Schriftarten nur aus Systemschriften, nichts wird nachgeladen; eigene Schrift für Überschriften; Größe 12–24 px (alles in rem wächst mit); Zeilenabstand; Stärke der Überschriften.
- **Form & Stil:** Ecken 0–28 px; Schatten (Spiel, weich, flach, keine); Rahmen (dick, dünn, keine); Knöpfe (Spiel, flach, Umriss, Pille); Hintergrund (Verlauf, einfarbig, Punkte, Karo, Linien); Abstände (kompakt, normal, luftig).
- **Anzeige:** Startseite (3D-Dorf, Liste, „Heute“); Seitenbreite; Tabellen (schlicht, Zebra, Gitter); Kopfleiste läuft mit oder bleibt oben; Bewegung (an, reduziert, aus); Fokus-Rahmen; **automatisch dunkel** (wie das Gerät oder nachts 20–7 Uhr) mit wählbarer dunkler Vorlage.
- **Eigenes CSS** für alles Übrige, höchstens 20 000 Zeichen. Der Server lehnt `@import` und `url(…)` ab, damit die App nichts von außen nachlädt. Es ist Leifs eigene App, gesetzt nur über seine Sitzung, und kein Agent hat dafür ein Werkzeug.
- **Teilen & sichern:** als Text kopieren und einfügen, alles zurücksetzen.
- **Nur dieses Gerät:** zum Beispiel das Handy dunkel und den PC hell. Das liegt dann im Gerät und geht dem gemeinsamen Aussehen vor.

**Speicher:** `GET/PUT /api/aussehen` (`dorf_stand` 'aussehen', Zod in `apps/server/src/aussehen.ts`, Live-Ereignis `aussehen.geaendert`). Die App merkt sich den letzten Stand im Gerät und wendet ihn in `main.tsx` vor dem ersten Zeichnen an, damit beim Laden nichts aufblitzt. Die Typen und Vorlagen stehen in `packages/shared/src/aussehen.ts`.

**Dazu in der Börse:** Ein Klick auf den Namen eines Teils zeigt nur diesen Teil (Diagramm und Kennzahlen). „⬇ CSV“ lädt die Tabelle für den gewählten Zeitraum herunter, mit Semikolon und deutschem Komma für Excel.

## E225 – Nachtrag zur Nacht: mehr Börse, mehr Aussehen (24.11.)

**Börse:**
- **Wie ähnlich laufen deine Werte?** Korrelation der Tagesrenditen im gewählten Zeitraum als Matrix, höchstens 8 Werte. Viele hohe Werte bedeuten, dass die Streuung weniger schützt, als die Zahl der Positionen vermuten lässt.
- **Einzeln ansehen:** Ein Klick auf den Namen zeigt nur diesen Wert. Im Wert-Modus zeichnet das Diagramm eine Linie beim Einstand (Kaufwert), damit man sofort sieht, ob man im Plus ist.
- **Rechner „Was wäre wenn“:** Einmalbetrag und/oder monatlich ab einem Tag in einen Wert mit echtem Kursverlauf (`wasWaereWenn` in shared, ohne Kosten, Steuern und Dividenden).
- Kennzahlen aller Teile werden nur neu gerechnet, wenn sich Daten oder Zeitraum ändern (schneller, vor allem am Handy). Die Seite bleibt am Handy so breit wie der Bildschirm; die Tabelle scrollt für sich.

**Aussehen:**
- **Schnellschalter 🌙/☀️** in der Kopfleiste, nur für dieses Gerät. Er überstimmt Vorlage und „automatisch dunkel“, bis man in den Einstellungen „Wieder automatisch“ wählt.
- **Navigation unten** am Handy (Daumen), **Buchstabenabstand** (eng, normal, weit), **Tafeln** als Tafel, Glas (durchscheinend, unscharfer Hintergrund) oder schlicht.
- Der Code-Editor im Codehaus folgt ohne eigene Wahl dem Aussehen (hell oder dunkel).
- **Später in der Nacht dazugekommen:**
  - **Mini-Verläufe** (3 Monate) je Position in Depot und Watchlist.
  - **🎯 Depot-Ziel** in der Analyse: Fortschrittsbalken über Saxo und eigenes Depot. Dazu, wann das Ziel mit Sparrate und Rendite voraussichtlich erreicht ist, und welche Rate für ein Wunschdatum nötig wäre. Das Gerät merkt es sich.
  - **Meine Looks:** eigenes Aussehen unter einem Namen speichern, höchstens 20 (`GET/PUT /api/aussehen/looks`, Zod).
  - **Diagramm-Farben:** standard, kräftig, pastell oder einfarbig.
  - **Links unterstrichen** an oder aus.
  - **Telegram `/depot`:** Saxo-Kontowert, Rendite seit Jahresbeginn und über 12 Monate, die zuletzt am stärksten bewegten Werte, „Gestern“ (E222), dazu das eigene Depot. Mit Link zur Analyse.

## E226 – Börse: Positionen mit 0 € und die Analyse im schmalen Fenster (24.11.)

Leif hat gemeldet, dass in der Analyse alle Saxo-ETFs mit 0,00 CHF stehen. Als Diagramm kam nur „Saxo-Konto gesamt“, und im Gebäude-Fenster des Dorfs wirkte die Ansicht seltsam: unten leer, die Spalten gequetscht.

- **Ursache 0 €:** Saxo liefert `MarketValueInBaseCurrency` bei Leifs ETFs (EUR-Werte, Konto in CHF) als **0**. Der Code nahm den ersten vorhandenen Wert (`??`), also auch die 0. Damit waren der Wert, der Anteil und der Umrechnungsfaktor für die Kursverläufe (Wert ÷ Kurs ÷ Stück) alle 0, und jede Positionslinie lag flach bei null.
- **Jetzt (`saxoWertWaehlen`, `werteErgaenzen` in saxo.ts):**
  - Es zählt der erste Wert **ungleich 0** aus `MarketValueInBaseCurrency` und `ExposureInBaseCurrency`. `MarketValue`/`Exposure` gelten nur, wenn die Position in Kontowährung ist.
  - Fehlt der Wert trotz Stück und Kurs, gilt: Stück × Kurs × Umrechnung.
  - Die Umrechnung kommt aus dem Gewinn in beiden Währungen. Fehlt der, nimmt das Dorf eine andere Position derselben Währung. Fehlt auch die, wird **Kontowert − Bargeld** anteilig nach Stück × Kurs verteilt. Das ist exakt, solange alle unbekannten Positionen dieselbe Währung haben, so wie bei Leif.
  - Nachgerechnete Werte tragen `geschaetzt: true` und stehen in der App mit „≈“.
  - Ältere gespeicherte Stände und Tagesstände werden **beim Lesen** repariert, ohne Migration. Für die Tagesstände nimmt das Dorf die Umrechnung je Währung aus dem aktuellen Stand.
  - Ein alter Test hatte einen EUR-Marktwert als CHF gezählt. Er erwartet jetzt die Summe, die zum Kontowert passt.
- **Diagramm:**
  - Tagesstände mit Wert 0 zählen nicht als Punkt.
  - Sichtbare Teile ohne Linie im Zeitraum werden jetzt **benannt**, mit dem Weg zu „Kursverläufe & Kürzel“; vorher fielen sie stumm weg.
  - Wer im Euro-Modus Gesamt und Positionen zusammen ansieht, bekommt den Knopf „in % vergleichen“.
- **Schmales Fenster:**
  - Die Ein/Aus-Kästchen waren absolut gesetzt, ohne Bezug in ihrer Zeile. Ihr Bezug war deshalb das ganze Gebäude-Fenster: Das Fenster (`overflow: hidden`) wurde scrollbar, und ein Klick schob den Inhalt nach oben weg. Das war der leere Bereich.
  - Die Abhilfe: `.ba-auge` und `.dorf-panel-inhalt` bekommen `position: relative`.
  - Die Analyse richtet sich per **Container-Query** nach ihrer eigenen Breite statt nach dem Bildschirm (Programm, Gebäude-Fenster). Unter 640 px entfallen die Spalten ab „€ im Zeitraum“, die Monats-Heatmap wird kompakt, Karten und Kacheln werden enger.
  - Namen stehen links.
- **Tests:**
  - Server: `e226-saxo-werte.test.ts`.
  - e2e: `boerse.spec.ts` „E226“ im echten Gebäude-Fenster. Geprüft wird: „≈“, der Hinweis, die ausgeblendeten Spalten, dass das Fenster selbst nie scrollt und dass nichts hinausragt.

**Nachtrag E226 (nach dem Deploy, Leifs zweiter Screenshot):** Leif sieht weiter überall 0,00. Darunter ist auch eine CHF-Position (UBS Core SPI), bei der eine Umrechnung keine Rolle spielt. Die Nachrechnung greift also nicht: Saxo schickt bei seinen Positionen offenbar auch **keinen Kurs** (vermutlich fehlen dem API-Zugang die Kursdaten). Belegt ist das nicht, also wird nichts erfunden.

- **Diagnose:** Bei jedem Abruf merkt sich das Dorf die einfachen Felder aus NetPositionBase, NetPositionView und DisplayAndFormat (`saxo_roh`, nur Zahlen und kurze Texte). In der Analyse stehen sie unter „Warum fehlen Saxo-Werte?“. Damit lässt sich am echten Konto sehen, was ankommt.
- **Bewertung mit Schlusskursen** (`mitSchlusskursen`, im Analyse-Endpunkt): Fehlt der Wert, gilt der letzte Schlusskurs von EODHD × Stück × EZB-Umrechnung in die Kontowährung. Die Quelle steht dabei („Schlusskurs VWCE.XETRA vom …“).
  - EZB-Kurse holt das Dorf jetzt auch für die Währungen des Saxo-Kontos (`saxoWaehrungen`).
  - Ohne Kurs, Schlusskurs oder Umrechnung bleibt die Position ohne Wert und zeigt „–“. Eine erfundene Zahl gibt es nicht.
- **Kursverläufe:**
  - Der Fehler je Kürzel wird gemerkt (`kurshist_fehler`) und steht in der App bei der Zuordnung.
  - Verläufe werden auch nachgeholt, wenn bei den Tageskursen etwas schiefging. Nur bei Tageslimit oder Schlüssel-Fehler bleibt das aus.
  - Der Verlauf je Position rechnet gegen den letzten Schlusskurs des Verlaufs, nicht mehr gegen Saxos Kurs.
  - Fehlt ein Verlauf, ist der Abschnitt „Kursverläufe & Kürzel“ von selbst offen.

## E227 – Hafen: Krypto-Bots im Paper Trading (24.11.)

Leif wollte mehrere Trading-Bots für Memecoins auf Pump.fun, jeden mit eigener Strategie und eigenem Wallet, um Strategien zu vergleichen. **Gebaut ist nur der erste Schritt, wie Leif es verlangt hat: Datenanbindung, Paper Trading, Protokoll, Dashboard.** Live-Trading kommt erst als eigene, letzte Etappe mit eigener Freigabe. Dann ist auch zu entscheiden, wie das zur Grundregel „Senden, Zahlen gibt es nicht“ passt.

**Aufbau**
- **Kryptowerk:** ein eigener Container, gleiches Image wie das Dorf, Einstieg `dist/kryptowerk.js`.
  - Eigene SQLite-Datenbank unter `/srv/dorf/krypto`, die ins Backup kommt.
  - Internet, aber kein Vault und keine Dorf-Geheimnisse, nur `KRYPTO_GEHEIMNIS` (`krypto.env`). Es gibt kein Wallet und keinen Schlüssel.
  - Netz `kryptonetz`, darin nur Dorf und Kryptowerk.
- **Das Dorf** reicht Leifs Klicks durch (`/api/krypto/*`, `krypto-dorf.ts`). Die App spricht nie direkt mit dem Kryptowerk.

**Daten:** Alle drei Quellen wurden am 24.11. gegen die echten Schnittstellen geprüft, mit echten Ereignissen und Antworten.
- **PumpPortal:** `wss://pumpportal.fun/api/data`. `subscribeNewToken` und `subscribeMigration` sind kostenlos und brauchen keinen Schlüssel. Es gibt EINE Verbindung, sonst sperrt PumpPortal.
  - Trades je Token kosten Geld (Schlüssel plus Wallet, 0,01 SOL je 10 000 Nachrichten). Darum nutzt das Dorf sie nicht.
  - Folge davon: Kurse nach dem Kauf kommen von DexScreener.
- **DexScreener:** `/tokens/v1/solana/{bis 30 Adressen}`. Erlaubt sind 300 Anfragen pro Minute; das Dorf nimmt sich höchstens 60.
  - Pump.fun-Paare haben `dexId: pumpfun`, `pairAddress` ist die Bonding Curve, und es gibt keine `liquidity`.
- **RugCheck:** `/v1/tokens/{mint}/report/summary`, ohne Schlüssel, laut Swagger ohne security.
  - Das Dorf schickt höchstens alle 2 s eine Anfrage, und nur für Kandidaten, die den Vorfilter eines Bots bestehen.
- KOL-Watch und X-Sentiment bleiben aus. Dafür bräuchte es den kostenpflichtigen Trade-Strom bzw. einen Grok-Schlüssel. Das Terminal sagt das so.

**Paper Trading (`kurve.ts`, `motor.ts`)**
- **Bonding Curve:** konstantes Produkt aus virtuellen Reserven, Start 30 SOL und 1,073 Mrd. Token, nachgeprüft an echten create-Ereignissen. Aus dem Kurs folgen die Reserven (vSol = √(K·p)).
- **Nach der Kurve:** PumpSwap mit den echten Pool-Reserven von DexScreener.
- **Gebühren** laut pump.fun/docs/fees: 1,25 % auf der Kurve, auf PumpSwap gestaffelt nach Marktwert. Dazu die Grundgebühr und eine Priority Fee je Transaktion.
- **Slippage** ergibt sich aus der Kurve bzw. dem Pool.
- **Verzögerung:** Ausgeführt wird zum ersten Kurs nach der Verzögerung (mindestens 300 ms, Standard 1500 ms), nie zum Kurs, den der Bot gesehen hat.
- **Fehlschläge:** Ein Teil der Transaktionen schlägt fehl (Standard 5 %); die Netzgebühr ist dann trotzdem weg.
- **Kein Hebel.**
- **Ausstieg:** Take-Profit-Stufen, Stop-Loss, Trailing Stop und eine Haltedauer, alles im Code.

**Strategie und Risiko**
- Die zwölf Prüfmodule (Rug, Dev, Bundle, KOL, X, Holder, Volumen, Sniper = Einstiegsfenster, Größe, TP, SL, Gate) sind Code.
- Ein **Regel-Bot** kauft ab einer Punktzahl.
- Ein **Prompt-Bot** fragt das LLM. Das Dorf ruft das System-Modell auf (Haiku 5.5, nur JSON `{action, token, confidence, reason}`).
  - Fremde Daten stehen in einer Hülle mit Zufallsmarke.
  - Grenze: höchstens 0,50 $ je Bot und Tag, gezählt an den echten Kosten (Auslöser `krypto`). Das zählt NICHT gegen das Tagesbudget für Post und Zeitung.
  - Zusätzlich gibt es eine Höchstzahl an Aufrufen je Bot und Tag.
- **Das LLM schlägt nur vor.** Kaufen darf erst, wer die Filter besteht, die Mindestsicherheit erreicht und durchs Risk-Gate kommt.
- **Das Risk-Gate prüft:** Not-Aus, schon im Bestand, offene Positionen, Tagesverlust (Equity seit Wiener Mitternacht), Kapital mit Gebührenpuffer.
- Die Positionsgröße ist der kleinere Wert aus Einsatz je Trade und Prozent des Kapitals.
- Einstellungen prüft Zod mit engen Grenzen (z. B. höchstens 20 offene Positionen, Verzögerung mindestens 300 ms, höchstens 90 % Fehlschläge).
- Das Startkapital ist nach dem ersten Trade fest, damit die Kennzahlen stimmen.

**Not-Aus:** in der App mit Rückfrage und per Telegram `/notaus`.
- Alle Bots werden sofort gestoppt, offene Positionen simuliert verkauft.
- Neue Bots starten während des Not-Aus gestoppt.
- Nach dem Aufheben bleiben die Bots pausiert, jeder wird einzeln gestartet.

**Protokoll und Kennzahlen**
- Gespeichert werden jede Entscheidung mit Begründung und Modulzeilen, jeder Trade mit Gebühr, Slippage und tatsächlicher Verzögerung, und die Equity jede Minute.
- Kennzahlen: Gewinn/Verlust, Trefferquote, max. Drawdown, Gebühren, geblockte Rugs.
- Was das Dorf aufzeichnet: neue Tokens immer, Kurse für Kandidaten und gehaltene Tokens. Daraus entsteht später der Backtest, denn historische Pump.fun-Daten gibt es nicht frei.
- Aufbewahrung: 14 Tage für Kurse, 7 Tage für Halte- und Sperr-Entscheidungen.

**App**
- **Gebäude „Hafen“** mit eigenem 3D-Modell (Hafenmeisterei, Becken, Steg, Boot, lila Leuchtfeuer).
- **Reiter Flotte:** Vergleichskurve (Start = 100, eine Achse, feste Farbe je Bot), Bot-Karten, Formular für Regeln oder Prompt, Not-Aus.
- **Terminal „Kielwasser“** (`/hafen/<id>`), dunkel, Lila als Akzent, Daten in Monospace:
  - Kopfzeile mit laufender Uhr und Online-Punkt
  - Token-Pillen und Stunden-Leiste
  - 15-Minuten-Kerzen der Equity mit Startlinie und Karte zum letzten Trade („1× – kein Hebel“)
  - der Kern mit den zwölf Modulen auf einer Ellipse; leuchten und wandern nur bei echten Signalen
  - Volumen, X-Feed, PnL, Entscheidungen und Trades
  - Die Ansicht richtet sich per Container-Query nach dem Platz; auf schmalen Bildschirmen steht alles untereinander.

**Live-Probe:** Das Kryptowerk lief hier 2,5 Minuten gegen die echten Quellen. Es kamen etwa 4–5 neue Tokens pro Minute an, DexScreener-Kurse kamen an, der SOL-Kurs lag bei rund 70 $. Kein Token bestand die vorsichtigen Standardfilter, darum wurde nichts gekauft.

**Tests:** `e227-krypto.test.ts` (Kurve, Gebühren, Module, Gate, ganzer Ablauf mit Verzögerung/TP/Trailing/SL/Fehlschlag/Rug/Not-Aus/Prompt-Bot, Schnittstelle, Quellen-Parser mit echten Antwortformen), `e227-hafen.test.ts` (Durchreiche, Bewertung mit Budget je Bot, Telegram), e2e `hafen.spec.ts` (Flotte, Formular-Fehler, Not-Aus-Rückfrage, Terminal auf Desktop und Handy).

**Offen:** Backtest auf den Aufzeichnungen (K5); X-Sentiment (Grok-Schlüssel) und KOL-Watch (PumpPortal-Schlüssel) auf Wunsch; Live-Trading mit eigenem Wallet je Bot erst nach eigener Etappe und Freigabe.

## E228 – Hafen: Testen → Backtest → scharf schalten (24.11.)

Leif will Strategien erst testen und dann einen Bot mit einem angebundenen Wallet „scharf“ schalten. Seine Entscheidungen von heute:
- Ausführung über **PumpPortal Local**: Das Kryptowerk signiert selbst, der Schlüssel bleibt auf dem Server, 0,5 % je Trade.
- Als Solana-Zugang (RPC) dient **Helius** (kostenlose Stufe).
- Ausgezahlt wird nur an **eine feste Adresse auf dem Server**.
- Die Bot-Schlüssel kommen **verschlüsselt ins Backup, der Hauptschlüssel nicht**.

Das ist eine bewusste Ausnahme von der Grundregel „Senden, Zahlen gibt es nicht“ – ähnlich wie das Codehaus (E191). Sie gilt nur für Bots, die Leif selbst scharf schaltet, und nur über das Kryptowerk.

**Testen (Paper)**
- Paper rechnet jetzt die 0,5 % von PumpPortal mit ein. Laut pumpportal.fun/fees wird sie vor der Slippage berechnet. Damit entsprechen Paper-Ergebnisse dem, was live herauskäme.
- Die Gebühren werden nach Art getrennt (Pump.fun, PumpPortal, Netz/Priority). Dazu kommt der Umsatz, also Käufe plus Verkäufe.
- Im Terminal gibt es einen CSV-Export der Trades.

**Aufzeichnung und Backtest (`backtest.ts`)**
- Aufgezeichnet werden alle beobachteten Tokens: Kandidaten bei jedem Abruf, alle anderen höchstens alle 30 s. Dazu ein Rug-Verlauf (`rug_verlauf`).
- Der Backtest lässt dieselbe Maschine (`Kryptowerk`) mit schneller Uhr über die Aufzeichnungen laufen. Filter, Gate, Gebühren, Slippage, Verzögerung und Fehlschläge sind identisch; der Zufall ist fest, also gibt jeder Lauf dasselbe Ergebnis.
- Es gibt keinen Blick in die Zukunft: Ein Kurs oder Rug-Bericht zählt erst ab seiner Zeit, ein Kurs höchstens 60 s lang.
- Es gehen nur Regel-Bots, weil sich LLM-Antworten nicht wiederholen lassen. Prompt-Bots testest du im Paper.
- Ehrliche Grenze: Die Aufzeichnung enthält Kurs-Schnappschüsse, keine einzelnen Trades. Und Rug-Berichte gibt es nur für Tokens, die damals ein Bot in die engere Wahl nahm.

**Wallets (`wallet.ts`)**
- Jeder Bot bekommt beim Anlegen ein eigenes, neu erzeugtes Wallet (`Keypair.generate`). Bots, die schon vorher existierten, bekommen es beim nächsten Start.
- Der private Schlüssel liegt nur AES-256-GCM-verschlüsselt in der Datenbank des Kryptowerks; die Adresse dient als zusätzliche Prüfung beim Entschlüsseln.
- Der Hauptschlüssel `KRYPTO_HAUPTSCHLUESSEL` steht nur in `/srv/dorf/krypto.env`. Die Datei ist nicht im Backup, wird von `dorf` nie neu geschrieben, nur ergänzt, und gibt es schon Wallets, wird kein neuer Hauptschlüssel erzeugt.
- Der Schlüssel verlässt das Kryptowerk nie: kein Log, kein LLM, keine App, kein Dorf. Er wird nur für den Moment des Signierens entschlüsselt.
- Wird ein Bot gelöscht, bleibt sein Wallet archiviert. Löschen geht nicht, solange Guthaben bekannt ist.
- Für Phantom gibt es den Export nur auf dem Server (`dorf krypto-export`).

**Scharf schalten**
- Nur in der App, mit Passwort (und TOTP, wenn eingerichtet; nach 5 Fehlversuchen 15 min Sperre) und getipptem `SCHARF`.
- Voraussetzungen: mindestens 24 h im Paper, keine offenen Positionen, ein RPC ist eingerichtet, und im Wallet liegt mindestens Budget + 0,02 SOL.
- Das Budget (0,05–50 SOL) ist das Startkapital des Live-Abschnitts. Die Paper-Bilanz wird gemerkt, die Kennzahlen beginnen neu.
- Entschärfen geht ohne Passwort, weil es sicherer macht – aber nur ohne offene Positionen.

**Ausführung (`ausfuehrung.ts`)**, gegen die PumpPortal-Doku geprüft:
1. `POST /api/trade-local` mit publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee und `pool: auto`.
2. Das Kryptowerk signiert **nur, wenn das Bot-Wallet die Transaktion bezahlt**.
3. Senden über Leifs RPC, bestätigen (höchstens 60 s).
4. SOL- und Token-Änderung aus der bestätigten Transaktion lesen. Das sind echte Zahlen inklusive Konto-Miete.

Dazu gilt:
- Ein Live-Kauf wird genau einmal versucht und zählt bis zum Ergebnis gegen Budget und offene Positionen. Ein Verkauf wird wiederholt, bis er klappt.
- Vor jedem Kauf prüft das Kryptowerk das echte Guthaben.
- Not-Aus verkauft echt. Kommt er, während ein Kauf noch unterwegs ist, wird danach sofort verkauft.
- Das Risk-Gate (Einsatz, Tagesverlust, offene Positionen) gilt unverändert, jetzt gegen das Budget.

**Auszahlen:** Das ganze Guthaben geht nur an `KRYPTO_AUSZAHLUNG` (`dorf krypto-auszahlung`), mit Passwort/TOTP und nur, wenn der Bot nicht scharf läuft.

**Neue Befehle in `dorf`:** `krypto-rpc`, `krypto-auszahlung`, `krypto-hauptschluessel` (zum Sichern im Passwortmanager), `krypto-hauptschluessel-setzen` (Wiederherstellen), `krypto-wallets`, `krypto-export`.

**Abhängigkeit:** `@solana/web3.js` (offizielle Solana-Bibliothek) und `bs58`. Sie bringen alte `@types/node` mit. Ein pnpm-Override hält die Typen auf dem Stand des Projekts.

**Tests**
- Server, `e228-live.test.ts`:
  - Wallet: Verschlüsselung, falscher Schlüssel, Export, Archiv.
  - Ausführung gegen Nachbauten von PumpPortal und RPC, mit echten Solana-Transaktionen: Anfrage wie in der Doku, Signatur mit dem Bot-Schlüssel, Weigerung bei fremdem Zahler, Fehlschlag.
  - Scharf schalten mit allen Bedingungen, Live-Kauf und -Verkauf, Not-Aus, Auszahlen und Entschärfen.
  - Backtest; Dorf-Route nur mit SCHARF und Passwort.
- Ein gefundener Fehler wurde behoben: Ein Live-Kauf konnte zweimal ausgeführt werden.
- e2e: Backtest, Scharf-Dialog (Knopf erst mit SCHARF und Passwort, falsches Passwort zeigt eine Meldung), Terminal im Live-Modus mit Transaktions-Link und CSV.
- **Nicht getestet:** echte Trades. Das geht hier nicht ohne echtes Geld. Leif sollte mit sehr kleinem Budget anfangen.

## E229 – Rechenraum: scikit-learn (24.11.)

Ein Uni-Agent sollte eine Aufgabe mit dem Wine-Datensatz und einem Random Forest (`random_state=327`) vorrechnen. Das ging nicht, weil scikit-learn im Rechenraum fehlte. Er hat richtig gehandelt und keine Zahlen geschätzt.

**Warum der Agent das nicht selbst installieren darf**
- Das ist Absicht (E34, E190). Der Rechenraum hat kein Internet, ein nur lesbares Dateisystem und ein festes Image mit Prüfsummen.
- Dort laufen Befehle, die Agenten nach dem Lesen fremder Inhalte (Mails, Moodle, Anhänge) schreiben. Ein Agent, der Pakete nachladen kann, könnte auch Schadcode nachladen oder Daten hinausschicken.
- Neue Werkzeuge kommen deshalb ins Image, nicht zur Laufzeit.

**Jetzt**
- `scikit-learn==1.9.1` mit seinen Abhängigkeiten `joblib`, `cloudpickle` (joblib 1.6 bringt es nicht mehr mit – der erste CI-Rauchtest fiel daran, E228/E229 wurde darum erst mit E230 ausgeliefert), `threadpoolctl` und `narwhals` als fertige Wheels, mit fester Version und Prüfsumme (`--require-hashes`, wie E199).
- numpy und scipy kommen weiter aus Debian 12 (1.24.2 / 1.10.1) und erfüllen die Mindestversionen von scikit-learn 1.9.1.
- Die Beispiel-Datensätze (load_wine, load_iris …) liegen im Paket, also ohne Internet.
- Der Rauchtest in CI trainiert einen Random Forest auf dem Wine-Datensatz.
- Die Agenten wissen es, weil es in der Rechenraum-Zeile in `kontext.ts` steht.

**Wichtig fürs Vorrechnen:** Dieselben Zahlen wie der Tutor gibt es nur mit derselben scikit-learn-Version. Zwischen Versionen kann sich ein Random Forest trotz gleichem `random_state` unterscheiden. Nutzt die LVA eine andere Version, tragen wir sie hier ein.

## E230 – Paketwerk: Leif installiert Python-Pakete für den Rechenraum selbst (24.11.)

Leif wollte, dass fehlende Pakete nicht jedes Mal einen Deploy brauchen („bau ins Dorf ein Terminal ein, über das ich manuell Sachen installieren kann, und erklär den Agenten, was das ist“). Gewählt: **eigenes Paketwerk** statt einer Shell im Rechenraum selbst.

**So ist es gebaut**
- Container `paketwerk`: **dasselbe Image** wie der Rechenraum (gleiches Python, gleiche Systempakete), Runner im Modus `RECHENRAUM_MODUS=paketwerk`. In diesem Modus gibt es NUR die Konsole (`/konsole/start|stand|abbrechen|pakete`) – kein `/befehl`, kein `/werkzeug`, kein Vault, keine Arbeitsordner.
- Eigenes Netz `paketnetz` mit Internet (PyPI); es erreicht nur das Dorf. Schreiben kann der Container nur in `/pakete` (= `/srv/dorf/rechenraum-pakete`) und `/tmp`. Der Rechenraum bleibt **ohne Internet** und hängt `/pakete` **nur lesend** ein.
- Installiert wird mit `pip install --user` (`PYTHONUSERBASE=/pakete`, `PIP_USER=1`, `PIP_BREAK_SYSTEM_PACKAGES=1`). Der Rechenraum setzt `PYTHONUSERBASE` für Befehle und Werkzeuge, hängt `/pakete/bin` hinten an den `PATH` – die Pakete aus dem Image haben also Vorrang bei Programmen, bei Python-Modulen steht der User-Site vor den Debian-Paketen (so kann Leif eine andere Version eines Pakets bewusst installieren, z. B. die scikit-learn-Version der LVA).
- Ein Befehl zur Zeit (409 sonst), Ausgabe fortlaufend (Puffer 256 KB), Abbrechen, Zeitgrenze 15 min, Befehl ≤ 4000 Zeichen.
- Dorf: `/api/paketwerk*` (Sitzung + Origin über den allgemeinen Schutz, E203), App-Seite `/paketwerk` (Einstellungen → 🧪 Paketwerk) mit Konsole, Verlauf, Paketliste und „Entfernen“.

**Warum kein Agenten-Werkzeug**
- Begründung wie E229: Agenten lesen Fremdes (Mails, Moodle, Anhänge). Ein Agent, der Pakete aus dem Internet holt, könnte Schadcode in den Rechenraum bringen, in dem später alle Agenten rechnen.
- Darum schlagen Agenten nur vor: Befehl mit fester Version plus Link `/paketwerk?befehl=…`. Der Link setzt den Befehl nur in die Zeile, ausführen tut Leif selbst.

**Grenzen (ehrlich)**
- Nur Python-Pakete mit fertigen Wheels oder reinem Python. Pakete, die beim Bauen einen Compiler oder Systembibliotheken brauchen, oder `apt`-Pakete gehen nicht – die gehören weiter ins Image (Dockerfile, mit Prüfsumme).
- Was Leif installiert, ist nicht mit Prüfsumme festgelegt. Das ist seine bewusste Entscheidung pro Paket.
- `/srv/dorf/rechenraum-pakete` ist NICHT im Backup (kann groß werden, ist jederzeit neu installierbar). Nach einer Wiederherstellung die Befehle aus dem Verlauf im Paketwerk erneut ausführen.
- Ein Paket kann im Rechenraum nichts nach draußen schicken (kein Netz dort).

**Tests:** `apps/rechenraum/test/test_paketwerk.py` (Konsole, Ausgabe stückweise, einer zur Zeit, Abbrechen, Zeitgrenze, Paketliste, Rechenraum importiert aus `/pakete`, keine Konsole im Rechenraum und kein Rechenraum im Paketwerk), `apps/server/test/e230-paketwerk.test.ts` (Routen vor dem echten Runner: 401/403 auch kodiert, 409, Abbrechen, nicht eingerichtet/nicht erreichbar, kein Agenten-Werkzeug), `apps/web/e2e/paketwerk.spec.ts`, CI-Rauchtest: `pip install six==1.17.0` im Paketwerk, danach importiert ein Rechenraum ohne Netz das Paket nur lesend.

## E231 – Hafen-Werkzeuge für Agenten (24.11.)

Leif: „Haben die Agenten schon die nötigen Tools, um Bots anzulegen und im Papiermodus zu starten?“ – Nein, bis dahin bediente nur Leif den Hafen. Auf seine Freigabe („los“) mit meinen beiden Empfehlungen: **Not-Aus darf ein Agent ziehen** (macht nur sicherer, Leif wird sofort benachrichtigt) und **Paper-Bots ändern Agenten direkt mit „Rückgängig“** (kein echtes Geld).

**Werkzeuge** (`agenten/leine-hafen.ts`, `agenten/werkzeuge-hafen.ts`), für Aktionen mit `werkzeuge: [hafen]`, freie Helfer mit der Fähigkeit `hafen` und den Bürgermeister:
- `hafen_uebersicht`, `hafen_bot_lesen` – Kennzahlen nach Gebühren, Einstellungen, Positionen, Trades, Entscheidungen (Token-Namen und LLM-Gründe in der Fremdinhalt-Hülle, der Lauf gilt als „hat Fremdes gelesen“).
- `hafen_bot_anlegen` – immer Paper (ein eingeschmuggeltes `modus` wird verworfen, das Kryptowerk kennt beim Anlegen ohnehin nur Paper), Teil-Einstellung über `KRYPTO_STANDARD` gelegt, geprüft vom Kryptowerk (Zod strict). Höchstens 8 Bots in der Flotte, wenn ein Agent anlegt (Prompt-Bots kosten je bis 0,50 $/Tag). „Rückgängig“ löscht den Bot (das Kryptowerk verweigert es bei Live-Bots oder Guthaben im Wallet).
- `hafen_bot_aendern`, `hafen_bot_status` – nur Paper-Bots; „Rückgängig“ setzt die alte Einstellung zurück, aber nur, solange der Bot noch Paper ist.
- `hafen_backtest` – nur Regel-Bots.
- `hafen_notaus` – Meldung an Leif (App + Telegram) mit „Rückgängig“ = Not-Aus aufheben (Bots bleiben pausiert).

**Bewusst nicht vorhanden:** scharf schalten, entschärfen, auszahlen, Wallets/Schlüssel, Bots löschen, Not-Aus aufheben, Live-Bots ändern/starten/pausieren. Das bleibt Leifs Klick (Passwort/TOTP).

**Hafenmeister** (Leifs Wunsch, noch während E231: „jeden Tag einige Bots auf dem Papier anlegen, beobachten, in der Morgenzeitung berichten, neue leicht modifizierte anlegen und die alten löschen – über lange Zeit zum perfekten Bot“): Aktion `Hafen/hafenmeister` (täglich 06:05, `claude-code`/Abo, Stufe mittel). Ablauf wie eine Zucht: Logbuch lesen (`Hafen/hafenmeister-logbuch.md`, wächst per `vault_aendern`/anhängen – das Gedächtnis über Wochen), eigene Bots erst nach ≥ 24 h und ~15 Trades beurteilen, die schwächsten (≤ 2 je Tag) ins Logbuch schreiben und löschen, Nachfolger = Champion mit ein bis zwei geänderten Werten (vorher Backtest, wenn möglich), ab und zu ein mutiger Ausreißer. Bericht `Hafen/00_Flottenbericht.md` → Abschnitt „⚓ Hafen“ in der Morgenzeitung (nur wenn von heute).
- Dafür neu: `hafen_bot_loeschen` – NUR Paper-Bots, die ein Agent angelegt hat (Kennungen in `dorf_stand` `hafen_agentenbots`; Leifs Bots und Live-Bots nie; nicht zurücknehmbar, darum vorher ins Logbuch).
- Grenzen im Code: höchstens 6 eigene Bots der Agenten, davon höchstens 2 Prompt-Bots (je bis 0,50 $/Tag – bevorzugt Regel-Bots, die auch der Backtest prüft), Flotte insgesamt höchstens 12. Neue Arbeitsanweisung `Hafen/gebaeude.md` (alte Fassung per Hash ersetzbar). In der App lässt sich „Hafen“ beim Anlegen eines Skills ankreuzen.

**Tests:** `apps/server/test/e231-hafen-werkzeuge.test.ts` gegen ein echtes Kryptowerk (Motor + HTTP-Server): Leine, Zusammenführen, anlegen/ändern/Status/Rückgängig, Live-Bot unantastbar (auch per Rückgängig), nie ein Aufruf an scharf/entschärfen/auszahlen, Not-Aus mit Meldung und Aufheben, Grenze 8 Bots, Backtest nur Regeln, Morgenzeitung.

## E232 – Echtzeit-Kurse im Hafen (Helius-WebSocket, Bonding Curve) + Backtest hält das Kryptowerk nicht mehr an (24.11.)

Leif fragte, warum Bots in Videos „alle 20 Sekunden“ handeln und Kerzen im Sekundentakt haben. Antwort: derselbe Markt, aber ein Echtzeit-Strom aller Trades statt Kurs-Abfragen bei DexScreener (≤ 60/min, hinkt hinterher). Drei Wege geprüft (Quellen: pumpportal.fun/fees, helius.dev/docs/billing/plans, 24.11.2026):
- PumpPortal-Trade-Strom: seit 1. 5. 2026 0,01 SOL je 10 000 Trades + API-Schlüssel mit Wallet – bei 6–20 beobachteten Tokens grob 0,3–3 SOL/Tag (Hochrechnung). Zu teuer für Paper.
- Helius Enhanced WebSockets ab 49 $/Monat, LaserStream gRPC (Mainnet) ab 499 $/Monat.
- **Gewählt (Leif: „mach Weg 2“): Standard-WebSocket von Helius** (im kostenlosen Tarif, 20 Credits je MB): `accountSubscribe` auf die Bonding-Curve-Konten.

**Geprüft statt angenommen**
- Kontolayout aus der offiziellen IDL (`github.com/pump-fun/pump-public-docs`, `idl/pump.json`): Diskriminator `[23,183,248,55,96,216,172,96]`, dann u64 virtual_token/virtual_quote/real_token/real_quote/total_supply, bool complete (Offset 48). Echte Mainnet-Konten mit 49 und 151 Byte als Fixture (`test/fixtures/pump/bonding-curves.json`): Start genau 1,073e15 Roh-Token (6 Dezimalen) / 30e9 Lamports = unser K.
- Adresse = PDA `["bonding-curve", mint]` – gegen sechs echte PumpPortal-Paare (mint ↔ bondingCurveKey) nachgerechnet: alle gleich.
- Live gegen das öffentliche Mainnet: Bestätigung = Abo-Nummer, jede Änderung ≈ 520 Byte, Konten auch mit 166 Byte; **Kurven gegen andere Quote-Token gibt es** (quote_mint ≠ Nullen/SOL) – die verwirft der Dekoder, ihre Reserven sind keine SOL.

**So läuft es** (`krypto/strom.ts`, `motor.ts`)
- Der Strom nutzt dieselbe Adresse wie `KRYPTO_RPC_URL` (https → wss). Ohne RPC: aus, alles wie bisher.
- Abonniert: zuerst alle gehaltenen Tokens und offenen Aufträge, dann die lebhaftesten Kandidaten auf der Kurve (zusammen höchstens 20; schon abonnierte Kandidaten behalten Vorrang, kein ständiges Ab-/Anmelden). Ohne laufende Bots und Positionen schließt die Verbindung nach einer Minute.
- Jede Änderung (≈ ein Trade) setzt sofort den Kurs. Bei gehaltenen Tokens prüft der Motor Take Profit/Stop Loss/Trailing sofort (höchstens alle 250 ms) statt beim nächsten DexScreener-Stand. DexScreener liefert weiter Volumen, Käufe/Verkäufe und Filterdaten; sein Kurs überschreibt einen frischeren Strom-Kurs (≤ 15 s) nicht.
- Paper bleibt Paper: dieselbe Ausführung mit Verzögerung, Slippage und Gebühren – nur der Kurs ist aktueller.
- Kosten-Grenze im Code: höchstens `KRYPTO_ECHTZEIT_MB_TAG` (Standard 800 MB ≈ 16 000 Credits) je Tag, dann bis Mitternacht (UTC) nur DexScreener. `KRYPTO_ECHTZEIT=aus` schaltet ab (beides optional in `/srv/dorf/krypto.env`).
- Terminal: Tafel „⚡ Echtzeit-Kurse“ (Status, Tokens, Trades/min, MB heute) und 5-Sekunden-Kerzen je gehaltenem Token mit Käufen/Verkäufen (aus der Richtung der SOL-Reserve).
- **Nicht dabei:** Tokens nach der Migration zu PumpSwap (bräuchte Pool + zwei Tresorkonten je Token) – dort bleibt DexScreener.

**Backtest:** las vorher alle Kurse der Aufzeichnung in einem Aufruf und rechnete 200 Schritte am Stück – bei Stunden an Daten hing das Kryptowerk, das Dorf lief in die 15-s-Grenze („Kryptowerk nicht erreichbar: aborted due to timeout“). Jetzt stückweise (5000 Zeilen nach rowid) und spätestens alle ~25 ms Rechenzeit abgeben.

**Tests:** `test/e232-echtzeit.test.ts` (Dekoder an echten Konten, Quote ≠ SOL, PDA an echten Paaren, Strom gegen nachgebauten WebSocket im echten Nachrichtenformat: Abo/Abmeldung/Grenze/Vorrang, Motor: Kurssturz → Stop-Loss ohne Takt, Ausführung zum Strom-Kurs trotz hinterherhinkendem DexScreener, Kerzen), e2e Terminal.

## E233 – Equity-Kerzen im Terminal von 5 s bis 15 min (24.11.)

Leif wollte die Bot-Equity nicht nur in 15-Minuten-Kerzen. Jetzt gibt es im Terminal eine Auswahl **5 s · 15 s · 1 min · 5 min · 15 min**, gemerkt je Gerät.
- Die Datenbank kennt die Equity nur je Minute. Darum schreibt der Motor zusätzlich **feine Proben im Speicher** mit: bei jedem Takt (alle 2 s) und bei jedem Echtzeit-Trade eines gehaltenen Tokens (E232, höchstens alle 250 ms), die letzten 6 Stunden. Daraus entstehen 5-s- bis 5-min-Kerzen; nach einem Neustart (Proben weg) kommen 1-min/5-min aus der Minuten-Equity der Datenbank.
- Anzahl je Takt: 5 s und 15 s je 120 Kerzen (10 bzw. 30 min), 1 min 120 (2 h), 5 min 72 (6 h), 15 min 96 (24 h). Kerzen schließen lückenlos aneinander (Eröffnung = letzter Schluss).
- `GET /api/krypto/bots/:id/terminal?takt=5s|15s|1m|5m|15m` (Zod in Dorf und Kryptowerk, Standard 15m).
- **Nachtrag (Leifs Rückmeldungen am selben Abend):** Feine Proben liegen jetzt in der Kryptowerk-DB (`equity_fein`, angehängte Migration, 6 h, stündlich aufgeräumt) – nach einem Deploy beginnt die 5-s-Ansicht nicht mehr „bei jetzt“. Davor füllt die Minuten-Equity auf, und Abschnitte ohne Bewegung werden als flache Kerze gefüllt: der Chart reicht immer über den ganzen Zeitraum bis jetzt.
- Chart: das Feld „letzter Trade“ über den Kerzen ist weg (steht jetzt als Zeile darüber). Fadenkreuz beim Drüberfahren mit Uhrzeit, O/H/L/C und „seit Start“. Zoom mit Mausrad (um die Maus herum), Ziehen verschiebt, Knöpfe + / − / Alles (Handy), Doppelklick setzt zurück; ohne Zoom folgt der Chart der neuesten Kerze. Marker ▲ Kauf / ▼ Verkauf an ihrer Kerze (`chartTrades`: alle Käufe/Verkäufe im Kerzen-Zeitraum, höchstens 500), Details beim Drüberfahren/Antippen: Token, Uhrzeit, SOL, Kurs, Gebühr, Ergebnis, Grund.
- PnL-Tafel sagt jetzt ausdrücklich: Heute, Gesamt und Bester Trade sind schon nach Gebühren.

## E234 – Hafen: Dev-Historie, Notausstieg bei großem Einzelverkauf, Kaufdruck der letzten 60 s, Ergebnis je Tag (24.11.)

Leif: „bau 1-4 ein“ (Vorschläge, um die Bots besser zu machen).

- **Dev-Historie:** Beim neuen Token zählt das Kryptowerk in der eigenen Aufzeichnung, wie viele ANDERE Tokens derselbe Ersteller in den 24 h davor gestartet hat (Index `tokens_creator`, angehängte Migration). Mehr als `filter.maxDevTokens24h` (Standard 3) → Modul Dev sperrt („N Tokens/24h“). Serien-Ersteller sind meist Rug-Fabriken. Die Zählung kennt nur, was das Kryptowerk selbst gesehen hat (kein Abruf von außen).
- **Notausstieg:** Jeder Strom-Tick vergleicht die echten SOL der Kurve mit dem vorigen Stand. Fällt sie in EINEM Schritt um ≥ `ausstieg.notausEinzelverkaufProzent` (Standard 15, 0 = aus; nur ab 1 SOL), verkauft jeder Bot mit offener Position sofort („Großer Einzelverkauf“) – unabhängig vom Stop-Loss, mit seiner üblichen Verzögerung. Ein Verkaufsauftrag je Position. Braucht den Echtzeit-Strom (E232).
- **Kaufdruck 60 s:** Käufe, Verkäufe und Netto-SOL der letzten 60 s aus dem Strom (Richtung der SOL-Reserve). Ab 3 Trades bringt das −5 … +10 Punkte im Modul Volumen; optionaler Filter `filter.minEchtzeitKaufVerhaeltnis` (Standard 0 = aus). Ohne Strom-Daten keine Aussage und keine Sperre. Prompt-Bots bekommen `echtzeit60s` und `devTokens24h` in ihren Daten.
- **Ergebnis je Tag:** `kennzahlen.tage` – Gewinn und Trades je Wiener Tag (die letzten 7 mit Trades). Terminal „Tage im Plus x/y“, `hafen_bot_lesen` nennt die Tage. Der Hafenmeister prüft Abwandlungen jetzt über mehrere Backtest-Fenster (6/24/72 h) und urteilt nach „Tage im Plus“ statt nach einem Glückstag (alte Vorlage in `VORLAGE_FRUEHERE_FASSUNGEN`).
- Neue Felder sind optional mit Standard (Zod `.default`, im Motor `??=`) – bestehende Bots laufen unverändert weiter, bekommen aber Dev-Historie und Notausstieg mit den Standardwerten.

## E235 – Muster-Modell (überwacht) + RL-Bot im Hafen, nur Paper (24.11.)

Leif: ein Modell, das Candle-Muster erkennt und stetig besser wird; RL-Bot nur Paper, Training auf dem VPS, Nachschuss bei Pleite (nie als Gewinn), Hafenmeister stellt alle 5 h nach; Ziel: Rat an die anderen Bots. Auf seine Frage „überwacht oder RL?“ – beides kombiniert: überwachtes Modell als Augen, RL-Agent als Hände.

- **Aufzeichnung:** jeder Strom-Trade (E232) → `strom_ticks` (angehängte Migration), 7 Tage, höchstens 3 Mio. Zeilen. Das ist der Lernstoff.
- **Muster-Modell** (`krypto/muster/`, eigene TS-Implementierung, keine neue Abhängigkeit): 27 Merkmale aus den letzten 2 min (Renditen 5 s–2 min, Volatilität, 5-s-Kerzen mit Körper/Dochten/grünen Kerzen in Folge, Käufe/Verkäufe/Netto-SOL 30/60 s, Tickrate, echte SOL und deren Änderung, Abstand zum Hoch, Alter, Dev-Historie). Gradient Boosting (80 Bäume, Tiefe 3, Quantil-Histogramme) schätzt P(erst +20 %, bevor −15 %, in 5 min). Labels nur, wenn die Aufzeichnung den Horizont ganz abdeckt (sonst lernte es „kurz vor Schluss steigt es“ – AUC 0,65 auf Rauschen).
- **Ehrlicher Test:** Zeit-Split 80/20 mit Lücke von einem Horizont. Aktiv (gibt Rat) nur bei Test-AUC ≥ 0,55, ≥ 200 Testbeispielen, ≥ 10 Test-Tokens UND einer Bootstrap-Untergrenze über TOKENS (5 %) > 0,5 – die Labels kommen in Klumpen je Token, auf Rauschen schwankte die AUC sonst zwischen 0,34 und 0,70. Ein neues Modell ersetzt das alte nur, wenn es nicht schlechter ist (≥ alt − 0,01).
- **Training:** im Kryptowerk alle `KRYPTO_MUSTER_STUNDEN` (5) h, erstes 10 min nach dem Start, und auf Knopfdruck (`POST /muster/training`, 409 wenn es läuft). Kooperativ (gibt alle ~20 ms ab), 100 000 × 25 in ~2,5 s. Alle Läufe in `muster_modelle` (die letzten 20 + das aktive).
- **RL-Agent:** tabellarisches Q-Learning, Zustand = Muster-p, hält?, Plus, Haltezeit, Trend 30 s; Handlungen warten/kaufen/halb/raus. Lernt im Zeitraffer auf den Aufzeichnungen mit denselben Kosten wie Paper (kurve.ts + PumpPortal + Netz), Ausführung 5 s später, Pleite = Strafe. Zeitraffer auf den Testdaten steht im Bericht.
- **RL-Bot (`art: 'rl'`):** nur Paper (scharf schalten 400, Backtest 400). Kauft nur mit aktivem Modell und p ≥ `rl.minSicherheit`; Rug/Dev/Bundle und Risk-Limits bleiben harte Sperren, Stop-Loss/Trailing/Haltedauer/Notausstieg greifen zusätzlich. **Nachschuss** (`rl.nachschuss`): Kasse leer und nichts offen → Startkapital dazu, zählt zum eingezahlten Kapital (Gewinn, Faktor, Tagesergebnis, Drawdown rechnen dagegen) – nie als Gewinn.
- **Rat für andere Bots:** Terminal-Tafel „Muster-Rat“ (p, KAUFEN/HALTEN/RAUS). `regeln.musterGewicht` (0–30, Standard 0 = nur anzeigen – Leifs Wunsch: erst bewähren).
- **Muster-Meister** (Vorlage `Hafen/aktionen/muster-meister.md`, Abo, 00:35/05:35/10:35/15:35/20:35): liest `hafen_muster`, legt bei Bedarf „HM Muster-RL“ an (Agenten höchstens 1 RL-Bot), stellt `rl`-Grenzen behutsam nach, Logbuch `Hafen/muster-logbuch.md`, Bericht `Hafen/00_Musterbericht.md`; setzt `musterGewicht` bei anderen Bots nie selbst.
- App: Tafel „🧠 Muster-Modell“ in der Flotte (Test gegen Raten, Präzision gegen Basisrate, Merkmale, Zeitraffer, „Jetzt trainieren“), Art RL im Formular, Muster-Rat und Nachschuss im Terminal.
- Offen/ehrlich: in den ersten Tagen meist „zu wenig Daten“; Speicher beim Training (alle Ticks im Speicher, bei 3 Mio. grob 200 MB+) am VPS beobachten. Nächster Schritt (E236, Leifs Rückfrage): Pump-/Absturz-Erkenner, Ausblick Hoch/Tief, Früh-Modell für die ersten 90 s, RL mit allen Signalen.

## E236 – Muster-Modell sieht mehr: Pump/Absturz, Ausblick Hoch/Tief, Früh-Modell, RL mit allen Signalen (25.11.)

Leif: „Ich dachte, es soll generell aus Kerzenverhalten weitere Verläufe schließen können – und besonders aus wenigen Kerzen frühzeitig einen großen Anstieg/Abfall erkennen.“ E235 sagte nur eine Zahl (P(+20 % vor −15 %, 5 min)).

- **9 Modelle statt einem** (`KRYPTO_MUSTER_MODELLE`), alle aus denselben 35 Merkmalen (27 aus E235 + Früh-Merkmale: Käufe/Verkäufe/Netto-SOL/Rendite/höchste Rendite seit dem ersten Tick, Sekunden seit dem ersten Tick, größter Einzelkauf/-verkauf 30 s; „seit Start“ höchstens 10 min wie im Live-Speicher): Grundsignal; 🚀 Pump (+50 % vor −20 %, 2 min); 💥 Absturz (−30 % vor +20 %, 2 min); Hoch/Tief in 1 und 5 min (in %); Früh-Pump/-Absturz nur auf Zeitpunkten mit Token-Alter ≤ 90 s.
- **Jedes Modell einzeln ehrlich:** eigener Test, eigene Lücke je Horizont, einzeln aktiv und einzeln ersetzt (`muster_einzel`, angehängte Migration; Modelle mit anderer Merkmalsliste gelten als veraltet). Wahrscheinlichkeiten wie E235 (AUC, Token-Bootstrap), Pump zusätzlich ≥ 30 positive Testbeispiele. Wert-Modelle: mittlerer Fehler ≥ 5 % besser als stur der Median und in ≥ 95 % der Token-Stichproben besser. Hoch/Tief lernen auf log(1 + x/100) (schiefe Verteilung – auf der %-Skala verlor L2 gegen den Median), Vorhersage wird zurückgerechnet.
- **RL-Agent sieht alles:** Zustand mit Pump/Absturz/Hoch5/Tief5 (grob, Tabelle bleibt klein; ohne Signale gleiche Schlüssel wie E235). Kauf mit p ≥ minSicherheit ODER 🚀 ≥ 0,3; kein Kauf bei 💥 ≥ `rl.maxAbsturz` (neu, Standard 0,35); gehalten und 💥 ≥ 0,7 → nur noch raus (harte Sicherung, auch beim Erkunden).
- **Andere Bots:** Rat im Terminal mit p, 🚀, 💥, Ausblick „5 min: Hoch +x % / Tief −y %“ und „früh“ – auch ohne aktives Grundsignal. Punkte nur mit `musterGewicht` > 0: g × clamp((p − 0,5)·2 + 🚀 − 💥, −1, 1); dann verkauft auch ein Regel-/Prompt-Bot bei 💥 ≥ 70 % (auch live – Leif schaltet das mit dem Gewicht bewusst ein; Standard 0 = nur anzeigen).
- Laufzeit: 9 Modelle auf 100 000 × 35 ≈ 12 s, ~180 MB, kooperativ (längste Strecke ohne Abgabe ~35 ms, einmal ~100 ms Speicherbereinigung).
- App: Modell-Tabelle in der Muster-Tafel, Feld „Kein Kauf ab Absturz-Risiko“; Muster-Meister kennt die neuen Signale (alte Vorlage in `VORLAGE_FRUEHERE_FASSUNGEN`).

## E237 – Kursvorhersage mit asymmetrischem Fehler + Alarm, Backtest = Paper, Euro neben SOL, mehr Bot-Plätze (25.11.)

Leif: „Es soll generell immer die nächsten Kerzen vorhersagen; einen starken Fall nicht vorherzusagen soll mehr bestraft werden als einen Anstieg zu verpassen; Alarm an andere Bots bei bevorstehendem starken Anstieg/Fall.“ Dazu: Backtest reparieren, Euro neben jedem SOL-Wert, mehr als 6 Agenten-Bots.

- **Kursvorhersage:** 6 Modelle `verlauf5s … verlauf5m` sagen die Kursänderung in % nach 5 s, 15 s, 30 s, 1 min, 2 min, 5 min voraus. Verlust = asymmetrischer quadratischer Fehler (Expektil): Liegt der echte Kurs UNTER der Vorhersage (verpasster Fall), zählt der Fehler 3× (`VERLAUF_GEWICHT_FALL`) – die Vorhersage ist bewusst vorsichtig. Leifs „Vorhersage × echte Veränderung“ direkt als Verlust ist unbeschränkt (das Modell würde immer extremer vorhersagen); der gewichtete quadratische Fehler bestraft dasselbe stabil. Test gegen die beste Konstante unter demselben Verlust, Token-Bootstrap, dazu Richtung bei großen Bewegungen und Alarm-Trefferquote.
- **Alarm** (`alarmAus`): 💥 hat Vorrang (Vorhersage bis 2 min ≤ −10 % oder Absturz-Erkenner ≥ 0,6), sonst 🚀 (≥ +15 % oder Pump ≥ 0,4); Schwellen je Bot (`regeln.alarm`). Wirkung nur bei RL-Bots und Bots mit `musterGewicht` > 0: 🚀 kauft auch unter minPunkte/ohne LLM (Rug/Dev/Bundle, RugCheck, Filterfenster, Risk-Gate gelten weiter; einmal je Token), 💥 verkauft sofort (auch live, Leifs Bestätigung). RL-Agent sieht 1-/5-min-Vorhersage; Belohnung bleibt der echte Gewinn. Terminal: gestrichelte Prognose rechts an den 5-s-Kerzen, 🚀/💥-ALARM-Abzeichen.
- **Backtest = Paper:** Ursachen der Abweichung (4 statt ~60 Trades): Positionen ohne weitere Kurse blieben ewig offen und blockierten maxOffen; Kurse mit falschem (frischem) Zeitstempel; RugCheck-Attrappe sperrte nach Fehlversuchen; Strom fehlte; aenderungM5 nicht aufgezeichnet; devTokens24h zu niedrig; Entscheidungen nur aus den letzten 500 gezählt. Jetzt: Aufzeichnung zu ihrer Zeit eingespielt (Kurse mit echtem Zeitstempel, RugCheck zeitgenau, strom_ticks über kurveTick), Takt 2 s, Datenende-Verkauf (separat gezählt), devTokens aus der echten DB, Zählung über den ganzen Lauf, `abdeckung` + Hinweise im Ergebnis; Muster-Rat im Backtest aus (Modelle auf denselben Daten trainiert). Aufzeichnung: kurse mit aenderung_m5/h1 (angehängte Migration), Nicht-Kandidaten alle 10 s statt 30 s, Nachlauf für Gekauftes bis zur längsten Haltedauer, Aufbewahrung 14 → 5 Tage (≈ 2,2 GB schlimmstenfalls), alte Kurse in Portionen gelöscht (≤ 20 000 je Takt). Gleichlauf-Test: 21/21 gleiche Käufe, 18/18 geschlossen, gleicher Gewinn.
- **Euro:** Neben jedem SOL-Betrag im Hafen „(≈ x €)“ – SOL→USD von DexScreener, USD→EUR EZB-Referenzkurs (6 h zwischengespeichert, Fehler → letzter Wert/ohne €, nie blockierend); Kopfzeile „1 SOL ≈ x €“. Kurse je Token und Chart-Achsen bleiben SOL.
- **Bot-Plätze:** Agenten 10 eigene Regel-/Prompt-Bots (Prompt höchstens 2) + 1 RL-Bot mit eigenem Platz, Flotte 20.
- Training-Fortschritt in der App wurde doppelt mit 100 multipliziert („5600 %“) – behoben.
- **Nachtrag (25.11.):** Der Kopf der Muster-Tafel beschrieb noch nur das Grundsignal („+20 % vor −15 %“) – Leif dachte, der RL-Bot lerne nur das. Jetzt beschreibt er alle Modelle, zählt „N von M Modellen aktiv“ (mit Namen) und verlinkt die neue Erklärseite `Hafen/00_Muster-Modell.html` (Pflichtdatei, eigenständiges HTML ohne Netz); die Kennzahlen darunter sind als „Grundsignal“ beschriftet.

## E238 – Trainings-Konsole des Muster-Modells + Bots der Agenten sichtbar (25.11.)

Leif: „Bau beim Muster-Modell eine Konsole ein, bei der man nach dem Training nachvollziehen kann, was es gemacht/überlegt hat und wieso.“ Dazu: „Mach die Hafenmeister-Bots auch sichtbar in der Flotte.“

- **Protokoll im Training:** `musterTrainieren` (optional `log`, t = ms seit Trainingsstart) schreibt Zeilen mit Stufe info/gut/warnung/entscheidung und Bereich: Daten (Tokens/Ticks/Zeitraum, übersprungen, ausgedünnt, Labels je Spalte), Trennung (Lernen bis/Test ab, Lücke je Horizont), je Modell (Bäume/Tiefe/Lernrate/Verlust, Basisrate bzw. Median/Expektil, Test mit Untergrenze/Bootstrap, 3 wichtigste Merkmale, ENTSCHEIDUNG „AKTIV, weil …“ / „AKTIV – ersetzt v3 (AUC 0,59 → 0,61)“ / „behält v3, neues ist schlechter …“ / „nicht aktiv, weil … – v3 bleibt gültig“), RL (Signale und fehlende, α/γ/Erkunden, jeder Durchlauf, Q-Tabelle, Zeitraffer, 15 Beispiel-Trades mit Lage und Q-Werten der erlaubten Handlungen bzw. „Sicherung: 💥 ≥ 0,7 → nur raus“ / „Regel ohne Q-Werte“, Ergebnis nach Gebühren), Laufzeit-Abschnitte und Abgaben. Ohne `log` gleiches Ergebnis (Test). `rlZeitraffer` meldet Trades nur mit Beobachter (`rlErklaeren`, dieselbe Logik wie `rlHandlung`).
- **Dienst:** eigene Zeilen (Start, Maßstab, Daten gelesen, übernommen/behalten je Schlüssel, RL übernommen?, gespeichert, Fehler, Ende); live abrufbar, danach `muster_modelle.konsole_json` (+ `dauer_ms`, `fehler`, `aktiv_geworden`, angehängte Migration). Höchstens 2 000 Zeilen (Training bis 1 950, dann „… gekürzt“; Dienst-Zeilen am Ende bleiben), Zeile ≤ 1 000 Zeichen. Fehlgeschlagene Läufe stehen jetzt mit `fehler` im Lauf-Protokoll (zählen die Version weiter, beim Laden ignoriert, aufgeräumt wie alle: letzte 20).
- **API:** Kryptowerk `GET /muster/konsole?version=&ab=` → Läufe (neueste zuerst, laufender oben), Zeilen ab Index, gesamt; Dorf-Durchreiche `/api/krypto/muster/konsole`. `hafen_muster {"konsole": true}` gibt die letzten 80 Zeilen; der Muster-Meister schaut dort nach, WARUM ein Modell (nicht) aktiv wurde (E237-Fassung in `VORLAGE_FRUEHERE_FASSUNGEN`).
- **App:** Knopf „🖥️ Konsole“ in der Muster-Tafel – dunkles Terminal (`MusterKonsole.tsx`), +mm:ss.s, farbig nach Stufe, Filter Alle/Entscheidungen/Warnungen, Bereich, Laufauswahl mit „aktiv geworden“, live alle 1,5 s mit `ab=`, folgt nach unten nur, solange man unten ist, Kopieren.
- **Bots der Agenten:** `/api/krypto` ergänzt `agentenBots` (aus `dorf_stand hafen_agentenbots`; RL → Muster-Meister, „HM …“ → Hafenmeister, sonst Agent – nur Bots in der Liste, ein „HM …“ von Leif bleibt seiner), das Terminal `von`. Flotte: „Deine Bots“ und „⚓ Bots der Agenten (N)“ mit Abzeichen, ⚓ in der Legende, Schalter „Agenten-Bots im Vergleich zeigen“ (Standard an, je Gerät), Hinweis auf 06:05, Abzeichen im Terminal-Kopf.


## E239 – Muster-Kielwasser (25.11.)

Leif: „Mach, dass die Konsole den Stil wie bei den anderen hat und auch mit Chart und allem drum und dran.“ (Die E238-Konsole saß schmal in der Muster-Tafel, Bereichsnamen abgeschnitten, nur Text.)

- **Eigene Seite `/hafen/muster`** (vor der Bot-Route; Bot-Ids sind UUIDs, „muster“ kann keine sein) im Stil des Terminals (kw-Tafeln, Container-Raster, Handy einspaltig); „🖥️ Konsole“ in der Muster-Tafel führt dorthin. Kopf: Laufauswahl (Version, Datum, Dauer, „aktiv geworden“), Status läuft/fertig/Fehler, „Jetzt trainieren“, nächster Lauf, ← Flotte.
- **Tafeln:** Modelle (alle 15, Name umbricht, Balken Modell vs. Raten/Konstante, ÜBERNOMMEN / BEHÄLT vN / NICHT AKTIV / NICHT TRAINIERT mit Grund im Tooltip); Verlauf über die Trainings – zwei Charts statt zwei y-Achsen (Test-AUC mit Hilfslinie 0,5; Wert-Modelle als Verbesserung gegen die Konstante in % mit Hilfslinie 0 %), Linien wählbar, übernommene Punkte gefüllt; Lernkurve (Verlust Lern- vs. Testdaten je Baum, Urteil „Über-Anpassung ab Baum N“); Merkmale (Top 10); RL-Zeitraffer (Kapitalkurve nach Abschluss-Zeit mit ▲/▼-Markern und Tooltip: Lage, Q-Werte/Sicherung, Ergebnis in SOL + €; Kennzahlen, Beispiel-Trades); Konsole als kw-Protokoll (Bereich voll ausgeschrieben, Filter, live, Kopieren). Klick auf ein Modell (Liste, Linie, Legende) wählt es für Lernkurve/Merkmale.
- **Charts:** gemeinsamer Baustein `hafen/chart.tsx` (LinienChart: Fadenkreuz-Tooltip mit Werten in Textfarbe, Legende ab zwei Linien, Marker wie im Terminal – `markerPfad` nutzt jetzt auch das Terminal; viewBox = echte Breite, damit die Schrift am Handy lesbar bleibt). Serienfarben: validierte Kategorie-Palette (dunkle Stufen), fest je Modell, Hoch/Tief 5 min gestrichelt in der Farbe von 1 min.
- **Daten (Kryptowerk):** `gbdtTrainieren` schreibt optional die Lernkurve (Baum 1, alle 5, letzter; Testzeilen laufen Baum für Baum mit, Modell unverändert – Test) → `KryptoMusterModellInfo.lernkurve`. Zeitraffer meldet jeden Abschluss (`ende`) → `rlInfo.kurve` (≤ 300 Punkte), `startSol`, `einsatzSol`, `beispiele` (30, strukturiert). Beides unabhängig vom Konsolen-Log (gleiches Ergebnis mit/ohne). Status (`/muster`) bleibt schlank (ohne Lernkurve/Kurve/Beispiele). Neu `GET /muster/verlauf?version=` (Läufe neueste zuerst mit Werten und Entscheidung je Schlüssel aus `muster_einzel` + `aktiv_geworden`; Einzelheiten eines Laufs), Dorf-Durchreiche `/api/krypto/muster/verlauf`. Keine Migration. Läufe vor E239: „ab dem nächsten Training“; `muster_einzel` hält je Schlüssel 10 Versionen – ältere Läufe zeigen „keine Daten mehr“.

## E240 – Zweite Oberfläche: Apple Design (25.11.)

Leif: „Wenn man in den Einstellungen ‚Apple Design‘ auswählt, soll er angewendet werden – sonst das Design und die Designoptionen wie gewohnt. Wenn er an ist, soll jede einzelne Textur, jede noch so kleine Anzeige, jedes Menü/Overlay, die gesamte UI im Apple Design sein – abgesehen vom Dorf (Gebäude, Straßen = die 3D-Szene).“

- **Schalter:** `AussehenT.design` = `dorf` | `apple` (Zod mit Standard `dorf`, ältere Clients/Looks ohne Feld bleiben im Dorf). Einstellungen → Aussehen ganz oben „Oberfläche: Dorf | Apple“; die Wahl gilt **sofort und wird gleich gespeichert** (wie ein Schalter in den iOS-Einstellungen – kein „Speichern“), gemeinsam oder „nur dieses Gerät“ wie alle anderen Optionen. `aussehen.ts` setzt `html[data-design]`; jede Apple-Regel hängt daran, das Dorf-Design bleibt unberührt (stil.css nicht geändert).
- **Optionen ohne Wirkung ausgeblendet:** In Apple gelten nur hell/dunkel (als „Erscheinungsbild: Hell | Dunkel | Automatisch“ – setzt dieselben Felder `vorlage`/`dunkelAuto`, der 🌙/☀️-Schnellschalter bleibt), Textgröße (wirkt wie Dynamic Type: alle Apple-Größen in rem), Bewegung und Startseite. Vorlagen, Farben, Schrift, Form & Stil, Meine Looks und eigenes CSS werden nicht angezeigt (ein Satz sagt, dass sie nur im Dorf-Design gelten und gespeichert bleiben); `aussehenAnwenden` setzt in Apple deren data-Attribute neutral und kein eigenes CSS, damit z. B. „Rahmen dünn“ oder „Schatten flach“ (mit !important) nichts verbiegen.
- **Eigene Symbole statt SF Symbols:** SF Symbols dürfen laut Lizenz nur in Apps für Apple-Plattformen benutzt werden – eine Web-App, die auch unter Windows/Android läuft, nicht. Darum eigene Linien-Zeichnungen im 24er-Raster mit einheitlichem Strich (1,8) im SF-Stil (`apple/symbole.tsx`, über 160 Symbole, Zuordnung für alle Emojis der Oberfläche); `<Ikon e="📅" />` zeigt im Dorf-Design genau das bisherige Emoji (gleicher Text, gleicher zugänglicher Name), in Apple das Symbol; `<IkonText text="✅ Gespeichert" />` für Texte mit Emojis. Keine Apple-Logos (🍎 für „Mac“ wird ein Laptop).
- **Systemschrift statt SF-Dateien:** Die SF-Schriften dürfen nicht weitergegeben werden. Der Stapel `-apple-system, BlinkMacSystemFont, system-ui …` ergibt auf Apple-Geräten die echte SF-Familie (mit optischen Größen), anderswo die Systemschrift. Text-Styles nach iOS (Large Title 34 … Caption 11), negatives Tracking bei großen Titeln.
- **Liquid Glass nur für Navigation und Bedienelemente** (Kopfleiste ab der Scroll-Kante, schwebende Tab-Leiste, Seitenleiste, runde Knöpfe in der Kopfleiste, Spotlight, Menüs, Offline-Kapsel) – nie für Inhalt; Inhalt liegt auf ruhigen Flächen (Inset Grouped). „Transparenz reduzieren“ macht das Glas dicht, „Bewegung reduzieren“ nimmt Federn und Animationen weg, „Mehr Kontrast“ verstärkt Trenner und Zweittext.
- **Schale:** Handy = Tab-Leiste unten (Dorf, Heute, Rathaus mit Freigaben-Zahl, Bibliothek, Mehr → Sheet mit allen übrigen Zielen), Desktop ≥ 900 px = Seitenleiste wie in macOS (Planen, Gebäude aus `/api/gebaeude`, Werkzeuge, Dorf) mit Suche (⌘K). Gleiche Routen wie bisher; die Dorf-Kopfleiste wird in Apple nicht gezeigt. Seitentitel = Large Title in der Seite, klein in der Kopfleiste erst beim Scrollen.
- **Die 3D-Szene bleibt** (Gebäude, Straßen, Licht) – nur die HTML-Overlays darüber sind Apple. Grund: die Szene ist das Dorf selbst, kein Bedienelement.
- **Grundbausteine** (`apple/basis.css`): Die Dorf-Farbvariablen zeigen in Apple auf die Systemfarben (jede noch nicht eigens gestaltete Ecke wird ruhig statt bunt); allgemeine Regeln mit `:where(html[data-design='apple'])`, damit sie genau die gleich spezifischen Regeln aus stil.css ersetzen, Bereichsklassen aber weiter gewinnen. Knöpfe als Kapsel (getönt/gefüllt/rot, Druck = scale 0.97 sofort), Felder gefüllt mit Fokus-Glühen, Häkchen rund, An/Aus als iOS-Switch, Reiter als Segmented Control, Fenster als Sheets (Handy von unten mit Griff), Inset-Grouped-Listen (`.a-gruppe`/`.a-zelle`), `Sheet.tsx` (Wegziehen mit Geschwindigkeits-Projektion wie UIKit), Aktivitätsanzeige, Lesestil für Markdown. Einstellungen in Apple als Liste wie die Einstellungen-App (Bereich per `?bereich=…`; ab 1100 px Liste und Bereich nebeneinander).

## E241 – Muster-Modell lernt mit allen Beispielen + Muster-RL läuft immer auf Paper (25.11.)

Leif: „Wie kriege ich es hin, dass hier mehr Beispiele landen? Das sind die ganze Zeit gleich viele. Es soll jedes Mal, wenn man trainiert, alle neu gespeicherten Beispiele dazunehmen.“ – „Und das Modell soll parallel auch auf dem Papier laufen, also live so wie die anderen Bots.“

- **Warum die Zahl stand:** Die Tafel zeigte die Beispiele des *gültigen* Grundsignal-Modells. Jedes Training las schon alle Ticks der letzten 7 Tage, aber ein neues Modell ersetzte das alte nur, wenn sein Test-AUC nicht schlechter war als **die Zahl aus dem alten Test** – gemessen auf anderen, älteren Daten. Ein Modell mit mehr Daten verlor so oft gegen einen „leichteren“ alten Test, und die Tafel zeigte weiter v1.
- **Fairer Vergleich:** Das gültige Modell wird jetzt auf **genau denselben Testdaten** gemessen wie das neue (AUC bzw. Fehler); nur dieser Wert ist der Maßstab. Die Konsole zeigt beides („vN auf denselben Testdaten: … (sein eigener Test damals …)“). Kein Datenleck: Modelle lernen nur bis zu ihrer Trennzeit, und die Trennzeit wandert mit den Daten nach vorn.
- **Beispiel-Archiv (`muster_archiv`):** Jedes Training legt die fertigen Zeitpunkte (Merkmale + alle Labels, Float32) ab – erst wenn sie ≥ 30 min alt sind (alle Horizonte ≤ 5 min abgedeckt). Spätere Trainings nehmen alle Archiv-Zeitpunkte vor dem 7-Tage-Fenster der Ticks dazu. So wächst die Datenmenge mit jedem Lauf, obwohl die Ticks nach 7 Tagen gelöscht werden. Das Archiv hält höchstens 1 Mio. Zeitpunkte (≈ 250 MB), die ältesten gehen zuerst. Ändern sich Merkmale, Labels oder Ziele im Code (`ARCHIV_KENNUNG`), wird es geleert – alte x/y passten sonst nicht mehr.
- **Grenze 200 000 Zeitpunkte je Training bleibt** (`MAX_BEISPIELE`): Das Kryptowerk hat 384 MB Speicher, und ein Zeitpunkt kostet im Training ≈ 0,5 KB. Bis dahin kommen alle Beispiele dazu, danach die neuesten (die Konsole sagt es). Die aktuelle Menge (≈ 35 000) ist weit darunter.
- **Tafel:** „Beispiele gültiges vN“ und – wenn neuer – „Neuestes Training vM (nicht übernommen)“; dazu die Archiv-Größe in der Datenzeile (auch im Muster-Kielwasser).
- **🧠 Muster-RL von selbst:** Das Kryptowerk legt einmal einen RL-Bot „Muster-RL“ an (Paper mit Nachschuss, Leifs Bot), wenn es noch keinen RL-Bot gibt. Er handelt live auf Paper wie die anderen Bots, sobald ein Modell gültig ist („wartet auf Modell“ bis dahin). Löscht Leif ihn, bleibt er weg (Merker `muster_rl_bot` in `stand`). Live bleibt für RL-Bots gesperrt (E235).

## E242 – Muster-Schicht für Regel-/Prompt-Bots + mehr Speicher fürs Training (26.11.)

Leif: Der RL-Bot hat sich angewöhnt, nie zu kaufen (RL-Zeitraffer 0 Trades). Stattdessen „den ersten Bot nehmen (bisher der beste) – mit einer zusätzlichen Schicht, die ihm erlaubt, beobachtete Tokens zu kaufen, wenn sie vielversprechend sind, nicht zu kaufen, wenn das Muster einen Abfall vorhersieht, und früher zu verkaufen, auch wenn der Stop-Loss nicht erreicht ist“. Außerdem: „Warum werden die 75 000 Beispiele im Archiv nicht alle genutzt? Erhöhe den Speicher für den Hafen, zumindest während des Trainings.“

- **Muster-Schicht (`regeln.musterSchicht {an, fallProzent}`, Standard aus, Fall ab −5 %):** Der Bot kauft und verkauft wie gewohnt (Punkte bzw. LLM unverändert, kein Muster-Punkt nötig). Dazu, alles im Code (`schichtUrteil` in merkmale.ts):
  - **Zusatzkauf:** 🚀-Alarm (Vorhersage ≥ +Alarm-% in ≤ 2 min oder Pump-Erkenner ≥ 40 %) **und** die Vorhersage auf lange Sicht (2/5 min, die weiteste vorhandene) liegt über 0 **und** kein Fall vorhergesagt. Sperren (Rug, Dev, Bundle, Filter-Fenster), RugCheck und Risk-Gate gelten weiter, höchstens ein Alarm-Kauf je Token.
  - **Kauf-Sperre:** 💥-Alarm, Absturz-Erkenner ≥ 35 % oder Vorhersage 1/2/5 min ≤ −Fall-% → kein Kauf; vor dem LLM-Aufruf (spart ihn) und noch einmal nach der LLM-Antwort.
  - **Früher raus:** Absturz ≥ 70 %, 💥-Alarm, oder kurz (30 s/1 min) ≤ −Fall-% **und** lang (2/5 min) nicht > 0. Fällt es kurz, soll es aber danach steigen, bleibt der Bot drin. Stop-Loss, Take-Profit, Trailing und Haltedauer bleiben.
  - Fehlt ein Modell (nicht aktiv), entscheidet die Schicht darüber nichts. Wirkt nur auf Tokens im Echtzeit-Strom (dort gibt es Vorhersagen). Gilt im Paper und live (wie die Absturz-Regel E236, Leif: „lass es auch live gelten“). Nicht bei RL-Bots.
- **Warum nicht „alle 75 000“:** Das Archiv zählte jeden Zeitpunkt, auch solche ohne ein einziges Label (Ende einer Aufzeichnung, Horizont nicht abgedeckt). Daraus lernt kein Modell. „Beispiele gültiges vN“ zählt nur Grundsignal-Lernbeispiele (Horizont 5 min, ohne die Lücke vor dem Test). Alle Zeitpunkte des 7-Tage-Fensters gingen schon ins Training. Neu: Ins Archiv kommen nur Zeitpunkte mit mindestens einem Label, die Anzeige heißt „Archiv … Zeitpunkte“.
- **Speicher:** Kryptowerk `mem_limit` 384 MB → 1152 MB, Node-Heap 896 MB, `MAX_BEISPIELE` 200 000 → 400 000. `mem_limit` ist nur eine Obergrenze – im Alltag braucht das Kryptowerk wie bisher ~150 MB, mehr nur während des Trainings. Ein dynamisches Umschalten nur fürs Training bräuchte Docker-Rechte im Container (nicht gewollt).
