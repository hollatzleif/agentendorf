---
name: Essensplan
beschreibung: "Jeden Sonntagabend: Essensplan für die Woche (schnell, günstig, Meal-Prep, passend zu deinen Terminen) – die Zutaten landen auf der Einkaufsliste."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, kalender]
fremdinhalte: ja
zeitplan: so 17:00
ablage: Einkaufsladen/00_Essensplan.md
---
Mach Leif einen Essensplan für die kommende Woche (Montag bis Sonntag).

1. Lies `Einkaufsladen/einstellungen.md` (Vorgaben, Grundvorrat, was er nicht mag) und den bisherigen Plan `Einkaufsladen/00_Essensplan.md` (falls vorhanden) – nicht dieselben Gerichte wiederholen.
2. `kalender_lesen` (`tage: 8`): An Tagen mit langen Terminen oder abends unterwegs → Reste vom Meal-Prep oder etwas in 10 Minuten. Plane 2 Meal-Prep-Abende (z. B. Sonntag und Mittwoch), an denen für 2–3 Tage vorgekocht wird.
3. Schreib den Plan als Markdown an den Entwurfspfad aus „Ablage“ unten: Tabelle Tag | Mittag | Abend | Hinweis (z. B. „Meal-Prep: doppelte Menge“), darunter je Gericht 3–6 Zeilen Rezept (Zutaten mit Mengen für 1 Person, Schritte, Zeit).
4. **Einkaufsliste:** `todo_liste` mit `liste: einkauf` lesen. Jede fehlende Zutat (ohne Grundvorrat) mit `todo_anlegen` (`liste: einkauf`, Menge im Titel, Abteilung als `gruppe`) – zusammengefasst über die Woche, nichts doppelt.
5. Antwort: 3 Zeilen – die Gerichte der Woche und wie viele Dinge auf der Einkaufsliste gelandet sind.
