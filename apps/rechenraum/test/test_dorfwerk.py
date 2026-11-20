"""Tests für dorfwerk.py (E199) und /werkzeug im Runner: python3 -m unittest discover -s apps/rechenraum/test

Was ein fehlendes Paket braucht (pypdf, pandas, duckdb, segno, genanki, Graphviz), wird lokal übersprungen – im Image läuft
alles (rauchtest.py). Pakete aus einem eigenen Ordner: PYTHONPATH=… setzen, der Runner reicht ihn an dorfwerk.py weiter.
"""
import base64
import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HIER, "..", "runner.py")
GEHEIM = "test-geheimnis-dorfwerk"


def laden():
    spec = importlib.util.spec_from_file_location("dorfwerk", os.path.join(HIER, "..", "dorfwerk.py"))
    m = importlib.util.module_from_spec(spec)
    alt = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(m)
    finally:
        sys.dont_write_bytecode = alt
    return m


dw = laden()


def hat_modul(n):
    return dw.hat_modul(n)


def pdf_mit_seiten(n, breite=595, hoehe=842, mit_formular=False):
    """Kleines gültiges PDF mit n Seiten, jede mit dem Text „Seite i“ (Helvetica) – ohne Zusatzpakete."""
    objekte = {1: b"", 2: b""}
    kinder = []
    nr = 3
    font = nr
    objekte[font] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    nr += 1
    felder = []
    for i in range(1, n + 1):
        inhalt = b"BT /F1 24 Tf 72 700 Td (Seite %d) Tj ET" % i
        objekte[nr] = b"<< /Length %d >>\nstream\n" % len(inhalt) + inhalt + b"\nendstream"
        strom = nr
        nr += 1
        annots = b""
        if mit_formular and i == 1:
            objekte[nr] = (b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V () /Rect [72 600 300 620] /P %d 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>" % (nr + 2))
            felder.append(nr)
            nr += 1
            objekte[nr] = (b"<< /Type /Annot /Subtype /Widget /FT /Btn /T (Einverstanden) /V /Off /AS /Off /Rect [72 560 90 578] /P %d 0 R /F 4 "
                           b"/AP << /N << /Ja 1 0 R /Off 1 0 R >> >> >>" % (nr + 1))
            felder.append(nr)
            nr += 1
            annots = b" /Annots [" + b" ".join(b"%d 0 R" % f for f in felder) + b"]"
        objekte[nr] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R%s >>" % (
            breite, hoehe, font, strom, annots)
        kinder.append(nr)
        nr += 1
    akro = b""
    if felder:
        objekte[nr] = b"<< /Fields [" + b" ".join(b"%d 0 R" % f for f in felder) + b"] /DA (/Helv 0 Tf 0 g) >>"
        akro = b" /AcroForm %d 0 R" % nr
        nr += 1
    objekte[1] = b"<< /Type /Catalog /Pages 2 0 R%s >>" % akro
    objekte[2] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kinder) + b"] /Count %d >>" % len(kinder)
    aus = bytearray(b"%PDF-1.4\n")
    stellen = {}
    for i in range(1, nr):
        stellen[i] = len(aus)
        aus += b"%d 0 obj\n" % i + objekte[i] + b"\nendobj\n"
    xref = len(aus)
    aus += b"xref\n0 %d\n0000000000 65535 f \n" % nr
    for i in range(1, nr):
        aus += b"%010d 00000 n \n" % stellen[i]
    aus += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (nr, xref)
    return bytes(aus)


def seitentexte(pfad):
    from pypdf import PdfReader
    return [p.extract_text().strip() for p in PdfReader(pfad).pages]


