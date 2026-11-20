# Agentendorf – Hinweise für Claude

Persönliche Agenten-Zentrale für **Leif** (einziger Nutzer). Oberfläche, Vault-Texte, Agenten-Anweisungen und Code-Bezeichner sind **deutsch**. Gebaut wird in Etappen (siehe `ENTSCHEIDUNGEN.md` und Abschnitt „Stand“ unten). Vor jeder Etappe: kurzer Plan, offene Fragen, Leifs Freigabe.

## Architektur

```
apps/server     Node + Fastify + SQLite (better-sqlite3). Einstieg: src/start.ts, Zusammenbau: src/dorf.ts, Routen: src/app.ts
  src/auth/       Passwort (Argon2id), Sitzungen (Cookie, nur Hash in DB; Abgleich alle 30 s kappt Verbindungen beendeter Sitzungen, E204), Drossel, TOTP (eigene RFC-6238-Implementierung)
  src/vault/      VaultDienst (einziger Weg zu den Dateien), Pfadregeln, Gebäude-Erkennung, Suche (FTS5), Dateiwächter.
                  pfade.ts (E195): sicherOeffnen/ordnerGriff – jeder Zugriff Ordner für Ordner über Deskriptoren mit O_NOFOLLOW,
                  Symlinks im Vault werden NIE verfolgt (ein Agent mit Shell schreibt dort). Nie readFile(vault.abs(…)) –
                  immer vault.lesen/puffer/text/stat/namen (bzw. statJetzt/namenJetzt)
  src/agenten/    Agenten-Kern (Etappe 2a):
    aktionen.ts     Aktionen = Markdown-Skills in <Gebäude>/aktionen/ (Zod-Frontmatter, Fehler sichtbar; zeitplan, ablage, standard – E60)
    automatik.ts    Zeitplaner (jede Minute, genau einmal je Termin, Auslöser automatik = Motor der Aktion) + Ablage mit Archiv
    zeitplan.ts     „täglich 06:00“, „werktags 07:00, 18:00“, „mo, mi 08:00“ → Termine (Europe/Vienna)
    skills.ts       Skill anlegen/ersetzen (App-Formular, aktion_anlegen des Bürgermeisters – direkt, nur mit Zeitplan per Freigabe) – geprüft wie jede Aktion
    modelle.ts      Stufen klein/mittel/gross + Motoren/Notschalter aus 00_Stadtordnung/{modelle,motoren}.md
    leine.ts        DIE Stelle für Regeln: Werkzeugprofil, Schreibregeln, Fremdinhalt-Hülle, Obergrenzen (Helfer, Pläne); seit E185 keine
                    verbotenen Kombinationen mehr (Web darf mit Post/Moodle/Kalender/Fremdinhalten laufen – Leifs Entscheidung)
    werkzeuge.ts    alle Dorf-Werkzeuge mit Leine und werkzeug_log: Vault (lesen/schreiben/aendern/verschieben), Post (lesen, Entwürfe mit
                    Anhang/ändern, nie senden), Termine direkt (termin_*, E185), Adressbuch (kontakt_*), rueckfrage, todo_*, Kirchturm,
                    Notizen; stempelt fremdinhalt: true, sobald der Lauf Fremdes gelesen hat
    freigaben.ts    Anträge, atomar genau einmal entscheiden, Ausführer, Spiegel in Rathaus/freigaben/ – nur noch echte Außenwirkung + Regeln (E185)
    rueckgaengig.ts „Rückgängig“ statt Freigabe (E185): direkte Taten mit Rückweg (Termin, Skill, Datei) merken, genau einmal zurücknehmen
    dienst.ts       Chats, Läufe, Warteschlange (Obergrenzen je Motor), Ausführung, Verlauf je Motor; Nachrichten-Warteschlange je Chat
                    (E187: nachrichtSenden reiht ein, wenn ein Lauf läuft; Übergabe danach, im api-Motor auch zwischen Werkzeug-Runden)
    kontext.ts      Systemprompt (Stadtordnung, gebaeude.md, neueste Protokolle), Anhänge
    protokolle.ts   Protokoll pro Chat (Fakten aus DB/Log) + Chat-Spiegel in <Gebäude>/chats/
    motor-api.ts    api-Motor: eigene Streaming-Schleife, Beta-Endpunkt (Ausweichmodelle), Verlauf nur anhängen
    motor-claude-code.ts  claude-code-Motor: Auftrag an die Werkstatt, stream-json-Parser
    motor-attrappe.ts     Motor ohne Tokenverbrauch (Tests, DORF_MOTOR_ATTRAPPE=1)
    system.ts       SystemAufrufe: ein api-Aufruf OHNE Werkzeuge mit JSON-Schema-Antwort, verbucht als System-Chat (Einordnung, Zeitung)
    moodle-browser.ts Klient für den Moodle-Browser + Seitenauszug-Text; Werkzeuge moodle_* (werkzeuge.ts), nur mit werkzeuge: [moodle] + fremdinhalte
    rechenraum.ts   Klient für den Rechenraum (+ umwandeln) + Ablage-Ordner (vom Code bestimmt; Bürgermeister: Rathaus/dateien/) + erlaubte
                    Endungen (fertige Dateien: PDF, TeX, DOCX/XLSX/PPTX, ODF, CSV/TXT/MD, PNG/JPG/SVG, ZIP … – nie HTML/Skripte)
    anhaenge.ts     E190: Anhänge in jedem Format – Text direkt, PDF/Bilder nativ, alles andere NUR über den Rechenraum (/umwandeln),
                    Zwischenspeicher <daten>/umwandlung/, immer Fremdinhalt-Hülle, Unbekanntes mit Name/Typ/Größe; auch vault_lesen
    bild.ts         E198: bild_bearbeiten – Vault-Bild im Rechenraum bearbeiten (zuschneiden, Größe, drehen, Format, Hintergrund entfernen,
                    hochskalieren), Ergebnis als NEUE Datei im Ablage-Ordner des Chats; nur mit werkzeuge: [rechenraum]; kein Generieren
    gedaechtnis.ts  Rathaus/memory.md (Bürgermeister pflegt selbst, Archiv, Version) + personality.md (nur per Freigabe) – E61
    meine-todos.ts  E192: eigene To-do-Liste des Bürgermeisters (Rathaus/buergermeister-todos/, eine Datei je Eintrag, „wieder ansehen am“,
                    Bezug zu Aufgabe/Chat); meine_todos_* nur für ihn; nach jedem Lauf übernimmt der Code „Offen“ ohne Dubletten
    werkzeuge-extra.ts E199: neue Werkzeuge in eigener Datei – im Rechenraum (dorfwerk.py): pdf_bearbeiten, diagramm_zeichnen (Graphviz),
                    daten_abfragen (DuckDB), qr_code, karten_anki; nur mit Web: literatur_suchen, doi_bibtex (→ Uni/literatur.bib),
                    verbindung_suchen (Transitous), wetter_vorhersage; für alle: feiertage, umrechnen (EZB); Post: post_anhang_lesen
                    (→ Post/anhaenge/). Gruppen/Einstufung in leine-extra.ts, Parser freier Schnittstellen in extra-quellen.ts
    buergermeister.ts     Bürgermeister (Etappe 2b, E185/E186): erledigt Kurzes selbst; aktionen_liste, helfer_starten (max. 5 je Aufgabe),
                          plan_vorlegen (max. 10, Reihenfolge über `nach`, startet sofort – Freigabe nur auf Leifs Wunsch oder wenn groß/teuer),
                          Plan-Ausführung durch den CODE, Abschluss genau einmal, Status der Schreibtisch-Aufgabe
  src/bank.ts     Etappe 7 (E68): Kontoauszüge (CSV-Erkennung, Zuordnung je Format, PDF per Skill), Kategorien (Regeln, Leif, KI),
                  Abos, Budget/Sparziele aus Bank/einstellungen.md, Warnungen; Rechnungen aus Mails → To-do (dorf.ts)
  src/boerse.ts   Etappe 7 (E70): Depot/Watchlist (Boerse/depot.md), EODHD-Schlusskurse (≤ 19 Abrufe/Tag, ISIN → Kürzel gemerkt), EZB Euro/Dollar
  src/corps.ts    Etappe 7 (E69): Corps-Termine (Hauptkalender per Stichwort), Absenderliste für den Postboten (Corpshaus/einstellungen.md)
  src/kontakte.ts Adressbuch (E186): Rathaus/kontakte.md + Absender im Posteingang + gesendete Mails (kontakt_suchen/kontakt_merken)
  src/atelier.ts  E198 Atelier: /api/atelier/* – öffnen (HEIC/TIFF/SVG nur über den Rechenraum), speichern (nur PNG/JPG/WebP/.atelier,
                  Anfangsbytes geprüft, VaultDienst mit basisVersion → Konfliktkopie), ki (Hintergrund/Hochskalieren im Rechenraum),
                  generieren/fuellen (Cloudflare Workers AI, nur mit CLOUDFLARE_* – der einzige Weg nach draußen, nur auf Leifs Klick)
  src/coding.ts   E191 Codehaus: Zugang zu VS Code auf code.<domain> (Einmal-Karte → Cookie dorf_coding, nur Hash, an die Sitzung
                  gebunden), /api/coding (Projekte vom Runner), /api/coding/oeffnen|eintritt; forward_auth-Prüfung in intern.ts
  src/coding-editor.ts E197 Editor im Codehaus: /api/coding/editor/* (Baum, Datei mit basisVersion/409, neu, umbenennen, löschen, hochladen,
                  roh nur als Download, Schnell-/Volltextsuche, Git mit festen Befehlen) + WebSocket /api/coding/terminal – nur Sitzung + Origin,
                  Pfadprüfung, dann Durchreiche an den Runner im Coding-Container; Abmelden kappt die Terminals der Sitzung
  src/todos.ts    To-do-Brett (E65): eine Datei je To-do in Marktplatz/todos/, Version/409, Löschen = Papierkorb, wiederholen (E92), Teilschritte (E119, KI-Vorschlag todo-schritte.ts); App, Telegram /todo, todo_* für alle Agenten
  src/schreibtisch.ts  Aufgaben = Notizen in Rathaus/schreibtisch/ (DB führt Status, Frontmatter spiegelt ihn); App/Telegram starten
                       den Bürgermeister sofort, Notizen aus Obsidian/von Agenten werden nur aufgenommen
  src/telegram/   eigener Bot ohne Bibliothek (fetch, Long Polling): nur EIN gekoppelter Chat, signierte Knöpfe (HMAC) über
                  freigaben.entscheiden, Meldungen schaltbar in 00_Stadtordnung/telegram.md, Weitergeleitetes = Fremdinhalt
  src/uni/        Etappe 3 (E41/E44): JKU sperrt den Moodle-App-Zugang → Termine aus Leifs Google-Kalendern („Moodle-Fristen
                  (automatisch)“ aus seinem Apps-Skript + „JKU Pflicht“; ical.ts mit RRULE, alle 3 h),
                  Fächer/Abgaben = Leifs Ordner unter Uni/faecher/ (abgleich.ts: faecher(), abgaben(), fachAnlegen()).
                  Der App-Weg (moodle.ts, appAbgleichen) bleibt im Code, falls die JKU ihn freischaltet.
                  text.ts: Moodle-HTML → Markdown, Fristen in Linzer Zeit; noten.ts (E98): Uni/noten.md, ECTS-gewichteter Schnitt
  src/post/       Etappe 4: google-oauth.ts (PKCE, Refresh-Token), gmail.ts (REST: profile/list/history/get/drafts – nie senden),
                  postbote.ts (Abruf alle 10 min, Einordnung ohne Werkzeuge, Post/eingang/JJJJ-MM-TT.md, keine Mailtexte)
  src/kalender.ts      Hauptkalender (geheime iCal-Adresse) – nur lesen, nie speichern
  src/kalender-google.ts E75: Marktplatz-Kalender über die Google Calendar API (Leif schreibt per App/Telegram/Cardputer, nie Einladungen;
                       Agenten tragen in Leifs eigenen Kalender direkt ein – termin_*, E185, mit „Rückgängig“; mit Gästen per Freigabe); lernplan (E96)
  src/kirchturm.ts     E74: Wecker/Timer/Pomodoro/Stoppuhr auf dem Server (Takt 1 s), Klingeln = Live-Ereignis; Glocke nur im Programm
  src/saxo.ts          E73: Saxo OpenAPI nur lesen (Code-Flow, Refresh-Token-Rotation in dorf_stand, nur 4 GET-Pfade)
  src/uni/todo-bruecke.ts E71: Uni-Fristen → To-dos, Abhaken in beide Richtungen (uni_todos); Teilschritte aus Vorlage (E130)
  src/uni/lernziele.ts   E137: Lernziel je Fach pro Woche (Uni/lernziele.md) gegen Fokuszeit ab Montag
  src/karten.ts        E87: Karteikarten (Uni/faecher/<Fach>/karten.md, „Frage :: Antwort“ / „### Frage“), SM-2-Stand in karten_stand
  src/gewohnheiten.ts  E89: Gewohnheiten (Marktplatz/gewohnheiten.md) + Häkchen in gewohnheit_log, Serien; Heute, Telegram, Wochenrückblick
  src/wochenziele.ts   E91: Wochenziele = Obsidian-Checkliste Rathaus/wochenziele/JJJJ-KWnn.md (max. 7); Heute, /ziel, Zeitung, Rückblick
  src/todo-erinnerungen.ts E94: To-do mit erinnerung (Ortszeit) läutet im Kirchturm + Telegram (Erledigt/+1 h/Morgen), alle 30 s, genau einmal
  src/notizen.ts       E95: schnelle Notizen → Rathaus/notizen/JJJJ-MM-TT.md („- HH:MM Text“), /notiz, Palette „notiz …“
  src/zeit.ts          Kalendertage in Wien (tagIn, tagPlus, tagVonJetzt) – nie „jetzt ± 24 h“ für Tage (E111)
  src/statistik.ts     E93: Statistik je Tag (erledigte To-dos, Fokus, Gewohnheiten) aus vorhandenen Daten – Rathaus → Statistik
  src/tagesplan.ts     E84: Tag planen (To-dos nach Dringlichkeit in freie Kalenderlücken, ohne KI)
  src/wochenrueckblick.ts E80: sonntags 18:30 Rathaus/wochenrueckblick/JJJJ-KWnn.md (Fakten + KI-Vorschläge)
  src/wetter.ts        Wetter für Leifs Wohnort Konstanz (WETTER_ORT/WETTER_URL) von Open-Meteo (E59): bei Bedarf, 30 min Zwischenspeicher
  src/morgenzeitung.ts 06:30 Linz: Fakten vom Code + KI-Einleitung → Rathaus/morgenzeitung/, Rathaus-Reiter, Telegram
  src/aufwachen.ts     Bürgermeister wacht zu zufälligen Zeiten auf (alle 3–7 h, 24/7, E56/E181; Termin in dorf_stand): Code prüft ohne KI; Reihenfolge
                       (E192): fällige eigene To-dos → neue Anlässe (Lagebericht) → Rundgang mit 1–3 Katalog-Aktivitäten; ohne Anlass kein KI-Lauf;
                       Tagesbudget; Nachtruhe 22–7 (istNacht, telegram/bot.ts nachtNachholen)
  src/rundgang.ts      E192/E200: Aktivitäten-Katalog (40; 22 davon in rundgang-aktivitaeten.ts) mit Fakten-Sammlern ohne KI (schon
                       Erledigtes zählt nicht als Anlass), Auswahl nach Fälligkeit/Restbudget/Nacht (dorf_stand), 00_Stadtordnung/rundgang.md
                       (Zod, an/ab, Häufigkeit, kosten_usd je Gewicht), Protokoll Rathaus/rundgang/ mit echten Kosten, „Für Leif“ → Morgenzeitung
  src/intern.ts   interner Port 3001 (nur Docker-Netz): Werkzeugaufrufe der Werkstatt per Lauf-Token
  src/geraete.ts  E182: Geräte koppeln (6-stelliger Code, 5 min, einmalig) + Geräte-API /api/geraet/* für den Cardputer (Vertrag
                  apps/cardputer/API.md): NUR Bearer-Schlüssel (sha256 in DB), kein Cookie/Origin; ruft nur vorhandene Dienste
  src/idempotenz.ts  E124/E182: gleiche Vorgangs-ID → gespeicherte Antwort (x-dorf-id der App, X-Vorgang der Geräte)
  src/live.ts     WebSocket-Hub: Ereignisse an alle Geräte
  src/dorfplan.ts Etappe 5: Layout des Dorfs (DB, Version, 409 bei Konflikt, neue Gebäude automatisch platzieren) + Status (Rauch/Baustelle/Brief/Frist/Figuren)
  src/cli.ts      Verwaltung (passwort, totp-aus, sitzungen-beenden, db-sichern, vault-ergaenzen)
apps/web        React + Vite, eigener Mini-Router (src/router.ts), TanStack Query, PWA (vite-plugin-pwa)
  src/dorf/       Etappe 5: 3D-Dorf (three.js, nur hier nachgeladen; E52–E55)
    szene.ts        DorfSzene: Kamera (OrbitControls), Licht/Schatten, Klicks, Statusanzeigen, Autos, Bau-Hilfen, Testhilfen (window.__dorf)
    modelle.ts      alle Gebäude-/Deko-Modelle aus Grundformen; FELD = 1,25, Grundstück = 4×4 Felder
    bausatz.ts      Teile je Material zu einem Mesh zusammenfassen (Leistung), Materialien/Formen-Zwischenspeicher
    gelaende.ts     Hügel, Seen, Wald (instanziert), Straßen/Wasser-Felder mit Markierung, Zebrastreifen, Uferkante
    figuren.ts      Agenten + Bürgermeister, Wege über Straßen (wege.ts, A*), Blasen (nachts schläft er: Zz)
    wetter.ts       Regen/Schnee/Trübung/Blitze nach dem Server-Wetter (?wetter=regen); jahreszeit.ts Laub/Schnee (?jahreszeit=winter)
    tag.ts          E131: Tafel am Marktplatz (To-dos heute, CanvasTexture) + Fokus-Licht am Kirchturm (?tafel=2/5, ?fokus=1)
    bluete.ts       E112: Blüte sichtbar – Blumen (instanziert), Wiesentönung, Fensterlicht, Fahne am Rathaus, Feuerwerk (?bluete=praechtig, ?fahne, ?feuerwerk)
    bauen.ts        Bau-Modus: Gesten → Layout (Prüfung wie Server: layoutPruefen aus packages/shared)
    DorfAnsicht.tsx Seite: Szene, Knöpfe, Gebäude-Menü (GebaeudeInhalt), Figurenkarte, Bau-Leiste, Speichern mit basisVersion
  src/codeeditor/ E197: Editor im Codehaus (/codehaus/editor, nur dort geladen; Build nach assets/editor/, nicht im PWA-Vorrat)
    monaco.ts       Monaco aus dem eigenen Build (Worker über ?worker, Themen dorf-hell/dorf-dunkel, TS nur Syntaxprüfung)
    CodeEditor.tsx  Seite: Reiter, Speichern (Strg+S, basisVersion → Konflikt-Leiste), Diff-Editor, Schnellsuche (Strg+P), Handy-Bereiche;
                    Testhilfe window.__editor
    Leisten.tsx     Dateibaum, Volltextsuche, Git-Leiste, Coding-Agent (Aktion Codehaus/programmieren, ChatSeite eingebettet), Rückfrage-Fenster
    TerminalFeld.tsx xterm.js ↔ WebSocket /api/coding/terminal
  src/atelier/    E198: Bildeditor (/atelier, nur dort geladen, eigenes atelier.css) – Canvas 2D ohne Bibliothek
    kern.ts         Dokument: Ebenen (je eine Leinwand), Auswahl-Maske, Verlauf (Schnappschüsse, unveränderte Ebenen geteilt),
                    Bildgröße/Arbeitsfläche/Zuschneiden/Drehen, Projekt .atelier (ZIP ohne Kompression, projekt.ts)
    buehne.ts       Ansicht (Zoom, Verschieben), Zeiger (Maus, Stift mit Druck, zwei Finger), alle Werkzeuge, Transformieren, Hilfslinien
    filter.ts       reine Pixel-Funktionen (Anpassungen, Weichzeichnen, Schärfen, Rauschen, Zauberstab-Flutung)
    Atelier.tsx     Oberfläche: Menüs, Optionen, Fenster, Tastenkürzel, Dateien, KI; Testhilfe window.__atelier; teile.tsx Bausteine
apps/werkstatt  eigener Container: unverändertes claude-CLI (Version im Dockerfile gepinnt) + Runner (HTTP, startet
                claude, streamt stream-json) + stdio-MCP-Server "dorf" (reicht Werkzeugaufrufe an intern.ts weiter).
                Baut die claude-Argumente SELBST (auftrag.ts): nur Read/Glob/Grep (+Web wenn erlaubt), kein Bash/Edit/Write,
                --strict-mcp-config, --setting-sources user, kein --bare (bare liest kein Abo-Token).
                E197, nur Profil coding: editor.ts (/editor/* – Dateien strikt unter /arbeit/<projekt>, Symlinks nie verfolgt, O_NOFOLLOW wie
                vault/pfade.ts; Text ≤ 2 MB, Hochladen ≤ 20 MB, Löschen = /arbeit/.papierkorb; rg und git nur mit festen Argumentlisten) und
                terminal.ts (/terminal – Shell am PTY über einen Python-Helfer aus der Standardbibliothek, kein natives Node-Modul, höchstens 8).
apps/rechenraum eigener Container: pdflatex (texlive), Python (numpy/sympy/scipy/matplotlib), poppler; runner.py nur
                Standardbibliothek. Internes Netz ohne Internet, kein Vault, Arbeitsordner pro Chat, 120 s pro Befehl.
                Image-Kennung = Hash(Dockerfile+runner.py), wird nur ausgeliefert, wenn der Server es nicht hat.
                /bild (E198): Bildbearbeitung für Atelier und bild_bearbeiten – Pillow-Schritte, „Hintergrund entfernen“ (u2netp) und
                „Hochskalieren“ (Real-ESRGAN general-x4v3) über onnxruntime, Modelle mit Prüfsumme im Image (/opt/bild); eigener
                Kindprozess wie /umwandeln, belegt beide Umwandlungs-Plätze (Speicher, Messwerte in runner.py).
                /umwandeln (E190): fremde Dateien → Text/Bilder in eigenem Kindprozess (420 s, 1024 MB Adressraum – kleiner geht nicht, Messwerte in runner.py; Zip-Bomben-Grenzen); dazu ffmpeg,
                whisper.cpp (base-q5_1, im Image), tesseract deu+eng, rsvg, heif-convert, catdoc, xlrd, olefile; python-docx/openpyxl/python-pptx/odfpy.
                /werkzeug (E199): dorfwerk.py mit JSON-Auftrag statt Shell (PDF mit pypdf/Ghostscript, Graphviz, segno, genanki, DuckDB/pandas),
                einzeln, 120 s, Adressraum 1536 MB (DuckDB reserviert ~1,3 GB, belegt ~80 MB); pip-Pakete mit Prüfsumme; Image-Kennung inkl. dorfwerk.py.
apps/browser    Moodle-Browser (E57): Chromium über playwright-core + Runner (HTTP, Bearer-Geheimnis). leine.ts = DIE Regeln
                (nur Domains aus BROWSER_HOSTS, GET ja außer sesskey/Abmelden, POST nur Anmeldeformular als Seiten-
                navigation oder lesende Moodle-Ajax-Funktionen), browser.ts = Sitzung je Lauf, nummerierte Links,
                automatische Anmeldung (SSO-Knopf + Formular, ein-/zweistufig), Download mit geprüften Weiterleitungen.
                Zugangsdaten nur in /srv/dorf/browser.env (als Datei eingebunden, nicht env_file). Compose-Profil „browser“.
                Tests: leine (pnpm test), gegen nachgebautes Moodle mit Chromium (pnpm --filter @dorf/browser e2e).
apps/programm  Etappe 6 (E66): Tauri-v2-Hülle für Mac/Windows. src-tauri/src/lib.rs (Fenster, Leiste, Schnelleingabe,
                Autostart, Updater, Befehle melden/zaehler_setzen/schnell_schliessen/glocke/glocke_stopp – zur Laufzeit NUR für den Ursprung
                der Dorf-Adresse freigegeben), adresse.rs (https-Prüfung, Tests), einrichten/ (lokale Einrichtungsseite).
                test/selbsttest.sh: Debug-Build unter Xvfb gegen den e2e-Server, prüft die Freigaben. Gebaut in der CI.
apps/cardputer  E184/E193: Firmware für den M5Stack Cardputer Adv (aus HaloOS 0.3, Arduino-ESP32 2.0.17): Startmenü 1 Fernbedienung
                (unverändert) · 2 Agentendorf (WLAN/HTTPS mit eingebetteten Root-CAs, Listen-App über /api/geraet/*, Offline-
                Warteschlange mit X-Vorgang). Logik in src/core/ (läuft auch am PC: host/), Hardware in src/main.cpp.
                Vertrag: API.md. Tests: test/host-test.sh (g++ + Nachbau-Server), test/vertrag_test.py (gegen den echten
                e2e-Server). Bauen: tools/werkzeug.sh + tools/build.sh → release/*.bin, tools/zip.sh → ZIP für Leif (nicht im Repo).
                WLAN (E193): bis 8 Netze mit Vorrang, versteckte Netze direkt versuchen, Wechsel ins Heimnetz. Spracheingabe (E194): Tab in
                jeder Texteingabe, Aufnahme als WAV in Datei (kein PSRAM), Upload an /api/geraet/sprache. Anleitung: ANLEITUNG.md.
apps/coding     Codehaus (E191), eigener Container: openvscode-server (nur lokal, 3100; nach außen das Tor im Runner auf 3000 – so
                kappt das Dorf beim Abmelden offene Verbindungen, E195) + Runner der Werkstatt im Profil „coding“ (4000:
                claude mit Bash/Edit/Write, bypassPermissions, /arbeit/<projekt>, Vault rw) + git, gh, Node, Python, Compiler. Netz
                „codingnetz“ (Internet, erreicht nur Dorf und Caddy). Geheimnisse nur aus /srv/dorf/coding.env (als Datei eingehängt,
                start.sh liest sie). Compose-Profil „coding“; Image nur an Server mit CODING_AN=ja (hat-coding: ja/nein/aus).
                Tests: test/start-test.sh, test/rauchtest.sh <image> (CI), deploy/test/coding-zugang-test.sh (echter Caddyfile).
packages/shared Typen für HTTP und WebSocket (LiveEreignis, VaultEintrag …) + Dorf-Layout-Regeln (dorf.ts) – wird in den Server gebündelt
vault-vorlage   Startinhalt des Vaults (Stadtordnung, gebaeude.md je Gebäude). Wird nur in einen LEEREN Vault kopiert.
deploy          compose.yml, Caddyfile, dorf (Server-Verwaltung), bootstrap.sh (Ersteinrichtung), test/ (Backup-/Deploy-Tests)
```

