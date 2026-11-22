#!/usr/bin/env python3
"""
Dorfwerk (E199): feste Werkzeuge im Rechenraum, die das Dorf für Agenten aufruft – PDF bearbeiten, Diagramme (Graphviz),
QR-Codes, Anki-Pakete, Datenabfragen (DuckDB/pandas) und Handschrift (E212, handschrift.py). Ohne Shell, ohne Internet,
ohne Vault.

Aufruf NUR über runner.py (/werkzeug): `python3 dorfwerk.py <auftrag.json>` im Arbeitsordner des Raums, als Kindprozess
mit Zeit- und Speichergrenze (wie /umwandeln). Eingaben sind Dateien im Arbeitsordner (das Dorf kopiert Vault-Dateien
hinein), Ausgaben landen im Arbeitsordner; das Dorf legt sie in den vom Code bestimmten Ordner im Vault.

Ergebnis als JSON auf stdout: {"ok": true, "text": "...", "dateien": ["name.pdf"]} oder {"ok": false, "fehler": "..."}.

Pakete (Image, feste Versionen): pypdf (BSD-3), Ghostscript (gs, AGPL – nur zum Verkleinern), Graphviz (dot, EPL),
segno (BSD-3), genanki (MIT), duckdb (MIT), pandas/openpyxl (BSD/MIT). Fehlt eines, sagt das Ergebnis es ehrlich.
"""
import csv
import hashlib
import html
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys

MAX_EINGABEN = 20
MAX_SEITEN = 2000
MAX_TEILE = 60
MAX_ZEILEN_ANZEIGE = 100
MAX_ZEILEN_CSV = 200_000
MAX_KARTEN = 10_000
MAX_DIAGRAMM = 100_000
MAX_QR = 2_000


class Fehler(Exception):
    pass


# ---- Hilfen -------------------------------------------------------------------------------------------------------

def im_ordner(rel):
    """Pfad relativ zum Arbeitsordner – nie hinaus (auch nicht über Symlinks)."""
    if not isinstance(rel, str) or not rel or "\x00" in rel or rel.startswith("/"):
        raise Fehler("Ungültiger Pfad.")
    teile = [t for t in rel.replace("\\", "/").split("/") if t not in ("", ".")]
    if not teile or any(t == ".." for t in teile):
        raise Fehler("Pfad darf nicht aus dem Arbeitsordner hinausführen.")
    wurzel = os.path.realpath(os.getcwd())
    p = os.path.join(wurzel, *teile)
    echt = os.path.realpath(p)
    if echt != wurzel and not echt.startswith(wurzel + os.sep):
        raise Fehler("Pfad zeigt aus dem Arbeitsordner hinaus.")
    return p


def eingabe_datei(rel):
    p = im_ordner(rel)
    if not os.path.isfile(p):
        raise Fehler(f"Datei fehlt im Arbeitsordner: {rel}")
    return p


def ausgabe_name(roh, endung, standard):
    """Dateiname für ein Ergebnis: nur A–Z, a–z, 0–9, . _ -, feste Endung, im Arbeitsordner."""
    basis = os.path.basename(str(roh or "").replace("\\", "/"))
    if basis.lower().endswith(endung):
        basis = basis[: -len(endung)]
    basis = re.sub(r"[^A-Za-z0-9._-]+", "_", basis).strip("._-")[:80] or standard
    return basis + endung


def hat_modul(name):
    try:
        __import__(name)
        return True
    except Exception:  # noqa: BLE001
        return False


def groesse_text(n):
    return f"{n / 1024 / 1024:.1f} MB".replace(".", ",") if n >= 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def seiten_liste(spec, anzahl):
    """'1-3,5,8-' → 0-basierte Seiten in der angegebenen Reihenfolge; '5-3' = rückwärts; leer = alle Seiten."""
    if spec is None or not str(spec).strip():
        return list(range(anzahl))
    aus = []
    for teil in str(spec).replace(" ", "").split(","):
        if not teil:
            continue
        m = re.fullmatch(r"(\d*)-(\d*)", teil)
        if m:
            a = int(m.group(1)) if m.group(1) else 1
            b = int(m.group(2)) if m.group(2) else anzahl
            if min(a, b) < 1 or max(a, b) > anzahl:
                raise Fehler(f"Seiten „{teil}“ passen nicht – das Dokument hat {anzahl} Seite(n).")
            aus.extend(range(a - 1, b) if a <= b else range(a - 1, b - 2, -1))
        elif re.fullmatch(r"\d+", teil):
            n = int(teil)
            if n < 1 or n > anzahl:
                raise Fehler(f"Seite {n} gibt es nicht – das Dokument hat {anzahl} Seite(n).")
            aus.append(n - 1)
        else:
            raise Fehler(f"Seitenangabe „{teil}“ nicht verstanden (Beispiele: 1-3,5 · 4- · 7).")
    if not aus:
        raise Fehler("Keine Seiten angegeben.")
    return aus


# ---- PDF (pypdf) --------------------------------------------------------------------------------------------------

