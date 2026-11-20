#!/usr/bin/env python3
"""
Rechenraum-Runner: führt pdflatex/python3/pdftoppm in einem abgeschotteten Container aus.

- Nur das Dorf erreicht ihn (internes Docker-Netz ohne Internet), jede Anfrage braucht das Geheimnis.
- Kein Zugriff auf den Vault: Dateien kommen nur über /schreiben herein und über /lesen hinaus.
- Ein Raum pro Chat unter ARBEIT_DIR/<raum>; Pfade bleiben im Raum, Zeitlimit pro Befehl, alte Räume werden aufgeräumt.
- /umwandeln (E190): eine fremde Datei (Word, Excel, PowerPoint, Mail, Archiv, Audio, Video, Bild …) wird in einem
  eigenen Kindprozess mit Zeit- und Speichergrenze zu Text und Bildern für das Modell. Das Dorf parst Fremdes nie selbst.
- /werkzeug (E199): feste Werkzeuge aus dorfwerk.py (PDF bearbeiten, Graphviz, QR, Anki, DuckDB) im Arbeitsordner eines
  Raums – JSON-Auftrag statt Shell, gleiche Grenzen wie eine Umwandlung.
Nur Standardbibliothek; die Umwandlung nutzt Werkzeuge aus dem Image (ffmpeg, whisper-cli, tesseract, rsvg-convert,
heif-convert, catdoc, Pillow, xlrd, olefile), wenn vorhanden – fehlt eines, sagt das Ergebnis es ehrlich.
"""
import base64
import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
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


# ---- Umwandeln (E190): fremde Dateien → Text und Bilder für das Modell --------------------------------------------
#
# Läuft NIE im Server-Thread: /umwandeln startet `runner.py --umwandeln <datei> <name>` als Kindprozess mit eigenem
# Arbeitsordner, Zeitlimit (UMWANDELN_ZEITLIMIT_S) und Speichergrenze (RLIMIT_AS). Archive werden nie nach ihren
# Pfaden entpackt (nur Einträge lesen, mit Größen-, Anzahl-, Tiefen- und Packraten-Grenzen gegen Zip-Bomben).

UMWANDLUNG_VERSION = "1"
UMWANDELN_ZEITLIMIT = int(os.environ.get("UMWANDELN_ZEITLIMIT_S", "420"))
# Speicher (E195) – gemessen im Image (whisper.cpp v1.8.7, ggml-base-q5_1 = 56 MB Datei; 1 Thread; 40–120 s Ton):
#   whisper-cli: 197–208 MB wirklich belegt (VmHWM), 707–715 MB Adressraum (VmPeak)
#   ffmpeg:       58 MB wirklich belegt,             690–738 MB Adressraum
# RLIMIT_AS begrenzt den ADRESSRAUM, nicht den belegten Speicher: Unter ~740 MB bricht whisper sofort ab und ffmpeg
# bleibt hängen (MALLOC_ARENA_MAX und kleinere Stapel ändern daran nichts – ausprobiert). Die Grenze ist deshalb nur ein
# Riegel gegen Ausreißer (1024 MB = Bedarf + ~40 %). Was wirklich zählt, ist mem_limit des Containers
# (deploy/compose.yml, dort die Rechnung): Reißt eine Umwandlung es, trifft der Kernel genau sie (_grenzen_setzen
# setzt oom_score_adj) – nie den Runner oder einen Befehl nebenan.
UMWANDELN_SPEICHER = int(os.environ.get("UMWANDELN_SPEICHER_MB", "1024")) * 1024 * 1024
# So viel belegt eine Umwandlung im Normalfall höchstens (Transkription + Python-Kind), in MB – für die Rechnung in compose.yml
UMWANDELN_BELEGT_MB = 260
UMWANDELN_GLEICHZEITIG = threading.BoundedSemaphore(int(os.environ.get("UMWANDELN_GLEICHZEITIG", "2")))
MAX_UMWANDELN = 25 * 1024 * 1024
MAX_TEXT = 150_000
MAX_BILDER = 8
BILD_KANTE = 1568
BILD_MAX_BYTES = 3_500_000
AUDIO_MAX_S = int(os.environ.get("AUDIO_MAX_S", "360"))
TABELLE_ZEILEN = 200
TABELLE_SPALTEN = 30
ARCHIV_LISTE = 300
ARCHIV_UMWANDELN = 15
ARCHIV_DATEI = 25 * 1024 * 1024
ARCHIV_SUMME = 100 * 1024 * 1024
ARCHIV_PACKRATE = 200
ARCHIV_TIEFE = 2
ZIP_XML_MAX = 60 * 1024 * 1024
WHISPER_CLI = os.environ.get("WHISPER_CLI", "whisper-cli")
WHISPER_MODELL = os.environ.get("WHISPER_MODELL", "/opt/whisper/ggml-base-q5_1.bin")

