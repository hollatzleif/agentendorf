import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FokusStatistik, KirchturmTimer, KirchturmWecker, KirchturmZustand, PomodoroEinstellungen, TodoInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { glocke, glockeStopp, istProgramm } from '../programm/desktop';
import { E } from '../apple/tag';

const TAGE = [
  [1, 'Mo'],
  [2, 'Di'],
  [3, 'Mi'],
  [4, 'Do'],
  [5, 'Fr'],
  [6, 'Sa'],
  [0, 'So'],
] as const;

/** Zustand vom Server + Abstand Serveruhr ↔ Geräteuhr (damit Countdowns überall gleich laufen) */
export function useKirchturm() {
  const q = useQuery({
    queryKey: ['kirchturm'],
    queryFn: async () => {
      const z = await api<KirchturmZustand>('/api/kirchturm');
      return { ...z, versatz: Date.parse(z.jetzt) - Date.now() };
    },
  });
  return q;
}

/** jede Sekunde neu zeichnen (nur solange etwas läuft) */
function useSekunde(aktiv: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!aktiv) return;
    const i = setInterval(() => setT((x) => x + 1), 250);
    return () => clearInterval(i);
  }, [aktiv]);
}

export const dauerText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sek).padStart(2, '0')}`;
};
const stoppText = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const sek = Math.floor(ms / 1000) % 60;
  const hs = Math.floor(ms / 10) % 100;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sek).padStart(2, '0')},${String(hs).padStart(2, '0')}`;
};

/**
 * Kirchturm (E74): Wecker, Timer, Pomodoro, Stoppuhr. Alles läuft auf dem Server – hier wird nur angezeigt und
 * eingestellt. Läuten hörst du nur im Desktop-Programm (Glocke); im Browser siehst du es.
 */
