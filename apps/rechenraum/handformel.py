#!/usr/bin/env python3
"""
Handformel (E213): Formeln, Rechenwege und Tabellen „von Hand“ – für handschrift.py.

Das Handschrift-Modell (Graves) kennt kein „=“, keine Hochzahlen, Brüche oder Wurzeln und verkrüppelt kurze Zeichenfolgen
(„x = 5“ → „T - J“). Formeln setzt darum dieses Modul selbst: ein kleiner Formelsatz (Kästchen mit Breite, Höhe über und
Tiefe unter der Grundlinie) wie TeX ihn kennt, gezeichnet mit Einstrich-Zeichen aus den Hershey-Schriften
(hershey/glyphen.json, Danksagung dort). Jedes Zeichen bekommt eigene Größe, Neigung und Lage, jeder Strich ein leichtes
Zittern, Linien (Bruchstrich, Wurzel, Tabellengitter) sind nie lineal-gerade und stehen an den Enden etwas über.

Eingabe: LaTeX-Teilmenge ($…$) – \\frac \\sqrt[n] ^ _ \\left( \\right) \\sum \\prod \\int \\lim \\text, Funktionen (\\sin …),
griechische Buchstaben, Relationen und Pfeile – und einfache Schreibweise ohne $: x^2, x^(n+1), sqrt(…), *, <=, >=, !=, ->,
=>, ≤ ≥ ≠ · × ÷ ± → ⇒ ∞ π √ ² ³ ∫ ∑ ∂ ∈ °. Was unbekannt ist, wird gemeldet, nicht geraten.
"""
import json
import math
import os
import re

import numpy as np

_GLYPHEN = None


def glyphen():
    global _GLYPHEN
    if _GLYPHEN is None:
        pfad = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hershey", "glyphen.json")
        with open(pfad, encoding="utf-8") as f:
            _GLYPHEN = json.load(f)["glyphen"]
    return _GLYPHEN


GRIECHISCH = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu",
              "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda",
              "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega"]
SYMBOLE = {"cdot": "cdot", "times": "times", "div": "div", "pm": "pm", "mp": "mp", "le": "le", "leq": "le", "ge": "ge",
           "geq": "ge", "ne": "ne", "neq": "ne", "sim": "approx", "equiv": "equiv", "to": "to",
           "rightarrow": "to", "leftarrow": "leftarrow", "uparrow": "uparrow", "downarrow": "downarrow", "infty": "infty",
           "partial": "partial", "nabla": "nabla", "in": "in", "subset": "subset", "supset": "supset", "cup": "cup",
           "cap": "cap", "exists": "exists", "propto": "propto", "perp": "perp", "parallel": "parallel", "angle": "angle",
           "circ": "circ", "degree": "circ", "therefore": "therefore", "ast": "ast", "varepsilon": "epsilon",
           "varphi": "phi", "vartheta": "theta"}
SYMBOLE.update({g: g for g in GRIECHISCH})
GEZEICHNET = {"approx", "Rightarrow", "Leftrightarrow", "implies", "iff", "leftrightarrow", "forall", "emptyset", "varnothing", "mapsto",
              "cdots", "ldots", "dots", "neg", "lnot"}
FUNKTIONEN = {"sin", "cos", "tan", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "lg", "exp",
              "max", "min", "sup", "inf", "det", "dim", "ker", "arg", "deg", "gcd", "mod", "ggT", "kgV"}
GROSSE = {"sum": "sum", "prod": "prod", "int": "int", "iint": "int", "oint": "int", "lim": None, "bigcup": "cup",
          "bigcap": "cap"}
ABSTAENDE = {",": 0.17, ":": 0.22, ";": 0.28, " ": 0.3, "quad": 1.0, "qquad": 2.0, "!": -0.1, "enspace": 0.5}
RELATIONEN = {"=", "<", ">", "le", "ge", "ne", "approx", "equiv", "to", "leftarrow", "in", "subset", "supset", "propto",
              "Rightarrow", "Leftrightarrow", "implies", "iff", "leftrightarrow", "mapsto", "perp", "parallel"}
BINAER = {"+", "-", "cdot", "times", "div", "pm", "mp", "cup", "cap", "ast", "/"}
OEFFNEND = {"(", "[", "{"}

