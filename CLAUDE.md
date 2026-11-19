# Agentendorf – Hinweise für Claude

Persönliche Agenten-Zentrale für **Leif** (einziger Nutzer). Oberfläche, Vault-Texte, Agenten-Anweisungen und Code-Bezeichner sind **deutsch**. Gebaut wird in Etappen (siehe `ENTSCHEIDUNGEN.md` und Abschnitt „Stand“ unten). Vor jeder Etappe: kurzer Plan, offene Fragen, Leifs Freigabe.

## Architektur

```
apps/server     Node + Fastify + SQLite (better-sqlite3). Einstieg: src/start.ts, Zusammenbau: src/dorf.ts, Routen: src/app.ts
  src/auth/       Passwort (Argon2id), Sitzungen (Cookie, nur Hash in DB), Drossel, TOTP (eigene RFC-6238-Implementierung)
  src/vault/      VaultDienst (einziger Weg zu den Dateien), Pfadregeln, Gebäude-Erkennung, Suche (FTS5), Dateiwächter
  src/agenten/    Agenten-Kern (Etappe 2a):
    aktionen.ts     Aktionen = Markdown-Skills in <Gebäude>/aktionen/ (Zod-Frontmatter, Fehler sichtbar; zeitplan, ablage, standard – E60)
    automatik.ts    Zeitplaner (jede Minute, genau einmal je Termin, Auslöser automatik = Motor der Aktion) + Ablage mit Archiv
    zeitplan.ts     „täglich 06:00“, „werktags 07:00, 18:00“, „mo, mi 08:00“ → Termine (Europe/Vienna)
    skills.ts       Skill anlegen (App-Formular, aktion_vorschlagen des Bürgermeisters nach Freigabe) – geprüft wie jede Aktion
    modelle.ts      Stufen klein/mittel/gross + Motoren/Notschalter aus 00_Stadtordnung/{modelle,motoren}.md
    leine.ts        DIE Stelle für Regeln: Werkzeugprofil, Schreibregeln, Web vs. Fremdinhalte, Fremdinhalt-Hülle
    werkzeuge.ts    vault_lesen/liste/suchen/schreiben, freigabe_beantragen, kalender_lesen, post_suchen – mit Leine und werkzeug_log
    freigaben.ts    Anträge, atomar genau einmal entscheiden, Ausführer, Spiegel in Rathaus/freigaben/
    dienst.ts       Chats, Läufe, Warteschlange (Obergrenzen je Motor), Ausführung, Verlauf je Motor
    kontext.ts      Systemprompt (Stadtordnung, gebaeude.md, neueste Protokolle), Anhänge
    protokolle.ts   Protokoll pro Chat (Fakten aus DB/Log) + Chat-Spiegel in <Gebäude>/chats/
    motor-api.ts    api-Motor: eigene Streaming-Schleife, Beta-Endpunkt (Ausweichmodelle), Verlauf nur anhängen
    motor-claude-code.ts  claude-code-Motor: Auftrag an die Werkstatt, stream-json-Parser
    motor-attrappe.ts     Motor ohne Tokenverbrauch (Tests, DORF_MOTOR_ATTRAPPE=1)
    system.ts       SystemAufrufe: ein api-Aufruf OHNE Werkzeuge mit JSON-Schema-Antwort, verbucht als System-Chat (Einordnung, Zeitung)
    moodle-browser.ts Klient für den Moodle-Browser + Seitenauszug-Text; Werkzeuge moodle_* (werkzeuge.ts), nur mit werkzeuge: [moodle] + fremdinhalte
    rechenraum.ts   Klient für den Rechenraum + Ablage-Ordner (vom Code bestimmt) + erlaubte Endungen (.pdf/.tex)
    gedaechtnis.ts  Rathaus/memory.md (Bürgermeister pflegt selbst, Archiv, Version) + personality.md (nur per Freigabe) – E61
    buergermeister.ts     Bürgermeister (Etappe 2b): aktionen_liste, helfer_starten (max. 1 ohne Plan), plan_vorlegen (max. 10),
                          Plan-Ausführung durch den CODE nach Freigabe, Abschluss genau einmal, Status der Schreibtisch-Aufgabe
  src/bank.ts     Etappe 7 (E68): Kontoauszüge (CSV-Erkennung, Zuordnung je Format, PDF per Skill), Kategorien (Regeln, Leif, KI),
                  Abos, Budget/Sparziele aus Bank/einstellungen.md, Warnungen; Rechnungen aus Mails → To-do (dorf.ts)
  src/boerse.ts   Etappe 7 (E70): Depot/Watchlist (Boerse/depot.md), EODHD-Schlusskurse (≤ 19 Abrufe/Tag, ISIN → Kürzel gemerkt), EZB Euro/Dollar
  src/corps.ts    Etappe 7 (E69): Corps-Termine (Hauptkalender per Stichwort), Absenderliste für den Postboten (Corpshaus/einstellungen.md)
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
  src/kalender-google.ts E75: Marktplatz-Kalender über die Google Calendar API (Leif schreibt per App, nie Einladungen; Agenten nie); lernplan (E96)
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
  src/aufwachen.ts     Bürgermeister wacht jede Stunde auf (24/7, E56): Code prüft, KI nur bei NEUEN Anlässen (Lagebericht) oder
                       alle 3 h als Rundgang; Tagesbudget; Nachtruhe 22–7 für Telegram (istNacht, telegram/bot.ts nachtNachholen)
  src/intern.ts   interner Port 3001 (nur Docker-Netz): Werkzeugaufrufe der Werkstatt per Lauf-Token
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
apps/werkstatt  eigener Container: unverändertes claude-CLI (Version im Dockerfile gepinnt) + Runner (HTTP, startet
                claude, streamt stream-json) + stdio-MCP-Server "dorf" (reicht Werkzeugaufrufe an intern.ts weiter).
                Baut die claude-Argumente SELBST (auftrag.ts): nur Read/Glob/Grep (+Web wenn erlaubt), kein Bash/Edit/Write,
                --strict-mcp-config, --setting-sources user, kein --bare (bare liest kein Abo-Token).
apps/rechenraum eigener Container: pdflatex (texlive), Python (numpy/sympy/scipy/matplotlib), poppler; runner.py nur
                Standardbibliothek. Internes Netz ohne Internet, kein Vault, Arbeitsordner pro Chat, 120 s pro Befehl.
                Image-Kennung = Hash(Dockerfile+runner.py), wird nur ausgeliefert, wenn der Server es nicht hat.
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
packages/shared Typen für HTTP und WebSocket (LiveEreignis, VaultEintrag …) + Dorf-Layout-Regeln (dorf.ts) – wird in den Server gebündelt
vault-vorlage   Startinhalt des Vaults (Stadtordnung, gebaeude.md je Gebäude). Wird nur in einen LEEREN Vault kopiert.
deploy          compose.yml, Caddyfile, dorf (Server-Verwaltung), bootstrap.sh (Ersteinrichtung), test/ (Backup-/Deploy-Tests)
```