def _pdf(pfad):
    if not hat_modul("pypdf"):
        raise Fehler("pypdf fehlt im Rechenraum – PDF-Werkzeuge gehen hier nicht.")
    from pypdf import PdfReader
    r = PdfReader(pfad)
    if r.is_encrypted:
        try:
            ok = r.decrypt("")
        except Exception:  # noqa: BLE001
            ok = 0
        if not ok:
            raise Fehler(f"{os.path.basename(pfad)} ist passwortgeschützt – das geht nicht.")
    if len(r.pages) > MAX_SEITEN:
        raise Fehler(f"Zu viele Seiten (höchstens {MAX_SEITEN}).")
    return r


def _schreiben(writer, name):
    with open(im_ordner(name), "wb") as f:
        writer.write(f)
    return name


def _wasserzeichen_pdf(breite, hoehe, text):
    """Eine Seite mit diagonalem, halbtransparentem Text (Helvetica, WinAnsi) – reines PDF ohne Zusatzpakete."""
    roh = text.encode("cp1252", "replace")
    esc = roh.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
    diagonale = math.hypot(breite, hoehe)
    groesse = max(10.0, min(110.0, 0.8 * diagonale / (0.6 * max(len(roh), 1))))
    w = 0.6 * groesse * len(roh)
    winkel = math.atan2(hoehe, breite)
    c, s = math.cos(winkel), math.sin(winkel)
    x = breite / 2 - c * w / 2 + s * groesse * 0.35
    y = hoehe / 2 - s * w / 2 - c * groesse * 0.35
    inhalt = b"q /GS1 gs 0.5 g BT /F1 %.2f Tf %.5f %.5f %.5f %.5f %.2f %.2f Tm (" % (groesse, c, s, -s, c, x, y) + esc + b") Tj ET Q"
    objekte = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /Font << /F1 4 0 R >> /ExtGState << /GS1 5 0 R >> >> /Contents 6 0 R >>"
        % (breite, hoehe),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Type /ExtGState /ca 0.22 /CA 0.22 >>",
        b"<< /Length %d >>\nstream\n" % len(inhalt) + inhalt + b"\nendstream",
    ]
    aus = bytearray(b"%PDF-1.4\n")
    stellen = []
    for i, o in enumerate(objekte, 1):
        stellen.append(len(aus))
        aus += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(aus)
    aus += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objekte) + 1)
    for st in stellen:
        aus += b"%010d 00000 n \n" % st
    aus += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objekte) + 1, xref)
    return bytes(aus)


def _feldwert(feld):
    v = feld.get("/V")
    return "" if v is None else str(v)


