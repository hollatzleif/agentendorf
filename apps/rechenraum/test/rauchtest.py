"""Rauchtest IM gebauten Rechenraum-Image (CI): Leifs Präambel kompiliert in beiden Fassungen, Python-Pakete da,
Seitenbild klappt, Dateien erzeugen und umwandeln (E190), kein Internet. Läuft mit docker exec im Container, spricht den Runner über HTTP an."""
import base64
import json
import os
import sys
import urllib.error
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
# E190: Dateien erzeugen (Word/Excel/PowerPoint) und fremde Dateien umwandeln (/umwandeln)
ERZEUGEN = r"""
import docx, openpyxl, pptx, odf.opendocument, xlsxwriter
d = docx.Document(); d.add_heading("Rauchtest Wort", 1); d.add_paragraph("Absatz mit Umlauten: Grüße"); d.save("r.docx")
wb = openpyxl.Workbook(); wb.active.append(["Monat", "Betrag"]); wb.active.append(["Jänner", 42]); wb.save("r.xlsx")
p = pptx.Presentation(); s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = "Rauchtest Folie"; p.save("r.pptx")
print("erzeugt")
"""
post("/schreiben", {"raum": "rauch", "pfad": "erzeugen.py", "inhalt_b64": base64.b64encode(ERZEUGEN.encode()).decode()})
r = befehl("python3 erzeugen.py && ffmpeg -v error -f lavfi -i sine=frequency=300:duration=2 -y ton.wav && "
           "printf '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"50\" height=\"50\"><rect width=\"40\" height=\"40\"/></svg>' > g.svg")
if r["code"] != 0 or "erzeugt" not in r["ausgabe"]:
    fehler.append("Dateien erzeugen (python-docx/openpyxl/python-pptx/ffmpeg):\n" + r["ausgabe"])
else:
    def umw(datei, name):
        return post("/umwandeln", {"name": name, "inhalt_b64": post("/lesen", {"raum": "rauch", "pfad": datei})["inhalt_b64"]})
    erwartet = {"r.docx": "# Rauchtest Wort", "r.xlsx": "| Jänner | 42 |", "r.pptx": "## Folie 1: Rauchtest Folie"}
    for datei, text in erwartet.items():
        e = umw(datei, datei)
        if text not in e["text"]:
            fehler.append(f"Umwandeln {datei}: {e}")
    e = umw("g.svg", "g.svg")
    if len(e["bilder"]) != 1:
        fehler.append(f"SVG → PNG: {e['hinweise']}")
    e = umw("ton.wav", "sprachnachricht.wav")
    if "## Transkript" not in e["text"]:
        fehler.append(f"Transkription (whisper-cli): {e['hinweise']}")
    e = umw("Blatt3_Loesung.pdf", "blatt.pdf")
    if "Bayesian" not in e["text"]:
        fehler.append(f"PDF → Text: {e['hinweise']}")
    print("Umwandeln geprüft: docx, xlsx, pptx, svg, wav (Transkript), pdf")
# E199: Dorfwerk – jede Art einmal im echten Image (pypdf, Ghostscript, Graphviz, segno, genanki, DuckDB + pandas)
def werkzeug(auftrag):
    e = post("/werkzeug", {"raum": "rauch", "auftrag": auftrag})
    print(f"werkzeug {auftrag.get('art')}/{auftrag.get('aktion', '')} → {'ok' if e.get('ok') else e.get('fehler')}")
    return e


post("/schreiben", {"raum": "rauch", "pfad": "umsaetze.csv", "inhalt_b64": base64.b64encode("monat;betrag\nJänner;12,5\nJänner;30\nFeber;7\n".encode()).decode()})
pruefungen = [
    ({"art": "pdf", "aktion": "zusammenfuegen", "eingaben": ["Blatt3_Loesung.pdf", "Blatt3_Loesung_mit_Erklaerung.pdf"], "name": "beide"}, ["beide.pdf"]),
    ({"art": "pdf", "aktion": "wasserzeichen", "eingaben": ["beide.pdf"], "text": "ENTWURF"}, ["beide_wasserzeichen.pdf"]),
    ({"art": "pdf", "aktion": "seiten_drehen", "eingaben": ["beide.pdf"], "seiten": "1", "grad": 90}, ["beide_gedreht.pdf"]),
    ({"art": "diagramm", "quelle": "digraph { Mathe -> Statistik }", "format": "png", "name": "kurse"}, ["kurse.png"]),
    ({"art": "qr", "inhalt": "https://www.jku.at"}, ["qr-code.png"]),
    ({"art": "anki", "fach": "Rauchtest", "karten": [{"frage": "Was ist $1+1$?", "antwort": "2"}]}, ["Rauchtest.apkg"]),
    ({"art": "daten", "eingaben": ["umsaetze.csv"], "sql": "SELECT monat, SUM(betrag) AS summe FROM umsaetze GROUP BY monat ORDER BY monat"}, []),
]
for auftrag, dateien in pruefungen:
    e = werkzeug(auftrag)
    if not e.get("ok") or e.get("dateien") != dateien:
        fehler.append(f"Dorfwerk {auftrag['art']}: {e}")