UNICODE = {"≤": r"\le ", "≥": r"\ge ", "≠": r"\ne ", "≈": r"\approx ", "·": r"\cdot ", "×": r"\times ", "÷": r"\div ",
           "±": r"\pm ", "∓": r"\mp ", "→": r"\to ", "⇒": r"\Rightarrow ", "⇔": r"\Leftrightarrow ", "↔": r"\leftrightarrow ",
           "←": r"\leftarrow ", "∞": r"\infty ", "√": r"\sqrt", "∫": r"\int ", "∑": r"\sum ", "∏": r"\prod ",
           "∂": r"\partial ", "∇": r"\nabla ", "∈": r"\in ", "⊂": r"\subset ", "∪": r"\cup ", "∩": r"\cap ", "∀": r"\forall ",
           "∃": r"\exists ", "∅": r"\emptyset ", "°": r"^\circ ", "²": "^2", "³": "^3", "¹": "^1", "⁻": "^-", "−": "-",
           "–": "-", "∗": "*", "≡": r"\equiv ", "∝": r"\propto ", "∠": r"\angle ", "⊥": r"\perp ", "∥": r"\parallel ",
           "…": r"\dots ", "¬": r"\neg ", "Δ": r"\Delta ", "∆": r"\Delta ", "∴": r"\therefore "}
_GR_UNI = "αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ"
_GR_NAMEN = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
             "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi",
             "Pi", "Sigma", "Phi", "Psi", "Omega"]
UNICODE.update({c: f"\\{n} " for c, n in zip(_GR_UNI, _GR_NAMEN)})
UNICODE["ς"] = r"\sigma "


class FormelFehler(Exception):
    pass


# ---- Einfache Schreibweise → LaTeX-Teilmenge ------------------------------------------------------------------------

def _klammer_ende(s, i):
    """Index der schließenden Klammer zu s[i] == '(' (oder -1)."""
    tiefe = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            tiefe += 1
        elif s[j] == ")":
            tiefe -= 1
            if tiefe == 0:
                return j
    return -1


def vereinfacht_zu_latex(s):
    for k, v in UNICODE.items():
        s = s.replace(k, v)
    for k, v in (("<=>", r"\Leftrightarrow "), ("<=", r"\le "), (">=", r"\ge "), ("!=", r"\ne "), ("=>", r"\Rightarrow "),
                 ("->", r"\to "), ("~=", r"\approx "), ("+-", r"\pm ")):
        s = s.replace(k, v)
    s = re.sub(r"(?<![\\a-zA-Z])\*", r"\\cdot ", s)
    # Leerzeichen, die etwas bedeuten, bleiben: „0, 12“ (Aufzählung, keine Dezimalzahl), „12,5 kg“, „f(x) dx“
    s = re.sub(r"(?<=[0-9A-Za-z)\],])[ \t]+(?=[0-9A-Za-z(\\])(?!\\(?:le|ge|ne|to|cdot|times|div|pm|Rightarrow|Leftrightarrow|approx|q?quad|umform)\b)", r"\\, ", s)
    # „… = 20 | -5“: Umformungsstrich mit Luft davor (|x| bleibt Betrag)
    s = re.sub(r"\s+\|\s+(?=[-+:*/·\\a-zA-Z0-9(])", r" \\quad\\umform ", s)
    # sqrt(…) → \sqrt{…}, ^(…) → ^{…}, _(…) → _{…}
    aus, i = [], 0
    while i < len(s):
        if s.startswith("sqrt(", i) and (i == 0 or not s[i - 1].isalpha()):
            j = _klammer_ende(s, i + 4)
            if j > 0:
                aus.append(r"\sqrt{" + vereinfacht_zu_latex(s[i + 5:j]) + "}")
                i = j + 1
                continue
        if s[i] in "^_" and i + 1 < len(s) and s[i + 1] == "(":
            j = _klammer_ende(s, i + 1)
            if j > 0:
                aus.append(s[i] + "{" + vereinfacht_zu_latex(s[i + 2:j]) + "}")
                i = j + 1
                continue
        aus.append(s[i])
        i += 1
    return "".join(aus)


# ---- Parser (LaTeX-Teilmenge) → Knoten -----------------------------------------------------------------------------

def _zerlegen(s):
    t, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            m = re.match(r"\\([A-Za-z]+)|\\(.)", s[i:])
            if not m:
                break
            t.append("\\" + (m.group(1) or m.group(2)))
            i += len(m.group(0))
            if m.group(1):          # Leerzeichen nach einem Befehl gehören zum Befehl
                while i < len(s) and s[i] == " ":
                    i += 1
            continue
        if c in " \t":
            i += 1
            continue
        t.append(c)
        i += 1
    return t


