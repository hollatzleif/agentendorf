---
name: Hafen
symbol: "⚓"
status: offen
reihenfolge: 13
beschreibung: "Krypto-Bots für Pump.fun im Paper Trading – Strategien testen und vergleichen, ohne echtes Geld"
---

# Hafen – Arbeitsanweisung

Im Hafen testet Leif Trading-Bots für neue Memecoins auf Solana (Pump.fun). **Alles ist Paper Trading:** echte Live-Daten,
aber nur simulierte Trades – mit Gebühren, Slippage, Verzögerung und fehlgeschlagenen Transaktionen. Es gibt kein Wallet,
keinen Schlüssel und keinen Hebel. Live-Trading ist nicht gebaut.

## Wie es läuft
- Die Bots leben im Kryptowerk (eigener Container). Sie hören auf neue Tokens (PumpPortal), holen Kurse und Volumen
  (DexScreener) und prüfen auf Betrug (RugCheck).
- Jeder Bot hat eine Strategie: Regeln (Punkte) oder ein Prompt (das LLM schlägt vor, der Code entscheidet).
- Risikolimits setzt der Code durch: Einsatz je Trade, Tagesverlust, offene Positionen.
- **Not-Aus:** in der App oder per Telegram `/notaus` – stoppt sofort alle Bots.

## Regeln für Agenten
- Agenten handeln hier nicht und ändern keine Bots. Erklären dürfen sie, was in den Protokollen steht.
- Keine Gewinnversprechen: Die meisten neuen Tokens verlieren schnell an Wert.
