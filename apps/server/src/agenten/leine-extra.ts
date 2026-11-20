/**
 * E199 – Werkzeuge aus der Ideen-Liste (docs/werkzeug-ideen.md). Hier stehen NUR die Namen und Gruppen; die Leine selbst
 * bleibt in leine.ts (werkzeugprofil), die Ausführung in werkzeuge-extra.ts. Einstufung:
 *
 * - Rechenraum (wer den Rechenraum hat): PDF bearbeiten, Diagramme, QR-Codes, Datenabfragen, Anki-Export – rechnet ohne
 *   Netz im Rechenraum, Ergebnisse nur in den vom Code bestimmten Ablage-Ordner (wie rechenraum_ablegen).
 * - Netz (nur Läufe mit Web): Literatur, DOI → BibTeX, Zugverbindungen, Wetter. Der Agent bestimmt den Text, der hinausgeht
 *   (Suchwörter, Orte) – das ist ein Abflussweg wie die Websuche, darum dieselbe Regel. Antworten sind Fremdinhalt (Hülle).
 * - Alltag (alle): Feiertage (rechnet lokal), Umrechnen (Einheiten lokal, Währungen aus der festen EZB-Adresse – kein Text
 *   des Agenten geht hinaus).
 * - Post (wer Post hat): Gmail-Anhänge lesen – Ablage nur unter Post/anhaenge/, Inhalt in der Hülle.
 *
 * Nichts davon sendet, zahlt oder reicht ein.
 */
export const EXTRA_RECHENRAUM = ['pdf_bearbeiten', 'diagramm_zeichnen', 'daten_abfragen', 'qr_code', 'karten_anki'] as const;
export const EXTRA_NETZ = ['literatur_suchen', 'doi_bibtex', 'verbindung_suchen', 'wetter_vorhersage'] as const;
export const EXTRA_ALLTAG = ['feiertage', 'umrechnen'] as const;
export const EXTRA_POST = ['post_anhang_lesen'] as const;

export type ExtraWerkzeug = (typeof EXTRA_RECHENRAUM)[number] | (typeof EXTRA_NETZ)[number] | (typeof EXTRA_ALLTAG)[number] | (typeof EXTRA_POST)[number];

export const EXTRA_WERKZEUGE: readonly ExtraWerkzeug[] = [...EXTRA_RECHENRAUM, ...EXTRA_NETZ, ...EXTRA_ALLTAG, ...EXTRA_POST];

export function istExtra(name: string): name is ExtraWerkzeug {
  return (EXTRA_WERKZEUGE as readonly string[]).includes(name);
}

/** Werkzeuge, deren abgelegte Dateien Leif im Chat als Download sieht (neben rechenraum_ablegen & Co.) */
export const EXTRA_DATEI_WERKZEUGE: readonly ExtraWerkzeug[] = [...EXTRA_RECHENRAUM, 'post_anhang_lesen', 'doi_bibtex'];