class _Parser:
    def __init__(self, s):
        self.t = _zerlegen(s)
        self.i = 0
        self.unbekannt = set()

    def _weiter(self):
        tok = self.t[self.i] if self.i < len(self.t) else None
        self.i += 1
        return tok

    def _rohgruppe(self):
        """{…} als Rohtext (für \\text)"""
        if self.i < len(self.t) and self.t[self.i] == "{":
            self.i += 1
            tiefe, teile = 1, []
            while self.i < len(self.t):
                tok = self._weiter()
                if tok == "{":
                    tiefe += 1
                elif tok == "}":
                    tiefe -= 1
                    if tiefe == 0:
                        break
                teile.append(tok.lstrip("\\") if tok.startswith("\\") and len(tok) == 2 else tok)
            return "".join(teile)
        tok = self._weiter()
        return tok or ""

    def atom(self):
        tok = self._weiter()
        if tok is None:
            return ("gruppe", [])
        if tok == "{":
            return ("gruppe", self.liste("}"))
        if tok.startswith("\\"):
            return self.befehl(tok[1:])
        return ("zeichen", tok)

    def befehl(self, name):
        if name in ("frac", "dfrac", "tfrac"):
            return ("bruch", self.atom(), self.atom())
        if name == "sqrt":
            index = None
            if self.i < len(self.t) and self.t[self.i] == "[":
                self.i += 1
                index = ("gruppe", self.liste("]"))
            return ("wurzel", self.atom(), index)
        if name in ("text", "mathrm", "textrm", "operatorname", "textbf", "mathbf", "mathit", "textit", "mbox"):
            return ("text", self._rohgruppe())
        if name in ("mathbb", "mathcal", "mathfrak", "boldsymbol", "vec", "overline", "bar", "hat", "dot"):
            inhalt = self.atom()
            return ("akzent", name, inhalt)
        if name == "left":
            links = self._weiter() or "."
            inhalt = self.liste("\\right")
            rechts = self._weiter() or "."
            return ("klammern", links.lstrip("\\"), inhalt, rechts.lstrip("\\"))
        if name in GROSSE:
            return ("gross", name)
        if name in FUNKTIONEN:
            return ("funktion", name)
        if name in SYMBOLE:
            return ("symbol", SYMBOLE[name])
        if name in GEZEICHNET:
            return ("gezeichnet", name)
        if name in ABSTAENDE:
            return ("abstand", ABSTAENDE[name])
        if name == "umform":
            return ("umform",)
        if name in ("{", "}", "%", "$", "#", "&", "_", "|"):
            return ("zeichen", name)
        if name in ("\\", "displaystyle", "limits", "nolimits", "mathrm{}", "right", "big", "Big", "bigg", "Bigg"):
            return ("abstand", 0)
        self.unbekannt.add("\\" + name)
        return ("abstand", 0)

    def liste(self, ende=None):
        knoten = []
        while self.i < len(self.t):
            tok = self.t[self.i]
            if ende and tok == ende:
                self.i += 1
                return knoten
            if tok == "}" and ende != "}":
                self.i += 1
                continue
            if tok in ("^", "_"):
                self.i += 1
                arg = self.atom()
                basis = knoten.pop() if knoten else ("gruppe", [])
                if basis[0] == "skript":
                    _, b, hoch, tief = basis
                else:
                    b, hoch, tief = basis, None, None
                if tok == "^":
                    hoch = arg
                else:
                    tief = arg
                knoten.append(("skript", b, hoch, tief))
                continue
            if tok == "&":
                self.i += 1
                knoten.append(("anker",))
                continue
            knoten.append(self.atom())
        return knoten


def parsen(s, latex=True):
    if not latex:
        s = vereinfacht_zu_latex(s)
    else:
        for k, v in UNICODE.items():
            s = s.replace(k, v)
        s = re.sub(r"\\q?quad\s*\|", r"\\quad\\umform ", s)
    p = _Parser(s)
    return ("gruppe", p.liste()), p.unbekannt


# ---- Kästchen und Hand -----------------------------------------------------------------------------------------------

class Kasten:
    """Striche (Arrays N×2, y nach unten, Grundlinie y = 0, x ab 0), Breite, Höhe über (oben > 0) und Tiefe unter der
    Grundlinie, dazu der Anker (x des ersten „=“) zum Ausrichten von Rechenwegen."""

    def __init__(self, striche=None, breite=0.0, oben=0.0, unten=0.0, anker=None, art="ord"):
        self.striche = striche or []
        self.breite, self.oben, self.unten = float(breite), float(oben), float(unten)
        self.anker = anker
        self.art = art          # ord, bin, rel, auf, zu, punkt – für die Abstände

    def verschoben(self, dx, dy):
        return Kasten([s + np.array([dx, dy]) for s in self.striche], self.breite, self.oben - dy, self.unten + dy,
                      None if self.anker is None else self.anker + dx, self.art)


def nebeneinander(kaesten):
    striche, x, oben, unten, anker = [], 0.0, 0.0, 0.0, None
    for k in kaesten:
        striche += [s + np.array([x, 0.0]) for s in k.striche]
        if anker is None and k.anker is not None:
            anker = x + k.anker
        oben, unten = max(oben, k.oben), max(unten, k.unten)
        x += k.breite
    return Kasten(striche, x, oben, unten, anker)


