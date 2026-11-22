#!/usr/bin/env python3
"""
Handschrift (E212): Text → echt wirkende, ungleichmäßige Handschrift (SVG/PNG/PDF) – ohne Internet, nur CPU, nur NumPy.

Modell: Graves' „Handwriting Synthesis“ (arXiv 1308.0850) – drei Peephole-LSTMs mit Aufmerksamkeitsfenster und
Gaußscher Mischverteilung, die Stift-Bewegungen (dx, dy, abgesetzt) erzeugt. Gewichte aus
X-rayLaser/pytorch-handwriting-synthesis-toolkit (MIT, © 2021 Evgenii Dolotov; trainiert auf IAM-OnDB), Commit 899e943,
checkpoints/Epoch_56 – das Image lädt model.pt + meta.json mit Prüfsumme. PyTorch braucht es dafür NICHT: lade_modell()
liest das Speicherformat von torch.save (ZIP + Pickle) selbst, nur mit Standardbibliothek und NumPy, und lässt dabei
ausschließlich die drei harmlosen Rekonstruktions-Funktionen zu (kein beliebiger Code aus der Pickle-Datei).

Ungleichmäßig und „etwas gekritzelt“ wird es auf zwei Ebenen:
  1. im Modell: wenig „bias“ = freiere, unsauberere Züge (0 = ganz frei, 2 = sehr ordentlich),
  2. danach: jedes Wort bekommt eigene Größe, Neigung und Grundlinie, jede Zeile driftet und kippt leicht, die Strichstärke
     schwankt, Umlaut-Punkte sitzen schief oder werden zum Strich – und ab und zu wird ein Wort verschrieben und
     durchgestrichen, bevor es richtig dasteht.
Das Modell kennt keine Umlaute: ä/ö/ü werden als a/o/u geschrieben und die Punkte danach über genau diesen Buchstaben
gesetzt (das Aufmerksamkeitsfenster verrät, welcher Strich zu welchem Zeichen gehört); ß wird „ss“.

E213 – Mathe und Tabellen: Formeln ($…$ oder erkennbar an Ziffern/Rechenzeichen), Rechenwege und Markdown-Tabellen setzt
handformel.py (Hershey-Einstrichzeichen mit Handzittern) – das Modell schreibt nur den Fließtext dazwischen. Rechenwege
werden am „=“ (oder „&“) untereinander ausgerichtet, Zeilen mit Brüchen bekommen so viel Platz, wie sie brauchen.
"""
import io
import math
import os
import pickle
import time
import zipfile
from collections import OrderedDict

import numpy as np

import sys as _sys
if os.path.dirname(os.path.abspath(__file__)) not in _sys.path:     # handformel.py liegt daneben (Image: /app)
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handformel as hf  # noqa: E402

MODELL_ORDNER = os.environ.get("HANDSCHRIFT_MODELL", "/opt/handschrift")
MAX_TEXT = 1500             # Zeichen je Auftrag (≈ 2 Seiten; ~1 s je 50 Zeichen auf einem Kern)
MAX_SEITEN = 4
ZEIT_BUDGET = 95            # Sekunden – darunter bleibt Luft für das Zeichnen (Zeitlimit des Raums: 120 s)


class HandschriftFehler(Exception):
    pass


# ---- Modell laden (torch.save-Format ohne PyTorch) -----------------------------------------------------------------

_DTYPES = {"FloatStorage": np.float32, "DoubleStorage": np.float64, "HalfStorage": np.float16,
           "LongStorage": np.int64, "IntStorage": np.int32, "ByteStorage": np.uint8}


class _Speicher:
    def __init__(self, name):
        self.name = name


def _tensor_bauen(speicher, versatz, groesse, schritte, *_rest):
    dt = speicher.dtype
    n = speicher.size
    if versatz < 0 or versatz > n:
        raise HandschriftFehler("Modelldatei beschädigt.")
    return np.lib.stride_tricks.as_strided(speicher[versatz:], shape=tuple(groesse),
                                           strides=tuple(s * dt.itemsize for s in schritte)).copy()


class _Leser(pickle.Unpickler):
    def __init__(self, datei, zip_, praefix):
        super().__init__(datei)
        self.zip = zip_
        self.praefix = praefix

    def find_class(self, modul, name):
        if modul == "torch._utils" and name == "_rebuild_tensor_v2":
            return _tensor_bauen
        if modul == "collections" and name == "OrderedDict":
            return OrderedDict
        if modul == "torch" and name in _DTYPES:
            return _Speicher(name)
        raise HandschriftFehler(f"Modelldatei enthält Unerwartetes ({modul}.{name}).")

    def persistent_load(self, pid):
        if not (isinstance(pid, tuple) and len(pid) >= 3 and pid[0] == "storage" and isinstance(pid[1], _Speicher)):
            raise HandschriftFehler("Modelldatei: unbekannter Verweis.")
        schluessel = str(pid[2])
        if not schluessel.isalnum():
            raise HandschriftFehler("Modelldatei: ungültiger Verweis.")
        roh = self.zip.read(f"{self.praefix}/data/{schluessel}")
        return np.frombuffer(roh, dtype=_DTYPES[pid[1].name])


def lade_gewichte(pfad):
    with zipfile.ZipFile(pfad) as z:
        pkl = [n for n in z.namelist() if n.endswith("/data.pkl")]
        if len(pkl) != 1:
            raise HandschriftFehler("Modelldatei hat kein erwartetes Format.")
        praefix = pkl[0][: -len("/data.pkl")]
        zustand = _Leser(io.BytesIO(z.read(pkl[0])), z, praefix).load()
    return {k: np.ascontiguousarray(v, dtype=np.float32) for k, v in zustand.items()}


def _sig(v):
    return 1 / (1 + np.exp(-np.clip(v, -30, 30)))


