import path from 'node:path';
import { z } from 'zod';
import { MAX_ANHANG_BYTES } from '@dorf/shared';
import { DorfFehler } from '../fehler.js';
import type { VaultDienst } from '../vault/dienst.js';
import { normalisieren } from '../vault/pfade.js';
import { BILD_SCHRITT_ARTEN, kurzname, type BildSchritt, type RechenraumKlient } from './rechenraum.js';
import type { WerkzeugAufrufErgebnis, WerkzeugDefinition } from './werkzeuge.js';

/**
 * E198: bild_bearbeiten – Agenten bearbeiten Bilder aus dem Vault (zuschneiden, Größe, drehen, Format, Hintergrund
 * entfernen, hochskalieren …). Gerechnet wird NUR im Rechenraum (kein Internet, kein Vault); das Original bleibt, wie es
 * ist. Das Ergebnis ist immer eine NEUE Datei im Ablage-Ordner des Chats, den der Code bestimmt (wie rechenraum_ablegen:
 * Bürgermeister Rathaus/dateien/…, sonst <Gebäude>/entwuerfe/…) – der Agent wählt weder Ordner noch Endung frei.
 * Bilder generieren (Cloudflare) gibt es für Agenten nicht: Das wäre ein Weg, auf dem Text das Dorf verlässt.
 */
export const BILD_ENDUNGEN = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.svg', '.ico', '.jfif'];
/** So groß darf die Vorschau fürs Modell höchstens sein (wie anhaenge.ts) */
const VORSCHAU_MAX = 3_500_000;

export const BILD_WERKZEUG_DEFINITION: WerkzeugDefinition = {
  name: 'bild_bearbeiten',
  description:
    'Bearbeitet ein Bild aus dem Vault (PNG, JPG, WebP, GIF, BMP, TIFF, HEIC, SVG) im Rechenraum und legt das Ergebnis als NEUE Datei ab – das Original bleibt unverändert. ' +
    'schritte laufen der Reihe nach: zuschneiden (x, y, breite, hoehe in Pixeln), groesse (breite und/oder hoehe; fehlt eine, bleibt das Seitenverhältnis), ' +
    'drehen (grad im Uhrzeigersinn), spiegeln (richtung: horizontal/vertikal), hintergrund_entfernen (stellt das Hauptmotiv frei, Ergebnis mit Durchsichtigkeit → format png oder webp), ' +
    'hochskalieren (faktor 2 oder 4, KI-Modell, nur für kleine Bilder bis etwa 1024×1024), graustufen, invertieren, automatisch (Kontrast automatisch), ' +
    'helligkeit / kontrast / saettigung (wert −100 … 100), weichzeichnen (wert = Radius in Pixeln), schaerfen (wert = Stärke in Prozent, üblich 100). ' +
    'Leere schritte = nur das Format ändern. Der Zielordner ist für diesen Chat fest vorgegeben; du bekommst den Pfad und eine Vorschau zurück. Leif sieht die Datei im Chat.',
  input_schema: {
    type: 'object',
    properties: {
      pfad: { type: 'string', description: 'Bild im Vault, Pfad relativ zum Vault' },
      schritte: {
        type: 'array',
        description: 'Bearbeitungsschritte in der Reihenfolge, in der sie angewendet werden',
        items: {
          type: 'object',
          properties: {
            art: { type: 'string', enum: [...BILD_SCHRITT_ARTEN] },
            x: { type: 'integer', description: 'zuschneiden: linke Kante' },
            y: { type: 'integer', description: 'zuschneiden: obere Kante' },
            breite: { type: 'integer', description: 'zuschneiden, groesse' },
            hoehe: { type: 'integer', description: 'zuschneiden, groesse' },
            grad: { type: 'number', description: 'drehen: im Uhrzeigersinn' },
            richtung: { type: 'string', enum: ['horizontal', 'vertikal'], description: 'spiegeln' },
            faktor: { type: 'integer', enum: [2, 4], description: 'hochskalieren' },
            wert: { type: 'number', description: 'helligkeit, kontrast, saettigung (−100 … 100); weichzeichnen (Radius); schaerfen (Stärke %)' },
          },
          required: ['art'],
          additionalProperties: false,
        },
      },
      format: { type: 'string', enum: ['png', 'jpg', 'webp'], description: 'Zielformat; Standard: png bei Durchsichtigkeit oder PNG-Quelle, sonst jpg' },
      name: { type: 'string', description: 'Optional: kurzer Name für die neue Datei (ohne Endung)' },
    },
    required: ['pfad', 'schritte'],
    additionalProperties: false,
  },
};

const Schritt = z
  .object({
    art: z.enum(BILD_SCHRITT_ARTEN),
    x: z.number().optional(),
    y: z.number().optional(),
    breite: z.number().optional(),
    hoehe: z.number().optional(),
    grad: z.number().optional(),
    richtung: z.enum(['horizontal', 'vertikal']).optional(),
    faktor: z.number().optional(),
    wert: z.number().optional(),
  })
  .strict();
const Eingabe = z
  .object({
    pfad: z.string().min(1),
    schritte: z.array(Schritt).max(12),
    format: z.enum(['png', 'jpg', 'webp']).optional(),
    name: z.string().max(80).optional(),
  })
  .strict();

