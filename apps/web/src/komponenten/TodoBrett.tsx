import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TodoInfo } from '@dorf/shared';
import { api, ApiFehler, offlineGemerkt } from '../api';
import { etappenPlan, todoAusText } from '@dorf/shared';
import { TodoTextHinweis } from './TodoTextHinweis';
import { bibliothekUrl, linkKlick, navigieren } from '../router';
import { LernzeitPlaner } from './LernzeitPlaner';
import { Stern } from '../seiten/Heute';
import { E } from '../apple/tag';
import { useDesign } from '../apple/design';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const datumText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' });

/** E220: Kalendertage zwischen zwei JJJJ-MM-TT (b − a) */
const tageZwischen = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** E220: wie dringend – färbt die Zeile und ordnet sie einem Abschnitt zu */
export type FristStufe = 'ueber' | 'heute' | 'morgen' | 'woche' | 'spaeter' | 'ohne';
export function fristStufe(f: string | undefined, h: string): FristStufe {
  if (!f) return 'ohne';
  const d = tageZwischen(h, f);
  return d < 0 ? 'ueber' : d === 0 ? 'heute' : d === 1 ? 'morgen' : d <= 7 ? 'woche' : 'spaeter';
}
const ABSCHNITTE: [FristStufe, string][] = [
  ['ueber', 'Überfällig'],
  ['heute', 'Heute'],
  ['morgen', 'Morgen'],
  ['woche', 'Nächste 7 Tage'],
  ['spaeter', 'Später'],
  ['ohne', 'Ohne Datum'],
];