class Hand:
    """Zeichnet wie eine Hand: einheit = Pixel je Hershey-Einheit bei Größe 1, u = Unordnung 0..1."""

    def __init__(self, rng, u, einheit):
        self.rng = rng
        self.u = u
        self.e = einheit
        self.neigung = 0.12 + rng.normal(0, 0.04)        # leicht kursiv, wie die meisten Hände
        self.em = 21 * einheit                            # Versalhöhe
        self.unbekannt = set()

    def glyphe(self, name, g=1.0, art="ord"):
        gl = glyphen().get(name)
        if gl is None:
            self.unbekannt.add(name)
            return Kasten(breite=0.3 * self.em * g)
        rng, u = self.rng, self.u
        s = self.e * g * (1 + rng.normal(0, 0.05 * u + 0.025))
        dreh = rng.normal(0, 0.035 * u + 0.012)
        schraeg = self.neigung + rng.normal(0, 0.05 * u + 0.015)
        dy = rng.normal(0, 0.05 * u + 0.015) * self.em * g
        # Handschrift ist proportional: Breite aus dem Strich selbst (+ etwas Luft), nicht aus Hersheys festem Raster –
        # sonst steht „12“ als „1 2“ da. Zeichen ohne Strich (Leerzeichen) behalten ihre Rasterbreite.
        xs = [pt[0] for st in gl["s"] for pt in st]
        if xs and name not in ("-", "+", "=", "times", "cdot", "div", "pm", "mp", "to", "approx", "le", "ge", "ne"):
            luft = 3.5 if name not in (".", ",", ":", ";", "'", "!") else 2.5
            l, r = min(xs) - luft, max(xs) + luft
        else:
            l, r = gl["l"], gl["r"]
        striche = []
        for st in gl["s"]:
            p = np.array(st, dtype=float)
            p[:, 0] = (p[:, 0] - l) * s
            p[:, 1] = (p[:, 1] - 9) * s
            c, sn = math.cos(dreh), math.sin(dreh)
            x, y = p[:, 0].copy(), p[:, 1].copy()
            p[:, 0] = x * c - y * sn - y * schraeg
            p[:, 1] = x * sn + y * c + dy
            striche.append(p)
        breite = (r - l) * s * (1 + rng.normal(0, 0.06 * u + 0.02))
        alle = np.concatenate(striche) if striche else np.zeros((1, 2))
        return Kasten(striche, breite, max(0.0, -alle[:, 1].min()), max(0.0, alle[:, 1].max()), art=art)

    def linie(self, p0, p1, ueberstand=True):
        """Gezogene Linie: leicht gebogen, zittrig, an den Enden etwas über oder zu kurz."""
        rng, u = self.rng, self.u
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = p1 - p0
        laenge = float(np.hypot(*d)) or 1.0
        rich = d / laenge
        if ueberstand:
            p0 = p0 - rich * rng.normal(0.02, 0.03 + 0.03 * u) * self.em
            p1 = p1 + rich * rng.normal(0.04, 0.04 + 0.04 * u) * self.em
        n = max(4, int(laenge / 6))
        t = np.linspace(0, 1, n)
        normal = np.array([-rich[1], rich[0]])
        bogen = rng.normal(0, 0.006 + 0.01 * u) * laenge * np.sin(np.pi * t)
        welle = rng.normal(0, 0.25 + 0.5 * u) * np.sin(t * rng.uniform(2, 6) + rng.uniform(0, 6))
        pkt = p0[None, :] + (p1 - p0)[None, :] * t[:, None] + normal[None, :] * (bogen + welle)[:, None]
        return pkt

    def zittern(self, p):
        """Polylinie glätten (Chaikin) und mit leisem, weichem Zittern versehen – Hershey ist sonst zu technisch."""
        if len(p) >= 3:
            q = [p[0]]
            for a, b in zip(p[:-1], p[1:]):
                q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
            q.append(p[-1])
            p = np.array(q)
        if len(p) >= 2:
            rausch = self.rng.normal(0, 0.18 + 0.35 * self.u, p.shape)
            rausch = (rausch + np.roll(rausch, 1, axis=0) + np.roll(rausch, -1, axis=0)) / 3
            p = p + rausch
        return p


# ---- Satz ------------------------------------------------------------------------------------------------------------

