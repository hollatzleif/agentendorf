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
| onnxruntime 1.19.2 (Microsoft) | Rechenraum: führt die beiden Bildmodelle auf der CPU aus (`apps/rechenraum/Dockerfile`, E198) | MIT |
| U²-Net „u2netp“ (Qin et al., 2020; ONNX-Datei aus den Releases von danielgatis/rembg) | Rechenraum: „Hintergrund entfernen“ – Modell, 4,6 MB, mit Prüfsumme ins Image geladen | Apache-2.0 |
| Real-ESRGAN „general-x4v3“ (Xintao Wang et al.; ONNX-Fassung von Qualcomm AI Hub, v0.67.0) | Rechenraum: „Hochskalieren“ – Modell, 4,8 MB, mit Prüfsumme ins Image geladen | BSD-3-Clause |
| Pillow (im Rechenraum-Image aus Debian) | Rechenraum: Bilder lesen, zuschneiden, drehen, speichern | HPND (MIT-ähnlich) |

Der Bildeditor (Atelier, E198) selbst nutzt keine zusätzliche Bibliothek – nur das Canvas-2D des Browsers. „Bild generieren“ ruft, wenn eingerichtet, Cloudflare Workers AI auf (FLUX.2 [klein] von Black Forest Labs; es gelten die Bedingungen von Cloudflare und bfl.ai/legal/terms-of-service – kein Bestandteil dieses Repos).

Die vollständigen Lizenztexte liegen den Paketen in `node_modules/<paket>/LICENSE` bei.
