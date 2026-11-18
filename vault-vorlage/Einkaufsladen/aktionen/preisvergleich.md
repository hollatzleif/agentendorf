---
name: Preisvergleich
beschreibung: "Sucht im Netz Preise und Alternativen für etwas von deiner Wunschliste und schreibt eine Empfehlung – kaufen tust du selbst."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, web]
fremdinhalte: nein
eingaben:
  - name: produkt
    beschriftung: Was suchst du?
    typ: text
  - name: budget
    beschriftung: Budget (optional)
    typ: text
    pflicht: nein
---
Leif möchte kaufen: **{produkt}** (Budget: {budget}).

1. Lies `Einkaufsladen/einstellungen.md` (wo er einkauft) und `todo_liste` mit `liste: wunsch` – steht es schon auf der Wunschliste?
2. Recherchiere im Netz: aktuelle Preise bei 3–6 seriösen Händlern (Versand nach Deutschland; lokal in Konstanz, wenn sinnvoll), Testberichte, 1–2 gute Alternativen (günstiger bzw. besser). Achte auf Gebraucht/Refurbished, wenn es sich lohnt.
3. Schreib `Einkaufsladen/preisvergleiche/JJJJ-MM-TT_HHMM_<produkt>.md`: Tabelle Händler | Preis | Versand | Lieferzeit | Link, darunter Alternativen, Testurteil und **deine Empfehlung** in 2–3 Sätzen. Jede Angabe mit Quelle und Datum.
4. Wunschliste: Gibt es den Eintrag, ergänze mit `todo_bearbeiten` (`liste: wunsch`) die Notiz um „Bester Preis: … bei … (Datum) – Details: [[Dateiname]]“; sonst lege ihn mit `todo_anlegen` (`liste: wunsch`) an.
5. Bestellen, Konto anlegen oder Daten in Formulare eingeben: **nie**. Antwort: bester Preis, Händler, Empfehlung in einem Satz.
