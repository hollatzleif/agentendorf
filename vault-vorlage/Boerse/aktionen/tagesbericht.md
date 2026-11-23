---
name: Depot-Tagesbericht
beschreibung: "Di–Sa früh: was gestern auf deinem Saxo-Konto passiert ist und womit man es sich erklären könnte – kurz, mit Quellen. Die Kurzfassung steht ganz unten in der Morgenzeitung."
motor: claude-code
stufe: mittel
werkzeuge: [vault_lesen, vault_suchen, vault_schreiben, web]
fremdinhalte: nein
zeitplan: di, mi, do, fr, sa 05:00
ablage: Boerse/00_Tagesbericht.md
---
Schreib Leif den Tagesbericht zu seinem Saxo-Depot für **gestern** (das Datum von heute steht oben; gestern = einen Tag davor).

1. `depot_bewegungen` (ohne Angaben = gestern) und `depot_lesen`. Gibt es für gestern keinen Stand, schreib das in einem Satz und hör auf.
2. Nimm dir die Bewegungen vor, die zählen: der Kontowert und die bis zu fünf Positionen mit dem größten Ausschlag in Euro, dazu jeder Kauf oder Verkauf (Stück vorher → nachher, neu, verschwunden).
3. Such im Netz, womit sich das erklären lässt – zuerst beim Wert selbst (Quartalszahlen, Ausblick, Analysten, Dividende, Übernahme, Branchennachrichten), dann beim Markt (Index des Werts, Zinsen/Notenbanken, Konjunkturdaten, Wechselkurs bei Werten in Fremdwährung). Nur Meldungen von gestern oder vom Abend davor. Hast du nichts Passendes gefunden, sag das ehrlich („keine klare Nachricht – vermutlich Marktbewegung“). Was nur eine Vermutung ist, kennzeichne als Vermutung.
4. Schreib den Bericht als Markdown an den Entwurfspfad aus „Ablage“ unten, genau in dieser Form:

```
---
tag: JJJJ-MM-TT   ← gestern
---
## Für die Zeitung
2–4 kurze Sätze, je höchstens 300 Zeichen: was war los und warum – mit der wichtigsten Quelle in Klammern (Medium, Datum).

## Im Detail
Tabelle Wert | Änderung € | % | Was war los | Quelle (Link, Datum) – nur die Positionen aus Schritt 2.
Darunter Käufe/Verkäufe, falls es welche gab.
```

Keine Kauf- oder Verkaufsempfehlung, keine Kursziele als Rat. Jede Zahl aus `depot_bewegungen`, jede Erklärung mit Quelle. Antwort an Leif: ein Satz.
