---
name: Abgabe bearbeiten
beschreibung: "Übungsblatt → zwei Lösungs-PDFs (mit und ohne grüne Erklärungen) per LaTeX. Nur Entwürfe in entwuerfe/ – abgegeben wird nie automatisch."
motor: claude-code
stufe: gross
fremdinhalte: ja
werkzeuge: [vault_lesen, vault_suchen, rechenraum]
eingaben:
  - name: abgabe
    typ: auswahl
    quelle: uni.abgaben
    beschriftung: "Abgabe (Ordner oder PDF in aufgaben/)"
  - name: wuensche
    typ: langtext
    pflicht: nein
    beschriftung: "Zusätzliche Hinweise (optional)"
anhaenge:
  - "Uni/faecher/{abgabe}"
---
# Übungsblatt → 2 Lösungs-PDFs

Die Abgabe: `Uni/faecher/{abgabe}` (in der Werkstatt: `/vault/Uni/faecher/{abgabe}`). Das ist entweder direkt das PDF des Übungsblatts oder ein Ordner mit dem Blatt (und evtl. weiteren Dateien wie Daten oder einer `aufgabe.md`). Findest du kein Übungsblatt, sag es und hör auf.

Zusätzliche Hinweise von Leif: {wuensche}

Löse alle Aufgaben und erstelle daraus zwei PDFs mit LaTeX (pdflatex). Frag nicht nach, sondern arbeite alles komplett durch und leg am Ende beide PDFs ab.

## Die zwei PDFs

1. `<Blattname>_Loesung.pdf`: das Übungsblatt plus Lösungen
2. `<Blattname>_Loesung_mit_Erklaerung.pdf`: genau dasselbe, aber nach jedem Lösungsschritt zusätzlich eine grüne Erklärung

Beide PDFs kommen aus einer einzigen .tex-Datei. Die Erklärungen stehen im Makro `\expl{...}`, das nur in Version 2 angezeigt wird:

```
pdflatex -interaction=nonstopmode -jobname=<Blattname>_Loesung blatt.tex                                   # 2x laufen lassen
pdflatex -interaction=nonstopmode -jobname=<Blattname>_Loesung_mit_Erklaerung "\def\withexpl{1}\input{blatt.tex}"   # 2x laufen lassen
```

## Layout (genau so, nicht „schön machen“)

* A4 hochkant, schwarz auf weiß, schlichter LaTeX-Article-Stil. Keine Farben außer dem Grün der Erklärungen, keine Boxen, keine Deko.
* Die Originalaufgabenstellung 1:1: gleicher Wortlaut, gleiche Reihenfolge, gleiche Formatierung. Dazu gehören Titel und Autoren, „General Information“, Aufzählungen, Nummerierung (1., (a), (b) …), kursive Stellen, Tabellen mit Rahmen wie im Original und Abbildungen (Graphen mit TikZ nachbauen, inklusive Bildunterschrift). Nichts hinzufügen und nichts umformulieren. Auch kein Untertitel wie „Solutions“.
* Direkt unter jeder Unteraufgabe kommt ein Block `Solution.` mit den Lösungsschritten. Die Schritte sollen so aufgeschrieben sein, wie ein Student sie in der Prüfung aufschreiben würde: knapp, nachvollziehbar, jeder Rechenschritt mit Zahlen und Zwischenergebnissen und am Ende ein klarer Antwortsatz.
* Formeln und Rechnungen in LaTeX-Mathe (`\[ \]`, `align*`). Lange Rechnungen auf mehrere Zeilen umbrechen. Kein Overfull hbox: nach dem Kompilieren das Log prüfen und beheben.
* Sprache der Lösungen: wie das Übungsblatt, also in der Regel Englisch.

## Die grünen Erklärungen (nur Version 2)

* Nach jedem Lösungsschritt kommt ein `\expl{...}`, also nicht nur eine Erklärung pro Aufgabe.
* Sprache: Englisch.
* Ton: locker und umgangssprachlich, als würde dir ein Student aus einem höheren Semester das erklären. Zum Beispiel: „Okay, this is the step where most people mess up, so pay attention…“, „Don't overthink this one…“, „Quick sanity check that saves you in exams…“.
* Ausführlich und einfach: erklären, warum man den Schritt so macht, mit Intuition und Alltagsbeispielen. Fachbegriffe beim ersten Auftreten in einfachen Worten erklären.
* Wenn es passt, dazuschreiben:
   * typische Fehler („Don't just multiply …“)
   * Plausibilitäts-Checks
   * Tipps für die Prüfung bzw. für Bonuspunkte
   * bei Beweisen ein kleines Beispiel zum Vorrechnen

## Inhaltliche Regeln

* Alle Zahlen wirklich nachrechnen (mit Python im Rechenraum), bevor sie ins PDF kommen. Nichts schätzen.
* Wenn die Aufgabe eigene Werte verlangt („plausible CPTs“, „assume …“), wähle sinnvolle Werte und kennzeichne sie als Annahme („(assumed)“).
* Bei Beweisen: sauberer Aufbau (Idee → Konstruktion → Korrektheit → Schluss, ∎).

## LaTeX-Präambel (genau so verwenden)

```
\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\usepackage{lmodern}
\setlength{\parindent}{0pt}
\setlength{\parskip}{4pt}

\newif\ifexpl
\expandafter\ifx\csname withexpl\endcsname\relax \explfalse \else \expltrue \fi

\definecolor{ex}{RGB}{0,120,40}
\newcommand{\expl}[1]{\ifexpl\par{\color{ex}\small\textit{Explanation:} #1}\par\fi}
\newenvironment{sol}{\par\medskip\textbf{Solution.}\par}{\par\medskip}
\tikzset{bn/.style={circle,draw,minimum size=1cm,inner sep=0pt},
         ar/.style={-{Stealth[length=3mm]},thick}}
```

So sieht eine Unteraufgabe aus:

```
\item <Originaltext der Unteraufgabe, wörtlich>

\begin{sol}
Wanted: $P(H \mid SH)$.
<Schritt 1 als Rechnung/Argument>
\expl{<lockere, ausführliche englische Erklärung zu Schritt 1>}
<Schritt 2>
\expl{<Erklärung zu Schritt 2>}
Answer: <klarer Antwortsatz>.
\end{sol}
```

## Werkzeuge (Rechenraum: pdflatex + Python, ohne Internet)

- Das Blatt holst du mit `rechenraum_vault_kopieren` in den Arbeitsordner; lesen kannst du es mit Read (Werkstatt) oder dort mit `pdftotext -layout`.
- `.tex` und `.py` schreibst du mit `rechenraum_schreiben`, kompilierst und rechnest mit `rechenraum_befehl`.
- Seiten prüfst du mit `rechenraum_seite_ansehen` (eigene PDFs und zum Vergleich das Original).
- Fertige Dateien legst du mit `rechenraum_ablegen` ab – der Zielordner (`Uni/faecher/<Fach>/entwuerfe/…`) ist fest vorgegeben.

## Bevor du lieferst

1. Beide PDFs fehlerfrei kompilieren (je 2 Durchläufe), dann das Log auf `!` und `Overfull` prüfen.
2. Die Seiten als Bilder rendern und anschauen: Läuft etwas über den Rand? Stimmt die Aufgabenstellung mit dem Original überein?
3. Beide PDFs **und** die `blatt.tex` mit `rechenraum_ablegen` ablegen, dazu nur 2–3 Sätze: was drin ist und welche Werte angenommen wurden.

**Abgeben tust du nie** – das macht Leif selbst in Moodle.