**Grundsätze**
- Der Server ist die einzige Quelle der Wahrheit. Jede Änderung (auch aus Obsidian über Syncthing) läuft über den Dateiwächter → `LiveHub` → alle Clients invalidieren ihre Queries.
- Alle Dateizugriffe gehen durch `VaultDienst`: Pfadnormalisierung (kein `..`, keine versteckten Segmente, keine Symlinks nach draußen), atomares Schreiben, **Konfliktkopie statt Überschreiben** (`basisVersion` = sha256), Löschen = Papierkorb (`.papierkorb/`).
- Ein Gebäude = Ordner auf oberster Ebene mit `gebaeude.md` (Frontmatter per Zod geprüft; Fehler werden angezeigt, nicht verschluckt).
- Schreibende Anfragen und WebSocket brauchen passende `Origin` (CSRF-Schutz) und ein gültiges Sitzungs-Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`).
- Rohdateien aus dem Vault werden mit `Content-Security-Policy: sandbox` ausgeliefert, HTML/SVG nur als Download (Vault-Inhalte können aus fremden Quellen stammen). Anzeigen lässt sich `.html` nur über `/api/vault/seite`: Skripte ja, aber undurchsichtiger Ursprung und kein Netz (E36).
- Geheimnisse nur auf dem Server – nie im Repo, nie im Vault: `/srv/dorf/.env` (Dorf: ANTHROPIC_API_KEY, EODHD_API_KEY, WERKSTATT_GEHEIMNIS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_FRISTEN_ICS, GOOGLE_PFLICHT_ICS, GOOGLE_TERMINE_ICS, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, MOODLE_KALENDER_URL, MOODLE_URL, MOODLE_TOKEN, RECHENRAUM_GEHEIMNIS), `/srv/dorf/rechenraum.env` (nur RECHENRAUM_GEHEIMNIS), `/srv/dorf/browser.env` (nur Browser-Container: BROWSER_GEHEIMNIS, MOODLE_BENUTZER, MOODLE_PASSWORT, BROWSER_HOSTS, MOODLE_WEB_URL) und `/srv/dorf/werkstatt.env` (Werkstatt: CLAUDE_CODE_OAUTH_TOKEN, WERKSTATT_GEHEIMNIS). Der API-Schlüssel erreicht die Werkstatt nie, das Abo-Token das Dorf nie.
- **Die Leine sitzt im Code** (`agenten/leine.ts`, `werkzeuge.ts`, Werkstatt-Argumente): Agenten haben kein eingebautes Schreiben/Shell, Außenwirkung nur über `freigabe_beantragen`, Ausführung erst nach Leifs Klick (`freigaben.ts`). Zeitgesteuerte Läufe des Bürgermeisters laufen über `api` mit Tagesbudget (`00_Stadtordnung/aufwachen.md`); Helfer, die er startet, über den Motor ihrer Aktion – meist claude-code/Abo (E56, ersetzt E51); Notschalter `alle_auf` übersteuert alles.
- api-Verlauf wird **nur angehängt**, Antworten unverändert zurückgeschickt (Opus 5.5/Fable 5.2 prüfen das).

## Befehle

```bash
pnpm install
pnpm dev                 # Server (3000, tsx watch) + Web (5173, Proxy auf /api)
pnpm --filter @dorf/server cli passwort   # lokales Passwort setzen (Daten in apps/server/daten/)
pnpm typecheck
pnpm test                # Vitest (Server inkl. Ende-zu-Ende über Werkstatt mit Fake-claude, Werkstatt)
pnpm build
pnpm e2e                 # Playwright, Desktop + Handy, startet eigenen Testserver (Port 3999); WebGL über SwiftShader
                         # Dorf-Debug: /?voll (volle Qualität trotz Software-Grafik), /?animiert (Animation erzwingen)
