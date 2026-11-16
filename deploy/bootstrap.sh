#!/usr/bin/env bash
# Agentendorf – Ersteinrichtung eines frischen Ubuntu-LTS-Servers. Einmal als root ausführen:
#
#   bash bootstrap.sh --benutzer leif \
#     --ssh-schluessel id_ed25519.pub \
#     --deploy-schluessel dorf-deploy.pub \
#     --domain dorf.example.de
#   (Schlüssel als Datei oder direkt als Text "ssh-ed25519 AAAA…")
#
# Was passiert:
#   1. Systemupdate, Grundpakete, 4 GB Swap, Zeitzone
#   2. Benutzer mit sudo, SSH nur per Schlüssel, Root-Login aus
#   3. Firewall (ufw): 22, 80, 443, 22000 (Syncthing); fail2ban; automatische Sicherheitsupdates mit Neustart 04:00
#   4. Docker
#   5. /srv/dorf mit .env (Geheimnisse) und Backup-Passwort, Backup-Timer 03:30
#   6. Empfang für Deploys aus GitHub Actions (eingeschränkter SSH-Schlüssel)
#   7. Bericht: CPU, RAM, Platte, empfohlene Parallelität, SSH-Fingerabdruck für GitHub
#
# Das Skript ist wiederholbar: ein zweiter Lauf ändert nur, was fehlt.
set -euo pipefail

BENUTZER=""; SSH_SCHLUESSEL=""; DEPLOY_SCHLUESSEL=""; DOMAIN=""; ZEITZONE="Europe/Vienna"
while [ $# -gt 0 ]; do
  case "$1" in
    --benutzer) BENUTZER=$2; shift 2 ;;
    --ssh-schluessel) SSH_SCHLUESSEL=$2; shift 2 ;;
    --deploy-schluessel) DEPLOY_SCHLUESSEL=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    --zeitzone) ZEITZONE=$2; shift 2 ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen."; exit 1; }
# Schlüssel dürfen auch als Datei übergeben werden (z. B. id_ed25519.pub); Windows-Zeilenenden werden entfernt.
schluessel_lesen() { if [ -n "$1" ] && [ -f "$1" ]; then tr -d '\r' < "$1" | head -n1; else printf '%s' "$1" | tr -d '\r'; fi; }
SSH_SCHLUESSEL=$(schluessel_lesen "$SSH_SCHLUESSEL")
DEPLOY_SCHLUESSEL=$(schluessel_lesen "$DEPLOY_SCHLUESSEL")
[ -n "$BENUTZER" ] && [ -n "$SSH_SCHLUESSEL" ] && [ -n "$DOMAIN" ] || { echo "Pflicht: --benutzer, --ssh-schluessel, --domain"; exit 1; }
case "$SSH_SCHLUESSEL" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;; *) echo "--ssh-schluessel sieht nicht wie ein öffentlicher SSH-Schlüssel aus."; exit 1 ;; esac
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "Dieses Skript ist für Ubuntu gedacht (gefunden: ${PRETTY_NAME:-?})."; exit 1; }

