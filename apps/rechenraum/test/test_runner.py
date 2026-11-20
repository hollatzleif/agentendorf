"""Tests für den Rechenraum-Runner (nur Standardbibliothek): python3 -m unittest discover -s apps/rechenraum/test"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

RUNNER = os.path.join(os.path.dirname(__file__), "..", "runner.py")
GEHEIM = "test-geheimnis-123"


def freier_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class SpeicherTest(unittest.TestCase):
    """E195: Speichergrenzen der Umwandlung passen zum Container (deploy/compose.yml)."""

    def _runner(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("rr_runner", RUNNER)
        m = importlib.util.module_from_spec(spec)
        alt = dict(os.environ)
        os.environ.pop("UMWANDELN_SPEICHER_MB", None)
        os.environ.pop("UMWANDELN_GLEICHZEITIG", None)
        os.environ.setdefault("RECHENRAUM_GEHEIMNIS", GEHEIM)
        os.environ["ARBEIT_DIR"] = tempfile.mkdtemp()
        schreiben = sys.dont_write_bytecode
        sys.dont_write_bytecode = True  # kein __pycache__ neben runner.py
        try:
            spec.loader.exec_module(m)
        finally:
            sys.dont_write_bytecode = schreiben
            os.environ.clear()
            os.environ.update(alt)
        return m

    def test_grenzen_passen_zum_container(self):
        import re
        m = self._runner()
        with open(os.path.join(os.path.dirname(RUNNER), "..", "..", "deploy", "compose.yml"), encoding="utf-8") as f:
            compose = f.read()
        teil = compose[compose.index("\n  rechenraum:"):compose.index("\n  browser:")]
        mem = re.search(r"^    mem_limit: (\d+)([mg])$", teil, re.M)
        limit_mb = int(mem.group(1)) * (1024 if mem.group(2) == "g" else 1)
        tmpfs_mb = sum(int(x) for x in re.findall(r"size: (\d+) }", teil)) // (1024 * 1024)
        gleichzeitig = m.UMWANDELN_GLEICHZEITIG._initial_value
        # früher: 2 × 1536 MB Adressraum gegen 1 GB – und die tmpfs-Ordner (640 MB) waren gar nicht eingerechnet
        self.assertGreaterEqual(limit_mb, tmpfs_mb + gleichzeitig * m.UMWANDELN_BELEGT_MB + 100)
        # der Riegel je Umwandlung: über dem gemessenen Adressraum von whisper/ffmpeg (~740 MB), aber unter dem Container
        self.assertGreaterEqual(m.UMWANDELN_SPEICHER, 800 * 1024 * 1024)
        self.assertLess(m.UMWANDELN_SPEICHER, limit_mb * 1024 * 1024)

    @unittest.skipUnless(os.path.exists("/proc/self/oom_score_adj"), "nur Linux")
    def test_umwandlung_ist_das_opfer_bei_speichernot(self):
        code = (
            "import importlib.util,os,sys\n"
            "sys.dont_write_bytecode=True\n"
            f"spec=importlib.util.spec_from_file_location('rr_runner',{RUNNER!r});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n"
            "import subprocess\n"
            "p=subprocess.run(['cat','/proc/self/oom_score_adj'],capture_output=True,preexec_fn=m._grenzen_setzen)\n"
            "print(p.stdout.decode().strip(), open('/proc/self/oom_score_adj').read().strip())\n"
        )
        env = dict(os.environ, RECHENRAUM_GEHEIMNIS=GEHEIM, ARBEIT_DIR=tempfile.mkdtemp())
        aus = subprocess.run([sys.executable, "-c", code], capture_output=True, env=env, timeout=30)
        self.assertEqual(aus.returncode, 0, aus.stderr.decode())
        kind, runner = aus.stdout.decode().split()
        self.assertEqual(kind, "1000")       # die Umwandlung (und was sie startet) trifft es zuerst
        self.assertNotEqual(runner, "1000")  # der Runner selbst bleibt unverändert


class RunnerTest(unittest.TestCase):
    ENV_EXTRA = {}

    @classmethod
    def setUpClass(cls):
        cls.arbeit = tempfile.mkdtemp()
        cls.port = freier_port()
        env = dict(os.environ, ARBEIT_DIR=cls.arbeit, PORT=str(cls.port), RECHENRAUM_GEHEIMNIS=GEHEIM, ZEITLIMIT_S="2", UMWANDELN_ZEITLIMIT_S="40", **cls.ENV_EXTRA)
        cls.p = subprocess.Popen([sys.executable, RUNNER], env=env)
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/gesundheit", timeout=1)
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()

    def post(self, weg, daten, geheim=GEHEIM):
        r = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{weg}", data=json.dumps(daten).encode(), method="POST",
            headers={"content-type": "application/json", **({"x-rechenraum-geheimnis": geheim} if geheim else {})},
        )
        try:
            with urllib.request.urlopen(r, timeout=30) as a:
                return a.status, json.loads(a.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_geheimnis_noetig(self):
        self.assertEqual(self.post("/befehl", {"raum": "a", "befehl": "true"}, geheim=None)[0], 401)
        self.assertEqual(self.post("/befehl", {"raum": "a", "befehl": "true"}, geheim="falsch")[0], 401)

    def test_schreiben_befehl_lesen(self):
        s, _ = self.post("/schreiben", {"raum": "r1", "pfad": "sub/a.py", "inhalt_b64": base64.b64encode(b"print(6*7)").decode()})
        self.assertEqual(s, 200)
        s, r = self.post("/befehl", {"raum": "r1", "befehl": "python3 sub/a.py && pwd && echo $HOME"})
        self.assertEqual((s, r["code"], r["abgelaufen"]), (200, 0, False))
        zeilen = r["ausgabe"].split()
        self.assertEqual(zeilen[0], "42")
        self.assertEqual(os.path.realpath(zeilen[1]), os.path.realpath(os.path.join(self.arbeit, "r1")))
        s, r = self.post("/lesen", {"raum": "r1", "pfad": "sub/a.py"})
        self.assertEqual(base64.b64decode(r["inhalt_b64"]), b"print(6*7)")
        s, r = self.post("/dateien", {"raum": "r1"})
        self.assertEqual(r["dateien"], [{"pfad": "sub/a.py", "groesse": 10}])

    def test_zeitlimit_greift(self):
        t = time.time()
        s, r = self.post("/befehl", {"raum": "r2", "befehl": "sleep 30; echo nie"})
        self.assertLess(time.time() - t, 10)
        self.assertTrue(r["abgelaufen"])
        self.assertNotIn("nie", r["ausgabe"])

    def test_pfade_bleiben_im_raum(self):
        for p in ["../x", "/etc/passwd", "a/../../x", ""]:
            s, r = self.post("/schreiben", {"raum": "r3", "pfad": p, "inhalt_b64": ""})
            self.assertEqual(s, 400, p)
        # Symlink aus dem Raum hinaus wird nicht verfolgt
        self.post("/befehl", {"raum": "r3", "befehl": "ln -s / raus"})
        self.assertEqual(self.post("/lesen", {"raum": "r3", "pfad": "raus/etc/passwd"})[0], 400)
        self.assertEqual(self.post("/schreiben", {"raum": "r3", "pfad": "raus/tmp/x", "inhalt_b64": ""})[0], 400)
        for raum in ["../x", "a/b", "", ".."]:
            self.assertEqual(self.post("/befehl", {"raum": raum, "befehl": "true"})[0], 400, raum)

    def test_aufraeumen(self):
        self.post("/befehl", {"raum": "r4", "befehl": "touch x"})
        self.assertTrue(os.path.exists(os.path.join(self.arbeit, "r4", "x")))
        self.assertEqual(self.post("/aufraeumen", {"raum": "r4"})[0], 200)
        self.assertFalse(os.path.exists(os.path.join(self.arbeit, "r4")))

    @unittest.skipUnless(subprocess.run(["which", "pdftoppm"], capture_output=True).returncode == 0, "pdftoppm fehlt")
    def test_seite_als_bild(self):
        # minimales gültiges PDF (eine leere Seite)
        pdf = b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
        self.post("/schreiben", {"raum": "r5", "pfad": "a.pdf", "inhalt_b64": base64.b64encode(pdf).decode()})
        s, r = self.post("/seite", {"raum": "r5", "pdf": "a.pdf", "seite": 1, "dpi": 50})
        self.assertEqual(s, 200, r)
        self.assertTrue(base64.b64decode(r["png"]).startswith(b"\x89PNG"))
        self.assertEqual(self.post("/seite", {"raum": "r5", "pdf": "fehlt.pdf", "seite": 1})[0], 404)


BEISPIELE = os.path.join(os.path.dirname(__file__), "..", "..", "server", "test", "fixtures", "anhaenge")


def hat(werkzeug):
    return shutil.which(werkzeug) is not None


def hat_modul(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


class UmwandelnTest(RunnerTest):
    """E190: /umwandeln – jede Formatklasse; was ein fehlendes Werkzeug braucht, wird lokal übersprungen (im Image läuft alles)."""

    def umwandeln(self, name, daten=None):
        if daten is None:
            with open(os.path.join(BEISPIELE, name), "rb") as f:
                daten = f.read()
        s, r = self.post("/umwandeln", {"name": name, "inhalt_b64": base64.b64encode(daten).decode()})
        self.assertEqual(s, 200, r)
        return r

    # Tests der Elternklasse nicht doppelt laufen lassen
    test_geheimnis_noetig = test_schreiben_befehl_lesen = test_zeitlimit_greift = test_pfade_bleiben_im_raum = None
    test_aufraeumen = test_seite_als_bild = None

    def test_geheimnis_auch_hier(self):
        self.assertEqual(self.post("/umwandeln", {"name": "a.txt", "inhalt_b64": ""}, geheim="falsch")[0], 401)

    def test_text_und_code(self):
        self.assertIn("Rübezahl", self.umwandeln("notiz.txt")["text"])
        self.assertIn("def summe", self.umwandeln("rechnung.py")["text"])
        self.assertIn("2026-11-01;Miete", self.umwandeln("konto.csv")["text"])

    def test_html_wird_lesbar(self):
        t = self.umwandeln("seite.html")["text"]
        self.assertIn("# Prüfungsinfo", t)
        self.assertIn("- Hörsaal 1", t)
        self.assertIn("https://example.org/info", t)
        self.assertNotIn("alert", t)
        self.assertNotIn("color:red", t)

    def test_office(self):
        t = self.umwandeln("brief.docx")["text"]
        self.assertIn("# Bewerbung Praktikum", t)
        self.assertIn("## Kenntnisse", t)
        self.assertIn("- Python", t)
        self.assertIn("| Analysis | 1,3 |", t)
        self.assertIn("## Kenntnisse", self.umwandeln("brief.odt")["text"])
        t = self.umwandeln("budget.xlsx")["text"]
        self.assertIn("## Blatt: Budget", t)
        self.assertIn("| Jänner | 812.5 | 2026-01-31 |", t)
        self.assertIn("## Blatt: Notizen", t)
        self.assertIn("| Februar | 790 | 2026-02-28 |", self.umwandeln("budget.ods")["text"])
        t = self.umwandeln("folien.pptx")["text"]
        self.assertIn("## Folie 1: Lineare Regression", t)
        self.assertIn("- Residuen prüfen", t)
        self.assertIn("Notizen: Hier das Beispiel", t)
        self.assertIn("## Folie 2: Zusammenfassung", t)
        self.assertIn("## Folie 1: Lineare Regression", self.umwandeln("folien.odp")["text"])
        self.assertIn("Grüße", self.umwandeln("brief.rtf")["text"])

    @unittest.skipUnless(hat("catdoc") and hat_modul("xlrd"), "catdoc/xlrd fehlen (nur im Image)")
    def test_alte_office_formate(self):
        self.assertIn("Bewerbung Praktikum", self.umwandeln("brief.doc")["text"])
        self.assertIn("Jänner", self.umwandeln("budget.xls")["text"])

    def test_mail_mit_anhang(self):
        t = self.umwandeln("mail.eml")["text"]
        self.assertIn("Subject: Unterlagen zur Übung", t)
        self.assertIn("im Anhang die Angabe", t)
        self.assertIn("- angabe.txt", t)
        self.assertIn("Mittelwert von 2, 4, 6", t)

    def test_archive(self):
        t = self.umwandeln("paket.zip")["text"]
        self.assertIn("- ordner/liesmich.txt", t)
        self.assertIn("Das ist die Angabe im Archiv.", t)
        self.assertIn("# Bewerbung Praktikum", t)  # docx im zip
        self.assertIn("Tagebuch im Tar-Archiv", self.umwandeln("sicherung.tar.gz")["text"])

    def test_zip_bombe_und_tiefe(self):
        import io
        import zipfile
        puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("nullen.txt", b"\0" * (30 * 1024 * 1024))
        self.assertLess(len(puffer.getvalue()), 200_000)
        r = self.umwandeln("bombe.zip", puffer.getvalue())
        self.assertIn("verdächtig stark gepackt", r["text"])
        self.assertNotIn("\0\0\0", r["text"])
        # Archiv im Archiv im Archiv: nur bis zur festen Tiefe
        innen = puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w") as z:
            z.writestr("tief.txt", "ganz unten")
        for i in range(3):
            aussen = io.BytesIO()
            with zipfile.ZipFile(aussen, "w") as z:
                z.writestr(f"ebene{i}.zip", innen.getvalue())
            innen = aussen
        r = self.umwandeln("schachtel.zip", innen.getvalue())
        self.assertNotIn("ganz unten", r["text"])
        self.assertTrue(any("Tiefe begrenzt" in h for h in r["hinweise"]))

    def test_zu_gross(self):
        s, r = self.post("/umwandeln", {"name": "gross.txt", "inhalt_b64": base64.b64encode(b"x" * (25 * 1024 * 1024 + 1)).decode()})
        self.assertEqual(s, 413)

    def test_unbekanntes_wird_gemeldet(self):
        r = self.umwandeln("unbekannt.xyz")
        self.assertEqual(r["text"], "")
        self.assertTrue(any("Unbekanntes Format" in h for h in r["hinweise"]))
        # ohne Endung, aber am Inhalt erkennbar
        with open(os.path.join(BEISPIELE, "mail.eml"), "rb") as f:
            r = self.umwandeln("ohne_endung", f.read())
        self.assertIn("am Inhalt erkannt", r["typ"])
        self.assertIn("Unterlagen zur Übung", r["text"])
        # kaputtes Office: ehrliche Meldung statt Absturz
        r = self.umwandeln("kaputt.docx", b"PK\x03\x04 kein zip")
        self.assertTrue(any("Nicht lesbar" in h for h in r["hinweise"]), r)

    @unittest.skipUnless(hat_modul("PIL"), "Pillow fehlt")
    def test_bilder(self):
        for n in ("foto.png", "scan.bmp"):
            r = self.umwandeln(n)
            self.assertEqual(len(r["bilder"]), 1, n)
            self.assertIn(r["bilder"][0]["mime"], ("image/png", "image/jpeg"))

    @unittest.skipUnless(hat("heif-convert") and hat_modul("PIL"), "heif-convert fehlt (nur im Image)")
    def test_heic(self):
        r = self.umwandeln("handy.heic")
        self.assertEqual(len(r["bilder"]), 1, r)

    @unittest.skipUnless(hat("rsvg-convert") and hat_modul("PIL"), "rsvg-convert fehlt (nur im Image)")
    def test_svg(self):
        r = self.umwandeln("grafik.svg")
        self.assertEqual(len(r["bilder"]), 1, r)
        self.assertIn("Umsatz 2026", r["text"])

    @unittest.skipUnless(hat("ffprobe"), "ffmpeg fehlt")
    def test_audio_und_video(self):
        r = self.umwandeln("ton.wav")
        self.assertIn("Dauer: 0:01", r["text"])
        if hat("whisper-cli"):
            self.assertIn("## Transkript", r["text"])
        else:
            self.assertTrue(any("Transkription" in h for h in r["hinweise"]))
        r = self.umwandeln("clip.mp4")
        self.assertIn("Video: h264", r["text"])
        self.assertGreaterEqual(len(r["bilder"]), 2)

    @unittest.skipUnless(hat("pdftotext"), "poppler fehlt")
    def test_pdf_text(self):
        pdf = (b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
               b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")
        r = self.umwandeln("leer.pdf", pdf)
        self.assertEqual(r["meta"].get("seiten"), 1)


def _modell(name, standard):
    return os.environ.get(name, standard)


HAT_ORT = hat_modul("PIL") and hat_modul("numpy") and hat_modul("onnxruntime")
HAT_HINTERGRUND = HAT_ORT and os.path.isfile(_modell("BILD_MODELL_HINTERGRUND", "/opt/bild/u2netp.onnx"))
HAT_SKALIEREN = HAT_ORT and os.path.isfile(_modell("BILD_MODELL_SKALIEREN", "/opt/bild/real_esrgan_general_x4v3.onnx"))


@unittest.skipUnless(hat_modul("PIL"), "Pillow fehlt")
class BildTest(RunnerTest):
    """E198: /bild – Bildbearbeitung für Atelier und bild_bearbeiten; die KI-Schritte nur, wo onnxruntime und Modelle da sind
    (im Image; lokal: BILD_MODELL_HINTERGRUND / BILD_MODELL_SKALIEREN auf die Dateien zeigen lassen)."""

    # Tests der Elternklasse nicht doppelt laufen lassen
    test_geheimnis_noetig = test_schreiben_befehl_lesen = test_zeitlimit_greift = test_pfade_bleiben_im_raum = None
    test_aufraeumen = test_seite_als_bild = None

    def png(self, breite=200, hoehe=100, modus="RGB"):
        import io
        from PIL import Image, ImageDraw
        b = Image.new(modus, (breite, hoehe), (255, 255, 255, 255)[: len(modus)])
        z = ImageDraw.Draw(b)
        z.rectangle((0, 0, breite // 2 - 1, hoehe - 1), fill=(220, 30, 30, 255)[: len(modus)])
        z.ellipse((breite * 0.55, hoehe * 0.2, breite * 0.95, hoehe * 0.8), fill=(20, 40, 200, 255)[: len(modus)])
        p = io.BytesIO()
        b.save(p, "PNG")
        return p.getvalue()

    def bild(self, schritte, daten=None, name="test.png", fmt="png", **mehr):
        return self.post("/bild", {"name": name, "inhalt_b64": base64.b64encode(daten or self.png()).decode(), "schritte": schritte, "format": fmt, **mehr})

    def offen(self, r):
        import io
        from PIL import Image
        return Image.open(io.BytesIO(base64.b64decode(r["inhalt_b64"])))

    def test_geheimnis_auch_hier(self):
        self.assertEqual(self.post("/bild", {"name": "a.png", "inhalt_b64": "", "schritte": []}, geheim="falsch")[0], 401)
        self.assertEqual(self.post("/bild/kann", {}, geheim="falsch")[0], 401)

    def test_kann(self):
        s, r = self.post("/bild/kann", {})
        self.assertEqual(s, 200)
        self.assertTrue(r["bilder"])
        self.assertEqual(r["hintergrund_entfernen"], bool(HAT_HINTERGRUND))
        self.assertEqual(r["hochskalieren"], bool(HAT_SKALIEREN))

    def test_schritte_nacheinander(self):
        s, r = self.bild([
            {"art": "zuschneiden", "x": 0, "y": 0, "breite": 100, "hoehe": 100},
            {"art": "groesse", "breite": 50},
            {"art": "drehen", "grad": 90},
            {"art": "spiegeln", "richtung": "vertikal"},
            {"art": "helligkeit", "wert": 10},
            {"art": "kontrast", "wert": 10},
            {"art": "saettigung", "wert": -20},
            {"art": "weichzeichnen", "radius": 1},
            {"art": "schaerfen"},
            {"art": "automatisch"},
        ])
        self.assertEqual(s, 200, r)
        self.assertEqual((r["breite"], r["hoehe"], r["eingang"], r["mime"]), (50, 50, [200, 100], "image/png"))
        b = self.offen(r)
        self.assertEqual(b.size, (50, 50))
        # links war rot: bleibt nach allem überwiegend rot
        rot, gruen, blau = b.convert("RGB").getpixel((25, 25))
        self.assertGreater(rot, gruen + 60)
        self.assertGreater(rot, blau + 60)

    def test_drehen_im_uhrzeigersinn_und_frei(self):
        s, r = self.bild([{"art": "drehen", "grad": 90}])
        self.assertEqual((r["breite"], r["hoehe"]), (100, 200))
        # rote Hälfte war links → nach 90° im Uhrzeigersinn oben
        self.assertGreater(self.offen(r).convert("RGB").getpixel((50, 20))[0], 180)
        s, r = self.bild([{"art": "drehen", "grad": 45}])
        self.assertEqual(s, 200, r)
        self.assertTrue(r["transparenz"])
        self.assertEqual(self.offen(r).convert("RGBA").getpixel((0, 0))[3], 0)

    def test_graustufen_invertieren_formate(self):
        s, r = self.bild([{"art": "graustufen"}, {"art": "invertieren"}], fmt="jpg", qualitaet=80)
        self.assertEqual((s, r["mime"]), (200, "image/jpeg"))
        px = self.offen(r).convert("RGB").getpixel((150, 5))  # war weiß → schwarz
        self.assertLess(max(px), 30)
        s, r = self.bild([], fmt="webp")
        self.assertEqual((s, r["mime"]), (200, "image/webp"))
        self.assertEqual(self.offen(r).format, "WEBP")

    def test_jpg_ohne_durchsichtigkeit_sagt_es(self):
        s, r = self.bild([{"art": "drehen", "grad": 30}], fmt="jpg")
        self.assertEqual(s, 200, r)
        self.assertTrue(any("Durchsichtigkeit" in h for h in r["hinweise"]), r)
        self.assertEqual(self.offen(r).convert("RGB").getpixel((0, 0)), (255, 255, 255))

    def test_fehler_sind_ehrlich(self):
        self.assertEqual(self.bild([{"art": "zaubern"}])[0], 422)
        s, r = self.bild([{"art": "zuschneiden", "x": 500, "y": 0, "breite": 10, "hoehe": 10}])
        self.assertEqual(s, 422)
        self.assertIn("außerhalb", r["fehler"])
        self.assertEqual(self.bild([{"art": "groesse"}])[0], 422)
        self.assertEqual(self.bild([{"art": "groesse", "breite": "10"}])[0], 422)
        self.assertEqual(self.bild([{"art": "groesse", "breite": 12000, "hoehe": 12000}])[0], 422)
        self.assertEqual(self.bild([{"art": "hochskalieren", "faktor": 3}])[0], 422)
        s, r = self.bild([], daten=b"kein bild", name="x.png")
        self.assertEqual(s, 422)
        self.assertIn("Kein lesbares Bild", r["fehler"])
        self.assertEqual(self.bild([{"art": "graustufen"}] * 21)[0], 400)
        self.assertEqual(self.bild("drehen")[0], 400)
        self.assertEqual(self.bild([], fmt="exe")[0], 400)
        self.assertEqual(self.bild([], fmt="jpg", qualitaet=0)[0], 400)
        # nichts bleibt liegen
        self.assertEqual(os.listdir(os.path.join(self.arbeit, ".umwandeln")), [])

    def test_zu_viele_pixel(self):
        import io
        from PIL import Image
        p = io.BytesIO()
        Image.new("L", (6000, 4100), 0).save(p, "PNG")  # 24,6 MP, als Datei winzig
        s, r = self.bild([], daten=p.getvalue())
        self.assertEqual(s, 422)
        self.assertIn("zu groß", r["fehler"])

    def test_nach_bild_laeuft_umwandeln_weiter(self):
        # die Bildbearbeitung nimmt beide Plätze der Umwandlung – und gibt beide zurück
        for _ in range(3):
            self.assertEqual(self.bild([{"art": "zaubern"}])[0], 422)
            self.assertEqual(self.bild([])[0], 200)
        s, r = self.post("/umwandeln", {"name": "a.txt", "inhalt_b64": base64.b64encode(b"hallo").decode()})
        self.assertEqual((s, r["text"]), (200, "hallo"))

    @unittest.skipIf(HAT_HINTERGRUND, "Modell vorhanden – der Fall ohne Modell lässt sich hier nicht zeigen")
    def test_ohne_modell_ehrliche_meldung(self):
        s, r = self.bild([{"art": "hintergrund_entfernen"}])
        self.assertEqual(s, 422)
        self.assertRegex(r["fehler"], "fehlt im Rechenraum")

    @unittest.skipUnless(HAT_HINTERGRUND, "onnxruntime/u2netp fehlen (nur im Image)")
    def test_hintergrund_entfernen(self):
        import io
        from PIL import Image, ImageDraw
        b = Image.new("RGB", (400, 300), (245, 245, 240))
        z = ImageDraw.Draw(b)
        z.ellipse((130, 60, 270, 240), fill=(190, 40, 30))
        z.ellipse((170, 100, 230, 160), fill=(250, 220, 60))
        p = io.BytesIO()
        b.save(p, "PNG")
        s, r = self.bild([{"art": "hintergrund_entfernen"}], daten=p.getvalue())
        self.assertEqual(s, 200, r)
        self.assertTrue(r["transparenz"])
        a = self.offen(r).convert("RGBA").getchannel("A")
        self.assertEqual(a.size, (400, 300))
        self.assertLess(a.getpixel((5, 5)), 40)        # Ecke: Hintergrund weg
        self.assertGreater(a.getpixel((200, 200)), 200)  # Motiv bleibt

    @unittest.skipUnless(HAT_SKALIEREN, "onnxruntime/Real-ESRGAN fehlen (nur im Image)")
    def test_hochskalieren(self):
        s, r = self.bild([{"art": "hochskalieren", "faktor": 4}], daten=self.png(150, 140))
        self.assertEqual(s, 200, r)
        self.assertEqual((r["breite"], r["hoehe"]), (600, 560))
        b = self.offen(r).convert("RGB")
        self.assertGreater(b.getpixel((100, 300))[0], 180)  # links rot
        self.assertGreater(min(b.getpixel((590, 10))), 200)  # rechts oben weiß – auch über Kachelgrenzen hinweg
        s, r = self.bild([{"art": "hochskalieren"}], daten=self.png(60, 40, "RGBA"))
        self.assertEqual((s, r["breite"], r["hoehe"], r["transparenz"]), (200, 120, 80, True))
        s, r = self.bild([{"art": "hochskalieren", "faktor": 2}], daten=self.png(1200, 1000))
        self.assertEqual(s, 422)
        self.assertIn("zu groß", r["fehler"])


@unittest.skipUnless(hat_modul("PIL"), "Pillow fehlt")
class BildAusgabeGrenzeTest(RunnerTest):
    """E204: Das Ergebnis einer Bildbearbeitung ist begrenzt (im Betrieb 40 MB, hier klein gestellt)."""

    ENV_EXTRA = {"BILD_AUSGABE_MAX": "3000"}
    test_geheimnis_noetig = test_schreiben_befehl_lesen = test_zeitlimit_greift = test_pfade_bleiben_im_raum = None
    test_aufraeumen = test_seite_als_bild = None

    def test_zu_grosses_ergebnis_wird_nicht_geliefert(self):
        import io
        from PIL import Image
        p = io.BytesIO()
        Image.new("RGB", (8, 8), (10, 20, 30)).save(p, "PNG")
        klein = {"name": "a.png", "inhalt_b64": base64.b64encode(p.getvalue()).decode(), "schritte": [], "format": "png"}
        self.assertEqual(self.post("/bild", klein)[0], 200)
        # Rauschen lässt sich nicht komprimieren: 200×200 RGB ≈ 120 KB PNG
        p = io.BytesIO()
        Image.frombytes("RGB", (200, 200), os.urandom(200 * 200 * 3)).save(p, "PNG")
        s, r = self.post("/bild", {**klein, "inhalt_b64": base64.b64encode(p.getvalue()).decode()})
        self.assertEqual(s, 413, r)
        self.assertIn("zu groß", r["fehler"])
        self.assertNotIn("inhalt_b64", r)
        self.assertEqual(os.listdir(os.path.join(self.arbeit, ".umwandeln")), [])


if __name__ == "__main__":
    unittest.main()
