"""Tests für den Rechenraum-Runner (nur Standardbibliothek): python3 -m unittest discover -s apps/rechenraum/test"""
import base64
import json
import os
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


class RunnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.arbeit = tempfile.mkdtemp()
        cls.port = freier_port()
        env = dict(os.environ, ARBEIT_DIR=cls.arbeit, PORT=str(cls.port), RECHENRAUM_GEHEIMNIS=GEHEIM, ZEITLIMIT_S="2")
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


if __name__ == "__main__":
    unittest.main()
