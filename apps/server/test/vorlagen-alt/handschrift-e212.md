---
name: In Handschrift schreiben
beschreibung: Schreibt deinen Text als echt wirkende, ungleichmäßige Handschrift – von ordentlich bis gekritzelt, auf Blanko, liniert oder kariert.
motor: claude-code
stufe: klein
eingaben:
  - name: text
    typ: langtext
    beschriftung: Text (Zeilenumbrüche bleiben; höchstens ~1500 Zeichen)
  - name: stil
    typ: auswahl
    beschriftung: Wie ordentlich?
    optionen: [ordentlich, normal, hastig, gekritzelt]
    standard: normal
  - name: papier
    typ: auswahl
    beschriftung: Papier
    optionen: [blanko, liniert, kariert, keins]
    standard: liniert
  - name: tinte
    typ: auswahl
    beschriftung: Stift
    optionen: [blau, schwarz, bleistift, rot, gruen]
    standard: blau
  - name: format
    typ: auswahl
    beschriftung: Datei
    optionen: [png, pdf, svg]
    standard: png
werkzeuge: [vault_lesen, rechenraum]
fremdinhalte: nein
---
Schreib diesen Text mit `handschrift_schreiben` als Handschrift:

{text}

Einstellungen: Papier „{papier}“, Tinte „{tinte}“, Format „{format}“. Stil „{stil}“ heißt unordnung: ordentlich = 0.15, normal = 0.45, hastig = 0.7, gekritzelt = 0.95 (bei ordentlich durchstreichen: false).

So gehst du vor:
1. Ein Aufruf von `handschrift_schreiben` mit dem Text genau so, wie er oben steht – nichts umformulieren, nichts ergänzen. Ist er länger als 1500 Zeichen, teile ihn an Absätzen in mehrere Aufrufe (name: teil-1, teil-2 …).
2. Wenn das Ergebnis meldet, dass Zeichen weggelassen wurden, nenne sie.
3. Antworte kurz: welche Datei(en) im Ablage-Ordner liegen. Sieht Leif einen Verschreiber, kann er die Aktion einfach noch einmal starten – jedes Mal entsteht ein anderes Schriftbild.
