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
"""
import io
import math
import os
import pickle
import time
import zipfile
from collections import OrderedDict

import numpy as np

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
           "à": "a", "ó": "o", "ò": "o", "ç": "c", "ñ": "n", "€": "EUR", "§": "S", "*": "+", "=": "-", "_": "-", "]": ")",
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
        # endlose Striche), darum höchstens 0,75
        self.bias = 0.75 - 0.65 * self.u
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


def schreiben(text, unordnung=0.5, papier="blanko", tinte="blau", groesse=1.0, durchstreichen=True, seed=None,
              modell=None, frist=None):
    """→ {"seiten": [svg, …], "weggelassen": [...], "zeilen": n, "verschrieben": n, "wiederholt": n}"""
    if not isinstance(text, str) or not text.strip():
        raise HandschriftFehler("Text fehlt.")
    if len(text) > MAX_TEXT:
        raise HandschriftFehler(f"Zu lang – höchstens {MAX_TEXT} Zeichen je Auftrag (teile den Text auf).")
    if papier not in ("blanko", "liniert", "kariert", "keins"):
        raise HandschriftFehler("papier: blanko, liniert, kariert oder keins (durchsichtig, eng zugeschnitten).")
    if tinte not in TINTEN:
        raise HandschriftFehler(f"tinte: {', '.join(TINTEN)}.")
    groesse = float(min(1.6, max(0.6, groesse)))
    m = modell or Modell()
    rng = np.random.default_rng(seed)
    sch = Schreiber(m, unordnung, rng, frist if frist is not None else time.time() + ZEIT_BUDGET)
    u = sch.u
    absaetze, weg = [], set()
    for absatz in text.replace("\r\n", "\n").split("\n"):
        t, um, w = vorbereiten(absatz, m.zeichen)
        absaetze.append((" ".join(t.split(" ")) if t.strip() else "", um))
        weg |= w
    # Schrifthöhe (Grundlinie bis Oberkante der Kleinbuchstaben ≈ 88. – 12. Perzentil) und Zeilenabstand
    hoehe_ziel = 9 * MM * 0.55 * groesse
    zeilenabstand = {"liniert": 9 * MM, "kariert": 10 * MM * groesse}.get(papier, 11.5 * MM * groesse)
    nutzbreite = SEITE_B - (32 * MM if papier == "liniert" else 22 * MM) - 18 * MM
    breite_zeichen = max(12, int(nutzbreite / (hoehe_ziel * 0.62) * 0.9))
    zeilen = umbrechen(absaetze, breite_zeichen)
    links0 = 28 * MM if papier == "liniert" else 20 * MM
    oben0 = 30 * MM if papier in ("liniert",) else (20 * MM if papier == "kariert" else 24 * MM)
    seiten, akt, y = [], [], oben0
    verschrieben = 0
    zeilen_gesamt = 0
    if papier == "keins":
        oben0 = y = hoehe_ziel * 2
    for text_zeile, um in zeilen:
        if time.time() > sch.frist:
            raise HandschriftFehler("Zu viel Text für einmal – die Zeit reichte nicht. Teile ihn auf (etwa eine Seite je Auftrag).")
        if y > SEITE_H - 18 * MM and papier != "keins":
            seiten.append(akt)
            if len(seiten) >= MAX_SEITEN:
                raise HandschriftFehler(f"Mehr als {MAX_SEITEN} Seiten – teile den Text auf.")
            akt, y = [], oben0
        if text_zeile:
            linien, breite, fehl = zeile_gestalten(sch, text_zeile, um, durchstreichen, hoehe_ziel)
            verschrieben += len(fehl)
            zeilen_gesamt += 1
            if breite > nutzbreite:                     # zu breit geraten → etwas stauchen
                f = nutzbreite / breite
                linien = [np.stack([p[:, 0] * f, p[:, 1]], axis=1) for p in linien]
            x0 = links0 + rng.normal(0, 2.5 * MM * u) + abs(rng.normal(0, 1.0 * MM))
            y0 = y + rng.normal(0, 0.06 * zeilenabstand * (u + 0.3))
            winkel = rng.normal(0, 0.012 * u + 0.002)
            linien = [_drehen(p + np.array([x0, y0]), winkel, np.array([x0, y0])) for p in linien]
            akt.extend(linien)
        y += zeilenabstand * (1 + (rng.normal(0, 0.04 * u) if papier == "blanko" else 0))
    if akt:
        seiten.append(akt)
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
            dicke = basis * (1 + rng.normal(0, 0.08 + 0.12 * u))
            teile.append(f'<path d="{_pfad(p + versatz)}" stroke-width="{max(0.8, dicke):.2f}"/>')
        teile.append("</g></svg>")
        svgs.append("".join(teile))
    return {"seiten": svgs, "weggelassen": sorted(weg), "zeilen": zeilen_gesamt, "verschrieben": verschrieben,
            "wiederholt": sch.wiederholt}
