---
name: Wochenbericht
beschreibung: "Jeden Sonntag: was bei deinen Werten und an den Märkten in der Woche passiert ist – kurz, mit Quellen. Keine Kauf- oder Verkaufsaufträge."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, web]
fremdinhalte: nein
zeitplan: so 18:00
ablage: Boerse/00_Wochenbericht.md
---
Schreib Leif den Börsen-Wochenbericht.

1. Lies `Boerse/depot.md` (Positionen und Watchlist) und den bisherigen Bericht `Boerse/00_Wochenbericht.md`.
2. Recherchiere im Netz für jede Position und jeden Watchlist-Wert: Kursentwicklung der Woche, wichtige Nachrichten (Quartalszahlen, Dividenden, Index-Änderungen, bei ETFs: Kosten, Fondsgröße, Besonderheiten). Dazu in drei Sätzen: wie liefen DAX, S&P 500, MSCI World, Euro/Dollar.
3. Schreib den Bericht als Markdown an den Entwurfspfad aus „Ablage“ unten: kurze Zusammenfassung oben · Tabelle Wert | Woche % | Was war los | Quelle · Termine der nächsten Woche (Zahlen, Hauptversammlungen, Ex-Dividende) · „Zum Nachdenken“: höchstens zwei sachliche Punkte (z. B. Klumpenrisiko, Kosten), **keine Kauf- oder Verkaufsempfehlung**.
4. Jede Zahl mit Quelle und Datum. Antwort: zwei Sätze.
