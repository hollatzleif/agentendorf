---
name: Repository holen
beschreibung: "Klont ein GitHub-Repository ins Codehaus und richtet es ein (Abhängigkeiten, erster Test) – danach liegt es in VS Code bereit."
motor: coding
stufe: klein
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben]
fremdinhalte: nein
eingaben:
  - name: repo
    beschriftung: "Repository (besitzer/name oder GitHub-Adresse)"
    typ: text
  - name: projekt
    beschriftung: "Ordnername unter /arbeit (leer = Name des Repositorys)"
    typ: text
    pflicht: nein
---
Hol das Repository **{repo}** ins Codehaus.

1. Zielordner: `/arbeit/{projekt}` – ist kein Ordnername genannt, `/arbeit/<Name des Repositorys>`. Gibt es den Ordner schon: nichts überschreiben, nur `git status` und `git fetch` und berichten, wie er dasteht.
2. `gh repo clone {repo} <Zielordner>`.
3. Lies README und `CLAUDE.md`. Installiere die Abhängigkeiten so, wie das Projekt es vorsieht (Lockfile beachten; Python in einem venv im Projektordner). Installations-Skripte fremder Projekte nur ausführen, wenn sie zum normalen Aufbau gehören.
4. Lass einmal Tests oder Build laufen, wenn es dafür einen klaren Befehl gibt (höchstens ein paar Minuten).
5. Antwort: Ordner, Hauptzweig, wie man baut/testet, ob der erste Lauf grün war, Auffälligkeiten. Nichts committen, nichts pushen.
