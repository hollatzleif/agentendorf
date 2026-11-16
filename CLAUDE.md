# Agentendorf – Hinweise für Claude

Persönliche Agenten-Zentrale für **Leif** (einziger Nutzer). Oberfläche, Vault-Texte, Agenten-Anweisungen und Code-Bezeichner sind **deutsch**. Gebaut wird in Etappen (siehe `ENTSCHEIDUNGEN.md` und Abschnitt „Stand“ unten). Vor jeder Etappe: kurzer Plan, offene Fragen, Leifs Freigabe.

## Architektur

```
apps/server     Node + Fastify + SQLite (better-sqlite3). Einstieg: src/start.ts, Zusammenbau: src/dorf.ts, Routen: src/app.ts
  src/auth/       Passwort (Argon2id), Sitzungen (Cookie, nur Hash in DB), Drossel, TOTP (eigene RFC-6238-Implementierung)
  src/vault/      VaultDienst (einziger Weg zu den Dateien), Pfadregeln, Gebäude-Erkennung, Suche (FTS5), Dateiwächter
  src/live.ts     WebSocket-Hub: Ereignisse an alle Geräte
  src/cli.ts      Verwaltung (passwort, totp-aus, sitzungen-beenden, db-sichern, vault-ergaenzen)
apps/web        React + Vite, eigener Mini-Router (src/router.ts), TanStack Query, PWA (vite-plugin-pwa)
packages/shared Typen für HTTP und WebSocket (LiveEreignis, VaultEintrag …) – wird in den Server gebündelt
vault-vorlage   Startinhalt des Vaults (Stadtordnung, gebaeude.md je Gebäude). Wird nur in einen LEEREN Vault kopiert.
deploy          compose.yml, Caddyfile, dorf (Server-Verwaltung), bootstrap.sh (Ersteinrichtung), test/ (Backup-/Deploy-Tests)
```

**Grundsätze**
- Der Server ist die einzige Quelle der Wahrheit. Jede Änderung (auch aus Obsidian über Syncthing) läuft über den Dateiwächter → `LiveHub` → alle Clients invalidieren ihre Queries.
- Alle Dateizugriffe gehen durch `VaultDienst`: Pfadnormalisierung (kein `..`, keine versteckten Segmente, keine Symlinks nach draußen), atomares Schreiben, **Konfliktkopie statt Überschreiben** (`basisVersion` = sha256), Löschen = Papierkorb (`.papierkorb/`).
- Ein Gebäude = Ordner auf oberster Ebene mit `gebaeude.md` (Frontmatter per Zod geprüft; Fehler werden angezeigt, nicht verschluckt).
- Schreibende Anfragen und WebSocket brauchen passende `Origin` (CSRF-Schutz) und ein gültiges Sitzungs-Cookie (`HttpOnly`, `Secure`, `SameSite=Strict`).
- Rohdateien aus dem Vault werden mit `Content-Security-Policy: sandbox` ausgeliefert, HTML/SVG nur als Download (Vault-Inhalte können aus fremden Quellen stammen).
- Geheimnisse nur in `/srv/dorf/.env` auf dem Server – nie im Repo, nie im Vault.

## Befehle

```bash
pnpm install
pnpm dev                 # Server (3000, tsx watch) + Web (5173, Proxy auf /api)
pnpm --filter @dorf/server cli passwort   # lokales Passwort setzen (Daten in apps/server/daten/)
pnpm typecheck
pnpm test                # Vitest (Server)
pnpm build
pnpm e2e                 # Playwright, Desktop + Handy, startet eigenen Testserver (Port 3999)
bash deploy/test/backup-test.sh      # braucht restic, sqlite3, jq
bash deploy/test/empfangen-test.sh
shellcheck -x -S warning deploy/dorf deploy/bootstrap.sh deploy/test/*.sh
```
Lokal: `COOKIE_SICHER=false` setzen, wenn ohne HTTPS getestet wird (Dev-Server über Vite-Proxy braucht das).

**Auf dem Server:** `dorf hilfe`. Deploy = Push auf `main` → GitHub Actions testet, baut das Image, schickt ein Bündel per SSH (erzwungener Befehl `empfangen`) → `dorf empfangen` schaltet um, prüft Gesundheit, rollt bei Fehler zurück.

## Konventionen

- Deutsche Bezeichner (`vaultDienst`, `schreiben`, `Gebaeude`), Umlaute nur in Texten/Kommentaren, nicht in Bezeichnern oder Dateinamen.
- Neue Dateinamen im Vault: ASCII (`dateinameBereinigen`), Agenten-Schema `JJJJ-MM-TT_HHMM_kurztitel.md`.
- DB-Migrationen nur anhängen (`src/db.ts`, `MIGRATIONEN`), nie bestehende ändern.
- Tests sind Pflicht für alles, was Daten verändert oder nach außen wirkt (Leine, Freigaben, Vault-Regeln, Backup). Zeit in Tests über `TestUhr`.
- Nichts erfinden: Wenn eine Schnittstelle (Moodle, Gmail, Claude-Auth) anders funktioniert als angenommen → stoppen und Leif fragen.
- Entscheidungen mit Begründung in `ENTSCHEIDUNGEN.md` festhalten.

## Stand

- [x] Etappe 1 – Fundament (Code fertig und getestet; Deploy auf den Server steht aus, siehe EINRICHTUNG.md)
- [ ] Etappe 2a – Agenten-Kern
- [ ] Etappe 2b – Bürgermeister + Telegram
- [ ] Etappe 3 – Uni
- [ ] Etappe 4 – Post, Kalender, To-dos, Aufwachen, Morgenzeitung
- [ ] Etappe 5 – Dorf (Isometrie)
- [ ] Etappe 6 – Programme (Tauri)
- [ ] Etappe 7 – Marktplatz-Brett, leere Gebäude
