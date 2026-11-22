"""Handbewegung (E217): Striche werden nicht verbogen, sondern neu GESCHRIEBEN – wie von einer Hand.

Grundlage ist die kinematische Theorie schneller Bewegungen (Plamondon, Sigma-Lognormal-Modell): Ein Schriftzug ist
eine Folge kleiner Stiftbewegungen; jede beschleunigt und bremst mit einem lognormalen Geschwindigkeitsverlauf, und die
nächste beginnt, bevor die vorige ganz fertig ist. Daraus ergibt sich, was Handschrift menschlich aussehen lässt:

- weiche Kurven, wo die Bewegungen stark überlappen; Spitzen nur, wo der Stift umkehrt und fast stehen bleibt (n, m, k)
- Bögen schießen über oder schließen nicht ganz (o, a, d)
- kein Zeichen gleicht dem anderen: variiert werden Ziel, Dauer und Überlappung der Bewegungen – nicht das fertige Bild
- die Punkte liegen in gleichen ZEITabständen: schnelle Stellen dünn gesät, langsame dicht – daraus macht das Zeichnen
  die Strichbreite (schnell dünner, An- und Absetzen spitz), wie bei einem Stift auf dem Tablet

Dazu die eigenen Zeichen-Skelette (SKELETTE): Kleinbuchstaben in echter Schreibreihenfolge (a, d, g, q: Bogen und Stamm
in einem Zug; n, m, h, r: Stamm, zurück, Bogen), Formvarianten (t mit/ohne Haken, y gerade/rund, l mit/ohne Schwanz)
und Klammern, Komma und Pfeile, wie man sie wirklich schreibt (statt Hersheys Zierklammern).
Koordinaten wie Hershey: Grundlinie y = 9, x-Höhe y = -5, Oberlänge y = -12, Unterlänge y = 16, x um 0.
Nur NumPy.
"""
import math

import numpy as np

class Echt(np.ndarray):
    """Markiert echte Striche (Schriftprobe): die schreibt das Modell nie neu und verbindet sie nicht."""


# ---- Mathe-Helfer ------------------------------------------------------------------------------------------------------


def _erf(x):
    """Fehlerfunktion vektorisiert (Abramowitz/Stegun 7.1.26, Fehler < 1,5e-7) – ohne SciPy."""
    s = np.sign(x)
    x = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * x)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return s * y


def vereinfachen(p, eps):
    """Ramer-Douglas-Peucker: nur die Punkte behalten, die die Form tragen (Ecken, Scheitel)."""
    if len(p) <= 2:
        return p
    behalten = np.zeros(len(p), dtype=bool)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(p) - 1)]
    while stapel:
        a, b = stapel.pop()
        if b <= a + 1:
            continue
        d = p[b] - p[a]
        laenge = float(np.hypot(*d))
        zwischen = p[a + 1:b] - p[a]
        if laenge < 1e-9:
            abst = np.hypot(zwischen[:, 0], zwischen[:, 1])
        else:
            abst = np.abs(zwischen[:, 0] * d[1] - zwischen[:, 1] * d[0]) / laenge
        i = int(np.argmax(abst))
        if abst[i] > eps:
            m = a + 1 + i
            behalten[m] = True
            stapel += [(a, m), (m, b)]
    return p[behalten]


# ---- Das Bewegungsmodell -----------------------------------------------------------------------------------------------

DT = 0.01           # Abtastung in Sekunden (die Punktabstände sind das Tempo)


class Schreibart:
    """Wie DIESER Schreiber die Hand bewegt – bleibt über das ganze Dokument gleich (zusammen mit Hand.neigung …)."""

    def __init__(self, rng, u):
        self.u = u
        self.tempo = float(np.clip(rng.normal(1.0, 0.1), 0.75, 1.3))      # Dauer einer Bewegung: langsam … flott
        self.sigma = float(np.clip(rng.normal(0.30, 0.03), 0.22, 0.4))      # wie „weich“ eine Bewegung an- und ausläuft
        self.rund = float(np.clip(rng.normal(0.5, 0.06) - 0.12 * u, 0.25, 0.65))   # Überlappung: kleiner = runder
        self.ungenau = 0.022 + 0.04 * u                                       # wie genau Ziele getroffen werden (× em)


