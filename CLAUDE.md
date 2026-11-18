# Agentendorf – Hinweise für Claude

Persönliche Agenten-Zentrale für **Leif** (einziger Nutzer). Oberfläche, Vault-Texte, Agenten-Anweisungen und Code-Bezeichner sind **deutsch**. Gebaut wird in Etappen (siehe `ENTSCHEIDUNGEN.md` und Abschnitt „Stand“ unten). Vor jeder Etappe: kurzer Plan, offene Fragen, Leifs Freigabe.

## Architektur

```
apps/server     Node + Fastify + SQLite (better-sqlite3). Einstieg: src/start.ts, Zusammenbau: src/dorf.ts, Routen: src/app.ts
  src/auth/       Passwort (Argon2id), Sitzungen (Cookie, nur Hash in DB), Drossel, TOTP (eigene RFC-6238-Implementierung)
  src/vault/      VaultDienst (einziger Weg zu den Dateien), Pfadregeln, Gebäude-Erkennung, Suche (FTS5), Dateiwächter
  src/agenten/    Agenten-Kern (Etappe 2a):
    aktionen.ts     Aktionen = Markdown-Skills in <Gebäude>/aktionen/ (Zod-Frontmatter, Fehler sichtbar)
    modelle.ts      Stufen klein/mittel/gross + Motoren/Notschalter aus 00_Stadtordnung/{modelle,motoren}.md
    leine.ts        DIE Stelle für Regeln: Werkzeugprofil, Schreibregeln, Web vs. Fremdinhalte, Fremdinhalt-Hülle
    werkzeuge.ts    vault_lesen/liste/suchen/schreiben, freigabe_beantragen – mit Leine und werkzeug_log
    freigaben.ts    Anträge, atomar genau einmal entscheiden, Ausführer, Spiegel in Rathaus/freigaben/
    dienst.ts       Chats, Läufe, Warteschlange (Obergrenzen je Motor), Ausführung, Verlauf je Motor
    kontext.ts      Systemprompt (Stadtordnung, gebaeude.md, neueste Protokolle), Anhänge
    protokolle.ts   Protokoll pro Chat (Fakten aus DB/Log) + Chat-Spiegel in <Gebäude>/chats/
    motor-api.ts    api-Motor: eigene Streaming-Schleife, Beta-Endpunkt (Ausweichmodelle), Verlauf nur anhängen
    motor-claude-code.ts  claude-code-Motor: Auftrag an die Werkstatt, stream-json-Parser
    motor-attrappe.ts     Motor ohne Tokenverbrauch (Tests, DORF_MOTOR_ATTRAPPE=1)
    system.ts       SystemAufrufe: ein api-Aufruf OHNE Werkzeuge mit JSON-Schema-Antwort, verbucht als System-Chat (Einordnung, Zeitung)
    rechenraum.ts   Klient für den Rechenraum + Ablage-Ordner (vom Code bestimmt) + erlaubte Endungen (.pdf/.tex)
    buergermeister.ts     Bürgermeister (Etappe 2b): aktionen_liste, helfer_starten (max. 1 ohne Plan), plan_vorlegen (max. 10),
                          Plan-Ausführung durch den CODE nach Freigabe, Abschluss genau einmal, Status der Schreibtisch-Aufgabe
  src/schreibtisch.ts  Aufgaben = Notizen in Rathaus/schreibtisch/ (DB führt Status, Frontmatter spiegelt ihn); App/Telegram starten
                       den Bürgermeister sofort, Notizen aus Obsidian/von Agenten werden nur aufgenommen
  src/telegram/   eigener Bot ohne Bibliothek (fetch, Long Polling): nur EIN gekoppelter Chat, signierte Knöpfe (HMAC) über
                  freigaben.entscheiden, Meldungen schaltbar in 00_Stadtordnung/telegram.md, Weitergeleitetes = Fremdinhalt
  src/uni/        Etappe 3 (E41/E44): JKU sperrt den Moodle-App-Zugang → Termine aus Leifs Google-Kalendern („Moodle-Fristen
                  (automatisch)“ aus seinem Apps-Skript + „JKU Pflicht“; ical.ts mit RRULE, alle 3 h),
                  Fächer/Abgaben = Leifs Ordner unter Uni/faecher/ (abgleich.ts: faecher(), abgaben(), fachAnlegen()).
                  Der App-Weg (moodle.ts, appAbgleichen) bleibt im Code, falls die JKU ihn freischaltet.
                  text.ts: Moodle-HTML → Markdown, Fristen in Linzer Zeit
  src/post/       Etappe 4: google-oauth.ts (PKCE, Refresh-Token), gmail.ts (REST: profile/list/history/get/drafts – nie senden),
                  postbote.ts (Abruf alle 10 min, Einordnung ohne Werkzeuge, Post/eingang/JJJJ-MM-TT.md, keine Mailtexte)
  src/kalender.ts      Hauptkalender (geheime iCal-Adresse) – nur lesen, nie speichern
  src/morgenzeitung.ts 06:30 Linz: Fakten vom Code + KI-Einleitung → Rathaus/morgenzeitung/, Rathaus-Reiter, Telegram
  src/aufwachen.ts     Bürgermeister wacht um 7–21 Uhr (alle 2 h) auf: Code prüft, KI nur bei NEUEN Anlässen (Lagebericht)
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
    figuren.ts      Agenten + Bürgermeister, Wege über Straßen (wege.ts, A*), Blasen
    bauen.ts        Bau-Modus: Gesten → Layout (Prüfung wie Server: layoutPruefen aus packages/shared)
    DorfAnsicht.tsx Seite: Szene, Knöpfe, Gebäude-Menü (GebaeudeInhalt), Figurenkarte, Bau-Leiste, Speichern mit basisVersion
apps/werkstatt  eigener Container: unverändertes claude-CLI (Version im Dockerfile gepinnt) + Runner (HTTP, startet
                claude, streamt stream-json) + stdio-MCP-Server "dorf" (reicht Werkzeugaufrufe an intern.ts weiter).
                Baut die claude-Argumente SELBST (auftrag.ts): nur Read/Glob/Grep (+Web wenn erlaubt), kein Bash/Edit/Write,
                --strict-mcp-config, --setting-sources user, kein --bare (bare liest kein Abo-Token).
apps/rechenraum eigener Container: pdflatex (texlive), Python (numpy/sympy/scipy/matplotlib), poppler; runner.py nur
                Standardbibliothek. Internes Netz ohne Internet, kein Vault, Arbeitsordner pro Chat, 120 s pro Befehl.
                Image-Kennung = Hash(Dockerfile+runner.py), wird nur ausgeliefert, wenn der Server es nicht hat.
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
- Geheimnisse nur auf dem Server – nie im Repo, nie im Vault: `/srv/dorf/.env` (Dorf: ANTHROPIC_API_KEY, WERKSTATT_GEHEIMNIS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_FRISTEN_ICS, GOOGLE_PFLICHT_ICS, GOOGLE_TERMINE_ICS, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, MOODLE_KALENDER_URL, MOODLE_URL, MOODLE_TOKEN, RECHENRAUM_GEHEIMNIS), `/srv/dorf/rechenraum.env` (nur RECHENRAUM_GEHEIMNIS) und `/srv/dorf/werkstatt.env` (Werkstatt: CLAUDE_CODE_OAUTH_TOKEN, WERKSTATT_GEHEIMNIS). Der API-Schlüssel erreicht die Werkstatt nie, das Abo-Token das Dorf nie.
- **Die Leine sitzt im Code** (`agenten/leine.ts`, `werkzeuge.ts`, Werkstatt-Argumente): Agenten haben kein eingebautes Schreiben/Shell, Außenwirkung nur über `freigabe_beantragen`, Ausführung erst nach Leifs Klick (`freigaben.ts`). Zeitgesteuerte Läufe laufen immer über `api` – auch Helfer, die daraus entstehen (E51); Notschalter `alle_auf` übersteuert alles.
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
shellcheck -x -S warning deploy/dorf deploy/bootstrap.sh deploy/test/*.sh
```
Lokal: `COOKIE_SICHER=false` setzen, wenn ohne HTTPS getestet wird (Dev-Server über Vite-Proxy braucht das). `DORF_MOTOR_ATTRAPPE=1` ersetzt beide Motoren durch die Attrappe (Befehle in der Nachricht: `[schreibe pfad]`, `[freigabe pfad]`, `[fehler]`, `[warte ms]`, `[helfer Gebäude|Auftrag]`, `[plan Gebäude|Titel; …]`, `<<werkzeug name {json}>>`).

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
- [ ] Etappe 6 – Programme (Tauri)
- [ ] Etappe 7 – Marktplatz-Brett, leere Gebäude
