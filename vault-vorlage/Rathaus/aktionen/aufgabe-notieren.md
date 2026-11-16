---
name: Aufgabe notieren
beschreibung: Legt eine Aufgabe als Notiz auf den Schreibtisch des Bürgermeisters (ab Etappe 2b arbeitet er sie ab).
motor: claude-code
stufe: klein
eingaben:
  - name: aufgabe
    typ: langtext
    beschriftung: Was soll erledigt werden?
werkzeuge: [vault_lesen, vault_schreiben]
fremdinhalte: nein
---
Lege für diese Aufgabe eine kurze, klare Notiz in Rathaus/schreibtisch/ an (Dateiname nach Schema, Frontmatter mit titel, erstellt, quelle: Aufgabe notieren, status: offen):

{aufgabe}

Formuliere die Aufgabe so, dass ein anderer Agent sie ohne Rückfrage versteht. Erfinde nichts dazu.