/** Agenten-Form → Rechenraum-Form (wert heißt dort je nach Schritt radius bzw. staerke) */
function fuerRechenraum(s: z.infer<typeof Schritt>): BildSchritt {
  const { wert, ...rest } = s;
  if (wert === undefined) return rest;
  if (s.art === 'weichzeichnen') return { ...rest, radius: wert };
  if (s.art === 'schaerfen') return { ...rest, staerke: wert };
  return { ...rest, wert };
}

export interface BildAuftrag {
  vault: VaultDienst;
  klient: RechenraumKlient;
  /** Ablage-Ordner des Chats (vom Code bestimmt) */
  ablage: string;
  eingabe: unknown;
}

export async function bildBearbeiten(a: BildAuftrag): Promise<{ ergebnis: WerkzeugAufrufErgebnis; quelle: string; ziel: string; kurz: string }> {
  const e = Eingabe.parse(a.eingabe);
  const quelle = normalisieren(e.pfad);
  const ext = path.posix.extname(quelle).toLowerCase();
  if (!BILD_ENDUNGEN.includes(ext)) throw new DorfFehler(400, `${quelle} ist kein Bild, das sich bearbeiten lässt (${BILD_ENDUNGEN.join(', ')}).`);
  const st = await a.vault.stat(quelle);
  if (!st?.isFile()) throw new DorfFehler(404, `Gibt es nicht: ${quelle}`);
  if (st.size > MAX_ANHANG_BYTES) throw new DorfFehler(413, `Bild zu groß (höchstens ${MAX_ANHANG_BYTES / 1024 / 1024} MB).`);
  const d = await a.vault.puffer(quelle, { max: MAX_ANHANG_BYTES });
  if (!d) throw new DorfFehler(404, `Gibt es nicht: ${quelle}`);

  const schritte = e.schritte.map(fuerRechenraum);
  const freigestellt = schritte.some((s) => s.art === 'hintergrund_entfernen');
  const format = e.format ?? (freigestellt || ['.png', '.gif', '.svg', '.webp', '.ico'].includes(ext) ? 'png' : 'jpg');
  const r = await a.klient.bild(path.posix.basename(quelle), d.inhalt, schritte, format);

  // Name: vom Agenten (bereinigt) oder vom Original. E204: nie eine bestehende Datei ersetzen – auch keine, die dieser Chat
  // früher geschrieben hat (Leif kann sie inzwischen bearbeitet haben); stattdessen -2, -3 …, geschrieben nur als neue Datei
  const basis = kurzname(e.name?.trim() || `${path.posix.basename(quelle, path.posix.extname(quelle))}-bearbeitet`, 60);
  let w: Awaited<ReturnType<VaultDienst['schreiben']>> | null = null;
  for (let i = 1; !w; i++) {
    if (i > 50) throw new DorfFehler(409, 'Zu viele gleichnamige Dateien im Ablage-Ordner.');
    const ziel = `${a.ablage}/${basis}${i > 1 ? `-${i}` : ''}.${format}`;
    if (await a.vault.existiert(ziel)) continue;
    try {
      w = await a.vault.schreiben(ziel, r.inhalt, { nurNeu: true });
    } catch (x) {
      // im selben Augenblick entstanden (Wettlauf) → nächster Name
      if (!(x instanceof DorfFehler) || x.status !== 409) throw x;
    }
  }

  // Vorschau fürs Modell: das Ergebnis selbst, wenn es klein genug ist – sonst eine verkleinerte Fassung
  let bilder: WerkzeugAufrufErgebnis['bilder'];
  const mime = r.mime as 'image/png' | 'image/jpeg' | 'image/webp';
  if (r.inhalt.length <= VORSCHAU_MAX && Math.max(r.breite, r.hoehe) <= 1568) bilder = [{ mime, base64: r.inhalt.toString('base64') }];
  else {
    const klein = await a.klient
      .bild(`ergebnis.${format}`, r.inhalt, [r.breite >= r.hoehe ? { art: 'groesse', breite: Math.min(1568, r.breite) } : { art: 'groesse', hoehe: Math.min(1568, r.hoehe) }], r.transparenz ? 'png' : 'jpg')
      .catch(() => null);
    if (klein && klein.inhalt.length <= VORSCHAU_MAX) bilder = [{ mime: klein.mime as 'image/png' | 'image/jpeg', base64: klein.inhalt.toString('base64') }];
  }
  const kurz = `${r.eingang[0]}×${r.eingang[1]} → ${r.breite}×${r.hoehe} ${format.toUpperCase()}, ${Math.max(1, Math.round(r.inhalt.length / 1024))} KB`;
  const text = [
    `Abgelegt: ${w.pfad}`,
    `${kurz}${r.transparenz ? ', mit Durchsichtigkeit' : ''}. Das Original (${quelle}) ist unverändert.`,
    ...(r.hinweise.length ? [`Hinweise: ${r.hinweise.join(' · ')}`] : []),
    bilder ? 'Vorschau:' : '(Keine Vorschau – das Ergebnis ist zu groß.)',
  ].join('\n');
  return { ergebnis: { ok: true, text, ...(bilder ? { bilder } : {}) }, quelle, ziel: w.pfad, kurz };
}
