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

Die vollständigen Lizenztexte liegen den Paketen in `node_modules/<paket>/LICENSE` bei.
