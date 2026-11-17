"""Rauchtest IM gebauten Rechenraum-Image (CI): Leifs Präambel kompiliert in beiden Fassungen, Python-Pakete da,
Seitenbild klappt, kein Internet. Läuft mit docker exec im Container, spricht den Runner über HTTP an."""
import base64
import json
import os
import sys
import urllib.request

GEHEIM = os.environ["RECHENRAUM_GEHEIMNIS"]


def post(weg, daten):
    r = urllib.request.Request(
        "http://127.0.0.1:4100" + weg, data=json.dumps(daten).encode(), method="POST",
        headers={"content-type": "application/json", "x-rechenraum-geheimnis": GEHEIM},
    )
    with urllib.request.urlopen(r, timeout=200) as a:
        return json.loads(a.read())


def befehl(cmd):
    r = post("/befehl", {"raum": "rauch", "befehl": cmd})
    print(f"$ {cmd}\n  → Exit {r['code']} ({r['sekunden']} s)")
    return r


TEX = r"""\documentclass[11pt,a4paper]{article}
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
\begin{document}
\section*{Exercise Sheet 3 -- Bayesian Networks}
\begin{enumerate}[label=(\alph*)]
\item Compute $P(H \mid SH)$ für Übung ÄÖÜ.

\begin{sol}
Wanted: $P(H \mid SH)$.
\begin{align*}
P(H \mid SH) &= \frac{P(SH \mid H)\,P(H)}{P(SH)} = \frac{0.9 \cdot 0.1}{0.9\cdot 0.1 + 0.2 \cdot 0.9} = 0.\overline{3}
\end{align*}
\expl{Okay, this is the step where most people mess up, so pay attention.}
\begin{center}
\begin{tikzpicture}[node distance=2cm]
\node[bn] (h) {H}; \node[bn, right=of h] (s) {SH}; \draw[ar] (h) -- (s);
\end{tikzpicture}
\end{center}
Answer: $P(H \mid SH) = 1/3$.
\end{sol}
\end{enumerate}
\end{document}
"""

post("/schreiben", {"raum": "rauch", "pfad": "blatt.tex", "inhalt_b64": base64.b64encode(TEX.encode()).decode()})
fehler = []
for _ in range(2):
    r = befehl("pdflatex -interaction=nonstopmode -jobname=Blatt3_Loesung blatt.tex")
    if r["code"] != 0:
        fehler.append("pdflatex (ohne Erklärungen)\n" + r["ausgabe"][-3000:])
for _ in range(2):
    r = befehl(r'pdflatex -interaction=nonstopmode -jobname=Blatt3_Loesung_mit_Erklaerung "\def\withexpl{1}\input{blatt.tex}"')
    if r["code"] != 0:
        fehler.append("pdflatex (mit Erklärungen)\n" + r["ausgabe"][-3000:])
r = befehl("grep -c '^!' Blatt3_Loesung.log Blatt3_Loesung_mit_Erklaerung.log || true")
if any(z.strip().split(":")[-1] not in ("0", "") for z in r["ausgabe"].splitlines()):
    fehler.append("Fehler im LaTeX-Log:\n" + r["ausgabe"])
r = befehl("pdftotext Blatt3_Loesung_mit_Erklaerung.pdf - | grep -c 'Explanation' ; pdftotext Blatt3_Loesung.pdf - | grep -c 'Explanation' || true")
zahlen = [z.strip() for z in r["ausgabe"].splitlines() if z.strip().isdigit()]
if zahlen != ["1", "0"]:
    fehler.append(f"\\expl wirkt nicht wie erwartet (mit/ohne Erklärungen): {zahlen}")
r = befehl("python3 -c 'import numpy, sympy, scipy, matplotlib; import matplotlib.pyplot as plt; plt.plot([1,2]); plt.savefig(\"p.png\"); print(sympy.Rational(1,3))'")
if r["code"] != 0 or "1/3" not in r["ausgabe"]:
    fehler.append("Python-Pakete:\n" + r["ausgabe"])
s = post("/seite", {"raum": "rauch", "pdf": "Blatt3_Loesung.pdf", "seite": 1})
if not base64.b64decode(s["png"]).startswith(b"\x89PNG") or s["seiten"] != 1:
    fehler.append("Seitenbild")
r = befehl("python3 -c \"import urllib.request; urllib.request.urlopen('https://example.com', timeout=5)\"")
if r["code"] == 0:
    fehler.append("Rechenraum erreicht das Internet!")

if fehler:
    print("\nFEHLGESCHLAGEN:\n" + "\n\n".join(fehler))
    sys.exit(1)
print("\nRauchtest Rechenraum bestanden.")
