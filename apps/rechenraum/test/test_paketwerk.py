"""E230 – Paketwerk: Konsole im Modus paketwerk + Zusatzpakete im Rechenraum (nur Standardbibliothek)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

from test_runner import GEHEIM, RUNNER, freier_port


def starten(env_extra):
    port = freier_port()
    env = dict(os.environ, PORT=str(port), RECHENRAUM_GEHEIMNIS=GEHEIM, ZEITLIMIT_S="5", **env_extra)
    p = subprocess.Popen([sys.executable, RUNNER], env=env)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/gesundheit", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    return p, port


def post(port, weg, daten, geheim=GEHEIM):
    r = urllib.request.Request(
        f"http://127.0.0.1:{port}{weg}", data=json.dumps(daten).encode(), method="POST",
        headers={"content-type": "application/json", **({"x-rechenraum-geheimnis": geheim} if geheim else {})},
    )
    try:
        with urllib.request.urlopen(r, timeout=90) as a:
            return a.status, json.loads(a.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def site_ordner(basis):
    v = sys.version_info
    return os.path.join(basis, "lib", f"python{v.major}.{v.minor}", "site-packages")


class PaketwerkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pakete = tempfile.mkdtemp()
        cls.p, cls.port = starten({"RECHENRAUM_MODUS": "paketwerk", "RECHENRAUM_PAKETE": cls.pakete, "KONSOLE_ZEIT_S": "3"})

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()
        shutil.rmtree(cls.pakete, ignore_errors=True)

    def warten(self, jid):
        aus, ab = "", 0
        for _ in range(200):
            s, st = post(self.port, "/konsole/stand", {"id": jid, "ab": ab})
            self.assertEqual(s, 200, st)
            aus += st["ausgabe"]
            ab = st["bis"]
            if st["fertig"]:
                return aus, st
            time.sleep(0.05)
        self.fail("Befehl wurde nicht fertig")

    def test_geheimnis_noetig(self):
        self.assertEqual(post(self.port, "/konsole/start", {"befehl": "true"}, geheim=None)[0], 401)
        self.assertEqual(post(self.port, "/konsole/start", {"befehl": "true"}, geheim="falsch")[0], 401)

    def test_nur_konsole_kein_rechenraum(self):
        # im Paketwerk gibt es keine Rechenraum-Wege (kein /befehl, kein /werkzeug …)
        for weg in ("/befehl", "/werkzeug", "/umwandeln", "/schreiben"):
            self.assertEqual(post(self.port, weg, {"raum": "a", "befehl": "true"})[0], 404, weg)

    def test_befehl_ausgabe_und_code(self):
        s, r = post(self.port, "/konsole/start", {"befehl": "echo hallo; echo $PYTHONUSERBASE; echo $PIP_USER; pwd; exit 3"})
        self.assertEqual(s, 200, r)
        aus, st = self.warten(r["id"])
        zeilen = aus.split()
        self.assertEqual(zeilen[0], "hallo")
        self.assertEqual(zeilen[1], self.pakete)  # pip --user schreibt NUR hierhin
        self.assertEqual(zeilen[2], "1")
        self.assertEqual(os.path.realpath(zeilen[3]), os.path.realpath(self.pakete))
        self.assertEqual(st["code"], 3)

    def test_ausgabe_stueckweise(self):
        s, r = post(self.port, "/konsole/start", {"befehl": "echo eins; sleep 0.4; echo zwei"})
        self.assertEqual(s, 200)
        time.sleep(0.2)
        s, erst = post(self.port, "/konsole/stand", {"id": r["id"], "ab": 0})
        self.assertIn("eins", erst["ausgabe"])
        self.assertFalse(erst["fertig"])
        aus, st = self.warten(r["id"])
        # ab = bis liefert nur Neues
        s, rest = post(self.port, "/konsole/stand", {"id": r["id"], "ab": erst["bis"]})
        self.assertEqual(rest["ausgabe"].strip(), "zwei")
        self.assertEqual(st["code"], 0)

    def test_einer_zur_zeit_und_abbrechen(self):
        s, r = post(self.port, "/konsole/start", {"befehl": "sleep 30"})
        self.assertEqual(s, 200)
        s, zweit = post(self.port, "/konsole/start", {"befehl": "true"})
        self.assertEqual(s, 409, zweit)
        self.assertEqual(post(self.port, "/konsole/abbrechen", {"id": "falsch"})[1], {"ok": False})
        self.assertEqual(post(self.port, "/konsole/abbrechen", {"id": r["id"]})[1], {"ok": True})
        _, st = self.warten(r["id"])
        self.assertNotEqual(st["code"], 0)
        self.assertEqual(post(self.port, "/konsole/stand", {"id": "gibtsnicht", "ab": 0})[0], 404)

    def test_zeitgrenze(self):
        s, r = post(self.port, "/konsole/start", {"befehl": "sleep 20"})
        self.assertEqual(s, 200)
        t = time.time()
        aus, st = self.warten(r["id"])
        self.assertLess(time.time() - t, 10)
        self.assertIn("abgebrochen", aus)
        self.assertNotEqual(st["code"], 0)

    def test_leer_und_zu_lang(self):
        self.assertEqual(post(self.port, "/konsole/start", {"befehl": "  "})[0], 400)
        self.assertEqual(post(self.port, "/konsole/start", {"befehl": "x" * 4001})[0], 400)

    def test_paketliste(self):
        # ein „installiertes“ Paket im User-Site des Paketordners (wie pip --user es ablegt)
        site = site_ordner(self.pakete)
        os.makedirs(os.path.join(site, "dorftest_paket-1.2.3.dist-info"), exist_ok=True)
        with open(os.path.join(site, "dorftest_paket-1.2.3.dist-info", "METADATA"), "w") as f:
            f.write("Metadata-Version: 2.1\nName: dorftest-paket\nVersion: 1.2.3\n")
        with open(os.path.join(site, "dorftest_paket-1.2.3.dist-info", "RECORD"), "w") as f:
            f.write("")
        s, r = post(self.port, "/konsole/pakete", {})
        self.assertEqual(s, 200, r)
        self.assertIn({"name": "dorftest-paket", "version": "1.2.3"}, r["pakete"])


class RechenraumNutztPaketeTest(unittest.TestCase):
    """Der Rechenraum findet, was im Paketwerk installiert wurde – Befehle UND Werkzeuge."""

    @classmethod
    def setUpClass(cls):
        cls.pakete = tempfile.mkdtemp()
        site = site_ordner(cls.pakete)
        os.makedirs(site)
        with open(os.path.join(site, "dorftest_modul.py"), "w") as f:
            f.write("WERT = 42\n")
        cls.arbeit = tempfile.mkdtemp()
        cls.p, cls.port = starten({"ARBEIT_DIR": cls.arbeit, "RECHENRAUM_PAKETE": cls.pakete})

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()
        shutil.rmtree(cls.pakete, ignore_errors=True)
        shutil.rmtree(cls.arbeit, ignore_errors=True)

    def test_import_im_befehl(self):
        s, r = post(self.port, "/befehl", {"raum": "pw", "befehl": "python3 -c 'import dorftest_modul; print(dorftest_modul.WERT)'"})
        self.assertEqual(s, 200, r)
        self.assertEqual(r["code"], 0, r)
        self.assertIn("42", r["ausgabe"])

    def test_keine_konsole_im_rechenraum(self):
        self.assertIn(post(self.port, "/konsole/start", {"befehl": "true"})[0], (400, 404))


if __name__ == "__main__":
    unittest.main()