def pdf(a):
    namen = a.get("eingaben") or []
    if not isinstance(namen, list) or not namen:
        raise Fehler("Keine PDF-Datei angegeben.")
    if len(namen) > MAX_EINGABEN:
        raise Fehler(f"Höchstens {MAX_EINGABEN} Dateien.")
    pfade = [eingabe_datei(n) for n in namen]
    aktion = a.get("aktion")
    name = a.get("name")
    seiten = a.get("seiten")
    if not hat_modul("pypdf"):
        raise Fehler("pypdf fehlt im Rechenraum – PDF-Werkzeuge gehen hier nicht.")
    if aktion != "zusammenfuegen" and len(pfade) > 1:
        raise Fehler(f"„{aktion}“ nimmt genau eine PDF-Datei.")

    if aktion == "info":
        r = _pdf(pfade[0])
        mb = r.pages[0].mediabox if len(r.pages) else None
        felder = r.get_fields() or {}
        meta = r.metadata or {}
        zeilen = [
            f"Seiten: {len(r.pages)}",
            f"Größe: {groesse_text(os.path.getsize(pfade[0]))}",
        ]
        if mb is not None:
            zeilen.append(f"Format Seite 1: {round(float(mb.width) / 72 * 25.4)} × {round(float(mb.height) / 72 * 25.4)} mm")
        if meta.get("/Title"):
            zeilen.append(f"Titel: {meta.get('/Title')}")
        zeilen.append(f"Formularfelder: {len(felder)}" + (" (mit formular_lesen ansehen)" if felder else ""))
        return {"ok": True, "text": "\n".join(zeilen), "dateien": []}

    if aktion == "zusammenfuegen":
        from pypdf import PdfWriter
        w = PdfWriter()
        seitenzahl = 0
        for p in pfade:
            r = _pdf(p)
            seitenzahl += len(r.pages)
            if seitenzahl > MAX_SEITEN:
                raise Fehler(f"Zusammen zu viele Seiten (höchstens {MAX_SEITEN}).")
            w.append(r)
        aus = _schreiben(w, ausgabe_name(name, ".pdf", "zusammengefuegt"))
        return {"ok": True, "text": f"{len(pfade)} PDFs zusammengefügt: {seitenzahl} Seiten.", "dateien": [aus]}

    r = _pdf(pfade[0])
    n = len(r.pages)
    standard = re.sub(r"[^A-Za-z0-9_-]+", "_", os.path.splitext(os.path.basename(namen[0]))[0]).strip("_") or "dokument"

    if aktion == "teilen":
        from pypdf import PdfWriter
        gruppen = [g for g in str(seiten or "").split(";") if g.strip()] or [str(i + 1) for i in range(n)]
        if len(gruppen) > MAX_TEILE:
            raise Fehler(f"Höchstens {MAX_TEILE} Teile – gib Bereiche an, z. B. „1-3;4-6;7-“.")
        basis = ausgabe_name(name, ".pdf", standard)[:-4]
        dateien = []
        for i, g in enumerate(gruppen, 1):
            w = PdfWriter()
            for s in seiten_liste(g, n):
                w.add_page(r.pages[s])
            dateien.append(_schreiben(w, f"{basis}_teil{i}.pdf"))
        return {"ok": True, "text": f"In {len(dateien)} Teile geteilt.", "dateien": dateien}

    if aktion in ("seiten_drehen", "seiten_loeschen", "seiten_ordnen"):
        from pypdf import PdfWriter
        w = PdfWriter()
        if aktion == "seiten_drehen":
            grad = int(a.get("grad") or 90)
            if grad % 90 != 0:
                raise Fehler("Drehen nur um 90, 180 oder 270 Grad.")
            gewaehlt = set(seiten_liste(seiten, n))
            for i, s in enumerate(r.pages):
                w.add_page(s)
                if i in gewaehlt:
                    w.pages[-1].rotate(grad % 360)
            text = f"{len(gewaehlt)} Seite(n) um {grad % 360}° gedreht."
            zusatz = "gedreht"
        elif aktion == "seiten_loeschen":
            if not seiten:
                raise Fehler("Welche Seiten sollen weg? seiten angeben, z. B. „2,5-6“.")
            weg = set(seiten_liste(seiten, n))
            if len(weg) >= n:
                raise Fehler("Alle Seiten zu löschen geht nicht.")
            for i, s in enumerate(r.pages):
                if i not in weg:
                    w.add_page(s)
            text = f"{len(weg)} Seite(n) entfernt, {n - len(weg)} bleiben."
            zusatz = "gekuerzt"
        else:
            if not seiten:
                raise Fehler("Neue Reihenfolge fehlt, z. B. seiten: „3,1,2,4-“.")
            reihe = seiten_liste(seiten, n)
            for i in reihe:
                w.add_page(r.pages[i])
            fehlen = n - len(set(reihe))
            text = f"Neu geordnet: {len(reihe)} Seiten." + (f" {fehlen} Seite(n) kamen in der Reihenfolge nicht vor und fehlen jetzt." if fehlen else "")
            zusatz = "geordnet"
        aus = _schreiben(w, ausgabe_name(name, ".pdf", f"{standard}_{zusatz}"))
        return {"ok": True, "text": text, "dateien": [aus]}

    if aktion == "komprimieren":
        vorher = os.path.getsize(pfade[0])
        kandidaten = []
        gs = shutil.which("gs")
        if gs:
            ziel = im_ordner(".dorfwerk/klein_gs.pdf")
            os.makedirs(os.path.dirname(ziel), exist_ok=True)
            erg = subprocess.run(
                [gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", "-dPDFSETTINGS=/ebook", "-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER",
                 f"-sOutputFile={ziel}", pfade[0]],
                capture_output=True, timeout=100,
            )
            if erg.returncode == 0 and os.path.isfile(ziel) and os.path.getsize(ziel) > 0:
                try:
                    if len(_pdf(ziel).pages) == n:
                        kandidaten.append(ziel)
                except Fehler:
                    pass
        from pypdf import PdfWriter
        w = PdfWriter(clone_from=r)
        for s in w.pages:
            s.compress_content_streams()
        try:
            w.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        except Exception:  # noqa: BLE001 – ältere pypdf: nur Inhaltsströme
            pass
        ziel = _schreiben(w, ".dorfwerk/klein_pypdf.pdf")
        kandidaten.append(im_ordner(ziel))
        bester = min(kandidaten, key=os.path.getsize)
        nachher = os.path.getsize(bester)
        if nachher >= vorher * 0.97:
            return {"ok": True, "text": f"Lässt sich kaum verkleinern ({groesse_text(vorher)}){'' if gs else ' – Ghostscript fehlt, nur verlustfrei versucht'}. Keine neue Datei.", "dateien": []}
        aus = ausgabe_name(name, ".pdf", f"{standard}_klein")
        shutil.copyfile(bester, im_ordner(aus))
        art = "Bilder auf 150 dpi (Ghostscript)" if bester.endswith("klein_gs.pdf") else "verlustfrei"
        return {"ok": True, "text": f"Verkleinert: {groesse_text(vorher)} → {groesse_text(nachher)} ({art}).", "dateien": [aus]}

    if aktion == "wasserzeichen":
        text = str(a.get("text") or "").strip()
        if not text or len(text) > 80:
            raise Fehler("Wasserzeichen-Text fehlt (höchstens 80 Zeichen).")
        from pypdf import PdfReader, PdfWriter, Transformation
        gewaehlt = set(seiten_liste(seiten, n))
        w = PdfWriter(clone_from=r)
        zwischen = {}
        for i, s in enumerate(w.pages):
            if i not in gewaehlt:
                continue
            mb = s.mediabox
            schluessel = (round(float(mb.width), 1), round(float(mb.height), 1))
            if schluessel not in zwischen:
                zwischen[schluessel] = PdfReader(io.BytesIO(_wasserzeichen_pdf(schluessel[0], schluessel[1], text))).pages[0]
            s.merge_transformed_page(zwischen[schluessel], Transformation().translate(float(mb.left), float(mb.bottom)))
        aus = _schreiben(w, ausgabe_name(name, ".pdf", f"{standard}_wasserzeichen"))
        return {"ok": True, "text": f"Wasserzeichen „{text}“ auf {len(gewaehlt)} Seite(n).", "dateien": [aus]}

    if aktion == "formular_lesen":
        felder = r.get_fields() or {}
        if not felder:
            return {"ok": True, "text": "Keine ausfüllbaren Formularfelder (AcroForm). XFA-Formulare und eingescannte Formulare gehen nicht.", "dateien": []}
        arten = {"/Tx": "Text", "/Btn": "Kästchen/Knopf", "/Ch": "Auswahl", "/Sig": "Unterschrift"}
        zeilen = []
        for fname, f in list(felder.items())[:300]:
            art = arten.get(str(f.get("/FT")), str(f.get("/FT") or "?"))
            zus = ""
            if f.get("/_States_"):
                zus = f" – Werte: {', '.join(str(x) for x in f.get('/_States_'))}"
            elif f.get("/Opt"):
                zus = f" – Auswahl: {', '.join(str(x if not isinstance(x, list) else x[-1]) for x in f.get('/Opt'))[:300]}"
            zeilen.append(f"- {fname} ({art}){': ' + _feldwert(f) if _feldwert(f) else ''}{zus}")
        return {"ok": True, "text": f"{len(felder)} Formularfeld(er):\n" + "\n".join(zeilen), "dateien": []}

    if aktion == "formular_ausfuellen":
        werte = a.get("felder")
        if not isinstance(werte, dict) or not werte:
            raise Fehler("felder fehlt: {\"Feldname\": \"Wert\", …} (Namen mit formular_lesen ansehen).")
        felder = r.get_fields() or {}
        if not felder:
            raise Fehler("Dieses PDF hat keine ausfüllbaren Formularfelder (AcroForm).")
        unbekannt = [k for k in werte if k not in felder]
        if unbekannt:
            raise Fehler(f"Unbekannte Felder: {', '.join(unbekannt[:10])}. Vorhanden: {', '.join(list(felder)[:40])}")
        fertig = {}
        for k, v in werte.items():
            f = felder[k]
            zustaende = [str(x) for x in (f.get("/_States_") or [])]
            if str(f.get("/FT")) == "/Btn" and zustaende:
                an = [z for z in zustaende if z != "/Off"]
                ja = v is True or str(v).strip().lower() in ("ja", "true", "1", "x", "yes", "an", "on")
                passend = [z for z in zustaende if z.lstrip("/").lower() == str(v).lstrip("/").lower()]
                fertig[k] = passend[0] if passend else ((an[0] if an else "/Yes") if ja else "/Off")
            else:
                fertig[k] = "" if v is None else str(v)[:2000]
        from pypdf import PdfWriter
        w = PdfWriter(clone_from=r)
        for s in w.pages:
            if s.get("/Annots"):
                w.update_page_form_field_values(s, fertig, auto_regenerate=False)
        try:
            w.set_need_appearances_writer(True)
        except Exception:  # noqa: BLE001
            pass
        aus = _schreiben(w, ausgabe_name(name, ".pdf", f"{standard}_ausgefuellt"))
        return {"ok": True, "text": f"{len(fertig)} Feld(er) ausgefüllt. Abgeschickt wird nichts – Leif prüft und reicht selbst ein.", "dateien": [aus]}

    raise Fehler(f"Unbekannte PDF-Aktion „{aktion}“.")


