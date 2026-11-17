#!/usr/bin/env python3
"""
Rechenraum-Runner: führt pdflatex/python3/pdftoppm in einem abgeschotteten Container aus.

- Nur das Dorf erreicht ihn (internes Docker-Netz ohne Internet), jede Anfrage braucht das Geheimnis.
- Kein Zugriff auf den Vault: Dateien kommen nur über /schreiben herein und über /lesen hinaus.
- Ein Raum pro Chat unter ARBEIT_DIR/<raum>; Pfade bleiben im Raum, Zeitlimit pro Befehl, alte Räume werden aufgeräumt.
Nur Standardbibliothek.
"""
import base64
import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ARBEIT = os.path.realpath(os.environ.get("ARBEIT_DIR", "/arbeit"))
GEHEIMNIS = os.environ.get("RECHENRAUM_GEHEIMNIS", "")
PORT = int(os.environ.get("PORT", "4100"))
ZEITLIMIT = int(os.environ.get("ZEITLIMIT_S", "120"))
MAX_AUSGABE = 20_000
MAX_DATEI = 50 * 1024 * 1024
MAX_ANFRAGE = 70 * 1024 * 1024
RAUM_ALTER_S = int(os.environ.get("RAUM_ALTER_S", str(6 * 3600)))
RAUM_NAME = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class Fehler(Exception):
    def __init__(self, status, text):
        super().__init__(text)
        self.status = status
        self.text = text


def raum_pfad(raum, anlegen=True):
    if not isinstance(raum, str) or not RAUM_NAME.match(raum):
        raise Fehler(400, "Ungültiger Raum.")
    p = os.path.join(ARBEIT, raum)
    if anlegen:
        os.makedirs(p, exist_ok=True)
    if os.path.exists(p):
        os.utime(p)
    return p


def im_raum(raum_dir, rel):
    """Pfad relativ zum Raum – nie hinaus (auch nicht über Symlinks)."""
    if not isinstance(rel, str) or not rel or "\x00" in rel or rel.startswith("/"):
        raise Fehler(400, "Ungültiger Pfad (relativ zum Arbeitsordner angeben).")
    teile = [t for t in rel.replace("\\", "/").split("/") if t not in ("", ".")]
    if any(t == ".." for t in teile) or not teile:
        raise Fehler(400, "Pfad darf nicht aus dem Arbeitsordner hinausführen.")
    p = os.path.join(raum_dir, *teile)
    echt_raum = os.path.realpath(raum_dir)
    # existierenden Vorfahren auflösen (Symlinks!)
    q = p
    while not os.path.lexists(q) and q != raum_dir:
        q = os.path.dirname(q)
    echt = os.path.realpath(q)
    if echt != echt_raum and not echt.startswith(echt_raum + os.sep):
        raise Fehler(400, "Pfad zeigt aus dem Arbeitsordner hinaus.")
    return p


def kuerzen(t):
    if len(t) <= MAX_AUSGABE:
        return t
    return f"[… {len(t) - MAX_AUSGABE} Zeichen vorne abgeschnitten]\n" + t[-MAX_AUSGABE:]


def befehl(raum_dir, cmd, zeitlimit):
    if not isinstance(cmd, str) or not cmd.strip() or len(cmd) > 4000:
        raise Fehler(400, "Befehl fehlt oder ist zu lang.")
    zeitlimit = max(1, min(int(zeitlimit or ZEITLIMIT), ZEITLIMIT))
    umgebung = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": raum_dir,
        "LANG": "C.UTF-8",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": os.path.join(raum_dir, ".mpl"),
        "TEXMFVAR": os.path.join(raum_dir, ".texmf-var"),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    start = time.time()
    p = subprocess.Popen(
        ["bash", "-c", cmd], cwd=raum_dir, env=umgebung, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        aus, _ = p.communicate(timeout=zeitlimit)
        abgelaufen = False
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        aus, _ = p.communicate()
        abgelaufen = True
    return {
        "code": p.returncode,
        "abgelaufen": abgelaufen,
        "sekunden": round(time.time() - start, 2),
        "ausgabe": kuerzen(aus.decode("utf-8", "replace")),
    }


def dateien(raum_dir):
    aus = []
    for wurzel, ordner, namen in os.walk(raum_dir):
        ordner[:] = [o for o in ordner if not o.startswith(".")]
        for n in namen:
            if n.startswith("."):
                continue
            p = os.path.join(wurzel, n)
            aus.append({"pfad": os.path.relpath(p, raum_dir), "groesse": os.path.getsize(p)})
    return sorted(aus, key=lambda d: d["pfad"])[:500]


def seite(raum_dir, pdf, nr, dpi):
    quelle = im_raum(raum_dir, pdf)
    if not os.path.isfile(quelle):
        raise Fehler(404, f"Gibt es nicht: {pdf}")
    nr = int(nr)
    if nr < 1 or nr > 2000:
        raise Fehler(400, "Ungültige Seitenzahl.")
    dpi = max(50, min(int(dpi or 100), 200))
    ziel = os.path.join(raum_dir, ".seiten", f"s{nr}-{dpi}")
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    r = subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), "-f", str(nr), "-l", str(nr), "-singlefile", quelle, ziel],
        capture_output=True, timeout=60,
    )
    if r.returncode != 0 or not os.path.isfile(ziel + ".png"):
        raise Fehler(400, "Seite nicht darstellbar: " + r.stderr.decode("utf-8", "replace")[-500:])
    seiten = subprocess.run(["pdfinfo", quelle], capture_output=True, timeout=30).stdout.decode("utf-8", "replace")
    m = re.search(r"^Pages:\s+(\d+)", seiten, re.M)
    with open(ziel + ".png", "rb") as f:
        return {"png": base64.b64encode(f.read()).decode(), "seiten": int(m.group(1)) if m else None}


