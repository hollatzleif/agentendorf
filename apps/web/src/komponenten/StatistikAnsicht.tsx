import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Statistik } from "@dorf/shared";
import { guteTage } from "@dorf/shared";
import { api } from "../api";

/**
 * Statistik (E93): Kennzahlen oben, darunter je Kennzahl ein eigenes Balkendiagramm (kleine Vielfache statt zwei
 * Achsen). Eine Reihe je Diagramm → kein Legendenkasten, der Titel nennt sie. Hover/Tippen zeigt den Wert,
 * „Tabelle“ zeigt alle Zahlen.
 */
type Tag = Statistik["tage"][number];

const tagKurz = (
  t: string,
  o: Intl.DateTimeFormatOptions = { day: "numeric", month: "numeric" },
) =>
  new Date(`${t}T12:00:00Z`).toLocaleDateString("de-AT", {
    timeZone: "UTC",
    ...o,
  });
const stunden = (min: number) =>
  min >= 60
    ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim()
    : `${min} min`;
const STIMMUNG = ['😞', '😕', '😐', '🙂', '😄'];
const quote = (t: Tag) =>
  t.gewohnheitenFaellig
    ? Math.round((t.gewohnheitenErledigt / t.gewohnheitenFaellig) * 100)
    : null;

export function StatistikAnsicht() {
  const [tage, setTage] = useState(28);
  const [tabelle, setTabelle] = useState(false);
  const q = useQuery({
    queryKey: ["statistik", tage],
    queryFn: () => api<Statistik>(`/api/statistik?tage=${tage}`),
    placeholderData: (alt) => alt,
  });
  const s = q.data;
  return (
    <section className="statistik" aria-label="Statistik">
      <div className="statistik-filter" role="group" aria-label="Zeitraum">
        {[28, 90].map((n) => (
          <button
            key={n}
            type="button"
            className={`klein${tage === n ? " an" : ""}`}
            aria-pressed={tage === n}
            onClick={() => setTage(n)}
          >
            {n === 28 ? "4 Wochen" : "3 Monate"}
          </button>
        ))}
        <button
          type="button"
          className={`klein${tabelle ? " an" : ""}`}
          aria-pressed={tabelle}
          onClick={() => setTabelle(!tabelle)}
        >
          Tabelle
        </button>
      </div>
      {q.isError && (
        <p className="fehler">Statistik nicht erreichbar: {q.error.message}</p>
      )}
      {!s && q.isPending && <p className="leise">Lade …</p>}
      {s && (
        <>
          <div className="statistik-kacheln">
            <Kachel
              wert={String(s.summen.erledigtWoche)}
              titel="To-dos erledigt"
              unter={`letzte 7 Tage · ${s.summen.erledigt} in ${tage} Tagen`}
            />
            <Kachel
              wert={stunden(s.summen.fokusMinWoche)}
              titel="Fokus"
              unter={`letzte 7 Tage · ${stunden(s.summen.fokusMin)} in ${tage} Tagen`}
            />
            <Kachel
              wert={
                s.summen.gewohnheitenQuote == null
                  ? "–"
                  : `${s.summen.gewohnheitenQuote} %`
              }
              titel="Gewohnheiten"
              unter={
                s.summen.gewohnheitenQuote == null
                  ? "noch keine angelegt"
                  : `der fälligen erledigt (${tage} Tage)`
              }
            />
            <Kachel
              wert={`${s.summen.aktiveTage}/${tage}`}
              titel="Aktive Tage"
              unter="mit Erledigtem, Fokus oder Gewohnheit"
            />
          </div>
          {tabelle ? (
            <Tabelle tage={s.tage} />
          ) : (
            <>
              <Balken
                titel="☑️ Erledigte To-dos je Tag"
                tage={s.tage}
                wert={(t) => t.erledigt}
                text={(t) => `${t.erledigt} erledigt`}
              />
              <Balken
                titel="🍅 Fokus je Tag"
                tage={s.tage}
                wert={(t) => t.fokusMin}
                text={(t) => stunden(t.fokusMin)}
                einheit={(v) => stunden(v)}
              />
              {s.summen.gewohnheitenQuote == null ? (
                <p className="leise">
                  🔁 Gewohnheiten erscheinen hier, sobald du auf „Heute“ welche
                  anlegst und abhakst.
                </p>
              ) : (
                <Balken
                  titel="🔁 Gewohnheiten je Tag (Anteil erledigt)"
                  tage={s.tage}
                  wert={(t) => quote(t) ?? 0}
                  leer={(t) => quote(t) == null}
                  max={100}
                  text={(t) =>
                    quote(t) == null
                      ? "nichts fällig"
                      : `${t.gewohnheitenErledigt}/${t.gewohnheitenFaellig} (${quote(t)} %)`
                  }
                  einheit={(v) => `${v} %`}
                />
              )}
              {s.fokusJeStunde && s.fokusJeStunde.some((m) => m > 0) && <Tageszeit werte={s.fokusJeStunde} beste={s.besteZeit ?? null} />}
              {/* E162: was mit guten Tagen zusammenhängt (nur bei genug Daten) */}
              {guteTage(s.tage).length > 0 && (
                <div className="karte statistik-einsichten" role="note" aria-label="Was gute Tage ausmacht">
                  <h3>💡 Was gute Tage ausmacht</h3>
                  <ul>
                    {guteTage(s.tage).map((e) => (
                      <li key={e.text}>
                        {e.text} <span className="leise">({e.tageMit} gegen {e.tageOhne} Tage)</span>
                      </li>
                    ))}
                  </ul>
                  <p className="leise">Ein Zusammenhang, kein Beweis – aber ein guter Hinweis, worauf du achten kannst.</p>
                </div>
              )}
              {s.summen.stimmungSchnitt != null && (
                <Balken
                  titel="💭 Stimmung (1–5)"
                  tage={s.tage}
                  wert={(t) => t.stimmung ?? 0}
                  leer={(t) => t.stimmung == null}
                  max={5}
                  text={(t) => (t.stimmung == null ? 'nicht angegeben' : `${STIMMUNG[t.stimmung - 1]} ${t.stimmung}/5`)}
                  einheit={(v) => `${v}/5`}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function Kachel({
  wert,
  titel,
  unter,
}: {
  wert: string;
  titel: string;
  unter: string;
}) {
  return (
    <div className="statistik-kachel">
      <span className="statistik-kachel-titel">{titel}</span>
      <span className="statistik-kachel-wert">{wert}</span>
      <span className="statistik-kachel-unter">{unter}</span>
    </div>
  );
}

const B = 640;
const H = 110;
const UNTEN = 0;
const LINKS = 0;

function Balken({
  titel,
  tage,
  wert,
  text,
  einheit = String,
  max,
  leer,
}: {
  titel: string;
  tage: Tag[];
  wert: (t: Tag) => number;
  text: (t: Tag) => string;
  einheit?: (v: number) => string;
  max?: number;
  leer?: (t: Tag) => boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const hoechst = Math.max(max ?? 0, ...tage.map(wert), 1);
  const schritt = (B - LINKS) / tage.length;
  const breite = Math.max(2, schritt - 2); // 2px Lücke zwischen Balken
  const y = (v: number) => (H - UNTEN) * (1 - v / hoechst);
  const h = tage[hover ?? -1];
  const alleNull = tage.every((t) => wert(t) === 0);
  return (
    <figure className="statistik-diagramm" aria-label={titel}>
      <figcaption>
        <span>{titel}</span>
        <span className="statistik-hover" aria-live="polite">
          {h
            ? `${tagKurz(h.tag, { weekday: "short", day: "numeric", month: "numeric" })}: ${text(h)}`
            : alleNull
              ? "noch keine Daten"
              : `höchstens ${einheit(hoechst)}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${B} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titel}: ${tage.map((t) => `${tagKurz(t.tag)} ${text(t)}`).join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={LINKS}
          x2={B}
          y1={y(hoechst)}
          y2={y(hoechst)}
          className="statistik-gitter"
        />
        <line
          x1={LINKS}
          x2={B}
          y1={H - UNTEN}
          y2={H - UNTEN}
          className="statistik-achse"
        />
        {tage.map((t, i) => {
          const v = wert(t);
          const x = LINKS + i * schritt + 1;
          const hoehe = H - UNTEN - y(v);
          const montag = new Date(`${t.tag}T12:00:00Z`).getUTCDay() === 1;
          return (
            <g key={t.tag}>
              {v > 0 && !leer?.(t) && (
                <path
                  d={balkenPfad(x, H - UNTEN, breite, hoehe)}
                  className={`statistik-balken${hover === i ? " an" : ""}`}
                />
              )}
              {leer?.(t) && (
                <rect
                  x={x}
                  y={H - UNTEN - 2}
                  width={breite}
                  height={2}
                  className="statistik-leer"
                />
              )}
              {/* Trefferfläche größer als der Balken */}
              <rect
                className="statistik-treffer"
                x={LINKS + i * schritt}
                y={0}
                width={schritt}
                height={H - UNTEN}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      <div className="statistik-x" aria-hidden>
        {tage.map((t, i) =>
          new Date(`${t.tag}T12:00:00Z`).getUTCDay() === 1 ? (
            <span
              key={t.tag}
              style={{ left: `${((i + 0.5) / tage.length) * 100}%` }}
            >
              {tagKurz(t.tag)}
            </span>
          ) : null,
        )}
      </div>
    </figure>
  );
}

/** Balken mit 4px Rundung oben, flach auf der Grundlinie */
function balkenPfad(x: number, unten: number, b: number, h: number) {
  const r = Math.min(4, b / 2, h);
  return `M${x},${unten} V${unten - h + r} Q${x},${unten - h} ${x + r},${unten - h} H${x + b - r} Q${x + b},${unten - h} ${x + b},${unten - h + r} V${unten} Z`;
}

function Tabelle({ tage }: { tage: Tag[] }) {
  return (
    <div className="statistik-tabelle">
      <table>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Erledigt</th>
            <th>Fokus</th>
            <th>Gewohnheiten</th>
          </tr>
        </thead>
        <tbody>
          {[...tage].reverse().map((t) => (
            <tr key={t.tag}>
              <td>
                {tagKurz(t.tag, {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </td>
              <td>{t.erledigt}</td>
              <td>{t.fokusMin ? stunden(t.fokusMin) : "–"}</td>
              <td>
                {t.gewohnheitenFaellig
                  ? `${t.gewohnheitenErledigt}/${t.gewohnheitenFaellig}`
                  : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** E144: Fokus nach Tageszeit – 24 Balken (Stunde in Wien), beste 2-Stunden-Spanne hervorgehoben */
function Tageszeit({ werte, beste }: { werte: number[]; beste: { von: number; bis: number } | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const hoechst = Math.max(1, ...werte);
  const schritt = B / 24;
  const breite = schritt - 2;
  const titel = '🕘 Fokus nach Tageszeit';
  return (
    <figure className="statistik-diagramm" aria-label={titel}>
      <figcaption>
        <span>{titel}</span>
        <span className="statistik-hover" aria-live="polite">
          {hover != null ? `${hover}–${hover + 1} Uhr: ${stunden(werte[hover]!)}` : beste ? `am konzentriertesten: ${beste.von}–${beste.bis} Uhr` : 'noch zu wenig Fokus für eine Aussage'}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${B} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${titel}: ${werte.map((m, h) => `${h} Uhr ${m} min`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={B} y1={H} y2={H} className="statistik-achse" />
        {werte.map((m, h) => {
          const hoehe = (H * m) / hoechst;
          const x = h * schritt + 1;
          const imBesten = beste != null && h >= beste.von && h < beste.bis;
          return (
            <g key={h}>
              {m > 0 && <path d={balkenPfad(x, H, breite, hoehe)} className={`statistik-balken${hover === h ? ' an' : ''}${imBesten ? ' beste' : ''}`} />}
              <rect className="statistik-treffer" x={h * schritt} y={0} width={schritt} height={H} fill="transparent" onMouseEnter={() => setHover(h)} onClick={() => setHover(h)} />
            </g>
          );
        })}
      </svg>
      <div className="statistik-x" aria-hidden>
        {[0, 6, 12, 18].map((h) => (
          <span key={h} style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
            {h} Uhr
          </span>
        ))}
      </div>
    </figure>
  );
}