# ---- Diagramme (Graphviz) -----------------------------------------------------------------------------------------

PROGRAMME = ("dot", "neato", "fdp", "circo", "twopi")
MERMAID = re.compile(r"^\s*(graph\s+(TD|TB|BT|RL|LR)|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|journey|timeline|gitGraph)\b")


def diagramm(a):
    quelle = str(a.get("quelle") or "")
    if not quelle.strip():
        raise Fehler("Diagramm-Quelle fehlt (Graphviz DOT, z. B. „digraph { A -> B }“).")
    if len(quelle) > MAX_DIAGRAMM:
        raise Fehler("Diagramm-Quelle zu lang.")
    if MERMAID.match(quelle):
        raise Fehler("Das ist Mermaid – dafür bräuchte der Rechenraum einen Browser. Schreib den ```mermaid-Block in eine Notiz "
                     "(Obsidian zeigt ihn an) oder formuliere das Diagramm in Graphviz DOT.")
    fmt = a.get("format") or "svg"
    if fmt not in ("svg", "png", "pdf"):
        raise Fehler("format: svg, png oder pdf.")
    programm = a.get("programm") or "dot"
    if programm not in PROGRAMME:
        raise Fehler(f"programm: {', '.join(PROGRAMME)}.")
    pfad = shutil.which(programm)
    if not pfad:
        raise Fehler("Graphviz fehlt im Rechenraum.")
    os.makedirs(im_ordner(".dorfwerk"), exist_ok=True)
    quelle_datei = im_ordner(".dorfwerk/diagramm.dot")
    with open(quelle_datei, "w", encoding="utf-8") as f:
        f.write(quelle)
    aus = ausgabe_name(a.get("name"), "." + fmt, "diagramm")
    befehl = [pfad, f"-T{fmt}", "-o", im_ordner(aus), quelle_datei]
    if fmt == "png":
        befehl.insert(1, "-Gdpi=150")
    erg = subprocess.run(befehl, capture_output=True, timeout=60)
    meldung = erg.stderr.decode("utf-8", "replace").strip()
    if erg.returncode != 0 or not os.path.isfile(im_ordner(aus)):
        raise Fehler(f"Graphviz meldet einen Fehler: {meldung[-800:] or f'Exit-Code {erg.returncode}'}")
    return {"ok": True, "text": f"Diagramm gezeichnet ({fmt.upper()}, {groesse_text(os.path.getsize(im_ordner(aus)))})." + (f" Hinweis: {meldung[-300:]}" if meldung else ""), "dateien": [aus]}


