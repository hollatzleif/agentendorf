---
name: Veranstaltung planen
beschreibung: "Plant eine Corps-Veranstaltung rückwärts vom Datum: Checkliste mit Fristen als Aufgaben, dazu ein Planungsdokument."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben]
eingaben:
  - name: veranstaltung
    beschriftung: Was? (z. B. Stiftungsfest, Kneipe, Ausflug)
    typ: text
  - name: datum
    beschriftung: Wann? (TT.MM.JJJJ)
    typ: text
  - name: hinweise
    beschriftung: Was ist schon klar? (Ort, Budget, Gäste …)
    typ: langtext
    pflicht: nein
---
Leif plant **{veranstaltung}** am **{datum}**. Hinweise: {hinweise}

1. Schau in `Corpshaus/veranstaltungen/` nach früheren Planungen (gleiche Art) und übernimm Bewährtes.
2. Schreib `Corpshaus/veranstaltungen/JJJJ-MM-TT_HHMM_<veranstaltung>.md`: Ziel, Ablauf, Rollen, Budget-Schätzung, Einkaufsliste, Checkliste mit Terminen rückwärts vom Datum (z. B. 8 Wochen: Raum/Termin fix, 4 Wochen: Einladung, 2 Wochen: Anmeldeschluss, 1 Woche: Einkauf, Tag davor: Aufbau, danach: Abrechnung/Dank).
3. Jede Checklisten-Position mit Datum als Aufgabe: `todo_anlegen` mit `liste: corps`, `gruppe: {veranstaltung}`, `faellig`; vorher `todo_liste` (`liste: corps`) prüfen – nichts doppelt.
4. Antwort: die nächsten 3 Schritte mit Datum.