class HilfenTest(unittest.TestCase):
    def test_seiten_liste(self):
        self.assertEqual(dw.seiten_liste("1-3,5", 6), [0, 1, 2, 4])
        self.assertEqual(dw.seiten_liste("4-", 6), [3, 4, 5])
        self.assertEqual(dw.seiten_liste("-2", 6), [0, 1])
        self.assertEqual(dw.seiten_liste("3-1", 6), [2, 1, 0])
        self.assertEqual(dw.seiten_liste("", 3), [0, 1, 2])
        self.assertEqual(dw.seiten_liste(" 2 , 2 ", 3), [1, 1])
        for falsch in ("7", "0", "2-9", "a", "1;2"):
            with self.assertRaises(dw.Fehler):
                dw.seiten_liste(falsch, 6)

    def test_ausgabe_name(self):
        self.assertEqual(dw.ausgabe_name("Abgabe Blatt 3.pdf", ".pdf", "x"), "Abgabe_Blatt_3.pdf")
        self.assertEqual(dw.ausgabe_name("../../etc/passwd", ".pdf", "x"), "passwd.pdf")
        self.assertEqual(dw.ausgabe_name("", ".svg", "diagramm"), "diagramm.svg")
        self.assertEqual(dw.ausgabe_name("bild.sh", ".png", "x"), "bild.sh.png")

    def test_pfade_bleiben_im_ordner(self):
        alt = os.getcwd()
        d = tempfile.mkdtemp()
        try:
            os.chdir(d)
            os.symlink("/etc", "raus")
            for falsch in ("../x", "/etc/passwd", "raus/passwd", "", "a/../../b"):
                with self.assertRaises(dw.Fehler):
                    dw.im_ordner(falsch)
            self.assertTrue(dw.im_ordner("a/b.pdf").endswith("/a/b.pdf"))
        finally:
            os.chdir(alt)
            shutil.rmtree(d)

    def test_anki_html(self):
        self.assertEqual(dw._anki_html("a < b\n**fett**"), "a &lt; b<br><b>fett</b>")
        self.assertEqual(dw._anki_html("Es gilt $x^2$ und $$\\int f$$"), "Es gilt \\(x^2\\) und \\[\\int f\\]")
        self.assertEqual(dw._anki_html("kostet 5 $ und 3 $"), "kostet 5 $ und 3 $")
        self.assertEqual(dw._stabile_id("x"), dw._stabile_id("x"))
        self.assertTrue((1 << 30) <= dw._stabile_id("Statistik") < (1 << 31))

    def test_sql_eine_anweisung(self):
        self.assertEqual(dw._sql_pruefen("SELECT 1;"), "SELECT 1")
        self.assertEqual(dw._sql_pruefen("SELECT 'a;b'"), "SELECT 'a;b'")
        with self.assertRaises(dw.Fehler):
            dw._sql_pruefen("SELECT 1; DROP TABLE x")

    def test_mermaid_wird_erkannt(self):
        alt = os.getcwd()
        d = tempfile.mkdtemp()
        try:
            os.chdir(d)
            r = dw.ausfuehren({"art": "diagramm", "quelle": "graph TD\n A-->B"})
            self.assertFalse(r["ok"])
            self.assertIn("Mermaid", r["fehler"])
            self.assertFalse(dw.ausfuehren({"art": "unbekannt"})["ok"])
        finally:
            os.chdir(alt)
            shutil.rmtree(d)

    @unittest.skipUnless(hat_modul("pypdf"), "pypdf fehlt")
    def test_wasserzeichen_seite_ist_gueltiges_pdf(self):
        from pypdf import PdfReader
        import io
        r = PdfReader(io.BytesIO(dw._wasserzeichen_pdf(595, 842, "ENTWURF – Übung")))
        self.assertEqual(len(r.pages), 1)
        self.assertIn("ENTWURF", r.pages[0].extract_text())


