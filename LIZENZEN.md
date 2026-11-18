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

Die vollständigen Lizenztexte liegen den Paketen in `node_modules/<paket>/LICENSE` bei.