/** E220: Frist kurz für die zugeklappte Zeile – „heute“, „morgen“, „Mi.“, „28.11.“, „seit 3 T.“ */
function fristKurz(f: string) {
  const d = tageZwischen(heute(), f);
  if (d < 0) return d === -1 ? 'gestern' : `seit ${-d} T.`;
  if (d === 0) return 'heute';
  if (d === 1) return 'morgen';
  const t = new Date(`${f}T12:00:00Z`);
  if (d <= 6) return t.toLocaleDateString('de-AT', { weekday: 'short', timeZone: 'UTC' });
  return t.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** E220: Sortierung der offenen To-dos (Standard: nach Frist) */
const SORTIERUNGEN = [
  ['frist', 'Nach Frist'],
  ['stern', '⭐ zuerst'],
  ['neu', 'Neueste zuerst'],
  ['gruppe', 'Nach Gruppe'],
] as const;
type Sortierung = (typeof SORTIERUNGEN)[number][0];
const SORTIER_SCHLUESSEL = 'dorf-todo-sortierung';
export function todosSortieren(liste: TodoInfo[], wie: Sortierung): TodoInfo[] {
  const frist = (a: TodoInfo, b: TodoInfo) => (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999');
  const stern = (a: TodoInfo, b: TodoInfo) => Number(!!b.wichtig) - Number(!!a.wichtig);
  const neu = (a: TodoInfo, b: TodoInfo) => (b.erstellt ?? '').localeCompare(a.erstellt ?? '');
  const gruppe = (t: TodoInfo) => t.gruppe ?? t.gebaeude ?? '\uffff';
  const v: Record<Sortierung, (a: TodoInfo, b: TodoInfo) => number> = {
    frist: (a, b) => frist(a, b) || stern(a, b) || neu(a, b),
    stern: (a, b) => stern(a, b) || frist(a, b) || neu(a, b),
    neu: (a, b) => neu(a, b) || frist(a, b),
    gruppe: (a, b) => gruppe(a).localeCompare(gruppe(b), 'de') || frist(a, b) || stern(a, b),
  };
  return [...liste].sort(v[wie]);
}

/**
 * To-do-Brett auf dem Marktplatz (E65): immer aktuell (Live-Ereignis), abhaken, anlegen, bearbeiten, löschen.
 * Jedes To-do ist eine Datei in Marktplatz/todos/ – auch Agenten und Telegram pflegen sie.
 */
export function TodoBrett({ liste: name = 'todo', platzhalter = 'Neues To-do …', gruppiert = false }: { liste?: string; platzhalter?: string; gruppiert?: boolean } = {}) {
  const qc = useQueryClient();
  const basis = name === 'todo' ? '/api/todos' : `/api/listen/${name}`;
  const liste = useQuery({ queryKey: ['liste', name], queryFn: () => api<TodoInfo[]>(basis) });
  const [titel, setTitel] = useState('');
  const [faellig, setFaellig] = useState('');
  const [fehler, setFehler] = useState('');
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState('alle');
  const [sortierungRoh, setSortierungRoh] = useState<Sortierung>(() => {
    const x = localStorage.getItem(SORTIER_SCHLUESSEL);
    return SORTIERUNGEN.find(([k]) => k === x)?.[0] ?? 'frist';
  });
  const neu = () => qc.invalidateQueries({ queryKey: ['liste', name] });
  /** 'ok' | 'offline' (gemerkt, kommt später an) | 'fehler' – Felder leeren/Vorschläge verwerfen nur bei Erfolg (Review) */
  const ausfuehren: Ausfuehren = async (f) => {
    setFehler('');
    try {
      await f();
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
      await neu();
      return offlineGemerkt(e) ? 'offline' : 'fehler';
    }
    await neu();
    return 'ok';
  };

  const anlegen = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titel.trim()) return;
    void ausfuehren(async () => {
      // E127: „… jeden Montag 30 min“ wie in Telegram (nur To-do-Liste; ein gewähltes Datum gewinnt)
      const e = name === 'todo' ? todoAusText(titel, heute()) : { titel: titel.trim() };
      await api(basis, { body: { ...e, ...(faellig ? { faellig } : {}) } });
      setTitel('');
      setFaellig('');
    }).then((r) => {
      // offline gemerkt: Feld leeren, sonst tippt man es nochmal und es kommt doppelt an
      if (r === 'offline') {
        setTitel('');
        setFaellig('');
      }
    });
  };

  const alleOffen = liste.data?.filter((t) => !t.erledigt) ?? [];
  // E125: Filter – Text, ⭐, heute/überfällig, ohne Datum, je Gruppe/Gebäude (nur Anzeige)
  const h0 = heute();
  const gruppen = [...new Set(alleOffen.flatMap((t) => [t.gruppe, t.gebaeude]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'de'));
  const chips: [string, string][] = [
    ['alle', 'Alle'],
    ...(alleOffen.some((t) => t.wichtig) ? [['stern', '⭐'] as [string, string]] : []),
    ...(alleOffen.some((t) => t.faellig && t.faellig <= h0) ? [['heute', 'Heute & überfällig'] as [string, string]] : []),
    ...(alleOffen.some((t) => !t.faellig) && alleOffen.some((t) => t.faellig) ? [['ohne', 'Ohne Datum'] as [string, string]] : []),
    // E158: Wartendes und oft Verschobenes gezielt ansehen
    ...(alleOffen.some((t) => t.wartet) ? [['wartet', '⏳ Wartet'] as [string, string]] : []),
    ...(alleOffen.some((t) => (t.verschoben ?? 0) >= 3) ? [['geschoben', '↻ Oft verschoben'] as [string, string]] : []),
    ...gruppen.map((g) => [`g:${g}`, g] as [string, string]),
  ];
  // gewählter Chip verschwunden (z. B. letztes ⭐ erledigt) → wie „Alle“ (Review)
  const filterJetzt = chips.some(([x]) => x === filter) ? filter : 'alle';
  // Filter wirkt nur, solange die Leiste sichtbar ist – sonst gäbe es keinen Weg zurück (Review)
  const leiste = alleOffen.length > 5;
  const passt = (t: TodoInfo) => {
    if (!leiste) return true;
    if (suche.trim()) {
      const q = suche.trim().toLowerCase();
      if (!`${t.titel} ${t.notiz ?? ''} ${t.gruppe ?? ''} ${t.gebaeude ?? ''}`.toLowerCase().includes(q)) return false;
    }
    if (filterJetzt === 'stern') return !!t.wichtig;
    if (filterJetzt === 'heute') return !!t.faellig && t.faellig <= h0;
    if (filterJetzt === 'ohne') return !t.faellig;
    if (filterJetzt === 'wartet') return !!t.wartet;
    if (filterJetzt === 'geschoben') return (t.verschoben ?? 0) >= 3;
    if (filterJetzt.startsWith('g:')) return t.gruppe === filterJetzt.slice(2) || t.gebaeude === filterJetzt.slice(2);
    return true;
  };
  const gefiltert = leiste && (!!suche.trim() || filterJetzt !== 'alle');
  // E220: Standard nach Frist; andere Sortierung wie der Filter nur, solange die Leiste sichtbar ist
  const sortierung: Sortierung = leiste && name === 'todo' ? sortierungRoh : 'frist';
  const offen = todosSortieren(alleOffen.filter(passt), sortierung);
  // Einkaufsliste: nach Abteilung sortiert, damit man im Laden der Reihe nach abhakt
  if (gruppiert) offen.sort((a, b) => (a.gruppe ?? 'zzz').localeCompare(b.gruppe ?? 'zzz', 'de') || a.titel.localeCompare(b.titel, 'de'));
  // E220: Abschnitte – nach Frist (Überfällig, Heute, …) oder nach Gruppe; ohne Fristen eine schlichte Liste
  const abschnitte: { k: string; text: string; ts: TodoInfo[] }[] =
    !gruppiert && sortierung === 'frist' && offen.some((t) => t.faellig)
      ? ABSCHNITTE.map(([k, text]) => ({ k, text, ts: offen.filter((t) => fristStufe(t.faellig, h0) === k) })).filter((a) => a.ts.length)
      : !gruppiert && sortierung === 'gruppe'
        ? [...new Set(offen.map((t) => t.gruppe ?? t.gebaeude ?? ''))].map((g) => ({ k: `g:${g}`, text: g || 'Ohne Gruppe', ts: offen.filter((t) => (t.gruppe ?? t.gebaeude ?? '') === g) }))
        : [{ k: 'alle', text: '', ts: offen }];
  const erledigt = (liste.data?.filter((t) => t.erledigt) ?? []).filter((t) => !suche.trim() || passt(t));
  return (
    <div className="todo-brett">
      <form className="todo-neu" onSubmit={anlegen} aria-label="Neues To-do">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={platzhalter} maxLength={200} aria-label="Neues To-do" {...(name === 'todo' ? { 'data-todo-neu': '' } : {})} />
        <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
        <button type="submit" className="haupt">
          +
        </button>
      </form>
      {name === 'todo' && <TodoTextHinweis text={titel} heute={heute()} />}
      {fehler && <p className="fehler">{fehler}</p>}
      {liste.isLoading && <p className="leise">Lade …</p>}
      {leiste && (
        <div className="todo-filter" role="group" aria-label="Filter">
          <input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Filtern …" aria-label="To-dos filtern" />
          {name === 'todo' && (
            <select
              className="todo-sortierung"
              value={sortierungRoh}
              aria-label="Sortieren"
              onChange={(e) => {
                const w = e.target.value as Sortierung;
                setSortierungRoh(w);
                localStorage.setItem(SORTIER_SCHLUESSEL, w);
              }}
            >
              {SORTIERUNGEN.map(([k, text]) => (
                <option key={k} value={k}>
                  {text}
                </option>
              ))}
            </select>
          )}
          {chips.length > 1 &&
            chips.map(([k, text]) => (
              <button key={k} type="button" className={`klein${filterJetzt === k ? ' an' : ''}`} aria-pressed={filterJetzt === k} onClick={() => setFilter(filterJetzt === k && k !== 'alle' ? 'alle' : k)}>
                {text}
              </button>
            ))}
          {gefiltert && (
            <span className="leise todo-filter-zahl">
              {offen.length} von {alleOffen.length}
            </span>
          )}
        </div>
      )}
      {liste.data && !offen.length && <p className="leise">{gefiltert && alleOffen.length ? 'Nichts passt zum Filter.' : 'Nichts offen. 🎉'}</p>}
      {abschnitte.map((a) => (
        <section key={a.k} className={`todo-abschnitt${a.k.startsWith('g:') ? '' : ` frist-${a.k}`}`} aria-label={a.text || undefined}>
          {a.text && (
            <h4 className="todo-abschnitt-kopf">
              <span>{a.text}</span>
              <span className="todo-abschnitt-zahl">{a.ts.length}</span>
            </h4>
          )}
          <ul className="todo-liste">
            {a.ts.map((t) => (
              <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} basis={basis} />
            ))}
          </ul>
        </section>
      ))}
      {erledigt.length > 0 && (
        <details>
          <summary>Erledigt ({erledigt.length})</summary>
          <ul className="todo-liste erledigt">
            {erledigt.map((t) => (
              <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} basis={basis} />
            ))}
          </ul>
        </details>
      )}
      <p className="leise">
        {name === 'einkauf'
          ? 'Auch per Telegram: /einkauf. Der Essensplan setzt Zutaten von selbst drauf.'
          : name === 'todo'
            ? 'Auch in Obsidian unter Marktplatz/todos/ – und per Telegram: /todo. Gelöschtes liegt im Papierkorb.'
            : 'Gelöschtes liegt im Papierkorb.'}
      </p>
    </div>
  );
}