def bewegen(p, em, rng, art):
    """Einen Strich (Polylinie in Pixeln) neu schreiben: Schlüsselpunkte → überlappende Lognormal-Bewegungen.
    Liefert Punkte in gleichen Zeitabständen. Zwei-Punkt-Linien (gerade Linien wie in GoodNotes) bleiben gerade."""
    p = np.asarray(p, dtype=float)
    if len(p) <= 2:
        return p
    if float(np.max(np.ptp(p, axis=0))) < 0.14 * em:      # Punkt (., :, ·): ein Tupfer, kein Strichlein
        c = p.mean(axis=0) + rng.normal(0, 0.01 * em, 2)
        w = rng.uniform(0, 2 * np.pi)
        return np.array([c, c + rng.uniform(0.02, 0.06) * em * np.array([math.cos(w), math.sin(w)])])
    k = vereinfachen(p, 0.018 * em)
    if len(k) < 2:
        return p
    n = len(k)
    # Ziele nicht ganz genau treffen – Fehler benachbarter Ziele hängen zusammen (die Hand driftet, sie springt nicht)
    fehler = rng.normal(0, art.ungenau * em, (n, 2))
    if n >= 3:
        fehler = (fehler + np.roll(fehler, 1, axis=0) * 0.5 + np.roll(fehler, -1, axis=0) * 0.5) / 2
    fehler[0] *= 0.6
    fehler[-1] *= 0.9
    k = k + fehler
    d = np.diff(k, axis=0)
    laenge = np.hypot(d[:, 0], d[:, 1])
    m = len(d)
    if m == 0 or float(laenge.sum()) < 1e-6:
        return p
    # Dauer je Bewegung: größere Wege dauern etwas länger, aber nicht proportional (Isochronie)
    T = 0.075 * art.tempo * (laenge / em + 0.12) ** 0.35 * np.exp(rng.normal(0, 0.08, m))
    sigma = np.clip(art.sigma * np.exp(rng.normal(0, 0.08, m)), 0.18, 0.45)
    mu = np.log(T) + sigma ** 2 / 2
    # Beginn der nächsten Bewegung: an weichen Kurven früh (rund), an Umkehrpunkten erst, wenn die vorige fast steht
    t0 = np.zeros(m)
    for i in range(1, m):
        a, b = d[i - 1], d[i]
        la, lb = laenge[i - 1], laenge[i]
        winkel = math.degrees(math.acos(float(np.clip(np.dot(a, b) / (la * lb), -1, 1)))) if la > 1e-9 and lb > 1e-9 else 0.0
        if winkel > 115:                      # Umkehr (Spitze): Stift steht kurz
            q = 1.05 + rng.normal(0, 0.06)
        elif winkel > 70:                     # Ecke: kaum Überlappung
            q = art.rund + 0.35 + rng.normal(0, 0.05)
        else:                                 # Kurve: starke Überlappung
            q = art.rund + 0.25 * winkel / 70 + rng.normal(0, 0.05)
        t0[i] = t0[i - 1] + max(0.15, q) * T[i - 1]
    ende = float(np.max(t0 + np.exp(mu + 2.6 * sigma)))
    t = np.arange(DT * 0.5, ende + DT, DT)
    dt = t[:, None] - t0[None, :]
    with np.errstate(divide="ignore", invalid="ignore"):
        z = (np.log(np.where(dt > 0, dt, 1.0)) - mu[None, :]) / (sigma[None, :] * math.sqrt(2.0))
    anteil = np.where(dt > 0, 0.5 * (1.0 + _erf(z)), 0.0)
    bahn = k[0] + anteil @ d
    bahn = np.vstack([k[:1], bahn, k[-1:]])
    # ganz langsame Stellen ausdünnen (sonst Hunderte Punkte auf einem Fleck) – Tempo bleibt erkennbar
    schritt = np.hypot(*np.diff(bahn, axis=0).T)
    behalten = np.concatenate([[True], np.cumsum(schritt) > 0])
    bahn = bahn[behalten]
    if len(bahn) > 3:
        weg = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(bahn, axis=0).T))])
        marke = np.floor(weg / max(0.4, 0.012 * em))
        _, erste = np.unique(marke, return_index=True)
        erste = np.union1d(erste, [len(bahn) - 1])
        bahn = bahn[erste]
    return bahn


# ---- Zeichen-Skelette --------------------------------------------------------------------------------------------------

def _bogen(cx, cy, rx, ry, a0, a1, n=None):
    """Punkte auf einer Ellipse von Winkel a0 nach a1 (Grad; y nach unten: steigende Winkel = im Uhrzeigersinn)."""
    n = n or max(3, int(abs(a1 - a0) / 40) + 1)
    w = np.radians(np.linspace(a0, a1, n))
    return [[cx + rx * math.cos(a), cy + ry * math.sin(a)] for a in w]