export function KirchturmUhr() {
  const qc = useQueryClient();
  const q = useKirchturm();
  const [fehler, setFehler] = useState('');
  const d = q.data;
  // die Turmuhr zeigt Sekunden – also immer neu zeichnen, solange der Reiter offen ist
  useSekunde(true);
  const jetzt = Date.now() + (d?.versatz ?? 0);

  const befehl = async (b: Record<string, unknown>) => {
    setFehler('');
    try {
      const z = await api<KirchturmZustand>('/api/kirchturm', { body: b });
      qc.setQueryData(['kirchturm'], { ...z, versatz: Date.parse(z.jetzt) - Date.now() });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  if (!d) return <p className="leise">Lade …</p>;

  return (
    <div className="kirchturm">
      <div className="kirchturm-kopf">
        <Zifferblatt ms={jetzt} />
        <div>
          <div className="kirchturm-zeit">{new Date(jetzt).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna' })}</div>
          <div className="leise">{new Date(jetzt).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {!istProgramm() && <p className="leise">🔕 Läuten hörst du nur im Desktop-Programm – hier siehst du es.</p>}
        </div>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
      <Klingelt z={d} befehl={befehl} />
      <div className="kirchturm-raster">
        <Pomodoro z={d} jetzt={jetzt} befehl={befehl} />
        <Fokus />
        <Timer z={d} jetzt={jetzt} befehl={befehl} />
        <Wecker z={d} befehl={befehl} />
        <Stoppuhr z={d} jetzt={jetzt} befehl={befehl} />
        <Toene z={d} befehl={befehl} />
      </div>
    </div>
  );
}

type Befehl = (b: Record<string, unknown>) => Promise<void>;

export function Klingelt({ z, befehl }: { z: KirchturmZustand; befehl: Befehl }) {
  if (!z.klingelt.length) return null;
  return (
    <div className="kirchturm-klingelt" role="alert">
      {z.klingelt.map((k) => (
        <div key={k.id} className="kirchturm-klingel">
          <span className="glocke-wackelt" aria-hidden>
            🔔
          </span>
          <div>
            <strong>{k.titel}</strong>
            <div>{k.text}</div>
          </div>
          {k.todo && (
            <button
              type="button"
              onClick={() =>
                void api('/api/todos', { methode: 'PATCH', body: { pfad: k.todo!.pfad, erledigt: true } })
                  .catch(() => undefined)
                  .then(() => befehl({ befehl: 'klingel', id: k.id, aktion: 'aus' }))
              }
              title={`„${k.todo.titel}“ abhaken`}
            >
              ✓ To-do erledigt
            </button>
          )}
          {k.quelle === 'erinnerung' && (
            <button
              type="button"
              onClick={() =>
                void api('/api/todos', { methode: 'PATCH', body: { pfad: k.bezugId, erledigt: true } })
                  .catch(() => undefined)
                  .then(() => befehl({ befehl: 'klingel', id: k.id, aktion: 'aus' }))
              }
            >
              ✓ Erledigt
            </button>
          )}
          {k.schlummern && (
            <button type="button" onClick={() => void befehl({ befehl: 'klingel', id: k.id, aktion: 'schlummern' })}>
              {k.quelle === 'erinnerung' ? '+10 min' : 'Schlummern'}
            </button>
          )}
          <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'klingel', id: k.id, aktion: 'aus' })}>
            Aus
          </button>
        </div>
      ))}
    </div>
  );
}

function Zifferblatt({ ms }: { ms: number }) {
  const t = new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/Vienna', hour12: false }).split(':').map(Number) as [number, number, number];
  const [h, m, s] = t;
  const zeiger = (winkel: number, laenge: number, breite: number, farbe: string) => (
    <line x1={50} y1={50} x2={50 + laenge * Math.sin(winkel)} y2={50 - laenge * Math.cos(winkel)} stroke={farbe} strokeWidth={breite} strokeLinecap="round" />
  );
  return (
    <svg className="zifferblatt" viewBox="0 0 100 100" role="img" aria-label={`Turmuhr ${h}:${String(m).padStart(2, '0')}`}>
      <circle cx={50} cy={50} r={47} fill="#fbf5e6" stroke="#5b4636" strokeWidth={3} />
      {Array.from({ length: 12 }, (_, i) => {
        const w = (i / 12) * 2 * Math.PI;
        return <line key={i} x1={50 + 38 * Math.sin(w)} y1={50 - 38 * Math.cos(w)} x2={50 + 43 * Math.sin(w)} y2={50 - 43 * Math.cos(w)} stroke="#5b4636" strokeWidth={i % 3 ? 1.5 : 3} />;
      })}
      {zeiger((((h % 12) + m / 60) / 12) * 2 * Math.PI, 24, 4, '#2d241c')}
      {zeiger(((m + s / 60) / 60) * 2 * Math.PI, 35, 2.5, '#2d241c')}
      {zeiger((s / 60) * 2 * Math.PI, 38, 1, '#b8402f')}
      <circle cx={50} cy={50} r={2.5} fill="#2d241c" />
    </svg>
  );
}

// ---- Pomodoro ---------------------------------------------------------------------------------------

function Pomodoro({ z, jetzt, befehl }: { z: KirchturmZustand; jetzt: number; befehl: Befehl }) {
  const p = z.pomodoro;
  const e = p.einstellungen;
  const [einstellen, setEinstellen] = useState(false);
  const rest = p.status === 'laeuft' ? Date.parse(p.ende!) - jetzt : (p.restMs ?? e.arbeitMin * 60_000);
  const gesamt = (p.phase === 'kurz' ? e.kurzMin : p.phase === 'lang' ? e.langMin : e.arbeitMin) * 60_000;
  const name = { aus: 'Bereit', arbeit: 'Arbeiten', kurz: 'Kurze Pause', lang: 'Lange Pause' }[p.phase];
  return (
    <section className={`karte innen kirchturm-teil pomodoro phase-${p.phase}`} aria-label="Pomodoro">
      <h3>
        <E e="🍅" /> Pomodoro
      </h3>
      <div className="pomodoro-anzeige">
        <div className="pomodoro-ring" style={{ ['--anteil' as string]: `${p.phase === 'aus' ? 0 : Math.min(1, 1 - rest / gesamt)}` }}>
          <span className="pomodoro-zeit">{dauerText(p.phase === 'aus' ? e.arbeitMin * 60_000 : rest)}</span>
        </div>
        <div>
          <strong>{name}</strong>
          <div className="leise">
            Runde {Math.min(e.runden, p.erledigt + (p.phase === 'arbeit' ? 1 : 0)) || 1} von {e.runden}
            {e.thema ? ` · ${e.thema}` : ''}
          </div>
          <div className="pomodoro-punkte" aria-hidden>
            {Array.from({ length: e.runden }, (_, i) => (
              <span key={i} className={i < p.erledigt ? 'voll' : ''} />
            ))}
          </div>
        </div>
      </div>
      <div className="zeile">
        {(p.status === 'aus' || p.status === 'wartet') && (
          <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'start' })}>
            ▶ {p.status === 'wartet' ? (p.phase === 'arbeit' ? 'Weiterarbeiten' : 'Pause starten') : 'Start'}
          </button>
        )}
        {p.status === 'laeuft' && (
          <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'pause' })}>
            ⏸ Pause
          </button>
        )}
        {p.status === 'pause' && (
          <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'weiter' })}>
            ▶ Weiter
          </button>
        )}
        {p.phase !== 'aus' && (
          <>
            <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'ueberspringen' })}>
              ⏭ Überspringen
            </button>
            <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'stopp' })}>
              ⏹ Stopp
            </button>
          </>
        )}
        <button type="button" className="klein" onClick={() => setEinstellen((x) => !x)} aria-expanded={einstellen}>
          <E e="⚙" /> Einstellen
        </button>
      </div>
      {einstellen && <PomodoroEinstellen e={e} speichern={(n) => void befehl({ befehl: 'pomodoro_einstellen', einstellungen: n }).then(() => setEinstellen(false))} />}
    </section>
  );
}