schritt() { printf '\n\033[1;32m== %s ==\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

schritt "1/7 System aktualisieren"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades restic sqlite3 jq
timedatectl set-timezone "$ZEITZONE" || true
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/90-dorf.conf
fi

schritt "2/7 Benutzer $BENUTZER und SSH"
if ! id "$BENUTZER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$BENUTZER"
fi
usermod -aG sudo "$BENUTZER"
# sudo ohne Passwort (es gibt keins – Anmeldung nur per Schlüssel)
echo "$BENUTZER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$BENUTZER" && chmod 440 "/etc/sudoers.d/90-$BENUTZER"
HOME_DIR=$(getent passwd "$BENUTZER" | cut -d: -f6)
install -d -m 700 -o "$BENUTZER" -g "$BENUTZER" "$HOME_DIR/.ssh"
AK="$HOME_DIR/.ssh/authorized_keys"
touch "$AK"
grep -qF "$SSH_SCHLUESSEL" "$AK" || echo "$SSH_SCHLUESSEL" >> "$AK"
if [ -n "$DEPLOY_SCHLUESSEL" ]; then
  # Der Schlüssel für GitHub Actions darf nur Deploy-Bündel abliefern – sonst nichts.
  ZEILE="command=\"/usr/local/bin/dorf-ci\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $DEPLOY_SCHLUESSEL"
  grep -qF "$DEPLOY_SCHLUESSEL" "$AK" || echo "$ZEILE" >> "$AK"
fi
chown "$BENUTZER:$BENUTZER" "$AK"; chmod 600 "$AK"

cat > /etc/ssh/sshd_config.d/90-dorf.conf <<SSHD
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $BENUTZER
MaxAuthTries 4
X11Forwarding no
SSHD
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

schritt "3/7 Firewall, fail2ban, automatische Updates"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw allow 22000/tcp >/dev/null
ufw allow 22000/udp >/dev/null
ufw --force enable
cat > /etc/fail2ban/jail.d/dorf.conf <<F2B
[sshd]
enabled = true
maxretry = 5
bantime = 1h
F2B
systemctl enable --now fail2ban >/dev/null
cat > /etc/apt/apt.conf.d/52dorf-unattended <<APT
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
APT
cat > /etc/apt/apt.conf.d/20auto-upgrades <<APT
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades >/dev/null

schritt "4/7 Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$BENUTZER"
cat > /etc/docker/daemon.json <<DJ
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
DJ
systemctl restart docker

schritt "5/7 /srv/dorf, Geheimnisse, Backup"
DORF_UID=$(id -u "$BENUTZER")
install -d -m 750 -o "$BENUTZER" -g "$BENUTZER" /srv/dorf /srv/dorf/app /srv/dorf/app/releases /srv/dorf/vault /srv/dorf/daten /srv/dorf/syncthing /srv/dorf/claude
install -d -m 700 -o root -g root /srv/dorf/backup
if [ ! -f /srv/dorf/.env ]; then
  cat > /srv/dorf/.env <<ENV
# Agentendorf – Geheimnisse und Einstellungen. Nur auf dem Server, nie im Repo, nie im Vault.
DORF_DOMAIN=$DOMAIN
DORF_UID=$DORF_UID
WERKSTATT_GEHEIMNIS=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
# api-Motor – eintragen mit: dorf api-schluessel
# ANTHROPIC_API_KEY=
# ab Etappe 2b:
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
ENV
fi
sed -i "s/^DORF_DOMAIN=.*/DORF_DOMAIN=$DOMAIN/" /srv/dorf/.env
chown root:"$BENUTZER" /srv/dorf/.env; chmod 640 /srv/dorf/.env
if [ ! -f /srv/dorf/werkstatt.env ]; then
  G=$(grep -E '^WERKSTATT_GEHEIMNIS=' /srv/dorf/.env | cut -d= -f2)
  printf '# Nur für den Werkstatt-Container. Abo-Token mit: dorf claude-anmelden\nWERKSTATT_GEHEIMNIS=%s\nCLAUDE_CODE_OAUTH_TOKEN=\n' "$G" > /srv/dorf/werkstatt.env
fi
chown "$BENUTZER:$BENUTZER" /srv/dorf/werkstatt.env; chmod 600 /srv/dorf/werkstatt.env
[ -f /srv/dorf/backup/restic-passwort ] || (umask 077; head -c 32 /dev/urandom | base64 > /srv/dorf/backup/restic-passwort)

cat > /etc/systemd/system/dorf-backup.service <<UNIT
[Unit]
Description=Agentendorf: tägliche Sicherung (7 Tage)
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dorf backup
UNIT
cat > /etc/systemd/system/dorf-backup.timer <<UNIT
[Unit]
Description=Agentendorf: Sicherung täglich 03:30
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now dorf-backup.timer >/dev/null

schritt "6/7 Deploy-Empfang"
# Kleiner Empfänger: nimmt das Bündel an und ruft danach das mitgelieferte dorf-Skript auf.
cat > /usr/local/bin/dorf-ci <<'CI'
#!/usr/bin/env bash
set -euo pipefail
if [ -x /srv/dorf/app/current/deploy/dorf ] && [ "${SSH_ORIGINAL_COMMAND:-}" != "empfangen" ]; then
  exec /srv/dorf/app/current/deploy/dorf ci
fi
[ "${SSH_ORIGINAL_COMMAND:-}" = "empfangen" ] || { echo "Nicht erlaubt"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/buendel.tar.gz"
tar -xzf "$tmp/buendel.tar.gz" -C "$tmp" deploy/dorf
# Das neue dorf-Skript aus dem Bündel übernimmt (so ist auch der erste Deploy möglich).
sudo -n DORF_BASIS=/srv/dorf bash "$tmp/deploy/dorf" empfangen < "$tmp/buendel.tar.gz"
CI
chmod 755 /usr/local/bin/dorf-ci
# Vor dem ersten Deploy: Platzhalter, damit "dorf" schon existiert
[ -e /usr/local/bin/dorf ] || { printf '#!/bin/sh\necho "Noch kein Deploy erfolgt."\n' > /usr/local/bin/dorf; chmod 755 /usr/local/bin/dorf; }

schritt "7/7 Bericht"
CPU=$(nproc); RAM_MB=$(free -m | awk '/^Mem:/{print $2}'); PLATTE=$(df -h / | awk 'NR==2{print $2" gesamt, "$4" frei"}')
if [ "$RAM_MB" -lt 6000 ]; then PAR_CC=2; PAR_API=4; else PAR_CC=4; PAR_API=6; fi
cat <<BERICHT

  Server:       ${PRETTY_NAME}
  CPU-Kerne:    $CPU
  RAM:          ${RAM_MB} MB (+ 4 GB Swap)
  Platte:       $PLATTE
  Empfehlung:   claude-code parallel $PAR_CC, api parallel $PAR_API
                (steht in 00_Stadtordnung/motoren.md im Vault)

  Benutzer:     $BENUTZER (sudo, Docker), SSH nur per Schlüssel, Root-Login aus
  Firewall:     22, 80, 443, 22000 offen
  Domain:       $DOMAIN  → DNS-A-Eintrag muss auf diese IP zeigen: $(curl -fsS -4 https://ifconfig.me 2>/dev/null || echo '?')

  Für GitHub (Repository → Settings → Secrets → Actions):
    DEPLOY_HOST          = $DOMAIN  (oder die IP)
    DEPLOY_USER          = $BENUTZER
    DEPLOY_KNOWN_HOSTS   = (die folgenden Zeilen)
$(ssh-keyscan -t ed25519 localhost 2>/dev/null | sed "s/^localhost/$DOMAIN/" | sed 's/^/      /')

  WICHTIG: Bevor du diese Sitzung schließt, in einem ZWEITEN Terminal testen:
    ssh $BENUTZER@$DOMAIN
  Root-Login und Passwort-Login sind ab jetzt aus.
BERICHT