**Grundsätze**
- Der Server ist die einzige Quelle der Wahrheit. Jede Änderung (auch aus Obsidian über Syncthing) läuft über den Dateiwächter → `LiveHub` → alle Clients invalidieren ihre Queries.
- Alle Dateizugriffe gehen durch `VaultDienst`: Pfadnormalisierung (kein `..`, keine versteckten Segmente, keine Symlinks nach draußen), atomares Schreiben, **Konfliktkopie statt Überschreiben** (`basisVersion` = sha256), Löschen = Papierkorb (`.papierkorb/`).
- Ein Gebäude = Ordner auf oberster Ebene mit `gebaeude.md` (Frontmatter per Zod geprüft; Fehler werden angezeigt, nicht verschluckt).
- `X-Forwarded-For` gilt nur von `VERTRAUTER_PROXY` (im Server `caddy`, `src/proxy.ts`, E195) – Werkstatt, Codehaus, Rechenraum und Browser erreichen `dorf:3000` direkt und zählen mit ihrer echten Adresse.
- Schreibende Anfragen und WebSocket brauchen passende `Origin` (CSRF-Schutz) und ein gültiges Sitzungs-Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`). Einzige Ausnahme: `/api/geraet/*` (E182) – dort gilt nur der Bearer-Schlüssel eines gekoppelten Geräts, und der gilt nirgends sonst.
- Rohdateien aus dem Vault werden mit `Content-Security-Policy: sandbox` ausgeliefert, HTML/SVG nur als Download (Vault-Inhalte können aus fremden Quellen stammen). Anzeigen lässt sich `.html` nur über `/api/vault/seite`: Skripte ja, aber undurchsichtiger Ursprung und kein Netz (E36).
- Geheimnisse nur auf dem Server – nie im Repo, nie im Vault: `/srv/dorf/.env` (Dorf: ANTHROPIC_API_KEY, EODHD_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (optional, Atelier), WERKSTATT_GEHEIMNIS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_FRISTEN_ICS, GOOGLE_PFLICHT_ICS, GOOGLE_TERMINE_ICS, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, MOODLE_KALENDER_URL, MOODLE_URL, MOODLE_TOKEN, RECHENRAUM_GEHEIMNIS), `/srv/dorf/rechenraum.env` (nur RECHENRAUM_GEHEIMNIS), `/srv/dorf/browser.env` (nur Browser-Container: BROWSER_GEHEIMNIS, MOODLE_BENUTZER, MOODLE_PASSWORT, BROWSER_HOSTS, MOODLE_WEB_URL) und `/srv/dorf/werkstatt.env` (Werkstatt: CLAUDE_CODE_OAUTH_TOKEN, WERKSTATT_GEHEIMNIS). Der API-Schlüssel erreicht die Werkstatt nie, das Abo-Token das Dorf nie.
- **Die Leine sitzt im Code** (`agenten/leine.ts`, `werkzeuge.ts`, Werkstatt-Argumente): Agenten haben kein eingebautes Schreiben/Shell. Senden, Abgeben, Zahlen gibt es nicht (nur Entwürfe). Seit E185 gilt Leifs Regel „bestätigen nur, wenn ich einen Plan will“: Was sich zurückholen lässt (Termin im eigenen Kalender, Skill ohne Zeitplan, Datei im eigenen Gebäude), tun Agenten direkt, und Leif bekommt „Rückgängig“ (`rueckgaengig.ts`, App + Telegram). Freigaben (`freigaben.ts`, Ausführung erst nach Leifs Klick) bleiben für Dateien außerhalb des eigenen Gebäudes, Termine mit Gästen, Skills mit Zeitplan, die Persönlichkeit und gewünschte oder große Pläne. Web darf mit Post/Moodle/Kalender/Fremdinhalten zusammen laufen – Leif hat das Abfluss-Risiko bewusst in Kauf genommen (E185); jeder Web-Abruf steht im `werkzeug_log`, die Fremdinhalt-Hülle bleibt. Zeitgesteuerte Läufe des Bürgermeisters laufen über `api` mit Tagesbudget (`00_Stadtordnung/aufwachen.md`); Helfer, die er startet, über den Motor ihrer Aktion – meist claude-code/Abo (E56, ersetzt E51); Notschalter `alle_auf` übersteuert alles.
- **Ausnahme Codehaus (E191, Leifs Entscheidung):** Der Motor `coding` läuft im Coding-Container mit Shell, Internet, GitHub (auch pushen/mergen) und beschreibbarem Vault – dort gilt die Leine nur für die Dorf-Werkzeuge, nicht für Bash/Edit/Write. Darum: `motor: coding` nur im Gebäude Codehaus, kein Coding-Skill über App/`aktion_anlegen`, Notschalter nie „coding“, Coding-Helfer des Bürgermeisters nach Fremdinhalten nur mit Leifs Freigabe (E195: Merker `chats.fremd_beruehrt` – Auftrag mit Hülle, hochgeladene/umgewandelte Anhänge, gelesenes Fremdes, Helfer derselben Aufgabe, Plan-Vorgänger; Coding-Helfer selbst zählen nicht). VS Code hat eine eigene Adresse (eigener Ursprung, eigenes Cookie); das Sitzungs-Cookie des Dorfs erreicht den Container nie. `coding.env` (CODING_GEHEIMNIS, VSCODE_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, GIT_NAME, GIT_EMAIL) – nichts aus `.env` erreicht das Codehaus.
- api-Verlauf wird **nur angehängt**, Antworten unverändert zurückgeschickt (Opus 5.5/Fable 5.2 prüfen das).

## Befehle

```bash
pnpm install
pnpm dev                 # Server (3000, tsx watch) + Web (5173, Proxy auf /api)
pnpm --filter @dorf/server cli passwort   # lokales Passwort setzen (Daten in apps/server/daten/)
pnpm typecheck
pnpm test                # Vitest (Server inkl. Ende-zu-Ende über Werkstatt mit Fake-claude, Werkstatt; braucht ripgrep, git, python3 für den Editor E197)
pnpm build
pnpm e2e                 # Playwright, Desktop + Handy, startet eigenen Testserver (Port 3999); WebGL über SwiftShader
                         # Dorf-Debug: /?voll (volle Qualität trotz Software-Grafik), /?animiert (Animation erzwingen)
python3 -m unittest discover -s apps/rechenraum/test   # Rechenraum-Runner
bash deploy/test/backup-test.sh      # braucht restic, sqlite3, jq
bash deploy/test/empfangen-test.sh
bash deploy/test/moodle-anmelden-test.sh
cargo test --manifest-path apps/programm/src-tauri/Cargo.toml   # Programm (braucht libwebkit2gtk-4.1-dev u. a.)
bash apps/programm/test/selbsttest.sh   # Programm-Freigaben (laufender e2e-Server auf 3999, Xvfb)
bash apps/cardputer/test/host-test.sh   # Cardputer-App am PC (g++, python3)
python3 apps/cardputer/test/vertrag_test.py http://127.0.0.1:3999 'e2e-Passwort-sehr-lang-1'   # Geräte-API vs. Firmware (laufender e2e-Server)
bash apps/coding/test/start-test.sh        # Codehaus-Start ohne Docker (vorher pnpm build)
CADDY_BIN=caddy bash deploy/test/coding-zugang-test.sh   # echter Caddyfile + Dorf
shellcheck -x -S warning deploy/dorf deploy/bootstrap.sh deploy/test/*.sh apps/coding/*.sh apps/coding/test/*.sh
```
Lokal: `COOKIE_SICHER=false` setzen, wenn ohne HTTPS getestet wird (Dev-Server über Vite-Proxy braucht das). `DORF_MOTOR_ATTRAPPE=1` ersetzt beide Motoren durch die Attrappe (Befehle in der Nachricht: `[schreibe pfad]`, `[freigabe pfad]`, `[fehler]`, `[warte ms]`, `[pause ms]` (nach den Werkzeugen), `[helfer Gebäude|Auftrag]`, `[plan Gebäude|Titel; …]` (mit Freigabe), `[los Gebäude|Titel; Gebäude|Titel|1]` (Plan ohne Freigabe, dritter Teil = `nach`), `[nachschub]`, `<<werkzeug name {json}>>`).

**Auf dem Server:** `dorf hilfe`. Deploy = Push auf `main` → GitHub Actions testet, baut das Image, schickt ein Bündel per SSH (erzwungener Befehl `empfangen`) → `dorf empfangen` schaltet um, prüft Gesundheit, rollt bei Fehler zurück.

## Konventionen

- Deutsche Bezeichner (`vaultDienst`, `schreiben`, `Gebaeude`), Umlaute nur in Texten/Kommentaren, nicht in Bezeichnern oder Dateinamen.
- Vorlagendateien im Vault aktualisiert das Dorf nur, wenn sie byte-genau einer früheren Vorlagenfassung entsprechen (Hash in `dorf.ts` eintragen, wenn sich eine Vorlage ändert, die schon ausgeliefert wurde).
- Neue Dateinamen im Vault: ASCII (`dateinameBereinigen`), Agenten-Schema `JJJJ-MM-TT_HHMM_kurztitel.md`.
- DB-Migrationen nur anhängen (`src/db.ts`, `MIGRATIONEN`), nie bestehende ändern.
- Tests sind Pflicht für alles, was Daten verändert oder nach außen wirkt (Leine, Freigaben, Vault-Regeln, Backup). Zeit in Tests über `TestUhr`.
- Nichts erfinden: Wenn eine Schnittstelle (Moodle, Gmail, Claude-Auth) anders funktioniert als angenommen → stoppen und Leif fragen.
- Entscheidungen mit Begründung in `ENTSCHEIDUNGEN.md` festhalten.

## Stand

- [x] Etappe 1 – Fundament (Code fertig und getestet; Deploy auf den Server steht aus, siehe EINRICHTUNG.md)
- [x] Etappe 2a – Agenten-Kern (Code fertig und getestet; echte Läufe beider Motoren erst auf dem Server)
- [x] Etappe 2b – Bürgermeister + Telegram (Code fertig und getestet; Abnahme mit echtem Bot auf dem Server steht aus)
- [x] Etappe 3 – Uni (Code fertig und getestet; Google-Kalender und echte Läufe von Lernen/Abgabe auf dem Server abzunehmen)
- [x] Etappe 4 – Post, Kalender, Aufwachen, Morgenzeitung (Code fertig und getestet; Gmail-Anmeldung und echte Läufe auf dem Server abzunehmen; To-do-Brett kommt mit Etappe 7)
- [x] Etappe 5 – Dorf (3D statt Isometrie, E52; Code fertig und getestet; Abnahme am Handy/PC mit echten Läufen steht aus)
- [x] Nacht 17./18.11. (E56–E59): Bürgermeister 24/7, Spielknöpfe, Helfer-Figuren, Moodle-Browser (läuft auf dem Server; wartet auf `dorf moodle-browser-zugang`, Leine unabhängig geprüft und gegen das echte JKU-Moodle ohne Login getestet), Wetter/Jahreszeiten, Telegram /heute /fristen
- [x] E60 (18.11.): Skills anlegen (App, Obsidian-Vorlage, Bürgermeister per Freigabe), Zeitpläne, Ablage mit Archiv, Häkchen-Brücke, Checkliste (täglich 06:00), Kursübersicht
- [x] E61 (18.11.): Gedächtnis/Persönlichkeit des Bürgermeisters, Rückschau beim Aufwachen, Weitermachen nach Freigabe/Helfer-Ende
- [x] E62 (18.11.): Pläne ohne Antwort nach 10 min automatisch angenommen (nur Pläne; `plan_automatisch_nach_minuten`)
- [x] E63 (18.11.): Spiel-Look für alle Fenster, Reiter und Seiten (nur stil.css)
- [x] E64 (18.11.): Ablehnen mit Begründung (App/Telegram → Bürgermeister), zeitplan_je (Kursübersicht montags je Fach), Frist-Wächter-Knopf
- [x] E65 (18.11.): To-do-Brett auf dem Marktplatz (App-Reiter live, Telegram /todo, todo_* für alle Agenten)
- [x] Etappe 6 – Programme (E66; Code fertig, Selbsttest unter Linux bestanden; Mac/Windows baut die CI – Abnahme an Leifs Geräten steht aus, Signaturschlüssel als GitHub-Secret von Leif)
- [x] Etappe 7 – Gebäude anlegen/eröffnen, Einkaufsladen, Bank, Corpshaus, Börse (E67–E70; Code fertig und getestet; echte Läufe, EODHD-Schlüssel und Bank-Exporte auf dem Server abzunehmen)
- [x] Etappe 8 (18.11.): Uni-Fristen als To-dos (E71), Häuschen/Deko/Kirchturm-Modell (E72), SIX/Franken + Saxo nur lesen (E73), Kirchturm-Uhr mit Glocke im Programm (E74), Google-Kalender auf dem Marktplatz (E75) – Saxo-App und Calendar-API-Freigabe von Leif abzunehmen
- [x] Nacht 18./19.11. (Produktivität, E76–E88): Teil-Bau der Programme (nur Windows), Mein Tag (/heute), Fokus-Statistik + Nicht stören, Lernzeit einplanen, Wochenrückblick, Mail → To-do, Termin aus Text (/termin), Fach-Karten, Tag planen, Befehlspalette (Strg+K), ⭐ wichtig, Karteikarten (/karten), Tagesabschluss 21:00, Gewohnheiten mit Serien (E89), Telegram /plan (E90), Wochenziele (E91), wiederkehrende To-dos (E92), Statistik (E93), Erinnerungen an To-dos (E94), schnelle Notizen (E95), Lernplan bis zur Prüfung (E96), Überfälliges aufräumen (E97), Noten & ECTS (E98), Fokus → Erledigt? (E99), Telegram /woche (E100), Morgenzeitung-Schnellknöpfe (E101), Rückblick-Vorschläge → Wochenziele (E102), Telegram-Kurzformen (E103), /statistik (E104), Prüfungs-Wächter (E105), Gewohnheiten mit Uhrzeit (E106), Stimmung des Tages (E107), /suche (E108), Anschlüsse (E109), Gewohnheiten N× pro Woche (E110), Review-Korrekturen (E111), Das Dorf blüht (E112), Blüte in Zeitung + /noten (E113), Offline-Warteschlange + Lazy Loading (E114), Foto-Notiz + Anleitung (E115), Gewohnheiten bearbeiten (E116), Kursalarm (E117), Review 2 (E118), Teilschritte + KI-Zerlegen + Notiz → To-do (E119), Zeitschätzung (E120), Wochenplan (E121), Fokus je To-do + Schätzung lernen (E122), Jetzt dran (E123), Review 3 (E124), Filter im To-do-Brett (E125), Woche verteilen (E126), To-do aus Text überall (E127), /verteilen (E128), Wochenplanung /planen (E129), Uni-Schritte (E130), Dorf spiegelt den Tag (E131), Feinschliff (E132), Telegram-Schnellknöpfe (E133), Fokus-Ziel (E134), Review 4 (E135), Schritte im Fokus (E136), Lernziel je Fach (E137), Tastenkürzel (E138), /lernen + Lernen in der Zeitung (E139), Prüfungs-Cockpit (E140), Morgen im Blick (E141), Anstoß nach Terminen (E143), Heute neu geordnet (E142), beste Tageszeit (E144), Review 5 (E145), Tag abschließen (E146), Wartet auf … (E147), Gedanken parken (E148), Review 6 (E149), Wartet rundum (E150), Energie je To-do (E151), Aufschiebe-Zähler (E153), Nachbereiten (E154), Rauschen im Fokus (E155), /morgen (E156), Filter Wartet/Verschoben (E158), Tagesleiste (E157), Gewohnheiten im Abschluss (E159), Review 7 (E160), Projekte (E161), Gute Tage (E162), Projekte in Telegram/Zeitung (E163), Feinschliff (E164), Projekte in /planen (E165), Review 8 (E166), /api/projekte (E167), Überschneidungen (E168), Morgen im Abschluss (E169), Etappen (E170), Uni-Gruppe = Fach (E171), Projekte im Plan (E172), Review 9 (E173), Projekte auf Heute (E174), /projekte mit Frist (E175), Review 10 (E176), Palette (E177), Bürgermeister-Kontext (E178), App aktualisiert sich selbst (E179), strict-Grenzen der API (E180), zufälliges Aufwachen (E181)
- [x] E182 (19.11.): Cardputer koppeln + Geräte-API (`/api/geraet/*`, Vertrag `apps/cardputer/API.md`) – Abnahme mit dem echten Gerät steht aus
- [x] E183 (19.11.): Agenten stellen Timer/Wecker/Pomodoro, schreiben Notizen und neue Mail-Entwürfe; Termine nur per Freigabe
- [x] E184 (19.11.): Cardputer-Firmware 1.0 (Fernbedienung + Agentendorf, `apps/cardputer/`) – Host-Test und Vertragsprüfung grün, nie auf echter Hardware gelaufen
- [x] E185–E188 (19.11.): Agenten nehmen Arbeit ab – Freigaben ausgedünnt + „Rückgängig“, Web auch mit Privatem (Leifs Entscheidung), Bürgermeister erledigt Kurzes selbst (Mail in einem Lauf, Adressbuch, Rückfrage), Pläne mit Reihenfolge, Nachrichten-Warteschlange im Chat, Termine direkt, Entwürfe mit Anhang/ändern, vault_aendern/verschieben (ersetzt den Freigabe-Teil von E183)
- [x] E193 (19.11.): Cardputer-Firmware 1.1 – bekannte Netze automatisch (Vorrang, versteckte Netze, Wechsel ins Heimnetz), ZIP mit Anleitung; Host-Test grün (140), nie auf echter Hardware gelaufen
- [x] E192 (19.11.): Der Bürgermeister arbeitet von selbst – eigene To-do-Liste (`meine_todos_*`, Übernahme aus „Offen“), Rundgang mit Aktivitäten-Katalog (18 von 50, `00_Stadtordnung/rundgang.md`, `docs/buergermeister-aktivitaeten.md`), „Leif kennenlernen“, Sammelmeldung in der Morgenzeitung – echte Läufe und Kosten abzunehmen
- [x] E190 (19.11.): Anhänge in allen Formaten – Chat/Schreibtisch/Telegram (auch Sprachnachrichten), Umwandlung nur im Rechenraum (Office, Mail, Archive, Bilder, OCR, Audio-Transkript, Video-Standbilder), Bürgermeister erzeugt Dateien (Rathaus/dateien/) – Abnahme mit echten Dateien auf dem Server steht aus
- [x] E191 (19.11.): Codehaus – VS Code im Browser (code.<Dorf-Adresse>, nur über die Dorf-Anmeldung), Coding-Agenten mit Shell, Internet, GitHub und beschreibbarem Vault (Motor coding, nur im Gebäude Codehaus); Abnahme auf dem Server steht aus (`dorf coding-einrichten`, Image kommt mit dem zweiten Deploy)
- [x] E194 (19.11., Server): Spracheingabe für Geräte – `POST /api/geraet/sprache` (WAV → Text über whisper.cpp im Rechenraum, nichts gespeichert)
- [x] E194 (19.11., Firmware): Cardputer 1.2 – Spracheingabe überall (Tab), Update ohne Neu-Einrichten (Nur-Programm-Datei); Host-Test grün (177), Mikrofon nie am Gerät erprobt
- [x] E195 (19.11.): Review zu E190–E194 – Vault folgt keinen Symlinks mehr (wettlauf-sicher), Coding-Freigabe nicht mehr umgehbar, X-Forwarded-For nur von Caddy, Abmelden kappt VS Code, Rechenraum-Speicher gemessen, Codehaus-Image nur auf Wunsch
- [x] E197 (20.11.): Editor im Codehaus – „wie VS Code“ direkt in der App (Monaco mit Reitern/Diff, Dateibaum, Schnell- und Volltextsuche, Terminal am PTY, Git-Leiste, Coding-Agent daneben; Desktop + Handy); braucht das neue Coding-Image (kommt mit dem Deploy von selbst) – Abnahme auf dem Server steht aus
- [x] E198 (20.11.): Atelier – Bildeditor in der App (Ebenen, Pinsel, Auswahl, Transformieren, Anpassungen, Filter, Text, Formen; Projekt .atelier), Hintergrund entfernen und Hochskalieren im Rechenraum, `bild_bearbeiten` für Agenten, Bilder generieren optional über Cloudflare (`dorf bilder-einrichten`) – Rechenraum-Image hier nicht gebaut, Cloudflare ohne echten Zugang nur gegen Nachbau getestet, Abnahme am Handy/Stift steht aus
- [x] E199 (20.11.): Neue Werkzeuge aus der Ideen-Liste – PDF bearbeiten, Graphviz, DuckDB, QR, Anki-Export (+ Knopf „Für Anki“), Literatur (Crossref/arXiv/Open Library), DOI → BibTeX, Zugverbindungen (Transitous), Wetter 16 Tage, Feiertage AT/BW, Umrechnen (EZB), Gmail-Anhänge – Rechenraum-Image kommt mit dem nächsten Deploy; Transitous-Nutzungsregeln (quelloffen) offen
- [x] E200 (20.11.): Rundgang komplett – 22 weitere Aktivitäten (40 von 50; 9 begründet „bleibt Idee“), Kosten je Gewicht in `rundgang.md`, echte Kosten im Rundgang-Protokoll – echte Läufe und Kosten abzunehmen
- [x] E201 (20.11.): Cardputer 1.3 (1.3.1, E202) – Mikrofon richtig verstärkt (ES8311-PGA/ADC wie M5Unified für andere Geräte), Pegel in dB, kein Hängen nach der Aufnahme (Codec nur in der Hauptschleife, Zeitgrenzen, Gründe), Fortschritt beim Senden; Server hebt leise WAVs an – Host-Test grün (184), nie am Gerät gehört
- [x] E202 (20.11.): Review zu E199–E201 – Fremdes über Rechenraum-Werkzeuge immer gehüllt/gestempelt (`vaultDateiFremd`), `doi_bibtex` nur Uni/Bürgermeister mit Rückgängig und ohne abstract, Rundung, Antwort-Grenze; Cardputer 1.3.1 ohne Leck/Hänger
- [x] E204 (20.11.): Review zu E197/E198 – Terminal mit Gegendruck (Dorf ≤ 1 MB im WebSocket, Runner hält die Shell an), Sitzungsabgleich alle 30 s (CLI/Ablauf kappt Terminals, VS Code, Live), Git-Pfade wörtlich + Prozessgruppe, Atelier „Speichern unter“ fragt vor dem Überschreiben, Bilder nur als geprüftes PNG/JPEG/WebP mit sandbox, `bild_bearbeiten` ersetzt nie, Grenzen (Download, JSON, Rechenraum-Antwort)
