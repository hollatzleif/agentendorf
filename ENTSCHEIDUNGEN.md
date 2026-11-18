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
