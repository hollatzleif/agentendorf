# Einrichtung – Schritt für Schritt

Einmalig. Danach deployt jeder Push auf `main` automatisch.

## 0. Was du brauchst

- Den Hostinger-VPS (frisch mit **Ubuntu 24.04 LTS** aufgesetzt, Root-Zugang)
- Eine kostenlose DuckDNS-Adresse, z. B. `agentendorf-lh.duckdns.org` (siehe Schritt 1)
- Dieses Repository als **privates** GitHub-Repo (Konto bitte mit 2FA schützen)
- Auf dem Mac: Terminal mit `ssh`

## 1. DuckDNS-Adresse

1. Auf [duckdns.org](https://www.duckdns.org) mit GitHub oder Google anmelden.
2. Unter *sub domain* einen freien Namen eintragen (z. B. `agentendorf-lh`) → *add domain*.
3. Bei *current ip* die **IP des VPS** eintragen → *update ip*.

Fertig: `agentendorf-lh.duckdns.org` zeigt auf den Server. Die VPS-IP ist fest, ein Updater ist nicht nötig. Das HTTPS-Zertifikat holt Caddy automatisch von Let's Encrypt (duckdns.org steht auf der Public-Suffix-Liste, die Zertifikatsgrenzen gelten also nur für deine Adresse).

Das DuckDNS-Token brauchst du **nicht** – bitte nirgends eintragen.

Im Folgenden steht `dorf.deine-domain.de` für deine DuckDNS-Adresse.

## 2. Zwei SSH-Schlüssel auf dem Mac

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519
```

```bash
ssh-keygen -t ed25519 -f ~/.ssh/dorf-deploy -N "" -C github-actions
```

Der erste ist **deiner** (Anmeldung am Server). Der zweite gehört **GitHub Actions** und darf auf dem Server nur Deploys abliefern.

## 3. Server einrichten (einmal, ca. 5 Minuten)

Repo auf den Mac holen (falls noch nicht da) und das Skript hochladen:

```bash
scp deploy/bootstrap.sh root@<IP>:
```

```bash
scp ~/.ssh/id_ed25519.pub ~/.ssh/dorf-deploy.pub root@<IP>:
```

```bash
ssh root@<IP> bash bootstrap.sh --benutzer leif --ssh-schluessel id_ed25519.pub --deploy-schluessel dorf-deploy.pub --domain dorf.deine-domain.de
```

Am Ende steht ein **Bericht** (CPU, RAM, empfohlene Parallelität, Werte für GitHub). **Wichtig:** Danach sind Root-Login und Passwort-Login aus. Teste in einem zweiten Terminal `ssh leif@dorf.deine-domain.de`, bevor du die Root-Sitzung schließt. (Notfall-Zugang: die Browser-Konsole im Hostinger-Panel.)

Falls im Hostinger-Panel eine eigene Firewall aktiv ist: Ports 22, 80, 443 und 22000 (TCP+UDP) freigeben.

## 4. GitHub-Secrets

Im Repo: *Settings → Secrets and variables → Actions → New repository secret*

| Name | Wert |
|---|---|
| `DEPLOY_HOST` | `dorf.deine-domain.de` |
| `DEPLOY_USER` | `leif` |
| `DEPLOY_SSH_KEY` | Inhalt von `~/.ssh/dorf-deploy` (der **private** Schlüssel, ohne `.pub`) |
| `DEPLOY_KNOWN_HOSTS` | die Zeile(n) aus dem Bericht von Schritt 3 |

Dann unter *Actions → Prüfen und ausliefern → Run workflow* starten (oder etwas auf `main` pushen).

## 5. Passwort setzen und einloggen

```bash
ssh leif@dorf.deine-domain.de
```

```bash
dorf passwort
```

Mindestens 14 Zeichen. Dann `https://dorf.deine-domain.de` öffnen. In *Einstellungen* kannst du den zweiten Faktor (TOTP) einschalten.

**Aufs Handy:** Seite im Browser öffnen → *Zum Startbildschirm hinzufügen* (iPhone: Teilen-Menü; Android: Menü → *App installieren*).

## 6. Agenten-Motoren anmelden

**claude-code-Motor (dein Max-Abo)** – auf dem Server:

```bash
dorf claude-anmelden
```

Es erscheint ein Link: im Browser öffnen, mit deinem Claude-Konto anmelden, das angezeigte Token kopieren und im Terminal einfügen (Eingabe bleibt unsichtbar). Das Token gilt ein Jahr und liegt nur in `/srv/dorf/werkstatt.env`.

**api-Motor (für alles Automatische)** – API-Schlüssel aus der [Claude Console](https://platform.claude.com) (*API Keys → Create Key*):

```bash
dorf api-schluessel
```

Danach im Rathaus die Aktion **Frage stellen** ausprobieren. Im Chat siehst du Motor, Modell und Token, das Protokoll liegt in `Rathaus/protokolle/`.

## 7. Telegram-Bot (Bürgermeister unterwegs)

Ein **eigener, neuer** Bot – nicht der deines Mail-Assistenten.

1. In Telegram **@BotFather** suchen und öffnen → `/newbot` schicken.
2. Namen eingeben, z. B. `Agentendorf`, dann einen Benutzernamen, der auf `bot` endet, z. B. `leifs_agentendorf_bot`.
3. BotFather zeigt ein **Token** (`123456789:AA…`). Kopieren – und **nur** auf dem Server einfügen:

```bash
dorf telegram-einrichten
```

4. Das Skript bittet dich, dem neuen Bot `/start` zu schicken, zeigt dann deinen Namen und deine Chat-ID – mit `ja` bestätigen.

Danach: Eine Textnachricht an den Bot landet als Aufgabe auf dem Schreibtisch, Freigaben kommen mit Ja/Nein-Knöpfen. Schreibst du innerhalb von 60 Minuten weiter, geht das Gespräch mit dem Bürgermeister weiter. Antwortest du auf eine bestimmte Nachricht, geht es in genau diesem Chat weiter. `/neu` startet eine neue Aufgabe. Welche Meldungen kommen, stellst du unter **Rathaus → Agenten-Einstellungen → Telegram** ein.

## 8. Uni: Fristen, Pflichttermine und deine Fächer

Die JKU sperrt den Zugang für die Moodle-App. Deshalb holt das Dorf nur die **Termine** automatisch, und zwar aus deinen Google-Kalendern. Folien und Übungsblätter legst du selbst ab.

**Fristen und Pflichttermine (einmalig):** Das Dorf liest die zwei Google-Kalender, die dein Moodle-Fristen-Skript nutzt: **„Moodle-Fristen (automatisch)“** (Abgaben ⏰, Prüfungen 📝, ✅ = erledigt) und **„JKU Pflicht“**. Aus „JKU Pflicht“ nimmt es nur Einträge, die mit `Pflicht:` oder `Prüfung:` beginnen.
1. Im Browser auf calendar.google.com: **Zahnrad → Einstellungen** → links den Kalender wählen → **Kalender integrieren** → **Geheime Adresse im iCal-Format** kopieren. Das machst du für beide Kalender. Die Adressen sind geheim, also nirgends weitergeben.
2. Auf dem Server:
   ```bash
   dorf google-kalender
   ```
   Das Skript fragt drei Adressen nacheinander ab: „Moodle-Fristen (automatisch)“, „JKU Pflicht“ und deinen **Hauptkalender**. Der Hauptkalender ist für die Morgenzeitung und wird nur gelesen, nie gespeichert. Enter ohne Eingabe lässt einen Kalender unverändert. Vor dem Speichern lädt das Skript jeden Kalender einmal zur Probe.
3. In der App: **Uni → Studium → Jetzt abgleichen**. Danach geht es automatisch alle 3 Stunden. Angezeigt wird nur, was gerade läuft oder noch kommt (Pflichttermine der nächsten 7 Tage). Erledigtes hakst du in der Liste ab, oder du setzt wie gewohnt ein ✅ vor den Titel im Google-Kalender. Für nicht Abgehaktes erinnert dich der Telegram-Bot (3 Tage, 1 Tag und 3 Stunden vorher, danach fragt er nach), mit Knopf **✅ Erledigt**.

> Dein Skript schickt weiterhin eigene Erinnerungsmails (8, 4 und 2 Stunden vorher). Willst du nur noch Telegram, setz im Skript `NAG_HOURS: []`. Ein Haken im Dorf landet nicht im Google-Kalender (die geheime Adresse ist nur lesbar).

**Fächer:** **Uni → Studium → Fach anlegen** legt `Uni/faecher/<Fach>/` mit `folien/`, `altklausuren/` und `aufgaben/` an. Dort hinein lädst du die Dateien hoch, in der Bibliothek oder per Obsidian:
- Übungsblätter: je Blatt ein Ordner oder direkt das PDF in `aufgaben/`. Erledigte Blätter verschiebst du nach `aufgaben/erledigt/`, dann bietet „Abgabe bearbeiten“ sie nicht mehr an.
- „Lernen“ liest alles im Fach-Ordner: Folien, Altklausuren, Übungen.

> `dorf moodle-anmelden` (der App-Weg) bleibt im Dorf, falls die JKU den App-Zugang je freischaltet.

**Moodle-Browser (Agent, der Moodle selbst durchsieht):** Ein eigener Container mit Chromium meldet sich mit deinem JKU-Login an und darf **nur lesen**. Abgeben, Formulare senden, „als erledigt markieren“ und Abmelden sind technisch gesperrt, ebenso jede Seite außerhalb von jku.at.
1. Auf dem Server (erst möglich, wenn `dorf status` einen Dienst `browser` zeigt; das passiert nach dem übernächsten Deploy automatisch):
   ```bash
   dorf moodle-browser-zugang
   ```
   Das Skript fragt Benutzername (k-Nummer) und Passwort, die Eingabe ist unsichtbar. Gespeichert wird nur in `/srv/dorf/browser.env`, die bekommt allein der Browser-Container. Danach meldet es sich zur Probe an und sagt „angemeldet“ oder warum nicht.
2. Führt die JKU-Anmeldung auf eine Domain außerhalb von jku.at (die Meldung nennt sie), gibst du sie beim nächsten Aufruf bei „Erlaubte Domains“ zusätzlich an, z. B. `jku.at,login.beispiel.org`. Nur eintragen, wenn es wirklich die JKU-Anmeldung ist.
3. In der App: **Uni → Aktionen → Moodle durchsehen**. Das Fach wählen und optional eine Frage stellen („Was muss ich bis Donnerstag vorbereiten?“). Der Agent holt neue Folien und Blätter nach `Uni/faecher/<Fach>/moodle/` und schreibt eine Übersicht: was ansteht, was schon abgegeben ist, was du vorbereiten solltest.
4. Auch der Bürgermeister kann das bei seinen Rundgängen als Helfer losschicken (über dein Abo).

## 9. Post: Gmail verbinden (nur Lesen und Entwürfe)

Das Dorf liest dein Gmail und legt höchstens **Entwürfe** an. Senden kann es nicht, weil die Anmeldung das gar nicht erlaubt.

**Google-Cloud-Projekt (einmalig, im Browser):**
1. Öffne **console.cloud.google.com** und melde dich mit dem Gmail-Konto an, das das Dorf lesen soll. Leg oben über die Projektauswahl ein **neues Projekt** an, z. B. `Agentendorf`.
2. Unter **APIs & Dienste → Bibliothek** nach **Gmail API** suchen und auf **Aktivieren** klicken.
3. Unter **OAuth-Zustimmungsbildschirm** (teils „Google Auth Platform“) einstellen:
   - Nutzertyp **Extern**, App-Name `Agentendorf`, deine Mail als Kontakt.
   - Bei **Testnutzer** deine Gmail-Adresse eintragen.
   - Bei **Bereiche/Datenzugriff** `.../auth/gmail.readonly` und `.../auth/gmail.compose` hinzufügen.
4. Unter **Clients** (oder „Anmeldedaten → OAuth-Client-ID erstellen“) als Anwendungstyp **Desktop-App** wählen. Notier dir **Client-ID** und **Clientschlüssel**, aber gib sie nirgends weiter.
5. **Wichtig:** Stell die App auf **In Produktion** (Zielgruppe / Veröffentlichungsstatus). Im Status „Testing“ läuft die Anmeldung laut Google-Foren nach 7 Tagen ab. Google zeigt dann beim Anmelden „App nicht überprüft“. Für deine eigene App klickst du auf **Erweitert → Weiter zu Agentendorf**.

**Auf dem Server:**
```bash
dorf gmail-anmelden
```
Das Skript fragt nach Client-ID und Clientschlüssel und zeigt dann eine Google-Adresse. Die öffnest du im Browser, meldest dich an und erlaubst beide Zugriffe. Danach lädt eine Seite, die nicht erreichbar ist (`127.0.0.1`), das ist richtig so. Kopier die **komplette Adresse** aus der Adresszeile und füg sie im Terminal ein.

Danach in der App: **Post → Eingang → Jetzt abholen**. Ab dann holt das Dorf alle 10 Minuten neue Mails ab, ordnet sie mit dem `api`-Motor (kleine Stufe) ein und hält sie knapp in `Post/eingang/` fest. Telegram-Meldungen zu Mails sind aus, solange du sie nicht unter **Rathaus → Agenten-Einstellungen → Telegram** einschaltest.

Meldet das Dorf irgendwann „Google-Anmeldung abgelaufen oder widerrufen“, führst du `dorf gmail-anmelden` noch einmal aus. Passiert das jede Woche, steht das Projekt noch auf „Testing“.

### Morgenzeitung und Aufwachen

Beides läuft ohne Einrichtung, sobald das Dorf läuft:
- **Morgenzeitung** jeden Morgen um 06:30: im Rathaus (Reiter „Morgenzeitung“, dort auch „Jetzt neu erstellen“), in `Rathaus/morgenzeitung/` und per Telegram.
- **Aufwachen** des Bürgermeisters um 7, 9, …, 21 Uhr. Die KI kommt nur zum Einsatz, wenn es etwas Neues gibt. Zum Ausprobieren: Rathaus → Schreibtisch → „Jetzt aufwachen“.

Für die Einleitung der Zeitung und das Einordnen der Mails braucht das Dorf den API-Schlüssel (`dorf api-schluessel`).

## 10. Vault auf Mac und PCs (Syncthing + Obsidian)

1. Syncthing installieren: Mac `brew install --cask syncthing` (oder syncthing.net), Windows: *Syncthing Windows Setup* von syncthing.net/downloads.
2. Geräte-ID des Servers anzeigen:
   ```bash
   dorf syncthing-id
   ```
3. In Syncthing auf dem Mac: *Gerät hinzufügen* → Server-ID eintragen. Die eigene ID des Macs steht unter *Aktionen → ID anzeigen*.
4. Auf dem Server den Mac koppeln:
   ```bash
   dorf syncthing-geraet <ID-DES-MACS> MacBook
   ```
5. Auf dem Mac erscheint die Freigabe „Agentendorf“ → annehmen, Ordner wählen (z. B. `~/Agentendorf`).
6. In Obsidian: *Ordner als Vault öffnen* → diesen Ordner.

Für Windows-PC und -Laptop ebenso. Konflikte überschreibt Syncthing nie. Es legt `…sync-conflict…`-Dateien an, und die App zeigt sie oben rechts an.

> Falls `dorf syncthing-geraet` meldet, dass ein Befehl unbekannt ist (Syncthing ändert seine Kommandozeile gelegentlich), geht es auch über die Oberfläche: `ssh -L 8384:127.0.0.1:8384 leif@dorf.deine-domain.de`, dann im Browser `http://localhost:8384`.

## 11. Backup prüfen (einmal real)

```bash
dorf backup
```

```bash
dorf restore-test
```

Echte Wiederherstellung üben: eine Testdatei im Vault anlegen, `dorf backup`, Datei löschen, dann

```bash
dorf wiederherstellen latest
```

Danach ist die Datei wieder da. Der vorherige Stand liegt unter `/srv/dorf/vault.vor-wiederherstellung-…` und kann danach gelöscht werden.

Ab dann läuft die Sicherung täglich um 03:30. Es bleiben genau die Stände der letzten 7 Tage.

## Alltag

```bash
dorf status
```

```bash
dorf logs dorf
```

```bash
dorf rollback
```

`dorf hilfe` zeigt alles.
