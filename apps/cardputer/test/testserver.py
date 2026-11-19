"""Testserver, der die Geräte-API des Agentendorfs nachbildet (Vertrag: ../API.md).

Nur Standardbibliothek. Wird von host_test.py im selben Prozess gestartet; allein starten geht auch:
    python3 test/testserver.py 8123      (Koppel-Code: 123456)
Die „Serverzeit“ steht still und wird vom Test gestellt (Dorf.zeit_ms), damit Bildschirmfotos und
Kirchturm-Abläufe wiederholbar sind.
"""
from __future__ import annotations

import json
import re
import struct
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WIEN = timezone(timedelta(minutes=60))
START = datetime(2026, 11, 20, 13, 55, 0, tzinfo=WIEN)      # ein Freitag


def tag(plus: int) -> str:
    return (START + timedelta(days=plus)).strftime("%Y-%m-%d")


class Dorf:
    """Zustand des nachgebauten Dorfs."""

    def __init__(self) -> None:
        self.sperre = threading.Lock()
        self.zeit_ms = int(START.timestamp() * 1000)
        self.code = "123456"
        self.fehlversuche = 0
        self.tokens: set[str] = set()
        self.vorgaenge: dict[str, tuple[int, dict]] = {}
        self.protokoll: list[tuple[str, str, dict | None, str | None]] = []   # Methode, Pfad, Körper, X-Vorgang
        self.nr = 100
        self.todos = [
            {"id": "t1", "titel": "Mathe Übung 3 abgeben", "faellig": tag(0), "wichtig": True, "erledigt": False,
             "schritte": [{"text": "Aufgabe 1 rechnen", "erledigt": True}, {"text": "Aufgabe 2 rechnen", "erledigt": False},
                          {"text": "Sauber abschreiben und hochladen", "erledigt": False}]},
            {"id": "t2", "titel": "Miete überweisen", "faellig": tag(1), "wichtig": False, "erledigt": False, "schritte": []},
            {"id": "t3", "titel": "Geschenk für Oma besorgen", "faellig": tag(4), "wichtig": False, "erledigt": False, "schritte": []},
            {"id": "t4", "titel": "Zusammenfassung Statistik Kapitel 4 schreiben und die Formelsammlung ergänzen", "faellig": None,
             "wichtig": False, "erledigt": False, "schritte": [{"text": "Kapitel lesen", "erledigt": False}]},
            {"id": "t5", "titel": "Fahrrad zur Werkstatt bringen", "faellig": tag(-1), "wichtig": False, "erledigt": False, "schritte": []},
        ]
        self.termine = [
            {"datum": tag(0), "zeit": "14:00", "ende": "15:30", "titel": "Mathe VO", "ort": "HS 1"},
            {"datum": tag(0), "zeit": "18:30", "ende": "20:00", "titel": "Corps-Abend", "ort": "Corpshaus"},
            {"datum": tag(1), "zeit": "", "ende": "", "titel": "Omas Geburtstag", "ort": ""},
            {"datum": tag(3), "zeit": "10:15", "ende": "11:45", "titel": "Statistik UE", "ort": "S3 057"},
            {"datum": tag(6), "zeit": "09:00", "ende": "10:00", "titel": "Zahnarzt", "ort": "Konstanz"},
        ]
        self.freigaben = [
            {"id": "f1", "titel": "Mail an Prof. Huber senden", "gebaeude": "Post",
             "text": "Der Postbote möchte diese Antwort als Entwurf ablegen: Sehr geehrter Herr Prof. Huber, vielen Dank für die "
                     "Rückmeldung. Ich gebe die überarbeitete Übung bis Montag ab und komme am Dienstag in die Sprechstunde. "
                     "Mit freundlichen Grüßen, Leif"},
        ]
        self.entscheidungen: list[dict] = []
        self.gewohnheiten = [
            {"name": "10 min lesen", "erledigt": False, "serie": 5},
            {"name": "Sport", "erledigt": True, "serie": 2},
            {"name": "Vokabeln", "erledigt": False, "serie": 0},
        ]
        self.notizen: list[str] = []
        self.fristen = [
            {"titel": "Übung 3", "fach": "Mathe", "faellig": tag(0) + "T23:59:00+01:00", "erledigt": False},
            {"titel": "Hausarbeit Exposé", "fach": "Statistik", "faellig": tag(5) + "T12:00:00+01:00", "erledigt": False},
            {"titel": "Quiz 2", "fach": "BWL", "faellig": tag(-1) + "T18:00:00+01:00", "erledigt": True},
        ]
        self.mails = [
            {"von": "Prof. Huber", "betreff": "Rückmeldung zur Übung 2", "antwortNoetig": True,
             "zusammenfassung": "Die Übung war in Ordnung, Aufgabe 3 bitte überarbeiten und bis Montag neu abgeben."},
            {"von": "JKU Bibliothek", "betreff": "Leihfrist endet bald", "antwortNoetig": False,
             "zusammenfassung": "Zwei Bücher sind bis 27.11. zurückzugeben oder zu verlängern."},
        ]
        self.chats: dict[str, dict] = {
            "c1": {"titel": "Wochenplan", "status": "fertig", "zeit": "09:12", "rest": 0,
                   "nachrichten": [{"von": "du", "text": "Plane meine Woche"},
                                   {"von": "bm", "text": "Erledigt. Der Plan liegt im Rathaus."}]},
        }
        self.bm_polls = 0
        self.pomodoro = {"fokus": 25, "kurz": 5, "lang": 15, "langNach": 4}
        self.laufend: list[dict] = []
        self.klingelt: list[dict] = []
        self.termine_neu: list[dict] = []
        # Spracheingabe (E194): der Nachbau "erkennt" immer den Text, den der Test vorgibt
        self.sprache_text = "Das ist ein Test"
        self.sprache_fehler = 0                 # 503 = Spracherkennung nicht verfügbar
        self.sprache_max = 2 * 1024 * 1024      # höchstens 2 MB
        self.sprache_aufnahmen: list[float] = []   # Länge jeder angenommenen Aufnahme in Sekunden

    # ---- Hilfen für den Test
    def anfragen(self, methode: str, pfad_teil: str) -> list[tuple[str, str, dict | None, str | None]]:
        return [p for p in self.protokoll if p[0] == methode and pfad_teil in p[1]]

    def sperren(self) -> None:
        with self.sperre:
            self.tokens.clear()

    def neuer_code(self, code: str) -> None:
        with self.sperre:
            self.code = code
            self.fehlversuche = 0

    # ---- Spracheingabe
    def sprache(self, typ: str, roh: bytes) -> tuple[int, dict]:
        if len(roh) > self.sprache_max:
            return 413, {"fehler": "Aufnahme zu lang"}
        if self.sprache_fehler:
            return self.sprache_fehler, {"fehler": "Spracherkennung gerade nicht verfügbar"}
        # WAV prüfen: RIFF/WAVE, fmt = PCM, mono, 16 kHz, 16 Bit, data-Länge passt zur Datei
        if not typ.startswith("audio/wav") or len(roh) < 44 or roh[:4] != b"RIFF" or roh[8:16] != b"WAVEfmt ":
            return 400, {"fehler": "Kein gültiges WAV"}
        riff, = struct.unpack("<I", roh[4:8])
        fmt_len, art, kanaele, rate, byterate, block, bits = struct.unpack("<IHHIIHH", roh[16:36])
        daten, = struct.unpack("<I", roh[40:44])
        if (fmt_len, art, kanaele, rate, byterate, block, bits) != (16, 1, 1, 16000, 32000, 2, 16) or roh[36:40] != b"data" \
                or daten != len(roh) - 44 or riff != len(roh) - 8 or daten % 2:
            return 400, {"fehler": "Kein gültiges WAV"}
        self.sprache_aufnahmen.append(daten / 32000)
        return 200, {"text": self.sprache_text}

    # ---- Kirchturm
    def uhren_weiter(self) -> None:
        """Abgelaufene Uhren: klingeln lassen, Pomodoro in die nächste Phase."""
        for u in list(self.laufend):
            if u["pausiert"] or u["art"] == "stoppuhr" or u["endeMs"] > self.zeit_ms:
                continue
            if u["art"] == "pomodoro":
                war = u["phase"]
                if war == "fokus":
                    u["phase"] = "lang" if u["runde"] % self.pomodoro["langNach"] == 0 else "kurz"
                else:
                    u["phase"] = "fokus"
                    u["runde"] += 1
                u["endeMs"] = self.zeit_ms + self.pomodoro[u["phase"]] * 60000
                self.klingelt.append({"id": u["id"], "titel": "Fokus vorbei" if war == "fokus" else "Pause vorbei"})
            else:
                self.laufend.remove(u)
                self.klingelt.append({"id": u["id"], "titel": u["titel"] or ("Timer" if u["art"] == "timer" else "Wecker")})

    def kirchturm(self) -> dict:
        self.uhren_weiter()
        laufend = []
        for u in self.laufend:
            e = dict(u)
            e["restMs"] = u["restMs"] if u["pausiert"] else max(0, u["endeMs"] - self.zeit_ms)
            laufend.append(e)
        return {"jetztMs": self.zeit_ms, "laufend": laufend, "klingelt": list(self.klingelt), "pomodoro": dict(self.pomodoro)}

    def kirchturm_aktion(self, k: dict) -> tuple[int, dict]:
        a = k.get("aktion")
        self.nr += 1
        if a == "pomodoro":
            self.laufend.append({"id": f"k{self.nr}", "art": "pomodoro", "titel": k.get("titel", ""), "phase": "fokus",
                                 "endeMs": self.zeit_ms + self.pomodoro["fokus"] * 60000, "pausiert": False, "restMs": 0, "runde": 1})
        elif a == "timer":
            minuten = int(k.get("minuten", 0))
            if not 1 <= minuten <= 600:
                return 400, {"fehler": "Minuten ungültig"}
            self.laufend.append({"id": f"k{self.nr}", "art": "timer", "titel": k.get("titel", ""), "phase": "",
                                 "endeMs": self.zeit_ms + minuten * 60000, "pausiert": False, "restMs": 0, "runde": 0})
        elif a == "wecker":
            m = re.fullmatch(r"(\d\d):(\d\d)", k.get("zeit", ""))
            if not m:
                return 400, {"fehler": "Uhrzeit ungültig"}
            jetzt = datetime.fromtimestamp(self.zeit_ms / 1000, WIEN)
            ziel = jetzt.replace(hour=int(m[1]), minute=int(m[2]), second=0, microsecond=0)
            if ziel <= jetzt:
                ziel += timedelta(days=1)
            self.laufend.append({"id": f"k{self.nr}", "art": "wecker", "titel": k["zeit"], "phase": "",
                                 "endeMs": int(ziel.timestamp() * 1000), "pausiert": False, "restMs": 0, "runde": 0})
        elif a == "leise":
            self.klingelt = [x for x in self.klingelt if x["id"] != k.get("id")]
        else:
            u = next((x for x in self.laufend if x["id"] == k.get("id")), None)
            if u is None:
                return 404, {"fehler": "Uhr nicht gefunden"}
            if a == "stopp":
                self.laufend.remove(u)
            elif a == "pause" and not u["pausiert"]:
                u["pausiert"], u["restMs"] = True, max(0, u["endeMs"] - self.zeit_ms)
            elif a == "weiter" and u["pausiert"]:
                u["pausiert"], u["endeMs"] = False, self.zeit_ms + u["restMs"]
            elif a == "naechste" and u["art"] == "pomodoro":
                u["phase"] = "kurz" if u["phase"] == "fokus" else "fokus"
                u["endeMs"] = self.zeit_ms + self.pomodoro[u["phase"]] * 60000
                u["pausiert"] = False
            elif a not in ("pause", "weiter"):
                return 400, {"fehler": "Aktion unbekannt"}
        return 200, {"ok": True}

    # ---- Übersicht
    def start(self) -> dict:
        self.uhren_weiter()
        heute = tag(0)
        jetzt = datetime.fromtimestamp(self.zeit_ms / 1000, WIEN).strftime("%H:%M")
        termin = next(({"zeit": t["zeit"], "titel": t["titel"]} for t in self.termine if t["datum"] == heute and t["zeit"] >= jetzt), None)
        fokus = None
        if self.laufend:
            u = self.laufend[0]
            rest = u["restMs"] if u["pausiert"] else max(0, u["endeMs"] - self.zeit_ms)
            fokus = {"art": u["art"], "phase": u["phase"], "restSek": rest // 1000}
        return {
            "zeit": self.zeit_ms // 1000, "offsetMin": 60, "version": "abc1234",
            "todosOffen": sum(1 for t in self.todos if not t["erledigt"]),
            "todosHeute": sum(1 for t in self.todos if not t["erledigt"] and t["faellig"] and t["faellig"] <= heute),
            "freigaben": len(self.freigaben),
            "gewohnheitenOffen": sum(1 for g in self.gewohnheiten if not g["erledigt"]),
            "termin": termin, "fokus": fokus,
            "buergermeister": {"laeuft": any(c["status"] == "laeuft" for c in self.chats.values())},
        }

    def heute(self) -> dict:
        h = tag(0)
        zeilen = [{"art": "termin", "text": t["titel"], "zeit": t["zeit"]} for t in self.termine if t["datum"] == h]
        zeilen += [{"art": "frist", "text": f["fach"] + ": " + f["titel"], "zeit": f["faellig"][11:16], "erledigt": f["erledigt"]}
                   for f in self.fristen if f["faellig"][:10] == h]
        zeilen += [{"art": "todo", "text": t["titel"], "id": t["id"], "erledigt": t["erledigt"]}
                   for t in self.todos if t["faellig"] and t["faellig"] <= h]
        zeilen += [{"art": "gewohnheit", "text": g["name"], "id": g["name"], "erledigt": g["erledigt"]} for g in self.gewohnheiten]
        return {"zeilen": zeilen[:40]}

    def todo_deuten(self, text: str) -> dict:
        self.nr += 1
        t = {"id": f"t{self.nr}", "titel": text, "faellig": None, "wichtig": False, "erledigt": False, "schritte": []}
        if "!" in text:
            t["wichtig"] = True
            t["titel"] = t["titel"].replace("!", "").strip()
        if re.search(r"\bmorgen\b", t["titel"]):
            t["faellig"] = tag(1)
            t["titel"] = re.sub(r"\s*\bmorgen\b", "", t["titel"]).strip()
        elif re.search(r"\bheute\b", t["titel"]):
            t["faellig"] = tag(0)
            t["titel"] = re.sub(r"\s*\bheute\b", "", t["titel"]).strip()
        return t

    # ---- Verteiler
    def get(self, pfad: str, frage: dict[str, str]) -> tuple[int, dict]:
        if pfad == "/start":
            return 200, self.start()
        if pfad == "/heute":
            return 200, self.heute()
        if pfad == "/todos":
            ansicht = frage.get("ansicht", "offen")
            if ansicht == "erledigt":
                liste = [t for t in self.todos if t["erledigt"]]
            elif ansicht == "heute":
                liste = [t for t in self.todos if not t["erledigt"] and t["faellig"] and t["faellig"] <= tag(0)]
            else:
                liste = [t for t in self.todos if not t["erledigt"]]
            return 200, {"todos": liste[:60]}
        if pfad == "/termine":
            return 200, {"termine": self.termine[:60]}
        if pfad == "/kirchturm":
            return 200, self.kirchturm()
        if pfad == "/buergermeister":
            return 200, {"chats": [{"chatId": i, "titel": c["titel"], "status": c["status"], "zeit": c["zeit"]}
                                   for i, c in reversed(list(self.chats.items()))][:10]}
        if pfad.startswith("/buergermeister/"):
            c = self.chats.get(pfad.split("/")[2])
            if c is None:
                return 404, {"fehler": "Gespräch nicht gefunden"}
            self.bm_polls += 1
            if c["status"] == "laeuft":
                c["rest"] -= 1
                if c["rest"] <= 0:
                    c["status"] = "fertig"
                    c["nachrichten"].append({"von": "bm", "text": c["antwort"]})
            return 200, {"status": c["status"], "nachrichten": c["nachrichten"][-20:]}
        if pfad == "/freigaben":
            return 200, {"freigaben": self.freigaben}
        if pfad == "/gewohnheiten":
            return 200, {"gewohnheiten": self.gewohnheiten}
        if pfad == "/fristen":
            return 200, {"fristen": self.fristen}
        if pfad == "/post":
            return 200, {"mails": self.mails}
        return 404, {"fehler": "Unbekannter Pfad"}

    def post(self, pfad: str, k: dict) -> tuple[int, dict]:
        if pfad == "/todos":
            text = str(k.get("text", "")).strip()
            if not text:
                return 400, {"fehler": "Text fehlt"}
            t = self.todo_deuten(text)
            self.todos.append(t)
            return 200, {"todo": t}
        if pfad in ("/todos/erledigt", "/todos/schritt", "/todos/loeschen"):
            t = next((x for x in self.todos if x["id"] == k.get("id")), None)
            if t is None:
                return 404, {"fehler": "To-do nicht gefunden"}
            if pfad == "/todos/erledigt":
                t["erledigt"] = bool(k.get("erledigt"))
            elif pfad == "/todos/schritt":
                i = int(k.get("index", -1))
                if not 0 <= i < len(t["schritte"]):
                    return 400, {"fehler": "Schritt nicht gefunden"}
                t["schritte"][i]["erledigt"] = bool(k.get("erledigt"))
            else:
                self.todos.remove(t)
            return 200, {"ok": True}
        if pfad == "/termine":
            if not k.get("titel") or not re.fullmatch(r"\d{4}-\d\d-\d\d", str(k.get("datum", ""))):
                return 400, {"fehler": "Titel oder Datum fehlt"}
            self.termine_neu.append(k)
            zeit = k.get("zeit", "")
            self.termine.append({"datum": k["datum"], "zeit": zeit, "ende": "", "titel": k["titel"], "ort": ""})
            self.termine.sort(key=lambda t: (t["datum"], t["zeit"]))
            return 200, {"ok": True}
        if pfad == "/kirchturm":
            return self.kirchturm_aktion(k)
        if pfad == "/kirchturm/einstellungen":
            for name in ("fokus", "kurz", "lang", "langNach"):
                if name in k:
                    self.pomodoro[name] = int(k[name])
            return 200, {"ok": True}
        if pfad == "/buergermeister":
            text = str(k.get("text", "")).strip()
            if not text:
                return 400, {"fehler": "Text fehlt"}
            cid = k.get("chatId")
            if cid:
                c = self.chats.get(cid)
                if c is None:
                    return 404, {"fehler": "Gespräch nicht gefunden"}
            else:
                self.nr += 1
                cid = f"c{self.nr}"
                c = {"titel": text[:40], "zeit": "13:55", "nachrichten": []}
                self.chats[cid] = c
            c["nachrichten"].append({"von": "du", "text": text})
            c["status"], c["rest"] = "laeuft", 2
            c["antwort"] = ("Morgen ist Samstag, der 21. November. Bis Montag sind drei Dinge fällig: die Mathe-Übung 3 (heute, 23:59), "
                            "die Miete (morgen) und das Exposé für Statistik (Mittwoch, 12 Uhr).\n\nMein Vorschlag: heute nach der "
                            "Vorlesung zwei Pomodoros für Aufgabe 2, morgen Vormittag abschreiben und hochladen. Die Miete habe ich als "
                            "To-do für morgen 9 Uhr vorgemerkt. Soll ich für das Exposé am Sonntag zwei Stunden Lernzeit in den "
                            "Kalender eintragen?")
            return 200, {"chatId": cid}
        if pfad == "/freigaben/entscheiden":
            f = next((x for x in self.freigaben if x["id"] == k.get("id")), None)
            if f is None:
                return 404, {"fehler": "Freigabe schon entschieden"}
            if k.get("entscheidung") not in ("ja", "nein"):
                return 400, {"fehler": "Entscheidung fehlt"}
            self.freigaben.remove(f)
            self.entscheidungen.append(k)
            return 200, {"ok": True}
        if pfad == "/gewohnheiten":
            g = next((x for x in self.gewohnheiten if x["name"] == k.get("name")), None)
            if g is None:
                return 404, {"fehler": "Gewohnheit nicht gefunden"}
            g["erledigt"] = bool(k.get("erledigt"))
            return 200, {"ok": True}
        if pfad == "/notiz":
            text = str(k.get("text", "")).strip()
            if not text:
                return 400, {"fehler": "Text fehlt"}
            self.notizen.append(text)
            return 200, {"ok": True}
        return 404, {"fehler": "Unbekannter Pfad"}


def handler_fuer(dorf: Dorf):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):      # still
            pass

        def antworten(self, status: int, daten: dict, kopf: dict[str, str] | None = None) -> None:
            # /post absichtlich mit \uXXXX-Escapes, der Rest als UTF-8 (beides muss der Cardputer lesen)
            roh = json.dumps(daten, ensure_ascii=self.path.endswith("/post")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(roh)))
            self.send_header("Connection", "close")
            for k, v in (kopf or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(roh)

        def angemeldet(self) -> bool:
            a = self.headers.get("Authorization", "")
            return a.startswith("Bearer ") and a[7:] in dorf.tokens

        def do_GET(self) -> None:
            pfad, _, frage_roh = self.path.partition("?")
            frage = dict(p.split("=", 1) for p in frage_roh.split("&") if "=" in p)
            with dorf.sperre:
                dorf.protokoll.append(("GET", self.path, None, None))
                if not pfad.startswith("/api/geraet/"):
                    return self.antworten(404, {"fehler": "Unbekannter Pfad"})
                if not self.angemeldet():
                    return self.antworten(401, {"fehler": "Schlüssel ungültig"})
                status, daten = dorf.get(pfad[len("/api/geraet"):], frage)
            self.antworten(status, daten)

        def do_POST(self) -> None:
            laenge = int(self.headers.get("Content-Length", "0"))
            if self.path == "/api/geraet/sprache":      # Körper ist eine WAV-Datei, kein JSON
                roh = self.rfile.read(laenge)
                with dorf.sperre:
                    dorf.protokoll.append(("POST", self.path, {"bytes": len(roh)}, self.headers.get("X-Vorgang")))
                    if not self.angemeldet():
                        return self.antworten(401, {"fehler": "Schlüssel ungültig"})
                    status, daten = dorf.sprache(self.headers.get("Content-Type", ""), roh)
                return self.antworten(status, daten)
            try:
                k = json.loads(self.rfile.read(laenge).decode("utf-8") or "{}")
            except ValueError:
                return self.antworten(400, {"fehler": "Kein JSON"})
            vorgang = self.headers.get("X-Vorgang")
            with dorf.sperre:
                dorf.protokoll.append(("POST", self.path, k, vorgang))
                if self.path == "/api/geraet/koppeln":
                    if dorf.fehlversuche >= 5:
                        return self.antworten(429, {"fehler": "Zu viele Versuche"}, {"Retry-After": "60"})
                    if not dorf.code or k.get("code") != dorf.code:
                        dorf.fehlversuche += 1
                        return self.antworten(401, {"fehler": "Code falsch oder abgelaufen"})
                    dorf.code = ""      # nur einmal gültig
                    dorf.nr += 1
                    token = (f"{dorf.nr:08x}" * 8)[:64]
                    dorf.tokens.add(token)
                    return self.antworten(200, {"token": token, "name": k.get("name", "Cardputer")})
                if not self.path.startswith("/api/geraet/"):
                    return self.antworten(404, {"fehler": "Unbekannter Pfad"})
                if not self.angemeldet():
                    return self.antworten(401, {"fehler": "Schlüssel ungültig"})
                if vorgang and not 8 <= len(vorgang) <= 64:
                    return self.antworten(400, {"fehler": "X-Vorgang ungültig"})
                if vorgang and vorgang in dorf.vorgaenge:      # Wiederholung: gespeicherte Antwort, nichts doppelt
                    status, daten = dorf.vorgaenge[vorgang]
                else:
                    status, daten = dorf.post(self.path[len("/api/geraet"):], k)
                    if vorgang:
                        dorf.vorgaenge[vorgang] = (status, daten)
            self.antworten(status, daten)

    return Handler


def starten(port: int = 0) -> tuple[ThreadingHTTPServer, Dorf]:
    dorf = Dorf()
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_fuer(dorf))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, dorf


if __name__ == "__main__":
    srv, _ = starten(int(sys.argv[1]) if len(sys.argv) > 1 else 8123)
    print(f"Testserver auf http://127.0.0.1:{srv.server_address[1]} (Code 123456) - Strg+C beendet")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
