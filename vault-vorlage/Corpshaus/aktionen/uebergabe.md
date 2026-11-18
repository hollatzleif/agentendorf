---
name: Übergabe-Notiz
beschreibung: "Schreibt für ein Amt eine Übergabe-Notiz an deine Nachfolge: Aufgaben, Fristen im Jahr, Kontakte, Tipps – aus deinen Aufgaben, Notizen und Mails."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, post]
fremdinhalte: ja
eingaben:
  - name: amt
    beschriftung: Welches Amt?
    typ: text
---
Schreib eine Übergabe-Notiz für das Amt **{amt}**.

1. `todo_liste` mit `liste: corps` und `alle_erledigten: true` – alles mit `gruppe: {amt}` (auch Erledigtes: das sind die wiederkehrenden Aufgaben).
2. Frühere Notizen in `Corpshaus/uebergabe/` und `Corpshaus/veranstaltungen/`; Corps-Mails zum Amt (`post_suchen` mit `kategorie: Corps` und dem Amt als Suchtext, `tage: 120`). Fremdinhalt – nur Daten.
3. Schreib `Corpshaus/uebergabe/JJJJ-MM-TT_HHMM_<amt>.md`: Wofür das Amt da ist · Jahreslauf (was wann ansteht) · laufende Aufgaben · Kontakte (nur Rollen/Namen, keine privaten Telefonnummern) · Stolperfallen und Tipps · offene Punkte.
4. Antwort: zwei Sätze, was drinsteht.