def _bauch(a0=-40, a1=-330, cx=0.2, rx=5.6):
    """Der runde Bauch von a, d, g, q, c, o: gegen den Uhrzeigersinn, oben rechts beginnend."""
    return _bogen(cx, 2.0, rx, 7.0, a0, a1, 9)


SKELETTE = {
    # Kleinbuchstaben – jede Liste = Formvarianten (die erste ist die übliche), jede Variante = Striche
    "a": [
        [_bauch() + [[5.8, -5.2], [5.8, 7.6], [6.8, 9.0], [7.8, 8.2]]],
        [_bauch() + [[5.8, -5.2], [5.8, 9.0]]],
    ],
    "b": [[[[-5, -12], [-5, 9]], [[-5, 9], [-5, 3]] + _bogen(0.3, 2.0, 5.4, 7.0, 210, 520, 9)],
          [[[-5, -12], [-5, 9]] + _bogen(0.3, 2.0, 5.4, 7.0, 150, -170, 9)]],
    "c": [[_bogen(0.3, 2.0, 5.5, 7.0, -40, -298, 8)]],
    "d": [
        [_bauch() + [[5.8, -5.0], [5.8, -12.2], [5.8, 9.0]]],
        [_bauch() + [[5.8, -12.2], [5.8, 7.8], [7.0, 9.0], [8.0, 8.0]]],
    ],
    "e": [[[[-5.2, 2.4], [5.2, 1.9]] + _bogen(0.1, 2.2, 5.4, 6.9, -28, -310, 8)]],     # Querstrich, dann Spitze
    "f": [
        [[[5.0, -10.4], [3.6, -12.0], [1.2, -12.2], [-0.6, -10.6], [-0.8, -8.0], [-0.8, 9.0]], [[-4.0, -5.0], [3.4, -5.2]]],
        [[[5.0, -10.4], [3.6, -12.0], [1.2, -12.2], [-0.6, -10.6], [-0.8, -8.0], [-0.8, 12.5], [-2.0, 15.6], [-4.0, 16.2]],
         [[-4.0, -5.0], [3.4, -5.2]]],
    ],
    "g": [
        [_bauch() + [[5.8, -5.2], [5.8, 13.0], [4.2, 15.8], [1.0, 16.5], [-2.6, 15.6], [-4.6, 13.8]]],
        [_bauch() + [[5.8, -5.2], [5.8, 14.0], [3.6, 16.6], [0.4, 15.6], [2.0, 12.6], [6.4, 11.0]]],
    ],
    "h": [[[[-5, -12], [-5, 9], [-5, 1.0], [-3.4, -3.0], [-0.8, -5.0], [2.2, -5.0], [4.5, -3.0], [5.0, 0.0], [5.0, 9.0]]]],
    "i": [
        [[[0, -5], [0, 9]], [[0, -9.4], [0.4, -9.1]]],
        [[[0, -5], [0, 7.6], [1.3, 9.0], [2.8, 8.2]], [[0, -9.4], [0.4, -9.1]]],
    ],
    "j": [[[[1.0, -5], [1.0, 13.0], [-0.2, 15.6], [-2.4, 16.5], [-4.4, 15.4]], [[1.0, -9.4], [1.4, -9.1]]]],
    "k": [
        [[[-5, -12], [-5, 9]], [[4.6, -5.0], [-4.6, 2.6], [5.4, 9.0]]],
        [[[-5, -12], [-5, 9], [-5, 3.2], [3.6, -4.6], [0.0, 1.6], [-3.4, 2.4], [1.0, 3.0], [5.4, 9.0]]],
    ],
    "l": [[[[0, -12], [0, 9]]], [[[0, -12], [0, 7.4], [1.4, 9.0], [3.0, 8.2]]]],
    "m": [[[[-7.5, -5], [-7.5, 9], [-7.5, 1.0], [-6.0, -3.6], [-4.2, -5.0], [-2.2, -4.0], [-1.4, -1.0], [-1.4, 9],
            [-1.4, 1.0], [0.2, -3.6], [2.0, -5.0], [4.2, -4.0], [5.0, -1.0], [5.0, 9]]]],
    "n": [[[[-5, -5], [-5, 9], [-5, 1.0], [-3.2, -3.4], [-0.6, -5.0], [2.4, -5.0], [4.5, -3.0], [5.0, 0.0], [5.0, 9.0]]]],
    "o": [[_bogen(0.2, 2.0, 5.6, 7.0, -95, -470, 11)]],
    "p": [[[[-5, -5], [-5, 16]], [[-5, 16], [-5, 3.0]] + _bogen(0.3, 2.0, 5.4, 7.0, 200, 520, 9)],
          [[[-5, -5], [-5, 16], [-5, 4.0]] + _bogen(0.3, 2.0, 5.4, 7.0, 180, 510, 9)]],
    "q": [
        [_bauch() + [[5.8, -5.2], [5.8, 16.0]]],
        [_bauch() + [[5.8, -5.2], [5.8, 15.0], [7.0, 13.6], [8.2, 13.0]]],
    ],
    "r": [[[[-3.5, -5], [-3.5, 9], [-3.5, 1.6], [-2.2, -2.8], [-0.4, -4.7], [1.6, -5.1], [2.8, -4.6]]]],
    "s": [[[[4.6, -3.4], [3.0, -4.9], [-0.6, -5.1], [-3.6, -3.8], [-3.8, -1.0], [-1.0, 1.0], [2.4, 2.4], [4.6, 4.6],
            [4.0, 7.6], [1.0, 9.0], [-2.2, 9.0], [-5.0, 7.4]]]],
    "t": [
        [[[-0.6, -11.0], [-0.6, 7.0], [0.8, 9.0], [3.4, 8.6]], [[-4.0, -5.0], [4.0, -5.4]]],
        [[[-0.6, -11.0], [-0.6, 9.0]], [[-4.2, -4.8], [4.2, -5.2]]],
    ],
    "u": [[[[-5, -5], [-5, 5.0], [-3.6, 8.4], [-0.6, 9.0], [2.6, 8.0], [5.0, 5.0], [5.0, -5.0], [5.0, 9.0]]]],
    "v": [[[[-5.2, -5], [0, 9], [5.2, -5]]]],
    "w": [[[[-7.4, -5], [-3.8, 9], [0, -2.0], [3.8, 9], [7.4, -5]]]],
    "x": [[[[-5, -5], [5, 9]], [[5, -5], [-5, 9]]]],
    "y": [
        [[[-5, -5], [0, 9]], [[5.2, -5], [0, 9], [-3.2, 16.4]]],
        [[[-5, -5], [-5, 4.0], [-3.4, 8.0], [-0.4, 9.0], [2.8, 8.0], [5.0, 5.0], [5.0, -5.0], [5.0, 13.0], [3.4, 16.0],
          [0.2, 16.6], [-2.8, 15.6], [-4.4, 14.0]]],
    ],
    "z": [[[[-5, -5], [5, -5], [-5, 9], [5.4, 9]]]],
    # Klammern, Komma & Co. so, wie man sie schreibt (Hersheys Klammern sind Schmuck aus dem Schriftsatz)
    "{": [[[[3.0, -16.0], [0.6, -15.0], [-0.2, -12.0], [-0.2, -3.6], [-1.2, -1.0], [-3.6, 0.0], [-1.2, 1.0], [-0.2, 3.6],
            [-0.2, 12.0], [0.6, 15.0], [3.0, 16.0]]]],
    "}": [[[[-3.0, -16.0], [-0.6, -15.0], [0.2, -12.0], [0.2, -3.6], [1.2, -1.0], [3.6, 0.0], [1.2, 1.0], [0.2, 3.6],
            [0.2, 12.0], [-0.6, 15.0], [-3.0, 16.0]]]],
    "(": [[[[3.0, -16.0], [0.2, -11.0], [-1.6, -4.0], [-1.8, 3.0], [-0.4, 10.0], [3.0, 16.0]]]],
    ")": [[[[-3.0, -16.0], [-0.2, -11.0], [1.6, -4.0], [1.8, 3.0], [0.4, 10.0], [-3.0, 16.0]]]],
    "[": [[[[3.2, -16.0], [-2.0, -16.0], [-2.0, 16.0], [3.2, 16.0]]]],
    "]": [[[[-3.2, -16.0], [2.0, -16.0], [2.0, 16.0], [-3.2, 16.0]]]],
    ",": [[[[0.6, 7.2], [1.1, 8.6], [0.7, 11.0], [-1.4, 13.6]]]],
    # Hersheys Punkt und Doppelpunkt schweben ~3 Einheiten über der Grundlinie – von Hand sitzt der Punkt AUF ihr
    ".": [[[[0.0, 8.1], [0.4, 8.6]]]],
    # ≥ ≤ mit EINEM Strich darunter, wie man sie schreibt (Hersheys Zeichen sind ≧ ≦)
    "ge": [[[[-7.0, -9.0], [7.0, -3.5], [-7.0, 2.0]], [[-7.0, 6.0], [7.0, 6.0]]]],
    "le": [[[[7.0, -9.0], [-7.0, -3.5], [7.0, 2.0]], [[-7.0, 6.0], [7.0, 6.0]]]],
    ":": [[[[0.0, -1.6], [0.4, -1.1]], [[0.0, 8.1], [0.4, 8.6]]]],
    ";": [[[[0.6, -1.6], [1.0, -1.1]], [[0.6, 7.2], [1.1, 8.6], [0.7, 11.0], [-1.4, 13.6]]]],
}