class Modell:
    def __init__(self, ordner=MODELL_ORDNER):
        import json
        modell = os.path.join(ordner, "model.pt")
        meta = os.path.join(ordner, "meta.json")
        if not (os.path.isfile(modell) and os.path.isfile(meta)):
            raise HandschriftFehler("Das Handschrift-Modell fehlt in diesem Rechenraum-Image (Download beim Bau fehlgeschlagen).")
        with open(meta, encoding="utf-8") as f:
            m = json.load(f)
        self.mu = np.array(m["mu"], dtype=np.float64)
        self.sd = np.array(m["std"], dtype=np.float64)
        self.zeichen = m["charset"]
        self.index = {ch: i + 1 for i, ch in enumerate(self.zeichen)}   # 0 = unbekannt
        self.alphabet = len(self.zeichen) + 1
        g = lade_gewichte(modell)
        self.l = []
        for n in ("lstm1", "lstm2", "lstm3"):
            self.l.append(tuple(g[f"{n}.{t}"] for t in ("W_xh", "W_ci", "W_cf", "W_co", "b_i", "b_f", "b_c", "b_o")))
        self.fenster_w = np.concatenate([g["window.alpha.weight"], g["window.beta.weight"], g["window.k.weight"]]).T.copy()
        self.fenster_b = np.concatenate([g["window.alpha.bias"], g["window.beta.bias"], g["window.k.bias"]])
        self.misch_w = np.concatenate([g[f"mixture.{t}.weight"] for t in ("pi", "mu", "sd", "ro", "eos")]).T.copy()
        self.misch_b = np.concatenate([g[f"mixture.{t}.bias"] for t in ("pi", "mu", "sd", "ro", "eos")])
        self.versteckt = self.l[0][1].shape[0]
        if self.l[0][0].shape[0] != 3 + self.alphabet + self.versteckt:
            raise HandschriftFehler("Modell und Zeichensatz passen nicht zusammen.")

    @staticmethod
    def _lstm(p, x, h, c):
        w, wci, wcf, wco, bi, bf, bc, bo = p
        z = np.concatenate([x, h]) @ w
        n = h.shape[0]
        i = _sig(z[:n] + c * wci + bi)
        f = _sig(z[n:2 * n] + c * wcf + bf)
        c = f * c + i * np.tanh(z[2 * n:3 * n] + bc)
        o = _sig(z[3 * n:] + c * wco + bo)
        return o * np.tanh(c), c

    def kodieren(self, text):
        c = np.zeros((len(text), self.alphabet), dtype=np.float32)
        for i, ch in enumerate(text):
            c[i, self.index.get(ch, 0)] = 1
        return c

    def zeile(self, text, bias, rng, max_schritte=None):
        """Eine Zeile Stift-Bewegungen: Liste (dx, dy, abgesetzt, zeichen_index) in Pixel-ähnlichen Einheiten."""
        txt = text + " "                     # Wächter-Zeichen wie im Original
        c = self.kodieren(txt)
        u = len(txt)
        pos = np.arange(u, dtype=np.float32)
        n = self.versteckt
        zust = [(np.zeros(n, np.float32), np.zeros(n, np.float32)) for _ in range(3)]
        x = np.zeros(3, np.float32)
        w = np.zeros(self.alphabet, np.float32)
        k = np.zeros(10, np.float32)
        aus = []
        max_schritte = max_schritte or 40 * u + 60
        fertig = False
        for _ in range(max_schritte):
            h1, c1 = self._lstm(self.l[0], np.concatenate([x, w]), *zust[0])
            fw = h1 @ self.fenster_w + self.fenster_b
            alpha, beta = np.exp(fw[:10]), np.exp(fw[10:20])
            k = k + np.exp(fw[20:])
            phi = (alpha[:, None] * np.exp(-beta[:, None] * (k[:, None] - pos[None, :]) ** 2)).sum(0)
            w = phi @ c
            h2, c2 = self._lstm(self.l[1], np.concatenate([x, h1, w]), *zust[1])
            h3, c3 = self._lstm(self.l[2], np.concatenate([x, h2, w]), *zust[2])
            zust = [(h1, c1), (h2, c2), (h3, c3)]
            m = np.concatenate([h1, h2, h3]) @ self.misch_w + self.misch_b
            pi_roh, mu, sd_roh, ro, eos = m[:20], m[20:60], m[60:100], np.tanh(m[100:120]), 1 / (1 + math.exp(-m[120]))
            z = pi_roh * (1 + bias)
            pi = np.exp(z - z.max())
            pi /= pi.sum()
            j = rng.choice(20, p=pi)
            s1, s2 = math.exp(sd_roh[j] - bias), math.exp(sd_roh[j + 20] - bias)
            r = float(ro[j])
            e1, e2 = rng.standard_normal(2)
            dx = mu[j] + s1 * e1
            dy = mu[j + 20] + s2 * (r * e1 + math.sqrt(max(0.0, 1 - r * r)) * e2)
            ab = 1.0 if eos > 0.5 else 0.0
            ix = int(phi.argmax())
            ende = phi[u - 1] > 0.8 or (ix == u - 1 and ab)
            aus.append((dx, dy, 1.0 if ende else ab, ix))
            x = np.array([dx, dy, 1.0 if ende else ab], np.float32)
            if ende:
                fertig = True
                break
        a = np.array(aus, dtype=np.float64)
        if len(a):
            a[:, :2] = a[:, :2] * self.sd[:2] + self.mu[:2]
        return a, fertig


# ---- Text vorbereiten ---------------------------------------------------------------------------------------------