class Satz:
    def __init__(self, hand):
        self.h = hand

    def abstand(self, art, g):
        em = self.h.em * g
        if g < 0.8:
            return {"rel": 0.15, "bin": 0.1}.get(art, 0.0) * em
        return {"rel": 0.32, "bin": 0.24, "punkt": 0.0}.get(art, 0.0) * em

    def setzen(self, knoten, g=1.0):
        art = knoten[0]
        h = self.h
        if art == "gruppe":
            return self.reihe(knoten[1], g)
        if art == "zeichen":
            c = knoten[1]
            if c in "=<>":
                return h.glyphe(c, g, "rel")
            if c in "+-":
                return h.glyphe(c, g, "bin")
            if c == "/":
                return h.glyphe("/", g, "ord")
            if c in "([{":
                return h.glyphe(c, g, "auf")
            if c in ")]}":
                return h.glyphe(c, g, "zu")
            if c in ",;.:!?":
                return h.glyphe(c, g, "punkt")
            if c == "|":
                return self.strich(g)
            if c == "'":
                k = h.glyphe("'", g)
                return k.verschoben(0, -0.15 * h.em * g)
            return h.glyphe(c, g)
        if art == "symbol":
            name = knoten[1]
            return h.glyphe(name, g, "rel" if name in RELATIONEN else "bin" if name in BINAER else "ord")
        if art == "gezeichnet":
            return self.gezeichnet(knoten[1], g)
        if art == "funktion":
            k = self.wort(knoten[1], g)
            k.breite += 0.12 * h.em * g
            return k
        if art == "text":
            return self.wort(knoten[1], g)
        if art == "abstand":
            return Kasten(breite=knoten[1] * h.em * g)
        if art == "anker":
            return Kasten(anker=0.0)
        if art == "umform":          # „| -5“: Strich, danach gilt ein Minus als Vorzeichen
            k = nebeneinander([self.strich(g), Kasten(breite=0.12 * h.em * g)])
            k.art = "auf"
            return k
        if art == "skript":
            return self.skript(knoten[1], knoten[2], knoten[3], g)
        if art == "bruch":
            return self.bruch(knoten[1], knoten[2], g)
        if art == "wurzel":
            return self.wurzel(knoten[1], knoten[2], g)
        if art == "gross":
            return self.gross(knoten[1], None, None, g)
        if art == "klammern":
            return self.klammern(knoten[1], knoten[2], knoten[3], g)
        if art == "akzent":
            return self.akzent(knoten[1], knoten[2], g)
        return Kasten()

    def reihe(self, liste, g):
        """Kästen nebeneinander mit Abständen um Rechen- und Vergleichszeichen. Anker (zum Ausrichten von Rechenwegen):
        ein „&“, sonst der Anfang des ersten Vergleichszeichens (=, ≤, ⇒ …) dieser Ebene."""
        teile, vorher, x = [], None, 0.0
        anker_und, anker_rel = None, None
        ziffer = lambda kn: kn is not None and kn[0] == "zeichen" and kn[1].isdigit()
        for i, kn in enumerate(liste):
            if kn[0] == "skript" and kn[1][0] == "gross":
                k = self.gross(kn[1][1], kn[2], kn[3], g)
            else:
                k = self.setzen(kn, g)
            if kn[0] == "anker":
                anker_und = x if anker_und is None else anker_und
                continue
            art = k.art
            if art == "bin" and (vorher is None or vorher in ("bin", "rel", "auf")):
                art = "ord"            # Vorzeichen: kein Abstand
            luft = self.abstand(art, g)
            if art in ("rel", "bin") and luft:
                if art == "rel" and anker_rel is None:
                    anker_rel = x + luft
                k = nebeneinander([Kasten(breite=luft), k, Kasten(breite=luft)])
            elif art == "punkt" and kn[0] == "zeichen" and kn[1] in ",;":
                dezimal = kn[1] == "," and i > 0 and ziffer(liste[i - 1]) and i + 1 < len(liste) and ziffer(liste[i + 1])
                if not dezimal:
                    k = nebeneinander([k, Kasten(breite=0.15 * self.h.em * g)])
            k.anker = None
            teile.append(k)
            x += k.breite
            if art != "ord" or k.striche:
                vorher = art
        erg = nebeneinander(teile)
        erg.anker = anker_und if anker_und is not None else anker_rel
        return erg

    def wort(self, text, g):
        ks = []
        em = self.h.em * g
        for c in text.replace("ß", "ss"):
            if c == " ":
                ks.append(Kasten(breite=0.35 * em))
            elif c in "äöüÄÖÜ":                   # Grundbuchstabe + zwei Punkte darüber
                k = self.h.glyphe({"ä": "a", "ö": "o", "ü": "u", "Ä": "A", "Ö": "O", "Ü": "U"}[c], g)
                y = -k.oben - 0.16 * em
                for fx in (0.33, 0.66):
                    x = k.breite * fx + self.h.rng.normal(0, 0.03 * em)
                    k.striche.append(np.array([[x, y], [x + 0.04 * em, y - 0.03 * em]]))
                k.oben += 0.2 * em
                ks.append(k)
            else:
                ks.append(self.h.glyphe(c, g))
        k = nebeneinander(ks)
        k.anker = None
        return k

    def strich(self, g):
        em = self.h.em * g
        p = self.h.linie((0.25 * em, -1.0 * em), (0.25 * em, 0.3 * em), ueberstand=False)
        return Kasten([p], 0.5 * em, 1.0 * em, 0.3 * em, art="ord")

    def skript(self, basis, hoch, tief, g):
        b = self.setzen(basis, g)
        em = self.h.em * g
        gk = max(0.5, g * 0.68)
        teile = []
        breite = 0.0
        if hoch is not None:
            k = self.setzen(hoch, gk)
            dy = -max(0.42 * em, b.oben - 0.3 * em) - k.unten * 0.5
            teile.append(k.verschoben(b.breite + 0.05 * em, dy))
            breite = max(breite, k.breite)
        if tief is not None:
            k = self.setzen(tief, gk)
            dy = max(0.22 * em, b.unten * 0.6) + k.oben * 0.6
            teile.append(k.verschoben(b.breite + 0.03 * em, dy))
            breite = max(breite, k.breite)
        striche = list(b.striche)
        oben, unten = b.oben, b.unten
        for k in teile:
            striche += k.striche
            oben, unten = max(oben, k.oben), max(unten, k.unten)
        return Kasten(striche, b.breite + breite + 0.08 * em, oben, unten, b.anker, b.art)

    def bruch(self, zaehler, nenner, g):
        em = self.h.em * g
        gk = g * 0.85 if g >= 0.95 else max(0.5, g * 0.8)
        z, n = self.setzen(zaehler, gk), self.setzen(nenner, gk)
        achse = -0.43 * em
        breite = max(z.breite, n.breite) + 0.35 * em
        luft = 0.14 * em
        zk = z.verschoben((breite - z.breite) / 2, achse - luft - z.unten)
        nk = n.verschoben((breite - n.breite) / 2, achse + luft + n.oben)
        strich = self.h.linie((0.05 * em, achse), (breite - 0.05 * em, achse))
        k = Kasten(zk.striche + nk.striche + [strich], breite + 0.15 * em, max(zk.oben, -achse + 0.05 * em), max(nk.unten, 0.0))
        return nebeneinander([Kasten(breite=0.08 * em), k])

    def wurzel(self, inhalt, index, g):
        em = self.h.em * g
        k = self.setzen(inhalt, g)
        oben = k.oben + 0.18 * em
        unten = max(k.unten, 0.05 * em)
        x0 = 0.12 * em if index is None else 0.3 * em
        h = self.h
        haken = np.array([[x0, -0.32 * em], [x0 + 0.12 * em, -0.4 * em], [x0 + 0.3 * em, unten * 0.8 + 0.02 * em],
                          [x0 + 0.55 * em, -oben]])
        haken = haken + self.h.rng.normal(0, 0.012 * em, haken.shape)
        dach = h.linie((x0 + 0.55 * em, -oben), (x0 + 0.7 * em + k.breite + 0.12 * em, -oben))
        striche = [haken, dach] + [s + np.array([x0 + 0.68 * em, 0.0]) for s in k.striche]
        breite = x0 + 0.85 * em + k.breite
        if index is not None:
            ik = self.setzen(index, max(0.5, g * 0.6))
            striche += [s + np.array([x0 + 0.1 * em - ik.breite, -0.45 * em - ik.unten]) for s in ik.striche]
        return Kasten(striche, breite, oben + 0.04 * em, unten)

    def gross(self, name, hoch, tief, g):
        em = self.h.em * g
        gk = max(0.5, g * 0.62)
        if name == "lim":
            k = self.wort("lim", g)
            if tief is not None:
                t = self.setzen(tief, gk)
                bk = max(k.breite, t.breite)
                k = Kasten(k.verschoben((bk - k.breite) / 2, 0).striche + t.verschoben((bk - t.breite) / 2, 0.3 * em + t.oben).striche,
                           bk + 0.2 * em, k.oben, 0.3 * em + t.oben + t.unten)
            return nebeneinander([k, Kasten(breite=0.12 * em)])
        glyph = GROSSE.get(name) or "sum"
        if glyph == "int":
            z = self.h.glyphe("intgross", g * 0.62)      # 78 Einheiten hoch → ≈ 2,3 em; sitzt auf der Mathe-Achse
            z.oben, z.unten = max(0.0, -min(s[:, 1].min() for s in z.striche)), max(0.0, max(s[:, 1].max() for s in z.striche))
            striche = list(z.striche)
            breite = z.breite
            if hoch is not None:
                k = self.setzen(hoch, gk).verschoben(z.breite * 0.85, -z.oben + k_oben_platz(self, hoch, gk))
                striche += k.striche
                breite = max(breite, z.breite * 0.8 + k.breite)
            if tief is not None:
                k = self.setzen(tief, gk).verschoben(z.breite * 0.55, z.unten)
                striche += k.striche
                breite = max(breite, z.breite * 0.45 + k.breite)
            return Kasten(striche, breite + 0.15 * em, z.oben + 0.3 * em, z.unten + 0.25 * em)
        z = self.h.glyphe(glyph, g * 1.15)
        z.oben = max(0.0, -min(s[:, 1].min() for s in z.striche))
        z.unten = max(0.0, max(s[:, 1].max() for s in z.striche))
        striche = list(z.striche)
        breite, oben, unten = z.breite, z.oben, z.unten
        teile = []
        if hoch is not None:
            teile.append(("o", self.setzen(hoch, gk)))
        if tief is not None:
            teile.append(("u", self.setzen(tief, gk)))
        for wo, k in teile:
            breite = max(breite, k.breite)
        for wo, k in teile:
            if wo == "o":
                kk = k.verschoben((breite - k.breite) / 2, -z.oben - 0.1 * em - k.unten)
                oben = max(oben, kk.oben)
            else:
                kk = k.verschoben((breite - k.breite) / 2, z.unten + 0.1 * em + k.oben)
                unten = max(unten, kk.unten)
            striche += kk.striche
        striche = [s + np.array([(breite - z.breite) / 2, 0]) if i < len(z.striche) else s for i, s in enumerate(striche)]
        return Kasten(striche, breite + 0.2 * em, oben, unten)

    def klammern(self, links, inhalt, rechts, g):
        em = self.h.em * g
        k = self.reihe(inhalt, g)
        hoehe = max(k.oben, 0.75 * em) + max(k.unten, 0.2 * em)
        def klammer(z):
            if z == ".":
                return Kasten(breite=0.05 * em)
            if z in ("|", "vert"):
                p = self.h.linie((0.2 * em, -max(k.oben, 0.75 * em)), (0.2 * em, max(k.unten, 0.2 * em)), ueberstand=False)
                return Kasten([p], 0.4 * em, max(k.oben, 0.75 * em), max(k.unten, 0.2 * em))
            name = {"(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}", "lbrace": "{", "rbrace": "}"}.get(z, "(")
            gl = self.h.glyphe(name, g)
            gh = 32 * self.h.e * g                      # Hershey-Klammer: 32 Einheiten hoch, Mitte auf der Achse (y = -9)
            f = max(1.0, hoehe * 1.08 / gh)
            mitte = (-max(k.oben, 0.75 * em) + max(k.unten, 0.2 * em)) / 2
            c0 = -9 * self.h.e * g
            striche = []
            for s in gl.striche:
                q = s.copy()
                q[:, 1] = (q[:, 1] - c0) * f + (mitte if f > 1.0 else c0)
                striche.append(q)
            alle = np.concatenate(striche)
            return Kasten(striche, gl.breite * (1 + 0.15 * (f - 1)), -alle[:, 1].min(), alle[:, 1].max(), art="auf")
        return nebeneinander([klammer(links), k, klammer(rechts)])

    def akzent(self, art, inhalt, g):
        em = self.h.em * g
        k = self.setzen(inhalt, g)
        if art in ("vec", "overline", "bar"):
            y = -k.oben - 0.12 * em
            p = self.h.linie((0.05 * em, y), (k.breite - 0.05 * em, y))
            striche = list(k.striche) + [p]
            if art == "vec":
                e = p[-1]
                striche.append(np.array([e + [-0.15 * em, -0.08 * em], e, e + [-0.15 * em, 0.08 * em]]))
            return Kasten(striche, k.breite, k.oben + 0.2 * em, k.unten)
        if art == "mathbb":                       # Doppelstrich-Buchstabe: ein zweiter senkrechter Strich
            p = self.h.linie((0.32 * em, -0.95 * em), (0.32 * em, 0.0), ueberstand=False)
            return Kasten(list(k.striche) + [p], k.breite, k.oben, k.unten)
        return k

    def gezeichnet(self, name, g):
        em = self.h.em * g
        h = self.h
        a = -0.43 * em
        if name in ("Rightarrow", "implies", "Leftrightarrow", "iff", "leftrightarrow"):
            doppelt = name != "leftrightarrow"
            l = 1.35 * em
            striche = []
            for dy in ((-0.09 * em, 0.09 * em) if doppelt else (0.0,)):
                striche.append(h.linie((0.1 * em, a + dy), (l - 0.05 * em, a + dy), ueberstand=False))
            striche.append(np.array([[l - 0.25 * em, a - 0.22 * em], [l + 0.02 * em, a], [l - 0.25 * em, a + 0.22 * em]]))
            if name in ("Leftrightarrow", "iff", "leftrightarrow"):
                striche.append(np.array([[0.35 * em, a - 0.22 * em], [0.08 * em, a], [0.35 * em, a + 0.22 * em]]))
            return Kasten(striche, l + 0.15 * em, 0.7 * em, 0.0, art="rel")
        if name == "approx":
            k = h.glyphe("approx", g, "rel")
            oben = [q + np.array([0.0, -0.11 * em]) for q in k.striche]
            unten = [q + np.array([0.0, 0.11 * em]) for q in k.striche]
            return Kasten(oben + unten, k.breite, k.oben + 0.11 * em, k.unten, art="rel")
        if name == "mapsto":
            k = h.glyphe("to", g, "rel")
            k.striche.append(h.linie((0.05 * em, a - 0.2 * em), (0.05 * em, a + 0.2 * em), ueberstand=False))
            return k
        if name == "forall":
            striche = [np.array([[0, -1.0 * em], [0.35 * em, 0], [0.7 * em, -1.0 * em]]),
                       h.linie((0.15 * em, -0.55 * em), (0.55 * em, -0.55 * em), ueberstand=False)]
            return Kasten(striche, 0.85 * em, 1.0 * em, 0.0)
        if name in ("emptyset", "varnothing"):
            t = np.linspace(0, 2 * np.pi, 24)
            kreis = np.stack([0.4 * em + 0.3 * em * np.cos(t), -0.45 * em + 0.38 * em * np.sin(t)], axis=1)
            return Kasten([kreis, h.linie((0.1 * em, 0.05 * em), (0.7 * em, -0.95 * em))], 0.85 * em, 1.0 * em, 0.1 * em)
        if name in ("cdots", "ldots", "dots"):
            y = a if name == "cdots" else -0.05 * em
            punkte = [np.array([[x, y], [x + 0.04 * em, y + 0.02 * em]]) for x in (0.15 * em, 0.45 * em, 0.75 * em)]
            return Kasten(punkte, 1.0 * em, 0.5 * em, 0.0)
        if name in ("neg", "lnot"):
            return Kasten([np.array([[0.05 * em, a], [0.6 * em, a], [0.6 * em, a + 0.25 * em]])], 0.75 * em, 0.5 * em, 0.0)
        return Kasten(breite=0.3 * em)


