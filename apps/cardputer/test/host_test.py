"""Prüft die Agentendorf-App des Cardputers am PC: derselbe C++-Code wie auf dem Gerät (build/dorf-host),
gesteuert über Tastendrücke, gegen den Testserver (testserver.py), mit Bildschirmfotos nach docs/bilder/.

Aufruf:  test/host-test.sh   (baut vorher)   oder   python3 test/host_test.py build/dorf-host
"""
from __future__ import annotations

import struct
import subprocess
import sys
import zlib
from pathlib import Path

import testserver

ROOT = Path(__file__).resolve().parents[1]
BILDER = ROOT / "docs" / "bilder"
W, H = 240, 135


FOTOS: dict[str, bytes] = {}      # Name -> RGB-Pixel (für die Übersicht)


def png(ziel: Path, breite: int, hoehe: int, rgb: bytes) -> None:
    zeilen = bytearray()
    for y in range(hoehe):
        zeilen += b"\x00" + rgb[y * breite * 3:(y + 1) * breite * 3]

    def stueck(art: bytes, daten: bytes) -> bytes:
        return struct.pack(">I", len(daten)) + art + daten + struct.pack(">I", zlib.crc32(art + daten))

    ziel.write_bytes(b"\x89PNG\r\n\x1a\n" + stueck(b"IHDR", struct.pack(">IIBBBBB", breite, hoehe, 8, 2, 0, 0, 0))
                     + stueck(b"IDAT", zlib.compress(bytes(zeilen), 9)) + stueck(b"IEND", b""))


def png_schreiben(ppm: Path, ziel: Path, faktor: int = 2) -> None:
    """Bildschirmfoto (PPM vom Host-Programm) als PNG, doppelt so groß wie das Display (240×135)."""
    roh = ppm.read_bytes()
    kopf = b"P6\n%d %d\n255\n" % (W, H)
    assert roh.startswith(kopf), "kein PPM"
    px = roh[len(kopf):]
    FOTOS[ziel.stem] = px
    gross = bytearray()
    for y in range(H):
        zeile = bytearray()
        for x in range(W):
            zeile += px[(y * W + x) * 3:(y * W + x) * 3 + 3] * faktor
        gross += zeile * faktor
    png(ziel, W * faktor, H * faktor, bytes(gross))