e = werkzeug({"art": "daten", "eingaben": ["umsaetze.csv"], "sql": "SELECT monat, SUM(betrag) AS summe FROM umsaetze GROUP BY monat ORDER BY monat"})
if "DuckDB" not in e.get("text", "") or "| Jänner | 42.5 |" not in e.get("text", ""):
    fehler.append(f"DuckDB (Komma als Dezimalzeichen?): {e}")
e = werkzeug({"art": "pdf", "aktion": "komprimieren", "eingaben": ["beide.pdf"]})
if not e.get("ok"):
    fehler.append(f"PDF verkleinern (Ghostscript): {e}")
r = befehl("gs --version && dot -V 2>&1 && python3 -c 'import pypdf, segno, genanki, duckdb, pandas; print(pypdf.__version__, duckdb.__version__)'")
if r["code"] != 0:
    fehler.append("Dorfwerk-Pakete fehlen:\n" + r["ausgabe"])

# E198: Bildbearbeitung (/bild) – Pillow-Schritte immer; die KI-Schritte, wenn die Modelle im Image sind (der Bau lädt sie
# mit Prüfsumme; war eine Quelle nicht erreichbar, fehlen sie – dann hier nur eine Warnung, kein Fehlschlag)
BILD = r"""
from PIL import Image, ImageDraw
b = Image.new("RGB", (400, 300), (245, 245, 240)); z = ImageDraw.Draw(b)
z.ellipse((130, 60, 270, 240), fill=(190, 40, 30)); z.ellipse((170, 100, 230, 160), fill=(250, 220, 60)); b.save("motiv.png")
print("gemalt")
"""
post("/schreiben", {"raum": "rauch", "pfad": "bild.py", "inhalt_b64": base64.b64encode(BILD.encode()).decode()})
r = befehl("python3 bild.py")
if "gemalt" not in r["ausgabe"]:
    fehler.append("Testbild malen (Pillow):\n" + r["ausgabe"])
else:
    motiv = post("/lesen", {"raum": "rauch", "pfad": "motiv.png"})["inhalt_b64"]
    kann = post("/bild/kann", {})
    print("Bildbearbeitung kann:", kann)

    def bild(schritte, fmt="png"):
        try:
            return post("/bild", {"name": "motiv.png", "inhalt_b64": motiv, "schritte": schritte, "format": fmt})
        except urllib.error.HTTPError as e:
            return {"fehler": e.read().decode("utf-8", "replace")}
    e = bild([{"art": "zuschneiden", "x": 100, "y": 50, "breite": 200, "hoehe": 200}, {"art": "drehen", "grad": 90}, {"art": "groesse", "breite": 100}], "webp")
    if (e.get("breite"), e.get("hoehe"), e.get("mime")) != (100, 100, "image/webp"):
        fehler.append(f"/bild zuschneiden/drehen/groesse/webp: {str(e)[:300]}")
    if kann.get("hintergrund_entfernen"):
        e = bild([{"art": "hintergrund_entfernen"}])
        if not e.get("transparenz"):
            fehler.append(f"/bild hintergrund_entfernen: {str(e)[:300]}")
    else:
        print("WARNUNG: Hintergrund entfernen fehlt in diesem Image (onnxruntime oder u2netp nicht da).")
    if kann.get("hochskalieren"):
        e = bild([{"art": "groesse", "breite": 200}, {"art": "hochskalieren", "faktor": 4}])
        if (e.get("breite"), e.get("hoehe")) != (800, 600):
            fehler.append(f"/bild hochskalieren: {str(e)[:300]}")
    else:
        print("WARNUNG: Hochskalieren fehlt in diesem Image (onnxruntime oder Real-ESRGAN nicht da).")
    if not kann.get("heic"):
        fehler.append("/bild: heif-convert fehlt (HEIC öffnen im Atelier)")
    print("Bildbearbeitung geprüft.")
r = befehl("tesseract --list-langs 2>&1 | grep -c -E '^(deu|eng)$'")
if r["ausgabe"].strip() != "2":
    fehler.append("tesseract ohne deu/eng: " + r["ausgabe"])

r = befehl("python3 -c \"import urllib.request; urllib.request.urlopen('https://example.com', timeout=5)\"")
if r["code"] == 0:
    fehler.append("Rechenraum erreicht das Internet!")

if fehler:
    print("\nFEHLGESCHLAGEN:\n" + "\n\n".join(fehler))
    sys.exit(1)
print("\nRauchtest Rechenraum bestanden.")