def skelett(name, rng, vorliebe):
    """Eine Formvariante wählen: jeder Schreiber hat seine Lieblingsform (vorliebe[name]), nimmt aber ab und zu die
    andere – wie Menschen, die meistens „t“ mit Haken schreiben, manchmal ohne."""
    varianten = SKELETTE.get(name)
    if not varianten:
        return None
    if len(varianten) == 1:
        return varianten[0]
    lieb = vorliebe.setdefault(name, int(rng.integers(len(varianten))))
    i = lieb if rng.random() < 0.8 else int(rng.integers(len(varianten)))
    return varianten[i]


# ---- Verbinden ---------------------------------------------------------------------------------------------------------

VERBINDBAR = set("abcdefghiklmnopqrstuvwxyz")
# Verbunden wird wie in einer verbundenen Druckschrift: unten aus dem Buchstaben heraus, schräg hinauf in einen Buchstaben,
# der oben links (bzw. bei e in der Mitte) beginnt. Nicht in runde Buchstaben (a, c, d, g, o, q – der Bogen kreuzte die
# Verbindung), nicht in Oberlängen, nicht aus c/o/r/v/w (die enden oben oder offen – „ri“ würde zu „n“, „ci“ zu „a“).
VON = set("adehiklmntuz")
NACH = set("eijmnpru")      # nicht v, w, y: von unten hinein sähe „iv“ aus wie „w“


