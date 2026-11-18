import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { terminAusText, type KalenderAntwort, type KalenderInfo, type KalenderTermin, type TerminAusText } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * Kalender auf dem Marktplatz (E75): Leifs Google Calendar – Monat, Woche, Tag, Liste; anlegen, ändern, verschieben,
 * Serien, Erinnerungen, Farben, löschen. Uni-Fristen sind eingeblendet (nur anzeigen). Zeiten in Linzer/Konstanzer Zeit.
 */
const ZONE = 'Europe/Vienna';
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const RRULE_TAG = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Google-Terminfarben (colorId 1–11) */
export const FARBEN: [string, string, string][] = [
  ['1', 'Lavendel', '#7986cb'],
  ['2', 'Salbei', '#33b679'],
  ['3', 'Weintraube', '#8e24aa'],
  ['4', 'Flamingo', '#e67c73'],
  ['5', 'Banane', '#f6bf26'],
  ['6', 'Mandarine', '#f4511e'],
  ['7', 'Pfau', '#039be5'],
  ['8', 'Graphit', '#616161'],
  ['9', 'Heidelbeere', '#3f51b5'],
  ['10', 'Basilikum', '#0b8043'],
  ['11', 'Tomate', '#d50000'],
];
const ERINNERUNGEN: [number, string][] = [
  [0, 'zur Startzeit'],
  [5, '5 min vorher'],
  [10, '10 min vorher'],
  [15, '15 min vorher'],
  [30, '30 min vorher'],
  [60, '1 h vorher'],
  [120, '2 h vorher'],
  [1440, '1 Tag vorher'],
  [10080, '1 Woche vorher'],
];

type Ansicht = 'monat' | 'woche' | 'tag' | 'liste';

// ---- Datum in Ortszeit (Tage als JJJJ-MM-TT, unabhängig von der Zeitzone des Geräts) ------------------

const teile = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** ISO → Tag und Minute in Ortszeit */
export function ort(iso: string) {
  const p = Object.fromEntries(teile.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { tag: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), zeit: `${p.hour}:${p.minute}` };
}
const heuteTag = () => ort(new Date().toISOString()).tag;
export function tagPlus(tag: string, n: number) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0 = Montag … 6 = Sonntag */
const wochentag = (tag: string) => (new Date(`${tag}T12:00:00Z`).getUTCDay() + 6) % 7;
const montag = (tag: string) => tagPlus(tag, -wochentag(tag));
const monatsErster = (tag: string) => `${tag.slice(0, 8)}01`;
const tagText = (tag: string, o: Intl.DateTimeFormatOptions) => new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { timeZone: 'UTC', ...o });

/** Tage, an denen ein Termin zu sehen ist */
function tageVon(t: KalenderTermin): string[] {
  const von = t.ganztags ? t.start : ort(t.start).tag;
  let bis = t.ganztags ? tagPlus(t.ende, -1) : ort(t.ende).tag;
  // endet genau um Mitternacht → nicht mehr am Folgetag
  if (!t.ganztags && bis > von && ort(t.ende).min === 0) bis = tagPlus(bis, -1);
  const aus: string[] = [];
  for (let d = von; d <= bis && aus.length < 62; d = tagPlus(d, 1)) aus.push(d);
  return aus.length ? aus : [von];
}

