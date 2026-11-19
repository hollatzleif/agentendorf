# Vorlage für eigene Skills (Aktionen)

Ein Skill ist eine Markdown-Datei in `<Gebäude>/aktionen/`, z. B. `Bibliothek/aktionen/wochenplan.md`.
Kopiere den Block unten in so eine Datei und passe ihn an – er erscheint sofort im Reiter „Aktionen“ des Gebäudes.
Fehler (z. B. ein falscher Zeitplan) zeigt das Dorf direkt an der Aktion an. Einfacher geht es in der App:
Gebäude → Aktionen → „+ Neue Aktion“. Oder sag dem Bürgermeister, welchen Skill du willst – er legt ihn an (nur Skills mit Zeitplan bestätigst du vorher).

```markdown
---
name: Wochenplan
beschreibung: Plant meine Woche aus Kalender, Fristen und offenen Aufgaben.
# claude-code = dein Abo (Standard), api = API-Schlüssel
motor: claude-code
# klein (Routine) · mittel (Entwürfe) · gross (wirklich schwer)
stufe: mittel
# vault_lesen, vault_suchen, vault_schreiben (im eigenen Gebäude), post (Mails lesen, Entwürfe),
# moodle (Moodle-Browser), kalender (Termine), rechenraum (LaTeX/Python), web (Internet)
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, kalender]
# ja, wenn die Anhänge des Skills von außen stammen (Mails, Moodle, PDFs) – sie kommen dann in der Fremdinhalt-Hülle
fremdinhalte: ja
# optional: läuft von selbst, z. B. „täglich 06:00“, „werktags 07:00, 18:00“, „mo, mi 08:00“, „wochenende 09:30“
zeitplan: mo 07:00
# optional: der Zeitplan läuft für JEDEN Wert einer Auswahl-Eingabe einmal, z. B. „zeitplan_je: fach“ mit
# einer Eingabe fach (typ: auswahl, quelle: uni.faecher) → montags ein Lauf je Fach
# optional: Ergebnis-Datei im eigenen Gebäude, wird bei jedem Lauf ersetzt (alte Fassung → archiv/)
ablage: Bibliothek/00_Wochenplan.md
# optional: Eingaben im Formular; bei zeitplan brauchen Pflicht-Eingaben einen standard
eingaben:
  - name: schwerpunkt
    beschriftung: Worauf soll ich achten?
    typ: langtext
    pflicht: nein
---
Plane meine Woche. Lies dazu meine Termine (kalender_lesen, 7 Tage) …
Schwerpunkt: {schwerpunkt}
```
