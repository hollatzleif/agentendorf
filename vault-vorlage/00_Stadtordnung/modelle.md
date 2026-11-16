---
titel: Modell-Zuordnung
# Jede Aktion nennt nur die Stufe (klein, mittel, gross). Hier steht, welches Modell dahinter steckt.
# Änderbar hier in Obsidian oder in der App unter Rathaus → Einstellungen (ab Etappe 2a).
stufen:
  klein:
    modell: claude-sonnet-5-5
    aufwand: medium
  mittel:
    modell: claude-opus-5-5
    aufwand: high
  gross:
    modell: claude-fable-5-2
    aufwand: high
# Preise in US-Dollar pro 1 Million Token (nur für die Kostenschätzung beim api-Motor)
preise:
  claude-sonnet-5-5: { eingabe: 2, ausgabe: 10 }
  claude-opus-5-5: { eingabe: 4, ausgabe: 20 }
  claude-fable-5-2: { eingabe: 8, ausgabe: 40 }
  claude-haiku-5-5: { eingabe: 0.1, ausgabe: 0.5 }
---

# Modell-Zuordnung

| Stufe | Modell | Wofür |
|---|---|---|
| klein | Claude Sonnet 5.5 | Einordnen, Zusammenfassen, Routine |
| mittel | Claude Opus 5.5 | Entwürfe, Planung, Morgenzeitung |
| groß | Claude Fable 5.2 | schwere Aufgaben, Abgaben, lange Analysen |

Modell-IDs stammen aus der offiziellen Anthropic-Dokumentation (Stand 16.11.2026).