# ---- QR-Code (segno) ----------------------------------------------------------------------------------------------

def qr(a):
    inhalt = str(a.get("inhalt") or "")
    if not inhalt.strip():
        raise Fehler("Inhalt fehlt (Text, Link, WLAN-Daten …).")
    if len(inhalt) > MAX_QR:
        raise Fehler(f"Zu lang für einen QR-Code (höchstens {MAX_QR} Zeichen).")
    if not hat_modul("segno"):
        raise Fehler("segno fehlt im Rechenraum – QR-Codes gehen hier nicht.")
    import segno
    fmt = a.get("format") or "png"
    if fmt not in ("png", "svg"):
        raise Fehler("format: png oder svg.")
    q = segno.make(inhalt, error="m", micro=False)
    aus = ausgabe_name(a.get("name"), "." + fmt, "qr-code")
    q.save(im_ordner(aus), kind=fmt, scale=10, border=4)
    return {"ok": True, "text": f"QR-Code erzeugt (Version {q.version}, {q.symbol_size(scale=1, border=0)[0]}×{q.symbol_size(scale=1, border=0)[1]} Module, {fmt.upper()}).", "dateien": [aus]}


# ---- Anki (genanki) -----------------------------------------------------------------------------------------------

def _anki_html(t):
    """Markdown-nahe Karteikarte → Anki-HTML: escapen, Zeilenumbrüche, **fett**, $…$ → MathJax \\(…\\)."""
    t = html.escape(str(t), quote=False)
    t = re.sub(r"\$\$(.+?)\$\$", lambda m: "\\[" + m.group(1) + "\\]", t, flags=re.S)
    t = re.sub(r"(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$", lambda m: "\\(" + m.group(1) + "\\)", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return t.replace("\r\n", "\n").replace("\n", "<br>")


def _stabile_id(text):
    """Anki braucht feste Zahlen-IDs: gleicher Name → gleiche ID → erneuter Import aktualisiert statt zu verdoppeln."""
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16) % (1 << 30) + (1 << 30)


def anki(a):
    fach = str(a.get("fach") or "").strip()
    karten = a.get("karten") or []
    if not fach:
        raise Fehler("Fach fehlt.")
    if not isinstance(karten, list) or not karten:
        raise Fehler(f"Keine Karteikarten für „{fach}“.")
    if len(karten) > MAX_KARTEN:
        raise Fehler(f"Zu viele Karten (höchstens {MAX_KARTEN}).")
    if not hat_modul("genanki"):
        raise Fehler("genanki fehlt im Rechenraum – Anki-Export geht hier nicht.")
    import genanki
    modell = genanki.Model(
        _stabile_id("agentendorf-modell-frage-antwort-v1"),
        "Agentendorf Frage/Antwort",
        fields=[{"name": "Frage"}, {"name": "Antwort"}],
        templates=[{"name": "Karte", "qfmt": "{{Frage}}", "afmt": "{{FrontSide}}<hr id=\"answer\">{{Antwort}}"}],
        css=".card { font-family: sans-serif; font-size: 20px; text-align: left; color: black; background-color: white; }",
    )
    stapel = genanki.Deck(_stabile_id(f"agentendorf-stapel:{fach}"), f"Agentendorf::{fach}")
    for k in karten:
        frage, antwort = str(k.get("frage") or ""), str(k.get("antwort") or "")
        if not frage.strip() or not antwort.strip():
            continue
        stapel.add_note(genanki.Note(model=modell, fields=[_anki_html(frage), _anki_html(antwort)], guid=genanki.guid_for("agentendorf", fach, frage.strip())))
    if not stapel.notes:
        raise Fehler("Alle Karten waren leer.")
    aus = ausgabe_name(a.get("name") or fach, ".apkg", "karten")
    genanki.Package(stapel).write_to_file(im_ordner(aus))
    return {"ok": True, "text": f"Anki-Paket mit {len(stapel.notes)} Karte(n) für „{fach}“ (Stapel „Agentendorf::{fach}“). Erneuter Import aktualisiert die Karten.", "dateien": [aus]}


# ---- Datenabfrage (DuckDB, sonst pandas + SQLite) -----------------------------------------------------------------

