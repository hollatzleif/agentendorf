---
name: Hafen
symbol: "⚓"
status: offen
reihenfolge: 13
beschreibung: "Krypto-Bots für Pump.fun – Strategien im Paper Trading testen, vergleichen und erst dann scharf schalten"
---

# Hafen – Arbeitsanweisung

Im Hafen testet Leif Trading-Bots für neue Memecoins auf Solana (Pump.fun). Neue Bots laufen immer im **Paper Trading**:
echte Live-Daten, aber simulierte Trades – mit Gebühren (Pump.fun, PumpPortal, Netz), Slippage, Verzögerung und
fehlgeschlagenen Transaktionen. Scharf (mit echtem Geld aus einem eigenen Bot-Wallet) schaltet **nur Leif**, mit Passwort.
Die Anleitung für Leif steht in `Hafen/00_Anleitung.html`.

## Wie es läuft
- Die Bots leben im Kryptowerk (eigener Container). Sie hören auf neue Tokens (PumpPortal), holen Kurse und Volumen
  (DexScreener) und prüfen auf Betrug (RugCheck).
- Jeder Bot hat eine Strategie: Regeln (Punkte) oder ein Prompt (das LLM schlägt nur den Einstieg vor, der Code entscheidet).
  Verkauft wird immer per Code: Take Profit, Stop Loss, Trailing, maximale Haltedauer.
- Risikolimits setzt der Code durch: Einsatz je Trade, Tagesverlust, offene Positionen.
- **Not-Aus:** in der App, per Telegram `/notaus` oder `hafen_notaus` – stoppt sofort alle Bots.

## Was Agenten dürfen (hafen_*)
- Flotte und Bots lesen und auswerten (`hafen_uebersicht`, `hafen_bot_lesen`), Backtests für Regel-Bots (`hafen_backtest`).
- Den Stand des Muster-Modells lesen und ein Training anstoßen (`hafen_muster`).
- **Paper-Bots** anlegen, ändern, starten und pausieren – Leif bekommt dafür „Rückgängig“.
- **Eigene** Paper-Bots (von einem Agenten angelegt, „🤖 Agent“) löschen – Leifs Bots nie.
- Den Not-Aus ziehen, wenn etwas schiefläuft (Leif wird sofort benachrichtigt).
- **Nie:** scharf schalten, entschärfen, auszahlen, Wallets, Leifs Bots löschen, Not-Aus aufheben, Live-Bots ändern. Das
  gibt es als Werkzeug gar nicht – sag Leif, was du empfiehlst, und er entscheidet.

## Hafenmeister
Jeden Morgen (Aktion „Hafenmeister“) züchtet er Bots: auswerten, Erkenntnisse ins Logbuch
(`Hafen/hafenmeister-logbuch.md`), die schwächsten eigenen Bots löschen, leicht abgewandelte Nachfolger anlegen. Höchstens
6 eigene Bots, davon 2 Prompt-Bots und 1 RL-Bot. Kurzfassung in der Morgenzeitung.

## Muster-Modell und Muster-Meister
Das Kryptowerk trainiert alle 5 Stunden ein Muster-Modell auf den Echtzeit-Ticks: Steigt ein Token erst um das Ziel, bevor
es um den Stop fällt? Getestet wird zeitlich getrennt auf den neuesten, nie gesehenen Daten; Rat gibt es nur, wenn das
Modell dort klar besser als Raten ist (Test-AUC ≥ 0,55). Ein RL-Bot (Art „RL“, nur Paper) handelt danach; geht ihm das
Spielgeld aus, gibt es einen **Nachschuss** – der zählt nie als Gewinn. Der Muster-Meister (Aktion, fünfmal am Tag)
liest den Bericht, pflegt den RL-Bot und schreibt ins Logbuch (`Hafen/muster-logbuch.md`). Den Muster-Rat für andere
Bots (`regeln.musterGewicht`) schaltet nur Leif hoch.

## Regeln für Agenten
- Bewerten immer **nach Gebühren** (Gewinn, Drawdown), nicht nach Trefferquote. Kleine Stichproben (unter ~30 Trades)
  als solche benennen.
- Für Vergleiche lieber einen zweiten Bot anlegen als einen laufenden umbauen; Änderungen begründen.
- Keine Gewinnversprechen: Die meisten neuen Tokens verlieren schnell an Wert. Paper und Backtest sind keine Garantie.