function PomodoroEinstellen({ e, speichern }: { e: PomodoroEinstellungen; speichern: (e: PomodoroEinstellungen) => void }) {
  const [w, setW] = useState(e);
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const zahl = (k: keyof PomodoroEinstellungen, text: string, min: number, max: number) => (
    <label>
      {text}
      <input type="number" min={min} max={max} value={w[k] as number} onChange={(x) => setW({ ...w, [k]: Number(x.target.value) })} />
    </label>
  );
  return (
    <form
      className="formspalte"
      aria-label="Pomodoro einstellen"
      onSubmit={(x) => {
        x.preventDefault();
        speichern(w);
      }}
    >
      <div className="zeile kirchturm-zahlen">
        {zahl('arbeitMin', 'Arbeit (min)', 1, 240)}
        {zahl('kurzMin', 'Kurze Pause (min)', 1, 120)}
        {zahl('langMin', 'Lange Pause (min)', 1, 240)}
        {zahl('langNach', 'Lange Pause nach … Runden', 1, 20)}
        {zahl('runden', 'Runden insgesamt', 1, 50)}
      </div>
      <label>
        Fokus-Ziel pro Tag (min, 0 = keins)
        <input type="number" min={0} max={720} step={15} value={w.tagesZielMin ?? 0} onChange={(x) => setW({ ...w, tagesZielMin: Number(x.target.value) || 0 })} aria-label="Fokus-Ziel pro Tag in Minuten" />
      </label>
      <label className="zeile">
        <input type="checkbox" checked={w.autoWeiter} onChange={(x) => setW({ ...w, autoWeiter: x.target.checked })} /> Nächste Phase automatisch starten
      </label>
      <label className="zeile">
        <input type="checkbox" checked={w.nichtStoeren !== false} onChange={(x) => setW({ ...w, nichtStoeren: x.target.checked })} /> Nicht stören: Telegram hält Meldungen während der
        Arbeitsphase zurück (Dringendes kommt trotzdem)
      </label>
      <label>
        Woran arbeitest du? (optional)
        <input list="pomodoro-todos" value={w.thema ?? ''} maxLength={200} onChange={(x) => setW({ ...w, thema: x.target.value })} placeholder="z. B. ein To-do" />
        <datalist id="pomodoro-todos">
          {(todos.data ?? [])
            .filter((t) => !t.erledigt)
            .map((t) => (
              <option key={t.pfad} value={t.titel} />
            ))}
        </datalist>
      </label>
      <div className="zeile">
        <button type="submit" className="haupt">
          Speichern
        </button>
        <button type="button" onClick={() => setW({ ...w, arbeitMin: 25, kurzMin: 5, langMin: 15, langNach: 4, runden: 4, autoWeiter: false })}>
          Klassisch (25/5/15)
        </button>
        <button type="button" onClick={() => setW({ ...w, arbeitMin: 50, kurzMin: 10, langMin: 30, langNach: 2, runden: 4, autoWeiter: false })}>
          Lang (50/10/30)
        </button>
      </div>
    </form>
  );
}

// ---- Fokus-Statistik ----------------------------------------------------------------------------------

const stunden = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