/** Tag + Minuten (auch < 0 oder ≥ 24 h) → JJJJ-MM-TTTHH:MM in Ortszeit */
export function lokal(tag: string, min: number) {
  let t = tag;
  let m = Math.round(min);
  while (m < 0) {
    t = tagPlus(t, -1);
    m += 1440;
  }
  while (m >= 1440) {
    t = tagPlus(t, 1);
    m -= 1440;
  }
  return `${t}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Verschieben/Verlängern per Ziehen: nur Zeit/Tag ändern, alles andere bleibt (Felder, die fehlen, lässt der Server in Ruhe) */
export function verschobeneEingabe(t: KalenderTermin, art: 'ziehen' | 'laenge', dMin: number, dTag: number) {
  const basis = { kalenderId: t.kalenderId, titel: t.titel, ganztags: t.ganztags, ...(t.ort !== undefined ? { ort: t.ort } : {}), ...(t.beschreibung !== undefined ? { beschreibung: t.beschreibung } : {}) };
  if (t.ganztags) {
    const ende = art === 'laenge' ? tagPlus(t.ende, dTag) : tagPlus(t.ende, dTag);
    return { ...basis, start: art === 'laenge' ? t.start : tagPlus(t.start, dTag), ende: ende <= t.start ? tagPlus(t.start, 1) : ende };
  }
  const a = ort(t.start);
  const e = ort(t.ende);
  // Ende als Minuten ab dem Starttag (Termine über Mitternacht)
  const tageDazwischen = Math.round((Date.parse(`${e.tag}T00:00:00Z`) - Date.parse(`${a.tag}T00:00:00Z`)) / 86_400_000);
  const endeMin = tageDazwischen * 1440 + e.min;
  if (art === 'laenge') return { ...basis, start: lokal(a.tag, a.min), ende: lokal(a.tag, Math.max(a.min + 15, endeMin + dMin)) };
  const tag = tagPlus(a.tag, dTag);
  return { ...basis, start: lokal(tag, a.min + dMin), ende: lokal(tag, endeMin + dMin) };
}

function bereich(ansicht: Ansicht, anker: string): { erster: string; letzter: string } {
  if (ansicht === 'tag') return { erster: anker, letzter: anker };
  if (ansicht === 'woche') return { erster: montag(anker), letzter: tagPlus(montag(anker), 6) };
  if (ansicht === 'liste') return { erster: anker, letzter: tagPlus(anker, 30) };
  const erster = montag(monatsErster(anker));
  return { erster, letzter: tagPlus(erster, 41) };
}

function farbeVon(t: KalenderTermin, kalender: KalenderInfo[]) {
  if (t.quelle === 'uni') return '#c8553d';
  return FARBEN.find((f) => f[0] === t.farbe)?.[2] ?? kalender.find((k) => k.id === t.kalenderId)?.farbe ?? '#4a86e8';
}

// ---- Hauptkomponente ----------------------------------------------------------------------------------

export function MarktKalender() {
  const [ansicht, setAnsicht] = useState<Ansicht>(() => (localStorage.getItem('kalender-ansicht') as Ansicht) ?? (window.innerWidth < 700 ? 'liste' : 'monat'));
  const [anker, setAnker] = useState(heuteTag());
  const [aus, setAus] = useState<string[]>(() => JSON.parse(localStorage.getItem('kalender-aus') ?? '[]') as string[]);
  const [offen, setOffen] = useState<{ termin?: KalenderTermin; neu?: Neu } | null>(null);
  useEffect(() => localStorage.setItem('kalender-ansicht', ansicht), [ansicht]);
  useEffect(() => localStorage.setItem('kalender-aus', JSON.stringify(aus)), [aus]);

  const { erster, letzter } = bereich(ansicht, anker);
  // großzügig in UTC abfragen (Ortszeit liegt ±2 h daneben), sortiert wird nach Ortszeit
  const von = new Date(Date.parse(`${erster}T00:00:00Z`) - 3 * 3600_000).toISOString();
  const bis = new Date(Date.parse(`${tagPlus(letzter, 1)}T00:00:00Z`) + 3 * 3600_000).toISOString();
  const q = useQuery({ queryKey: ['kalender', von, bis], queryFn: () => api<KalenderAntwort>(`/api/kalender?von=${von}&bis=${bis}`), placeholderData: (alt) => alt });
  const d = q.data;
  const termine = useMemo(() => (d?.termine ?? []).filter((t) => !aus.includes(t.kalenderId)), [d, aus]);
  const jeTag = useMemo(() => {
    const m = new Map<string, KalenderTermin[]>();
    for (const t of termine) for (const tag of tageVon(t)) m.set(tag, [...(m.get(tag) ?? []), t]);
    for (const l of m.values()) l.sort((a, b) => Number(b.ganztags) - Number(a.ganztags) || a.start.localeCompare(b.start));
    return m;
  }, [termine]);

  const schritt = (n: number) =>
    setAnker((a) => (ansicht === 'monat' ? tagPlus(monatsErster(a), n > 0 ? 32 : -1).slice(0, 8) + '01' : tagPlus(a, n * (ansicht === 'woche' ? 7 : ansicht === 'liste' ? 30 : 1))));
  const titel =
    ansicht === 'monat'
      ? tagText(monatsErster(anker), { month: 'long', year: 'numeric' })
      : ansicht === 'tag'
        ? tagText(anker, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : `${tagText(erster, { day: 'numeric', month: 'short' })} – ${tagText(letzter, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const darfSchreiben = d?.modus === 'google' && d.kalender.some((k) => k.schreibbar);
  const qc = useQueryClient();
  const [zugFehler, setZugFehler] = useState('');
  const verschieben = async (t: KalenderTermin, art: 'ziehen' | 'laenge', dMin: number, dTag: number) => {
    if (!dMin && !dTag) return;
    setZugFehler('');
    try {
      await api('/api/kalender/termin', { methode: 'PATCH', body: { id: t.id, vonKalender: t.kalenderId, termin: verschobeneEingabe(t, art, dMin, dTag) } });
    } catch (e) {
      setZugFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await qc.invalidateQueries({ queryKey: ['kalender'] });
  };
  const neu = (tag: string, min?: number, ganztags?: boolean) => darfSchreiben && setOffen({ neu: { tag, min, ganztags } });

  return (
    <div className="markt-kalender">
      <div className="kalender-kopf">
        <div className="zeile">
          <button type="button" onClick={() => schritt(-1)} aria-label="Zurück">
            ‹
          </button>
          <button type="button" onClick={() => setAnker(heuteTag())}>
            Heute
          </button>
          <button type="button" onClick={() => schritt(1)} aria-label="Weiter">
            ›
          </button>
          <h3 className="kalender-titel">{titel}</h3>
        </div>
        <div className="zeile">
          <div className="reiter klein" role="tablist" aria-label="Ansicht">
            {(
              [
                ['monat', 'Monat'],
                ['woche', 'Woche'],
                ['tag', 'Tag'],
                ['liste', 'Liste'],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={ansicht === k} className={ansicht === k ? 'aktiv' : ''} onClick={() => setAnsicht(k)}>
                {t}
              </button>
            ))}
          </div>
          {darfSchreiben && (
            <form
              className="kalender-schnell"
              onSubmit={(e) => {
                e.preventDefault();
                const feld = (e.currentTarget.elements.namedItem('schnell') as HTMLInputElement | null)!;
                const v = terminAusText(feld.value, Date.now());
                if (!v) return;
                setOffen({ neu: { tag: v.start.slice(0, 10), vorlage: v } });
                feld.value = '';
              }}
            >
              <input name="schnell" placeholder="morgen 14 Uhr Zahnarzt …" aria-label="Termin schnell eingeben" maxLength={200} />
            </form>
          )}
          {darfSchreiben && (
            <button type="button" className="haupt" onClick={() => neu(ansicht === 'monat' && anker.slice(0, 7) !== heuteTag().slice(0, 7) ? anker : heuteTag(), 9 * 60)}>
              + Termin
            </button>
          )}
        </div>
      </div>
      {d?.hinweis && <p className="hinweis">{d.hinweis}</p>}
      {zugFehler && <p className="fehler">{zugFehler}</p>}
      {q.error && <p className="fehler">{q.error instanceof ApiFehler ? q.error.message : String(q.error)}</p>}
      {d && (
        <div className="kalender-auswahl">
          {[...d.kalender, ...(d.termine.some((t) => t.quelle === 'uni') ? [{ id: 'uni', name: 'Uni-Fristen', farbe: '#c8553d' }] : [])].map((k) => (
            <label key={k.id} className="kalender-schalter">
              <input type="checkbox" checked={!aus.includes(k.id)} onChange={(e) => setAus((a) => (e.target.checked ? a.filter((x) => x !== k.id) : [...a, k.id]))} />
              <span className="punkt" style={{ background: k.farbe }} />
              {k.name}
            </label>
          ))}
        </div>
      )}
      {ansicht === 'monat' && <Monat anker={anker} erster={erster} jeTag={jeTag} kalender={d?.kalender ?? []} oeffnen={(t) => setOffen({ termin: t })} neu={neu} verschieben={verschieben} tagZeigen={(t) => { setAnker(t); setAnsicht('tag'); }} />}
      {(ansicht === 'woche' || ansicht === 'tag') && (
        <Raster tage={ansicht === 'tag' ? [anker] : Array.from({ length: 7 }, (_, i) => tagPlus(erster, i))} jeTag={jeTag} kalender={d?.kalender ?? []} oeffnen={(t) => setOffen({ termin: t })} neu={neu} verschieben={verschieben} tagZeigen={(t) => { setAnker(t); setAnsicht('tag'); }} />
      )}
      {ansicht === 'liste' && <Liste erster={erster} letzter={letzter} jeTag={jeTag} kalender={d?.kalender ?? []} oeffnen={(t) => setOffen({ termin: t })} />}
      {q.isFetching && <p className="leise">Lade …</p>}
      {offen && d && <TerminFenster antwort={d} {...offen} schliessen={() => setOffen(null)} />}
    </div>
  );
}

const ziehbar = (t: KalenderTermin) => t.quelle === 'google' && t.schreibbar;

function TerminKlotz({ t, kalender, oeffnen, mitZeit = true, ziehen }: { t: KalenderTermin; kalender: KalenderInfo[]; oeffnen?: (t: KalenderTermin) => void; mitZeit?: boolean; ziehen?: (t: KalenderTermin) => void }) {
  const f = farbeVon(t, kalender);
  return (
    <button
      type="button"
      draggable={!!ziehen && ziehbar(t)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.titel);
        e.dataTransfer.effectAllowed = 'move';
        ziehen?.(t);
      }}
      className={`termin${t.ganztags ? ' ganztags' : ''}${t.quelle !== 'google' ? ' fremd' : ''}`}
      style={t.ganztags ? { background: f } : { ['--farbe' as string]: f }}
      onClick={(e) => {
        e.stopPropagation();
        oeffnen?.(t);
      }}
      title={t.titel}
    >
      {!t.ganztags && mitZeit && <span className="termin-zeit">{ort(t.start).zeit}</span>} {t.titel}
    </button>
  );
}

function Monat(p: {
  anker: string;
  erster: string;
  jeTag: Map<string, KalenderTermin[]>;
  kalender: KalenderInfo[];
  oeffnen: (t: KalenderTermin) => void;
  neu: (tag: string, min?: number, ganztags?: boolean) => void;
  tagZeigen: (t: string) => void;
  verschieben: (t: KalenderTermin, art: 'ziehen' | 'laenge', dMin: number, dTag: number) => void;
}) {
  const heute = heuteTag();
  const gezogen = useRef<KalenderTermin | null>(null);
  const [ueber, setUeber] = useState<string | null>(null);
  const monat = p.anker.slice(0, 7);
  return (
    <div className="kalender-monat" role="grid" aria-label="Monat">
      {WOCHENTAGE.map((w) => (
        <div key={w} className="kalender-wt">
          {w}
        </div>
      ))}
      {Array.from({ length: 42 }, (_, i) => {
        const tag = tagPlus(p.erster, i);
        const liste = p.jeTag.get(tag) ?? [];
        return (
          <div
            key={tag}
            role="gridcell"
            aria-label={tagText(tag, { weekday: 'long', day: 'numeric', month: 'long' })}
            className={`kalender-tag${tag.slice(0, 7) !== monat ? ' anderer' : ''}${tag === heute ? ' heute' : ''}${ueber === tag ? ' ziel' : ''}`}
            onClick={() => p.neu(tag, 9 * 60)}
            onDragOver={(e) => {
              if (!gezogen.current) return;
              e.preventDefault();
              setUeber(tag);
            }}
            onDragLeave={() => setUeber((u) => (u === tag ? null : u))}
            onDrop={(e) => {
              e.preventDefault();
              setUeber(null);
              const t = gezogen.current;
              gezogen.current = null;
              if (!t) return;
              const von = t.ganztags ? t.start : ort(t.start).tag;
              const dTag = Math.round((Date.parse(`${tag}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);
              p.verschieben(t, 'ziehen', 0, dTag);
            }}
          >
            <button
              type="button"
              className="tag-nr"
              onClick={(e) => {
                e.stopPropagation();
                p.tagZeigen(tag);
              }}
            >
              {Number(tag.slice(8))}
            </button>
            {liste.slice(0, 4).map((t) => (
              <TerminKlotz key={`${t.kalenderId}:${t.id}`} t={t} kalender={p.kalender} oeffnen={p.oeffnen} ziehen={(x) => (gezogen.current = x)} />
            ))}
            {liste.length > 4 && (
              <button
                type="button"
                className="klein mehr"
                onClick={(e) => {
                  e.stopPropagation();
                  p.tagZeigen(tag);
                }}
              >
                +{liste.length - 4} weitere
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const STUNDE_PX = 44;

/** Woche/Tag: Zeitraster mit Ganztags-Leiste; überlappende Termine nebeneinander */
type Zug = { t: KalenderTermin; art: 'ziehen' | 'laenge'; x0: number; y0: number; breite: number; dMin: number; dTag: number; bewegt: boolean };

function Raster(p: {
  tage: string[];
  jeTag: Map<string, KalenderTermin[]>;
  kalender: KalenderInfo[];
  oeffnen: (t: KalenderTermin) => void;
  neu: (tag: string, min?: number, ganztags?: boolean) => void;
  tagZeigen: (t: string) => void;
  verschieben: (t: KalenderTermin, art: 'ziehen' | 'laenge', dMin: number, dTag: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [zug, setZug] = useState<Zug | null>(null);
  const zugStart = (e: React.PointerEvent, t: KalenderTermin, art: 'ziehen' | 'laenge') => {
    if (!ziehbar(t) || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const spalte = (e.currentTarget as HTMLElement).closest('.raster-spalte') as HTMLElement | null;
    setZug({ t, art, x0: e.clientX, y0: e.clientY, breite: spalte?.getBoundingClientRect().width ?? 100, dMin: 0, dTag: 0, bewegt: false });
  };
  const zugBewegen = (e: React.PointerEvent) => {
    if (!zug) return;
    const dx = e.clientX - zug.x0;
    const dy = e.clientY - zug.y0;
    const bewegt = zug.bewegt || Math.abs(dx) > 4 || Math.abs(dy) > 4;
    const dMin = Math.round(((dy / STUNDE_PX) * 60) / 15) * 15;
    const dTag = zug.art === 'ziehen' ? Math.max(-6, Math.min(6, Math.round(dx / zug.breite))) : 0;
    if (bewegt !== zug.bewegt || dMin !== zug.dMin || dTag !== zug.dTag) setZug({ ...zug, bewegt, dMin, dTag });
  };
  const zugEnde = (e: React.PointerEvent) => {
    if (!zug) return;
    e.stopPropagation();
    const z = zug;
    setZug(null);
    if (z.bewegt) void p.verschieben(z.t, z.art, z.dMin, z.dTag);
    else p.oeffnen(z.t);
  };
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * STUNDE_PX;
  }, []);
  const heute = heuteTag();
  const jetzt = ort(new Date().toISOString());
  return (
    <div className="kalender-raster" style={{ ['--spalten' as string]: p.tage.length }}>
      <div className="raster-kopf">
        <div />
        {p.tage.map((t) => (
          <button key={t} type="button" className={`raster-tag${t === heute ? ' heute' : ''}`} onClick={() => p.tagZeigen(t)}>
            {tagText(t, { weekday: 'short' })} <strong>{Number(t.slice(8))}</strong>
          </button>
        ))}
        <div className="leise klein-text">ganztags</div>
        {p.tage.map((t) => (
          <div key={t} className="raster-ganztags" onClick={() => p.neu(t, undefined, true)}>
            {(p.jeTag.get(t) ?? [])
              .filter((x) => x.ganztags)
              .map((x) => (
                <TerminKlotz key={`${x.kalenderId}:${x.id}`} t={x} kalender={p.kalender} oeffnen={p.oeffnen} />
              ))}
          </div>
        ))}
      </div>
      <div className="raster-koerper" ref={scroll}>
        <div className="raster-stunden">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ height: STUNDE_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {p.tage.map((tag) => {
          const liste = (p.jeTag.get(tag) ?? []).filter((x) => !x.ganztags);
          // Spuren für Überlappungen
          const spuren: number[] = [];
          const lage = liste.map((t) => {
            const a = ort(t.start);
            const e = ort(t.ende);
            const anfang = a.tag < tag ? 0 : a.min;
            const ende = e.tag > tag ? 24 * 60 : Math.max(anfang + 15, e.min);
            let s = spuren.findIndex((bis) => bis <= anfang);
            if (s < 0) s = spuren.push(0) - 1;
            spuren[s] = ende;
            return { t, anfang, ende, spur: s };
          });
          return (
            <div
              key={tag}
              className={`raster-spalte${tag === heute ? ' heute' : ''}`}
              style={{ height: 24 * STUNDE_PX }}
              onClick={(e) => {
                const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
                p.neu(tag, Math.floor(y / STUNDE_PX) * 60);
              }}
            >
              {lage.map(({ t, anfang, ende, spur }) => {
                const z = zug && zug.t === t ? zug : null;
                const hoehe = Math.max(18, ((ende - anfang + (z?.art === 'laenge' ? z.dMin : 0)) / 60) * STUNDE_PX - 2);
                const kann = ziehbar(t);
                return (
                  <div
                    key={`${t.kalenderId}:${t.id}`}
                    className={`raster-termin${kann ? ' ziehbar' : ''}${z?.bewegt ? ' gezogen' : ''}`}
                    style={{
                      top: (anfang / 60) * STUNDE_PX,
                      height: hoehe,
                      left: `${(spur / spuren.length) * 100}%`,
                      width: `${100 / spuren.length}%`,
                      ...(z?.art === 'ziehen' && z.bewegt ? { transform: `translate(${z.dTag * z.breite}px, ${(z.dMin / 60) * STUNDE_PX}px)` } : {}),
                    }}
                    onPointerDown={kann ? (e) => zugStart(e, t, 'ziehen') : undefined}
                    onPointerMove={kann ? zugBewegen : undefined}
                    onPointerUp={kann ? zugEnde : undefined}
                    onPointerCancel={() => setZug(null)}
                    onClick={kann ? (e) => e.stopPropagation() : undefined}
                    data-termin={t.titel}
                  >
                    <TerminKlotz t={t} kalender={p.kalender} oeffnen={kann ? undefined : p.oeffnen} />
                    {z?.bewegt && (
                      <span className="zug-zeit">
                        {(() => {
                          const n = verschobeneEingabe(t, z.art, z.dMin, z.dTag);
                          return `${n.start.slice(11)}–${n.ende.slice(11)}`;
                        })()}
                      </span>
                    )}
                    {kann && (
                      <div
                        className="raster-griff"
                        aria-label={`${t.titel} verlängern`}
                        onPointerDown={(e) => zugStart(e, t, 'laenge')}
                        onPointerMove={zugBewegen}
                        onPointerUp={zugEnde}
                      />
                    )}
                  </div>
                );
              })}
              {tag === heute && <div className="jetzt-linie" style={{ top: (jetzt.min / 60) * STUNDE_PX }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Liste(p: { erster: string; letzter: string; jeTag: Map<string, KalenderTermin[]>; kalender: KalenderInfo[]; oeffnen: (t: KalenderTermin) => void }) {
  const tage: string[] = [];
  for (let t = p.erster; t <= p.letzter; t = tagPlus(t, 1)) if (p.jeTag.get(t)?.length) tage.push(t);
  if (!tage.length) return <p className="leise">Keine Termine in den nächsten 30 Tagen.</p>;
  return (
    <div className="kalender-liste">
      {tage.map((tag) => (
        <section key={tag}>
          <h4 className={tag === heuteTag() ? 'heute' : ''}>{tagText(tag, { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          {p.jeTag.get(tag)!.map((t) => (
            <div key={`${t.kalenderId}:${t.id}`} className="liste-termin">
              <span className="liste-zeit">{t.ganztags ? 'ganztags' : `${ort(t.start).zeit}–${ort(t.ende).zeit}`}</span>
              <TerminKlotz t={t} kalender={p.kalender} oeffnen={p.oeffnen} mitZeit={false} />
              {t.ort && <span className="leise"> · {t.ort}</span>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---- Termin anlegen/bearbeiten --------------------------------------------------------------------------

type Wdh = 'keine' | 'taeglich' | 'woechentlich' | 'werktags' | 'monatlich' | 'jaehrlich' | 'eigene';

function regelLesen(r?: string | null): { art: Wdh; ende: 'nie' | 'datum' | 'anzahl'; bis: string; anzahl: number; roh: string } {
  const leer = { ende: 'nie' as const, bis: '', anzahl: 10, roh: r ?? '' };
  if (!r) return { art: 'keine', ...leer };
  const teile2 = Object.fromEntries(
    r
      .replace(/^RRULE:/, '')
      .split(';')
      .map((x) => x.split('=') as [string, string]),
  );
  const ende = teile2.UNTIL ? 'datum' : teile2.COUNT ? 'anzahl' : 'nie';
  const bis = teile2.UNTIL ? `${teile2.UNTIL.slice(0, 4)}-${teile2.UNTIL.slice(4, 6)}-${teile2.UNTIL.slice(6, 8)}` : '';
  const anzahl = teile2.COUNT ? Number(teile2.COUNT) : 10;
  const art: Wdh =
    teile2.INTERVAL && teile2.INTERVAL !== '1'
      ? 'eigene'
      : teile2.FREQ === 'DAILY'
        ? 'taeglich'
        : teile2.FREQ === 'WEEKLY' && teile2.BYDAY === 'MO,TU,WE,TH,FR'
          ? 'werktags'
          : teile2.FREQ === 'WEEKLY' && (!teile2.BYDAY || !teile2.BYDAY.includes(','))
            ? 'woechentlich'
            : teile2.FREQ === 'MONTHLY' && !teile2.BYDAY
              ? 'monatlich'
              : teile2.FREQ === 'YEARLY'
                ? 'jaehrlich'
                : 'eigene';
  return { art, ende, bis, anzahl, roh: r };
}

function regelBauen(art: Wdh, starttag: string, ende: 'nie' | 'datum' | 'anzahl', bis: string, anzahl: number, roh: string): string | null {
  if (art === 'keine') return null;
  if (art === 'eigene') return roh || null;
  const basis = {
    taeglich: 'FREQ=DAILY',
    woechentlich: `FREQ=WEEKLY;BYDAY=${RRULE_TAG[new Date(`${starttag}T12:00:00Z`).getUTCDay()]}`,
    werktags: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    monatlich: 'FREQ=MONTHLY',
    jaehrlich: 'FREQ=YEARLY',
  }[art];
  const schluss = ende === 'datum' && bis ? `;UNTIL=${bis.replace(/-/g, '')}T225959Z` : ende === 'anzahl' ? `;COUNT=${Math.max(1, Math.min(999, anzahl))}` : '';
  return `RRULE:${basis}${schluss}`;
}

type Neu = { tag: string; min?: number; ganztags?: boolean; vorlage?: TerminAusText };

function TerminFenster({ antwort, termin, neu, schliessen }: { antwort: KalenderAntwort; termin?: KalenderTermin; neu?: Neu; schliessen: () => void }) {
  const v = neu?.vorlage;
  const qc = useQueryClient();
  const schreibbar = antwort.kalender.filter((k) => k.schreibbar);
  const nurLesen = !!termin && (!termin.schreibbar || termin.quelle !== 'google');
  const startOrt = termin ? (termin.ganztags ? { tag: termin.start, zeit: '09:00' } : ort(termin.start)) : { tag: neu!.tag, zeit: `${String(Math.floor((neu!.min ?? 540) / 60)).padStart(2, '0')}:${String((neu!.min ?? 540) % 60).padStart(2, '0')}` };
  const endeOrt = termin
    ? termin.ganztags
      ? { tag: tagPlus(termin.ende, -1), zeit: '10:00' }
      : ort(termin.ende)
    : { tag: neu!.tag, zeit: `${String(Math.min(23, Math.floor((neu!.min ?? 540) / 60) + 1)).padStart(2, '0')}:${String((neu!.min ?? 540) % 60).padStart(2, '0')}` };
  const [f, setF] = useState({
    titel: termin?.titel ?? v?.titel ?? '',
    kalenderId: termin?.kalenderId ?? schreibbar.find((k) => k.primaer)?.id ?? schreibbar[0]?.id ?? '',
    ganztags: termin?.ganztags ?? v?.ganztags ?? !!neu?.ganztags,
    starttag: v ? v.start.slice(0, 10) : startOrt.tag,
    startzeit: v && !v.ganztags ? v.start.slice(11, 16) : startOrt.zeit,
    endtag: v ? (v.ganztags ? tagPlus(v.ende, -1) : v.ende.slice(0, 10)) : endeOrt.tag,
    endzeit: v && !v.ganztags ? v.ende.slice(11, 16) : endeOrt.zeit,
    ort: termin?.ort ?? v?.ort ?? '',
    beschreibung: termin?.beschreibung ?? '',
    farbe: termin?.farbe ?? '',
    erinnerungen: termin?.erinnerungen === undefined ? null : termin.erinnerungen,
  });
  const [wdh, setWdh] = useState(regelLesen(termin?.wiederholung));
  const [serie, setSerie] = useState(false);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const istSerie = !!termin?.serieId;

  // Serien-Regel nachladen (Einzeltermine einer Serie kennen sie nicht)
  useEffect(() => {
    if (!termin?.serieId || nurLesen) return;
    void api<{ wiederholung: string | null }>(`/api/kalender/serie?kalenderId=${encodeURIComponent(termin.kalenderId)}&serieId=${encodeURIComponent(termin.serieId)}`)
      .then((r) => setWdh(regelLesen(r.wiederholung)))
      .catch(() => undefined);
  }, [termin, nurLesen]);

  const setze = (k: keyof typeof f, v: unknown) => setF((alt) => ({ ...alt, [k]: v }));
  const fertig = async () => {
    await qc.invalidateQueries({ queryKey: ['kalender'] });
    schliessen();
  };
  const ausfuehren = async (fn: () => Promise<unknown>) => {
    setFehler('');
    setLaeuft(true);
    try {
      await fn();
      await fertig();
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };
  const eingabe = () => ({
    kalenderId: f.kalenderId,
    titel: f.titel.trim(),
    ganztags: f.ganztags,
    start: f.ganztags ? f.starttag : `${f.starttag}T${f.startzeit}`,
    ende: f.ganztags ? tagPlus(f.endtag, 1) : `${f.endtag}T${f.endzeit}`,
    ort: f.ort,
    beschreibung: f.beschreibung,
    farbe: f.farbe || null,
    erinnerungen: f.erinnerungen,
    // Einzeltermin einer Serie: Regel nur beim Ändern der ganzen Serie mitschicken
    ...(!istSerie || serie ? { wiederholung: regelBauen(wdh.art, f.starttag, wdh.ende, wdh.bis, wdh.anzahl, wdh.roh) } : {}),
  });

  // Esc schließt
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && schliessen();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [schliessen]);

  if (nurLesen)
    return (
      <div className="fenster-hintergrund" onClick={schliessen}>
        <div className="fenster karte" role="dialog" aria-label="Termin" onClick={(e) => e.stopPropagation()}>
          <h3>{termin!.titel}</h3>
          <p>
            {termin!.ganztags
              ? `${tagText(termin!.start, { weekday: 'long', day: 'numeric', month: 'long' })} (ganztags)`
              : `${tagText(ort(termin!.start).tag, { weekday: 'long', day: 'numeric', month: 'long' })}, ${ort(termin!.start).zeit}–${ort(termin!.ende).zeit}`}
          </p>
          {termin!.ort && <p>📍 {termin!.ort}</p>}
          {termin!.beschreibung && <p className="vorformatiert">{termin!.beschreibung}</p>}
          <p className="leise">{termin!.quelle === 'uni' ? 'Uni-Frist – abhaken in der Uni oder auf dem To-do-Brett.' : 'Diesen Termin kannst du hier nicht ändern.'}</p>
          <div className="zeile">
            {termin!.link && (
              <a href={termin!.link} target="_blank" rel="noreferrer">
                In Google Kalender öffnen
              </a>
            )}
            <button type="button" onClick={schliessen}>
              Schließen
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="fenster-hintergrund" onClick={schliessen}>
      <form
        className="fenster karte formspalte termin-form"
        role="dialog"
        aria-label={termin ? 'Termin bearbeiten' : 'Neuer Termin'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void ausfuehren(() =>
            termin
              ? api('/api/kalender/termin', { methode: 'PATCH', body: { id: termin.id, vonKalender: termin.kalenderId, serie: istSerie && serie, termin: eingabe() } })
              : api('/api/kalender/termin', { body: eingabe() }),
          );
        }}
      >
        <input value={f.titel} onChange={(e) => setze('titel', e.target.value)} placeholder="Titel" aria-label="Titel" required maxLength={300} autoFocus className="termin-titel" />
        <div className="zeile">
          <label className="zeile">
            <input type="checkbox" checked={f.ganztags} onChange={(e) => setze('ganztags', e.target.checked)} /> ganztags
          </label>
          <select value={f.kalenderId} onChange={(e) => setze('kalenderId', e.target.value)} aria-label="Kalender">
            {schreibbar.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        <div className="zeile">
          <label>
            Beginn
            <input type="date" value={f.starttag} required onChange={(e) => setF((a) => ({ ...a, starttag: e.target.value, endtag: e.target.value > a.endtag ? e.target.value : a.endtag }))} aria-label="Beginn Datum" />
          </label>
          {!f.ganztags && <input type="time" value={f.startzeit} required onChange={(e) => setze('startzeit', e.target.value)} aria-label="Beginn Uhrzeit" />}
          <label>
            Ende
            <input type="date" value={f.endtag} required min={f.starttag} onChange={(e) => setze('endtag', e.target.value)} aria-label="Ende Datum" />
          </label>
          {!f.ganztags && <input type="time" value={f.endzeit} required onChange={(e) => setze('endzeit', e.target.value)} aria-label="Ende Uhrzeit" />}
        </div>
        <div className="zeile">
          <label>
            Wiederholen
            <select value={wdh.art} onChange={(e) => setWdh((w) => ({ ...w, art: e.target.value as Wdh }))} aria-label="Wiederholen" disabled={istSerie && !serie}>
              <option value="keine">nie</option>
              <option value="taeglich">täglich</option>
              <option value="woechentlich">wöchentlich ({tagText(f.starttag, { weekday: 'long' })})</option>
              <option value="werktags">werktags (Mo–Fr)</option>
              <option value="monatlich">monatlich</option>
              <option value="jaehrlich">jährlich</option>
              {wdh.art === 'eigene' && <option value="eigene">eigene Regel</option>}
            </select>
          </label>
          {wdh.art !== 'keine' && wdh.art !== 'eigene' && (!istSerie || serie) && (
            <>
              <select value={wdh.ende} onChange={(e) => setWdh((w) => ({ ...w, ende: e.target.value as 'nie' | 'datum' | 'anzahl' }))} aria-label="Wiederholung endet">
                <option value="nie">endet nie</option>
                <option value="datum">endet am</option>
                <option value="anzahl">endet nach</option>
              </select>
              {wdh.ende === 'datum' && <input type="date" value={wdh.bis} min={f.starttag} onChange={(e) => setWdh((w) => ({ ...w, bis: e.target.value }))} aria-label="Wiederholung bis" />}
              {wdh.ende === 'anzahl' && (
                <>
                  <input type="number" min={1} max={999} value={wdh.anzahl} onChange={(e) => setWdh((w) => ({ ...w, anzahl: Number(e.target.value) }))} className="kurz" aria-label="Anzahl Termine" /> Mal
                </>
              )}
            </>
          )}
        </div>
        <input value={f.ort} onChange={(e) => setze('ort', e.target.value)} placeholder="Ort" aria-label="Ort" maxLength={500} />
        <textarea rows={3} value={f.beschreibung} onChange={(e) => setze('beschreibung', e.target.value)} placeholder="Beschreibung" aria-label="Beschreibung" maxLength={8000} />
        <div className="zeile">
          <label>
            Erinnerung
            <select
              aria-label="Erinnerung"
              value={f.erinnerungen === null ? 'standard' : f.erinnerungen.length ? String(f.erinnerungen[0]) : 'keine'}
              onChange={(e) => setze('erinnerungen', e.target.value === 'standard' ? null : e.target.value === 'keine' ? [] : [Number(e.target.value), ...(f.erinnerungen ?? []).slice(1)])}
            >
              <option value="standard">wie im Kalender eingestellt</option>
              <option value="keine">keine</option>
              {ERINNERUNGEN.map(([m, t]) => (
                <option key={m} value={m}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {f.erinnerungen && f.erinnerungen.length > 0 && f.erinnerungen.length < 5 && (
            <select aria-label="Weitere Erinnerung" value="" onChange={(e) => e.target.value && setze('erinnerungen', [...new Set([...(f.erinnerungen ?? []), Number(e.target.value)])])}>
              <option value="">+ weitere Erinnerung</option>
              {ERINNERUNGEN.filter(([m]) => !f.erinnerungen!.includes(m)).map(([m, t]) => (
                <option key={m} value={m}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {f.erinnerungen && f.erinnerungen.length > 1 && <span className="leise">{f.erinnerungen.map((m) => ERINNERUNGEN.find((x) => x[0] === m)?.[1] ?? `${m} min`).join(', ')}</span>}
        </div>
        <div className="zeile farbwahl" role="radiogroup" aria-label="Farbe">
          <button type="button" className={`farbe standard${!f.farbe ? ' gewaehlt' : ''}`} onClick={() => setze('farbe', '')} title="Kalenderfarbe" aria-label="Kalenderfarbe" />
          {FARBEN.map(([id, name, hex]) => (
            <button key={id} type="button" className={`farbe${f.farbe === id ? ' gewaehlt' : ''}`} style={{ background: hex }} onClick={() => setze('farbe', id)} title={name} aria-label={name} />
          ))}
        </div>
        {istSerie && (
          <div className="zeile" role="radiogroup" aria-label="Serie">
            <label>
              <input type="radio" checked={!serie} onChange={() => setSerie(false)} /> nur dieser Termin
            </label>
            <label>
              <input type="radio" checked={serie} onChange={() => setSerie(true)} /> ganze Serie
            </label>
          </div>
        )}
        {fehler && <p className="fehler">{fehler}</p>}
        <div className="zeile">
          <button type="submit" className="haupt" disabled={laeuft || !f.kalenderId}>
            Speichern
          </button>
          <button type="button" onClick={schliessen}>
            Abbrechen
          </button>
          {termin && (
            <button
              type="button"
              className="gefahr"
              disabled={laeuft}
              onClick={() =>
                void ausfuehren(() => api(`/api/kalender/termin?kalenderId=${encodeURIComponent(termin.kalenderId)}&id=${encodeURIComponent(termin.id)}${istSerie && serie ? '&serie=ja' : ''}`, { methode: 'DELETE' }))
              }
            >
              {istSerie && serie ? 'Serie löschen' : 'Löschen'}
            </button>
          )}
          {termin?.link && (
            <a href={termin.link} target="_blank" rel="noreferrer" className="leise">
              in Google öffnen
            </a>
          )}
        </div>
        {termin?.teilnehmer ? <p className="leise">👥 {termin.teilnehmer} Teilnehmer – Einladungen verschickt das Dorf nie.</p> : null}
      </form>
    </div>
  );
}