def k_oben_platz(satz, knoten, g):
    """Wie weit eine obere Integralgrenze unter die Oberkante rückt: ihre eigene Höhe."""
    return satz.setzen(knoten, g).oben


def formel(text, hand, latex=True, g=1.0):
    """Formel → Kasten (Striche bereits zittrig). Unbekanntes steht in hand.unbekannt."""
    baum, unbekannt = parsen(text, latex)
    hand.unbekannt |= unbekannt
    k = Satz(hand).setzen(baum, g)
    k.striche = [hand.zittern(s) for s in k.striche]
    return k


# ---- Text in Formeln oder Mathe? -------------------------------------------------------------------------------------

_MATHE_ZEICHEN = re.compile(r"[0-9=+*/^<>|_\\≤≥≠≈·×÷±∓→←↔⇒⇔∞√π∫∑∏∂∇∈∀∃∅²³°−]")
_FUNKTION = re.compile(r"^(sin|cos|tan|ln|log|exp|lim|max|min|sqrt|det)\b|^[a-zA-Z]{1,2}'*\(", re.I)


def ist_mathe(tok):
    if _MATHE_ZEICHEN.search(tok):
        return True
    if _FUNKTION.search(tok):
        return True
    kern = tok.strip(".,;:!?")
    return any(c in "()[]" for c in tok) and sum(ch.isalpha() for ch in kern) <= 3