class WerkzeugTest(unittest.TestCase):
    """/werkzeug über den echten Runner (Kindprozess mit Grenzen)."""

    @classmethod
    def setUpClass(cls):
        cls.arbeit = tempfile.mkdtemp()
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        cls.port = s.getsockname()[1]
        s.close()
        env = dict(os.environ, ARBEIT_DIR=cls.arbeit, PORT=str(cls.port), RECHENRAUM_GEHEIMNIS=GEHEIM, ZEITLIMIT_S="60")
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
        shutil.rmtree(cls.arbeit, ignore_errors=True)

    def post(self, weg, daten, geheim=GEHEIM):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{weg}", data=json.dumps(daten).encode(), method="POST",
                                   headers={"content-type": "application/json", "x-rechenraum-geheimnis": geheim})
        try:
            with urllib.request.urlopen(r, timeout=90) as a:
                return a.status, json.loads(a.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def ablegen(self, raum, name, daten):
        s, _ = self.post("/schreiben", {"raum": raum, "pfad": name, "inhalt_b64": base64.b64encode(daten).decode()})
        self.assertEqual(s, 200)

    def werkzeug(self, raum, auftrag):
        s, r = self.post("/werkzeug", {"raum": raum, "auftrag": auftrag})
        self.assertEqual(s, 200, r)
        return r

    def pfad(self, raum, name):
        return os.path.join(self.arbeit, raum, name)

    def test_geheimnis_und_auftrag_noetig(self):
        self.assertEqual(self.post("/werkzeug", {"raum": "w0", "auftrag": {"art": "qr"}}, geheim="falsch")[0], 401)
        self.assertEqual(self.post("/werkzeug", {"raum": "w0"})[0], 400)
        r = self.werkzeug("w0", {"art": "pdf", "aktion": "info", "eingaben": ["../../etc/passwd"]})
        self.assertFalse(r["ok"])

    @unittest.skipUnless(hat_modul("pypdf"), "pypdf fehlt")
    def test_pdf_zusammenfuegen_teilen_ordnen_loeschen_drehen(self):
        self.ablegen("w1", "a.pdf", pdf_mit_seiten(3))
        self.ablegen("w1", "ein/b.pdf", pdf_mit_seiten(2))
        r = self.werkzeug("w1", {"art": "pdf", "aktion": "zusammenfuegen", "eingaben": ["a.pdf", "ein/b.pdf"], "name": "Abgabe gesamt"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["dateien"], ["Abgabe_gesamt.pdf"])
        self.assertEqual(seitentexte(self.pfad("w1", "Abgabe_gesamt.pdf")), ["Seite 1", "Seite 2", "Seite 3", "Seite 1", "Seite 2"])

        r = self.werkzeug("w1", {"art": "pdf", "aktion": "teilen", "eingaben": ["a.pdf"], "seiten": "1-2;3"})
        self.assertEqual(r["dateien"], ["a_teil1.pdf", "a_teil2.pdf"])
        self.assertEqual(seitentexte(self.pfad("w1", "a_teil2.pdf")), ["Seite 3"])

        r = self.werkzeug("w1", {"art": "pdf", "aktion": "seiten_ordnen", "eingaben": ["a.pdf"], "seiten": "3,1-2"})
        self.assertEqual(seitentexte(self.pfad("w1", r["dateien"][0])), ["Seite 3", "Seite 1", "Seite 2"])

        r = self.werkzeug("w1", {"art": "pdf", "aktion": "seiten_loeschen", "eingaben": ["a.pdf"], "seiten": "2"})
        self.assertEqual(seitentexte(self.pfad("w1", r["dateien"][0])), ["Seite 1", "Seite 3"])
        self.assertFalse(self.werkzeug("w1", {"art": "pdf", "aktion": "seiten_loeschen", "eingaben": ["a.pdf"], "seiten": "1-3"})["ok"])

        r = self.werkzeug("w1", {"art": "pdf", "aktion": "seiten_drehen", "eingaben": ["a.pdf"], "seiten": "2", "grad": 90})
        from pypdf import PdfReader
        self.assertEqual([p.rotation for p in PdfReader(self.pfad("w1", r["dateien"][0])).pages], [0, 90, 0])
        self.assertFalse(self.werkzeug("w1", {"art": "pdf", "aktion": "seiten_drehen", "eingaben": ["a.pdf"], "grad": 45})["ok"])

        r = self.werkzeug("w1", {"art": "pdf", "aktion": "info", "eingaben": ["a.pdf"]})
        self.assertIn("Seiten: 3", r["text"])
        self.assertIn("210 × 297 mm", r["text"])

        # Fehler ehrlich: Seite gibt es nicht, kein PDF, mehrere Dateien wo eine verlangt ist
        self.assertIn("gibt es nicht", self.werkzeug("w1", {"art": "pdf", "aktion": "teilen", "eingaben": ["a.pdf"], "seiten": "9"})["fehler"])
        self.ablegen("w1", "kaputt.pdf", b"kein pdf")
        self.assertFalse(self.werkzeug("w1", {"art": "pdf", "aktion": "info", "eingaben": ["kaputt.pdf"]})["ok"])
        self.assertFalse(self.werkzeug("w1", {"art": "pdf", "aktion": "teilen", "eingaben": ["a.pdf", "ein/b.pdf"]})["ok"])

    @unittest.skipUnless(hat_modul("pypdf"), "pypdf fehlt")
    def test_pdf_wasserzeichen_komprimieren(self):
        self.ablegen("w2", "a.pdf", pdf_mit_seiten(2))
        r = self.werkzeug("w2", {"art": "pdf", "aktion": "wasserzeichen", "eingaben": ["a.pdf"], "text": "ENTWURF", "seiten": "1"})
        self.assertTrue(r["ok"], r)
        texte = seitentexte(self.pfad("w2", r["dateien"][0]))
        self.assertIn("ENTWURF", texte[0])
        self.assertNotIn("ENTWURF", texte[1])
        self.assertFalse(self.werkzeug("w2", {"art": "pdf", "aktion": "wasserzeichen", "eingaben": ["a.pdf"]})["ok"])
        r = self.werkzeug("w2", {"art": "pdf", "aktion": "komprimieren", "eingaben": ["a.pdf"]})
        self.assertTrue(r["ok"], r)  # winzige Datei: ehrlich „kaum verkleinerbar“ oder eine kleinere Datei
        if r["dateien"]:
            self.assertLess(os.path.getsize(self.pfad("w2", r["dateien"][0])), os.path.getsize(self.pfad("w2", "a.pdf")))

    @unittest.skipUnless(hat_modul("pypdf"), "pypdf fehlt")
    def test_pdf_formular(self):
        self.ablegen("w3", "antrag.pdf", pdf_mit_seiten(1, mit_formular=True))
        r = self.werkzeug("w3", {"art": "pdf", "aktion": "formular_lesen", "eingaben": ["antrag.pdf"]})
        self.assertTrue(r["ok"], r)
        self.assertIn("Name (Text)", r["text"])
        self.assertIn("Einverstanden", r["text"])
        r = self.werkzeug("w3", {"art": "pdf", "aktion": "formular_ausfuellen", "eingaben": ["antrag.pdf"], "felder": {"Name": "Leif Muster", "Einverstanden": "ja"}})
        self.assertTrue(r["ok"], r)
        from pypdf import PdfReader
        f = PdfReader(self.pfad("w3", r["dateien"][0])).get_fields()
        self.assertEqual(f["Name"].get("/V"), "Leif Muster")
        self.assertEqual(f["Einverstanden"].get("/V"), "/Ja")
        r = self.werkzeug("w3", {"art": "pdf", "aktion": "formular_ausfuellen", "eingaben": ["antrag.pdf"], "felder": {"Gibtsnicht": "x"}})
        self.assertFalse(r["ok"])
        self.assertIn("Vorhanden: Name", r["fehler"])
        self.ablegen("w3", "ohne.pdf", pdf_mit_seiten(1))
        self.assertIn("Keine ausfüllbaren", self.werkzeug("w3", {"art": "pdf", "aktion": "formular_lesen", "eingaben": ["ohne.pdf"]})["text"])

    @unittest.skipUnless(shutil.which("dot"), "Graphviz fehlt")
    def test_diagramm(self):
        r = self.werkzeug("w4", {"art": "diagramm", "quelle": "digraph { Mathe -> Statistik; Statistik -> Daten }", "format": "svg", "name": "kurse"})
        self.assertTrue(r["ok"], r)
        with open(self.pfad("w4", "kurse.svg"), encoding="utf-8") as f:
            self.assertIn("Statistik", f.read())
        r = self.werkzeug("w4", {"art": "diagramm", "quelle": "digraph { A -> }"})
        self.assertFalse(r["ok"])
        self.assertIn("Graphviz", r["fehler"])

    @unittest.skipUnless(hat_modul("segno"), "segno fehlt")
    def test_qr(self):
        r = self.werkzeug("w5", {"art": "qr", "inhalt": "https://www.jku.at", "name": "link"})
        self.assertTrue(r["ok"], r)
        with open(self.pfad("w5", "link.png"), "rb") as f:
            self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")
        r = self.werkzeug("w5", {"art": "qr", "inhalt": "x", "format": "svg"})
        self.assertEqual(r["dateien"], ["qr-code.svg"])
        self.assertFalse(self.werkzeug("w5", {"art": "qr", "inhalt": ""})["ok"])

    @unittest.skipUnless(hat_modul("genanki"), "genanki fehlt")
    def test_anki(self):
        karten = [{"frage": "Was ist $e^{i\\pi}$?", "antwort": "-1"}, {"frage": "Ableitung von sin", "antwort": "cos\nweil …"}, {"frage": "leer", "antwort": ""}]
        r = self.werkzeug("w6", {"art": "anki", "fach": "Mathe 1", "karten": karten})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["dateien"], ["Mathe_1.apkg"])
        with zipfile.ZipFile(self.pfad("w6", "Mathe_1.apkg")) as z:
            d = tempfile.mkdtemp()
            z.extract("collection.anki2", d)
        con = sqlite3.connect(os.path.join(d, "collection.anki2"))
        felder = sorted(x[0] for x in con.execute("SELECT flds FROM notes"))
        con.close()
        shutil.rmtree(d)
        self.assertEqual(len(felder), 2)
        self.assertIn("cos<br>weil …", felder[0])
        self.assertIn("\\(e^{i\\pi}\\)", felder[1])
        # gleiche Karten → gleiche GUIDs (erneuter Import aktualisiert)
        r2 = self.werkzeug("w6b", {"art": "anki", "fach": "Mathe 1", "karten": karten[:1]})
        self.assertTrue(r2["ok"])
        self.assertFalse(self.werkzeug("w6", {"art": "anki", "fach": "Mathe 1", "karten": []})["ok"])

    @unittest.skipUnless(hat_modul("pandas") or hat_modul("duckdb"), "weder pandas noch duckdb")
    def test_daten(self):
        self.ablegen("w7", "ein/umsaetze.csv", "datum;betrag;kategorie\n2026-10-01;-12,5;Essen\n2026-10-02;-30;Essen\n2026-10-03;1200;Lohn\n".encode())
        self.ablegen("w7", "ein/2026 budget.csv", b"kategorie,limit\nEssen,200\nLohn,0\n")
        auftrag = {"art": "daten", "eingaben": ["ein/umsaetze.csv", "ein/2026 budget.csv"], "namen": ["umsaetze.csv", "2026 budget.csv"]}
        r = self.werkzeug("w7", auftrag)
        self.assertTrue(r["ok"], r)
        self.assertIn("Tabelle umsaetze", r["text"])
        self.assertIn("Tabelle t_2026_budget", r["text"])
        sql = "SELECT u.kategorie, COUNT(*) AS anzahl, b.\"limit\" FROM umsaetze u JOIN t_2026_budget b USING (kategorie) GROUP BY u.kategorie, b.\"limit\" ORDER BY u.kategorie"
        r = self.werkzeug("w7", {**auftrag, "sql": sql, "als_csv": True, "name": "auswertung"})
        self.assertTrue(r["ok"], r)
        self.assertIn("| Essen | 2 | 200 |", r["text"])
        self.assertEqual(r["dateien"], ["auswertung.csv"])
        with open(self.pfad("w7", "auswertung.csv"), encoding="utf-8") as f:
            self.assertEqual(f.read().splitlines()[0], "kategorie,anzahl,limit")
        r = self.werkzeug("w7", {**auftrag, "sql": "SELECT * FROM gibtsnicht"})
        self.assertFalse(r["ok"])
        self.assertIn("SQL-Fehler", r["fehler"])
        self.assertFalse(self.werkzeug("w7", {**auftrag, "sql": "SELECT 1; SELECT 2"})["ok"])

    @unittest.skipUnless(hat_modul("pandas") or hat_modul("duckdb"), "weder pandas noch duckdb")
    def test_daten_deutsche_zahlen(self):
        """Bank-Export: „;“, Komma als Dezimalzeichen, Punkt als Tausendertrenner → echte Zahlen."""
        self.ablegen("w9", "konto.csv", "Datum;Betrag;Text\n01.10.2026;-1.234,50;Miete\n02.10.2026;20,00;Rückzahlung\n03.10.2026;7,5;Kaffee\n".encode())
        r = self.werkzeug("w9", {"art": "daten", "eingaben": ["konto.csv"], "sql": "SELECT SUM(Betrag) AS summe, MIN(Betrag) AS kleinster FROM konto"})
        self.assertTrue(r["ok"], r)
        self.assertIn("| -1207 | -1234.5 |", r["text"])

    @unittest.skipUnless(hat_modul("duckdb"), "duckdb fehlt")
    def test_daten_duckdb_liest_keine_fremden_dateien(self):
        geheim = os.path.join(self.arbeit, "anderer-raum", "geheim.csv")
        os.makedirs(os.path.dirname(geheim), exist_ok=True)
        with open(geheim, "w") as f:
            f.write("a\ngeheim\n")
        self.ablegen("w8", "x.csv", b"a\n1\n")
        r = self.werkzeug("w8", {"art": "daten", "eingaben": ["x.csv"], "sql": f"SELECT * FROM read_csv_auto('{geheim}')"})
        self.assertFalse(r["ok"])
        self.assertNotIn("geheim\n", json.dumps(r))
        r = self.werkzeug("w8", {"art": "daten", "eingaben": ["x.csv"], "sql": f"COPY x TO '{self.arbeit}/w8/raus.csv'"})
        self.assertFalse(r["ok"])
        self.assertFalse(os.path.exists(os.path.join(self.arbeit, "w8", "raus.csv")))


if __name__ == "__main__":
    unittest.main()