TABELLEN_ENDUNGEN = {".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".xls", ".ods", ".json", ".parquet"}


def _tabellenname(name, vergeben):
    t = re.sub(r"[^a-z0-9_]+", "_", os.path.splitext(os.path.basename(name))[0].lower()).strip("_") or "tabelle"
    if t[0].isnumeric():
        t = "t_" + t
    basis, i = t, 2
    while t in vergeben:
        t, i = f"{basis}_{i}", i + 1
    vergeben.add(t)
    return t


def _wert(v):
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return ""
        v = round(v, 6)
        return str(int(v)) if v.is_integer() and abs(v) < 1e15 else str(v)
    t = str(v)
    return t if len(t) <= 80 else t[:77] + "…"


def md_tabelle(spalten, zeilen):
    zelle = lambda x: _wert(x).replace("|", "\\|").replace("\n", " ")  # noqa: E731
    kopf = "| " + " | ".join(zelle(s) for s in spalten) + " |"
    trenn = "|" + "---|" * len(spalten)
    return "\n".join([kopf, trenn] + ["| " + " | ".join(zelle(x) for x in z) + " |" for z in zeilen])


def _sql_pruefen(sql):
    s = sql.strip().rstrip(";").strip()
    if not s:
        return ""
    # genau EINE Anweisung (Semikolons nur in Zeichenketten sind erlaubt)
    ohne_text = re.sub(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"", "''", s)
    if ";" in ohne_text:
        raise Fehler("Nur EINE SQL-Anweisung je Aufruf.")
    if len(s) > 20_000:
        raise Fehler("SQL zu lang.")
    return s


def _pandas_laden(pfad, endung):
    import pandas as pd
    if endung in (".xlsx", ".xlsm", ".ods", ".xls"):
        return pd.read_excel(pfad, sheet_name=0)
    if endung == ".json":
        return pd.read_json(pfad)
    if endung == ".parquet":
        return pd.read_parquet(pfad)
    with open(pfad, encoding="utf-8", errors="replace") as f:
        probe = f.read(65536)
    try:
        trenner = csv.Sniffer().sniff(probe, delimiters=",;\t|").delimiter
    except csv.Error:
        trenner = ","
    if trenner == ";":  # wie oben: Komma als Dezimalzeichen, Punkt als Tausendertrenner
        return pd.read_csv(pfad, sep=";", decimal=",", thousands=".", encoding_errors="replace")
    return pd.read_csv(pfad, sep=trenner, encoding_errors="replace")


def daten(a):
    eingaben = a.get("eingaben") or []
    namen = a.get("namen") or eingaben
    if not isinstance(eingaben, list) or not eingaben:
        raise Fehler("Keine Datei angegeben (CSV, Excel, JSON, Parquet).")
    if len(eingaben) > MAX_EINGABEN:
        raise Fehler(f"Höchstens {MAX_EINGABEN} Dateien.")
    sql = _sql_pruefen(str(a.get("sql") or ""))
    vergeben = set()
    dateien = []
    for rel, name in zip(eingaben, namen):
        endung = os.path.splitext(str(name))[1].lower()
        if endung not in TABELLEN_ENDUNGEN:
            raise Fehler(f"{name}: kein Tabellenformat ({', '.join(sorted(TABELLEN_ENDUNGEN))}).")
        dateien.append((eingabe_datei(rel), endung, _tabellenname(str(name), vergeben), str(name)))

    if hat_modul("duckdb"):
        spalten, zeilen, uebersicht, motor = _duckdb(dateien, sql)
    elif hat_modul("pandas"):
        spalten, zeilen, uebersicht, motor = _sqlite(dateien, sql)
    else:
        raise Fehler("Weder DuckDB noch pandas im Rechenraum – Datenabfragen gehen hier nicht.")
    if uebersicht is not None:
        return {"ok": True, "text": uebersicht + "\n\nFrag jetzt mit sql ab (Tabellennamen wie oben).", "dateien": []}
    teile = [f"{len(zeilen)} Zeile(n), {len(spalten)} Spalte(n) ({motor})."]
    teile.append(md_tabelle(spalten, zeilen[:MAX_ZEILEN_ANZEIGE]))
    if len(zeilen) > MAX_ZEILEN_ANZEIGE:
        teile.append(f"… {len(zeilen) - MAX_ZEILEN_ANZEIGE} weitere Zeile(n) – für alle: als_csv.")
    aus = []
    if a.get("als_csv"):
        n = ausgabe_name(a.get("name"), ".csv", "ergebnis")
        with open(im_ordner(n), "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(spalten)
            for z in zeilen:
                w.writerow(["" if x is None else x for x in z])
        aus.append(n)
    return {"ok": True, "text": "\n".join(teile), "dateien": aus}


def _sql_text(s):
    return "'" + s.replace("'", "''") + "'"


DE_ZAHL = r"-?[0-9]{1,3}([.][0-9]{3})+(,[0-9]+)?|-?[0-9]+,[0-9]+"


def _tausender_reparieren(con, tabelle):
    """Spalten wie „-1.234,50“ (Tausenderpunkt) bleiben beim Einlesen Text – wenn ALLE Werte so aussehen, werden sie Zahlen."""
    for name, typ, *_ in con.execute(f'DESCRIBE "{tabelle}"').fetchall():
        if typ != "VARCHAR":
            continue
        spalte = '"' + name.replace('"', '""') + '"'
        alle, anzahl = con.execute(
            f"SELECT bool_and(regexp_full_match(trim({spalte}), '{DE_ZAHL}')), count({spalte}) FROM \"{tabelle}\" WHERE trim({spalte}) <> ''"
        ).fetchone()
        if alle and anzahl:
            con.execute(f'ALTER TABLE "{tabelle}" ALTER {spalte} TYPE DOUBLE USING '
                        f"CAST(NULLIF(replace(replace(trim({spalte}), '.', ''), ',', '.'), '') AS DOUBLE)")


def _duckdb(dateien, sql):
    import duckdb
    con = duckdb.connect(":memory:", config={"memory_limit": "256MB", "threads": "1"})
    for pfad, endung, tabelle, _ in dateien:
        if endung in (".csv", ".tsv", ".txt"):
            # Österreich/Deutschland: „;“ als Trenner heißt fast immer Komma als Dezimalzeichen (Bank-Exporte, Excel)
            trenner = con.execute(f"SELECT Delimiter FROM sniff_csv({_sql_text(pfad)})").fetchone()[0]
            zusatz = ", decimal_separator=','" if trenner == ";" else ""
            con.execute(f'CREATE TABLE "{tabelle}" AS SELECT * FROM read_csv_auto({_sql_text(pfad)}, sample_size=-1{zusatz})')
            if trenner == ";":
                _tausender_reparieren(con, tabelle)
        elif endung == ".json":
            con.execute(f'CREATE TABLE "{tabelle}" AS SELECT * FROM read_json_auto({_sql_text(pfad)})')
        elif endung == ".parquet":
            con.execute(f'CREATE TABLE "{tabelle}" AS SELECT * FROM read_parquet({_sql_text(pfad)})')
        else:
            if not hat_modul("pandas"):
                raise Fehler("Excel/ODS braucht pandas – fehlt im Rechenraum.")
            df = _pandas_laden(pfad, endung)
            con.register("_eingang", df)
            con.execute(f'CREATE TABLE "{tabelle}" AS SELECT * FROM _eingang')
            con.unregister("_eingang")
    # Ab hier keine Dateien mehr: Abfragen sehen nur die geladenen Tabellen (kein read_csv('/…'), kein COPY … TO)
    con.execute("SET enable_external_access = false")
    con.execute("SET lock_configuration = true")
    if not sql:
        teile = []
        for _, _, tabelle, name in dateien:
            spalten = con.execute(f'DESCRIBE "{tabelle}"').fetchall()
            n = con.execute(f'SELECT COUNT(*) FROM "{tabelle}"').fetchone()[0]
            cur = con.execute(f'SELECT * FROM "{tabelle}" LIMIT 5')
            teile.append(f"Tabelle {tabelle} (aus {name}): {n} Zeilen\nSpalten: " + ", ".join(f"{s[0]} ({s[1]})" for s in spalten)
                         + "\n" + md_tabelle([d[0] for d in cur.description], cur.fetchall()))
        return [], [], "\n\n".join(teile), "DuckDB"
    try:
        cur = con.execute(sql)
    except duckdb.Error as e:
        raise Fehler(f"SQL-Fehler: {str(e)[:800]}") from None
    if cur.description is None:
        return ["ergebnis"], [["(keine Ergebniszeilen)"]], None, "DuckDB"
    spalten = [d[0] for d in cur.description]
    zeilen = cur.fetchmany(MAX_ZEILEN_CSV)
    return spalten, zeilen, None, "DuckDB"


def _sqlite(dateien, sql):
    import sqlite3
    con = sqlite3.connect(":memory:")
    for pfad, endung, tabelle, _ in dateien:
        _pandas_laden(pfad, endung).to_sql(tabelle, con, index=False)
    if not sql:
        teile = []
        for _, _, tabelle, name in dateien:
            spalten = con.execute(f'PRAGMA table_info("{tabelle}")').fetchall()
            n = con.execute(f'SELECT COUNT(*) FROM "{tabelle}"').fetchone()[0]
            cur = con.execute(f'SELECT * FROM "{tabelle}" LIMIT 5')
            teile.append(f"Tabelle {tabelle} (aus {name}): {n} Zeilen\nSpalten: " + ", ".join(f"{s[1]} ({s[2] or '?'})" for s in spalten)
                         + "\n" + md_tabelle([d[0] for d in cur.description], cur.fetchall()))
        return [], [], "\n\n".join(teile), "SQLite"
    try:
        cur = con.execute(sql)
    except sqlite3.Error as e:
        raise Fehler(f"SQL-Fehler: {str(e)[:800]}") from None
    if cur.description is None:
        return ["ergebnis"], [["(keine Ergebniszeilen)"]], None, "SQLite"
    return [d[0] for d in cur.description], cur.fetchmany(MAX_ZEILEN_CSV), None, "SQLite"


# ---- Einstieg -----------------------------------------------------------------------------------------------------

# ---- Handschrift (E212, handschrift.py) ----------------------------------------------------------------------------

def handschrift(a):
    try:
        import handschrift as hs
    except ImportError as e:
        raise Fehler(f"Handschrift fehlt im Rechenraum ({e}).")
    fmt = a.get("format") or "png"
    if fmt not in ("png", "svg", "pdf"):
        raise Fehler("format: png, svg oder pdf.")
    try:
        unordnung = float(a.get("unordnung", 0.5))
        groesse = float(a.get("groesse", 1.0))
    except (TypeError, ValueError):
        raise Fehler("unordnung (0–1) und groesse (0,6–1,6) sind Zahlen.")
    papier = a.get("papier") or "blanko"
    tinte = a.get("tinte") or "blau"
    seed = a.get("seed")
    if seed is not None and not isinstance(seed, int):
        raise Fehler("seed: ganze Zahl.")
    try:
        stil = a.get("stil") or "einheitlich"
        erg = hs.schreiben(str(a.get("text") or ""), unordnung=unordnung, papier=papier, tinte=tinte, groesse=groesse,
                           durchstreichen=a.get("durchstreichen", True) is not False, seed=seed, stil=stil)
    except hs.HandschriftFehler as e:
        raise Fehler(str(e))
    seiten = erg["seiten"]
    if not seiten:
        raise Fehler("Nichts zu schreiben.")
    basis = ausgabe_name(re.sub(r"\.(png|svg|pdf)$", "", str(a.get("name") or ""), flags=re.I), ".svg", "handschrift")[:-4]
    os.makedirs(im_ordner(".dorfwerk"), exist_ok=True)
    svgs = []
    for i, svg in enumerate(seiten, 1):
        name = f"{basis}.svg" if len(seiten) == 1 else f"{basis}-{i}.svg"
        ziel = im_ordner(name if fmt == "svg" else f".dorfwerk/{name}")
        with open(ziel, "w", encoding="utf-8") as f:
            f.write(svg)
        svgs.append((name, ziel))
    dateien = []
    if fmt == "svg":
        dateien = [n for n, _ in svgs]
    else:
        rsvg = shutil.which("rsvg-convert")
        if not rsvg:
            raise Fehler("rsvg-convert fehlt im Rechenraum – nur svg geht.")
        if fmt == "pdf":
            aus = f"{basis}.pdf"
            r = subprocess.run([rsvg, "-f", "pdf", "-o", im_ordner(aus)] + [z for _, z in svgs], capture_output=True, timeout=60)
            if r.returncode != 0 or not os.path.isfile(im_ordner(aus)):
                raise Fehler(f"PDF ging nicht: {r.stderr.decode('utf-8', 'replace')[-300:]}")
            dateien = [aus]
        else:
            for name, z in svgs:
                aus = name[:-4] + ".png"
                r = subprocess.run([rsvg, "-f", "png", "--dpi-x", "150", "--dpi-y", "150", "-o", im_ordner(aus), z], capture_output=True, timeout=60)
                if r.returncode != 0 or not os.path.isfile(im_ordner(aus)):
                    raise Fehler(f"PNG ging nicht: {r.stderr.decode('utf-8', 'replace')[-300:]}")
                dateien.append(aus)
    teile = [f"Handschrift geschrieben: {erg['zeilen']} Zeilen auf {len(seiten)} Seite(n), {fmt.upper()}."]
    if erg["verschrieben"]:
        teile.append(f"{erg['verschrieben']}× verschrieben und durchgestrichen (gewollt – abschalten mit durchstreichen: false).")
    if erg.get("formeln") or erg.get("tabellen"):
        teile.append(f"{erg.get('formeln', 0)} Formel(n) und {erg.get('tabellen', 0)} Tabelle(n) von Hand gesetzt (Rechenwege am „=“ ausgerichtet).")
    if erg["weggelassen"]:
        teile.append("Diese Zeichen kann die Handschrift nicht und hat sie weggelassen: " + " ".join(erg["weggelassen"]))
    if erg.get("unbekannt"):
        teile.append("Diese Formel-Befehle kennt der Formelsatz nicht (weggelassen): " + " ".join(erg["unbekannt"]))
    if stil == "ki":
        teile.append("Das KI-Modell verschreibt sich im Fließtext manchmal – bei wichtigen Texten Bild ansehen, sonst neu erzeugen.")
    return {"ok": True, "text": " ".join(teile), "dateien": dateien}


ARTEN = {"pdf": pdf, "diagramm": diagramm, "qr": qr, "anki": anki, "daten": daten, "handschrift": handschrift}


def ausfuehren(auftrag):
    if not isinstance(auftrag, dict) or auftrag.get("art") not in ARTEN:
        return {"ok": False, "fehler": f"Unbekannte Art – möglich: {', '.join(ARTEN)}."}
    try:
        erg = ARTEN[auftrag["art"]](auftrag)
    except Fehler as e:
        return {"ok": False, "fehler": str(e)}
    except subprocess.TimeoutExpired:
        return {"ok": False, "fehler": "Ein Programm brauchte zu lange und wurde abgebrochen."}
    except MemoryError:
        return {"ok": False, "fehler": "Zu wenig Speicher für diese Datei."}
    except Exception as e:  # noqa: BLE001 – nie abstürzen, sondern ehrlich melden
        return {"ok": False, "fehler": f"{type(e).__name__}: {str(e)[:500]}"}
    erg.setdefault("dateien", [])
    return erg


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Aufruf: dorfwerk.py <auftrag.json>")
    with open(sys.argv[1], encoding="utf-8") as f:
        auftrag = json.load(f)
    sys.stdout.write(json.dumps(ausfuehren(auftrag), ensure_ascii=False))


if __name__ == "__main__":
    main()