def uebersicht(namen: list[str], spalten: int = 3, rand: int = 10) -> None:
    """Alle wichtigen Ansichten auf einem Bild (Originalgröße, dunkler Rand)."""
    reihen = (len(namen) + spalten - 1) // spalten
    bw, bh = rand + spalten * (W + rand), rand + reihen * (H + rand)
    bild = bytearray(bytes((0x1E, 0x2A, 0x33)) * (bw * bh))
    for i, name in enumerate(namen):
        x0, y0 = rand + (i % spalten) * (W + rand), rand + (i // spalten) * (H + rand)
        px = FOTOS[name]
        for y in range(H):
            ziel = ((y0 + y) * bw + x0) * 3
            bild[ziel:ziel + W * 3] = px[y * W * 3:(y + 1) * W * 3]
    png(BILDER / "uebersicht.png", bw, bh, bytes(bild))


class Geraet:
    def __init__(self, programm: str, dorf: testserver.Dorf) -> None:
        self.p = subprocess.Popen([programm], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
        self.dorf = dorf
        self.now = 1000
        self.ausgaben: list[str] = []      # alles, was das Gerät gemeldet hat (PLAY, HTTP ...)

    def cmd(self, zeile: str) -> list[str]:
        assert self.p.stdin and self.p.stdout
        self.p.stdin.write(zeile + "\n")
        self.p.stdin.flush()
        out = []
        while True:
            z = self.p.stdout.readline()
            if z == "":
                raise RuntimeError("Host-Programm beendet (Absturz?) bei: " + zeile)
            z = z.rstrip("\n")
            if z == ".":
                break
            out.append(z)
        self.ausgaben += out
        return out

    def lauf(self, ms: int, schritt: int = 250) -> None:
        """Zeit vergehen lassen - am Gerät und (gleich schnell) am Server."""
        for _ in range(0, ms, schritt):
            self.now += schritt
            self.dorf.zeit_ms += schritt
            self.cmd(f"T {self.now}")

    def taste(self, *namen: str) -> None:
        for n in namen:
            self.cmd(f"K {n}")
            self.lauf(250)

    def tippe(self, text: str) -> None:
        self.cmd("S " + text)
        self.lauf(250)

    def zeichen(self, c: str) -> None:
        self.cmd("C " + c)
        self.lauf(250)

    def text(self) -> list[str]:
        out = self.cmd("TEXT")
        return out[out.index("TEXT-BEGIN") + 1:out.index("TEXT-END")]

    def sieht(self, teil: str) -> bool:
        return any(teil in t for t in self.text())

    def warte_auf(self, teil: str, ms: int = 8000) -> bool:
        for _ in range(0, ms, 250):
            if self.sieht(teil):
                return True
            self.lauf(250)
        return self.sieht(teil)

    def foto(self, name: str) -> None:
        ppm = ROOT / "build" / (name + ".ppm")
        self.cmd(f"SHOT {ppm}")
        png_schreiben(ppm, BILDER / (name + ".png"))
        ppm.unlink()

    def einst(self, key: str) -> str:
        return self.cmd(f"EINST {key}")[0][6:]

    def datei(self, name: str) -> str:
        out = self.cmd(f"DATEI {name}")
        return "\n".join(out[out.index("DATEI-BEGIN") + 1:out.index("DATEI-END")])

    def waehle(self, zeile: str, hoechstens: int = 20) -> None:
        """Erst ganz nach oben, dann mit Pfeil runter bis zur Zeile, die mit diesem Text beginnt."""
        for _ in range(hoechstens):
            self.cmd("K up")
        for _ in range(hoechstens):
            if self.auswahl().startswith(zeile):
                return
            self.cmd("K down")
        raise AssertionError(f"Zeile „{zeile}“ nicht gefunden: {self.text()}")

    def auswahl(self) -> str:
        out = self.cmd("AUSWAHL")
        return out[0][8:] if out else ""


FEHLER: list[str] = []
ANZAHL = 0


def pruefe(ok: bool, was: str, mehr: object = "") -> None:
    global ANZAHL
    ANZAHL += 1
    if ok:
        print("  ok   ", was)
    else:
        print("  FEHLER", was, mehr)
        FEHLER.append(was)


def main() -> int:
    programm = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "build" / "dorf-host")
    BILDER.mkdir(parents=True, exist_ok=True)
    server, dorf = testserver.starten()
    adresse = f"http://127.0.0.1:{server.server_address[1]}"
    g = Geraet(programm, dorf)
    g.cmd("WLAN Leifs iPhone|-48|hotspot123;FRITZ!Box 7590|-67|geheim;eduroam|-81|x;Bahnhof frei|-72|-")

    print("Startmenü")
    g.lauf(250)
    pruefe(g.sieht("Fernbedienung") and g.sieht("Agentendorf") and g.sieht("HaloOS"), "Startmenü zeigt 1 Fernbedienung / 2 Agentendorf")
    pruefe(g.sieht("To-dos, Bürgermeister, Kirchturm"), "Untertitel von Agentendorf")
    g.foto("01-startmenue")
    g.cmd("REMOTESHOT " + str(ROOT / "build" / "fb.ppm") + " 0")
    png_schreiben(ROOT / "build" / "fb.ppm", BILDER / "13-fernbedienung.png")
    (ROOT / "build" / "fb.ppm").unlink()
    out = g.cmd("C 1")
    pruefe("REMOTE" in out, "Taste 1 startet die Fernbedienung (Bluetooth)", out)
    pruefe(g.einst("modus") == "fb", "Merker: zuletzt Fernbedienung")
    g.cmd("NEUSTART")

    print("Ersteinrichtung: WLAN")
    out = g.cmd("C 2")
    pruefe("DORF" in out, "Taste 2 startet das Agentendorf (WLAN an)", out)
    g.lauf(500)
    pruefe(g.sieht("WLAN") and g.sieht("Leifs iPhone") and g.sieht("FRITZ!Box 7590"), "ohne gespeichertes Netz: WLAN-Liste mit Suche", g.text())
    pruefe(g.sieht("stark") and g.sieht("offen"), "Liste zeigt Signalstärke und offene Netze")
    g.foto("08-wlan-liste")
    g.waehle("Leifs iPhone")
    g.taste("enter")
    pruefe(g.sieht("WLAN-Passwort"), "Passwort-Eingabe erscheint")
    g.tippe("falsch")
    g.taste("enter")
    pruefe(g.warte_auf("Keine Verbindung"), "falsches Passwort wird gemeldet", g.text())
    pruefe(g.einst("wlan") == "", "falsches Passwort wird nicht gespeichert")
    g.lauf(2500)
    g.waehle("Leifs iPhone")
    g.taste("enter")
    g.tippe("hotspot123")
    g.foto("08b-wlan-passwort")
    g.taste("enter")
    g.lauf(500)
    pruefe("Leifs iPhone\thotspot123" in g.einst("wlan"), "Netz und Passwort im Speicher (NVS)", g.einst("wlan"))

    print("Koppeln")
    pruefe(g.sieht("Koppeln") and g.sieht("Dorf-Adresse") and g.sieht("6 Ziffern"), "nach dem WLAN kommt Koppeln", g.text())
    g.taste("enter")
    g.tippe("https://Dorf.Beispiel.de/")
    g.taste("enter")
    pruefe(g.sieht("dorf.beispiel.de"), "Adresse wird bereinigt (https, Groß/Klein, Schrägstrich)", g.text())
    g.taste("enter")
    pruefe(g.sieht("6-stelliger Code"), "nach der Adresse steht die Auswahl auf dem Code")
    g.tippe("123456")
    g.taste("enter")
    g.foto("09-koppeln")
    # jetzt die echte Testadresse
    g.waehle("Dorf-Adresse")
    g.taste("enter")
    for _ in range(20):
        g.cmd("K del")
    g.tippe(adresse)
    g.taste("enter")
    g.taste("enter")
    g.tippe("000000")
    g.taste("enter", "enter")
    pruefe(g.warte_auf("Code falsch"), "falscher Code: Meldung vom Dorf", g.text())
    pruefe(g.einst("token") == "", "kein Schlüssel nach falschem Code")
    g.lauf(2500)
    g.waehle("Code")
    g.taste("enter")
    g.tippe("123456")
    g.taste("enter", "enter")
    pruefe(g.warte_auf("Gekoppelt"), "richtiger Code: gekoppelt", g.text())
    token = g.einst("token")
    pruefe(len(token) == 64 and token in dorf.tokens, "Schlüssel (64 Zeichen) im Speicher", token)
    k = dorf.anfragen("POST", "/koppeln")[-1]
    pruefe(k[2] == {"code": "123456", "name": "Cardputer"} and k[3] is None, "Koppeln schickt Code und Name, ohne X-Vorgang", k)

    print("Agentendorf-Startseite")
    g.lauf(3000)
    pruefe(g.sieht("Agentendorf") and g.sieht("5 offen"), "Startseite zeigt offene To-dos aus /start", g.text())
    pruefe(g.sieht("14:00 Mathe VO"), "nächster Termin in der Kalender-Zeile")
    pruefe(g.sieht("13:55"), "Uhr kommt vom Dorf (zeit/offsetMin)", g.text())
    g.foto("02-agentendorf")
    g.waehle("Freigaben")
    pruefe(g.sieht("1 wartet"), "Freigaben mit Zähler", g.text())
    g.waehle("Einstellungen")
    pruefe(g.sieht("2 offen") and g.sieht("Leifs iPhone"), "offene Gewohnheiten, WLAN-Name bei Einstellungen", g.text())
    g.foto("02b-agentendorf-unten")

    print("To-dos")
    g.waehle("To-dos")
    g.taste("enter")
    pruefe(g.warte_auf("! Mathe Übung 3") and g.sieht("Miete überweisen"), "To-do-Liste geladen", g.text())
    pruefe(g.sieht("heute") and g.sieht("morgen") and g.sieht("0/1"), "Fälligkeiten als heute/morgen, Teilschritte als 0/1")
    g.foto("03-todos")
    g.zeichen("M")
    g.tippe("ilch kaufen morgen !")
    pruefe(g.sieht("Neues To-do") and g.sieht("Milch kaufen morgen !"), "Tippen öffnet „Neues To-do“ mit dem ersten Buchstaben")
    g.foto("03b-todo-neu")
    g.taste("enter")
    g.lauf(1500)
    neu = [t for t in dorf.todos if t["titel"] == "Milch kaufen"]
    pruefe(len(neu) == 1 and neu[0]["wichtig"] and neu[0]["faellig"] == testserver.tag(1), "To-do beim Dorf angelegt (Text gedeutet)", dorf.todos[-1])
    p = dorf.anfragen("POST", "/api/geraet/todos")[-1]
    pruefe(p[2] == {"text": "Milch kaufen morgen !"} and p[3] and 8 <= len(p[3]) <= 64, "Anlegen schickt den Text und eine X-Vorgang-Kennung", p)
    g.waehle("! Milch kaufen")
    pruefe(g.sieht("! Milch kaufen"), "neues To-do steht in der Liste", g.text())
    g.waehle("! Mathe Übung 3 abgeben")
    g.taste("right")
    pruefe(g.sieht("Teilschritte 1/3") and g.sieht("Aufgabe 2 rechnen"), "Details mit Teilschritten", g.text())
    g.lauf(2500)
    g.foto("03c-todo-details")
    g.waehle("Aufgabe 2 rechnen")
    g.taste("enter")
    g.lauf(1000)
    pruefe(dorf.todos[0]["schritte"][1]["erledigt"] is True and g.sieht("Teilschritte 2/3"), "Teilschritt abgehakt (Dorf + Anzeige)")
    g.taste("esc")
    g.waehle("Miete überweisen")
    g.taste("enter")
    g.lauf(1500)
    pruefe(dorf.todos[1]["erledigt"] is True, "Enter hakt das To-do beim Dorf ab")
    pruefe(not g.sieht("Miete überweisen"), "abgehaktes To-do verschwindet nach dem Neuladen aus „offen“", g.text())
    g.waehle("Geschenk für Oma besorgen")
    g.taste("del")
    pruefe(g.sieht("To-do löschen?"), "Löschen fragt nach")
    g.taste("enter")
    g.lauf(1500)
    pruefe(all(t["id"] != "t3" for t in dorf.todos) and not g.sieht("Geschenk"), "gelöscht (Dorf + Anzeige)", g.text())
    g.taste("tab")
    g.lauf(1000)
    pruefe(g.sieht("To-dos heute") and g.sieht("Fahrrad") and not g.sieht("Zusammenfassung"), "Tab wechselt zur Ansicht „heute“", g.text())
    g.taste("esc")

    print("Bürgermeister")
    g.waehle("Bürgermeister")
    g.taste("enter")
    pruefe(g.warte_auf("Wochenplan") and g.sieht("Neues Gespräch"), "Gesprächsliste", g.text())
    g.foto("04a-buergermeister-liste")
    g.zeichen("W")
    g.tippe("as steht bis Montag an?")
    g.taste("enter")
    g.lauf(500)
    pruefe(g.sieht("Was steht bis Montag an?") and g.sieht("denkt nach"), "Frage wird gezeigt, Bürgermeister „denkt nach“", g.text())
    g.foto("04b-buergermeister-denkt")
    vorher = dorf.bm_polls
    pruefe(g.warte_auf("für das Exposé am Sonntag", 12000), "Antwort kommt nach dem Pollen", g.text())
    pruefe(dorf.bm_polls - vorher >= 1 and dorf.bm_polls >= 2, "mehrfach nachgefragt, solange „laeuft“", dorf.bm_polls)
    pruefe(not g.sieht("denkt nach"), "nach „fertig“ kein „denkt nach“ mehr")
    stand = dorf.bm_polls
    g.lauf(9000)
    pruefe(dorf.bm_polls == stand, "nach „fertig“ wird nicht weiter gepollt", (stand, dorf.bm_polls))
    g.foto("04-buergermeister")
    g.taste("up", "up", "up", "up", "up", "up", "up", "up", "up", "up")
    pruefe(g.sieht("Was steht bis Montag an?") and g.sieht("Morgen ist Samstag, der 21."), "mit ↑ zum Anfang blättern", g.text())
    chat = [c for c in dorf.chats if c != "c1"][0]
    g.taste("enter")
    g.tippe("Ja, bitte eintragen")
    g.taste("enter")
    g.lauf(500)
    p = dorf.anfragen("POST", "/buergermeister")[-1]
    pruefe(p[2] == {"text": "Ja, bitte eintragen", "chatId": chat}, "Weiterreden im selben Gespräch (chatId)", p)
    g.lauf(9000)
    pruefe(dorf.chats[chat]["status"] == "fertig" and len(dorf.chats[chat]["nachrichten"]) == 4 and not g.sieht("denkt nach"), "zweite Antwort kommt", g.text())
    g.taste("esc")
    g.lauf(1000)
    pruefe(g.sieht("Was steht bis Montag an?"), "neues Gespräch steht in der Liste", g.text())
    g.taste("esc")

    print("Kirchturm")
    g.waehle("Kirchturm")
    g.taste("enter")
    pruefe(g.warte_auf("Keine Uhr läuft"), "Kirchturm ohne laufende Uhr", g.text())
    g.foto("05a-kirchturm-leer")
    g.taste("enter")
    pruefe(g.warte_auf("Fokus · Runde 1"), "Enter startet einen Pomodoro", g.text())
    g.lauf(5000)
    zeit = [t for t in g.text() if t.startswith("24:")]
    pruefe(bool(zeit) and "24:5" in zeit[0], "Restzeit zählt lokal herunter", g.text())
    g.foto("05-kirchturm-pomodoro")
    g.taste("enter")
    pruefe(g.warte_auf("pausiert"), "Enter pausiert", g.text())
    pruefe(dorf.laufend[0]["pausiert"] is True, "Pause ist beim Dorf angekommen")
    g.taste("enter")
    g.lauf(1500)
    pruefe(dorf.laufend[0]["pausiert"] is False and not g.sieht("pausiert"), "Enter macht weiter")
    g.taste("right")
    pruefe(g.warte_auf("Kurze Pause"), "→ springt zur nächsten Phase", g.text())
    g.zeichen("e")
    pruefe(g.sieht("Lange Pause nach") and g.sieht("25 min"), "Pomodoro-Einstellungen", g.text())
    g.taste("right")
    g.lauf(2500)
    g.foto("05b-kirchturm-einstellungen")
    g.taste("esc")
    g.lauf(1500)
    pruefe(dorf.pomodoro["fokus"] == 30, "geänderte Fokuszeit beim Dorf gespeichert", dorf.pomodoro)
    g.taste("del", "enter")
    g.lauf(1500)
    pruefe(not dorf.laufend, "Del + Rückfrage stoppt die Uhr")
    g.zeichen("w")
    g.tippe("730")
    g.taste("enter")
    g.lauf(1500)
    pruefe(g.sieht("Wecker") and g.sieht("07:30"), "Wecker gestellt und groß angezeigt", g.text())
    g.taste("del", "enter")
    g.lauf(1000)
    g.zeichen("t")
    g.tippe("1 Tee")
    g.taste("enter")
    g.lauf(1500)
    pruefe(g.sieht("Timer · Tee") and dorf.laufend and dorf.laufend[0]["art"] == "timer", "Timer mit Namen gestellt", g.text())
    g.taste("esc")             # Kirchturm zu, zurück auf die Startseite: der Wächter läuft im Hintergrund
    g.waehle("To-dos")
    g.taste("enter")
    g.lauf(40000, 500)
    pruefe(g.cmd("BRIGHT") == ["BRIGHT 25"], "Bildschirm ist nach 30 s gedimmt")
    g.ausgaben.clear()
    g.lauf(22000, 500)
    pruefe(g.sieht("Kirchturm läutet") and g.sieht("Tee"), "Klingeln erscheint über der To-do-Liste (Wächter im Hintergrund)", g.text())
    pruefe(any(a.startswith("PLAY") for a in g.ausgaben), "Ton wird gespielt", g.ausgaben[-5:])
    pruefe(g.cmd("BRIGHT") == ["BRIGHT 100"], "Bildschirm wird hell")
    g.foto("05c-kirchturm-laeutet")
    g.taste("enter")
    g.lauf(2000)
    pruefe(not dorf.klingelt and not g.sieht("Kirchturm läutet"), "eine Taste quittiert (aktion leise)", dorf.klingelt)
    pruefe(dorf.anfragen("POST", "/kirchturm")[-1][2].get("aktion") == "leise", "leise wurde geschickt")
    pruefe(g.sieht("To-dos"), "die Taste hat sonst nichts ausgelöst")
    g.taste("esc")

    print("Kalender")
    g.waehle("Kalender")
    g.taste("enter")
    pruefe(g.warte_auf("Mathe VO") and g.sieht("Heute · Fr, 20. Nov") and g.sieht("Morgen · Sa, 21. Nov"), "Termine nach Tagen gruppiert", g.text())
    g.foto("06-kalender")
    g.waehle("Neuer Termin")
    g.taste("enter")
    g.tippe("Lerngruppe")
    g.taste("enter")
    g.tippe("2411")
    g.taste("enter")
    pruefe(g.sieht("Di, 24. Nov 2026"), "Datum tippen (2411)", g.text())
    g.foto("06b-kalender-datum")
    g.taste("enter")
    g.tippe("1530")
    g.taste("enter")
    g.lauf(2000)
    pruefe(dorf.termine_neu == [{"titel": "Lerngruppe", "datum": "2026-11-24", "zeit": "15:30", "dauerMin": 60}], "Termin beim Dorf angelegt", dorf.termine_neu)
    g.waehle("Lerngruppe")
    pruefe(g.sieht("Di, 24. Nov") and g.sieht("15:30"), "neuer Termin steht in der Liste", g.text())
    g.taste("esc")

    print("Freigaben")
    g.waehle("Freigaben")
    g.taste("enter")
    pruefe(g.warte_auf("Mail an Prof. Huber senden"), "Freigaben-Liste", g.text())
    g.taste("enter")
    pruefe(g.sieht("Der Postbote möchte"), "Details mit Text")
    g.foto("07-freigabe")
    g.taste("down", "down", "down")
    pruefe(g.sieht("Leif") and not g.sieht("Der Postbote möchte"), "Text lässt sich blättern", g.text())
    g.taste("enter")
    pruefe(g.sieht("Wirklich freigeben?"), "Ja fragt nach")
    g.foto("07b-freigabe-rueckfrage")
    g.taste("enter")
    g.lauf(2000)
    pruefe(dorf.entscheidungen == [{"id": "f1", "entscheidung": "ja"}], "Entscheidung „ja“ beim Dorf", dorf.entscheidungen)
    pruefe(g.sieht("Nichts zu entscheiden"), "Liste danach leer", g.text())
    dorf.freigaben.append({"id": "f2", "titel": "Skill anlegen", "gebaeude": "Rathaus", "text": "Neuer Skill „Wochenplan“."})
    g.lauf(21000, 500)
    g.taste("esc")
    g.waehle("Freigaben")
    g.taste("enter")
    g.warte_auf("Skill anlegen")
    g.taste("enter")
    g.zeichen("n")
    g.tippe("lieber nicht")
    g.taste("enter")
    g.lauf(2000)
    pruefe(dorf.entscheidungen[-1] == {"id": "f2", "entscheidung": "nein", "begruendung": "lieber nicht"}, "Nein mit Begründung", dorf.entscheidungen)
    g.taste("esc")

    print("Heute, Fristen, Gewohnheiten, Post, Notiz")
    g.waehle("Heute")
    g.taste("enter")
    pruefe(g.warte_auf("Corps-Abend") and g.sieht("Mathe: Übung 3"), "Heute zeigt Termine und Fristen", g.text())
    g.foto("10-heute")
    g.taste("esc")
    g.waehle("Fristen")
    g.taste("enter")
    pruefe(g.warte_auf("Mathe: Übung 3") and g.sieht("heute 23:59") and g.sieht("Mi, 25.11. 12:00"), "Fristen mit Fach und Uhrzeit", g.text())
    g.foto("11-fristen")
    g.taste("esc")
    g.waehle("Gewohnheiten")
    g.taste("enter")
    pruefe(g.warte_auf("10 min lesen") and g.sieht("Serie 5"), "Gewohnheiten mit Serie", g.text())
    g.taste("enter")
    g.lauf(1500)
    pruefe(dorf.gewohnheiten[0]["erledigt"] is True, "Gewohnheit abgehakt")
    g.lauf(2500)
    g.foto("11b-gewohnheiten")
    g.taste("esc")
    g.waehle("Post")
    g.taste("enter")
    pruefe(g.warte_auf("Rückmeldung zur") and g.sieht("Antwort nötig") and g.sieht("Leihfrist endet bald"), "Post (mit \\u-Umlauten vom Server)", g.text())
    g.taste("enter")
    pruefe(g.sieht("Von: Prof. Huber") and g.sieht("überarbeiten"), "Mail-Zusammenfassung lesen", g.text())
    g.foto("12-post")
    g.taste("esc", "esc")
    g.waehle("Notiz")
    g.taste("enter")
    g.tippe("Idee: Lernplan f")
    g.cmd("C ü")
    g.tippe("r Statistik")
    g.taste("enter")
    g.lauf(1500)
    pruefe(dorf.notizen == ["Idee: Lernplan für Statistik"], "Notiz (mit Umlaut) beim Dorf", dorf.notizen)

    print("Offline: Warteschlange und letzter Stand")
    g.cmd("NETZ aus")
    g.waehle("To-dos")
    g.taste("enter")
    pruefe(g.warte_auf("offline, Stand 13:5") and g.sieht("! Mathe Übung 3"), "ohne Netz: letzter Stand mit Hinweis „offline, Stand …“", g.text())
    g.foto("14-offline")
    anzahl = len(dorf.todos)
    g.zeichen("B")
    g.tippe("rot holen")
    g.taste("enter")
    g.lauf(1000)
    g.waehle("Brot holen")
    pruefe(g.sieht("Brot holen") and g.sieht("wartet"), "neues To-do steht als „wartet“ in der Liste", g.text())
    pruefe("Brot holen" in g.datei("dorf-warten.txt"), "Warteschlange liegt als Datei im Speicher", g.datei("dorf-warten.txt"))
    g.waehle("! Mathe Übung 3 abgeben")
    g.taste("enter")
    g.lauf(8000)
    pruefe(len(dorf.todos) == anzahl and dorf.todos[0]["erledigt"] is False, "ohne Netz kommt nichts beim Dorf an")
    g.taste("esc")
    pruefe(g.warte_auf("2 Änderungen warten"), "Startseite zeigt die wartenden Änderungen", g.text())
    g.foto("14b-offline-start")
    # Funkloch: Anfrage kommt an, Antwort geht verloren -> der Cardputer schickt dieselbe Kennung noch einmal
    g.cmd("NETZ stumm")
    g.lauf(45000, 500)
    pruefe(len(dorf.todos) == anzahl + 1, "Funkloch: das Dorf hat das To-do schon (Antwort ging verloren)", len(dorf.todos))
    pruefe("Brot holen" in g.datei("dorf-warten.txt"), "… der Cardputer weiß das nicht und behält es in der Warteschlange")
    g.cmd("NETZ an")
    g.lauf(70000, 500)
    brot = [p for p in dorf.anfragen("POST", "/api/geraet/todos") if p[2] == {"text": "Brot holen"}]
    pruefe(len(brot) >= 2 and len({p[3] for p in brot}) == 1, "Wiederholung mit derselben X-Vorgang-Kennung", brot)
    pruefe(len([t for t in dorf.todos if t["titel"] == "Brot holen"]) == 1, "das To-do gibt es genau einmal")
    pruefe(dorf.todos[0]["erledigt"] is True, "auch das Abhaken wurde nachgeschickt")
    pruefe(g.datei("dorf-warten.txt") == "" and not g.sieht("warten"), "Warteschlange ist leer", g.datei("dorf-warten.txt"))

    print("Ohne WLAN, Neustart, automatisch verbinden")
    g.cmd("WLANWEG")
    g.cmd("WLAN FRITZ!Box 7590|-67|geheim")      # der Hotspot ist aus
    g.waehle("Gewohnheiten")
    g.taste("enter")
    g.lauf(1000)
    g.waehle("Vokabeln")
    g.taste("enter")
    pruefe(g.sieht("wird nachgeschickt"), "ohne WLAN: Hinweis „wird nachgeschickt“", g.text())
    g.lauf(3000)
    g.cmd("NEUSTART")
    pruefe(g.sieht("HaloOS") and g.einst("modus") == "dorf", "Neustart landet im Startmenü, Agentendorf vorgewählt")
    pruefe("Vokabeln" in g.datei("dorf-warten.txt"), "Warteschlange übersteht den Neustart")
    g.cmd("WLAN Leifs iPhone|-50|hotspot123;FRITZ!Box 7590|-67|geheim")
    g.taste("enter")
    g.lauf(6000)
    g.waehle("Einstellungen")
    pruefe(g.sieht("Agentendorf") and g.sieht("Leifs iPhone"), "bekanntes Netz wird von selbst verbunden", g.text())
    pruefe(dorf.gewohnheiten[2]["erledigt"] is True, "Gewohnheit wurde nach dem Neustart nachgeschickt")
    vok = [p for p in dorf.anfragen("POST", "/gewohnheiten") if p[2].get("name") == "Vokabeln"]
    pruefe(len(vok) == 1, "… genau einmal", vok)

    print("Einstellungen")
    g.waehle("Einstellungen")
    g.taste("enter")
    pruefe(g.sieht("WLAN-Netze") and g.sieht("Neu koppeln") and g.sieht("Gerät entkoppeln"), "Einstellungen", g.text())
    g.foto("15-einstellungen")
    g.waehle("Zum Startmenü")
    pruefe(g.sieht("Firmware 1.0 · Dorf abc1234") and g.sieht("187 KB RAM frei"), "Einstellungen zeigen Version und freien Speicher", g.text())
    g.waehle("WLAN-Netze")
    g.taste("enter")
    pruefe(g.sieht("Gespeichert") and g.sieht("verbunden"), "WLAN-Netze verwalten: gespeichertes Netz, verbunden", g.text())
    g.foto("15b-wlan-gespeichert")
    g.taste("esc", "esc")

    print("401: neu koppeln")
    dorf.sperren()
    g.waehle("Heute")
    g.taste("enter")
    pruefe(g.warte_auf("Das Dorf kennt diesen"), "401 vom Dorf: Hinweis „Neu koppeln“", g.text())
    g.foto("16-neu-koppeln")
    polls = len(dorf.protokoll)
    g.lauf(40000, 500)
    pruefe(len(dorf.protokoll) == polls, "gesperrt: keine weiteren Anfragen mit dem alten Schlüssel", len(dorf.protokoll) - polls)
    dorf.neuer_code("654321")
    g.taste("enter")
    pruefe(g.sieht("Koppeln") and g.sieht("127.0.0.1"), "Enter führt zum Koppeln, Adresse ist vorbelegt", g.text())
    g.waehle("Code")
    g.taste("enter")
    g.tippe("654321")
    g.taste("enter", "enter")
    pruefe(g.warte_auf("Gekoppelt"), "neu gekoppelt")
    pruefe(g.einst("token") != token and g.einst("token") in dorf.tokens, "neuer Schlüssel gespeichert")
    g.lauf(3000)
    g.waehle("Heute")
    g.taste("enter")
    pruefe(g.warte_auf("Corps-Abend"), "danach geht alles wieder", g.text())
    g.taste("esc")

    print("Entkoppeln und zurück ins Startmenü")
    g.waehle("Einstellungen")
    g.taste("enter")
    g.waehle("Gerät entkoppeln")
    g.taste("enter", "enter")
    pruefe(g.einst("token") == "", "Entkoppeln löscht den Schlüssel")
    g.taste("esc")
    g.waehle("Mit dem Dorf koppeln")
    pruefe(g.sieht("Mit dem Dorf koppeln"), "Startseite bietet Koppeln an", g.text())
    g.taste("esc")
    pruefe(g.sieht("Zum Startmenü?"), "Esc auf der Startseite fragt nach")
    out = g.cmd("K enter")
    pruefe("RESTART" in out and g.sieht("HaloOS"), "Wechsel ins Startmenü = Neustart", out)

    g.p.stdin.write("Q\n")
    g.p.stdin.flush()
    pruefe(g.p.wait(timeout=10) == 0, "Host-Programm endet sauber")
    server.shutdown()
    uebersicht(["01-startmenue", "02-agentendorf", "03-todos", "04-buergermeister", "05-kirchturm-pomodoro", "06-kalender",
                "07-freigabe", "08-wlan-liste", "09-koppeln", "05c-kirchturm-laeutet", "14-offline", "13-fernbedienung"])
    print()
    if FEHLER:
        print(f"{len(FEHLER)} von {ANZAHL} Prüfungen FEHLGESCHLAGEN:")
        for f in FEHLER:
            print("  -", f)
        return 1
    print(f"Alle {ANZAHL} Prüfungen bestanden. Bilder: {BILDER.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
