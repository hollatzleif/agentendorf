import { belegtMs, istFristBlock, minutenText, type KalenderTermin } from '@dorf/shared';
import { ort } from './MarktKalender';

const VON = 8 * 60;
const BIS = 22 * 60;
const SPANNE = BIS - VON;
const MIN_LUECKE = 30;
const zeit = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Anteil an der Leiste in Prozent (für left: Abstand ab 8 Uhr, für width: Dauer) */
const prozent = (min: number) => `${((min / SPANNE) * 100).toFixed(2)}%`;

/** Minuten des Tages (Ortszeit) eines Termins am Tag `heute` – was über Mitternacht reicht, wird am Tagesrand abgeschnitten */
function spanne(t: KalenderTermin, heute: string): [number, number] {
  const a = ort(t.start);
  const b = ort(t.ende);
  return [a.tag < heute ? 0 : a.tag > heute ? 1440 : a.min, b.tag > heute ? 1440 : b.tag < heute ? 0 : b.min];
}

/** Freie Lücken zwischen 8 und 22 Uhr, die mindestens 30 min lang sind */
export function freieLuecken(belegt: [number, number][]): [number, number][] {
  const luecken: [number, number][] = [];
  let ende = VON;
  for (const [a, b] of [...belegt].sort((x, y) => x[0] - y[0])) {
    if (a - ende >= MIN_LUECKE) luecken.push([ende, a]);
    ende = Math.max(ende, b);
  }
  if (BIS - ende >= MIN_LUECKE) luecken.push([ende, BIS]);
  return luecken;
}

/**
 * E157: der Tag von 8 bis 22 Uhr als Leiste – Termine als farbige Blöcke, freie Lücken gestrichelt, Jetzt-Linie.
 * Reine Anzeige (role="img"); die Liste darunter bleibt der bedienbare Weg zu den Terminen.
 */
export function TagesLeiste({ termine, heute, jetztMin, farbe }: { termine: KalenderTermin[]; heute: string; jetztMin: number; farbe: (t: KalenderTermin) => string }) {
  const bloecke = termine
    .filter((t) => !t.ganztags && !istFristBlock(t))
    .map((t) => {
      const [a, b] = spanne(t, heute);
      return { t, von: Math.max(a, VON), bis: Math.min(b, BIS) };
    })
    .filter((b) => b.bis > b.von);
  const belegt = bloecke.map((b) => [b.von, b.bis] as [number, number]);
  const frei = SPANNE - belegtMs(belegt, VON, BIS);
  const luecken = freieLuecken(belegt);
  const jetztSichtbar = jetztMin >= VON && jetztMin <= BIS;
  const vergangen = Math.min(Math.max(jetztMin, VON), BIS) - VON;
  const text = `Tagesleiste: ${bloecke.length === 0 ? 'keine Termine' : `${bloecke.length} Termin${bloecke.length === 1 ? '' : 'e'}`}, frei ≈ ${minutenText(frei)}`;
  return (
    <div className="tagesleiste" role="img" aria-label={text}>
      <div className="tagesleiste-bahn">
        {luecken.map(([a, b]) => (
          <span key={`l${a}`} className="tagesleiste-frei" title={`frei ${zeit(a)}–${zeit(b)}`} style={{ left: prozent(a - VON), width: prozent(b - a) }} />
        ))}
        {bloecke.map(({ t, von, bis }) => (
          <span
            key={`${t.kalenderId}:${t.id}`}
            className="tagesleiste-block"
            title={`${ort(t.start).zeit}–${ort(t.ende).zeit} ${t.titel}`}
            style={{ left: prozent(von - VON), width: prozent(bis - von), ['--farbe' as string]: farbe(t) }}
          />
        ))}
        {vergangen > 0 && <span className="tagesleiste-vorbei" style={{ width: prozent(vergangen) }} />}
        {jetztSichtbar && <span className="tagesleiste-jetzt" title={`jetzt ${zeit(jetztMin)}`} style={{ left: prozent(jetztMin - VON) }} />}
      </div>
      <div className="tagesleiste-stunden" aria-hidden="true">
        {[8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
          <span key={h} style={{ left: prozent(h * 60 - VON) }}>
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}
