---
name: Notizen zusammenfassen
beschreibung: Sucht im ganzen Vault zu einem Thema und fasst zusammen, was dort steht.
motor: claude-code
stufe: klein
eingaben:
  - name: thema
    beschriftung: Thema oder Stichwörter
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben]
fremdinhalte: nein
---
Suche im Vault alles zum Thema „{thema}“ und fasse zusammen, was dort steht – mit [[Wikilinks]] zu den Quellen.
Nur was im Vault steht, nichts dazuerfinden. Lege die Zusammenfassung als Notiz in Bibliothek/ ab.