/** E94: „heute 18:00“, „morgen 09:00“, sonst „Fr., 20.11. 14:00“ (Ortszeit wie gespeichert) */
function erinnerungText(z: string) {
  const tag = z.slice(0, 10);
  const h = heute();
  const morgen = new Date(Date.parse(`${h}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const wann = tag === h ? 'heute' : tag === morgen ? 'morgen' : new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${wann} ${z.slice(11, 16)}`;
}

/** E120: geschätzte Dauer – „Tag planen“ und „Heute“ rechnen damit */
const DAUER_WAHL = [
  ['', 'Dauer: keine Schätzung'],
  ['15', '⏱ 15 min'],
  ['30', '⏱ 30 min'],
  ['45', '⏱ 45 min'],
  ['60', '⏱ 1 h'],
  ['90', '⏱ 1,5 h'],
  ['120', '⏱ 2 h'],
  ['180', '⏱ 3 h'],
  ['240', '⏱ 4 h'],
] as const;

/** E92: Auswahl für wiederkehrende To-dos (Obsidian: Feld „wiederholen“, auch „alle 3 tage“ usw.) */
const WIEDERHOLEN_WAHL = [
  ['', 'Nicht wiederholen'],
  ['täglich', '🔁 täglich'],
  ['werktags', '🔁 werktags'],
  ['wöchentlich', '🔁 wöchentlich'],
  ['alle 2 wochen', '🔁 alle 2 Wochen'],
  ['monatlich', '🔁 monatlich'],
  ['jährlich', '🔁 jährlich'],
] as const;

const OFFENE_SCHRITTE = new Set<string>();
const OFFENE_ZEILEN = new Set<string>();

type Ausfuehren = (f: () => Promise<unknown>) => Promise<'ok' | 'offline' | 'fehler'>;

function TodoZeile({ t, ausfuehren, basis }: { t: TodoInfo; ausfuehren: Ausfuehren; basis: string }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const apple = useDesign() === 'apple';
  const [titel, setTitel] = useState(t.titel);
  const [faellig, setFaellig] = useState(t.faellig ?? '');
  const [notiz, setNotiz] = useState(t.notiz ?? '');
  const [gruppe, setGruppe] = useState(t.gruppe ?? '');
  const [wiederholen, setWiederholen] = useState(t.wiederholen ?? '');
  const [erinnerung, setErinnerung] = useState(t.erinnerung ?? '');
  const [dauer, setDauer] = useState(t.dauer ? String(t.dauer) : '');
  const [wartet, setWartet] = useState(t.wartet ?? '');
  const [energie, setEnergie] = useState<string>(t.energie ?? '');
  // Häkchen sofort zeigen; die Zeile wird mit der neuen Version vom Server ohnehin neu aufgebaut
  const [haken, setHaken] = useState(t.erledigt);
  const [planen, setPlanen] = useState(false);
  const [etappen, setEtappen] = useState(false);
  const [etappenLaeuft, setEtappenLaeuft] = useState(false);
  // die Zeile wird bei jeder neuen Version neu aufgebaut (key) – offen bleibt sie trotzdem
  const [schritteOffen, setSchritteOffenRoh] = useState(() => OFFENE_SCHRITTE.has(t.pfad));
  const setSchritteOffen = (f: (x: boolean) => boolean) =>
    setSchritteOffenRoh((x) => {
      const n = f(x);
      if (n) OFFENE_SCHRITTE.add(t.pfad);
      else OFFENE_SCHRITTE.delete(t.pfad);
      return n;
    });
  // E220: Details (Abzeichen, Knöpfe) erst aufgeklappt – bleibt offen, auch wenn die Zeile mit neuer Version neu aufgebaut wird
  const [auf, setAufRoh] = useState(() => OFFENE_ZEILEN.has(t.pfad));
  const setAuf = (f: (x: boolean) => boolean) =>
    setAufRoh((x) => {
      const n = f(x);
      if (n) OFFENE_ZEILEN.add(t.pfad);
      else OFFENE_ZEILEN.delete(t.pfad);
      return n;
    });
  const stufe = t.erledigt ? 'ohne' : fristStufe(t.faellig, heute());
  const sch = t.schritte ?? [];
  const aendern = (a: Record<string, unknown>) => ausfuehren(() => api(basis, { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, ...a } }));
  const ueberfaellig = !t.erledigt && t.faellig && t.faellig < heute();
  const vonAgent = t.quelle && t.quelle !== 'Leif' && t.quelle !== 'Telegram';

  if (bearbeiten)
    return (
      <li className="todo bearbeiten">
        {/* E240: in der Apple-Oberfläche ist „Bearbeiten“ ein Sheet – Tipp daneben schließt wie „Abbrechen“ */}
        {apple && <div className="a-sheet-scrim" aria-hidden onClick={() => setBearbeiten(false)} />}
        <form
          className="formspalte"
          aria-label={apple ? `${t.titel} bearbeiten` : undefined}
          onKeyDown={apple ? (e) => e.key === 'Escape' && setBearbeiten(false) : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void aendern({ titel, faellig, notiz, gruppe, ...(wiederholen !== (t.wiederholen ?? '') ? { wiederholen } : {}), ...(erinnerung !== (t.erinnerung ?? '') ? { erinnerung: erinnerung.slice(0, 16) } : {}), ...(dauer !== (t.dauer ? String(t.dauer) : '') ? { dauer: Number(dauer) || 0 } : {}), ...(wartet.trim() !== (t.wartet ?? '') ? { wartet: wartet.trim() } : {}), ...(energie !== (t.energie ?? '') ? { energie } : {}) }).then(() => setBearbeiten(false));
          }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} aria-label="Titel" />
          <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
          <input value={gruppe} onChange={(e) => setGruppe(e.target.value)} maxLength={60} placeholder="Gruppe (Abteilung, Amt …)" aria-label="Gruppe" />
          {basis === '/api/todos' && (
            // E147: wartet auf jemanden – das Datum oben ist dann der Nachfass-Tag
            <input value={wartet} onChange={(e) => setWartet(e.target.value)} maxLength={80} placeholder="⏳ Wartet auf … (Person, Antwort) – Datum = nachfassen" aria-label="Wartet auf" />
          )}
          <label className="todo-erinnerung">
            <E e="🔔" /> Erinnerung
            <input type="datetime-local" value={erinnerung} onChange={(e) => setErinnerung(e.target.value)} aria-label="Erinnerung" />
          </label>
          <select value={dauer} onChange={(e) => setDauer(e.target.value)} aria-label="Geschätzte Dauer">
            {[...DAUER_WAHL, ...(dauer && !DAUER_WAHL.some(([w]) => w === dauer) ? [[dauer, `⏱ ${dauer} min`] as const] : [])].map(([w, text]) => (
              <option key={w} value={w}>
                {text}
              </option>
            ))}
          </select>
          {basis === '/api/todos' && (
            // E151: „Jetzt dran“ schlägt 🧠 in deiner besten Tageszeit vor, 🪶 abends und in kurzen Lücken
            <select value={energie} onChange={(e) => setEnergie(e.target.value)} aria-label="Energie">
              <option value="">⚡ Energie: egal</option>
              <option value="hoch">🧠 braucht Konzentration</option>
              <option value="niedrig">🪶 geht nebenbei</option>
            </select>
          )}
          <select value={wiederholen} onChange={(e) => setWiederholen(e.target.value)} aria-label="Wiederholen">
            {[...WIEDERHOLEN_WAHL, ...(wiederholen && !WIEDERHOLEN_WAHL.some(([w]) => w === wiederholen) ? [[wiederholen, `🔁 ${wiederholen}`] as const] : [])].map(([w, text]) => (
              <option key={w} value={w}>
                {text}
              </option>
            ))}
          </select>
          <textarea rows={3} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz" aria-label="Notiz" />
          <div className="zeile">
            <button type="submit" className="haupt">
              Speichern
            </button>
            <button type="button" onClick={() => setBearbeiten(false)}>
              Abbrechen
            </button>
            <button type="button" className="gefahr" onClick={() => void ausfuehren(() => api(`${basis}?pfad=${encodeURIComponent(t.pfad)}`, { methode: 'DELETE' }))}>
              Löschen
            </button>
          </div>
        </form>
      </li>
    );
  return (
    <li className={`todo frist-${stufe}${t.erledigt ? ' fertig' : ''}${ueberfaellig ? ' ueberfaellig' : ''}${auf ? ' auf' : ''}`}>
      <div className="todo-kopf">
        {basis === '/api/todos' && !t.erledigt && <Stern t={t} />}
        <label className="todo-haken">
          <input
            type="checkbox"
            checked={haken}
            onChange={(e) => {
              setHaken(e.target.checked);
              void aendern({ erledigt: e.target.checked });
            }}
            aria-label={`${t.titel} erledigt`}
          />
        </label>
        {/* E220: Titel klappt auf – Name des Knopfs bleibt genau der Titel (Frist und Pfeil aria-hidden) */}
        <button type="button" className="todo-titel" aria-expanded={auf} title={auf ? 'Zuklappen' : 'Details zeigen'} onClick={() => setAuf((x) => !x)}>
          <span className="todo-titel-text">{t.titel}</span>
          {!t.erledigt && (t.faellig || t.wartet) && (
            <span className="todo-frist" aria-hidden="true">
              {t.wartet ? '⏳ ' : ''}
              {t.faellig ? fristKurz(t.faellig) : ''}
            </span>
          )}
          <span className="todo-pfeil" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
      {!auf && sch.length > 0 && !t.erledigt && (
        <div className="todo-fortschritt" title={`${sch.filter((x) => x.erledigt).length} von ${sch.length} Schritten`} aria-hidden="true">
          <span style={{ width: `${(100 * sch.filter((x) => x.erledigt).length) / sch.length}%` }} />
        </div>
      )}
      {auf && (
      <div className="todo-details">
        <span className="todo-meta">
          {t.energie && !t.erledigt && (
            <span className="abzeichen" title={t.energie === 'hoch' ? 'braucht Konzentration – „Jetzt dran“ schlägt es in deiner besten Zeit vor' : 'geht nebenbei – gut für abends und kurze Lücken'}>
              <E e={t.energie === 'hoch' ? '🧠' : '🪶'} /> {t.energie === 'hoch' ? 'Konzentration' : 'nebenbei'}
            </span>
          )}
          {t.wartet && !t.erledigt && (
            <span className="abzeichen wartet" title={t.faellig ? `Wartet – am ${datumText(t.faellig)} nachfassen` : 'Wartet – ohne Nachfass-Tag'}>
              <E e="⏳" /> {t.wartet}
            </span>
          )}
          {t.faellig && <span className={`abzeichen${ueberfaellig ? ' warnung' : ''}`}>{t.wartet ? '↩ nachfassen ' : <><E e="📅" /> </>}{datumText(t.faellig)}</span>}
          {t.erinnerung && !t.erledigt && (
            <span className="abzeichen" title="Läutet im Kirchturm und schickt eine Telegram-Nachricht">
              <E e="🔔" /> {erinnerungText(t.erinnerung)}
            </span>
          )}
          {t.dauer && !t.erledigt && (
            <span className="abzeichen" title="Geschätzte Dauer">
              <E e="⏱" /> {t.dauer >= 60 ? `${Math.floor(t.dauer / 60)} h${t.dauer % 60 ? ` ${t.dauer % 60}` : ''}` : `${t.dauer} min`}
            </span>
          )}
          {t.fokusMin ? (
            // E122: tatsächliche Fokuszeit – rot, wenn schon mehr als geschätzt
            <span className={`abzeichen${t.dauer && t.fokusMin > t.dauer ? ' warnung' : ''}`} title={t.dauer ? `Fokus bisher: ${t.fokusMin} von ${t.dauer} min geschätzt` : `Fokus bisher: ${t.fokusMin} min`}>
              <E e="🍅" /> {t.fokusMin} min
            </span>
          ) : null}
          {t.wiederholen && (
            <span className="abzeichen" title={`Wiederkehrend: ${t.wiederholen} – beim Abhaken kommt das nächste`}>
              <E e="🔁" /> {t.wiederholen}
            </span>
          )}
          {(t.verschoben ?? 0) >= 3 && !t.erledigt && <span className="abzeichen">↻ {t.verschoben}× verschoben</span>}
          {t.gruppe && <span className="abzeichen">{t.gruppe}</span>}
          {t.gebaeude && <span className="abzeichen">{t.gebaeude}</span>}
          {t.fremd && (
            <span className="abzeichen" title="Aus Mails oder Moodle – Agenten mit Internet sehen diesen Eintrag nicht">
              <E e="✉️" /> aus Mail
            </span>
          )}
          {vonAgent && <span className="abzeichen" title={t.quelle}>🤖 {t.quelle}</span>}
        </span>
        <span className="todo-knoepfe">
          <button type="button" className="klein" onClick={() => setBearbeiten(true)}>
            <E e="✏️" /> Bearbeiten
          </button>
          {(sch.length > 0 || (!t.erledigt && basis === '/api/todos')) && (
            <button
              type="button"
              className={`klein todo-schritte-knopf${sch.length && sch.every((x) => x.erledigt) ? ' fertig' : ''}`}
              aria-expanded={schritteOffen}
              aria-label={sch.length ? `Schritte: ${sch.filter((x) => x.erledigt).length} von ${sch.length}` : `Schritte für ${t.titel}`}
              title={sch.length ? 'Teilschritte' : 'In Teilschritte zerlegen'}
              onClick={() => setSchritteOffen((x) => !x)}
            >
              <E e="☑" /> {sch.length ? `Schritte ${sch.filter((x) => x.erledigt).length}/${sch.length}` : 'Schritte'}
            </button>
          )}
          {basis === '/api/todos' && !t.erledigt && (
            <button
              type="button"
              className="klein"
              title="Pomodoro für dieses To-do starten"
              aria-label={`Fokus: ${t.titel}`}
              onClick={() => void ausfuehren(() => api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: t.titel, ...(t.gruppe ? { gruppe: t.gruppe } : {}), pfad: t.pfad } }))}
            >
              <E e="🍅" /> Fokus
            </button>
          )}
          {basis === '/api/todos' && !t.erledigt && t.faellig && t.faellig >= heute() && (
            <button type="button" className="klein" title="Freie Zeit im Kalender bis zur Frist finden" aria-label={`Lernzeit: ${t.titel}`} aria-expanded={planen} onClick={() => setPlanen((x) => !x)}>
              <E e="📅" /> Zeit finden
            </button>
          )}
          {basis === '/api/todos' && !t.erledigt && !t.wiederholen && !/ – Etappe \d+\/\d+$/.test(t.titel) && ((t.dauer ?? 0) >= 120 || (!t.dauer && (t.gebaeude === 'Uni' || /^(Abgabe|Prüfung):/.test(t.titel)))) && etappenPlan(t, heute()).length > 0 && (
            // E170: großes To-do mit Frist → Etappen auf die Tage davor
            <button type="button" className="klein" title="In Etappen auf die Tage bis zur Frist verteilen" aria-label={`Etappen: ${t.titel}`} aria-expanded={etappen} onClick={() => setEtappen((x) => !x)}>
              <E e="🪜" /> Etappen
            </button>
          )}
          {basis.endsWith('/wunsch') && !t.erledigt && (
            <button
              type="button"
              className="klein"
              title="Preise und Alternativen im Netz suchen lassen"
              onClick={() =>
                void ausfuehren(async () => {
                  const r = await api<{ chatId: string }>('/api/aktionen/starten', { body: { id: 'Einkaufsladen/preisvergleich', eingaben: { produkt: t.titel } } });
                  navigieren(`/chats/${r.chatId}`);
                })
              }
            >
              <E e="🔎" /> Preise
            </button>
          )}
          {t.notiz && (
            <a href={bibliothekUrl(t.pfad)} onClick={linkKlick} className="leise">
              Notiz öffnen
            </a>
          )}
        </span>
        {schritteOffen && <Schritte t={t} basis={basis} ausfuehren={ausfuehren} />}
        {etappen && (
          <div className="todo-etappen" role="group" aria-label={`Etappen für ${t.titel}`}>
            <p className="leise">So verteilt sich „{t.titel}“ bis zur Frist – alle mit der Gruppe „{t.gruppe ?? t.titel}“ (wird ein Projekt):</p>
            <ol>
              {etappenPlan(t, heute()).map((e) => (
                <li key={e.titel}>
                  {e.titel} · {datumText(e.faellig)} · ⏱ {e.dauer} min
                </li>
              ))}
            </ol>
            <div className="zeile">
              <button
                type="button"
                className="haupt klein"
                disabled={etappenLaeuft}
                onClick={() => {
                  setEtappenLaeuft(true);
                  void ausfuehren(() => api('/api/todos/etappen', { body: { pfad: t.pfad, basisVersion: t.version } })).finally(() => {
                    setEtappenLaeuft(false);
                    setEtappen(false);
                  });
                }}
              >
                Etappen anlegen
              </button>
              <button type="button" className="klein" onClick={() => setEtappen(false)}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
        {planen && t.faellig && (
          // Frist = Ende des Fälligkeitstags (Linz); der Server rechnet in Ortszeit
          <LernzeitPlaner titel={t.titel.replace(/^(Abgabe|Prüfung): /, '')} bis={new Date(`${t.faellig}T23:00:00+01:00`).toISOString()} fristTag={t.faellig} schliessen={() => setPlanen(false)} />
        )}
      </div>
      )}
    </li>
  );
}

