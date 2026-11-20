# Werkzeug-Ideen für die Agenten

Stand: 19.11.2026 · Recherche-Dokument, kein Beschluss. **Seit E199 (20.11.) gebaut:** Nr. 2, 3, 4 (Wasserzeichen), 36, 52, 32 (nur erzeugen), 71, 72, 78, 94, 95, 101 (nur Feiertage), 102, 104 sowie Einheiten (61, ohne Pint) – siehe `docs/werkzeuge-heute.md`. Davor schon: 1, 5, 7–10, 20, 86 (E190). Der Rest ist nicht gebaut. Vor jeder Umsetzung gilt wie immer: kurzer Plan, offene Fragen, Leifs Freigabe, Eintrag in `ENTSCHEIDUNGEN.md`.

## Einleitung

Die Liste sammelt 117 Fähigkeiten, die man den Agenten zusätzlich geben könnte. Aufgenommen ist nur, was kostenlos ist (Open Source oder Gratiskontingent) und auf einem kleinen VPS ohne Grafikkarte läuft – oder ehrlich als „nur bedingt“ gekennzeichnet ist.

**Was es schon gibt (und deshalb hier fehlt):** Websuche und Web-Abruf in beiden Motoren (`web_search`/`web_fetch` im api-Motor, `WebSearch`/`WebFetch` in der Werkstatt), pdflatex mit TikZ/Beamer, Python mit numpy/sympy/scipy/matplotlib, poppler, Moodle-Browser, Post-Entwürfe, Termine, To-dos, Kirchturm, Karteikarten, Wetter in der App (aber nicht als Agenten-Werkzeug).

**Die fünf Einbau-Wege**

| Weg | Wofür | Was zu beachten ist |
|---|---|---|
| **Rechenraum** (Paket ins Image) | alles, was ohne Netz rechnet: Dokumente, Bilder, Diagramme, Daten, Audio | Kein Internet, also müssen Modelle (Whisper, rembg, Piper-Stimmen, Tesseract-Sprachen) ins Image. Heute dürfen nur `.pdf`/`.tex` abgelegt werden – jede neue Art (png, svg, docx, xlsx, pptx, csv, mp3, apkg, zip) braucht eine Erweiterung der erlaubten Endungen in `rechenraum.ts`. 120 s je Befehl reichen für OCR/Transkription langer Dateien nicht. |
| **Dorf-Werkzeug** (`werkzeuge.ts`) | alles, was eine fremde API abruft | Der Server ruft ab, Schlüssel liegt in `/srv/dorf/.env`, Eintrag im `werkzeug_log`, Antwort mit Fremdinhalt-Hülle. Läuft in beiden Motoren (im claude-code-Motor über den MCP-Server „dorf“). Das ist der Normalweg. |
| **MCP in der Werkstatt** | fertige, offizielle MCP-Server | Nur claude-code-Motor. `--strict-mcp-config` heißt: `auftrag.ts` muss den Server eintragen. Fremde MCP-Server laufen an Leine und `werkzeug_log` vorbei – deshalb nur lesende, offizielle Server, sonst lieber als Dorf-Werkzeug nachbauen. |
| **Skill** (Aktion = Markdown) | Abläufe, die nur Anleitung brauchen | Die Werkstatt hat kein Bash, Skills mit Skripten laufen dort nicht. Skills sind hier also Aktionen, die `rechenraum_befehl` und andere Werkzeuge benutzen. |
| **Container** (Compose-Profil) | Dienste mit eigenem Speicherbedarf | Wie `browser`/`rechenraum`: internes Netz, Geheimnis, eigene Leine. Jeder Container kostet dauerhaft RAM. |

**Leine-Einstufung in der Tabelle**

- **frei** – liest nur oder schreibt ins eigene Gebäude (mit „Rückgängig“). Abrufe von außen sind Fremdinhalt.
- **Entwurf** – erzeugt etwas, das Leif selbst abschickt, unterschreibt oder bezahlt.
- **Freigabe** – wirkt nach außen oder lässt sich nicht zurückholen.

**Ehrlich zu den Grenzen**

- **Bilder generieren ohne GPU:** Lokal dauert ein Bild mit Stable Diffusion auf CPU Minuten und braucht 4–8 GB RAM – nicht sinnvoll. Realistisch ist eine Gratis-API. Googles Gemini-API hat für Bildmodelle laut Google-Forum kein Gratiskontingent.
- **Gratis-Limits ändern sich.** Brave Search hat 2026 die kostenlose Stufe gestrichen, OpenAlex verlangt seit 13.02.2026 einen Schlüssel, die Deutsche Bahn hat ihre alte HAFAS-Schnittstelle abgeschaltet.
- **Was ich nicht selbst prüfen konnte:** Die Anbieterseiten (Cloudflare, Google, Groq, Tavily, Brave, openrouteservice, Transitous u. a.) waren aus der Recherche-Umgebung nicht erreichbar, ebenso die GitHub-API. Limits stammen deshalb aus Suchergebnissen und sind mit **(L?)** markiert, wenn die Quelle nicht der Anbieter war oder sich Quellen widersprachen. Lizenzen und Versionsstände der Python- und npm-Pakete sind direkt von PyPI und der npm-Registry abgefragt (19.11.2026). Bei Programmen aus der Debian-Paketquelle stammt die Lizenzangabe aus meinem Wissen, nicht aus einer Abfrage.
- **RAM-Angaben** sind Schätzungen, keine Messungen. Die Größe von Leifs VPS kenne ich nicht.
- **Annahmen über Leif** (Zotero, Home Assistant, Strava, Spotify, Studienfach) sind mit **(falls)** markiert.

## Top 15 – zuerst bauen

Auswahl nach Nutzen pro Aufwand für einen Studenten. Die ersten acht sind fast nur Pakete im Rechenraum-Image plus die Erweiterung der erlaubten Endungen – ein gemeinsamer Umbau schaltet sie alle frei.