def aufraeumen_alt():
    while True:
        jetzt = time.time()
        for n in os.listdir(ARBEIT):
            p = os.path.join(ARBEIT, n)
            try:
                if os.path.isdir(p) and jetzt - os.path.getmtime(p) > RAUM_ALTER_S:
                    shutil.rmtree(p, ignore_errors=True)
            except OSError:
                pass
        time.sleep(600)


class Handler(BaseHTTPRequestHandler):
    server_version = "rechenraum"
    sys_version = ""

    def log_message(self, *a):
        pass

    def antwort(self, status, daten):
        b = json.dumps(daten).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/gesundheit":
            return self.antwort(200, {"ok": True})
        self.antwort(404, {"fehler": "Nicht gefunden."})

    def do_POST(self):
        try:
            if not GEHEIMNIS or not hmac.compare_digest(self.headers.get("x-rechenraum-geheimnis", ""), GEHEIMNIS):
                raise Fehler(401, "Geheimnis fehlt oder falsch.")
            laenge = int(self.headers.get("content-length") or 0)
            if laenge > MAX_ANFRAGE:
                raise Fehler(413, "Anfrage zu groß.")
            b = json.loads(self.rfile.read(laenge) or b"{}")
            if not isinstance(b, dict):
                raise Fehler(400, "JSON-Objekt erwartet.")
            weg = self.path
            if weg == "/aufraeumen":
                p = raum_pfad(b.get("raum"), anlegen=False)
                shutil.rmtree(p, ignore_errors=True)
                return self.antwort(200, {"ok": True})
            raum = raum_pfad(b.get("raum"))
            if weg == "/befehl":
                return self.antwort(200, befehl(raum, b.get("befehl"), b.get("zeitlimit")))
            if weg == "/schreiben":
                ziel = im_raum(raum, b.get("pfad"))
                inhalt = base64.b64decode(b.get("inhalt_b64") or "", validate=True)
                if len(inhalt) > MAX_DATEI:
                    raise Fehler(413, "Datei zu groß.")
                os.makedirs(os.path.dirname(ziel), exist_ok=True)
                with open(ziel, "wb") as f:
                    f.write(inhalt)
                return self.antwort(200, {"ok": True, "groesse": len(inhalt)})
            if weg == "/lesen":
                quelle = im_raum(raum, b.get("pfad"))
                if not os.path.isfile(quelle):
                    raise Fehler(404, f"Gibt es nicht: {b.get('pfad')}")
                if os.path.getsize(quelle) > MAX_DATEI:
                    raise Fehler(413, "Datei zu groß.")
                with open(quelle, "rb") as f:
                    return self.antwort(200, {"inhalt_b64": base64.b64encode(f.read()).decode()})
            if weg == "/dateien":
                return self.antwort(200, {"dateien": dateien(raum)})
            if weg == "/seite":
                return self.antwort(200, seite(raum, b.get("pdf"), b.get("seite", 1), b.get("dpi")))
            raise Fehler(404, "Nicht gefunden.")
        except Fehler as e:
            self.antwort(e.status, {"fehler": e.text})
        except (ValueError, TypeError) as e:
            self.antwort(400, {"fehler": f"Ungültige Anfrage: {e}"})
        except Exception as e:  # noqa: BLE001 – nie abstürzen
            self.antwort(500, {"fehler": f"Interner Fehler: {type(e).__name__}"})


def main():
    if not GEHEIMNIS:
        raise SystemExit("RECHENRAUM_GEHEIMNIS fehlt.")
    os.makedirs(ARBEIT, exist_ok=True)
    if not os.access(ARBEIT, os.W_OK):
        raise SystemExit(f"{ARBEIT} ist nicht beschreibbar.")
    threading.Thread(target=aufraeumen_alt, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