/**
 * E119: Teilschritte – die Obsidian-Checkliste im Text des To-dos. Abhaken, ergänzen, entfernen; bei der To-do-Liste
 * schlägt die KI auf Wunsch Schritte vor (es wird erst geschrieben, wenn Leif „Übernehmen“ klickt).
 */
function Schritte({ t, basis, ausfuehren }: { t: TodoInfo; basis: string; ausfuehren: Ausfuehren }) {
  const sch = t.schritte ?? [];
  const qc = useQueryClient();
  const [neu, setNeu] = useState('');
  // Vorschläge und „denkt …“ im Query-Cache je To-do: die Zeile wird bei jeder neuen Version neu aufgebaut (Review)
  type Vorschlag = { text: string; an: boolean }[] | null;
  const vKey = ['schritte-vorschlag', t.pfad];
  const lKey = ['schritte-vorschlag-laedt', t.pfad];
  const vorschlag = useQuery<Vorschlag>({ queryKey: vKey, queryFn: async () => null, enabled: false, staleTime: Infinity, gcTime: 30 * 60_000 }).data ?? null;
  const laedt = useQuery<boolean>({ queryKey: lKey, queryFn: async () => false, enabled: false, staleTime: Infinity }).data ?? false;
  const setVorschlag = (v: Vorschlag) => qc.setQueryData(vKey, v);
  const setLaedt = (x: boolean) => qc.setQueryData(lKey, x);
  const [fehler, setFehler] = useState('');
  // Häkchen sofort zeigen; mit der neuen Version vom Server wird die Zeile ohnehin neu aufgebaut
  const [lokal, setLokal] = useState<Record<number, boolean>>({});
  const fertig = sch.filter((x) => x.erledigt).length;
  const hinzufuegen = (texte: string[]) => ausfuehren(() => api(`${basis}/schritte`, { body: { pfad: t.pfad, schritte: texte } }));
  return (
    <div className="todo-schritte" aria-label={`Schritte: ${t.titel}`} role="group">
      {sch.length > 0 && (
        <div className="todo-schritte-balken" aria-hidden>
          <span style={{ width: `${(fertig / sch.length) * 100}%` }} />
        </div>
      )}
      {sch.length > 0 && (
        <ul>
          {sch.map((x, i) => (
            <li key={`${i}-${x.text}`} className={x.erledigt ? 'fertig' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={lokal[i] ?? x.erledigt}
                  onChange={(e) => {
                    const an = e.target.checked;
                    setLokal((l) => ({ ...l, [i]: an }));
                    void ausfuehren(() => api(`${basis}/schritt`, { body: { pfad: t.pfad, nr: i, erledigt: an, text: x.text } })).then((r) => {
                      // abgelehnt: das Häkchen wieder so zeigen wie auf dem Server
                      if (r !== 'ok') setLokal((l) => ({ ...l, [i]: x.erledigt }));
                    });
                  }}
                  aria-label={`Schritt erledigt: ${x.text}`}
                />
                <span>{x.text}</span>
              </label>
              <button type="button" className="klein leise-knopf" aria-label={`Schritt entfernen: ${x.text}`} onClick={() => void ausfuehren(() => api(`${basis}/schritt`, { body: { pfad: t.pfad, nr: i, entfernen: true, text: x.text } }))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {!t.erledigt && (
        <form
          className="todo-schritt-neu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!neu.trim()) return;
            void hinzufuegen([neu.trim()]).then((r) => r === 'ok' && setNeu(''));
          }}
        >
          <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Nächster Schritt …" maxLength={200} aria-label="Neuer Schritt" />
          <button type="submit" className="klein" aria-label="Schritt hinzufügen">
            +
          </button>
          {basis === '/api/todos' && (
            <button
              type="button"
              className="klein"
              disabled={laedt}
              title="Die KI schlägt 3–7 kleine Schritte vor – du entscheidest, welche übernommen werden"
              onClick={async () => {
                setFehler('');
                setLaedt(true);
                try {
                  const r = await api<{ schritte: string[] }>('/api/todos/zerlegen', { body: { pfad: t.pfad } });
                  setVorschlag(r.schritte.map((text) => ({ text, an: true })));
                } catch (e) {
                  setFehler(e instanceof ApiFehler ? e.message : String(e));
                } finally {
                  setLaedt(false);
                }
              }}
            >
              {laedt ? '✂️ denkt …' : '✂️ Vorschlagen'}
            </button>
          )}
        </form>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
      {vorschlag && (
        <div className="todo-vorschlag" role="group" aria-label="Vorgeschlagene Schritte">
          {vorschlag.length === 0 && <p className="leise">Keine Vorschläge.</p>}
          {vorschlag.map((v, i) => (
            <label key={i}>
              <input type="checkbox" checked={v.an} onChange={(e) => setVorschlag(vorschlag.map((x, j) => (j === i ? { ...x, an: e.target.checked } : x)))} />
              <span>{v.text}</span>
            </label>
          ))}
          <div className="zeile">
            <button
              type="button"
              className="haupt klein"
              disabled={!vorschlag.some((v) => v.an)}
              onClick={() => void hinzufuegen(vorschlag.filter((v) => v.an).map((v) => v.text)).then((r) => r === 'ok' && setVorschlag(null))}
            >
              Übernehmen ({vorschlag.filter((v) => v.an).length})
            </button>
            <button type="button" className="klein" onClick={() => setVorschlag(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
