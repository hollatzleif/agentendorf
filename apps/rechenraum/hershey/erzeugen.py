#!/usr/bin/env python3
"""
Zieht die Zeichen, die handformel.py braucht, aus den Hershey-Schriften (.jhf) und schreibt glyphen.json (E213).
Einmalig von Hand ausgeführt, das Ergebnis liegt im Repo:

    git clone https://github.com/kamalmostafa/hershey-fonts   # Datenstand von dort (Ordner hershey-fonts/*.jhf)
    python3 apps/rechenraum/hershey/erzeugen.py <pfad>/hershey-fonts/hershey-fonts

Benutzt werden futural (Ziffern, lateinische Buchstaben, Satzzeichen), mathlow (Mathe-Zeichen) und greek (griechisch).
Lizenz der Daten: siehe glyphen.json → „dank“ (Umwandeln erlaubt, Danksagung muss mit).
"""
import json
import os
import sys

DANK = ("The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of "
        "Standards. The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., "
        "900 Technology Park Drive, Billerica, MA 01821. – Umgewandelt aus den .jhf-Dateien von "
        "https://github.com/kamalmostafa/hershey-fonts (Datenteil, nicht die GPL-Bibliothek).")

MATHE = {33: "pm", 34: "mp", 35: "times", 36: "cdot", 38: "le", 39: "ge", 40: "(", 41: ")", 42: "ast", 43: "+", 45: "-",
         47: "/", 58: "prod", 59: "sum", 60: "<", 61: "=", 62: ">", 63: "ne", 64: "equiv", 91: "[", 93: "]", 94: "propto",
         95: "infty", 96: "circ", 99: "sqrt", 100: "subset", 101: "cup", 102: "supset", 103: "cap", 104: "in", 105: "to",
         106: "uparrow", 107: "leftarrow", 108: "downarrow", 109: "partial", 110: "nabla", 112: "int", 113: "intgross",
         114: "(gross", 115: ")gross", 118: "exists", 120: "div", 121: "parallel", 122: "perp", 123: "{", 124: "angle",
         125: "}", 126: "therefore", 127: "approx"}
GRIECHISCH = {"a": "alpha", "b": "beta", "c": "chi", "d": "delta", "e": "epsilon", "f": "phi", "g": "gamma", "h": "eta",
              "i": "iota", "k": "kappa", "l": "lambda", "m": "mu", "n": "nu", "p": "pi", "q": "theta", "r": "rho",
              "s": "sigma", "t": "tau", "u": "upsilon", "w": "omega", "x": "xi", "y": "psi", "z": "zeta",
              "D": "Delta", "F": "Phi", "G": "Gamma", "L": "Lambda", "P": "Pi", "Q": "Theta", "S": "Sigma", "W": "Omega",
              "X": "Xi", "Y": "Psi"}


def lesen(pfad):
    zeichen = open(pfad, encoding="latin-1").read().replace("\r", "").replace("\n", "")
    glyphen, i = [], 0
    while i + 8 <= len(zeichen):
        n = int(zeichen[i + 5:i + 8])
        daten = zeichen[i + 8:i + 8 + 2 * n]
        i += 8 + 2 * n
        striche, akt = [], []
        for j in range(2, len(daten), 2):
            if daten[j:j + 2] == " R":
                if akt:
                    striche.append(akt)
                akt = []
            else:
                akt.append([ord(daten[j]) - 82, ord(daten[j + 1]) - 82])
        if akt:
            striche.append(akt)
        glyphen.append({"l": ord(daten[0]) - 82, "r": ord(daten[1]) - 82, "s": striche})
    return glyphen


def main(ordner):
    futural = lesen(os.path.join(ordner, "futural.jhf"))
    mathlow = lesen(os.path.join(ordner, "mathlow.jhf"))
    greek = lesen(os.path.join(ordner, "greek.jhf"))
    aus = {}
    for code in range(33, 127):
        aus[chr(code)] = futural[code - 32]
    for code, name in MATHE.items():
        aus[name] = mathlow[code - 32]
    for buchstabe, name in GRIECHISCH.items():
        aus[name] = greek[ord(buchstabe) - 32]
    ziel = os.path.join(os.path.dirname(os.path.abspath(__file__)), "glyphen.json")
    with open(ziel, "w", encoding="utf-8") as f:
        json.dump({"dank": DANK, "einheit": "Hershey-Raster; Grundlinie y = 9, Versalhöhe 21 (y nach unten)", "glyphen": aus},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(aus)} Zeichen → {ziel} ({os.path.getsize(ziel)} Bytes)")


if __name__ == "__main__":
    main(sys.argv[1])