| Rang | Nr. | Fähigkeit | Warum zuerst |
|---|---|---|---|
| 1 | 1 | PDF-Text und Tabellen lesen | Skripten, Angaben und Altklausuren sind PDFs. Heute geht nur „als Anhang der Aktion“. Zwei pip-Pakete. |
| 2 | 7 | Jede Datei → Markdown (MarkItDown) | Folien (pptx), Word-Angaben, Excel aus Moodle werden lesbar. Ein Paket, MIT. |
| 3 | 20 | Vault-Datei ansehen (Bild/PDF-Seite) | Die Leitung für Bilder gibt es schon (`bilder` im Werkzeug-Ergebnis). Kleiner Umbau, großer Effekt: Fotos von Tafel und Handschrift. |
| 4 | 5 | OCR für Scans | Gescannte Skripten und Fotos werden durchsuchbar. Apt-Pakete, läuft auf CPU. |
| 5 | 8–10 | Word, Excel, PowerPoint erzeugen | Abgaben und Referate in dem Format, das verlangt wird. Reine Python-Pakete. |
| 6 | 2 | PDF zusammenfügen, teilen, komprimieren | Abgabe-PDF aus Einzelteilen, Moodle-Größengrenze. Klein. |
| 7 | 35, 36 | Diagramme (Mermaid, Graphviz) | Jede Zusammenfassung und jedes Referat profitiert. Graphviz ist ein apt-Paket. |
| 8 | 52 | Datenanalyse (pandas, DuckDB) | Statistik-Übungen, Bank-CSV, eigene Daten. Zwei Pakete. |
| 9 | 71, 72, 73 | Literatur suchen, DOI → BibTeX, Quellen prüfen | Seminararbeiten: echte Quellen statt erfundener. Freie APIs ohne Kosten. |
| 10 | 86 | Transkription (Sprachnachricht, Vorlesung) | Telegram-Sprachnachricht wird Auftrag, Aufzeichnung wird Skript. Größter Komfortgewinn, mittlerer Aufwand. |
| 11 | 95 | Zugverbindungen Konstanz ↔ Linz | Leif pendelt zwischen zwei Ländern. Verbindung plus Termin im Kalender in einem Lauf. |
| 12 | 22, 23 | Bildbearbeitung + Hintergrund entfernen | Das „Photoshop“ aus Leifs Wunschliste. Pillow/ImageMagick sind klein, rembg läuft auf CPU. |
| 13 | 21 | Bilder generieren | Ausdrücklich gewünscht. Ein HTTP-Aufruf, aber abhängig von einem Gratiskontingent. |
| 14 | 104 | Mail-Anhänge lesen | Rechnungen, Bescheide, Angaben kommen als Anhang. Baut auf Nr. 1 und 7 auf. |
| 15 | 78 | Anki-Export der Karteikarten | Karten gibt es schon (`karten.md`), der Export ist ein kleines Skript. |

Knapp dahinter: Pandoc (Nr. 12), GiroCode aus Rechnungen (Nr. 100), Übersetzung ganzer Dokumente (Nr. 82), Vorlesen (Nr. 87).

