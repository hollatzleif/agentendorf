# Lizenzen

## Grafik des Dorfs

Alle Gebäude, Figuren, Autos, Bäume, Symbole und Effekte des 3D-Dorfs sind **eigene Arbeit**. Sie werden zur Laufzeit aus geometrischen Grundformen erzeugt (`apps/web/src/dorf/modelle.ts`, `figuren.ts`, `blasen.ts`, `gelaende.ts`). Das Dorf verwendet keine Bilddateien, 3D-Modelle oder Grafiken Dritter und keine Grafiken oder Nachbauten bestehender Spiele (siehe E52 in `ENTSCHEIDUNGEN.md`).

## Verwendete Bibliotheken (Auswahl, mit eigener Lizenz)

| Paket | Zweck | Lizenz |
|---|---|---|
| three (three.js) | 3D-Darstellung des Dorfs, inkl. `OrbitControls`, `RoundedBoxGeometry`, `BufferGeometryUtils` aus `three/addons` | MIT |
| react, react-dom | Oberfläche | MIT |
| @tanstack/react-query | Datenabfragen | MIT |
| codemirror | Editor | MIT |
| pdfjs-dist | PDF-Anzeige | Apache-2.0 |
| fastify, better-sqlite3, zod | Server | MIT |
| openvscode-server (Gitpod, auf Basis von Code – OSS von Microsoft) | VS Code im Browser im Codehaus-Container (`apps/coding/Dockerfile`, unverändert aus dem Release-Archiv, Version dort festgelegt) | MIT |
| monaco-editor (Microsoft) | Editor im Codehaus der Dorf-App (E197): Editor, Diff, Sprachen und Worker aus dem eigenen Build, nur auf der Editor-Seite geladen | MIT |
| @xterm/xterm, @xterm/addon-fit | Terminal im Editor des Codehauses (E197) | MIT |
| onnxruntime 1.19.2 (Microsoft) | Rechenraum: führt die beiden Bildmodelle auf der CPU aus (`apps/rechenraum/Dockerfile`, E198) | MIT |
| U²-Net „u2netp“ (Qin et al., 2020; ONNX-Datei aus den Releases von danielgatis/rembg) | Rechenraum: „Hintergrund entfernen“ – Modell, 4,6 MB, mit Prüfsumme ins Image geladen | Apache-2.0 |
| Real-ESRGAN „general-x4v3“ (Xintao Wang et al.; ONNX-Fassung von Qualcomm AI Hub, v0.67.0) | Rechenraum: „Hochskalieren“ – Modell, 4,8 MB, mit Prüfsumme ins Image geladen | BSD-3-Clause |
| Pillow (im Rechenraum-Image aus Debian) | Rechenraum: Bilder lesen, zuschneiden, drehen, speichern | HPND (MIT-ähnlich) |

Der Bildeditor (Atelier, E198) selbst nutzt keine zusätzliche Bibliothek – nur das Canvas-2D des Browsers. „Bild generieren“ ruft, wenn eingerichtet, Cloudflare Workers AI auf (FLUX.2 [klein] von Black Forest Labs; es gelten die Bedingungen von Cloudflare und bfl.ai/legal/terms-of-service – kein Bestandteil dieses Repos).

Die vollständigen Lizenztexte liegen den Paketen in `node_modules/<paket>/LICENSE` bei.

## Rechenraum: feste Werkzeuge (E199)

Im Rechenraum-Image (`apps/rechenraum/Dockerfile`), unverändert, nur für Leifs eigene Nutzung. Python-Pakete mit fester Version und Prüfsumme von PyPI (Lizenz dort am 20.11.2026 abgefragt), Programme aus Debian 12.

| Paket | Zweck | Lizenz |
|---|---|---|
| pypdf 7.1.1 | PDF zusammenfügen, teilen, drehen, Formulare | BSD-3-Clause |
| Ghostscript (Debian) | PDF verkleinern (`gs -dPDFSETTINGS=/ebook`) | AGPL-3.0 (unverändertes Programm, nur intern aufgerufen) |
| Graphviz (Debian) | Diagramme aus DOT | EPL-1.0 |
| segno 1.6.6 | QR-Codes | BSD-3-Clause |
| genanki 0.13.1 (+ chevron 0.14.0, cached-property 2.0.1, frozendict 2.5.1, PyYAML aus Debian) | Anki-Pakete | MIT (chevron MIT, cached-property BSD-3-Clause, frozendict LGPL-3.0, PyYAML MIT) |
| DuckDB 2.0.0 | SQL über CSV/Excel/JSON/Parquet | MIT |
| pandas (Debian) | Excel/ODS einlesen, Ersatz ohne DuckDB | BSD-3-Clause |

## Freie Datenquellen der Agenten-Werkzeuge (E199)

Abgerufen nur auf Wunsch eines Agenten, ohne Schlüssel, mit Kennung `Agentendorf/<Version>` und der Dorf-Adresse als Kontakt.

| Quelle | Werkzeug | Bedingungen |
|---|---|---|
| Crossref REST API | `literatur_suchen` | frei; Metadaten überwiegend gemeinfrei (CC0) |
| arXiv API | `literatur_suchen` | frei; Metadaten CC0, Abstracts unter der Lizenz der jeweiligen Arbeit |
| Open Library Search API | `literatur_suchen` | frei (Internet Archive) |
| doi.org (Content Negotiation, Crossref/DataCite) | `doi_bibtex` | frei |
| Transitous (MOTIS 2) | `verbindung_suchen` | nur nicht kommerziell, quelloffene Projekte, wenig Last; Daten: https://transitous.org/sources/ (u. a. OpenStreetMap, ODbL) – Quellenangabe im Werkzeug-Ergebnis |
| Open-Meteo (Forecast, Geocoding) | `wetter_vorhersage` | frei für nicht kommerzielle Nutzung; Daten CC BY 4.0 |
| Europäische Zentralbank, Referenzkurse | `umrechnen` | frei |