python3 -m unittest discover -s apps/rechenraum/test   # Rechenraum-Runner
bash deploy/test/backup-test.sh      # braucht restic, sqlite3, jq
bash deploy/test/empfangen-test.sh
bash deploy/test/moodle-anmelden-test.sh
cargo test --manifest-path apps/programm/src-tauri/Cargo.toml   # Programm (braucht libwebkit2gtk-4.1-dev u. a.)
bash apps/programm/test/selbsttest.sh   # Programm-Freigaben (laufender e2e-Server auf 3999, Xvfb)
shellcheck -x -S warning deploy/dorf deploy/bootstrap.sh deploy/test/*.sh
```
Lokal: `COOKIE_SICHER=false` setzen, wenn ohne HTTPS getestet wird (Dev-Server über Vite-Proxy braucht das). `DORF_MOTOR_ATTRAPPE=1` ersetzt beide Motoren durch die Attrappe (Befehle in der Nachricht: `[schreibe pfad]`, `[freigabe pfad]`, `[fehler]`, `[warte ms]`, `[pause ms]` (nach den Werkzeugen), `[helfer Gebäude|Auftrag]`, `[plan Gebäude|Titel; …]`, `<<werkzeug name {json}>>`).

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
- [x] Nacht 18./19.11. (Produktivität, E76–E88): Teil-Bau der Programme (nur Windows), Mein Tag (/heute), Fokus-Statistik + Nicht stören, Lernzeit einplanen, Wochenrückblick, Mail → To-do, Termin aus Text (/termin), Fach-Karten, Tag planen, Befehlspalette (Strg+K), ⭐ wichtig, Karteikarten (/karten), Tagesabschluss 21:00, Gewohnheiten mit Serien (E89), Telegram /plan (E90), Wochenziele (E91), wiederkehrende To-dos (E92), Statistik (E93), Erinnerungen an To-dos (E94), schnelle Notizen (E95), Lernplan bis zur Prüfung (E96), Überfälliges aufräumen (E97), Noten & ECTS (E98), Fokus → Erledigt? (E99), Telegram /woche (E100), Morgenzeitung-Schnellknöpfe (E101), Rückblick-Vorschläge → Wochenziele (E102), Telegram-Kurzformen (E103), /statistik (E104), Prüfungs-Wächter (E105), Gewohnheiten mit Uhrzeit (E106), Stimmung des Tages (E107), /suche (E108), Anschlüsse (E109), Gewohnheiten N× pro Woche (E110), Review-Korrekturen (E111), Das Dorf blüht (E112), Blüte in Zeitung + /noten (E113), Offline-Warteschlange + Lazy Loading (E114), Foto-Notiz + Anleitung (E115), Gewohnheiten bearbeiten (E116), Kursalarm (E117), Review 2 (E118), Teilschritte + KI-Zerlegen + Notiz → To-do (E119), Zeitschätzung (E120), Wochenplan (E121), Fokus je To-do + Schätzung lernen (E122), Jetzt dran (E123), Review 3 (E124), Filter im To-do-Brett (E125), Woche verteilen (E126), To-do aus Text überall (E127), /verteilen (E128), Wochenplanung /planen (E129), Uni-Schritte (E130), Dorf spiegelt den Tag (E131), Feinschliff (E132), Telegram-Schnellknöpfe (E133), Fokus-Ziel (E134), Review 4 (E135), Schritte im Fokus (E136), Lernziel je Fach (E137), Tastenkürzel (E138), /lernen + Lernen in der Zeitung (E139), Prüfungs-Cockpit (E140), Morgen im Blick (E141), Anstoß nach Terminen (E143), Heute neu geordnet (E142), beste Tageszeit (E144), Review 5 (E145), Tag abschließen (E146), Wartet auf … (E147), Gedanken parken (E148), Review 6 (E149), Wartet rundum (E150), Energie je To-do (E151), Aufschiebe-Zähler (E153), Nachbereiten (E154), Rauschen im Fokus (E155), /morgen (E156), Filter Wartet/Verschoben (E158), Gewohnheiten im Abschluss (E159)