def segmente(zeile):
    """Zeile → [("text", str) | ("mathe", str, latex)]: $…$ ist immer Formel; sonst wird Wort für Wort entschieden –
    Ziffern, Rechenzeichen, f(x) … sind Mathe, einzelne Buchstaben zwischen Mathe-Wörtern auch."""
    teile = []
    for i, stueck in enumerate(re.split(r"(\$\$.*?\$\$|\$[^$]+\$)", zeile)):
        if not stueck:
            continue
        if stueck.startswith("$") and stueck.endswith("$") and len(stueck) > 1:
            teile.append(("mathe", stueck.strip("$").strip(), True))
            continue
        woerter = stueck.split()
        arten = ["m" if ist_mathe(w) else "t" for w in woerter]
        for j, w in enumerate(woerter):     # einzelne Buchstaben neben Mathe gehören zur Formel („x = 5“)
            if arten[j] == "t" and len(w.strip(".,;:")) == 1 and w.strip(".,;:").isalpha():
                if (j > 0 and arten[j - 1] == "m") or (j + 1 < len(woerter) and arten[j + 1] == "m"):
                    arten[j] = "m"
        for w, a in zip(woerter, arten):
            if teile and ((a == "m" and teile[-1][0] == "mathe" and not teile[-1][2]) or (a == "t" and teile[-1][0] == "text")):
                teile[-1] = (teile[-1][0], teile[-1][1] + " " + w) + teile[-1][2:]
            elif a == "m":
                teile.append(("mathe", w, False))
            else:
                teile.append(("text", w))
    return teile


def ist_tabelle(zeile):
    z = zeile.strip()
    return z.startswith("|") and z.count("|") >= 2


def tabelle_lesen(zeilen):
    """Markdown-Tabelle → Zeilen mit Zellen; die Trennzeile (|---|) markiert die Kopfzeile."""
    reihen, kopf = [], False
    for z in zeilen:
        zellen = [c.strip() for c in z.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in zellen if c) and any(zellen):
            kopf = True
            continue
        reihen.append(zellen)
    breite = max((len(r) for r in reihen), default=0)
    return [r + [""] * (breite - len(r)) for r in reihen], kopf