_UMLAUTE = {"ä": "a", "ö": "o", "ü": "u", "Ä": "A", "Ö": "O", "Ü": "U"}
_ERSATZ = {"ß": "ss", "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "‚": "'", "‘": "'", "’": "'", "´": "'", "`": "'",
           "–": "-", "—": "-", "‒": "-", "…": "...", "&": "+", "\t": " ", " ": " ", "é": "e", "è": "e", "á": "a",
           "à": "a", "ó": "o", "ò": "o", "ç": "c", "ñ": "n", "€": "EUR", "§": "S", "_": "-", "]": ")",
           "{": "(", "}": ")", "<": "(", ">": ")", "@": "a", "$": "S", "|": "l", "~": "-", "^": "'", "\\": "/"}


def vorbereiten(text, zeichensatz):
    """→ (modelltext, umlaut_stellen, weggelassen): Umlaute als Grundbuchstabe + Merker, Unbekanntes ersetzt oder weg."""
    aus, umlaute, weg = [], [], set()
    for ch in text:
        if ch in _UMLAUTE:
            umlaute.append(len(aus))
            aus.append(_UMLAUTE[ch])
            continue
        ersatz = _ERSATZ.get(ch, ch)
        for e in ersatz:
            if e in zeichensatz or e == " ":
                aus.append(e)
            else:
                weg.add(ch)
    return "".join(aus), umlaute, weg


def umbrechen(absaetze, breite):
    """Absätze (Liste von (text, umlaute)) → Zeilen (text, umlaute relativ zur Zeile); Wörter werden nie getrennt,
    außer sie sind länger als eine Zeile."""
    zeilen = []
    for text, umlaute in absaetze:
        if not text.strip():
            zeilen.append(("", []))
            continue
        um = set(umlaute)
        woerter, i = [], 0
        for teil in text.split(" "):
            if teil:
                woerter.append((teil, [p - i for p in range(i, i + len(teil)) if p in um]))
            i += len(teil) + 1
        akt, akt_um = "", []
        absatz_start = len(zeilen)
        for wort, wu in woerter:
            while len(wort) > breite:
                if akt:
                    zeilen.append((akt, akt_um))
                    akt, akt_um = "", []
                zeilen.append((wort[:breite], [p for p in wu if p < breite]))
                wu = [p - breite for p in wu if p >= breite]
                wort = wort[breite:]
            if not wort:
                continue
            if akt and len(akt) + 1 + len(wort) > breite:
                zeilen.append((akt, akt_um))
                akt, akt_um = "", []
            basis = len(akt) + (1 if akt else 0)
            akt = f"{akt} {wort}" if akt else wort
            akt_um += [basis + p for p in wu]
        if akt:
            # Sehr kurze Zeilen („es.“) schreibt das Modell schlecht – lieber an die vorige hängen, wenn es etwas passt
            if len(zeilen) > absatz_start and len(akt) < 8 and len(zeilen[-1][0]) + 1 + len(akt) <= breite * 1.2:
                vor, vor_um = zeilen.pop()
                akt_um = vor_um + [len(vor) + 1 + p for p in akt_um]
                akt = f"{vor} {akt}"
            zeilen.append((akt, akt_um))
    return zeilen


def _verschreiben(wort, rng):
    """Ein plausibler Schreibfehler: zwei Buchstaben vertauscht, einer doppelt oder zu früh abgebrochen."""
    if len(wort) < 3:
        return wort[:1]
    art = rng.integers(3)
    i = int(rng.integers(1, len(wort) - 1))
    if art == 0:
        return wort[:i] + wort[i + 1] + wort[i] + wort[i + 2:]
    if art == 1:
        return wort[: i + 1] + wort[i] + wort[i + 1:]
    return wort[: max(2, i)]


# ---- Striche nachbearbeiten ---------------------------------------------------------------------------------------

def striche(bew):
    """Bewegungen → Liste von Strichen (je Array N×2 absoluter Punkte + Zeichen-Index je Punkt)."""
    pkt = np.cumsum(bew[:, :2], axis=0)
    aus, start = [], 0
    for i in range(len(bew)):
        if bew[i, 2] >= 0.5:
            if i + 1 - start >= 1:
                aus.append((pkt[start:i + 1].copy(), bew[start:i + 1, 3].astype(int)))
            start = i + 1
    if start < len(bew):
        aus.append((pkt[start:].copy(), bew[start:, 3].astype(int)))
    return aus


def _wort_von_index(text):
    """Zeichen-Index → Wort-Nummer (Leerzeichen gehören zum Wort davor)."""
    nr, aus = 0, []
    for i, ch in enumerate(text):
        aus.append(nr)
        if ch == " " and i + 1 < len(text) and text[i + 1] != " ":
            nr += 1
    return aus


def bewerten(text, bew, fertig):
    """0 = gut. Strafpunkte: ausgelassene Buchstaben (das Fenster hat sie nie „angesehen“), kein Ende gefunden,
    entgleist (die Zeile ist viel höher als breit – gemessen: gesund ≈ 1,5–3,5 × Zeichenbreite, entgleist > 50×)."""
    if not len(bew):
        return 99
    besucht = set(bew[:, 3].astype(int))
    fehlt = sum(1 for i, ch in enumerate(text) if ch != " " and i not in besucht)
    p = np.cumsum(bew[:, :2], axis=0)
    zeichenbreite = max(1e-6, float(np.ptp(p[:, 0])) / max(1, len(text)))
    hoehe = float(np.percentile(p[:, 1], 95) - np.percentile(p[:, 1], 5))
    # entgleiste Schleife („mmmm“): das Fenster bleibt an einem Zeichen hängen (gesund ≈ 15–45 Punkte je Zeichen)
    je_zeichen = np.bincount(bew[:, 3].astype(int))
    haengt = int(je_zeichen[: len(text)].max()) > 85 if len(text) else False
    return fehlt * 3 + (0 if fertig else 6) + (8 if hoehe / zeichenbreite > 6 else 0) + (6 if haengt else 0)


class Schreiber:
    """Erzeugt Zeilen mit Wiederholung, bis alle Buchstaben „besucht“ wurden (sonst fehlt einer), und verzerrt sie."""

    def __init__(self, modell, unordnung, rng, frist):
        self.m = modell
        self.u = float(min(1.0, max(0.0, unordnung)))
        self.rng = rng
        self.frist = frist
        # bias: 0 = frei/wild … höher = ordentlicher. Gemessen: ab ~0,9 entgleist das Modell häufiger (Strichsalat,
        # endlose Striche). E214 (Leif): Fließtext darf „weniger schön“ sein als die Rechnung – höchstens 0,7
        # (0,6 brachte deutlich mehr Verschreiber: „in“ → „ink“)
        self.bias = 0.7 - 0.6 * self.u
        self.wiederholt = 0

    def zeile(self, text):
        bestes = None
        versuche = 4 if time.time() < self.frist else 1
        for v in range(versuche):
            bew, fertig = self.m.zeile(text, self.bias + 0.05 * v, self.rng)
            note = bewerten(text, bew, fertig)
            if bestes is None or note < bestes[0]:
                bestes = (note, bew)
            if note == 0 or time.time() > self.frist:
                break
            self.wiederholt += 1
        return bestes[1]


def _drehen(p, winkel, um):
    s, c = math.sin(winkel), math.cos(winkel)
    d = p - um
    return np.stack([d[:, 0] * c - d[:, 1] * s, d[:, 0] * s + d[:, 1] * c], axis=1) + um


def zeile_gestalten(sch, text, umlaute, durchstreichen, hoehe_ziel):
    """Eine Textzeile → Striche in Zeilen-Koordinaten (Grundlinie y = 0, x ab 0, Höhe ≈ hoehe_ziel), dazu Breite."""
    rng, u = sch.rng, sch.u
    woerter = text.split(" ")
    fehlwort = None
    if durchstreichen and len(woerter) >= 2 and rng.random() < 0.10 * u + 0.02:
        kandidaten = [i for i, w in enumerate(woerter) if len(w) >= 4 and w.isalpha()]
        if kandidaten:
            fehlwort = int(rng.choice(kandidaten))
    if fehlwort is not None:
        falsch = _verschreiben(woerter[fehlwort], rng)
        modell_woerter = woerter[:fehlwort] + [falsch] + woerter[fehlwort:]
        verschiebung = len(falsch) + 1
        start_fehl = sum(len(w) + 1 for w in woerter[:fehlwort])
        umlaute = [p if p < start_fehl else p + verschiebung for p in umlaute]
    else:
        modell_woerter = woerter
    mtext = " ".join(modell_woerter)
    bew = sch.zeile(mtext)
    st = striche(bew)
    if not st:
        return [], 0.0, []
    # Größe über die Buchstabenbreite (stabiler als die Höhe: Ober-/Unterlängen und schiefe Zeilen verzerren die)
    alle = np.concatenate([s for s, _ in st])
    zeichenbreite = max(1e-3, float(np.ptp(alle[:, 0])) / max(1, len(mtext)))
    faktor = hoehe_ziel * 0.62 / zeichenbreite * (1 + rng.normal(0, 0.05 * u))
    links = alle[:, 0].min()
    wort_nr = _wort_von_index(mtext)
    n_w = max(wort_nr) + 1 if wort_nr else 1
    teile = []
    for s, ix in st:
        p = s.copy()
        p[:, 0] = (p[:, 0] - links) * faktor
        p[:, 1] = p[:, 1] * faktor
        nr = np.array([wort_nr[min(i, len(wort_nr) - 1)] for i in ix])
        teile.append((p, ix, int(np.bincount(nr).argmax())))
    # Jedes Wort zuerst auf die Grundlinie y = 0 (das Modell lässt sie selbst wandern) – dann kontrolliert verschieben:
    # eigene Größe, Neigung und Grundlinie je Wort, dazu Drift und Welle je Zeile (je unordentlicher, desto mehr)
    grundlinie = {}
    for w in range(n_w):
        ys = [p[:, 1] for p, _, w0 in teile if w0 == w]
        if ys:
            grundlinie[w] = float(np.percentile(np.concatenate(ys), 80))
    groesse = 1 + rng.normal(0, 0.07 * u + 0.015, n_w)
    neigung = rng.normal(0, 0.10 * u + 0.01, n_w)
    grund = rng.normal(0, 0.09 * hoehe_ziel * u, n_w)
    drift = rng.normal(0, 0.012 * u) + rng.normal(0, 0.006)
    welle_a, welle_f = rng.uniform(0, 0.07 * hoehe_ziel * u), rng.uniform(0.002, 0.006)
    neu = []
    for p, ix, w0 in teile:
        p[:, 1] -= grundlinie.get(w0, 0.0)
        x0 = p[:, 0].min()
        p[:, 0] = x0 + (p[:, 0] - x0) * groesse[w0] - p[:, 1] * neigung[w0]
        p[:, 1] = p[:, 1] * groesse[w0] + grund[w0]
        p[:, 1] += p[:, 0] * drift + welle_a * np.sin(p[:, 0] * welle_f)
        neu.append((p, ix, w0))
    # Was das Modell nach dem letzten Zeichen noch schreibt (Fenster auf dem Wächter-Leerzeichen), ist kein Text – weg damit
    # – aber nur winzige Tupfer: der letzte Buchstabe oder ein Komma entsteht oft, während das Fenster schon dort steht
    neu = [(p, ix, w0) for p, ix, w0 in neu
           if not (np.mean(ix >= len(mtext)) >= 0.5 and float(np.ptp(p, axis=0).max()) < 0.18 * hoehe_ziel)] or neu
    # Umlaut-Punkte über genau den Buchstaben. Das Aufmerksamkeitsfenster hinkt dem Stift etwas nach: die Punkte eines
    # Zeichens zeigen zuverlässig WO (x), aber nicht die ganze Höhe – die kommt vom Wort (Großbuchstabe: Oberkante des
    # Buchstabens; klein: Mittellänge des Worts)
    cw = hoehe_ziel * 0.62
    extra = []
    for pos in umlaute:
        pts = []
        for nachbar in (pos, pos + 1, pos - 1):
            pts = [p[ix == nachbar] for p, ix, _ in neu if np.any(ix == nachbar)]
            if pts:
                break
        w0 = wort_nr[min(pos, len(wort_nr) - 1)]
        wort_teile = [p for p, _, w in neu if w == w0]
        if not pts and not wort_teile:
            continue
        b = np.concatenate(pts or wort_teile)
        wort_pts = np.concatenate(wort_teile or [b])
        # Lage im Wort (Buchstabe k von n) – das Fenster läuft dem Stift mal voraus, mal hinterher
        anfang = pos
        while anfang > 0 and mtext[anfang - 1] != " ":
            anfang -= 1
        ende = pos
        while ende < len(mtext) and mtext[ende] != " ":
            ende += 1
        x_l, x_r = float(wort_pts[:, 0].min()), float(wort_pts[:, 0].max())
        x_anteil = x_l + (pos - anfang + 0.5) / max(1, ende - anfang) * (x_r - x_l)
        x_mitte = 0.5 * x_anteil + 0.5 * (float(np.median(b[:, 0])) + 0.15 * cw) if pts else x_anteil
        breite = max(hoehe_ziel * 0.35, min(1.2 * cw, float(np.ptp(b[:, 0]))))
        if pos < len(mtext) and mtext[pos].isupper():
            nah = wort_pts[np.abs(wort_pts[:, 0] - x_mitte) < 0.8 * cw]
            oben = float((nah if len(nah) else b)[:, 1].min())
        else:
            oben = float(np.percentile(wort_pts[:, 1], 22))
        y = oben - hoehe_ziel * ((0.2 if pos < len(mtext) and mtext[pos].isupper() else 0.3) + rng.uniform(0, 0.15 * u))
        x_mitte += rng.normal(0, hoehe_ziel * 0.15 * u)
        if rng.random() < 0.45 * u:          # schnell geschrieben: ein kurzer Strich statt zweier Punkte
            l = breite * rng.uniform(0.35, 0.6)
            extra.append(np.array([[x_mitte - l / 2, y + rng.normal(0, 1)], [x_mitte + l / 2, y + rng.normal(0, 2)]]))
        else:
            for sx in (-1, 1):
                px = x_mitte + sx * breite * rng.uniform(0.14, 0.24)
                py = y + rng.normal(0, hoehe_ziel * 0.06 * (u + 0.2))
                d = rng.normal(0, hoehe_ziel * 0.05, 2) + np.array([hoehe_ziel * 0.04, -hoehe_ziel * 0.03])
                extra.append(np.array([[px, py], [px + d[0], py + d[1]]]))
    # Verschriebenes Wort durchkritzeln
    if fehlwort is not None:
        pts = [p for p, _, w0 in neu if w0 == fehlwort]
        if pts:
            b = np.concatenate(pts)
            x1, x2 = b[:, 0].min() - 3, b[:, 0].max() + 3
            y1, y2 = np.percentile(b[:, 1], 15), np.percentile(b[:, 1], 85)
            if rng.random() < 0.5:           # Zickzack
                n = int(rng.integers(4, 8))
                xs = np.linspace(x1, x2, n * 2)
                ys = np.where(np.arange(n * 2) % 2 == 0, y1, y2) + rng.normal(0, hoehe_ziel * 0.08, n * 2)
                extra.append(np.stack([xs, ys], axis=1))
            else:                            # ein, zwei schräge Striche
                for _ in range(int(rng.integers(1, 3))):
                    ym = (y1 + y2) / 2 + rng.normal(0, hoehe_ziel * 0.12)
                    xs = np.linspace(x1, x2, 6)
                    ys = ym + np.linspace(-1, 1, 6) * rng.normal(0, hoehe_ziel * 0.1) + rng.normal(0, 1.5, 6)
                    extra.append(np.stack([xs, ys], axis=1))
    linien = [p for p, _, _ in neu] + extra
    alle = np.concatenate(linien)
    return linien, float(alle[:, 0].max()), [fehlwort] if fehlwort is not None else []


# ---- Seite zeichnen -----------------------------------------------------------------------------------------------

TINTEN = {"blau": ("#1b2f8a", 1.0), "schwarz": ("#1d1d1f", 1.0), "bleistift": ("#4a4a4a", 0.82), "rot": ("#b3261e", 1.0),
          "gruen": ("#1f6b35", 1.0)}
SEITE_B, SEITE_H = 1240, 1754          # A4 bei 150 dpi
MM = 150 / 25.4


def umriss(p, basis):
    """Strich als gefüllter Umriss mit wechselnder Breite – wie ein echter Stift: schnelle, gerade Züge (lange Abstände
    zwischen den Punkten) dünner, Kurven und langsame Stellen dicker, Anfang und Ende laufen spitz aus. Bei Strichen aus
    der Schriftprobe sind die Punkte nach Zeit abgetastet, dort ist der Abstand wirklich das Tempo."""
    d = np.diff(p, axis=0)
    laenge = np.hypot(d[:, 0], d[:, 1])
    if len(laenge) < 3 or float(laenge.sum()) < basis * 2:
        return None
    mitte = float(np.median(laenge[laenge > 1e-6])) if np.any(laenge > 1e-6) else 1.0
    seg = np.clip(1.05 - 0.2 * np.log2(np.maximum(laenge, 1e-3) / max(mitte, 1e-6)), 0.7, 1.12)
    w = np.concatenate([[seg[0]], (seg[:-1] + seg[1:]) / 2, [seg[-1]]])
    w = np.convolve(np.pad(w, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    w[0] *= 0.55
    w[-1] *= 0.6
    if len(w) > 3:
        w[1] *= 0.85
        w[-2] *= 0.88
    w = w * basis / 2
    rich = np.gradient(p, axis=0)
    norm = np.hypot(rich[:, 0], rich[:, 1])
    norm[norm < 1e-9] = 1.0
    n = np.stack([-rich[:, 1] / norm, rich[:, 0] / norm], axis=1)
    links, rechts = p + n * w[:, None], p - n * w[:, None]
    return np.concatenate([links, rechts[::-1]])


def _pfad(p):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in p)


def _papier(art):
    teile = ['<rect width="100%" height="100%" fill="#fffdf8"/>' if art != "keins" else ""]
    if art == "liniert":
        y = 30 * MM
        while y < SEITE_H - 12 * MM:
            teile.append(f'<line x1="0" y1="{y:.1f}" x2="{SEITE_B}" y2="{y:.1f}" stroke="#9fb7d9" stroke-width="1.2"/>')
            y += 9 * MM
        teile.append(f'<line x1="{25 * MM:.1f}" y1="0" x2="{25 * MM:.1f}" y2="{SEITE_H}" stroke="#e39a9a" stroke-width="1.4"/>')
    elif art == "kariert":
        q = 5 * MM
        x = 0.0
        while x < SEITE_B:
            teile.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{SEITE_H}" stroke="#b9c9e0" stroke-width="0.9"/>')
            x += q
        y = 0.0
        while y < SEITE_H:
            teile.append(f'<line x1="0" y1="{y:.1f}" x2="{SEITE_B}" y2="{y:.1f}" stroke="#b9c9e0" stroke-width="0.9"/>')
            y += q
    return "".join(teile)


MAX_PROBE_ZEICHEN = 200
MAX_PROBE_VARIANTEN = 8
MAX_PROBE_STRICHE = 40
MAX_PROBE_PUNKTE = 4000


def probe_laden(roh):
    """Schriftprobe (Leifs echte Striche, E216) prüfen und vorbereiten: {Zeichen: [Variante, …]}, Variante = [Strich, …],
    Strich = [[x, y, t?, druck?], …] in Versalhöhen-Einheiten (Grundlinie y = 0, Versalhöhe y = -1). Striche mit Zeit
    werden alle 12 ms neu abgetastet – dann ist der Punktabstand das Schreibtempo (für die Strichdicke)."""
    if roh is None:
        return {}
    if not isinstance(roh, dict) or len(roh) > MAX_PROBE_ZEICHEN:
        raise HandschriftFehler("Schriftprobe hat ein falsches Format.")
    aus = {}
    for zeichen, varianten in roh.items():
        if not isinstance(zeichen, str) or len(zeichen) != 1 or not isinstance(varianten, list):
            raise HandschriftFehler("Schriftprobe hat ein falsches Format.")
        gut = []
        for v in varianten[:MAX_PROBE_VARIANTEN]:
            if not isinstance(v, list) or not v or len(v) > MAX_PROBE_STRICHE:
                continue
            striche = []
            for st in v:
                try:
                    a = np.array(st, dtype=float)
                except (TypeError, ValueError):
                    raise HandschriftFehler("Schriftprobe enthält ungültige Punkte.")
                if a.ndim != 2 or a.shape[1] < 2 or len(a) > MAX_PROBE_PUNKTE or not np.isfinite(a).all() or np.abs(a[:, :2]).max(initial=0) > 5:
                    raise HandschriftFehler("Schriftprobe enthält ungültige Punkte.")
                if len(a) == 1:
                    a = np.vstack([a, a + np.array([0.01, 0.0] + [0.0] * (a.shape[1] - 2))])
                if a.shape[1] >= 3 and np.all(np.diff(a[:, 2]) >= 0) and a[-1, 2] - a[0, 2] > 24:
                    t = np.arange(a[0, 2], a[-1, 2], 12.0)
                    t = np.append(t, a[-1, 2]) if t[-1] < a[-1, 2] else t
                    xy = np.stack([np.interp(t, a[:, 2], a[:, 0]), np.interp(t, a[:, 2], a[:, 1])], axis=1)
                else:
                    xy = a[:, :2]
                striche.append(xy)
            if striche:
                gut.append(striche)
        if gut:
            aus[zeichen] = gut
    return aus


class Zeile:
    """Eine gesetzte Zeile (oder Tabelle): Striche relativ zur Grundlinie y = 0 ab x = 0."""

    def __init__(self, linien, breite, oben=None, unten=None, anker=None, art="text", platz_oben=None, platz_unten=None):
        self.linien = linien
        self.breite = float(breite)
        if linien and (oben is None or unten is None):
            alle = np.concatenate(linien)
            oben = max(0.0, -float(alle[:, 1].min())) if oben is None else oben
            unten = max(0.0, float(alle[:, 1].max())) if unten is None else unten
        self.oben, self.unten = oben or 0.0, unten or 0.0
        self.anker = anker
        self.art = art
        # Wie viel Platz die Zeile über/unter der Grundlinie wirklich braucht: nur Formeln zählen (Brüche, ∑ …) – hohe
        # Ober- und Unterlängen im Fließtext ragen wie auf echtem Papier ein Stück in die Nachbarzeile
        self.platz_oben = self.oben if platz_oben is None else platz_oben
        self.platz_unten = self.unten if platz_unten is None else platz_unten


def _hershey_text(text, hand, durchstreichen=False):
    """Text in der einen Handschrift (Hershey + Schreiber-Profil): Wort für Wort mit eigener Grundlinie, Größe und Lage,
    unregelmäßige Wortabstände – und je nach Unordnung ab und zu ein verschriebenes, durchgestrichenes Wort."""
    rng, u = hand.rng, hand.u
    em = hand.em
    satz = hf.Satz(hand)
    t = text.replace("–", "-").replace("−", "-").replace("„", '"').replace("“", '"').replace("”", '"')
    striche, x, fehl = [], 0.0, 0
    for i, wort in enumerate(t.split()):
        if i:
            x += 0.42 * em * hand.abstand * (1 + rng.normal(0, 0.15 + 0.1 * u))
        if durchstreichen and len(wort) >= 4 and wort.isalpha() and rng.random() < 0.04 * u:
            falsch = satz.wort(_verschreiben(wort, rng), 1.0)
            y = -0.35 * em + rng.normal(0, 0.05 * em)
            striche += [q + np.array([x, 0.0]) for q in falsch.striche]
            striche.append(np.array([[x - 0.05 * em, y + rng.normal(0, 0.06 * em)], [x + falsch.breite + 0.05 * em, y + rng.normal(0, 0.06 * em)]]))
            x += falsch.breite + 0.35 * em
            fehl += 1
        k = satz.wort(wort, 1.0 + rng.normal(0, 0.012 + 0.018 * u))
        dy = rng.normal(0, 0.03 + 0.04 * u) * em
        winkel = rng.normal(0, 0.008 + 0.012 * u)
        mitte = np.array([x + k.breite / 2, 0.0])
        for q in k.striche:
            q = q + np.array([x, dy])
            striche.append(_drehen(q, winkel, mitte))
        x += k.breite
    erg = hf.Kasten([hand.zittern(q) if len(q) > 2 else q for q in striche], x, 0, 0)
    alle = np.concatenate(erg.striche) if erg.striche else np.zeros((1, 2))
    erg.oben, erg.unten = max(0.0, -float(alle[:, 1].min())), max(0.0, float(alle[:, 1].max()))
    erg.fehl = fehl
    return erg


def gemischt(sch, hand, teile, hoehe_ziel, durchstreichen, modell_zeichen, druckschrift=False):
    """Teile einer Zeile ([("text", str) | ("kasten", Kasten)]) nebeneinander → Zeile. Text schreibt das Modell, Kästen
    sind fertige Formeln. Liefert dazu die Zahl der Verschreiber und die weggelassenen Zeichen."""
    linien, x, anker, fehl, weg = [], 0.0, None, 0, set()
    p_oben, p_unten = 0.0, 0.0
    luft = hoehe_ziel * 0.45
    nur_formel = len(teile) == 1 and teile[0][0] == "kasten"
    for i, teil in enumerate(teile):
        if i:
            x += luft
        if teil[0] == "kasten":
            k = teil[1]
            if anker is None and k.anker is not None and nur_formel:
                anker = x + k.anker
            p_oben, p_unten = max(p_oben, k.oben), max(p_unten, k.unten)
            linien += [p + np.array([x, 0.0]) for p in k.striche]
            x += k.breite
            continue
        text = teil[1]
        # Kurze Wörter zwischen Formeln und Tabellenzellen: Druckschrift – das Modell braucht ganze Zeilen als Kontext
        # (gemessen: „und“ wurde zu einem Punkt, „Wert“ fehlte, „also stimmt“ wurde Gekritzel; ab ~12 Buchstaben geht es)
        if druckschrift or sum(c.isalpha() for c in text) < 12:
            k = _hershey_text(text, hand, durchstreichen and druckschrift != "tabelle")
            fehl += getattr(k, "fehl", 0)
            linien += [p + np.array([x, 0.0]) for p in k.striche]
            x += k.breite
            continue
        mt, um, w = vorbereiten(text, modell_zeichen)
        weg |= w
        mt = " ".join(mt.split())
        if not mt:
            continue
        ls, breite, f = zeile_gestalten(sch, mt, um, durchstreichen, hoehe_ziel)
        fehl += len(f)
        linien += [p + np.array([x, 0.0]) for p in ls]
        x += breite
    return Zeile(linien, x, anker=anker, art="formel" if nur_formel else "gemischt", platz_oben=p_oben, platz_unten=p_unten), fehl, weg


def _einheiten(segs, hand):
    """Segmente einer Eingabezeile → umbrechbare Einheiten: Textwörter einzeln, Formeln als Ganzes (schon gesetzt)."""
    aus = []
    for seg in segs:
        if seg[0] == "text":
            aus += [("text", w) for w in seg[1].split()]
        else:
            aus.append(("kasten", hf.formel(seg[1], hand, latex=seg[2])))
    return aus


def _umbrechen_gemischt(einheiten, nutzbreite, cw):
    """Greedy nach geschätzter Breite: Text ≈ Zeichen × Zeichenbreite, Formeln genau. Benachbarte Textwörter einer Zeile
    werden wieder zu einem Textstück (das Modell schreibt längere Stücke besser)."""
    zeilen, akt, breite = [], [], 0.0
    for e in einheiten:
        w = len(e[1]) * cw if e[0] == "text" else e[1].breite
        if akt and breite + cw * 0.7 + w > nutzbreite:
            zeilen.append(akt)
            akt, breite = [], 0.0
        akt.append(e)
        breite += (cw * 0.7 if len(akt) > 1 else 0) + w
    if akt:
        zeilen.append(akt)
    aus = []
    for z in zeilen:
        teile = []
        for e in z:
            if e[0] == "text" and teile and teile[-1][0] == "text":
                teile[-1] = ("text", teile[-1][1] + " " + e[1])
            else:
                teile.append(e)
        aus.append(teile)
    return aus


def tabelle_gestalten(sch, hand, reihen, kopf, hoehe_ziel, zeilenabstand, durchstreichen, modell_zeichen):
    """Markdown-Tabelle → Zeile (art „tabelle“, y = 0 ist die Oberkante): Zellen wie gemischte Zeilen, Gitter von Hand."""
    rng = sch.rng
    zellen, fehl, weg = [], 0, set()
    for reihe in reihen:
        r = []
        for inhalt in reihe:
            if not inhalt.strip():
                r.append(Zeile([], 0.0))
                continue
            teile = [("kasten", hf.formel(s[1], hand, latex=s[2])) if s[0] == "mathe" else s for s in hf.segmente(inhalt)]
            z, f, w = gemischt(sch, hand, teile, hoehe_ziel, durchstreichen, modell_zeichen, druckschrift="tabelle")
            fehl += f
            weg |= w
            r.append(z)
        zellen.append(r)
    pad_x, pad_y = hoehe_ziel * 0.45, hoehe_ziel * 0.25
    n_sp = max(len(r) for r in zellen)
    sp_breite = [max(r[j].breite for r in zellen) + 2 * pad_x for j in range(n_sp)]
    z_oben = [max([z.oben for z in r] + [hoehe_ziel * 0.75]) for r in zellen]
    z_unten = [max([z.unten for z in r] + [hoehe_ziel * 0.3]) for r in zellen]
    z_hoehe = [max(zeilenabstand * 0.9, o + u + 2 * pad_y) for o, u in zip(z_oben, z_unten)]
    xs = np.concatenate([[0.0], np.cumsum(sp_breite)])
    ys = np.concatenate([[0.0], np.cumsum(z_hoehe)])
    linien = []
    for i, r in enumerate(zellen):
        grund = ys[i] + (z_hoehe[i] - z_oben[i] - z_unten[i]) / 2 + z_oben[i]
        for j, z in enumerate(r):
            # Formeln und kurze Einträge (T/F, 0/1, Zahlen) mittig wie in Wahrheitstafeln, längerer Text links
            mittig = z.art == "formel" or z.breite <= hoehe_ziel * 2.2
            x = xs[j] + ((sp_breite[j] - z.breite) / 2 if mittig else pad_x)
            dy = rng.normal(0, hoehe_ziel * 0.04)
            linien += [p + np.array([x, grund + dy]) for p in z.linien]
    for y in ys:
        linien.append(hand.linie((xs[0], y), (xs[-1], y)))
    if kopf and len(ys) > 2:                                  # Kopfzeile: doppelt unterstrichen
        linien.append(hand.linie((xs[0], ys[1] + 3.0), (xs[-1], ys[1] + 3.5)))
    for x in xs:
        linien.append(hand.linie((x, ys[0]), (x, ys[-1])))
    return Zeile(linien, float(xs[-1]), 0.0, float(ys[-1]), art="tabelle"), fehl, weg


def ausrichten(gesetzt):
    """Rechenwege: aufeinanderfolgende reine Formelzeilen mit Anker (erstes „=“ bzw. „&“) so verschieben, dass die Anker
    untereinander stehen. Leerzeilen, Text und Tabellen beenden eine Gruppe."""
    gruppe = []
    for z in list(gesetzt) + [None]:
        if z is not None and z.art == "formel" and z.anker is not None:
            gruppe.append(z)
            continue
        if len(gruppe) >= 2:
            ziel = max(g.anker for g in gruppe)
            for g in gruppe:
                d = ziel - g.anker
                g.linien = [p + np.array([d, 0.0]) for p in g.linien]
                g.breite += d
                g.anker = ziel
                g.ausgerichtet = True
        gruppe = []


def schreiben(text, unordnung=0.5, papier="blanko", tinte="blau", groesse=1.0, durchstreichen=True, seed=None,
              modell=None, frist=None, stil="einheitlich", probe=None):
    """→ {"seiten": [svg, …], "weggelassen": [...], "unbekannt": [...], "zeilen": n, "verschrieben": n, "wiederholt": n,
    "formeln": n, "tabellen": n}"""
    if not isinstance(text, str) or not text.strip():
        raise HandschriftFehler("Text fehlt.")
    if len(text) > MAX_TEXT:
        raise HandschriftFehler(f"Zu lang – höchstens {MAX_TEXT} Zeichen je Auftrag (teile den Text auf).")
    if papier not in ("blanko", "liniert", "kariert", "keins"):
        raise HandschriftFehler("papier: blanko, liniert, kariert oder keins (durchsichtig, eng zugeschnitten).")
    if tinte not in TINTEN:
        raise HandschriftFehler(f"tinte: {', '.join(TINTEN)}.")
    if stil not in ("einheitlich", "ki"):
        raise HandschriftFehler("stil: einheitlich (eine Handschrift für alles, Standard) oder ki (Fließtext vom KI-Modell).")
    groesse = float(min(1.6, max(0.6, groesse)))
    einheitlich = stil == "einheitlich"
    # E215: einheitlich braucht das KI-Modell gar nicht (nur dessen Zeichensatz-Prüfung entfällt)
    m = modell or (Modell() if not einheitlich else None)
    rng = np.random.default_rng(seed)
    sch = Schreiber(m, unordnung, rng, frist if frist is not None else time.time() + ZEIT_BUDGET)
    u = sch.u
    # Schrifthöhe (Grundlinie bis Oberkante der Kleinbuchstaben ≈ 88. – 12. Perzentil) und Zeilenabstand
    hoehe_ziel = 9 * MM * 0.55 * groesse
    cw = hoehe_ziel * 0.62
    zeilenabstand = {"liniert": 9 * MM, "kariert": 10 * MM * groesse}.get(papier, 11.5 * MM * groesse)
    nutzbreite = SEITE_B - (32 * MM if papier == "liniert" else 22 * MM) - 18 * MM
    breite_zeichen = max(12, int(nutzbreite / cw * 0.9))
    # Formelsatz: Hershey-x-Höhe (14 Einheiten) ≈ x-Höhe der Modellschrift
    hand = hf.Hand(rng, u, hoehe_ziel / 27.0, probe=probe_laden(probe))
    weg = set()

    # Zeichenbreite der Hand gemessen statt geschätzt (E216): die Druckschrift mit Unterschneiden ist schmaler als das
    # KI-Modell, Leifs Schriftprobe kann breiter oder schmaler sein – geschätzt brach der Text schon nach 60 % der Zeile um
    cw_hand = cw
    if einheitlich:
        muster = "the quick brown fox jumps over a lazy dog, Und 1234"
        cw_hand = max(cw * 0.4, _hershey_text(muster, hand).breite / len(muster) * 1.04)

    # 1. Eingabe → Blöcke: reiner Text (wie bisher umbrochen), Zeilen mit Formeln, Tabellen, Leerzeilen
    eingabe = text.replace("\r\n", "\n").split("\n")
    gesetzt, verschrieben, formeln, tabellen = [], 0, 0, 0
    i = 0
    while i < len(eingabe):
        if time.time() > sch.frist:
            raise HandschriftFehler("Zu viel Text für einmal – die Zeit reichte nicht. Teile ihn auf (etwa eine Seite je Auftrag).")
        zeile = eingabe[i]
        if hf.ist_tabelle(zeile):
            j = i
            while j < len(eingabe) and hf.ist_tabelle(eingabe[j]):
                j += 1
            reihen, kopf = hf.tabelle_lesen(eingabe[i:j])
            if reihen:
                z, f, w = tabelle_gestalten(sch, hand, reihen, kopf, hoehe_ziel, zeilenabstand, durchstreichen, m.zeichen if m else "")
                verschrieben += f
                weg |= w
                tabellen += 1
                if z.breite > nutzbreite:
                    fk = nutzbreite / z.breite
                    z = Zeile([p * fk for p in z.linien], nutzbreite, 0.0, z.unten * fk, art="tabelle")
                gesetzt.append(z)
            i = j
            continue
        i += 1
        if not zeile.strip():
            gesetzt.append(Zeile([], 0.0, art="leer"))
            continue
        segs = hf.segmente(zeile)
        if all(s[0] == "text" for s in segs) and not einheitlich:
            t, um, w = vorbereiten(zeile, m.zeichen)
            weg |= w
            for tz, tum in umbrechen([(" ".join(t.split(" ")) if t.strip() else "", um)], breite_zeichen):
                if not tz:
                    continue
                ls, breite, f = zeile_gestalten(sch, tz, tum, durchstreichen, hoehe_ziel)
                verschrieben += len(f)
                gesetzt.append(Zeile(ls, breite))
            continue
        formeln += sum(1 for s in segs if s[0] == "mathe")
        for teile in _umbrechen_gemischt(_einheiten(segs, hand), nutzbreite, cw_hand if einheitlich else cw):
            z, f, w = gemischt(sch, hand, teile, hoehe_ziel, durchstreichen, m.zeichen if m else "", druckschrift=einheitlich)
            if einheitlich and z.art == "gemischt" and all(t[0] == "text" for t in teile):
                z.art = "text"
            verschrieben += f
            weg |= w
            gesetzt.append(z)

    # 2. Rechenwege: aufeinanderfolgende reine Formelzeilen mit „=“ am Anker ausrichten
    ausrichten(gesetzt)

    # 3. Seiten füllen: Zeilen mit Brüchen/Tabellen bekommen so viele Zeilen Platz, wie sie brauchen
    links0 = 28 * MM if papier == "liniert" else 20 * MM
    oben0 = 30 * MM if papier == "liniert" else (20 * MM if papier == "kariert" else 24 * MM)
    if papier == "keins":
        oben0 = hoehe_ziel * 2
    raster = papier in ("liniert", "kariert")
    seiten, akt, y = [], [], oben0
    gruppen_x = None
    zeilen_gesamt = 0

    def platz(mass):
        if mass <= 0:
            return 0.0
        return math.ceil(mass / zeilenabstand) * zeilenabstand if raster else mass

    for z in gesetzt:
        if z.art == "leer":
            y += zeilenabstand
            gruppen_x = None
            continue
        if z.art == "tabelle":
            oben_platz, unten_platz = 0.0, 0.0
            spitze = y - zeilenabstand * 0.75
            boden = spitze + z.unten
        else:
            oben_platz = platz(z.platz_oben - zeilenabstand * 0.75) if z.art != "text" else 0.0
            unten_platz = platz(z.platz_unten - zeilenabstand * 0.3) if z.art != "text" else 0.0
            boden = y + oben_platz + z.unten
        if boden > SEITE_H - 15 * MM and papier != "keins" and (akt or y > oben0):
            seiten.append(akt)
            if len(seiten) >= MAX_SEITEN:
                raise HandschriftFehler(f"Mehr als {MAX_SEITEN} Seiten – teile den Text auf.")
            akt, y = [], oben0
            gruppen_x = None
            if z.art == "tabelle":
                spitze = y - zeilenabstand * 0.75
        zeilen_gesamt += 1
        if getattr(z, "ausgerichtet", False):
            if gruppen_x is None:
                gruppen_x = links0 + rng.normal(0, 1.5 * MM * u) + abs(rng.normal(0, 1.0 * MM))
            x0 = gruppen_x + rng.normal(0, 0.4 * MM * u)
        else:
            gruppen_x = None
            x0 = links0 + rng.normal(0, 2.5 * MM * u) + abs(rng.normal(0, 1.0 * MM))
        if z.art == "tabelle":
            linien = [p + np.array([x0, spitze]) for p in z.linien]
            y = (spitze + z.unten + zeilenabstand * 0.75)
            y = oben0 + math.ceil((y - oben0) / zeilenabstand) * zeilenabstand if raster else y + zeilenabstand * 0.2
            akt.extend(linien)
            continue
        if z.breite > nutzbreite:                     # zu breit geraten → etwas stauchen
            f = nutzbreite / z.breite
            z.linien = [np.stack([p[:, 0] * f, p[:, 1]], axis=1) for p in z.linien]
        grund = y + oben_platz
        y0 = grund + rng.normal(0, 0.06 * zeilenabstand * (u + 0.3)) * (0.3 if z.art == "formel" else 1)
        winkel = rng.normal(0, 0.012 * u + 0.002) * (0.4 if z.art == "formel" else 1)
        akt.extend(_drehen(p + np.array([x0, y0]), winkel, np.array([x0, y0])) for p in z.linien)
        y = grund + unten_platz + zeilenabstand * (1 + (rng.normal(0, 0.04 * u) if papier == "blanko" else 0))
    if akt:
        seiten.append(akt)
    if not seiten:
        raise HandschriftFehler("Nichts zu schreiben.")
    farbe, deckkraft = TINTEN[tinte]
    svgs = []
    for linien in seiten:
        if papier == "keins":
            alle = np.concatenate(linien)
            rand = hoehe_ziel
            x_min, y_min = alle.min(0) - rand
            x_max, y_max = alle.max(0) + rand
            breite, hoehe = x_max - x_min, y_max - y_min
            versatz = np.array([-x_min, -y_min])
        else:
            breite, hoehe, versatz = SEITE_B, SEITE_H, np.zeros(2)
        # Seiten in Millimetern (PDF = echtes A4; PNG mit 150 dpi = 1240 × 1754 px), „keins“ in Pixeln
        masse = 'width="210mm" height="297mm"' if papier != "keins" else f'width="{breite:.0f}" height="{hoehe:.0f}"'
        teile = [f'<svg xmlns="http://www.w3.org/2000/svg" {masse} viewBox="0 0 {breite:.1f} {hoehe:.1f}">',
                 _papier(papier),
                 f'<g fill="none" stroke="{farbe}" stroke-linecap="round" stroke-linejoin="round" opacity="{deckkraft}">']
        basis = max(1.6, hoehe_ziel * 0.075)
        for p in linien:
            if len(p) == 1:
                p = np.vstack([p, p + 0.6])
            dicke = basis * (1 + rng.normal(0, 0.025))
            form = umriss(p + versatz, dicke * 0.95) if len(p) > 3 else None
            if form is None:                                    # gerade Linien und Punkte: gleichmäßig
                teile.append(f'<path d="{_pfad(p + versatz)}" stroke-width="{max(0.8, dicke):.2f}"/>')
            else:                                               # Umriss + hauchdünne Kontur gegen Treppen am Rand
                teile.append(f'<path d="{_pfad(form)} Z" fill="{farbe}" stroke-width="{dicke * 0.25:.2f}"/>')
        teile.append("</g></svg>")
        svgs.append("".join(teile))
    return {"seiten": svgs, "weggelassen": sorted(weg), "unbekannt": sorted(hand.unbekannt), "zeilen": zeilen_gesamt,
            "verschrieben": verschrieben, "wiederholt": sch.wiederholt, "formeln": formeln, "tabellen": tabellen}
