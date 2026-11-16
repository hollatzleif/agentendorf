---
titel: Motoren
# Notschalter: "keiner" = jede Aktion nutzt ihren eigenen Motor.
# "api" oder "claude-code" = alle Aktionen laufen über diesen Motor.
alle_auf: keiner
# Wie viele Agenten gleichzeitig laufen dürfen (KVM 1: 1 vCPU, 4 GB RAM)
parallel:
  claude-code: 2
  api: 4
---

# Motoren

- **api** – Anthropic API mit API-Schlüssel. Für alles, was automatisch startet.
- **claude-code** – Claude Code auf dem Server mit Leifs Abo. Nur für Läufe, die Leif selbst startet.

Mehr dazu in `ENTSCHEIDUNGEN.md` im Code-Repository.
