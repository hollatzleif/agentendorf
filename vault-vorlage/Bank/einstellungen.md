---
titel: Einstellungen Bank
# Monatsbudget je Kategorie in Euro (Kategorien wie in der Übersicht), z. B.:
budget:
  Lebensmittel: 250
  Essen gehen: 80
  Online-Shopping: 50
  Freizeit: 60
# Eigene Regeln gehen vor (Text oder /Regex/ in Gegenseite oder Verwendungszweck), z. B.:
regeln:
  - muster: Mensa
    kategorie: Essen gehen
# Sparziele: bisher = schon gespart; muster = Überweisungen aufs Sparkonto, die ab „seit“ dazuzählen
sparziele:
  - name: Notgroschen
    ziel: 1000
    bisher: 0
    muster: Tagesgeld
    seit: 2026-11-01
# KI ordnet unbekannte Gegenseiten ein (sieht nur Gegenseite, Zweck-Anfang, Betrag)
ki_kategorien: ja
# Telegram/Morgenzeitung warnen ab 80 % und 100 % eines Budgets
warnen: ja
---

# Einstellungen Bank

Die Werte oben im Kopf (zwischen den `---`) kannst du hier in Obsidian ändern. Kategorien, die du in der App bei
einer Buchung umstellst, merkt sich das Dorf je Gegenseite – das brauchst du hier nicht einzutragen.
