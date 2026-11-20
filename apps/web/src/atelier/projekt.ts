/**
 * E198 Atelier: Projektformat „.atelier“ – EINE Datei, damit Speichern im Vault atomar bleibt und die Konfliktkopie
 * (basisVersion) für das ganze Projekt gilt, nicht für einzelne Ebenen. Innen ein ZIP ohne Kompression („store“):
 *   projekt.json   Größe, Ebenen (Name, Sichtbarkeit, Deckkraft, Mischmodus, Datei), aktive Ebene
 *   ebene-N.png    je Ebene ein PNG in Dokumentgröße (PNG ist schon komprimiert – darum reicht „store“)
 *   vorschau.png   das fertige Bild, klein (für andere Programme und einen schnellen Blick)
 * Jedes ZIP-Programm kann die Datei öffnen; die Ebenen sind normale PNGs. Keine Bibliothek nötig.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(d: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipDatei {
  name: string;
  daten: Uint8Array;
}

/** ZIP ohne Kompression schreiben (Namen in UTF-8) */
export function zipSchreiben(dateien: ZipDatei[]): Uint8Array {
  const kodierer = new TextEncoder();
  const teile: Uint8Array[] = [];
  const verzeichnis: Uint8Array[] = [];
  let versatz = 0;
  for (const f of dateien) {
    const name = kodierer.encode(f.name);
    const pruef = crc32(f.daten);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true);
    kopf.setUint16(4, 20, true); // Version
    kopf.setUint16(6, 0x0800, true); // UTF-8-Namen
    kopf.setUint16(8, 0, true); // store
    kopf.setUint16(10, 0, true);
    kopf.setUint16(12, 0x21, true); // 1.1.1980
    kopf.setUint32(14, pruef, true);
    kopf.setUint32(18, f.daten.length, true);
    kopf.setUint32(22, f.daten.length, true);
    kopf.setUint16(26, name.length, true);
    kopf.setUint16(28, 0, true);
    teile.push(new Uint8Array(kopf.buffer), name, f.daten);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true);
    z.setUint16(4, 20, true);
    z.setUint16(6, 20, true);
    z.setUint16(8, 0x0800, true);
    z.setUint16(10, 0, true);
    z.setUint16(12, 0, true);
    z.setUint16(14, 0x21, true);
    z.setUint32(16, pruef, true);
    z.setUint32(20, f.daten.length, true);
    z.setUint32(24, f.daten.length, true);
    z.setUint16(28, name.length, true);
    z.setUint32(42, versatz, true);
    verzeichnis.push(new Uint8Array(z.buffer), name);
    versatz += 30 + name.length + f.daten.length;
  }
  const vLaenge = verzeichnis.reduce((s, t) => s + t.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, vLaenge, true);
  ende.setUint32(16, versatz, true);
  const alles = [...teile, ...verzeichnis, new Uint8Array(ende.buffer)];
  const aus = new Uint8Array(alles.reduce((s, t) => s + t.length, 0));
  let o = 0;
  for (const t of alles) {
    aus.set(t, o);
    o += t.length;
  }
  return aus;
}

/** ZIP lesen – über das Inhaltsverzeichnis am Ende; nur unkomprimierte Einträge (so schreibt das Atelier) */
export function zipLesen(d: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let ende = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      ende = i;
      break;
    }
  }
  if (ende < 0) throw new Error('Kein Atelier-Projekt (ZIP-Ende fehlt).');
  const anzahl = v.getUint16(ende + 10, true);
  let o = v.getUint32(ende + 16, true);
  const aus = new Map<string, Uint8Array>();
  const dekodierer = new TextDecoder();
  for (let n = 0; n < anzahl; n++) {
    if (o + 46 > d.length || v.getUint32(o, true) !== 0x02014b50) throw new Error('Atelier-Projekt beschädigt (Verzeichnis).');
    const methode = v.getUint16(o + 10, true);
    const groesse = v.getUint32(o + 20, true);
    const nameL = v.getUint16(o + 28, true);
    const extraL = v.getUint16(o + 30, true);
    const kommentarL = v.getUint16(o + 32, true);
    const lokal = v.getUint32(o + 42, true);
    const name = dekodierer.decode(d.subarray(o + 46, o + 46 + nameL));
    if (methode !== 0) throw new Error(`Atelier-Projekt: „${name}“ ist komprimiert – das liest das Atelier nicht.`);
    if (lokal + 30 > d.length || v.getUint32(lokal, true) !== 0x04034b50) throw new Error('Atelier-Projekt beschädigt (Eintrag).');
    const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
    if (start + groesse > d.length) throw new Error('Atelier-Projekt beschädigt (abgeschnitten).');
    aus.set(name, d.subarray(start, start + groesse));
    o += 46 + nameL + extraL + kommentarL;
  }
  return aus;
}

export const PROJEKT_FORMAT = 'agentendorf-atelier';
export interface ProjektEbene {
  name: string;
  sichtbar: boolean;
  deckkraft: number;
  modus: string;
  datei: string;
}
export interface ProjektInhalt {
  format: typeof PROJEKT_FORMAT;
  version: 1;
  breite: number;
  hoehe: number;
  aktiv: number;
  ebenen: ProjektEbene[];
}