/** Fokuszeit aus den Pomodoro-Arbeitsphasen: heute, 7 Tage, je Fach/Thema, Serie */
export function Fokus() {
  // hängt an ['kirchturm', …] → wird bei jedem Kirchturm-Ereignis frisch geholt
  const q = useQuery({ queryKey: ['kirchturm', 'fokus'], queryFn: () => api<FokusStatistik>('/api/kirchturm/fokus') });
  const s = q.data;
  if (!s) return null;
  const max = Math.max(25, ...s.tage.map((t) => t.min));
  return (
    <section className="karte innen kirchturm-teil fokus" aria-label="Fokus">
      <h3>
        <E e="📊" /> Fokus
      </h3>
      <div className="fokus-zahlen">
        <div>
          <strong>{stunden(s.heuteMin)}</strong>
          <span className="leise">heute{s.heutePomodoros ? ` · ${s.heutePomodoros} 🍅` : ''}</span>
        </div>
        <div>
          <strong>{stunden(s.wocheMin)}</strong>
          <span className="leise">7 Tage</span>
        </div>
        <div>
          <strong>{s.serie}</strong>
          <span className="leise">{s.serie === 1 ? 'Tag' : 'Tage'} in Folge</span>
        </div>
      </div>
      <div className="fokus-balken" role="img" aria-label={`Fokus je Tag: ${s.tage.map((t) => `${t.tag.slice(8)}. ${t.min} min`).join(', ')}`}>
        {s.tage.map((t) => (
          <div key={t.tag} className="fokus-tag">
            <span className="fokus-saeule" style={{ height: `${Math.round((t.min / max) * 100)}%` }} title={`${t.min} min`} />
            <span className="leise">{new Date(`${t.tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', timeZone: 'UTC' })}</span>
          </div>
        ))}
      </div>
      {s.themen.length > 0 && (
        <ul className="fokus-themen">
          {s.themen.map((t) => (
            <li key={t.thema}>
              <span>{t.thema}</span>
              <span className="leise">{stunden(t.min)}</span>
            </li>
          ))}
        </ul>
      )}
      {!s.wocheMin && <p className="leise">Noch keine Fokuszeit diese Woche – starte einen Pomodoro, gern direkt an einem To-do (🍅).</p>}
    </section>
  );
}

// ---- Timer ------------------------------------------------------------------------------------------

function Timer({ z, jetzt, befehl }: { z: KirchturmZustand; jetzt: number; befehl: Befehl }) {
  const [min, setMin] = useState('5');
  const [sek, setSek] = useState('0');
  const [name, setName] = useState('');
  const dauer = (Number(min.replace(',', '.')) || 0) * 60_000 + (Number(sek) || 0) * 1000;
  return (
    <section className="karte innen kirchturm-teil" aria-label="Timer">
      <h3>
        <E e="⏳" /> Timer
      </h3>
      {z.timer.length > 0 && (
        <ul className="kirchturm-liste">
          {z.timer.map((t) => (
            <TimerZeile key={t.id} t={t} jetzt={jetzt} befehl={befehl} />
          ))}
        </ul>
      )}
      <div className="zeile kirchturm-vorlagen">
        {z.vorlagen.map((v, i) => (
          <span key={`${v.name}-${i}`} className="vorlage">
            <button type="button" onClick={() => void befehl({ befehl: 'timer_start', name: v.name, dauerMs: v.dauerMs })}>
              {v.name} · {dauerText(v.dauerMs)}
            </button>
            <button type="button" className="klein" aria-label={`Vorlage ${v.name} entfernen`} onClick={() => void befehl({ befehl: 'vorlagen', vorlagen: z.vorlagen.filter((_, j) => j !== i) })}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="zeile"
        aria-label="Neuer Timer"
        onSubmit={(e) => {
          e.preventDefault();
          if (dauer >= 1000) void befehl({ befehl: 'timer_start', name: name.trim(), dauerMs: dauer });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={60} aria-label="Timer-Name" />
        <input type="number" min={0} max={1440} value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minuten" className="kurz" />
        <span>min</span>
        <input type="number" min={0} max={59} value={sek} onChange={(e) => setSek(e.target.value)} aria-label="Sekunden" className="kurz" />
        <span>s</span>
        <button type="submit" className="haupt">
          ▶ Start
        </button>
        <button
          type="button"
          className="klein"
          disabled={!name.trim() || dauer < 1000}
          title="Als Vorlage merken"
          onClick={() => void befehl({ befehl: 'vorlagen', vorlagen: [...z.vorlagen, { name: name.trim(), dauerMs: dauer }].slice(-20) })}
        >
          ☆ Vorlage
        </button>
      </form>
    </section>
  );
}

function TimerZeile({ t, jetzt, befehl }: { t: KirchturmTimer; jetzt: number; befehl: Befehl }) {
  const rest = t.status === 'laeuft' ? Date.parse(t.ende!) - jetzt : (t.restMs ?? 0);
  const a = (aktion: string) => void befehl({ befehl: 'timer', id: t.id, aktion });
  return (
    <li className={`timer status-${t.status}`}>
      <span className="timer-zeit">{t.status === 'fertig' ? '0:00' : dauerText(rest)}</span>
      <span className="timer-name">
        {t.name}
        <span className="leise"> · {dauerText(t.dauerMs)}</span>
      </span>
      <span className="zeile">
        {t.status === 'laeuft' && <button type="button" onClick={() => a('pause')} aria-label={`${t.name} pausieren`}>⏸</button>}
        {t.status === 'pause' && <button type="button" onClick={() => a('weiter')} aria-label={`${t.name} weiter`}>▶</button>}
        <button type="button" onClick={() => a('plus_minute')} title="+1 Minute">
          +1
        </button>
        <button type="button" onClick={() => a('neu')} title="Neu starten" aria-label={`${t.name} neu starten`}>
          ↺
        </button>
        <button type="button" className="klein" onClick={() => a('loeschen')} aria-label={`${t.name} löschen`}>
          ×
        </button>
      </span>
    </li>
  );
}

// ---- Wecker -----------------------------------------------------------------------------------------

function tageText(tage: number[]) {
  if (!tage.length) return 'einmalig';
  const s = [...tage].sort().join();
  if (s === '0,1,2,3,4,5,6') return 'täglich';
  if (s === '1,2,3,4,5') return 'werktags';
  if (s === '0,6') return 'am Wochenende';
  return TAGE.filter(([n]) => tage.includes(n))
    .map(([, t]) => t)
    .join(', ');
}

function Wecker({ z, befehl }: { z: KirchturmZustand; befehl: Befehl }) {
  const [bearbeiten, setBearbeiten] = useState<KirchturmWecker | 'neu' | null>(null);
  return (
    <section className="karte innen kirchturm-teil" aria-label="Wecker">
      <h3>
        <E e="⏰" /> Wecker
      </h3>
      {!z.wecker.length && <p className="leise">Noch kein Wecker.</p>}
      <ul className="kirchturm-liste">
        {z.wecker.map((w) => (
          <li key={w.id} className={`wecker${w.aktiv ? '' : ' aus'}`}>
            <label className="schalter" title={w.aktiv ? 'Ausschalten' : 'Einschalten'}>
              <input
                type="checkbox"
                checked={w.aktiv}
                aria-label={`Wecker ${w.zeit} ${w.aktiv ? 'aus' : 'ein'}schalten`}
                onChange={(e) => void befehl({ befehl: 'wecker_speichern', id: w.id, name: w.name, zeit: w.zeit, tage: w.tage, schlummerMin: w.schlummerMin, aktiv: e.target.checked })}
              />
            </label>
            <button type="button" className="wecker-zeit" onClick={() => setBearbeiten(w)}>
              {w.zeit}
            </button>
            <span className="leise">
              {w.name ? `${w.name} · ` : ''}
              {tageText(w.tage)}
              {w.aktiv && w.naechster ? ` · nächstes: ${new Date(w.naechster).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {bearbeiten ? (
        <WeckerForm
          w={bearbeiten === 'neu' ? undefined : bearbeiten}
          fertig={() => setBearbeiten(null)}
          befehl={befehl}
        />
      ) : (
        <button type="button" onClick={() => setBearbeiten('neu')}>
          + Wecker
        </button>
      )}
    </section>
  );
}

function WeckerForm({ w, fertig, befehl }: { w?: KirchturmWecker; fertig: () => void; befehl: Befehl }) {
  const [zeit, setZeit] = useState(w?.zeit ?? '07:00');
  const [name, setName] = useState(w?.name ?? '');
  const [tage, setTage] = useState<number[]>(w?.tage ?? [1, 2, 3, 4, 5]);
  const [schlummer, setSchlummer] = useState(w?.schlummerMin ?? 9);
  return (
    <form
      className="formspalte"
      aria-label={w ? 'Wecker bearbeiten' : 'Neuer Wecker'}
      onSubmit={(e) => {
        e.preventDefault();
        void befehl({ befehl: 'wecker_speichern', ...(w ? { id: w.id } : {}), zeit, name: name.trim(), tage, schlummerMin: schlummer, aktiv: true }).then(fertig);
      }}
    >
      <div className="zeile">
        <input type="time" value={zeit} onChange={(e) => setZeit(e.target.value)} required aria-label="Uhrzeit" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={60} aria-label="Wecker-Name" />
      </div>
      <div className="zeile wochentage" role="group" aria-label="Wochentage">
        {TAGE.map(([n, t]) => (
          <label key={n} className={tage.includes(n) ? 'an' : ''}>
            <input type="checkbox" checked={tage.includes(n)} onChange={(e) => setTage((x) => (e.target.checked ? [...x, n] : x.filter((y) => y !== n)))} />
            {t}
          </label>
        ))}
        <span className="leise">{tageText(tage)}</span>
      </div>
      <label>
        Schlummern (min)
        <input type="number" min={1} max={60} value={schlummer} onChange={(e) => setSchlummer(Number(e.target.value))} className="kurz" />
      </label>
      <div className="zeile">
        <button type="submit" className="haupt">
          Speichern
        </button>
        <button type="button" onClick={fertig}>
          Abbrechen
        </button>
        {w && (
          <button type="button" className="gefahr" onClick={() => void befehl({ befehl: 'wecker_loeschen', id: w.id }).then(fertig)}>
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}

// ---- Stoppuhr ---------------------------------------------------------------------------------------

function Stoppuhr({ z, jetzt, befehl }: { z: KirchturmZustand; jetzt: number; befehl: Befehl }) {
  const s = z.stoppuhr;
  const gesamt = s.bisherMs + (s.start ? jetzt - Date.parse(s.start) : 0);
  const runden = useMemo(() => s.runden.map((r, i) => ({ nr: i + 1, gesamt: r, runde: r - (s.runden[i - 1] ?? 0) })).reverse(), [s.runden]);
  const a = (aktion: string) => void befehl({ befehl: 'stoppuhr', aktion });
  return (
    <section className="karte innen kirchturm-teil" aria-label="Stoppuhr">
      <h3>
        <E e="⏱" /> Stoppuhr
      </h3>
      <div className="stoppuhr-zeit">{stoppText(gesamt)}</div>
      <div className="zeile">
        {s.start ? (
          <>
            <button type="button" onClick={() => a('stopp')}>
              ⏸ Stopp
            </button>
            <button type="button" onClick={() => a('runde')}>
              Runde
            </button>
          </>
        ) : (
          <button type="button" className="haupt" onClick={() => a('start')}>
            ▶ {gesamt ? 'Weiter' : 'Start'}
          </button>
        )}
        {!s.start && gesamt > 0 && (
          <button type="button" onClick={() => a('zuruecksetzen')}>
            Zurücksetzen
          </button>
        )}
      </div>
      {runden.length > 0 && (
        <ol className="stoppuhr-runden" reversed>
          {runden.map((r) => (
            <li key={r.nr}>
              <span>Runde {r.nr}</span>
              <span>{stoppText(r.runde)}</span>
              <span className="leise">{stoppText(r.gesamt)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---- Töne -------------------------------------------------------------------------------------------

function Toene({ z, befehl }: { z: KirchturmZustand; befehl: Befehl }) {
  const t = z.toene;
  const programm = istProgramm();
  return (
    <section className="karte innen kirchturm-teil" aria-label="Glocke">
      <h3>
        <E e="🔔" /> Glocke
      </h3>
      <p className="leise">Die Glocke ist der einzige Ton im Dorf. Sie läutet nur im Desktop-Programm, auch wenn sein Fenster versteckt ist.</p>
      <label className="zeile">
        <input type="checkbox" checked={t.mitteilungen} onChange={(e) => void befehl({ befehl: 'toene', mitteilungen: e.target.checked, weckerWiederholen: t.weckerWiederholen })} /> Ein
        Glockenschlag auch bei Mitteilungen (Freigaben, fertige Aufgaben)
      </label>
      <label>
        Wecker-Geläut wiederholen (bis „Aus“)
        <input
          type="number"
          min={1}
          max={20}
          value={t.weckerWiederholen}
          className="kurz"
          onChange={(e) => void befehl({ befehl: 'toene', mitteilungen: t.mitteilungen, weckerWiederholen: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
        />{' '}
        Mal
      </label>
      <div className="zeile">
        <button type="button" disabled={!programm} onClick={() => void glocke('schlag', 1)}>
          Schlag testen
        </button>
        <button type="button" disabled={!programm} onClick={() => void glocke('gelaeut', 1)}>
          Geläut testen
        </button>
        <button type="button" disabled={!programm} onClick={() => void glockeStopp()}>
          Stille
        </button>
      </div>
      {!programm && <p className="leise">Testen geht nur im Programm.</p>}
    </section>
  );
}