def verbinden(glyphen, em, rng, neigung):
    """Kleinbuchstaben eines Worts teilweise verbinden: Endet ein Buchstabe unten (a, d, h, i, l, m, n, t, u …) oder
    oben rechts (o, r, v, w) und beginnt der nächste nah daneben, schreibt die Hand ohne Absetzen weiter – mit der
    Wahrscheinlichkeit `neigung` (Schreiber-Profil). glyphen = [(zeichen, [Strich, …]), …] schon an ihrem Platz.
    Liefert die Striche des Worts (verbundene zusammengehängt)."""
    aus, offen = [], None          # offen = letzter Strich, an den der nächste Buchstabe anschließen könnte
    vorher = None
    for i, (z, striche) in enumerate(glyphen):
        striche = [s for s in striche]
        if not striche:
            if offen is not None:
                aus.append(offen)
                offen = None
            continue
        if offen is not None and z in NACH and vorher in VON and len(striche[0]) > 2 and not isinstance(striche[0], Echt) \
                and not isinstance(offen, Echt):
            e, s = offen[-1], striche[0][0]
            abstand = float(np.hypot(*(s - e)))
            unten = e[1] > -0.25 * em
            schraeg = s[0] - e[0] > 0.12 * em          # die Verbindung steigt schräg an, nicht senkrecht
            # keine Kette senkrechter Striche: „un“, „in“, „mu“ verbunden liest sich wie „w“/„m“ (Minimen-Problem)
            minimen = z in "mnpr" and vorher not in "eltkz"      # nach a, d, h, i, m, n, u: Stamm + Bogen verschmölzen
            if unten and schraeg and not minimen and abstand < 0.8 * em and rng.random() < neigung:
                striche[0] = np.vstack([offen, striche[0]])
                offen = None
        if offen is not None:
            aus.append(offen)
            offen = None
        # Punkte (i, j) und Querstriche (t, f) schreibt man nach dem Wort – sie verbinden nicht und bleiben offen
        haupt = [s for s in striche if len(s) > 2 and float(np.ptp(s[:, 1])) > 0.25 * em]
        if z in VERBINDBAR and haupt:
            letzter = max(haupt, key=lambda s: s[-1][0])
            rest = [s for s in striche if s is not letzter]
            aus += rest
            offen = letzter
        else:
            aus += striche
        vorher = z
    if offen is not None:
        aus.append(offen)
    return aus