TEXT_ENDUNGEN = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".log", ".ini", ".cfg",
    ".conf", ".toml", ".tex", ".bib", ".sty", ".cls", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".rs", ".go", ".rb", ".php", ".swift", ".kt", ".kts", ".scala", ".r",
    ".m", ".jl", ".lua", ".pl", ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".css", ".scss", ".vue", ".svelte",
    ".dart", ".hs", ".ml", ".ex", ".exs", ".erl", ".clj", ".gradle", ".properties", ".env.example", ".srt", ".vtt",
    ".ics", ".vcf", ".rst", ".adoc", ".org", ".ipynb", ".gitignore", ".dockerfile", ".make", ".mk", ".cmake", ".asm",
    ".s", ".f90", ".mat", ".do", ".sas", ".tikz", ".gp", ".plt", ".dot", ".mermaid", ".mmd", ".csl", ".nix",
}
HTML_ENDUNGEN = {".html", ".htm", ".xhtml", ".mhtml"}
BILD_ENDUNGEN = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico", ".heic", ".heif", ".avif", ".ppm", ".pgm", ".tga", ".jfif"}
AUDIO_ENDUNGEN = {".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".amr", ".wma", ".aiff", ".aif", ".caf", ".3gp"}
VIDEO_ENDUNGEN = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wmv", ".mpg", ".mpeg", ".3g2", ".flv"}
ARCHIV_ENDUNGEN = {".zip", ".tar", ".tgz", ".tbz2", ".txz", ".gz", ".bz2", ".xz"}

_ENDE = [0.0]


def _uebrig():
    return _ENDE[0] - time.time()


class Ergebnis:
    def __init__(self, typ):
        self.typ = typ
        self.teile = []
        self.bilder = []
        self.hinweise = []
        self.meta = {}

    def text(self, t):
        t = (t or "").strip("\n")
        if t.strip():
            self.teile.append(t)

    def bild(self, daten, mime, titel):
        if len(self.bilder) >= MAX_BILDER:
            self.hinweise.append(f"Weitere Bilder weggelassen (höchstens {MAX_BILDER}).")
            return
        self.bilder.append({"mime": mime, "b64": base64.b64encode(daten).decode(), "titel": titel})

    def als_dict(self):
        t = "\n\n".join(self.teile)
        if len(t) > MAX_TEXT:
            t = t[:MAX_TEXT] + f"\n\n[… gekürzt – insgesamt {len(t)} Zeichen]"
        hinweise = list(dict.fromkeys(self.hinweise))[:30]
        return {"version": UMWANDLUNG_VERSION, "typ": self.typ, "text": t, "bilder": self.bilder, "hinweise": hinweise, "meta": self.meta}


def _endung(name):
    n = name.lower()
    for doppelt in (".tar.gz", ".tar.bz2", ".tar.xz"):
        if n.endswith(doppelt):
            return doppelt
    return os.path.splitext(n)[1]


def _werkzeug(cmd, zeit=60, eingabe=None):
    """Externes Werkzeug mit Zeitlimit; FileNotFoundError, wenn es im Image fehlt."""
    zeit = max(1, min(zeit, _uebrig() - 2 if _ENDE[0] else zeit))
    return subprocess.run(cmd, capture_output=True, timeout=zeit, input=eingabe, stdin=None if eingabe is not None else subprocess.DEVNULL)


def cpu_kontingent():
    """CPUs, die der Container wirklich hat (cgroup-Quote, z. B. cpus: 1.0) – mehr Threads machen whisper nur langsamer."""
    n = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
    try:
        with open("/sys/fs/cgroup/cpu.max") as f:
            quote, periode = f.read().split()[:2]
        if quote != "max":
            n = min(n, max(1, int(int(quote) / int(periode))))
    except (OSError, ValueError):
        try:
            with open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us") as f:
                quote = int(f.read())
            with open("/sys/fs/cgroup/cpu/cpu.cfs_period_us") as f:
                periode = int(f.read())
            if quote > 0:
                n = min(n, max(1, quote // periode))
        except (OSError, ValueError):
            pass
    return max(1, min(4, int(os.environ.get("WHISPER_THREADS", n))))


def _hat(werkzeug):
    return shutil.which(werkzeug) is not None


def text_dekodieren(b):
    import codecs
    if b.startswith(codecs.BOM_UTF8):
        return b[3:].decode("utf-8", "replace")
    if b[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE):
        return b.decode("utf-16", "replace")
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", "replace")


def ist_text(b):
    probe = b[:16384]
    if not probe:
        return True
    if probe[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return True
    if b"\x00" in probe:
        return False
    t = text_dekodieren(probe)
    steuer = sum(1 for z in t if ord(z) < 32 and z not in "\n\r\t\f")
    return steuer / max(1, len(t)) < 0.02


def _sniff(kopf):
    """Dateityp aus den ersten Bytes (für Dateien ohne oder mit falscher Endung)."""
    tabelle = [
        (b"%PDF", ".pdf"), (b"PK\x03\x04", ".zip"), (b"\x89PNG", ".png"), (b"\xff\xd8\xff", ".jpg"), (b"GIF8", ".gif"),
        (b"OggS", ".ogg"), (b"ID3", ".mp3"), (b"fLaC", ".flac"), (b"\x1f\x8b", ".gz"), (b"BZh", ".bz2"),
        (b"\xfd7zXZ", ".xz"), (b"{\\rtf", ".rtf"), (b"\xd0\xcf\x11\xe0", ".ole"), (b"BM", ".bmp"), (b"#!AMR", ".amr"),
        (b"\x1a\x45\xdf\xa3", ".mkv"), (b"7z\xbc\xaf", ".7z"), (b"Rar!", ".rar"),
    ]
    for magie, e in tabelle:
        if kopf.startswith(magie):
            return e
    if kopf[:4] == b"RIFF" and kopf[8:12] == b"WAVE":
        return ".wav"
    if kopf[:4] == b"RIFF" and kopf[8:12] == b"WEBP":
        return ".webp"
    if kopf[:4] == b"RIFF" and kopf[8:12] == b"AVI ":
        return ".avi"
    if kopf[4:8] == b"ftyp":
        marke = kopf[8:12]
        if marke in (b"heic", b"heix", b"mif1", b"msf1", b"heim", b"heis"):
            return ".heic"
        if marke == b"avif":
            return ".avif"
        if marke in (b"M4A ", b"M4B "):
            return ".m4a"
        return ".mp4"
    if kopf.lstrip()[:5].lower() in (b"<html", b"<!doc"):
        return ".html"
    if kopf.lstrip()[:4] == b"<svg" or (kopf.lstrip()[:5] == b"<?xml" and b"<svg" in kopf):
        return ".svg"
    if kopf.startswith(b"From ") or re.match(rb"^(Return-Path|Received|From|Message-ID|MIME-Version|Delivered-To):", kopf):
        return ".eml"
    if len(kopf) > 262 and kopf[257:262] == b"ustar":
        return ".tar"
    return ""


TYPEN = {
    ".pdf": "PDF", ".docx": "Word-Dokument", ".docm": "Word-Dokument", ".dotx": "Word-Vorlage", ".doc": "Word-Dokument (alt)",
    ".odt": "OpenDocument-Text", ".rtf": "RTF-Text", ".xlsx": "Excel-Tabelle", ".xlsm": "Excel-Tabelle", ".xls": "Excel-Tabelle (alt)",
    ".ods": "OpenDocument-Tabelle", ".pptx": "PowerPoint", ".ppsx": "PowerPoint", ".potx": "PowerPoint-Vorlage", ".ppt": "PowerPoint (alt)",
    ".odp": "OpenDocument-Präsentation", ".epub": "E-Book (EPUB)", ".eml": "E-Mail", ".msg": "Outlook-Mail", ".zip": "ZIP-Archiv",
    ".tar": "TAR-Archiv", ".tar.gz": "TAR-Archiv (gz)", ".tgz": "TAR-Archiv (gz)", ".tar.bz2": "TAR-Archiv (bz2)", ".tbz2": "TAR-Archiv (bz2)",
    ".tar.xz": "TAR-Archiv (xz)", ".txz": "TAR-Archiv (xz)", ".gz": "gzip-Datei", ".bz2": "bzip2-Datei", ".xz": "xz-Datei", ".svg": "SVG-Grafik",
    ".7z": "7-Zip-Archiv", ".rar": "RAR-Archiv", ".ole": "Office-Datei (alt)",
}


def typ_text(e):
    if e in TYPEN:
        return TYPEN[e]
    if e in BILD_ENDUNGEN:
        return f"Bild ({e[1:].upper()})"
    if e in AUDIO_ENDUNGEN:
        return f"Audio ({e[1:]})"
    if e in VIDEO_ENDUNGEN:
        return f"Video ({e[1:]})"
    if e in HTML_ENDUNGEN:
        return "Webseite (HTML)"
    if e in TEXT_ENDUNGEN:
        return f"Text ({e[1:]})"
    return f"Datei ({e[1:] or 'ohne Endung'})"


# ---- Text, HTML, RTF -------------------------------------------------------------------------------------------------

def html_zu_text(html):
    from html.parser import HTMLParser

    class P(HTMLParser):
        BLOCK = {"p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "blockquote", "pre", "table", "ul", "ol", "dl", "form", "figure"}

        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.aus = []
            self.weg = 0
            self.href = []
            self.pre = 0

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            if tag in ("script", "style", "noscript", "template", "head", "svg"):
                self.weg += 1
            elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.aus.append("\n\n" + "#" * int(tag[1]) + " ")
            elif tag == "li":
                self.aus.append("\n- ")
            elif tag == "br":
                self.aus.append("\n")
            elif tag == "tr":
                self.aus.append("\n|")
            elif tag in ("td", "th"):
                self.aus.append(" ")
            elif tag == "img" and a.get("alt"):
                self.aus.append(f"[Bild: {a['alt']}]")
            elif tag == "a":
                self.href.append(a.get("href") or "")
            elif tag in self.BLOCK:
                self.aus.append("\n\n")
            if tag == "pre":
                self.pre += 1

        def handle_endtag(self, tag):
            if tag in ("script", "style", "noscript", "template", "head", "svg"):
                self.weg = max(0, self.weg - 1)
            elif tag in ("td", "th"):
                self.aus.append(" |")
            elif tag == "a" and self.href:
                h = self.href.pop()
                if h.startswith(("http://", "https://", "mailto:")):
                    self.aus.append(f" ({h})")
            elif tag in self.BLOCK or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.aus.append("\n\n")
            if tag == "pre":
                self.pre = max(0, self.pre - 1)

        def handle_data(self, d):
            if self.weg:
                return
            self.aus.append(d if self.pre else re.sub(r"\s+", " ", d))

    p = P()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001 – kaputtes HTML: so viel wie möglich
        pass
    t = "".join(p.aus)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def rtf_zu_text(rtf):
    """Einfacher RTF-Leser: Absätze, Tabs, \\'hh (cp1252), \\uN; Kopf-Gruppen (Schriften, Farben, Bilder …) fallen weg."""
    weg_gruppen = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl",
                   "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping",
                   "latentstyles", "datastore", "object", "fldinst", "filetbl", "revtbl", "mmathPr", "pgdsctbl"}
    aus = []
    stapel = []  # (weg, uc)
    weg = False
    uc = 1
    ueberspringen = 0
    i = 0
    muster = re.compile(r"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|[\r\n]+|([^\\{}\r\n]+)")
    for m in muster.finditer(rtf):
        wort, zahl, hexz, zeichen, klammer, text = m.groups()
        if klammer == "{":
            stapel.append((weg, uc))
            continue
        if klammer == "}":
            if stapel:
                weg, uc = stapel.pop()
            continue
        if zeichen is not None:
            if zeichen == "*":
                weg = True
            elif zeichen in "\\{}" and not weg:
                aus.append(zeichen)
            elif zeichen == "~" and not weg:
                aus.append(" ")
            continue
        if wort is not None:
            if wort in weg_gruppen:
                weg = True
            elif weg:
                pass
            elif wort in ("par", "line", "sect", "page"):
                aus.append("\n")
            elif wort == "tab":
                aus.append("\t")
            elif wort == "cell":
                aus.append(" | ")
            elif wort == "row":
                aus.append("\n")
            elif wort == "uc":
                uc = int(zahl or 1)
            elif wort == "u" and zahl is not None:
                n = int(zahl)
                aus.append(chr(n + 65536 if n < 0 else n))
                ueberspringen = uc
            continue
        if hexz is not None:
            if ueberspringen:
                ueberspringen -= 1
            elif not weg:
                aus.append(bytes([int(hexz, 16)]).decode("cp1252", "replace"))
            continue
        if text and not weg:
            if ueberspringen:
                k = min(ueberspringen, len(text))
                text = text[k:]
                ueberspringen -= k
            aus.append(text)
    return re.sub(r"\n{3,}", "\n\n", "".join(aus)).strip()


# ---- Office (OOXML/ODF) mit der Standardbibliothek --------------------------------------------------------------------

def _zip_oeffnen(pfad):
    import zipfile
    z = zipfile.ZipFile(pfad)
    if sum(i.file_size for i in z.infolist()) > 4 * ZIP_XML_MAX:
        raise ValueError("entpackt zu groß (Schutz gegen Zip-Bomben)")
    return z


def _xml(z, name):
    import xml.etree.ElementTree as ET
    info = z.getinfo(name)
    if info.file_size > ZIP_XML_MAX:
        raise ValueError(f"{name} ist entpackt zu groß")
    with z.open(name) as f:
        daten = f.read(ZIP_XML_MAX + 1)
    if len(daten) > ZIP_XML_MAX:
        raise ValueError(f"{name} ist entpackt zu groß")
    if b"<!ENTITY" in daten[:4096]:
        raise ValueError("XML mit Entity-Definitionen wird nicht gelesen")
    return ET.fromstring(daten)


def _zelle(t):
    return (t or "").replace("\n", " ").replace("|", "\\|").strip()


def md_tabelle(zeilen, kopf_hinweis=""):
    zeilen = [z for z in zeilen if any((c or "").strip() for c in z)]
    if not zeilen:
        return ""
    breite = min(TABELLE_SPALTEN, max(len(z) for z in zeilen))
    # leere Spalten am Ende weg
    while breite > 1 and all(len(z) < breite or not (z[breite - 1] or "").strip() for z in zeilen):
        breite -= 1
    aus = []
    for i, z in enumerate(zeilen):
        z = [_zelle(c) for c in (list(z) + [""] * breite)[:breite]]
        aus.append("| " + " | ".join(z) + " |")
        if i == 0:
            aus.append("|" + "---|" * breite)
    return (kopf_hinweis + "\n" if kopf_hinweis else "") + "\n".join(aus)


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_lesen(pfad, erg):
    z = _zip_oeffnen(pfad)
    stile = {}
    listen_stile = set()
    if "word/styles.xml" in z.namelist():
        for s in _xml(z, "word/styles.xml").iter(W + "style"):
            sid = s.get(W + "styleId") or ""
            n = s.find(W + "name")
            name = (n.get(W + "val") if n is not None else sid).lower()
            ebene = None
            m = re.match(r"(heading|überschrift|berschrift)\s*(\d)", name)
            if m:
                ebene = int(m.group(2))
            elif name in ("title", "titel"):
                ebene = 1
            ol = s.find(f"{W}pPr/{W}outlineLvl")
            if ebene is None and ol is not None:
                ebene = int(ol.get(W + "val", "0")) + 1
            stile[sid] = ebene
            if name.startswith(("list", "liste", "aufzählung")) or s.find(f"{W}pPr/{W}numPr") is not None:
                listen_stile.add(sid)
    wurzel = _xml(z, "word/document.xml")
    koerper = wurzel.find(W + "body")
    aus = []

    def absatz(p):
        teile = []
        for el in p.iter():
            if el.tag == W + "t" and el.text:
                teile.append(el.text)
            elif el.tag == W + "tab":
                teile.append("\t")
            elif el.tag in (W + "br", W + "cr"):
                teile.append("\n")
        t = "".join(teile).strip()
        if not t:
            return ""
        ppr = p.find(W + "pPr")
        ebene = None
        if ppr is not None:
            st = ppr.find(W + "pStyle")
            if st is not None:
                ebene = stile.get(st.get(W + "val"))
                if st.get(W + "val") in listen_stile and ppr.find(W + "numPr") is None:
                    return "- " + t
            ol = ppr.find(W + "outlineLvl")
            if ebene is None and ol is not None:
                ebene = int(ol.get(W + "val", "0")) + 1
            if ppr.find(W + "numPr") is not None:
                lvl = ppr.find(f"{W}numPr/{W}ilvl")
                return "  " * int(lvl.get(W + "val", "0") if lvl is not None else 0) + "- " + t
        if ebene and ebene <= 6:
            return "#" * ebene + " " + t
        return t

    def tabelle(tbl):
        zeilen = []
        for tr in tbl.findall(W + "tr"):
            zeilen.append([" ".join(filter(None, (absatz(p) for p in tc.iter(W + "p")))) for tc in tr.findall(W + "tc")])
        return md_tabelle(zeilen)

    def bloecke(el):
        for k in el:
            if k.tag == W + "p":
                a = absatz(k)
                if a:
                    aus.append(a)
            elif k.tag == W + "tbl":
                aus.append(tabelle(k))
            elif k.tag in (W + "sdt", W + "sdtContent", W + "customXml", W + "ins", W + "smartTag"):
                bloecke(k)
    bloecke(koerper if koerper is not None else wurzel)
    # Fußnoten hinten an
    if "word/footnotes.xml" in z.namelist():
        noten = [absatz(p) for p in _xml(z, "word/footnotes.xml").iter(W + "p")]
        noten = [n for n in noten if n]
        if noten:
            aus.append("## Fußnoten\n" + "\n".join(f"- {n}" for n in noten))
    bilder = [n for n in z.namelist() if n.startswith("word/media/")]
    if bilder:
        erg.hinweise.append(f"Das Dokument enthält {len(bilder)} eingebettete(s) Bild(er) – nicht beigelegt.")
    erg.text("\n\n".join(aus))


ODF = {
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "presentation": "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
}


def _o(ns, n):
    return "{" + ODF[ns] + "}" + n


def _odf_text(el):
    """Text eines ODF-Absatzes (text:s = Leerzeichen, text:tab, text:line-break)."""
    teile = [el.text or ""]
    for k in el:
        if k.tag == _o("text", "s"):
            teile.append(" " * int(k.get(_o("text", "c"), "1")))
        elif k.tag == _o("text", "tab"):
            teile.append("\t")
        elif k.tag == _o("text", "line-break"):
            teile.append("\n")
        elif k.tag in (_o("text", "note"),):
            pass
        else:
            teile.append(_odf_text(k))
        teile.append(k.tail or "")
    return "".join(teile)


def _odf_tabelle(tbl, max_zeilen=TABELLE_ZEILEN):
    zeilen = []
    gesamt = 0
    for tr in tbl.iter(_o("table", "table-row")):
        wdh = min(int(tr.get(_o("table", "number-rows-repeated"), "1")), 1000)
        zeile = []
        for tc in tr:
            if tc.tag not in (_o("table", "table-cell"), _o("table", "covered-table-cell")):
                continue
            n = min(int(tc.get(_o("table", "number-columns-repeated"), "1")), TABELLE_SPALTEN)
            wert = " ".join(_odf_text(p) for p in tc.iter(_o("text", "p"))).strip()
            if not wert:
                wert = tc.get(_o("office", "date-value")) or tc.get(_o("office", "value")) or ""
            zeile.extend([wert] * n)
            if len(zeile) >= TABELLE_SPALTEN:
                break
        if not any(c.strip() for c in zeile):
            continue
        for _ in range(wdh):
            gesamt += 1
            if len(zeilen) < max_zeilen:
                zeilen.append(zeile)
    return zeilen, gesamt


def odt_lesen(pfad, erg):
    z = _zip_oeffnen(pfad)
    wurzel = _xml(z, "content.xml")
    koerper = wurzel.find(f"{_o('office', 'body')}/{_o('office', 'text')}")
    aus = []

    def bloecke(el, liste=0):
        for k in el:
            if k.tag == _o("text", "h"):
                e = int(k.get(_o("text", "outline-level"), "1"))
                t = _odf_text(k).strip()
                if t:
                    aus.append("#" * min(e, 6) + " " + t)
            elif k.tag == _o("text", "p"):
                t = _odf_text(k).strip()
                if t:
                    aus.append(("  " * (liste - 1) + "- " if liste else "") + t)
            elif k.tag == _o("text", "list"):
                bloecke(k, liste + 1)
            elif k.tag in (_o("text", "list-item"), _o("text", "section"), _o("text", "list-header")):
                bloecke(k, liste)
            elif k.tag == _o("table", "table"):
                zeilen, _ = _odf_tabelle(k)
                aus.append(md_tabelle(zeilen))
    bloecke(koerper if koerper is not None else wurzel)
    erg.text("\n\n".join(a for a in aus if a))


def ods_lesen(pfad, erg):
    z = _zip_oeffnen(pfad)
    wurzel = _xml(z, "content.xml")
    blaetter = list(wurzel.iter(_o("table", "table")))
    for i, tbl in enumerate(blaetter[:20]):
        zeilen, gesamt = _odf_tabelle(tbl)
        name = tbl.get(_o("table", "name"), f"Blatt {i + 1}")
        hinweis = f" (gezeigt {len(zeilen)} von {gesamt} Zeilen)" if gesamt > len(zeilen) else ""
        erg.text(f"## Blatt: {name}{hinweis}\n" + (md_tabelle(zeilen) or "(leer)"))
    if len(blaetter) > 20:
        erg.hinweise.append(f"{len(blaetter) - 20} weitere Blätter weggelassen.")


def odp_lesen(pfad, erg):
    z = _zip_oeffnen(pfad)
    wurzel = _xml(z, "content.xml")
    for i, seite in enumerate(wurzel.iter(_o("draw", "page"))):
        texte = []
        notizen = []
        for el in seite.iter():
            if el.tag == _o("presentation", "notes"):
                notizen = [_odf_text(p).strip() for p in el.iter(_o("text", "p"))]
        noten_ids = set()
        for n in seite.iter(_o("presentation", "notes")):
            noten_ids.update(id(p) for p in n.iter(_o("text", "p")))
        titel = ""
        for rahmen in seite.iter(_o("draw", "frame")):
            if rahmen.get(_o("presentation", "class")) == "title":
                titel = " ".join(_odf_text(p).strip() for p in rahmen.iter(_o("text", "p"))).strip()
                noten_ids.update(id(p) for p in rahmen.iter(_o("text", "p")))
        for p in seite.iter(_o("text", "p")):
            if id(p) not in noten_ids:
                t = _odf_text(p).strip()
                if t:
                    texte.append(t)
        teil = f"## Folie {i + 1}{': ' + titel if titel else ''}\n" + "\n".join(f"- {t}" for t in texte)
        notizen = [n for n in notizen if n and n != "<number>"]
        if notizen:
            teil += "\n\nNotizen: " + " ".join(notizen)
        erg.text(teil)


A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
PML = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PREL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _rels(z, pfad):
    ordner, name = pfad.rsplit("/", 1)
    rp = f"{ordner}/_rels/{name}.rels"
    if rp not in z.namelist():
        return {}
    aus = {}
    for r in _xml(z, rp).iter(PREL + "Relationship"):
        ziel = r.get("Target", "")
        if not ziel.startswith("/"):
            teile = ordner.split("/")
            for t in ziel.split("/"):
                if t == "..":
                    teile = teile[:-1]
                elif t != ".":
                    teile.append(t)
            ziel = "/".join(teile)
        aus[r.get("Id")] = (r.get("Type", ""), ziel.lstrip("/"))
    return aus


def _a_absaetze(el):
    aus = []
    for p in el.iter(A + "p"):
        t = "".join((x.text or "") if x.tag == A + "t" else ("\n" if x.tag == A + "br" else "") for x in p.iter() if x.tag in (A + "t", A + "br")).strip()
        if t:
            aus.append(t)
    return aus


def pptx_lesen(pfad, erg):
    z = _zip_oeffnen(pfad)
    praes = _xml(z, "ppt/presentation.xml")
    rels = _rels(z, "ppt/presentation.xml")
    folien = []
    for s in praes.iter(PML + "sldId"):
        r = rels.get(s.get(REL + "id"))
        if r and r[1] in z.namelist():
            folien.append(r[1])
    for nr, fp in enumerate(folien, 1):
        wurzel = _xml(z, fp)
        titel = ""
        texte = []
        for sp in wurzel.iter(PML + "sp"):
            ph = sp.find(f"{PML}nvSpPr/{PML}nvPr/{PML}ph")
            abs_ = _a_absaetze(sp)
            if ph is not None and ph.get("type") in ("title", "ctrTitle") and abs_:
                titel = " ".join(abs_)
            elif ph is not None and ph.get("type") in ("sldNum", "dt", "ftr"):
                continue
            else:
                texte.extend(abs_)
        for tbl in wurzel.iter(A + "tbl"):
            zeilen = [[" ".join(_a_absaetze(tc)) for tc in tr.findall(A + "tc")] for tr in tbl.findall(A + "tr")]
            texte.append(md_tabelle(zeilen))
        teil = f"## Folie {nr}{': ' + titel if titel else ''}\n" + "\n".join(f"- {t}" if "\n" not in t and not t.startswith("|") else t for t in texte)
        for typ, ziel in _rels(z, fp).values():
            if typ.endswith("/notesSlide") and ziel in z.namelist():
                notizen = []
                for sp in _xml(z, ziel).iter(PML + "sp"):
                    ph = sp.find(f"{PML}nvSpPr/{PML}nvPr/{PML}ph")
                    if ph is not None and ph.get("type") in ("sldImg", "sldNum", "hdr", "ftr", "dt"):
                        continue
                    notizen.extend(_a_absaetze(sp))
                if notizen:
                    teil += "\n\nNotizen: " + " ".join(notizen)
        erg.text(teil)
    erg.meta["folien"] = len(folien)
    erg.hinweise.append("Folien als Bilder gibt es nicht (bräuchte LibreOffice im Rechenraum) – nur Text, Tabellen und Notizen.")


S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DATUM_FORMATE = set(range(14, 23)) | {45, 46, 47}


def _spalte(ref):
    n = 0
    for z in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(z) - 64
    return n - 1


def _excel_datum(wert, mit_zeit):
    import datetime
    try:
        t = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(wert))
    except (ValueError, OverflowError):
        return wert
    return t.strftime("%Y-%m-%d %H:%M" if mit_zeit and t.time() != datetime.time(0) else "%Y-%m-%d")


def xlsx_lesen(pfad, erg):
    import xml.etree.ElementTree as ET
    z = _zip_oeffnen(pfad)
    namen = set(z.namelist())
    geteilt = []
    if "xl/sharedStrings.xml" in namen:
        for si in _xml(z, "xl/sharedStrings.xml").iter(S + "si"):
            geteilt.append("".join(t.text or "" for t in si.iter(S + "t")))
    datum_stile = set()
    if "xl/styles.xml" in namen:
        st = _xml(z, "xl/styles.xml")
        eigene = {}
        for nf in st.iter(S + "numFmt"):
            code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", nf.get("formatCode", "").lower())
            eigene[int(nf.get("numFmtId", "0"))] = bool(re.search(r"[dy]|m{3,}", code)) or ("m" in code and ("d" in code or "y" in code))
        xfs = st.find(S + "cellXfs")
        for i, xf in enumerate(xfs if xfs is not None else []):
            fid = int(xf.get("numFmtId", "0"))
            if fid in DATUM_FORMATE or eigene.get(fid):
                datum_stile.add(i)
    mappe = _xml(z, "xl/workbook.xml")
    rels = _rels(z, "xl/workbook.xml")
    blaetter = [(b.get("name"), rels.get(b.get(REL + "id"), ("", ""))[1]) for b in mappe.iter(S + "sheet")]
    for name, ziel in blaetter[:20]:
        if ziel not in namen:
            continue
        info = z.getinfo(ziel)
        if info.file_size > 4 * ZIP_XML_MAX:
            erg.text(f"## Blatt: {name}\n(zu groß zum Lesen)")
            continue
        zeilen = []
        gesamt = 0
        with z.open(ziel) as f:
            for ereignis, el in ET.iterparse(f, events=("end",)):
                if el.tag == S + "dimension":
                    erg.meta.setdefault("bereiche", {})[name] = el.get("ref")
                if el.tag != S + "row":
                    continue
                gesamt += 1
                if len(zeilen) < TABELLE_ZEILEN:
                    zeile = {}
                    for c in el.findall(S + "c"):
                        ref = c.get("r")
                        sp = _spalte(ref) if ref else len(zeile)
                        if sp >= TABELLE_SPALTEN:
                            continue
                        t = c.get("t")
                        v = c.find(S + "v")
                        wert = v.text if v is not None and v.text is not None else ""
                        if t == "s" and wert:
                            wert = geteilt[int(wert)] if int(wert) < len(geteilt) else ""
                        elif t == "inlineStr":
                            wert = "".join(x.text or "" for x in c.iter(S + "t"))
                        elif t == "b":
                            wert = "WAHR" if wert == "1" else "FALSCH"
                        elif t in (None, "n") and wert and int(c.get("s", "0")) in datum_stile:
                            wert = _excel_datum(wert, True)
                        zeile[sp] = wert
                    if zeile:
                        zeilen.append([zeile.get(i, "") for i in range(max(zeile) + 1)])
                el.clear()
        hinweis = f" (gezeigt {len(zeilen)} von {gesamt} Zeilen)" if gesamt > len(zeilen) else ""
        erg.text(f"## Blatt: {name}{hinweis}\n" + (md_tabelle(zeilen) or "(leer)"))
    if len(blaetter) > 20:
        erg.hinweise.append(f"{len(blaetter) - 20} weitere Blätter weggelassen.")


def xls_lesen(pfad, erg):
    try:
        import xlrd
    except ImportError:
        erg.hinweise.append("Altes Excel-Format (.xls): Leser xlrd fehlt im Rechenraum – bitte als .xlsx speichern.")
        return
    mappe = xlrd.open_workbook(pfad, on_demand=True)
    for i in range(min(mappe.nsheets, 20)):
        b = mappe.sheet_by_index(i)
        zeilen = []
        for r in range(min(b.nrows, TABELLE_ZEILEN)):
            zeile = []
            for c in range(min(b.ncols, TABELLE_SPALTEN)):
                zelle = b.cell(r, c)
                if zelle.ctype == xlrd.XL_CELL_DATE:
                    try:
                        zeile.append(xlrd.xldate.xldate_as_datetime(zelle.value, mappe.datemode).strftime("%Y-%m-%d"))
                        continue
                    except Exception:  # noqa: BLE001
                        pass
                v = zelle.value
                zeile.append(str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))
            zeilen.append(zeile)
        hinweis = f" (gezeigt {len(zeilen)} von {b.nrows} Zeilen)" if b.nrows > len(zeilen) else ""
        erg.text(f"## Blatt: {b.name}{hinweis}\n" + (md_tabelle(zeilen) or "(leer)"))


def catdoc_lesen(pfad, erg, programm):
    if not _hat(programm):
        erg.hinweise.append(f"Altes Office-Format: {programm} fehlt im Rechenraum – bitte als .docx/.pptx speichern.")
        return
    r = _werkzeug([programm, "-d", "utf-8", pfad], 60)
    erg.text(r.stdout.decode("utf-8", "replace"))
    if r.returncode != 0 and not r.stdout.strip():
        erg.hinweise.append(f"{programm} konnte die Datei nicht lesen: {r.stderr.decode('utf-8', 'replace')[-300:]}")


def epub_lesen(pfad, erg):
    import posixpath
    z = _zip_oeffnen(pfad)
    c = _xml(z, "META-INF/container.xml")
    rf = next((e.get("full-path") for e in c.iter() if e.tag.endswith("rootfile")), None)
    if not rf:
        raise ValueError("EPUB ohne Inhaltsverzeichnis")
    opf = _xml(z, rf)
    basis = posixpath.dirname(rf)
    manifest = {e.get("id"): e.get("href") for e in opf.iter() if e.tag.endswith("}item")}
    titel = next((e.text for e in opf.iter() if e.tag.endswith("}title") and e.text), "")
    if titel:
        erg.text(f"# {titel}")
    for e in opf.iter():
        if e.tag.endswith("}itemref"):
            href = manifest.get(e.get("idref"))
            if not href:
                continue
            p = posixpath.normpath(posixpath.join(basis, href))
            if p in z.namelist() and z.getinfo(p).file_size < ZIP_XML_MAX:
                erg.text(html_zu_text(text_dekodieren(z.read(p))))
            if sum(len(t) for t in erg.teile) > MAX_TEXT:
                break


# ---- Mail ------------------------------------------------------------------------------------------------------------

def _groesse(n):
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def eml_lesen(pfad, erg, tiefe):
    import email
    from email import policy
    with open(pfad, "rb") as f:
        m = email.message_from_binary_file(f, policy=policy.default)
    kopf = [f"{k}: {m.get(k)}" for k in ("From", "To", "Cc", "Date", "Subject") if m.get(k)]
    erg.text("\n".join(kopf))
    koerper = None
    try:
        koerper = m.get_body(preferencelist=("plain", "html"))
    except Exception:  # noqa: BLE001
        pass
    if koerper is not None:
        try:
            inhalt = koerper.get_content()
        except Exception:  # noqa: BLE001
            inhalt = (koerper.get_payload(decode=True) or b"").decode("utf-8", "replace")
        erg.text(html_zu_text(inhalt) if koerper.get_content_type() == "text/html" else inhalt)
    anhaenge = []
    for a in m.iter_attachments():
        daten = a.get_payload(decode=True) or b""
        anhaenge.append((a.get_filename() or "anhang", a.get_content_type(), daten))
    _teile_anhaengen(erg, "Anhänge der Mail", [(n, len(d), t, (lambda d=d: d)) for n, t, d in anhaenge], tiefe)


def msg_lesen(pfad, erg, tiefe):
    try:
        import olefile
    except ImportError:
        erg.hinweise.append("Outlook-Mail (.msg): Leser olefile fehlt im Rechenraum – bitte als .eml speichern.")
        return
    ole = olefile.OleFileIO(pfad)

    def lies(name, wurzel=""):
        for typ, kod in (("001F", "utf-16-le"), ("001E", "cp1252")):
            p = f"{wurzel}__substg1.0_{name}{typ}"
            if ole.exists(p):
                return ole.openstream(p).read().decode(kod, "replace").rstrip("\x00")
        return ""

    kopf = [("Von", f"{lies('0C1A')} <{lies('0C1F') or lies('5D01')}>".strip(" <>")), ("An", lies("0E04")), ("Cc", lies("0E03")), ("Betreff", lies("0037"))]
    koepfe = lies("007D")
    datum = re.search(r"^Date:\s*(.+)$", koepfe, re.M)
    if datum:
        kopf.insert(3, ("Datum", datum.group(1).strip()))
    erg.text("\n".join(f"{k}: {v}" for k, v in kopf if v))
    text = lies("1000")
    if not text and ole.exists("__substg1.0_10130102"):
        text = html_zu_text(text_dekodieren(ole.openstream("__substg1.0_10130102").read()))
    erg.text(text)
    anhaenge = []
    for eintrag in ole.listdir(streams=False, storages=True):
        if len(eintrag) == 1 and eintrag[0].startswith("__attach_version1.0_"):
            w = eintrag[0] + "/"
            name = lies("3707", w) or lies("3704", w) or "anhang"
            datenpfad = w + "__substg1.0_37010102"
            groesse = ole.get_size(datenpfad) if ole.exists(datenpfad) else 0
            anhaenge.append((name, groesse, "", (lambda p=datenpfad: ole.openstream(p).read() if ole.exists(p) else b"")))
    _teile_anhaengen(erg, "Anhänge der Mail", anhaenge, tiefe)


# ---- Archive ---------------------------------------------------------------------------------------------------------

def _teile_anhaengen(erg, ueberschrift, eintraege, tiefe):
    """eintraege: (name, groesse, art, lesen()) – Liste + die verstehbaren Dateien darin (mit Grenzen)."""
    if not eintraege:
        return
    zeilen = [f"- {n} ({_groesse(g)}{', ' + a if a else ''})" for n, g, a, _ in eintraege[:ARCHIV_LISTE]]
    if len(eintraege) > ARCHIV_LISTE:
        zeilen.append(f"- … und {len(eintraege) - ARCHIV_LISTE} weitere")
    erg.text(f"## {ueberschrift} ({len(eintraege)})\n" + "\n".join(zeilen))
    if tiefe >= ARCHIV_TIEFE:
        erg.hinweise.append("Verschachtelte Archive/Anhänge: nur das Inhaltsverzeichnis (Tiefe begrenzt).")
        return
    gelesen = 0
    summe = 0
    for name, groesse, _, lesen in eintraege:
        e = _endung(name)
        if e in AUDIO_ENDUNGEN | VIDEO_ENDUNGEN:
            continue  # Transkription kostet zu viel Zeit für einen Archiv-Eintrag
        if gelesen >= ARCHIV_UMWANDELN:
            erg.hinweise.append(f"Nur die ersten {ARCHIV_UMWANDELN} Dateien wurden gelesen.")
            break
        if _uebrig() < UMWANDELN_ZEITLIMIT * 0.25:
            erg.hinweise.append("Zeit knapp – weitere Dateien nicht mehr gelesen.")
            break
        if groesse > ARCHIV_DATEI or summe + groesse > ARCHIV_SUMME:
            erg.hinweise.append(f"{name}: zu groß zum Lesen ({_groesse(groesse)}).")
            continue
        try:
            daten = lesen()
        except Exception as ex:  # noqa: BLE001
            erg.hinweise.append(f"{name}: nicht lesbar ({type(ex).__name__}: {ex}).")
            continue
        if len(daten) > ARCHIV_DATEI:
            erg.hinweise.append(f"{name}: zu groß zum Lesen.")
            continue
        summe += len(daten)
        gelesen += 1
        unter = Ergebnis(typ_text(e or _sniff(daten[:600])))
        d = tempfile.mkdtemp(dir=os.getcwd())
        ziel = os.path.join(d, f"teil{gelesen}{e if re.match(r'^[.a-z0-9]{1,12}$', e) else ''}")
        with open(ziel, "wb") as f:
            f.write(daten)
        try:
            verstehen(ziel, name, unter, tiefe + 1)
        except Exception as ex:  # noqa: BLE001
            unter.hinweise.append(f"nicht lesbar ({type(ex).__name__}: {ex})")
        finally:
            shutil.rmtree(d, ignore_errors=True)
        t = "\n\n".join(unter.teile)
        if len(t) > 30_000:
            t = t[:30_000] + "\n[… gekürzt]"
        erg.text(f"### {name} ({unter.typ})\n{t or '(kein Text)'}")
        erg.hinweise.extend(f"{name}: {h}" for h in unter.hinweise[:5])
        for b in unter.bilder:
            if len(erg.bilder) < MAX_BILDER:
                erg.bilder.append({**b, "titel": f"{name}: {b.get('titel', '')}".rstrip(": ")})


def zip_lesen(pfad, erg, tiefe):
    import zipfile
    z = zipfile.ZipFile(pfad)
    eintraege = []
    verschluesselt = 0
    for i in z.infolist():
        if i.is_dir():
            continue
        if i.flag_bits & 0x1:
            verschluesselt += 1
            eintraege.append((i.filename, i.file_size, "verschlüsselt", (lambda: (_ for _ in ()).throw(ValueError("verschlüsselt")))))
            continue
        if i.compress_size and i.file_size / i.compress_size > ARCHIV_PACKRATE and i.file_size > 1024 * 1024:
            eintraege.append((i.filename, i.file_size, "verdächtig stark gepackt – nicht gelesen", (lambda: b"\x00" * (ARCHIV_DATEI + 1))))
            continue

        def lesen(i=i):
            with z.open(i) as f:
                return f.read(ARCHIV_DATEI + 1)
        eintraege.append((i.filename, i.file_size, "", lesen))
    if verschluesselt:
        erg.hinweise.append(f"{verschluesselt} Datei(en) im Archiv sind verschlüsselt.")
    _teile_anhaengen(erg, "Inhalt des Archivs", eintraege, tiefe)


def tar_lesen(pfad, erg, tiefe):
    import tarfile
    t = tarfile.open(pfad, mode="r:*")
    eintraege = []
    n = 0
    for m in t:
        n += 1
        if n > 5000:
            erg.hinweise.append("Mehr als 5000 Einträge – Rest nicht gezeigt.")
            break
        if not m.isfile():
            continue

        def lesen(m=m):
            f = t.extractfile(m)
            return f.read(ARCHIV_DATEI + 1) if f else b""
        eintraege.append((m.name, m.size, "", lesen))
    _teile_anhaengen(erg, "Inhalt des Archivs", eintraege, tiefe)


def einzeln_entpacken(pfad, name, erg, tiefe, art):
    import bz2
    import gzip
    import lzma
    oeffner = {".gz": gzip.open, ".bz2": bz2.open, ".xz": lzma.open}[art]
    innen = name[: -len(art)] if name.lower().endswith(art) else name + ".entpackt"
    with oeffner(pfad, "rb") as f:
        daten = f.read(ARCHIV_DATEI + 1)
    if len(daten) > ARCHIV_DATEI:
        erg.hinweise.append(f"Entpackt größer als {_groesse(ARCHIV_DATEI)} – nicht gelesen (Schutz gegen Zip-Bomben).")
        return
    if len(daten) > 262 and daten[257:262] == b"ustar":
        return tar_lesen(pfad, erg, tiefe)
    _teile_anhaengen(erg, "Inhalt", [(innen, len(daten), "", lambda: daten)], tiefe)


# ---- Bilder, PDF, Audio, Video ---------------------------------------------------------------------------------------

def bild_aufbereiten(pfad, erg, titel):
    """Bild → PNG/JPEG, längste Kante höchstens BILD_KANTE, höchstens BILD_MAX_BYTES."""
    try:
        from PIL import Image
    except ImportError:
        erg.hinweise.append("Bildbibliothek (Pillow) fehlt im Rechenraum.")
        return False
    import io
    Image.MAX_IMAGE_PIXELS = 80_000_000
    with Image.open(pfad) as b:
        erg.meta.setdefault("bilder", []).append({"breite": b.width, "hoehe": b.height, "format": b.format})
        b.seek(0)
        b.load()
        if b.mode in ("P", "LA", "PA"):
            b = b.convert("RGBA")
        elif b.mode not in ("RGB", "RGBA", "L"):
            b = b.convert("RGB")
        b.thumbnail((BILD_KANTE, BILD_KANTE))
        alpha = b.mode == "RGBA"
        for q in (88, 75, 60):
            puffer = io.BytesIO()
            if alpha:
                b.save(puffer, "PNG", optimize=True)
                mime = "image/png"
            else:
                b.save(puffer, "JPEG", quality=q)
                mime = "image/jpeg"
            if puffer.tell() <= BILD_MAX_BYTES:
                break
            if alpha:
                b = b.convert("RGB")
                alpha = False
        erg.bild(puffer.getvalue(), mime, titel)
    return True


def bild_lesen(pfad, name, erg, e):
    quelle = pfad
    if e in (".heic", ".heif", ".avif"):
        try:
            from PIL import Image  # noqa: F401
            import pillow_heif  # noqa: F401
            pillow_heif.register_heif_opener()
        except ImportError:
            if not _hat("heif-convert"):
                erg.hinweise.append("HEIC/HEIF: Umwandler (heif-convert) fehlt im Rechenraum.")
                return
            quelle = pfad + ".png"
            r = _werkzeug(["heif-convert", pfad, quelle], 60)
            if r.returncode != 0 or not os.path.isfile(quelle):
                erg.hinweise.append("HEIC/HEIF ließ sich nicht umwandeln: " + r.stderr.decode("utf-8", "replace")[-300:])
                return
    bild_aufbereiten(quelle, erg, name)


def svg_lesen(pfad, name, erg):
    with open(pfad, "rb") as f:
        roh = f.read(200_000)
    texte = re.findall(rb"<(?:title|desc|text|tspan)[^>]*>([^<]{1,500})<", roh)
    if texte:
        erg.text("Texte in der Grafik: " + " · ".join(t.decode("utf-8", "replace").strip() for t in texte[:100] if t.strip()))
    if not _hat("rsvg-convert"):
        erg.hinweise.append("SVG → PNG: rsvg-convert fehlt im Rechenraum.")
        return
    ziel = pfad + ".png"
    r = _werkzeug(["rsvg-convert", "--width", "1200", "--keep-aspect-ratio", "--format", "png", "--output", ziel, pfad], 60)
    if r.returncode != 0 or not os.path.isfile(ziel):
        erg.hinweise.append("SVG ließ sich nicht darstellen: " + r.stderr.decode("utf-8", "replace")[-300:])
        return
    if not bild_aufbereiten(ziel, erg, name):
        with open(ziel, "rb") as f:
            erg.bild(f.read(), "image/png", name)


def pdf_lesen(pfad, erg):
    if not _hat("pdftotext"):
        erg.hinweise.append("pdftotext fehlt im Rechenraum.")
        return
    info = _werkzeug(["pdfinfo", pfad], 30).stdout.decode("utf-8", "replace")
    m = re.search(r"^Pages:\s+(\d+)", info, re.M)
    seiten = int(m.group(1)) if m else 0
    erg.meta["seiten"] = seiten
    r = _werkzeug(["pdftotext", "-layout", "-l", "300", pfad, "-"], 120)
    text = r.stdout.decode("utf-8", "replace")
    if seiten > 300:
        erg.hinweise.append(f"Nur die ersten 300 von {seiten} Seiten gelesen.")
    zeichen = len(re.sub(r"\s", "", text))
    if seiten and zeichen < 40 * min(seiten, 10):
        # vermutlich ein Scan → OCR der ersten Seiten
        if _hat("tesseract") and _hat("pdftoppm"):
            n = min(seiten, 10)
            r2 = _werkzeug(["pdftoppm", "-r", "150", "-gray", "-f", "1", "-l", str(n), "-png", pfad, os.path.join(os.getcwd(), "ocr")], 120)
            teile = []
            for bild in sorted(x for x in os.listdir(os.getcwd()) if x.startswith("ocr") and x.endswith(".png")):
                if _uebrig() < 20:
                    erg.hinweise.append("Zeit knapp – OCR nach einigen Seiten beendet.")
                    break
                o = _werkzeug(["tesseract", bild, "-", "-l", "deu+eng"], 90)
                teile.append(f"### Seite {len(teile) + 1} (OCR)\n" + o.stdout.decode("utf-8", "replace").strip())
            if teile:
                text = "\n\n".join(teile)
                erg.hinweise.append(f"Gescanntes PDF: Text per Texterkennung (OCR) aus {len(teile)} Seite(n) – kann Lesefehler enthalten.")
            elif r2.returncode != 0:
                erg.hinweise.append("OCR fehlgeschlagen.")
        else:
            erg.hinweise.append("Das PDF enthält kaum Text (Scan?) – Texterkennung (tesseract) fehlt im Rechenraum.")
    erg.text(text)


def _ffprobe(pfad):
    if not _hat("ffprobe"):
        return None
    r = _werkzeug(["ffprobe", "-v", "error", "-show_entries",
                   "format=duration,bit_rate,format_long_name:format_tags=title,artist,album,date,creation_time:stream=codec_type,codec_name,width,height,sample_rate,channels",
                   "-of", "json", pfad], 30)
    try:
        return json.loads(r.stdout or b"{}")
    except ValueError:
        return None


def _medien_meta(erg, info):
    fmt = (info or {}).get("format", {})
    dauer = float(fmt.get("duration") or 0)
    zeilen = []
    if dauer:
        zeilen.append(f"Dauer: {int(dauer // 60)}:{int(dauer % 60):02d} min")
        erg.meta["dauer_s"] = round(dauer, 1)
    if fmt.get("format_long_name"):
        zeilen.append(f"Format: {fmt['format_long_name']}")
    for s in (info or {}).get("streams", []):
        if s.get("codec_type") == "video":
            zeilen.append(f"Video: {s.get('codec_name')} {s.get('width')}×{s.get('height')}")
        elif s.get("codec_type") == "audio":
            zeilen.append(f"Audio: {s.get('codec_name')}, {s.get('sample_rate')} Hz, {s.get('channels')} Kanal/Kanäle")
    for k, v in (fmt.get("tags") or {}).items():
        zeilen.append(f"{k}: {v}")
    erg.text("\n".join(zeilen))
    return dauer


def transkribieren(pfad, erg, dauer):
    if not (_hat(WHISPER_CLI) and os.path.isfile(WHISPER_MODELL)):
        erg.hinweise.append("Transkription ist im Rechenraum nicht eingerichtet (whisper-cli/Modell fehlt) – nur Metadaten.")
        return
    if not _hat("ffmpeg"):
        erg.hinweise.append("ffmpeg fehlt – keine Transkription.")
        return
    wav = os.path.join(os.getcwd(), "ton.wav")
    r = _werkzeug(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", pfad, "-t", str(AUDIO_MAX_S), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 120)
    if r.returncode != 0 or not os.path.isfile(wav):
        erg.hinweise.append("Tonspur ließ sich nicht lesen: " + r.stderr.decode("utf-8", "replace")[-300:])
        return
    if dauer > AUDIO_MAX_S:
        erg.hinweise.append(f"Nur die ersten {AUDIO_MAX_S // 60} Minuten transkribiert.")
    aus = os.path.join(os.getcwd(), "transkript")
    zeit = max(10, int(_uebrig()) - 10)
    try:
        r = _werkzeug([WHISPER_CLI, "-m", WHISPER_MODELL, "-f", wav, "-l", "auto", "-t", str(cpu_kontingent()), "-np", "-otxt", "-of", aus], zeit)
    except subprocess.TimeoutExpired:
        erg.hinweise.append("Transkription dauerte zu lange und wurde abgebrochen.")
        return
    if r.returncode < 0:
        # vom Kernel beendet (Speicher knapp, SIGKILL) oder abgestürzt – vorübergehend: das Dorf merkt sich so ein Ergebnis nicht
        erg.hinweise.append(f"Transkription abgestürzt (Signal {-r.returncode}) – vermutlich zu wenig Speicher; später noch einmal versuchen.")
        return
    if r.returncode != 0 or not os.path.isfile(aus + ".txt"):
        erg.hinweise.append("Transkription fehlgeschlagen: " + r.stderr.decode("utf-8", "replace")[-300:])
        return
    with open(aus + ".txt", encoding="utf-8", errors="replace") as f:
        t = f.read().strip()
    erg.text("## Transkript (automatisch, kann Hörfehler enthalten)\n" + (t or "(keine Sprache erkannt)"))


def audio_lesen(pfad, erg):
    info = _ffprobe(pfad)
    if info is None:
        erg.hinweise.append("ffprobe fehlt im Rechenraum – keine Audio-Infos.")
    dauer = _medien_meta(erg, info)
    transkribieren(pfad, erg, dauer)


def video_lesen(pfad, erg):
    info = _ffprobe(pfad)
    if info is None:
        erg.hinweise.append("ffmpeg/ffprobe fehlt im Rechenraum – keine Video-Infos.")
        return
    dauer = _medien_meta(erg, info)
    for i, anteil in enumerate((0.05, 0.35, 0.65, 0.9)):
        ziel = os.path.join(os.getcwd(), f"standbild{i}.jpg")
        t = max(0.0, dauer * anteil) if dauer else i
        r = _werkzeug(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", pfad, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", ziel], 60)
        if r.returncode == 0 and os.path.isfile(ziel):
            with open(ziel, "rb") as f:
                erg.bild(f.read(), "image/jpeg", f"Standbild bei {int(t // 60)}:{int(t % 60):02d}")
    if any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        transkribieren(pfad, erg, dauer)


# ---- Verteiler -------------------------------------------------------------------------------------------------------

def verstehen(pfad, name, erg, tiefe=0):
    e = _endung(name)
    with open(pfad, "rb") as f:
        kopf = f.read(600)
    erkannt = _sniff(kopf)
    # Endung fehlt oder unbekannt → nach Inhalt; bekannte Endung gewinnt (docx ist auch ein ZIP)
    bekannt = e in TEXT_ENDUNGEN | HTML_ENDUNGEN | BILD_ENDUNGEN | AUDIO_ENDUNGEN | VIDEO_ENDUNGEN | ARCHIV_ENDUNGEN | set(TYPEN) | {".tar.gz", ".tar.bz2", ".tar.xz"}
    if not bekannt and erkannt:
        e = erkannt
        erg.typ = typ_text(e) + " (am Inhalt erkannt)"
    if e == ".ole":
        erg.hinweise.append("Altes Office-Format (Word/Excel/PowerPoint vor 2007) ohne passende Endung – bitte als .docx/.xlsx/.pptx speichern.")
        return
    if e in HTML_ENDUNGEN:
        with open(pfad, "rb") as f:
            return erg.text(html_zu_text(text_dekodieren(f.read())))
    if e in TEXT_ENDUNGEN or (not erkannt and not bekannt and ist_text(kopf)):
        with open(pfad, "rb") as f:
            daten = f.read(MAX_TEXT * 4)
        if not ist_text(daten):
            erg.hinweise.append("Sieht nicht wie Text aus – nicht gelesen.")
            return
        return erg.text(text_dekodieren(daten))
    if e == ".svg":
        return svg_lesen(pfad, name, erg)
    if e in BILD_ENDUNGEN:
        return bild_lesen(pfad, name, erg, e)
    if e == ".pdf":
        return pdf_lesen(pfad, erg)
    if e in (".docx", ".docm", ".dotx"):
        return docx_lesen(pfad, erg)
    if e in (".odt", ".ott"):
        return odt_lesen(pfad, erg)
    if e == ".rtf":
        with open(pfad, "rb") as f:
            return erg.text(rtf_zu_text(f.read().decode("latin-1")))
    if e == ".doc":
        return catdoc_lesen(pfad, erg, "catdoc")
    if e in (".xlsx", ".xlsm", ".xltx"):
        return xlsx_lesen(pfad, erg)
    if e == ".xls":
        return xls_lesen(pfad, erg)
    if e == ".ods":
        return ods_lesen(pfad, erg)
    if e in (".pptx", ".ppsx", ".potx"):
        return pptx_lesen(pfad, erg)
    if e == ".ppt":
        return catdoc_lesen(pfad, erg, "catppt")
    if e == ".odp":
        return odp_lesen(pfad, erg)
    if e == ".epub":
        return epub_lesen(pfad, erg)
    if e == ".eml":
        return eml_lesen(pfad, erg, tiefe)
    if e == ".msg":
        return msg_lesen(pfad, erg, tiefe)
    if e == ".zip":
        return zip_lesen(pfad, erg, tiefe)
    if e in (".tar", ".tgz", ".tbz2", ".txz", ".tar.gz", ".tar.bz2", ".tar.xz"):
        return tar_lesen(pfad, erg, tiefe)
    if e in (".gz", ".bz2", ".xz"):
        return einzeln_entpacken(pfad, name, erg, tiefe, e)
    if e in AUDIO_ENDUNGEN:
        return audio_lesen(pfad, erg)
    if e in VIDEO_ENDUNGEN:
        return video_lesen(pfad, erg)
    if e in (".7z", ".rar"):
        erg.hinweise.append(f"{typ_text(e)}: wird nicht entpackt – bitte als .zip schicken.")
        return
    erg.hinweise.append("Unbekanntes Format – nur Name, Typ und Größe.")


def umwandeln_kind(pfad, name):
    """Einstieg des Kindprozesses: Ergebnis als JSON auf stdout."""
    _ENDE[0] = time.time() + float(os.environ.get("UMWANDELN_REST_S", UMWANDELN_ZEITLIMIT))
    erg = Ergebnis(typ_text(_endung(name)))
    erg.meta["groesse"] = os.path.getsize(pfad)
    try:
        verstehen(pfad, name, erg)
    except subprocess.TimeoutExpired:
        erg.hinweise.append("Ein Werkzeug brauchte zu lange und wurde abgebrochen.")
    except MemoryError:
        erg.hinweise.append("Zu wenig Speicher für diese Datei.")
    except Exception as ex:  # noqa: BLE001 – nie abstürzen, sondern ehrlich melden
        erg.hinweise.append(f"Nicht lesbar ({type(ex).__name__}: {str(ex)[:300]}).")
    sys.stdout.write(json.dumps(erg.als_dict()))


def _grenzen_setzen(speicher=None):
    import resource
    speicher = speicher or UMWANDELN_SPEICHER
    os.setsid()
    # Wird der Speicher des Containers knapp, soll der Kernel diese Umwandlung (und ihre Werkzeuge – das vererbt sich)
    # beenden, nicht den Runner: höchste Punktzahl. Hochsetzen darf jeder Prozess ohne Rechte.
    try:
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("1000")
    except OSError:
        pass
    resource.setrlimit(resource.RLIMIT_AS, (speicher, speicher))
    resource.setrlimit(resource.RLIMIT_FSIZE, (300 * 1024 * 1024, 300 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def umwandeln(name, inhalt):
    """Wandelt eine Datei in einem Kindprozess um (eigener Ordner, Zeit- und Speichergrenze). Ordner wird danach gelöscht."""
    if not isinstance(name, str) or not name or len(name) > 300:
        raise Fehler(400, "Dateiname fehlt.")
    if len(inhalt) > MAX_UMWANDELN:
        raise Fehler(413, f"Datei zu groß (höchstens {MAX_UMWANDELN // 1024 // 1024} MB).")
    basis = os.path.join(ARBEIT, ".umwandeln")
    os.makedirs(basis, exist_ok=True)
    with UMWANDELN_GLEICHZEITIG:
        d = tempfile.mkdtemp(dir=basis)
        try:
            e = _endung(name)
            datei = os.path.join(d, "eingang" + (e if re.match(r"^[.a-z0-9]{1,12}$", e) else ""))
            with open(datei, "wb") as f:
                f.write(inhalt)
            umgebung = {
                "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": d, "TMPDIR": d, "LANG": "C.UTF-8",
                "PYTHONDONTWRITEBYTECODE": "1", "UMWANDELN_REST_S": str(UMWANDELN_ZEITLIMIT - 5), "OMP_NUM_THREADS": "2",
            }
            for k in ("WHISPER_CLI", "WHISPER_MODELL", "WHISPER_THREADS", "AUDIO_MAX_S", "UMWANDELN_SPEICHER_MB", "UMWANDELN_ZEITLIMIT_S"):
                if k in os.environ:
                    umgebung[k] = os.environ[k]
            p = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--umwandeln", datei, name], cwd=d, env=umgebung,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=_grenzen_setzen)
            try:
                aus, fehler = p.communicate(timeout=UMWANDELN_ZEITLIMIT)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.communicate()
                erg = Ergebnis(typ_text(e))
                erg.hinweise.append(f"Umwandlung nach {UMWANDELN_ZEITLIMIT} s abgebrochen (Zeitlimit).")
                return erg.als_dict()
            try:
                return json.loads(aus.decode("utf-8"))
            except ValueError:
                erg = Ergebnis(typ_text(e))
                letzte = fehler.decode("utf-8", "replace").strip().splitlines()[-1:] or [f"Exit-Code {p.returncode}"]
                erg.hinweise.append(f"Umwandlung abgestürzt ({letzte[0][:300]}).")
                return erg.als_dict()
        finally:
            shutil.rmtree(d, ignore_errors=True)


# ---- Dorfwerk (E199): feste Werkzeuge (PDF, Diagramm, QR, Anki, Daten) – dorfwerk.py als Kindprozess -------------
#
# Ohne Shell: Das Dorf schickt einen JSON-Auftrag, dorfwerk.py arbeitet im Arbeitsordner des Raums mit denselben Grenzen
# wie eine Umwandlung (eigene Sitzung, Adressraum 1024 MB, Opfer bei Speichernot) und dem Zeitlimit eines Befehls.
DORFWERK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dorfwerk.py")
# eines nach dem anderen (Speicher, siehe deploy/compose.yml); wer länger als 60 s wartet, bekommt „belegt“ statt Stillstand
WERKZEUG_GLEICHZEITIG = threading.BoundedSemaphore(int(os.environ.get("WERKZEUG_GLEICHZEITIG", "1")))
# Adressraum, nicht belegter Speicher (vgl. E195): DuckDB 2.0 reserviert beim Start rund 1,3 GB Adressraum, belegt aber
# nur ~80 MB (gemessen: VmPeak 1 372 MB, VmHWM 80 MB; unter 1 300 MB stürzt es ab). Belegt wird wie bei einer
# Umwandlung (DuckDB-Grenze 256 MB); reißt der Container seine Grenze, trifft der Kernel dieses Werkzeug (oom_score_adj).
WERKZEUG_SPEICHER = int(os.environ.get("WERKZEUG_SPEICHER_MB", "1536")) * 1024 * 1024


def werkzeug(raum_dir, auftrag):
    if not isinstance(auftrag, dict) or not isinstance(auftrag.get("art"), str):
        raise Fehler(400, "Auftrag fehlt.")
    if not os.path.isfile(DORFWERK):
        raise Fehler(503, "dorfwerk.py fehlt im Rechenraum.")
    d = os.path.join(raum_dir, ".dorfwerk")
    os.makedirs(d, exist_ok=True)
    datei = os.path.join(d, "auftrag.json")
    with open(datei, "w", encoding="utf-8") as f:
        json.dump(auftrag, f)
    umgebung = {
        "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": raum_dir, "TMPDIR": d, "LANG": "C.UTF-8", "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": os.path.join(raum_dir, ".mpl"), "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "1",
    }
    if os.environ.get("PYTHONPATH"):  # nur Tests außerhalb des Images (Pakete in einem eigenen Ordner)
        umgebung["PYTHONPATH"] = os.environ["PYTHONPATH"]
    if not WERKZEUG_GLEICHZEITIG.acquire(timeout=60):
        return {"ok": False, "fehler": "Der Rechenraum ist gerade mit einem anderen Werkzeug beschäftigt – gleich noch einmal versuchen.", "dateien": []}
    try:
        start = time.time()
        p = subprocess.Popen([sys.executable, DORFWERK, datei], cwd=raum_dir, env=umgebung, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=lambda: _grenzen_setzen(WERKZEUG_SPEICHER))
        try:
            aus, fehler = p.communicate(timeout=ZEITLIMIT)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.communicate()
            return {"ok": False, "fehler": f"Nach {ZEITLIMIT} s abgebrochen (Zeitlimit).", "dateien": []}
    finally:
        WERKZEUG_GLEICHZEITIG.release()
    try:
        erg = json.loads(aus.decode("utf-8"))
        erg["sekunden"] = round(time.time() - start, 2)
        return erg
    except ValueError:
        letzte = fehler.decode("utf-8", "replace").strip().splitlines()[-1:] or [f"Exit-Code {p.returncode}"]
        return {"ok": False, "fehler": f"Werkzeug abgestürzt ({letzte[0][:300]}).", "dateien": []}
# ---- E198: Bildbearbeitung (/bild) -----------------------------------------------------------------------------------
# Für das Atelier (Bildeditor der App) und das Agenten-Werkzeug bild_bearbeiten: zuschneiden, Größe, drehen, spiegeln,
# einfache Korrekturen, Format – und zwei KI-Schritte OHNE Internet und ohne Kosten, nur CPU:
#   hintergrund_entfernen: U²-Net „u2netp“ (4,6 MB, Apache-2.0) über onnxruntime (MIT)
#   hochskalieren:         Real-ESRGAN „general-x4v3“ (4,8 MB, BSD-3-Clause; ONNX-Fassung von Qualcomm AI Hub), Kacheln 128×128
# Läuft wie /umwandeln NIE im Server-Thread, sondern als Kindprozess `runner.py --bild …` mit denselben Grenzen
# (Zeitlimit, RLIMIT_AS, eigener Ordner, oom_score_adj).
# Speicher – gemessen mit onnxruntime 1.19.2, numpy 1.24.2, 1 Thread (Xeon 2,1 GHz):
#   u2netp:      349 MB belegt (VmHWM), 399 MB Adressraum, 0,57 s je Bild (immer 320×320)
#   Real-ESRGAN:  76 MB belegt, 126 MB Adressraum, 0,36 s je Kachel (1024×1024 → 81 Kacheln ≈ 30 s)
# Dazu das Bild selbst (24 MP RGBA = 96 MB, beim Drehen kurz doppelt). Darum belegt eine Bildbearbeitung BEIDE Plätze der
# Umwandlung (2 × UMWANDELN_BELEGT_MB = 520 MB) und es läuft immer nur eine – die Rechnung in deploy/compose.yml bleibt.
BILD_VERSION = "1"
BILD_MAX_PIXEL = 24_000_000
BILD_MAX_KANTE = 12_000
BILD_MAX_SCHRITTE = 20
# E204: Ergebnis höchstens 40 MB (24 MP als PNG mit Rauschen kann darüber liegen) – als Base64 in der JSON-Antwort ~54 MB;
# das Dorf nimmt höchstens 80 MB an. BILD_AUSGABE_MAX nur für Tests anders.
BILD_AUSGABE_MAX = int(os.environ.get("BILD_AUSGABE_MAX", str(40 * 1024 * 1024)))
BILD_MODELL_HINTERGRUND = os.environ.get("BILD_MODELL_HINTERGRUND", "/opt/bild/u2netp.onnx")
BILD_MODELL_SKALIEREN = os.environ.get("BILD_MODELL_SKALIEREN", "/opt/bild/real_esrgan_general_x4v3.onnx")
# Hochskalieren: Eingang höchstens so viele Pixel (4× → 16,8 MP Ergebnis; ~81 Kacheln je Megapixel)
SKALIEREN_MAX_PIXEL = 1_050_000
BILD_EINZELN = threading.Lock()
BILD_FORMATE = {"png": ("PNG", "image/png", ".png"), "jpg": ("JPEG", "image/jpeg", ".jpg"), "webp": ("WEBP", "image/webp", ".webp")}
BILD_SCHRITTE = (
    "zuschneiden", "groesse", "drehen", "spiegeln", "hintergrund_entfernen", "hochskalieren", "graustufen", "invertieren",
    "helligkeit", "kontrast", "saettigung", "weichzeichnen", "schaerfen", "automatisch",
)


class BildFehler(Exception):
    pass


def bild_faehigkeiten():
    """Was dieses Image kann (für die Knöpfe in der App): Pillow, onnxruntime und die beiden Modelle."""
    import importlib.util

    def modul(n):
        return importlib.util.find_spec(n) is not None
    ort = modul("onnxruntime") and modul("numpy") and modul("PIL")
    return {
        "version": BILD_VERSION,
        "bilder": modul("PIL"),
        "hintergrund_entfernen": bool(ort and os.path.isfile(BILD_MODELL_HINTERGRUND)),
        "hochskalieren": bool(ort and os.path.isfile(BILD_MODELL_SKALIEREN)),
        "heic": _hat("heif-convert"),
        "max_pixel": BILD_MAX_PIXEL,
        "skalieren_max_pixel": SKALIEREN_MAX_PIXEL,
    }


def _zahl(s, name, lo, hi, ganz=False, standard=None):
    w = s.get(name, standard)
    if w is None:
        raise BildFehler(f"Schritt „{s.get('art')}“: {name} fehlt.")
    if isinstance(w, bool) or not isinstance(w, (int, float)) or w != w:
        raise BildFehler(f"Schritt „{s.get('art')}“: {name} muss eine Zahl sein.")
    if w < lo or w > hi:
        raise BildFehler(f"Schritt „{s.get('art')}“: {name} muss zwischen {lo} und {hi} liegen.")
    return int(round(w)) if ganz else float(w)


def _bild_oeffnen(pfad, name):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = BILD_MAX_PIXEL
    quelle = pfad
    e = _endung(name)
    if e in (".heic", ".heif", ".avif"):
        if not _hat("heif-convert"):
            raise BildFehler("HEIC/HEIF: Umwandler (heif-convert) fehlt im Rechenraum.")
        quelle = pfad + ".png"
        r = _werkzeug(["heif-convert", pfad, quelle], 60)
        if r.returncode != 0 or not os.path.isfile(quelle):
            raise BildFehler("HEIC/HEIF ließ sich nicht lesen.")
    elif e == ".svg":
        if not _hat("rsvg-convert"):
            raise BildFehler("SVG: Umwandler (rsvg-convert) fehlt im Rechenraum.")
        quelle = pfad + ".png"
        # der Container hat kein Internet – nachgeladen wird nichts
        r = _werkzeug(["rsvg-convert", "-w", "2000", "--keep-aspect-ratio", "-o", quelle, pfad], 30)
        if r.returncode != 0 or not os.path.isfile(quelle):
            raise BildFehler("SVG ließ sich nicht lesen.")
    try:
        b = Image.open(quelle)
        if b.width * b.height > BILD_MAX_PIXEL:
            raise BildFehler(f"Bild zu groß ({b.width}×{b.height}, höchstens {BILD_MAX_PIXEL // 1_000_000} Megapixel).")
        b.seek(0)
        b.load()
    except BildFehler:
        raise
    except Image.DecompressionBombError:
        raise BildFehler(f"Bild zu groß (höchstens {BILD_MAX_PIXEL // 1_000_000} Megapixel).")
    except Exception as ex:  # noqa: BLE001
        raise BildFehler(f"Kein lesbares Bild ({type(ex).__name__}).")
    try:
        b = ImageOps.exif_transpose(b)  # Handyfotos: so drehen, wie man sie sieht
    except Exception:  # noqa: BLE001 – kaputtes EXIF ist kein Grund zu scheitern
        pass
    hat_alpha = b.mode in ("RGBA", "LA", "PA") or (b.mode == "P" and "transparency" in b.info)
    return b.convert("RGBA" if hat_alpha else "RGB")


def _onnx_sitzung(modell, was):
    try:
        import numpy  # noqa: F401
        import onnxruntime as ort
    except ImportError:
        raise BildFehler(f"{was}: onnxruntime fehlt im Rechenraum (kommt mit dem nächsten Rechenraum-Image).")
    if not os.path.isfile(modell):
        raise BildFehler(f"{was}: Modell fehlt im Rechenraum (kommt mit dem nächsten Rechenraum-Image).")
    o = ort.SessionOptions()
    o.intra_op_num_threads = cpu_kontingent()
    o.inter_op_num_threads = 1
    o.enable_cpu_mem_arena = False  # u2netp: 349 statt 552 MB belegt, gleich schnell
    o.log_severity_level = 3
    return ort.InferenceSession(modell, o, providers=["CPUExecutionProvider"])


def bild_hintergrund_entfernen(b):
    """U²-Net (u2netp): Maske des Hauptmotivs bei 320×320, auf Bildgröße gebracht und als Deckkraft gesetzt."""
    import numpy as np
    from PIL import Image
    s = _onnx_sitzung(BILD_MODELL_HINTERGRUND, "Hintergrund entfernen")
    klein = np.asarray(b.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
    klein = klein / max(float(klein.max()), 1e-6)
    klein = (klein - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    ein = s.get_inputs()[0]
    aus = s.run([s.get_outputs()[0].name], {ein.name: klein.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    del s
    lo, hi = float(aus.min()), float(aus.max())
    aus = (aus - lo) / max(hi - lo, 1e-6)
    maske = Image.fromarray((aus * 255).astype(np.uint8), "L").resize(b.size, Image.Resampling.LANCZOS)
    b = b.convert("RGBA")
    if b.getextrema()[3][0] < 255:  # schon durchsichtige Stellen bleiben durchsichtig
        from PIL import ImageChops
        maske = ImageChops.multiply(maske, b.getchannel("A"))
    b.putalpha(maske)
    return b


def bild_hochskalieren(b, faktor):
    """Real-ESRGAN general-x4v3 in Kacheln (128×128 → 512×512, 16 px Überlappung); 2× = 4× und sauber halbiert."""
    import numpy as np
    from PIL import Image
    if b.width * b.height > SKALIEREN_MAX_PIXEL:
        raise BildFehler(
            f"Hochskalieren: Bild zu groß ({b.width}×{b.height}). Höchstens rund {SKALIEREN_MAX_PIXEL // 1000} Tausend Pixel "
            "(z. B. 1024×1024) – vorher verkleinern oder zuschneiden."
        )
    s = _onnx_sitzung(BILD_MODELL_SKALIEREN, "Hochskalieren")
    ein, aus_name = s.get_inputs()[0], s.get_outputs()[0].name
    K, UE = 128, 16
    schritt = K - UE
    rgb = np.asarray(b.convert("RGB"), dtype=np.uint8)
    h, w = rgb.shape[:2]

    def aufgefuellt(n):  # kleinste Länge ≥ n, die sich mit Kacheln im Abstand `schritt` genau belegen lässt
        return K if n <= K else K + -(-(n - K) // schritt) * schritt
    hp, wp = aufgefuellt(h), aufgefuellt(w)
    rgb = np.pad(rgb, ((0, hp - h), (0, wp - w), (0, 0)), mode="edge")
    gross = np.zeros((hp * 4, wp * 4, 3), dtype=np.uint8)
    for y0 in range(0, hp - K + 1, schritt):
        for x0 in range(0, wp - K + 1, schritt):
            if _ENDE[0] and _uebrig() < 15:
                raise BildFehler("Hochskalieren: Zeitlimit erreicht – bitte ein kleineres Bild nehmen.")
            kachel = rgb[y0:y0 + K, x0:x0 + K].astype(np.float32) / 255.0
            r = s.run([aus_name], {ein.name: kachel.transpose(2, 0, 1)[None]})[0][0]
            r = (np.clip(r, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8).transpose(1, 2, 0)
            # Ränder der Kachel verwerfen (dort sieht das Netz zu wenig Umgebung) – außer am Bildrand
            a_y = 0 if y0 == 0 else UE // 2
            a_x = 0 if x0 == 0 else UE // 2
            e_y = K if y0 + K >= hp else K - UE // 2
            e_x = K if x0 + K >= wp else K - UE // 2
            gross[(y0 + a_y) * 4:(y0 + e_y) * 4, (x0 + a_x) * 4:(x0 + e_x) * 4] = r[a_y * 4:e_y * 4, a_x * 4:e_x * 4]
    del s
    erg = Image.fromarray(gross[:h * 4, :w * 4], "RGB")
    del gross
    if b.mode == "RGBA":
        erg.putalpha(b.getchannel("A").resize(erg.size, Image.Resampling.LANCZOS))
    if faktor == 2:
        erg = erg.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
    return erg


def _mit_alpha(b, f):
    """Wendet f auf die Farbe an und lässt die Deckkraft unberührt."""
    if b.mode != "RGBA":
        return f(b)
    a = b.getchannel("A")
    r = f(b.convert("RGB")).convert("RGBA")
    r.putalpha(a)
    return r


def bild_schritt(b, s):
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    if not isinstance(s, dict) or s.get("art") not in BILD_SCHRITTE:
        raise BildFehler(f"Unbekannter Schritt: {s.get('art') if isinstance(s, dict) else s!r}. Möglich: {', '.join(BILD_SCHRITTE)}.")
    art = s["art"]
    if art == "zuschneiden":
        x, y = _zahl(s, "x", 0, BILD_MAX_KANTE, True, 0), _zahl(s, "y", 0, BILD_MAX_KANTE, True, 0)
        bw, bh = _zahl(s, "breite", 1, BILD_MAX_KANTE, True), _zahl(s, "hoehe", 1, BILD_MAX_KANTE, True)
        if x >= b.width or y >= b.height:
            raise BildFehler(f"zuschneiden: Der Ausschnitt liegt außerhalb des Bildes ({b.width}×{b.height}).")
        return b.crop((x, y, min(b.width, x + bw), min(b.height, y + bh)))
    if art == "groesse":
        bw, bh = s.get("breite"), s.get("hoehe")
        if bw is None and bh is None:
            raise BildFehler("groesse: breite oder hoehe angeben (fehlt eine, bleibt das Seitenverhältnis).")
        bw = _zahl(s, "breite", 1, BILD_MAX_KANTE, True) if bw is not None else None
        bh = _zahl(s, "hoehe", 1, BILD_MAX_KANTE, True) if bh is not None else None
        if bw is None:
            bw = max(1, round(b.width * bh / b.height))
        if bh is None:
            bh = max(1, round(b.height * bw / b.width))
        if bw * bh > BILD_MAX_PIXEL:
            raise BildFehler(f"groesse: höchstens {BILD_MAX_PIXEL // 1_000_000} Megapixel.")
        return b.resize((bw, bh), Image.Resampling.LANCZOS)
    if art == "drehen":
        grad = _zahl(s, "grad", -360, 360) % 360
        if grad == 0:
            return b
        # im Uhrzeigersinn, wie man es erwartet (Pillow dreht gegen den Uhrzeigersinn)
        if grad in (90, 180, 270):
            return b.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}[grad])
        b = b.convert("RGBA")  # freie Ecken werden durchsichtig
        r = b.rotate(-grad, resample=Image.Resampling.BICUBIC, expand=True)
        if r.width * r.height > BILD_MAX_PIXEL:
            raise BildFehler("drehen: Das gedrehte Bild wäre zu groß.")
        return r
    if art == "spiegeln":
        richtung = s.get("richtung", "horizontal")
        if richtung not in ("horizontal", "vertikal"):
            raise BildFehler("spiegeln: richtung ist horizontal oder vertikal.")
        return b.transpose(Image.Transpose.FLIP_LEFT_RIGHT if richtung == "horizontal" else Image.Transpose.FLIP_TOP_BOTTOM)
    if art == "hintergrund_entfernen":
        return bild_hintergrund_entfernen(b)
    if art == "hochskalieren":
        faktor = _zahl(s, "faktor", 2, 4, True, 2)
        if faktor not in (2, 4):
            raise BildFehler("hochskalieren: faktor ist 2 oder 4.")
        return bild_hochskalieren(b, faktor)
    if art == "graustufen":
        return _mit_alpha(b, lambda x: ImageOps.grayscale(x).convert("RGB"))
    if art == "invertieren":
        return _mit_alpha(b, ImageOps.invert)
    if art == "automatisch":
        return _mit_alpha(b, lambda x: ImageOps.autocontrast(x, cutoff=1))
    if art in ("helligkeit", "kontrast", "saettigung"):
        wert = _zahl(s, "wert", -100, 100)
        klasse = {"helligkeit": ImageEnhance.Brightness, "kontrast": ImageEnhance.Contrast, "saettigung": ImageEnhance.Color}[art]
        return _mit_alpha(b, lambda x: klasse(x).enhance(1 + wert / 100))
    if art == "weichzeichnen":
        return b.filter(ImageFilter.GaussianBlur(_zahl(s, "radius", 0.1, 100, False, 2)))
    if art == "schaerfen":
        st = _zahl(s, "staerke", 1, 500, True, 100)
        return _mit_alpha(b, lambda x: x.filter(ImageFilter.UnsharpMask(radius=2, percent=st, threshold=2)))
    raise BildFehler(f"Unbekannter Schritt: {art}")


def bild_kind(pfad, auftrag_pfad, ausgang):
    """Einstieg des Kindprozesses: Ergebnisbild nach `ausgang`, Bericht als JSON auf stdout."""
    _ENDE[0] = time.time() + float(os.environ.get("UMWANDELN_REST_S", UMWANDELN_ZEITLIMIT))
    try:
        with open(auftrag_pfad, encoding="utf-8") as f:
            auftrag = json.load(f)
        try:
            from PIL import Image
        except ImportError:
            raise BildFehler("Bildbibliothek (Pillow) fehlt im Rechenraum.")
        b = _bild_oeffnen(pfad, auftrag["name"])
        eingang = [b.width, b.height]
        for s in auftrag["schritte"]:
            if _uebrig() < 5:
                raise BildFehler("Zeitlimit erreicht.")
            b = bild_schritt(b, s)
        fmt = auftrag["format"]
        pil, mime, _ = BILD_FORMATE[fmt]
        hinweise = []
        if fmt == "jpg" and b.mode == "RGBA":
            # JPEG kennt keine Durchsichtigkeit: auf Weiß legen und es sagen
            if b.getextrema()[3][0] < 255:
                hinweise.append("JPG kennt keine Durchsichtigkeit – durchsichtige Stellen sind weiß.")
            weiss = Image.new("RGB", b.size, (255, 255, 255))
            weiss.paste(b, mask=b.getchannel("A"))
            b = weiss
        q = int(auftrag.get("qualitaet") or 90)
        if fmt == "png":
            b.save(ausgang, pil, compress_level=6)
        else:
            b.save(ausgang, pil, quality=q)
        sys.stdout.write(json.dumps({"ok": True, "breite": b.width, "hoehe": b.height, "eingang": eingang, "format": fmt, "mime": mime,
                                     "transparenz": b.mode == "RGBA", "hinweise": hinweise}))
    except BildFehler as ex:
        sys.stdout.write(json.dumps({"ok": False, "fehler": str(ex)}))
    except subprocess.TimeoutExpired:
        sys.stdout.write(json.dumps({"ok": False, "fehler": "Ein Werkzeug brauchte zu lange und wurde abgebrochen."}))
    except MemoryError:
        sys.stdout.write(json.dumps({"ok": False, "fehler": "Zu wenig Speicher für dieses Bild – bitte kleiner."}))
    except Exception as ex:  # noqa: BLE001 – nie abstürzen, sondern ehrlich melden
        sys.stdout.write(json.dumps({"ok": False, "fehler": f"Bildbearbeitung fehlgeschlagen ({type(ex).__name__}: {str(ex)[:200]})."}))


def bild(name, inhalt, schritte, fmt, qualitaet=None):
    """Bearbeitet ein Bild in einem Kindprozess (Schritte nacheinander) und gibt das Ergebnis als Datei zurück."""
    if not isinstance(name, str) or not name or len(name) > 300:
        raise Fehler(400, "Dateiname fehlt.")
    if len(inhalt) > MAX_UMWANDELN:
        raise Fehler(413, f"Bild zu groß (höchstens {MAX_UMWANDELN // 1024 // 1024} MB).")
    if not isinstance(schritte, list) or len(schritte) > BILD_MAX_SCHRITTE or not all(isinstance(s, dict) for s in schritte):
        raise Fehler(400, f"schritte: Liste mit höchstens {BILD_MAX_SCHRITTE} Einträgen erwartet.")
    if fmt not in BILD_FORMATE:
        raise Fehler(400, f"format: {', '.join(BILD_FORMATE)}.")
    if qualitaet is not None and (isinstance(qualitaet, bool) or not isinstance(qualitaet, int) or not 1 <= qualitaet <= 100):
        raise Fehler(400, "qualitaet: 1 bis 100.")
    basis = os.path.join(ARBEIT, ".umwandeln")
    os.makedirs(basis, exist_ok=True)
    # eine Bildbearbeitung belegt beide Plätze der Umwandlung (Speicher, siehe oben) – und nur eine holt sie sich
    with BILD_EINZELN:
        geholt = 0
        try:
            for _ in range(UMWANDELN_GLEICHZEITIG._initial_value):
                UMWANDELN_GLEICHZEITIG.acquire()
                geholt += 1
            d = tempfile.mkdtemp(dir=basis)
            try:
                e = _endung(name)
                datei = os.path.join(d, "eingang" + (e if re.match(r"^[.a-z0-9]{1,12}$", e) else ""))
                with open(datei, "wb") as f:
                    f.write(inhalt)
                auftrag = os.path.join(d, "auftrag.json")
                with open(auftrag, "w", encoding="utf-8") as f:
                    json.dump({"name": name, "schritte": schritte, "format": fmt, "qualitaet": qualitaet}, f)
                ausgang = os.path.join(d, "ausgang" + BILD_FORMATE[fmt][2])
                umgebung = {
                    "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": d, "TMPDIR": d, "LANG": "C.UTF-8",
                    "PYTHONDONTWRITEBYTECODE": "1", "UMWANDELN_REST_S": str(UMWANDELN_ZEITLIMIT - 5), "OMP_NUM_THREADS": "2",
                }
                for k in ("WHISPER_THREADS", "UMWANDELN_SPEICHER_MB", "UMWANDELN_ZEITLIMIT_S", "BILD_MODELL_HINTERGRUND", "BILD_MODELL_SKALIEREN"):
                    if k in os.environ:
                        umgebung[k] = os.environ[k]
                p = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--bild", datei, auftrag, ausgang], cwd=d, env=umgebung,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=_grenzen_setzen)
                try:
                    aus, fehler = p.communicate(timeout=UMWANDELN_ZEITLIMIT)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.communicate()
                    raise Fehler(408, f"Bildbearbeitung nach {UMWANDELN_ZEITLIMIT} s abgebrochen (Zeitlimit).")
                try:
                    r = json.loads(aus.decode("utf-8"))
                except ValueError:
                    letzte = fehler.decode("utf-8", "replace").strip().splitlines()[-1:] or [f"Exit-Code {p.returncode}"]
                    raise Fehler(500, f"Bildbearbeitung abgestürzt ({letzte[0][:200]}) – vermutlich zu wenig Speicher für dieses Bild.")
                if not r.get("ok"):
                    raise Fehler(422, r.get("fehler") or "Bildbearbeitung fehlgeschlagen.")
                if os.path.getsize(ausgang) > BILD_AUSGABE_MAX:
                    raise Fehler(413, f"Ergebnis zu groß (über {BILD_AUSGABE_MAX // 1024 // 1024} MB) – bitte kleiner oder als JPG.")
                with open(ausgang, "rb") as f:
                    daten = f.read()
                del r["ok"]
                return {"version": BILD_VERSION, **r, "groesse": len(daten), "inhalt_b64": base64.b64encode(daten).decode()}
            finally:
                shutil.rmtree(d, ignore_errors=True)
        finally:
            for _ in range(geholt):
                UMWANDELN_GLEICHZEITIG.release()


def aufraeumen_alt():
    while True:
        jetzt = time.time()
        for n in os.listdir(ARBEIT):
            if n == ".umwandeln":
                continue  # jede Umwandlung räumt ihren Ordner selbst weg
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
            if weg == "/bild":  # E198
                inhalt = base64.b64decode(b.get("inhalt_b64") or "", validate=True)
                return self.antwort(200, bild(b.get("name"), inhalt, b.get("schritte"), b.get("format") or "png", b.get("qualitaet")))
            if weg == "/bild/kann":  # E198
                return self.antwort(200, bild_faehigkeiten())
            if weg == "/umwandeln":
                inhalt = base64.b64decode(b.get("inhalt_b64") or "", validate=True)
                return self.antwort(200, umwandeln(b.get("name"), inhalt))
            raum = raum_pfad(b.get("raum"))
            if weg == "/befehl":
                return self.antwort(200, befehl(raum, b.get("befehl"), b.get("zeitlimit")))
            if weg == "/werkzeug":
                return self.antwort(200, werkzeug(raum, b.get("auftrag")))
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
    if len(sys.argv) == 4 and sys.argv[1] == "--umwandeln":
        return umwandeln_kind(sys.argv[2], sys.argv[3])
    if len(sys.argv) == 5 and sys.argv[1] == "--bild":  # E198
        return bild_kind(sys.argv[2], sys.argv[3], sys.argv[4])
    if not GEHEIMNIS:
        raise SystemExit("RECHENRAUM_GEHEIMNIS fehlt.")
    os.makedirs(ARBEIT, exist_ok=True)
    if not os.access(ARBEIT, os.W_OK):
        raise SystemExit(f"{ARBEIT} ist nicht beschreibbar.")
    threading.Thread(target=aufraeumen_alt, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
