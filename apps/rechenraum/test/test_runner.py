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
    @classmethod
    def setUpClass(cls):
        cls.arbeit = tempfile.mkdtemp()
        cls.port = freier_port()
        env = dict(os.environ, ARBEIT_DIR=cls.arbeit, PORT=str(cls.port), RECHENRAUM_GEHEIMNIS=GEHEIM, ZEITLIMIT_S="2", UMWANDELN_ZEITLIMIT_S="40")
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


if __name__ == "__main__":
    unittest.main()
