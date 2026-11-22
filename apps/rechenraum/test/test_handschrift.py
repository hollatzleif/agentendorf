"""Tests für handschrift.py (E212): python3 -m unittest discover -s apps/rechenraum/test

Das echte Modell (15 MB) liegt nur im Image (rauchtest.py prüft es dort). Hier: ein winziges Zufallsmodell im selben
Speicherformat wie torch.save – gebaut OHNE PyTorch über unechte Module „torch“/„torch._utils“, damit der Leser genau
das Format sieht, das er im Image liest. Dazu: der Leser führt keinen fremden Code aus, Text-Vorbereitung, Umbruch,
Bewertung und die ganze Seite (SVG) mit Umlauten, Papier, Seitenumbruch und Grenzen.
"""
import importlib.util
import io
import json
import os
import pickle
import sys
import tempfile
import types
import unittest
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None


def laden():
    spec = importlib.util.spec_from_file_location("handschrift", os.path.join(HIER, "..", "handschrift.py"))
    m = importlib.util.module_from_spec(spec)
    alt = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(m)
    finally:
        sys.dont_write_bytecode = alt
    return m


ZEICHEN = " !\"#%'()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[abcdefghijklmnopqrstuvwxyz"


def torch_datei(pfad, gewichte, boese=None):
    """Schreibt ein state_dict im Format von torch.save (ZIP: archiv/data.pkl + archiv/data/<n>) – ohne PyTorch."""
    torch_mod = types.ModuleType("torch")
    utils_mod = types.ModuleType("torch._utils")

    class FloatStorage:
        pass

    FloatStorage.__module__ = "torch"
    FloatStorage.__qualname__ = "FloatStorage"

    def _rebuild_tensor_v2(*a):
        raise AssertionError("nur zum Schreiben")

    _rebuild_tensor_v2.__module__ = "torch._utils"
    _rebuild_tensor_v2.__qualname__ = "_rebuild_tensor_v2"
    torch_mod.FloatStorage = FloatStorage
    utils_mod._rebuild_tensor_v2 = _rebuild_tensor_v2
    torch_mod._utils = utils_mod
    alt = {k: sys.modules.get(k) for k in ("torch", "torch._utils")}
    sys.modules["torch"], sys.modules["torch._utils"] = torch_mod, utils_mod
    try:
        speicher = {}

        class Tensor:
            def __init__(self, schluessel, arr):
                self.schluessel, self.arr = schluessel, arr

            def __reduce__(self):
                schritte = tuple(s // 4 for s in self.arr.strides)
                return (_rebuild_tensor_v2, (("SPEICHER", self.schluessel), 0, self.arr.shape, schritte, False, {}))

        class Pickler(pickle.Pickler):
            def persistent_id(self, obj):
                if isinstance(obj, tuple) and len(obj) == 2 and obj[0] == "SPEICHER":
                    a = speicher[obj[1]]
                    return ("storage", FloatStorage, obj[1], "cpu", a.size)
                return None

        from collections import OrderedDict
        sd = OrderedDict()
        for i, (k, v) in enumerate(gewichte.items()):
            a = np.ascontiguousarray(v, dtype=np.float32)
            speicher[str(i)] = a
            sd[k] = Tensor(str(i), a)
        puffer = io.BytesIO()
        Pickler(puffer, protocol=2).dump(boese if boese is not None else sd)
        with zipfile.ZipFile(pfad, "w") as z:
            z.writestr("archive/data.pkl", puffer.getvalue())
            for k, a in speicher.items():
                z.writestr(f"archive/data/{k}", a.tobytes())
    finally:
        for k, v in alt.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


def kleines_modell(ordner, versteckt=8, seed=0):
    rng = np.random.default_rng(seed)
    alphabet = len(ZEICHEN) + 1
    g = {}
    ein = {"lstm1": 3 + alphabet, "lstm2": 3 + versteckt + alphabet, "lstm3": 3 + versteckt + alphabet}
    for n, e in ein.items():
        g[f"{n}.W_xh"] = rng.normal(0, 0.3, (e + versteckt, 4 * versteckt))
        for t in ("W_ci", "b_i", "W_cf", "b_f", "b_c", "W_co", "b_o"):
            g[f"{n}.{t}"] = rng.normal(0, 0.1, versteckt)
    for t in ("alpha", "beta", "k"):
        g[f"window.{t}.weight"] = rng.normal(0, 0.1, (10, versteckt))
        g[f"window.{t}.bias"] = np.full(10, -1.0)    # k wächst langsam, aber stetig → das Fenster läuft durch den Text
    for t, n in (("pi", 20), ("mu", 40), ("sd", 40), ("ro", 20), ("eos", 1)):
        g[f"mixture.{t}.weight"] = rng.normal(0, 0.1, (n, 3 * versteckt))
        g[f"mixture.{t}.bias"] = np.zeros(n)
    g["mixture.mu.bias"][:20] = 0.5                    # nach rechts schreiben
    torch_datei(os.path.join(ordner, "model.pt"), g)
    with open(os.path.join(ordner, "meta.json"), "w") as f:
        json.dump({"mu": [8.0, 0.1, 0.0], "std": [40.0, 37.0, 1.0], "charset": ZEICHEN}, f)


@unittest.skipUnless(np is not None, "numpy fehlt")
class Handschrift(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hs = laden()
        cls.tmp = tempfile.TemporaryDirectory()
        kleines_modell(cls.tmp.name)
        cls.m = cls.hs.Modell(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_leser_liest_torch_format(self):
        g = self.hs.lade_gewichte(os.path.join(self.tmp.name, "model.pt"))
        self.assertEqual(g["lstm1.W_xh"].shape, (3 + len(ZEICHEN) + 1 + 8, 32))
        self.assertEqual(g["mixture.eos.bias"].shape, (1,))
        self.assertEqual(g["lstm1.W_xh"].dtype, np.float32)
        self.assertEqual(self.m.alphabet, len(ZEICHEN) + 1)

    def test_leser_fuehrt_keinen_fremden_code_aus(self):
        # Eine Pickle-Datei, die beim Laden os.system aufrufen würde, wird abgelehnt – nicht ausgeführt
        class Boese:
            def __reduce__(self):
                return (os.system, ("echo gehackt > /tmp/handschrift-gehackt",))

        with tempfile.TemporaryDirectory() as d:
            pfad = os.path.join(d, "model.pt")
            torch_datei(pfad, {}, boese=Boese())
            with self.assertRaises(self.hs.HandschriftFehler):
                self.hs.lade_gewichte(pfad)
        self.assertFalse(os.path.exists("/tmp/handschrift-gehackt"))

    def test_modell_fehlt_ehrlich(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(self.hs.HandschriftFehler) as e:
            self.hs.Modell(d)
        self.assertIn("fehlt", str(e.exception))

    def test_vorbereiten_umlaute_und_ersatz(self):
        t, um, weg = self.hs.vorbereiten("Grüße – „Öl“ & 5 € ☺", ZEICHEN)
        self.assertEqual(t, 'Grusse - "Ol" + 5 EUR ')
        self.assertEqual([t[i] for i in um], ["u", "O"])
        self.assertEqual(weg, {"☺"})

    def test_umbrechen_trennt_keine_woerter_und_haengt_kurze_reste_an(self):
        zeilen = self.hs.umbrechen([("eins zwei drei vier fuenf sechs", [])], 12)
        self.assertTrue(all(len(z) <= 12 * 1.2 for z, _ in zeilen))
        self.assertEqual(" ".join(z for z, _ in zeilen), "eins zwei drei vier fuenf sechs")
        # Umlaut-Stellen wandern mit in die richtige Zeile
        zeilen = self.hs.umbrechen([("aaaa bbbb uber", [10])], 9)
        z, um = zeilen[-1]
        self.assertEqual(z[um[0]], "u")
        # sehr langes Wort wird geteilt statt über den Rand zu laufen
        zeilen = self.hs.umbrechen([("x" * 30, [])], 10)
        self.assertEqual(sum(len(z) for z, _ in zeilen), 30)

    def test_bewerten(self):
        bew = np.array([[10, 0, 0, 0], [10, 0, 0, 1], [10, 0, 1, 2]], dtype=float)
        self.assertEqual(self.hs.bewerten("abc", bew, True), 0)
        self.assertGreater(self.hs.bewerten("abcd", bew, True), 0)   # „d“ nie besucht
        self.assertGreater(self.hs.bewerten("abc", bew, False), 0)   # kein Ende gefunden

    def test_seite_mit_umlauten_papier_und_tinte(self):
        e = self.hs.schreiben("Liebe Grüße!\nÜbermorgen", unordnung=0.8, papier="liniert", tinte="rot", seed=1, modell=self.m)
        self.assertEqual(len(e["seiten"]), 1)
        svg = e["seiten"][0]
        self.assertTrue(svg.startswith("<svg") and svg.endswith("</svg>"))
        self.assertIn('stroke="#b3261e"', svg)
        self.assertIn("<line", svg)          # liniert
        self.assertNotIn("<script", svg)
        self.assertEqual(e["zeilen"], 2)
        # gleicher seed → gleiches Ergebnis, anderer seed → anderes
        e2 = self.hs.schreiben("Liebe Grüße!\nÜbermorgen", unordnung=0.8, papier="liniert", tinte="rot", seed=1, modell=self.m)
        e3 = self.hs.schreiben("Liebe Grüße!\nÜbermorgen", unordnung=0.8, papier="liniert", tinte="rot", seed=2, modell=self.m)
        self.assertEqual(svg, e2["seiten"][0])
        self.assertNotEqual(svg, e3["seiten"][0])

    def test_mathe_und_tabelle(self):
        text = "Aufgabe 3: Löse die Gleichung\n3x + 5 = 20 | -5\n3x = 15 | :3\nx = 5\nAlso $\\frac{1}{2} \\le x$ fertig.\n\n| Nr. | Wert |\n|---|---|\n| 1 | 12,5 |"
        e = self.hs.schreiben(text, unordnung=0.5, papier="kariert", seed=3, modell=self.m)
        self.assertEqual(e["tabellen"], 1)
        self.assertGreaterEqual(e["formeln"], 4)
        self.assertEqual(e["unbekannt"], [])
        self.assertEqual(e["weggelassen"], [])            # „=“ wird nicht mehr zu „-“ und nicht weggelassen
        self.assertEqual(len(e["seiten"]), 1)

    def test_rechenweg_wird_am_gleichheitszeichen_ausgerichtet(self):
        hf = handformel_laden()
        h = hf.Hand(np.random.default_rng(1), 0.5, 1.0)
        zeilen = [self.hs.Zeile(k.striche, k.breite, anker=k.anker, art="formel")
                  for k in (hf.formel(t, h, latex=False) for t in ("3x + 5 = 20", "3x = 15", "x = 5"))]
        vorher = [z.anker for z in zeilen]
        self.assertGreater(max(vorher) - min(vorher), 1)
        text = self.hs.Zeile([np.zeros((2, 2))], 10.0)
        self.hs.ausrichten(zeilen + [text])
        self.assertEqual(len({round(z.anker, 6) for z in zeilen}), 1)
        self.assertTrue(all(getattr(z, "ausgerichtet", False) for z in zeilen))
        self.assertFalse(getattr(text, "ausgerichtet", False))

    def test_keins_ist_durchsichtig_und_eng(self):
        e = self.hs.schreiben("kurz", papier="keins", seed=1, modell=self.m)
        svg = e["seiten"][0]
        self.assertNotIn("<rect", svg)
        breite = float(svg.split('width="')[1].split('"')[0])
        self.assertLess(breite, self.hs.SEITE_B)

    def test_grenzen(self):
        with self.assertRaises(self.hs.HandschriftFehler):
            self.hs.schreiben("", modell=self.m)
        with self.assertRaises(self.hs.HandschriftFehler):
            self.hs.schreiben("x" * (self.hs.MAX_TEXT + 1), modell=self.m)
        with self.assertRaises(self.hs.HandschriftFehler):
            self.hs.schreiben("Hallo", papier="tapete", modell=self.m)
        with self.assertRaises(self.hs.HandschriftFehler):
            self.hs.schreiben("Hallo", tinte="gold", modell=self.m)
        with self.assertRaises(self.hs.HandschriftFehler) as e:
            self.hs.schreiben("Hallo Welt " * 50, modell=self.m, frist=0)
        self.assertIn("Zeit", str(e.exception))

    def test_viele_zeilen_ergeben_mehrere_seiten(self):
        e = self.hs.schreiben("\n".join(["Zeile"] * 40), papier="kariert", seed=1, modell=self.m)
        self.assertGreaterEqual(len(e["seiten"]), 2)


def handformel_laden():
    sys.path.insert(0, os.path.join(HIER, ".."))
    try:
        import handformel
        return handformel
    finally:
        sys.path.remove(os.path.join(HIER, ".."))


@unittest.skipUnless(np is not None, "numpy fehlt")
class Formeln(unittest.TestCase):
    """E213: Formelsatz (handformel.py) – Eingabe, Erkennung, Kästen, Tabellen, Ausrichten."""

    @classmethod
    def setUpClass(cls):
        cls.hf = handformel_laden()

    def hand(self, seed=1, u=0.4):
        return self.hf.Hand(np.random.default_rng(seed), u, 1.0)

    def test_danksagung_der_hershey_daten_liegt_bei(self):
        with open(os.path.join(HIER, "..", "hershey", "glyphen.json"), encoding="utf-8") as f:
            daten = json.load(f)
        self.assertIn("Dr. A. V. Hershey", daten["dank"])
        self.assertIn("James Hurt", daten["dank"])
        for name in ("=", "0", "9", "x", "A", "sum", "intgross", "le", "ne", "alpha", "Delta", "infty", "approx"):
            self.assertIn(name, daten["glyphen"])

    def test_einfache_schreibweise(self):
        v = self.hf.vereinfacht_zu_latex
        self.assertEqual(v("3x + 5 = 20 | -5"), "3x + 5 = 20 \\quad\\umform -5")
        self.assertIn("\\le", v("a <= b"))
        self.assertIn("\\ne", v("x != 0"))
        self.assertIn("\\Rightarrow", v("a => b"))
        self.assertIn("\\sqrt{2}", v("sqrt(2)"))
        self.assertIn("^{n+1}", v("x^(n+1)"))
        self.assertIn("\\cdot", v("3 * 5"))
        self.assertIn("^2", v("a²"))
        self.assertIn(",\\, 12", v("0, 12"))            # Aufzählung bleibt getrennt …
        self.assertIn("12,5", v("12,5"))                   # … Dezimalkomma nicht
        self.assertEqual(v("|x - 2| = 3"), "|x - 2| = 3")  # Betrag ist kein Umformungsstrich

    def test_unbekannte_befehle_werden_gemeldet(self):
        h = self.hand()
        self.hf.formel(r"\frac{1}{2} + \zeta + \foobar{x}", h)
        self.assertEqual(h.unbekannt, {"\\foobar"})

    def test_segmente(self):
        seg = self.hf.segmente("Probe: 3 * 5 + 5 = 20, also stimmt x = 5.")
        self.assertEqual([s[0] for s in seg], ["text", "mathe", "text", "mathe"])
        self.assertEqual(seg[3][1], "x = 5.")
        seg = self.hf.segmente("Löse $x^2 = 4$ und gib f(x) an")
        self.assertEqual(seg[1], ("mathe", "x^2 = 4", True))
        self.assertEqual(seg[3], ("mathe", "f(x)", False))
        self.assertEqual(self.hf.segmente("Ganz normaler Satz ohne Mathe."), [("text", "Ganz normaler Satz ohne Mathe.")])

    def test_kaesten(self):
        h = self.hand()
        flach = self.hf.formel("x = 5", h, latex=False)
        bruch = self.hf.formel(r"\frac{a+b}{c}", h)
        hoch = self.hf.formel("x^2", h, latex=False)
        self.assertGreater(bruch.oben, flach.oben)        # Zähler über der Achse
        self.assertGreater(bruch.unten, flach.unten)      # Nenner unter der Grundlinie
        self.assertGreater(hoch.oben, flach.oben)
        self.assertIsNotNone(flach.anker)
        self.assertGreater(flach.anker, 0)
        # Anker: „&“ geht vor „=“
        und = self.hf.formel("a + b &= c", h)
        gleich = self.hf.formel("a + b = c", h)
        self.assertLess(und.anker, gleich.anker)
        for k in (flach, bruch, hoch, self.hf.formel(r"\sum_{i=1}^n i = \int_0^1 \sqrt[3]{x}\,dx \Rightarrow \lim_{x \to 0}", h)):
            self.assertTrue(k.striche)
            self.assertTrue(all(np.isfinite(p).all() for p in k.striche))

    def test_tabelle_lesen(self):
        self.assertTrue(self.hf.ist_tabelle("| a | b |"))
        self.assertFalse(self.hf.ist_tabelle("3x = 15 | :3"))
        reihen, kopf = self.hf.tabelle_lesen(["| Nr. | Wert |", "|---|:--:|", "| 1 | 12,5 |", "| 2 |"])
        self.assertTrue(kopf)
        self.assertEqual(reihen, [["Nr.", "Wert"], ["1", "12,5"], ["2", ""]])




@unittest.skipUnless(np is not None, "numpy fehlt")
class Dorfwerk(unittest.TestCase):
    """Der Weg, den das Dorf nimmt: dorfwerk.py-Auftrag „handschrift“ → Dateien im Arbeitsordner."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        kleines_modell(cls.tmp.name)
        os.environ["HANDSCHRIFT_MODELL"] = cls.tmp.name
        sys.path.insert(0, os.path.join(HIER, ".."))
        sys.modules.pop("handschrift", None)
        spec = importlib.util.spec_from_file_location("dorfwerk_hs", os.path.join(HIER, "..", "dorfwerk.py"))
        cls.dw = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.dw)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("HANDSCHRIFT_MODELL", None)
        sys.path.remove(os.path.join(HIER, ".."))
        sys.modules.pop("handschrift", None)
        cls.tmp.cleanup()

    def setUp(self):
        self.alt = os.getcwd()
        self.raum = tempfile.TemporaryDirectory()
        os.chdir(self.raum.name)

    def tearDown(self):
        os.chdir(self.alt)
        self.raum.cleanup()

    def test_svg_mit_namen(self):
        e = self.dw.ausfuehren({"art": "handschrift", "text": "Hallo Welt", "format": "svg", "name": "Gruß an ../Oma.svg", "seed": 1})
        self.assertTrue(e["ok"], e)
        self.assertEqual(len(e["dateien"]), 1)
        self.assertRegex(e["dateien"][0], r"^[A-Za-z0-9._-]+\.svg$")
        self.assertTrue(os.path.isfile(e["dateien"][0]))
        self.assertIn("Handschrift geschrieben", e["text"])

    def test_fehler_ehrlich(self):
        for auftrag in ({"text": ""}, {"text": "x", "format": "gif"}, {"text": "x", "unordnung": "sehr"}, {"text": "x", "seed": "a"}):
            e = self.dw.ausfuehren({"art": "handschrift", **auftrag})
            self.assertFalse(e["ok"], auftrag)
            self.assertTrue(e["fehler"])

    @unittest.skipUnless(__import__("shutil").which("rsvg-convert"), "rsvg-convert fehlt")
    def test_png_und_pdf(self):
        e = self.dw.ausfuehren({"art": "handschrift", "text": "Hallo", "format": "png", "seed": 1})
        self.assertEqual(e["dateien"], ["handschrift.png"])
        e = self.dw.ausfuehren({"art": "handschrift", "text": "\n".join(["Zeile"] * 40), "format": "pdf", "seed": 1})
        self.assertEqual(e["dateien"], ["handschrift.pdf"])


if __name__ == "__main__":
    unittest.main()
