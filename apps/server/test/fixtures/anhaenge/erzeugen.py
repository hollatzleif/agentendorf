#!/usr/bin/env python3
"""Erzeugt die Beispieldateien für die Anhang-Tests (E190) – alles selbst gemacht, nichts Fremdes.

Braucht: python-docx, openpyxl, python-pptx, Pillow, pillow-heif (nur für .heic), LibreOffice (odt/ods/odp/rtf/doc/xls),
ffmpeg (wav/mp4). Aufruf aus diesem Ordner: python3 erzeugen.py
"""
import email.message
import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import wave
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))


def pfad(n):
    return os.path.join(HIER, n)


def schreiben(n, inhalt, modus="w"):
    with open(pfad(n), modus, **({"encoding": "utf-8"} if "b" not in modus else {})) as f:
        f.write(inhalt)


def main():
    schreiben("notiz.txt", "Einkaufsliste für Leif\n- Äpfel\n- Brot\nKennwort: Rübezahl-Test\n")
    schreiben("rechnung.py", "def summe(a, b):\n    \"\"\"Addiert zwei Zahlen.\"\"\"\n    return a + b\n\nprint(summe(20, 22))\n")
    schreiben("konto.csv", "datum;text;betrag\n2026-11-01;Miete;-650,00\n2026-11-03;Gehalt;1800,00\n")
    schreiben("daten.json", '{"fach": "Statistik", "ects": 6, "note": 1.7}\n')
    schreiben("seite.html", "<html><head><title>T</title><style>p{color:red}</style><script>alert('weg')</script></head>"
              "<body><h1>Prüfungsinfo</h1><p>Die Klausur ist am <b>12. Dezember</b>.</p><ul><li>Hörsaal 1</li><li>90 Minuten</li></ul>"
              "<a href=\"https://example.org/info\">Mehr</a></body></html>")
    schreiben("grafik.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><title>Balken Umsatz</title>'
              '<rect x="10" y="10" width="80" height="80" fill="#c33"/><text x="100" y="55">Umsatz 2026</text></svg>')
    schreiben("brief.rtf", r"{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}{\colortbl;\red255\green0\blue0;}"
              r"\f0 Sehr geehrte Frau M\'fcller,\par die Abgabe kommt am Freitag.\par Gr\u252?\'dfe\par}")

    from docx import Document
    d = Document()
    d.add_heading("Bewerbung Praktikum", level=1)
    d.add_paragraph("Ich bewerbe mich um das Praktikum im Sommer.")
    d.add_heading("Kenntnisse", level=2)
    d.add_paragraph("Python", style="List Bullet")
    d.add_paragraph("Statistik", style="List Bullet")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text, t.cell(1, 0).text, t.cell(1, 1).text = "Fach", "Note", "Analysis", "1,3"
    d.save(pfad("brief.docx"))

    import datetime
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"
    ws.append(["Monat", "Ausgaben", "Datum"])
    ws.append(["Jänner", 812.5, datetime.date(2026, 1, 31)])
    ws.append(["Februar", 790, datetime.date(2026, 2, 28)])
    ws2 = wb.create_sheet("Notizen")
    ws2["A1"] = "Sparziel Laptop"
    wb.save(pfad("budget.xlsx"))

    from pptx import Presentation
    p = Presentation()
    s = p.slides.add_slide(p.slide_layouts[1])
    s.shapes.title.text = "Lineare Regression"
    s.placeholders[1].text = "Kleinste Quadrate\nResiduen prüfen"
    s.notes_slide.notes_text_frame.text = "Hier das Beispiel mit den Mietpreisen zeigen."
    s2 = p.slides.add_slide(p.slide_layouts[5])
    s2.shapes.title.text = "Zusammenfassung"
    p.save(pfad("folien.pptx"))

    if shutil.which("soffice"):
        with tempfile.TemporaryDirectory() as t:
            for quelle, ziel in (("brief.docx", "odt"), ("budget.xlsx", "ods"), ("folien.pptx", "odp"), ("brief.docx", "doc"), ("budget.xlsx", "xls")):
                subprocess.run(["soffice", "--headless", f"-env:UserInstallation=file://{t}/profil", "--convert-to", ziel, "--outdir", t, pfad(quelle)],
                               check=True, capture_output=True)
                shutil.copy(os.path.join(t, os.path.splitext(quelle)[0] + "." + ziel), HIER)

    m = email.message.EmailMessage()
    m["From"] = "Prof. Beispiel <prof@example.org>"
    m["To"] = "leif@example.org"
    m["Subject"] = "Unterlagen zur Übung"
    m["Date"] = "Wed, 18 Nov 2026 10:00:00 +0100"
    m.set_content("Hallo Leif,\nim Anhang die Angabe.\nGrüße")
    m.add_attachment(b"Aufgabe 1: Berechne den Mittelwert von 2, 4, 6.\n", maintype="text", subtype="plain", filename="angabe.txt")
    schreiben("mail.eml", m.as_bytes(), "wb")

    with zipfile.ZipFile(pfad("paket.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("ordner/liesmich.txt", "Das ist die Angabe im Archiv.\n")
        z.write(pfad("konto.csv"), "konto.csv")
        z.write(pfad("brief.docx"), "unterlagen/brief.docx")
    with tarfile.open(pfad("sicherung.tar.gz"), "w:gz") as t:
        daten = "Tagebuch im Tar-Archiv\n".encode()
        info = tarfile.TarInfo("tagebuch.md")
        info.size = len(daten)
        t.addfile(info, io.BytesIO(daten))

    from PIL import Image, ImageDraw
    b = Image.new("RGB", (120, 60), "white")
    ImageDraw.Draw(b).rectangle([10, 10, 60, 50], fill="blue")
    b.save(pfad("foto.png"))
    b.save(pfad("scan.bmp"))
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
        b.save(pfad("handy.heic"), quality=50)
    except ImportError:
        print("pillow-heif fehlt – handy.heic nicht erzeugt")

    with wave.open(pfad("ton.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=5", "-f", "lavfi", "-i",
                        "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", pfad("clip.mp4")], check=True)
    schreiben("unbekannt.xyz", bytes(range(256)) * 4, "wb")


if __name__ == "__main__":
    main()