## A. Dokumente und PDF

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 1 | PDF-Text und Tabellen lesen | „Fasse Kapitel 3 des Skripts zusammen“, Tabelle aus einem Paper als CSV | [pdfplumber](https://github.com/jsvine/pdfplumber) 0.11 + [pypdf](https://github.com/py-pdf/pypdf) 7.1, für harte Tabellen [camelot-py](https://github.com/camelot-dev/camelot) 2.0 | MIT / BSD-3 / MIT | ja, wenige MB, kaum RAM | Rechenraum | S | frei |
| 2 | PDF zusammenfügen, teilen, drehen, komprimieren | Deckblatt + Lösung + Anhang zu einer Abgabe, unter die Moodle-Grenze drücken | pypdf, [pikepdf](https://github.com/pikepdf/pikepdf) 10.18 (qpdf), Ghostscript zum Verkleinern | BSD-3 / MPL-2.0 / AGPL (Ghostscript, nur eigene Nutzung) | ja, klein | Rechenraum | S | frei |
| 3 | PDF-Formulare ausfüllen | Antrag der Uni oder Behörde mit Leifs Daten vorausfüllen | pypdf (AcroForm) oder pikepdf. XFA-Formulare gehen damit nicht | BSD-3 / MPL-2.0 | ja, klein | Rechenraum + Skill | M | Entwurf (Leif reicht selbst ein) |
| 4 | PDF markieren, kommentieren, Wasserzeichen | wichtige Stellen im Skript gelb markieren, „Entwurf“ quer drüber | [PyMuPDF](https://github.com/pymupdf/PyMuPDF) 2.1 oder Überlagerung mit [reportlab](https://www.reportlab.com/opensource/) 5.1 + pypdf | AGPL-3 (privat unkritisch) / BSD | ja, klein | Rechenraum | M | frei |
| 5 | OCR: Scan → durchsuchbares PDF | gescanntes Altskript oder Foto eines Zettels wird durchsuchbar | [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) 17.14 + Tesseract (deu, eng) | MPL-2.0 / Apache-2.0 | ja, CPU reicht. Etwa 10–30 s je Seite, wenige hundert MB RAM (Schätzung) | Rechenraum (Zeitgrenze anheben) | M | frei |
| 6 | Layout-treues PDF → Markdown (Formeln, Tabellen, Spalten) | zweispaltiges Paper sauber als Notiz im Vault | [Docling](https://github.com/docling-project/docling) 2.151 | MIT | ja, aber schwer: Modelle über 1 GB, 2–4 GB RAM, auf CPU langsam (Schätzung) | Rechenraum oder eigener Container | L | frei |
| 7 | Jede Datei → Markdown | pptx-Folien, docx-Angabe, xlsx, epub, html lesen | [MarkItDown](https://github.com/microsoft/markitdown) 0.1.9 (Microsoft) | MIT | ja, klein | Rechenraum | S | frei |
| 8 | Word-Dateien erzeugen und ändern | Seminararbeit oder Protokoll als .docx, weil der Kurs Word verlangt | [python-docx](https://github.com/python-openxml/python-docx) 1.2, Vorlagen mit [docxtpl](https://github.com/elapouya/python-docx-template) | MIT / LGPL-2.1 | ja, klein | Rechenraum + Skill | S | frei |
| 9 | Excel-Dateien lesen und erzeugen | Haushaltsbuch, Notenrechner, Auswertung mit Formeln und Diagramm | [openpyxl](https://openpyxl.readthedocs.io/) 3.1, [XlsxWriter](https://github.com/jmcnamara/XlsxWriter) 3.3, schnelles Lesen mit python-calamine | MIT / BSD-2 / MIT | ja, klein | Rechenraum | S | frei |
| 10 | PowerPoint erzeugen und ändern | Referat-Folien aus der Zusammenfassung, in der Vorlage des Instituts | [python-pptx](https://github.com/scanny/python-pptx) 1.0.2 (letzte Version 2024, stabil) | MIT | ja, klein | Rechenraum + Skill | M | frei |
| 11 | Office ↔ PDF umwandeln | docx/pptx als PDF abgeben, Folien als Bilder ansehen | LibreOffice headless, oder [Gotenberg](https://github.com/gotenberg/gotenberg) als Dienst | MPL-2.0 / MIT | ja. LibreOffice macht das Image etwa 400–600 MB größer, 300–500 MB RAM je Lauf (Schätzung) | Rechenraum, alternativ Container | M | frei |
| 12 | Universal-Konverter | Markdown-Notiz → docx/epub/html/LaTeX mit Literaturverzeichnis | [Pandoc](https://pandoc.org/) mit citeproc | GPL-2+ | ja, eine Binärdatei, rund 150 MB | Rechenraum | S | frei |
| 13 | HTML/CSS → PDF | Lebenslauf, Rechnung, Handout mit eigenem Layout | [WeasyPrint](https://github.com/Kozea/WeasyPrint) 70 | BSD | ja, klein, kein Browser nötig | Rechenraum | S | frei |
| 14 | Typst als schnelle LaTeX-Alternative | Handout in Sekunden statt pdflatex-Durchläufen | [Typst](https://github.com/typst/typst) (CLI) | Apache-2.0 | ja, eine Binärdatei. Pakete brauchen Netz, also ohne oder vorab ins Image | Rechenraum | S | frei |
| 15 | Briefe nach DIN 5008 | Kündigung, Antrag, Widerspruch fertig zum Ausdrucken | LaTeX `scrlttr2` (KOMA-Script, im Image schon enthalten) als Aktion | frei (LPPL) | vorhanden | Skill | S | Entwurf |
| 16 | PDF digital signieren und Signaturen prüfen | prüfen, ob ein Bescheid echt signiert ist | [pyHanko](https://github.com/MatthiasValvekens/pyHanko) 0.38 | MIT | ja, klein. Signieren bräuchte Leifs Zertifikat auf dem Server – nicht empfohlen | Rechenraum | M | Prüfen frei, Signieren Freigabe |
| 17 | Zwei Fassungen vergleichen | „Was hat sich im neuen Übungsblatt geändert?“ | `pdftotext` (vorhanden) + Python `difflib`, für LaTeX `latexdiff` | frei | vorhanden bzw. apt | Rechenraum + Skill | S | frei |
| 18 | Foto vom Zettel → gerader Scan | Handy-Foto der Mitschrift entzerren, Kontrast anheben, als PDF ablegen | [opencv-python-headless](https://github.com/opencv/opencv-python) 5.1 + [img2pdf](https://pypi.org/project/img2pdf/) | Apache-2.0 / LGPL-3 | ja, rund 100 MB | Rechenraum | M | frei |
| 19 | ZIP/7z packen und entpacken | Moodle-Download entpacken, Abgabe-ZIP mit richtiger Ordnerstruktur bauen | Python `zipfile`/`tarfile`, p7zip. Grenzen für Größe und Dateizahl setzen (ZIP-Bomben) | frei | vorhanden bzw. apt | Rechenraum | S | frei |
| 20 | Vault-Datei ansehen (Bild, PDF-Seite) | Foto der Tafel oder einer Rechnung im Vault lesen und abtippen, Handschrift → LaTeX | neues Werkzeug `vault_ansehen`: Bild bzw. mit poppler gerenderte Seite als Bild-Block ans Modell (Feld `bilder` gibt es schon) | nur Token-Kosten | vorhanden | Dorf-Werkzeug | S | frei (Fremdinhalt, wenn Datei von außen) |

## B. Bilder

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 21 | Bilder generieren | Titelbild fürs Referat, Illustration, Geburtstagskarte | [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), Modell FLUX.1 schnell: 10 000 Neuronen/Tag gratis, laut Preisliste 4,8 Neuronen je 512×512-Kachel. Ausweichweg [Pollinations](https://github.com/pollinations/pollinations) (Limits unklar **(L?)**) | gratis im Kontingent **(L?)**, Cloudflare-Konto nötig | nein (API). Lokal ohne GPU nicht sinnvoll | Dorf-Werkzeug `bild_erzeugen` | M | frei (Datei ins Gebäude). Der Prompt verlässt den Server |
| 22 | Bild bearbeiten: zuschneiden, skalieren, drehen, Text, Collage, Filter | Passfoto zuschneiden, Screenshot beschriften, Bilder nebeneinander setzen | [Pillow](https://github.com/python-pillow/Pillow) 13 + ImageMagick | MIT-CMU / ImageMagick-Lizenz | ja, klein | Rechenraum | S | frei |
| 23 | Hintergrund entfernen | Bewerbungsfoto freistellen, Produktfoto für eine Anzeige | [rembg](https://github.com/danielgatis/rembg) 2.0.87 (ONNX, CPU) | MIT | ja. Modell rund 170 MB ins Image, 1–2 GB RAM in der Spitze, einige Sekunden je Bild (Schätzung) | Rechenraum | M | frei |
| 24 | Bild hochskalieren und entrauschen | kleines Logo oder altes Foto vergrößern | OpenCV `dnn_superres` (EDSR/FSRCNN) auf CPU. Real-ESRGAN ist besser, braucht aber praktisch eine GPU | Apache-2.0 | ja, auf CPU langsam (bis Minuten je Bild) | Rechenraum | M | frei |
| 25 | Komprimieren und Formate wandeln | HEIC vom iPhone → JPG, PNG für die Abgabe verkleinern, WebP/AVIF | [pillow-heif](https://github.com/bigcat88/pillow_heif) 1.8, oxipng, jpegoptim, libvips | BSD-3 / MIT / GPL / LGPL | ja, klein | Rechenraum | S | frei |
| 26 | Vektorgrafik erzeugen und rendern | Logo, Icon oder Skizze als SVG, daraus PNG/PDF | SVG direkt schreiben, rendern mit [CairoSVG](https://github.com/Kozea/CairoSVG) 2.9, aufräumen mit [svgo](https://github.com/svg/svgo) | LGPL-3 / MIT | ja, klein | Rechenraum | S | frei |
| 27 | Rasterbild → Vektor | gescannte Unterschrift oder Skizze als saubere SVG | [vtracer](https://github.com/visioncortex/vtracer) 0.6 oder potrace | MIT / GPL | ja, klein | Rechenraum | S | frei |
| 28 | Stockfotos suchen und holen | lizenzfreies Bild für Folien, Quelle gleich mit abgelegt | [Pexels API](https://www.pexels.com/api/) (200/Stunde, 20 000/Monat), [Unsplash API](https://unsplash.com/documentation) (50/Stunde im Demo-Status), Pixabay **(L?)** | gratis mit Schlüssel, Namensnennung erwünscht bzw. Pflicht | nein (API) | Dorf-Werkzeug `bild_suchen` | S | frei (Fremdinhalt) |
| 29 | Freie Medien aus Wikimedia Commons / Openverse | Diagramm oder historisches Foto mit sauberer CC-Lizenzangabe | [MediaWiki-API](https://www.mediawiki.org/wiki/API:Main_page) von Commons, [Openverse-API](https://api.openverse.org/) | gratis, ohne Schlüssel (User-Agent setzen) | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 30 | Metadaten lesen und entfernen | GPS-Daten aus einem Foto löschen, bevor es in eine Mail geht | [ExifTool](https://exiftool.org/) | Artistic/GPL | ja, klein | Rechenraum | S | frei |
| 31 | Icons suchen | einheitliche Symbole für Folien und Notizen | [Iconify-API](https://iconify.design/docs/api/) (offene Icon-Sammlungen, Lizenz je Satz) **(L?)** | gratis, ohne Schlüssel | API, selbst hostbar | Dorf-Werkzeug | S | frei |
| 32 | QR-Codes und Barcodes erzeugen und lesen | WLAN-QR für Gäste, Link-QR aufs Handout, QR auf einem Foto auslesen | [segno](https://github.com/heuer/segno) 1.6 (erzeugen), [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) 3.1 (lesen) | BSD / Apache-2.0 | ja, klein | Rechenraum | S | frei |
| 33 | Doppelte und ähnliche Bilder finden | Foto-Ordner im Vault aufräumen | [ImageHash](https://github.com/JohannesBuchner/imagehash) 4.3 | BSD-2 | ja, klein | Rechenraum | S | frei (Löschen = Papierkorb) |

## C. Diagramme, Grafiken, Präsentationen

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 34 | Diagramm-Dienst für viele Sprachen | ein Werkzeug `diagramm` für Mermaid, PlantUML, BPMN, Excalidraw u. a. | [Kroki](https://github.com/yuzutech/kroki) mit Begleit-Containern (mermaid, excalidraw, bpmn) | MIT | ja, internes Netz reicht. Mehrere hundert MB RAM (Java + Chromium im Mermaid-Begleiter, Schätzung) | Container + Dorf-Werkzeug | M | frei |
| 35 | Mermaid ohne Kroki | Ablaufdiagramm, Gantt für den Lernplan, Mindmap – Obsidian zeigt Mermaid ohnehin an | Mermaid-Block direkt in die Notiz. Als Bild: [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) 12.2, braucht Chromium | MIT | Text: nichts nötig. Bild: Chromium (rund 300 MB) | Skill, Bild über Nr. 34 | S | frei |
| 36 | Graphviz | Abhängigkeitsgraph der Kurse, Automaten, Bäume | [Graphviz](https://graphviz.org/) `dot` + Python-Paket `graphviz` 0.21 | EPL / MIT | ja, klein | Rechenraum | S | frei |
| 37 | PlantUML | UML-Klassen- und Sequenzdiagramme für Software-Kurse | [PlantUML](https://plantuml.com/) (braucht Java) – am einfachsten über Nr. 34 | GPL (auch MIT-Fassung) | Java-Laufzeit rund 200 MB | Container (Kroki) | S nach Nr. 34 | frei |
| 38 | D2 | hübsche Architektur- und Ablaufdiagramme aus Text | [D2](https://github.com/terrastruct/d2) | MPL-2.0 | ja, eine Binärdatei | Rechenraum | S | frei |
| 39 | Excalidraw-Skizzen | handgezeichnet wirkende Skizze, in Obsidian weiter bearbeitbar | `.excalidraw`-JSON für das Obsidian-Plugin schreiben, Bild über Kroki-Begleiter | MIT | klein | Skill, optional Nr. 34 | M | frei |
| 40 | Obsidian Canvas | Themenlandkarte eines Fachs als Canvas mit verlinkten Notizen | `.canvas`-Datei nach der offenen [JSON-Canvas-Spezifikation](https://jsoncanvas.org/) schreiben | MIT (Spezifikation) | nichts nötig | Skill | S | frei |
| 41 | Statistische Grafiken | Verteilungen, Regressionen, Heatmaps für Übungen | [seaborn](https://seaborn.pydata.org/) 0.13 (auf matplotlib) | BSD | ja, klein | Rechenraum | S | frei |
| 42 | Interaktive Diagramme | zoombare Kurs- oder Ausgabenverläufe, in der App über `/api/vault/seite` | [Plotly](https://github.com/plotly/plotly.py) 7.1 als HTML mit eingebettetem Skript (die Seite hat kein Netz). Bild-Export über Kaleido braucht Chrome | MIT | ja, HTML-Datei rund 4 MB je Diagramm | Rechenraum | S | frei |
| 43 | Vega-Lite-Diagramme ohne Browser | saubere Diagramme als SVG/PNG aus einer JSON-Beschreibung | [Altair](https://github.com/vega/altair) 6.3 + [vl-convert](https://github.com/vega/vl-convert) 1.9 | BSD-3 | ja, rund 50 MB | Rechenraum | S | frei |
| 44 | Schaltpläne | Schaltung für Physik oder Elektrotechnik zeichnen | [schemdraw](https://schemdraw.readthedocs.io/) 0.23 oder `circuitikz` (im Image) | MIT / LPPL | ja, klein | Rechenraum | S | frei |
| 45 | Netzwerk- und Graphenanalyse | kürzeste Wege, Zentralität, Graphen zeichnen (Diskrete Mathematik, OR) | [NetworkX](https://networkx.org/) 3.7 | BSD-3 | ja, klein | Rechenraum | S | frei |
| 46 | Folien aus Markdown | Referat in Minuten: Markdown → PDF/HTML-Folien | [Marp CLI](https://github.com/marp-team/marp-cli) 4.5 (PDF/PPTX brauchen Chromium), ohne Browser: Pandoc → Beamer oder reveal.js | MIT / GPL-2+ | Beamer-Weg: vorhanden. Marp: Node + Chromium | Rechenraum + Skill | M | frei |
| 47 | HTML-Präsentation zum Durchklicken | Folien direkt in der App oder am Handy zeigen | Pandoc → [reveal.js](https://revealjs.com/) als eine eigenständige HTML-Datei | GPL-2+ / MIT | klein, reveal.js muss im Image liegen | Rechenraum | S | frei |
| 48 | Mathe-Animationen | kurzes Erklärvideo zu einer Ableitung oder einem Algorithmus | [Manim Community](https://github.com/ManimCommunity/manim) 0.22 + ffmpeg | MIT | ja, aber auf CPU langsam (Minuten für 30 s Video), sprengt 120 s | Rechenraum (Zeitgrenze) | L | frei |
| 49 | Statische Karte als Bild | Anfahrtsskizze mit Markern fürs Handout | [py-staticmaps](https://github.com/flopp/py-staticmaps) 0.5. Lädt Kacheln, braucht also Netz und die [OSM-Kachelregeln](https://operations.osmfoundation.org/policies/tiles/) | MIT, Kacheln frei bei geringer Last | nein (Kacheln von außen) | Dorf-Werkzeug oder kleiner Dienst | M | frei |
| 50 | Wortwolke | Schlagwort-Bild aus einem Skript für die Titelfolie | [wordcloud](https://github.com/amueller/word_cloud) 1.9 | MIT | ja, klein | Rechenraum | S | frei |

## D. Mathe, Code, Daten

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 51 | LaTeX-Helfer | Wortzahl der Seminararbeit, Fehlerprüfung, Änderungen sichtbar machen, automatische Durchläufe | `latexmk`, `chktex`, `texcount`, `latexdiff` (Debian-Pakete) | frei (GPL/LPPL) | ja, klein | Rechenraum | S | frei |
| 52 | Datenanalyse | CSV aus der Statistik-Übung auswerten, Bankdaten nach Monat gruppieren | [pandas](https://pandas.pydata.org/) 3.1 + [DuckDB](https://duckdb.org/) 2.0 | BSD-3 / MIT | ja, rund 150 MB | Rechenraum | S | frei |
| 53 | Statistik und maschinelles Lernen | Regression mit Tests, Klassifikation, Clusteranalyse | [statsmodels](https://www.statsmodels.org/) 0.15, [scikit-learn](https://scikit-learn.org/) 1.9 | BSD-3 | ja, rund 150 MB | Rechenraum | S | frei |
| 54 | Jupyter-Notebooks ausführen und erzeugen | Abgabe als `.ipynb` durchrechnen und als PDF/HTML exportieren | [nbconvert](https://github.com/jupyter/nbconvert) 7.17 + ipykernel | BSD-3 | ja, rund 100 MB | Rechenraum | M | frei |
| 55 | Octave und R | MATLAB-Übungen ohne MATLAB, R-Aufgaben aus Statistik | GNU Octave, R (Debian-Pakete) | GPL | ja, je 300–600 MB im Image | Rechenraum | M | frei |
| 56 | Java, C/C++ kompilieren und testen | Programmier-Übung bauen, Tests laufen lassen, bevor Leif abgibt | OpenJDK, gcc/g++, make | GPL (mit Ausnahmen) | ja, zusammen rund 500 MB. Maven/Gradle brauchen Netz – ohne | Rechenraum | M | frei |
| 57 | Python-Code prüfen | Tests und Stilprüfung für Python-Abgaben | pytest, [ruff](https://github.com/astral-sh/ruff) | MIT | ja, klein | Rechenraum | S | frei |
| 58 | SQL üben und übersetzen | Datenbank-Übung gegen eine echte Datenbank prüfen, Dialekte umschreiben | `sqlite3`, DuckDB, [sqlglot](https://github.com/tobymao/sqlglot) 30 | frei / MIT | ja, klein | Rechenraum | S | frei |
| 59 | Optimierung | lineare und ganzzahlige Programme aus Operations Research lösen | [PuLP](https://github.com/coin-or/pulp) 4.3 (mit CBC), [OR-Tools](https://developers.google.com/optimization) 9.15, cvxpy | MIT / Apache-2.0 | ja, rund 100 MB | Rechenraum | S | frei |
| 60 | Logik und Beweis-Prüfer | Aussagenlogik, Erfüllbarkeit, Rätsel und Stundenplan-Probleme | [Z3](https://github.com/Z3Prover/z3) 5.4 | MIT | ja, rund 50 MB | Rechenraum | S | frei |
| 61 | Rechnen mit Einheiten | Physik-Aufgaben ohne Einheitenfehler | [Pint](https://github.com/hgrecco/pint) 0.26 | BSD-3 | ja, klein | Rechenraum | S | frei |
| 62 | Wolfram\|Alpha als zweite Meinung | Integral oder Grenzwert gegenprüfen, Faktenwerte mit Einheit | [Wolfram\|Alpha API](https://products.wolframalpha.com/api/) – nach meinem Wissen 2 000 Abrufe/Monat, nicht kommerziell **(L?)** | gratis mit App-ID **(L?)** | nein (API) | Dorf-Werkzeug | S | frei |
| 63 | Eigene Dorf-Daten per SQL befragen | „Wie viel Fokuszeit je Fach im Oktober?“ ohne neuen Endpunkt | Werkzeug mit nur lesender SQLite-Verbindung, feste Liste erlaubter Tabellen, Zeilen- und Zeitgrenze | frei | vorhanden (better-sqlite3) | Dorf-Werkzeug | M | frei (keine Tabellen mit Geheimnissen) |

## E. Recherche und Wissen

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 64 | Eigene Meta-Suchmaschine | Websuche im api-Motor ohne 10 $ je 1 000 Suchen | [SearXNG](https://github.com/searxng/searxng) mit JSON-Ausgabe. Suchmaschinen sperren Server-Adressen gelegentlich | AGPL-3 | ja, rund 300–500 MB RAM (Schätzung) | Container + Dorf-Werkzeug | M | frei (Fremdinhalt) |
| 65 | Such-API als Ersatz | fertige, für Agenten aufbereitete Treffer | [Tavily](https://www.tavily.com/) mit offiziellem MCP-Server `tavily-mcp` – 1 000 Credits/Monat gratis **(L?)**. Brave hat keine echte Gratisstufe mehr | gratis im Kontingent **(L?)** | nein (API) | Dorf-Werkzeug oder MCP | S | frei (Fremdinhalt) |
| 66 | Seiten mit JavaScript lesen und fotografieren | Seite, die `web_fetch` leer liefert (Mensa, Stundenplan, Shop) | vorhandenen Browser-Container um ein zweites, nur lesendes Profil erweitern (eigene Regeln in `leine.ts`). Alternative: [Playwright MCP](https://github.com/microsoft/playwright-mcp) (Microsoft) | Apache-2.0 | vorhanden (Chromium läuft schon) | Container-Ausbau + Dorf-Werkzeug | L | frei, nur GET, keine Anmeldung (Fremdinhalt) |
| 67 | Wikipedia und Wikidata | schneller, zitierbarer Überblick, Fakten als Daten | [Wikimedia-REST-API](https://www.mediawiki.org/wiki/API:REST_API), Wikidata-SPARQL | gratis, ohne Schlüssel (User-Agent setzen) | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 68 | arXiv-Suche | neueste Preprints zu einem Thema mit Abstract und PDF-Link | [arXiv-API](https://info.arxiv.org/help/api/index.html), Python-Paket `arxiv` 4.1. Richtwert 1 Anfrage je 3 s **(L?)** | gratis, ohne Schlüssel | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 69 | Bibliothekskatalog und Bücher | ISBN → Titel, Autor, Auflage fürs Literaturverzeichnis | [Open-Library-API](https://openlibrary.org/developers/api), DNB-SRU-Schnittstelle **(L?)** | gratis | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 70 | Archivierte Fassung einer Seite | toter Link in einer Quelle, ältere Fassung einer Kursseite | [Wayback-Machine-API](https://archive.org/help/wayback_api.php) | gratis, ohne Schlüssel | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 71 | Wissenschaftliche Literatur suchen | 15 passende, echte Arbeiten zu einem Seminarthema mit Zitationszahlen | [OpenAlex](https://developers.openalex.org/) (Schlüssel seit 13.02.2026 Pflicht, gratis mit Tagesbudget **(L?)**), [Semantic Scholar](https://www.semanticscholar.org/product/api) (ohne Schlüssel geteiltes Limit, mit Schlüssel 1/s), [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) (gratis, Mail-Adresse angeben) | gratis | nein (API) | Dorf-Werkzeug `literatur_suchen` | M | frei (Fremdinhalt) |
| 72 | DOI → BibTeX und fertiges Zitat | Literaturverzeichnis ohne Abtippen, im verlangten Stil | Abruf über [doi.org mit Content Negotiation](https://citation.crosscite.org/docs.html), Stile mit [citeproc-py](https://github.com/citeproc-py/citeproc-py) oder Pandoc | gratis / BSD | API, Formatierung lokal | Dorf-Werkzeug + Rechenraum | S | frei |
| 73 | Quellen-Prüfer | vor der Abgabe: Gibt es jede Quelle wirklich, stimmen Jahr und Titel? | [bibtexparser](https://github.com/sciunto-org/python-bibtexparser) 2.1 + Abgleich gegen Crossref/OpenAlex (Nr. 71) | MIT | Abgleich über API | Skill + Dorf-Werkzeug | M | frei |
| 74 | Frei zugängliches PDF finden | legaler Volltext zu einer DOI | [Unpaywall-API](https://unpaywall.org/products/api) (Mail-Adresse als Kennung) **(L?)** | gratis | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |
| 75 | Zotero-Bibliothek **(falls)** | Quellen aus Leifs Zotero lesen, neue Einträge anlegen | [Zotero Web API](https://www.zotero.org/support/dev/web_api/v3/start), [pyzotero](https://github.com/urschrei/pyzotero) 1.17 | gratis (300 MB Speicher gratis **(L?)**) / Blue Oak | API | Dorf-Werkzeug | M | Lesen frei, Anlegen frei mit „Rückgängig“ |
| 76 | YouTube-Transkript | Erklärvideo als Text zusammenfassen | [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) 1.2. YouTube sperrt Server-Adressen häufig – kann auf dem VPS scheitern | MIT | Abruf von außen | Dorf-Werkzeug | M | frei (Fremdinhalt) |
| 77 | Feeds abonnieren | Institutsnachrichten, Blogs, Tagesschau in der Morgenzeitung | [feedparser](https://github.com/kurtmckee/feedparser) 6.0 bzw. in Node [rss-parser](https://github.com/rbren/rss-parser) (letzte Version 2023) | BSD-2 / MIT | ja, klein | Dorf-Werkzeug + Automatik | M | frei (Fremdinhalt) |
| 78 | Anki-Export | Karten aus `karten.md` als `.apkg` fürs Handy | [genanki](https://github.com/kerrickstaley/genanki) 0.13 (letzte Version 2023, funktioniert weiter **(L?)**) | MIT | ja, klein | Rechenraum + Skill | S | frei |
| 79 | Semantische Suche im Vault | „Wo hatte ich das mit der Fourier-Reihe?“ auch ohne das genaue Wort | [sqlite-vec](https://github.com/asg017/sqlite-vec) 0.1.9 + [fastembed](https://github.com/qdrant/fastembed) 0.9 (ONNX auf CPU, mehrsprachiges kleines Modell) | MIT/Apache-2.0 | ja, Modell 100–500 MB, rund 0,5–1 GB RAM beim Einlesen (Schätzung) | Dorf-Werkzeug + kleiner Dienst | L | frei |
| 80 | Verweise und Vault-Gesundheit | Rückverweise einer Notiz, tote Links, verwaiste Anhänge | eigener Code über die `[[Verweise]]`, Index in SQLite | frei | vorhanden | Dorf-Werkzeug | M | frei |
| 81 | Bibliotheks-Doku für Programmierkurse | aktuelle Doku zu einer Bibliothek statt veralteter Erinnerung | [Context7](https://github.com/upstash/context7) MCP 4.7 (Gratisstufe mit Limits **(L?)**) | MIT (Server), Dienst gratis **(L?)** | nein (Dienst) | MCP in der Werkstatt | S | frei (Fremdinhalt) |
| 82 | Übersetzung ganzer Dokumente | englisches Paper oder docx/pptx mit erhaltenem Layout auf Deutsch | [DeepL API Free](https://developers.deepl.com/docs/resources/usage-limits): 500 000 Zeichen/Monat, offizieller MCP-Server [deepl-mcp-server](https://github.com/DeepL/deepl-mcp-server) 1.3. Kurze Texte übersetzt das Modell selbst | gratis im Kontingent (Anmeldung mit Karte **(L?)**) | nein. Selbst gehostet: [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) (AGPL, 1–2 GB RAM, schwächer) | Dorf-Werkzeug | S | frei. Der Text verlässt den Server |
| 83 | Rechtschreibung und Grammatik | Seminararbeit regelbasiert prüfen, mit Fundstellen | [LanguageTool, öffentliche API](https://dev.languagetool.org/public-http-api): 20 Anfragen/Minute, 20 KB je Anfrage. Selbst gehostet braucht Java und 1–2 GB RAM (Schätzung) | gratis / LGPL-2.1 | beides möglich | Dorf-Werkzeug | S | frei. Bei der öffentlichen API verlässt der Text den Server |
| 84 | Wörterbuch und Synonyme | besseres Wort finden, Begriff nachschlagen | [OpenThesaurus-API](https://www.openthesaurus.de/about/api), Wiktionary-API **(L?)** | gratis | API, Daten frei herunterladbar | Dorf-Werkzeug | S | frei |
| 85 | Offene Statistikdaten | Zeitreihen für eine VWL-Arbeit (BIP, Inflation, Zinsen) **(falls)** | [Eurostat-API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access), [Weltbank-API](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589), EZB-Datenportal | gratis, ohne Schlüssel | nein (API) | Dorf-Werkzeug | M | frei (Fremdinhalt) |

## F. Sprache, Audio, Video

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 86 | Transkription | Telegram-Sprachnachricht wird Auftrag, Vorlesungsaufzeichnung wird Text | lokal [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2 (Modell `small`/`medium`, int8). Oder [Groq](https://console.groq.com/docs/rate-limits) `whisper-large-v3`: 20 Anfragen/Minute, 2 000/Tag, 7 200 Audio-Sekunden/Stunde gratis **(L?)** | MIT / gratis im Kontingent | lokal ja: `small` rund 1–2 GB RAM, etwa Echtzeit auf wenigen Kernen (Schätzung). Bei Groq verlässt die Aufnahme den Server | Rechenraum (Zeitgrenze) oder Dorf-Werkzeug | M | frei (Fremdinhalt, wenn Aufnahme von außen) |
| 87 | Vorlesen (Text zu Sprache) | Morgenzeitung als Sprachnachricht, Zusammenfassung zum Hören | [Piper](https://github.com/OHF-Voice/piper1-gpl) 1.8 mit deutscher Stimme (z. B. Thorsten). Das Projekt sucht Betreuer. Besser klingend, aber inoffiziell: [edge-tts](https://github.com/rany2/edge-tts). [ElevenLabs](https://elevenlabs.io/pricing/api) gratis rund 10 000 Zeichen/Monat **(L?)** | GPL-3 / LGPL-3 / gratis im Kontingent | Piper ja: Stimme rund 60–100 MB, schneller als Echtzeit auf CPU | Rechenraum + Telegram `sendVoice` | M | frei (nur an Leif) |
| 88 | Audio und Video schneiden und wandeln | Tonspur aus Aufzeichnung ziehen, Video für Moodle verkleinern, OGG für Telegram | [ffmpeg](https://ffmpeg.org/) | LGPL/GPL | ja, rund 100 MB, CPU-lastig | Rechenraum | S | frei |
| 89 | Folien aus Vorlesungsvideo ziehen | aus 90 Minuten Video die 40 Folienbilder als PDF | ffmpeg-Szenenerkennung + ImageHash (Nr. 33) gegen Dubletten + img2pdf | frei | ja, CPU-lastig, sprengt 120 s | Rechenraum + Skill | M | frei |
| 90 | Untertitel erzeugen | SRT/VTT zu einem eigenen Video, auch übersetzt | Ausgabe von Nr. 86 als SRT, einbrennen mit ffmpeg | frei | wie Nr. 86 | Skill | S nach Nr. 86 | frei |
| 91 | Medien herunterladen | frei verfügbare Vorlesung oder Podcast für Nr. 86 holen | [yt-dlp](https://github.com/yt-dlp/yt-dlp) 2026.10. Nur für eigene Nutzung, Nutzungsbedingungen der Plattform beachten. Server-Adressen werden oft gesperrt | Unlicense | ja, braucht Netz und Platz | Container mit Netz + Dorf-Werkzeug | M | frei (Fremdinhalt), Größengrenze |
| 92 | Sprecher trennen | Gruppenbesprechung: wer hat was gesagt | [pyannote](https://github.com/pyannote/pyannote-audio) bzw. WhisperX – braucht Hugging-Face-Zugang und ist auf CPU sehr langsam **(L?)** | MIT | nur bedingt: mehrere GB RAM, ein Vielfaches der Audiolänge | Rechenraum | L | frei |
| 93 | Mündliche Abfrage per Sprachnachricht | Agent fragt Prüfungsstoff ab, Leif antwortet sprechend, bekommt Rückmeldung | Aktion aus Nr. 86 + Nr. 87 + Karteikarten | frei | wie Nr. 86/87 | Skill | M nach Nr. 86/87 | frei |

## G. Unterwegs und Alltag

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 94 | Wetter als Agenten-Werkzeug | „Brauche ich morgen in Linz einen Schirm?“, Unwetterwarnung in der Zeitung | vorhandenes `wetter.ts` ([Open-Meteo](https://open-meteo.com/)) als Werkzeug mit freiem Ort öffnen, Warnungen über [Bright Sky](https://brightsky.dev/) (DWD) und [GeoSphere Austria](https://data.hub.geosphere.at/) **(L?)** | gratis, ohne Schlüssel (nicht kommerziell) | Open-Meteo ist selbst hostbar, nicht nötig | Dorf-Werkzeug | S | frei |
| 95 | Zugverbindungen | Konstanz → Linz am Sonntagabend, mit Umstiegen und Dauer | [Transitous](https://transitous.org/api/) (MOTIS-API, Gemeinschaftsprojekt, nur nicht kommerziell und ohne Gewähr **(L?)**). Für Deutschland [db-vendo-client](https://github.com/public-transport/db-vendo-client) 6.11 (inoffiziell, niedriges Limit). ÖBB über `hafas-client` – ob das 2026 noch geht, konnte ich nicht klären | gratis / ISC | Transitous-Motor (MOTIS) wäre selbst hostbar, aber groß | Dorf-Werkzeug `verbindung_suchen` | M | frei. Buchen gibt es nicht |
| 96 | Verspätungs-Wächter | am Reisetag: Meldung, wenn der Anschluss in München wackelt | Automatik über Nr. 95 für Termine mit Zugnummer | wie Nr. 95 | wie Nr. 95 | Automatik + Telegram | M nach Nr. 95 | frei |
| 97 | Adressen und Orte finden | Adresse → Koordinaten für Termin, Route und Wetter | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) (öffentlich höchstens 1 Anfrage/s, User-Agent Pflicht) oder [Photon](https://photon.komoot.io/) | gratis, ODbL-Daten | selbst hosten wäre zu groß (viele GB) | Dorf-Werkzeug mit Zwischenspeicher | S | frei |
| 98 | Routen zu Fuß, Rad, Auto | „Wie lange mit dem Rad vom Bahnhof zum Hörsaal?“, Abfahrtszeit zum Termin | [openrouteservice](https://openrouteservice.org/plans/): gratis 2 000 Routen/Tag, 500 Erreichbarkeitsflächen/Tag. Seit 2026 neue Adresse `api.heigit.org` | gratis mit Schlüssel | selbst hostbar, aber RAM-hungrig – nicht nötig | Dorf-Werkzeug | S | frei |
| 99 | Orte in der Nähe | Copyshop, Apotheke oder Supermarkt mit Öffnungszeiten | [Overpass-API](https://wiki.openstreetmap.org/wiki/Overpass_API) (OpenStreetMap) | gratis, maßvoll nutzen | nein (API) | Dorf-Werkzeug | M | frei |
| 100 | Rechnung → GiroCode | Agent liest Betrag, IBAN und Zweck aus der Rechnung, Leif scannt den QR in der Bank-App | Erkennen mit Nr. 1/20, IBAN prüfen mit [schwifty](https://github.com/mdomke/schwifty), EPC-QR mit segno (Nr. 32) | MIT / BSD | ja, klein | Rechenraum + Skill | M | Entwurf (Leif zahlt selbst) |
| 101 | Feiertage und Ferien | Lernplan und Reisen an Feiertagen in Österreich und Baden-Württemberg ausrichten | [Nager.Date-API](https://date.nager.at/) oder Paket [holidays](https://github.com/vacanza/holidays) 0.109, Schulferien über [OpenHolidays](https://www.openholidaysapi.org/) **(L?)** | gratis / MIT | ja (Paket rechnet lokal) | Dorf-Werkzeug | S | frei |
| 102 | Währungen umrechnen | Franken-Preis in Kreuzlingen in Euro, alte Kurse für die Bank | [Frankfurter](https://frankfurter.dev/) (EZB-Kurse). `boerse.ts` holt Euro/Dollar schon | gratis, ohne Schlüssel, MIT | selbst hostbar, nicht nötig | Dorf-Werkzeug | S | frei |
| 103 | Lebensmittel per Strichcode | Einkaufsladen: Strichcode → Produkt, Nährwerte, Allergene | [Open-Food-Facts-API](https://openfoodfacts.github.io/openfoodfacts-server/api/), Paket `openfoodfacts` 5.4 | gratis, ODbL | nein (API) | Dorf-Werkzeug | S | frei (Fremdinhalt) |

## H. Post, Kalender, Benachrichtigungen

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 104 | Mail-Anhänge lesen | Rechnung, Bescheid oder Angabe im Anhang verstehen und ablegen | Gmail `attachments.get` (lesender Zugriff besteht), Inhalt über Nr. 1/7/20 | gratis | vorhanden | Dorf-Werkzeug | M | frei (Fremdinhalt). Ablage nur im Post-Gebäude |
| 105 | Mails ordnen | Rechnungen mit Label versehen, Erledigtes archivieren | Gmail `messages.modify` – braucht den weiteren Zugriff `gmail.modify`, also neue Anmeldung | gratis | vorhanden | Dorf-Werkzeug | M | frei mit „Rückgängig“ (Label weg, zurück in den Eingang). Löschen nie |
| 106 | Newsletter abbestellen | Werbepost dauerhaft loswerden | `List-Unsubscribe`-Kopfzeile auswerten, Abmelde-Aufruf nach Leifs Klick | gratis | vorhanden | Dorf-Werkzeug + Freigabe | M | Freigabe (wirkt nach außen) |
| 107 | Termin-Dateien lesen und schreiben | Einladung im Mail-Anhang wird Termin, Lernplan als `.ics` zum Weitergeben | [icalendar](https://github.com/collective/icalendar) 7.3 bzw. eigener Code (`ical.ts` liest schon) | BSD-2 | vorhanden | Dorf-Werkzeug | S | frei (Termin im eigenen Kalender, „Rückgängig“) |
| 108 | Dorf-Kalender zum Abonnieren | To-dos mit Frist und Lernblöcke im Handy-Kalender sehen | iCal-Feed unter geheimer Adresse mit eigenem Token (nur lesen) | frei | vorhanden | Server-Route | M | frei. Neue Art von Zugang – eigener Beschluss nötig |
| 109 | Google Drive lesen | geteiltes Dokument der Lerngruppe zusammenfassen | [Drive-API](https://developers.google.com/workspace/drive/api/guides/about-sdk) mit `drive.readonly`, Docs-Export als Text | gratis | API | Dorf-Werkzeug | M | frei (Fremdinhalt) |
| 110 | Push-Meldungen neben Telegram | dringende Meldung mit eigenem Ton, auch wenn Telegram stumm ist | [ntfy](https://github.com/binwiederhier/ntfy), selbst gehostet oder ntfy.sh. Viele Kanäle auf einmal: [Apprise](https://github.com/caronc/apprise) 2.2 | Apache-2.0/GPL-2 / BSD-2 | ja, sehr klein (rund 20–50 MB RAM, Schätzung) | Container + Meldungs-Schalter | S | frei (nur an Leif) |
| 111 | Kurzbefehle vom Handy | iOS-Kurzbefehl oder Tasker legt To-do, Notiz oder Timer an | vorhandene Geräte-API `/api/geraet/*` (Bearer-Schlüssel, `X-Vorgang`) – nur Anleitung und Kopplung | frei | vorhanden | Anleitung, kein neuer Code | S | wie Geräte-API |

## I. Dateien, Entwicklung, Zuhause

| Nr. | Werkzeug / Fähigkeit | Nutzen für Leif | Empfohlene Umsetzung | Kosten / Lizenz | Selbst hostbar / Ressourcen | Einbau-Weg | Aufwand | Leine |
|---|---|---|---|---|---|---|---|---|
| 112 | Verlauf jeder Vault-Datei | „Zeig mir die Fassung von gestern“, Rückweg auch nach Tagen | Git-Verlauf des Vaults auf dem Server (stündlicher Stand), Werkzeuge `vault_verlauf`/`vault_fassung` | GPL-2 (git) | ja, Platz wächst mit dem Vault | Dorf-Werkzeug + Automatik | M | Lesen frei, Zurückholen frei mit „Rückgängig“ |
| 113 | Seiten-Wächter | Meldung, wenn sich Prüfungstermine, Notenaushang oder eine Wohnungsanzeige ändern | eigener Abruf + Hash + Textvergleich in der Automatik, oder [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | frei / Apache-2.0 | eigener Weg: nichts. Container: einige hundert MB RAM (Schätzung) | Automatik, alternativ Container | M | frei (Fremdinhalt) |
| 114 | GitHub lesen | Stand von Leifs Repos: offene Issues, fehlgeschlagene Actions, auch die des Dorfs selbst | [GitHub-REST-API](https://docs.github.com/en/rest) mit fein eingestelltem, nur lesendem Token. Offiziell gibt es auch den [GitHub-MCP-Server](https://github.com/github/github-mcp-server) | gratis | API | Dorf-Werkzeug (MCP nur lesend) | M | Lesen frei. Issue oder Kommentar anlegen: Freigabe |
| 115 | Dorf-Selbstauskunft | „Warum ist der Lauf gestern gescheitert?“ – Agent liest `werkzeug_log`, Läufe, Warteschlange | eigenes Werkzeug über vorhandene Tabellen, ohne Geheimnisse | frei | vorhanden | Dorf-Werkzeug | S | frei |
| 116 | Home Assistant **(falls)** | „Heizung an, wenn ich in Linz in den Zug steige“, Zustand in der Zeitung | Home Assistants eingebaute [MCP-Server-Integration](https://www.home-assistant.io/integrations/mcp_server) oder die REST-API mit Langzeit-Token. Das Zuhause muss vom VPS erreichbar sein | Apache-2.0 | Home Assistant läuft bei Leif zu Hause, nicht auf dem VPS | Dorf-Werkzeug | M | Lesen frei. Schalten frei mit „Rückgängig“, Schloss und Alarm nur per Freigabe |
| 117 | Sport- und Schlafdaten **(falls)** | Läufe und Schlaf in Statistik und Wochenrückblick | [Strava-API](https://developers.strava.com/) (gratis, Bedingungen schränken KI-Nutzung ein **(L?)**), Garmin inoffiziell über [python-garminconnect](https://github.com/cyberjunky/python-garminconnect) 0.3, oder Apple-Health-Export als Datei | gratis / MIT | API bzw. Datei-Import | Dorf-Werkzeug | M | frei, nur lesen |

## Quellen

Abgefragt am 19.11.2026. Paketstände und Lizenzen: PyPI-JSON (`pypi.org/pypi/<paket>/json`) und npm-Registry (`registry.npmjs.org/<paket>`).

**Bilder generieren**
- Cloudflare Workers AI, Preise: https://developers.cloudflare.com/workers-ai/platform/pricing/ (über Suche gelesen, Seite selbst nicht erreichbar)
- Google-Forum zu Bildmodellen im Gratistarif: https://discuss.ai.google.dev/t/i-keep-getting-429-on-image-generation-requests/116437 und https://discuss.ai.google.dev/t/free-tier-api-image-generation/177423
- Pollinations: https://github.com/pollinations/pollinations/blob/master/APIDOCS.md

**Suche und Web**
- Brave streicht die Gratisstufe: https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing.md
- Vergleich Tavily/Brave/Exa (Tavily-Kontingent, Drittquelle): https://dev.to/build996/tavily-vs-brave-vs-exa-free-search-apis-for-ai-agents-59m1
- Jina Reader, Limits: https://jina.ai/en-US/api-dashboard/rate-limit/
- Anthropic, Websuche in der API (10 $ je 1 000 Suchen): https://claude.com/resources/articles/web-search-api
- MCP-Referenzserver und Archiv: https://github.com/modelcontextprotocol/servers
- Playwright MCP: https://github.com/microsoft/playwright-mcp

**Wissenschaft**
- OpenAlex, Schlüsselpflicht: https://groups.google.com/g/openalex-users/c/rI1GIAySpVQ und https://developers.openalex.org/api-reference/authentication
- Semantic Scholar: https://www.semanticscholar.org/product/api
- DOI-Formatierung: https://citation.crosscite.org/docs.html

**Sprache**
- Groq, Limits: https://console.groq.com/docs/rate-limits
- Piper (neues Zuhause, GPL): https://github.com/OHF-Voice/piper1-gpl
- Selbst gehostete Sprachdienste, Erfahrungsbericht: https://planet.kde.org/andreas-schneider-2026-07-20-self-hosting-voice-services-tts-asr-wake-word/
- ElevenLabs, API-Preise: https://elevenlabs.io/pricing/api
- DeepL, Limits: https://developers.deepl.com/docs/resources/usage-limits und https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-Free
- LanguageTool, öffentliche API: https://dev.languagetool.org/public-http-api

**Verkehr und Karten**
- DB-HAFAS abgeschaltet: https://v6.db.transport.rest und https://www.npmjs.com/package/db-vendo-client
- ÖBB-Profil von hafas-client: https://cdn.jsdelivr.net/npm/hafas-client@6.3.6/p/oebb/readme.md
- Transitous: https://transitous.org/api/ und https://github.com/motis-project/motis
- openrouteservice, Tarife und neue Adresse: https://openrouteservice.org/plans/ und https://ask.openrouteservice.org/t/reducing-the-quota-of-deprecated-api-api-openrouteservice-org/8013

**Bilder aus dem Netz**
- Unsplash: https://unsplash.com/documentation
- Pexels: https://help.pexels.com/hc/en-us/articles/900005852323
- Pixabay: https://pixabay.com/api/docs/

**Dokumente und Diagramme**
- Anthropic Skills (Dokument-Skills sind einsehbar, aber nicht Open Source): https://github.com/anthropics/skills
- Kroki, Installation: https://docs.kroki.io/kroki/setup/install
- Stirling-PDF (als Oberfläche für Leif denkbar, Lizenzlage uneinheitlich, deshalb nicht in der Liste): https://github.com/Stirling-Tools/Stirling-PDF

**Zuhause und Entwicklung**
- Home Assistant, MCP-Server: https://www.home-assistant.io/integrations/mcp_server
- GitHub-MCP-Server: https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/
