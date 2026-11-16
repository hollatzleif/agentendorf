# Einrichtung – Schritt für Schritt

Einmalig. Danach deployt jeder Push auf `main` automatisch.

## 0. Was du brauchst

- Den Hostinger-VPS (frisch mit **Ubuntu 24.04 LTS** aufgesetzt, Root-Zugang)
- Eine Domain oder Subdomain, z. B. `dorf.deine-domain.de`
- Dieses Repository als **privates** GitHub-Repo (Konto bitte mit 2FA schützen)
- Auf dem Mac: Terminal mit `ssh`

## 1. DNS

Beim Domain-Anbieter einen **A-Eintrag** anlegen: `dorf.deine-domain.de → <IP des VPS>`. Das muss stehen, bevor Caddy das Zertifikat holt (dauert oft nur Minuten).

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
ssh root@<IP> bash bootstrap.sh --benutzer leif --ssh-schluessel "\"$(cat ~/.ssh/id_ed25519.pub)\"" --deploy-schluessel "\"$(cat ~/.ssh/dorf-deploy.pub)\"" --domain dorf.deine-domain.de
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

## 6. Vault auf Mac und PCs (Syncthing + Obsidian)

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

## 7. Backup prüfen (einmal real)

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
