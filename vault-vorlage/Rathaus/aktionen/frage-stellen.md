---
name: Frage stellen
beschreibung: Freier Chat wie in der Claude-App – mit Zugriff auf den Vault und das Internet.
motor: claude-code
stufe: mittel
eingaben:
  - name: frage
    typ: langtext
    beschriftung: Deine Frage oder Aufgabe
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, web]
fremdinhalte: nein
---
{frage}

Beantworte das direkt und gründlich. Wenn Notizen im Vault dazu passen, lies sie vorher und nenne sie als [[Wikilink]].
Wenn es sich lohnt, das Ergebnis aufzuheben, lege es als Notiz in Rathaus/ ab und sag mir, wo.
