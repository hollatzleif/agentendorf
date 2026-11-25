import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WETTER_TEXT, type DorfStatus, type FokusStatistik, type FreigabeInfo, type KartenFach, type KalenderAntwort, type KalenderTermin, type KirchturmZustand, type MorgenzeitungUebersicht, type PostUebersicht, type Projekt, type Statistik, type TodoInfo } from '@dorf/shared';
import { api, ApiFehler, offlineGemerkt } from '../api';
import { belegtMs, istFristBlock, jetztDran, minutenText, ruht, tagesBudget, todoAusText, ueberschneidungen } from '@dorf/shared';
import { TodoTextHinweis } from '../komponenten/TodoTextHinweis';
import { linkKlick, navigieren } from '../router';
import { FARBEN, ort, tagPlus } from '../komponenten/MarktKalender';
import { dauerText, useKirchturm } from '../komponenten/KirchturmUhr';
import { TagPlanen } from '../komponenten/TagPlanen';
import { TagesLeiste } from '../komponenten/TagesLeiste';
import { GewohnheitenKarte } from '../komponenten/GewohnheitenKarte';
import { WochenzieleKarte } from '../komponenten/WochenzieleKarte';
import { StimmungZeile } from '../komponenten/StimmungZeile';
import { ErsteSchritte } from '../komponenten/ErsteSchritte';
import { E, Ring } from '../apple/tag';
import { useDesign } from '../apple/design';

/**
 * „Mein Tag“ (E77): der eine Blick am Morgen und zwischendurch – Termine heute/morgen, fällige To-dos zum Abhaken,
 * Fokus (Pomodoro), Wetter, Morgenzeitung, offene Freigaben. Nur bestehende Endpunkte und dieselben queryKeys wie
 * die Gebäude-Reiter, deshalb hält live.ts die Seite von selbst aktuell. Zeiten in Europe/Vienna.
 */

const KALENDER_URL = '/gebaeude/Marktplatz?reiter=kalender';
const TODO_URL = '/gebaeude/Marktplatz?reiter=todo';
const KIRCHTURM_URL = '/gebaeude/Kirchturm?reiter=uhr';
const OHNE_DATUM_ZEIGEN = 5;

const tagText = (tag: string, o: Intl.DateTimeFormatOptions) => new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { timeZone: 'UTC', ...o });

/** Uhr der Seite: jede Sekunde, solange etwas läuft – sonst reicht alle 20 s */
function useJetzt(schnell: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), schnell ? 500 : 20_000);
    return () => clearInterval(i);
  }, [schnell]);
  return Date.now();
}

/** Ist der Termin an diesem Tag (Ortszeit) zu sehen? Ganztags-Ende ist exklusiv; Ende um Mitternacht zählt nicht zum Folgetag. */
function amTag(t: KalenderTermin, tag: string) {
  const von = t.ganztags ? t.start : ort(t.start).tag;
  let bis = t.ganztags ? tagPlus(t.ende, -1) : ort(t.ende).tag;
  if (!t.ganztags && bis > von && ort(t.ende).min === 0) bis = tagPlus(bis, -1);
  if (bis < von) bis = von;
  return von <= tag && tag <= bis;
}

function gruss(stunde: number) {
  if (stunde < 5) return 'Gute Nacht';
  if (stunde < 11) return 'Guten Morgen';
  if (stunde < 18) return 'Hallo';
  return 'Guten Abend';
}

const inText = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
};

/** Erster Absatz der Zeitung als Anreißer (ohne Überschriften, Listen und Markdown-Zeichen) */
function anreisser(markdown: string) {
  const zeile = markdown
    .split('\n')
    .map((z) => z.trim())
    .find((z) => z && !/^(#|[-*+] |\d+\. |>|\||---|```)/.test(z));
  if (!zeile) return '';
  const text = zeile
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
  return text.length > 190 ? `${text.slice(0, 187).trimEnd()} …` : text;
}

export function Heute() {
  const qc = useQueryClient();
  const heute = ort(new Date().toISOString()).tag;
  const morgen = tagPlus(heute, 1);

  // wie der Marktplatz-Kalender: großzügig in UTC abfragen, einsortiert wird nach Ortszeit
  const von = new Date(Date.parse(`${heute}T00:00:00Z`) - 3 * 3600_000).toISOString();
  const bis = new Date(Date.parse(`${tagPlus(morgen, 1)}T00:00:00Z`) + 3 * 3600_000).toISOString();
  const fokus = useQuery({ queryKey: ['kirchturm', 'fokus'], queryFn: () => api<FokusStatistik>('/api/kirchturm/fokus') });
  const [planen, setPlanen] = useState(false);
  const karten = useQuery({ queryKey: ['uni', 'karten'], queryFn: () => api<KartenFach[]>('/api/karten') });
  const kartenDran = (karten.data ?? []).reduce((s2, f) => s2 + f.faellig, 0);
  const kalender = useQuery({ queryKey: ['kalender', von, bis], queryFn: () => api<KalenderAntwort>(`/api/kalender?von=${von}&bis=${bis}`), placeholderData: (alt) => alt });
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  // E151: beste Tageszeit (4 Wochen) für „Jetzt dran“ – dieselbe Abfrage wie Rathaus → Statistik
  const statistik28 = useQuery({ queryKey: ['statistik', 28], queryFn: () => api<Statistik>('/api/statistik?tage=28'), staleTime: 30 * 60_000 });
  const kirchturm = useKirchturm();
  const status = useQuery({ queryKey: ['dorf-status'], queryFn: () => api<DorfStatus>('/api/dorf/status'), refetchInterval: 60_000 });
  const zeitung = useQuery({ queryKey: ['morgenzeitung'], queryFn: () => api<MorgenzeitungUebersicht>('/api/morgenzeitung') });
  const post = useQuery({ queryKey: ['post'], queryFn: () => api<PostUebersicht>('/api/post') });
  // Mails der letzten 3 Tage, bei denen die Einordnung „Antwort nötig“ sagt
  const antworten = (post.data?.mails ?? []).filter((m) => m.antwortNoetig && Date.parse(m.datum) > Date.now() - 3 * 86_400_000).length;
  const freigaben = useQuery({ queryKey: ['freigaben', 'offen'], queryFn: () => api<FreigabeInfo[]>('/api/freigaben?status=offen') });

  const k = kirchturm.data;
  const etwasLaeuft = !!k && (k.pomodoro.status === 'laeuft' || k.timer.some((t) => t.status === 'laeuft'));
  const jetzt = useJetzt(etwasLaeuft);
  const jetztIso = new Date(jetzt).toISOString();
  const stunde = Math.floor(ort(jetztIso).min / 60);
  // nächste Prüfung (To-do „Prüfung: …“, z. B. aus den Uni-Fristen) als Countdown
  const naechstePruefung = (todos.data ?? [])
    .filter((t) => !t.erledigt && t.faellig && t.faellig >= heute && /^Prüfung:\s*/i.test(t.titel))
    .sort((a, b) => a.faellig!.localeCompare(b.faellig!))
    .slice(0, 1)
    .map((t) => ({ name: t.titel.replace(/^Prüfung:\s*/i, ''), faellig: t.faellig!, tage: Math.round((Date.parse(`${t.faellig}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86_400_000) }))[0];

  // ---- Termine ----
  const aus = (() => {
    try {
      return JSON.parse(localStorage.getItem('kalender-aus') ?? '[]') as string[];
    } catch {
      return [];
    }
  })();
  // Kalender, die Leif im Marktplatz-Kalender ausgeblendet hat, bleiben auch hier weg
  const termine = (kalender.data?.termine ?? []).filter((t) => !aus.includes(t.kalenderId));
  const sortiert = (tag: string) => termine.filter((t) => amTag(t, tag)).sort((a, b) => Number(b.ganztags) - Number(a.ganztags) || a.start.localeCompare(b.start));
  const termineHeute = sortiert(heute);
  const termineMorgen = sortiert(morgen);
  const farbe = (t: KalenderTermin) =>
    t.quelle === 'uni' ? '#c8553d' : (FARBEN.find((f) => f[0] === t.farbe)?.[2] ?? kalender.data?.kalender.find((x) => x.id === t.kalenderId)?.farbe ?? '#4a86e8');
  const vorbei = (t: KalenderTermin) => !t.ganztags && Date.parse(t.ende) <= jetzt && Date.parse(t.start) < jetzt;
  const laeuft = (t: KalenderTermin) => !t.ganztags && Date.parse(t.start) <= jetzt && jetzt < Date.parse(t.ende);

  // ---- To-dos ----
  // E147: wer auf jemanden wartet, ruht bis zum Nachfass-Tag – eigene Gruppe unten
  const offenAlle = (todos.data ?? []).filter((t) => !t.erledigt);
  const wartend = offenAlle.filter((t) => ruht(t, heute)).sort((a, b) => (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999'));
  const offen = offenAlle.filter((t) => !ruht(t, heute));
  const wichtig = offen.filter((t) => t.wichtig);
  const ueberfaellig = offen.filter((t) => !t.wichtig && t.faellig && t.faellig < heute);
  const faelligHeute = offen.filter((t) => !t.wichtig && t.faellig === heute);
  const bald = offen.filter((t) => !t.wichtig && t.faellig && t.faellig > heute && t.faellig <= tagPlus(heute, 7));
  const ohneDatumAlle = offen.filter((t) => !t.wichtig && !t.faellig).sort((a, b) => (b.erstellt ?? '').localeCompare(a.erstellt ?? ''));
  const ohneDatum = ohneDatumAlle.slice(0, OHNE_DATUM_ZEIGEN);
  const gezeigt = wichtig.length + ueberfaellig.length + faelligHeute.length + bald.length + ohneDatum.length;
  // E120: passt der Tag? (Termine von heute, die noch kommen, sind schon eingerechnet)
  const budget = tagesBudget({ todos: todos.data ?? [], termine: termineHeute, jetzt, jetztMin: ort(jetztIso).min, heute });
  const erledigtHeute = (todos.data ?? []).filter((t) => t.erledigt && t.erledigtAm && ort(t.erledigtAm).tag === heute).length;

  // ---- Womit fange ich an? ----
  const naechsterTermin = termineHeute.find((t) => !t.ganztags && Date.parse(t.ende) > jetzt);
  const erstesTodo = ueberfaellig[0] ?? faelligHeute[0];
  const dran = jetztDran({ todos: todos.data ?? [], termine: termineHeute, jetzt, jetztMin: ort(jetztIso).min, heute, besteZeit: statistik28.data?.besteZeit ?? null });
  const fokusLaeuft = !!k?.pomodoro && k.pomodoro.phase !== 'aus';
  const geladen = !kalender.isPending && !todos.isPending;

  const zeitungHeute = zeitung.data?.aktuell?.datum === heute ? zeitung.data.aktuell : null;
  const nf = freigaben.data?.length ?? 0;
  const wetter = status.data?.wetter;

  return (
    <section className={`heute${stunde >= 18 ? ' abend' : ''}`} aria-label="Mein Tag">
      <header className="karte heute-kopf">
        <div className="heute-kopf-zeile">
          <div>
            <p className="heute-datum">{tagText(heute, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="heute-gruss">{gruss(stunde)}, Leif</h1>
          </div>
          {wetter && (
            <div className="heute-wetter" aria-label={`Wetter in ${wetter.ort ?? 'Konstanz'}`}>
              <span className="heute-wetter-symbol" aria-hidden>
                <E e={WETTER_TEXT[wetter.art].symbol} />
              </span>
              <div>
                <strong>{Math.round(wetter.temperatur)}°</strong> <span>{WETTER_TEXT[wetter.art].text}</span>
                <div className="heute-wetter-klein">
                  {wetter.ort ?? 'Konstanz'} · {Math.round(wetter.tag.min)}° bis {Math.round(wetter.tag.max)}°{wetter.tag.regen != null && wetter.tag.regen >= 20 ? ` · ☔ ${Math.round(wetter.tag.regen)} %` : ''}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* E142: das Wichtigste in einer Zeile – links, was jetzt dran ist, rechts der nächste Termin */}
        <div className="heute-jetzt-zeile">
          {geladen && dran && !fokusLaeuft && <JetztDran d={dran} />}
          {/* ohne anstehenden Termin sagt „Jetzt dran“ dasselbe (und mehr) – nicht doppelt zeigen */}
          {geladen && !(dran && !fokusLaeuft && !naechsterTermin) && (
            <div className="heute-naechstes" data-testid="heute-naechstes">
              <span className="heute-naechstes-marke">Als Nächstes</span>
              {naechsterTermin ? (
                <a href={KALENDER_URL} onClick={linkKlick}>
                  <strong>{naechsterTermin.titel}</strong>{' '}
                  {laeuft(naechsterTermin) ? (
                    <span>läuft bis {ort(naechsterTermin.ende).zeit}</span>
                  ) : (
                    <span>
                      um {ort(naechsterTermin.start).zeit} ({inText(Date.parse(naechsterTermin.start) - jetzt)})
                    </span>
                  )}
                </a>
              ) : erstesTodo ? (
                <span>
                  <strong>{erstesTodo.titel}</strong> <span>{erstesTodo.faellig! < heute ? '– ist überfällig' : '– heute fällig'}</span>
                </span>
              ) : (
                <span>Nichts Dringendes. Zeit für das, was dir wichtig ist. <E e="🌿" /></span>
              )}
            </div>
          )}
        </div>

        <div className="heute-zahlen">
          {kalender.data && (
            <span className="heute-zahl">
              <E e="📅" /> {termineHeute.length === 0 ? 'keine Termine' : `${termineHeute.length} Termin${termineHeute.length === 1 ? '' : 'e'}`}
            </span>
          )}
          {ueberfaellig.length > 0 && <span className="heute-zahl rot"><E e="⚠️" /> {ueberfaellig.length} überfällig</span>}
          {todos.data && <span className="heute-zahl"><E e="☑️" /> {faelligHeute.length} heute fällig</span>}
          {erledigtHeute > 0 && <span className="heute-zahl gruen"><E e="✓" /> {erledigtHeute} erledigt</span>}
          {(fokus.data?.heuteMin ?? 0) > 0 && <span className="heute-zahl"><E e="🍅" /> {fokus.data!.heuteMin} min Fokus</span>}
          {naechstePruefung && (
            <a href="/gebaeude/Uni?reiter=pruefungen" onClick={linkKlick} className={`heute-zahl${naechstePruefung.tage <= 3 ? ' rot' : ''}`} title={`Prüfung am ${naechstePruefung.faellig} – Prüfungs-Cockpit öffnen`}>
              <E e="📝" /> {naechstePruefung.name} {naechstePruefung.tage === 0 ? 'heute' : naechstePruefung.tage === 1 ? 'morgen' : `in ${naechstePruefung.tage} Tagen`}
            </a>
          )}
          {antworten > 0 && (
            <a className="heute-zahl" href="/gebaeude/Post" onClick={linkKlick} title="Mails der letzten 3 Tage, die eine Antwort brauchen">
              <E e="✉️" /> {antworten} {antworten === 1 ? 'Mail wartet' : 'Mails warten'} auf Antwort
            </a>
          )}
          {kartenDran > 0 && (
            <a className="heute-zahl" href="/gebaeude/Uni?reiter=karten" onClick={linkKlick}>
              <E e="🃏" /> {kartenDran} Karten dran
            </a>
          )}
          {kalender.data?.modus === 'google' && (
            <button type="button" className="klein heute-planen" onClick={() => setPlanen(true)}>
              <E e="🧭" /> Tag planen
            </button>
          )}
        </div>
        {planen && <TagPlanen schliessen={() => setPlanen(false)} />}
      </header>

      {/* E142: Hinweise als Band über die ganze Breite (leer = unsichtbar) */}
      <div className="heute-band">
        <PlanenHinweis />
        <AbschlussHinweis />
        <ProjektHinweis />
      </div>

      {(nf > 0 || zeitungHeute) && (
        <div className="heute-hinweise">
          {nf > 0 && (
            <a href="/gebaeude/Rathaus?reiter=freigaben" onClick={linkKlick} className="heute-hinweis freigabe">
              <span className="heute-hinweis-symbol" aria-hidden>
                <E e="✉️" />
              </span>
              <span>
                <strong>
                  {nf} Freigabe{nf === 1 ? '' : 'n'} wart{nf === 1 ? 'et' : 'en'} auf dich
                </strong>
                <span className="heute-hinweis-text">Ansehen und entscheiden →</span>
              </span>
            </a>
          )}
          {zeitungHeute && (
            <a href="/gebaeude/Rathaus?reiter=morgenzeitung" onClick={linkKlick} className="heute-hinweis zeitung">
              <span className="heute-hinweis-symbol" aria-hidden>
                <E e="📰" />
              </span>
              <span>
                <strong>Morgenzeitung von heute</strong>
                <span className="heute-hinweis-text">{anreisser(zeitungHeute.inhalt) || 'Lesen →'}</span>
              </span>
            </a>
          )}
        </div>
      )}

      <div className="heute-spalten">
        <div className="heute-spalte heute-spalte-haupt">
          <section className="karte heute-karte heute-todos-karte" aria-label="To-dos">
            <div className="heute-karte-kopf">
              <h2>
                <E e="☑️" /> To-dos
              </h2>
              <a href={TODO_URL} onClick={linkKlick} className="heute-mehr">
                Alle{offenAlle.length ? ` (${offenAlle.length})` : ''} →
              </a>
            </div>
            <TodoNeu heute={heute} fertig={() => qc.invalidateQueries({ queryKey: ['liste', 'todo'] })} />
            {budget.geschaetztMin > 0 && (
              <p className={`heute-budget${budget.zuViel ? ' warnung' : ''}`} role="status" aria-label="Zeitbudget heute">
                ⏱ Heute ≈ <b>{minutenText(budget.geschaetztMin)}</b> geschätzt
                {budget.ohneSchaetzung > 0 && <span className="leise"> (+{budget.ohneSchaetzung} ohne Schätzung)</span>} · frei bis 22 Uhr ≈ {minutenText(budget.freiMin)}
                {budget.zuViel && <> – mehr, als in den Tag passt. Etwas auf morgen schieben?</>}
              </p>
            )}
            {todos.isPending && <p className="leise">Lade …</p>}
            {todos.isError && <p className="fehler">To-dos nicht erreichbar: {todos.error.message}</p>}
            {todos.data && gezeigt === 0 && <p className="leise heute-leer">{offen.length ? 'Nichts in den nächsten 7 Tagen fällig. 🎉' : 'Nichts offen. 🎉'}</p>}
            <TodoGruppe titel="⭐ Wichtig" art="stern" todos={wichtig} heute={heute} />
            <TodoGruppe titel="Überfällig" art="rot" todos={ueberfaellig} heute={heute} />
            <TodoGruppe titel="Heute" todos={faelligHeute} heute={heute} />
            <TodoGruppe titel="In den nächsten 7 Tagen" art="spaeter" todos={bald} heute={heute} />
            <TodoGruppe titel="Ohne Datum" art="spaeter" todos={ohneDatum} heute={heute} />
            {ohneDatumAlle.length > ohneDatum.length && (
              <a href={TODO_URL} onClick={linkKlick} className="heute-mehr unten">
                + {ohneDatumAlle.length - ohneDatum.length} weitere ohne Datum
              </a>
            )}
            <TodoGruppe titel="⏳ Wartet auf" art="spaeter wartend" todos={wartend} heute={heute} />
          </section>
          <WochenzieleKarte />
          <ErsteSchritte />
        </div>

        <div className="heute-spalte heute-spalte-neben">
          <section className="karte heute-karte heute-termine-karte" aria-label="Termine">
            <div className="heute-karte-kopf">
              <h2>
                <E e="📅" /> Termine
              </h2>
              <a href={KALENDER_URL} onClick={linkKlick} className="heute-mehr">
                Kalender →
              </a>
            </div>
            {kalender.isPending && <p className="leise">Lade …</p>}
            {kalender.isError && <p className="fehler">Kalender nicht erreichbar: {kalender.error.message}</p>}
            {kalender.data && (
              <>
                {kalender.data.modus === 'aus' && !termine.length ? (
                  <p className="leise">{kalender.data.hinweis ?? 'Noch kein Kalender eingerichtet.'}</p>
                ) : (
                  <>
                    <TagesLeiste termine={termineHeute} heute={heute} jetztMin={ort(jetztIso).min} farbe={farbe} />
                    <TerminGruppe titel="Heute"termine={termineHeute} farbe={farbe} vorbei={vorbei} laeuft={laeuft} leer="Heute steht nichts im Kalender." />
                    {termineMorgen.length > 0 && (
                      <TerminGruppe titel={`Morgen · ${tagText(morgen, { weekday: 'long' })}`} termine={termineMorgen} farbe={farbe} vorbei={() => false} laeuft={() => false} />
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <Fokus k={k} laedt={kirchturm.isPending} fehler={kirchturm.isError ? kirchturm.error.message : ''} jetzt={jetzt} heuteMin={fokus.data?.heuteMin ?? 0} />
          <GewohnheitenKarte />
          {stunde >= 17 && <StimmungZeile />}
          {stunde >= 18 && todos.data && <MorgenKarte todos={todos.data} termine={termineMorgen} morgen={morgen} />}
        </div>
      </div>

      <footer className="heute-fuss">
        <StartSchalter />
      </footer>
    </section>
  );
}

// ---- Termine ---------------------------------------------------------------------------------------

function TerminGruppe({
  titel,
  termine,
  farbe,
  vorbei,
  laeuft,
  leer,
}: {
  titel: string;
  termine: KalenderTermin[];
  farbe: (t: KalenderTermin) => string;
  vorbei: (t: KalenderTermin) => boolean;
  laeuft: (t: KalenderTermin) => boolean;
  leer?: string;
}) {
  return (
    <div className="heute-gruppe">
      <h3 className="heute-gruppe-titel">{titel}</h3>
      {!termine.length && leer && <p className="leise heute-leer">{leer}</p>}
      <ul className="heute-termine">
        {termine.map((t) => (
          <li key={`${t.kalenderId}:${t.id}`}>
            <a
              href={KALENDER_URL}
              onClick={linkKlick}
              className={`heute-termin${vorbei(t) ? ' vorbei' : ''}${laeuft(t) ? ' laeuft' : ''}`}
              style={{ ['--farbe' as string]: farbe(t) }}
              title="Im Kalender öffnen"
            >
              <span className="heute-termin-zeit">
                {t.ganztags ? (
                  'ganztags'
                ) : (
                  <>
                    {ort(t.start).zeit}
                    {t.ende !== t.start && <span className="heute-termin-bis">{ort(t.ende).zeit}</span>}
                  </>
                )}
              </span>
              <span className="heute-termin-text">
                <span className="heute-termin-titel">{t.titel}</span>
                {(t.ort || laeuft(t) || t.quelle === 'uni') && (
                  <span className="heute-termin-ort">
                    {laeuft(t) && <span className="heute-jetzt">jetzt</span>}
                    {t.quelle === 'uni' && <span>Uni-Frist</span>}
                    {t.ort && <span>📍 {t.ort}</span>}
                  </span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- To-dos ----------------------------------------------------------------------------------------

function TodoNeu({ heute, fertig }: { heute: string; fertig: () => Promise<unknown> }) {
  const [titel, setTitel] = useState('');
  const [fuerHeute, setFuerHeute] = useState(false);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const anlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titel.trim() || laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      // E127: „… jeden Montag 30 min“ – erkannte Wiederholung bestimmt das erste Datum, sonst „für heute“
      const e = todoAusText(titel, heute);
      await api('/api/todos', { body: { ...e, ...(fuerHeute && !e.faellig && !e.wartet ? { faellig: heute } : {}) } });
      setTitel('');
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
      if (offlineGemerkt(err)) setTitel('');
    } finally {
      setLaeuft(false);
    }
    await fertig();
  };
  return (
    <>
      <form className="heute-neu" onSubmit={(e) => void anlegen(e)} aria-label="Neues To-do">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neues To-do …" maxLength={200} aria-label="Neues To-do" data-todo-neu="" enterKeyHint="done" />
        <label className={`heute-neu-heute${fuerHeute ? ' an' : ''}`} title="Heute fällig">
          <input type="checkbox" checked={fuerHeute} onChange={(e) => setFuerHeute(e.target.checked)} />
          heute
        </label>
        <button type="submit" className="haupt" disabled={laeuft} aria-label="To-do anlegen">
          +
        </button>
      </form>
      <TodoTextHinweis text={titel} heute={heute} />
      {fehler && <p className="fehler">{fehler}</p>}
    </>
  );
}

function TodoGruppe({ titel, todos, heute, art = '' }: { titel: string; todos: TodoInfo[]; heute: string; art?: string }) {
  if (!todos.length) return null;
  return (
    <div className={`heute-gruppe ${art}`}>
      <h3 className="heute-gruppe-titel">
        {titel} <span className="heute-gruppe-zahl">{todos.length}</span>
      </h3>
      <ul className="heute-todos">
        {todos.map((t) => (
          <TodoZeile key={`${t.pfad}:${t.version}`} t={t} heute={heute} />
        ))}
      </ul>
    </div>
  );
}

function TodoZeile({ t, heute }: { t: TodoInfo; heute: string }) {
  const qc = useQueryClient();
  // Häkchen sofort zeigen; mit der neuen Version vom Server verschwindet die Zeile ohnehin
  const [haken, setHaken] = useState(false);
  const [fehler, setFehler] = useState('');
  const abhaken = async (erledigt: boolean) => {
    setHaken(erledigt);
    setFehler('');
    try {
      await api('/api/todos', { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, erledigt } });
    } catch (e) {
      setHaken(!erledigt);
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
  };
  const ueberfaellig = !!t.faellig && t.faellig < heute;
  // E97: Überfälliges mit einem Tipp neu einplanen
  const verschieben = async (faellig: string) => {
    setFehler('');
    try {
      await api('/api/todos', { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, faellig } });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
  };
  const datum = t.faellig && t.faellig !== heute ? (t.faellig === tagPlus(heute, 1) ? 'morgen' : t.faellig === tagPlus(heute, -1) ? 'gestern' : tagText(t.faellig, { weekday: 'short', day: 'numeric', month: 'numeric' })) : '';
  return (
    <li className={`heute-todo${haken ? ' fertig' : ''}`}>
      <label>
        <input type="checkbox" checked={haken} onChange={(e) => void abhaken(e.target.checked)} aria-label={`${t.titel} erledigt`} />
        <span className="heute-todo-titel">{t.titel}</span>
      </label>
      {t.verschoben && t.verschoben >= 3 && !haken ? (
        // E153: oft aufgeschoben – meist ist es zu groß oder unklar
        <span className="heute-todo-datum rot" title="Schon oft verschoben – zu groß? Im To-do-Brett mit ☑ in Schritte zerlegen.">
          ↻ {t.verschoben}×
        </span>
      ) : null}
      {t.energie && (
        <span className="heute-todo-datum" title={t.energie === 'hoch' ? 'braucht Konzentration' : 'geht nebenbei'}>
          <E e={t.energie === 'hoch' ? '🧠' : '🪶'} />
        </span>
      )}
      {t.wartet && (
        <span className="heute-todo-datum" title={t.faellig ? `wartet – ${t.faellig <= heute ? 'heute nachfassen' : `nachfassen am ${t.faellig}`}` : 'wartet – ohne Nachfass-Tag'}>
          <E e="⏳" /> {t.faellig && t.faellig <= heute ? 'nachfassen: ' : ''}
          {t.wartet}
        </span>
      )}
      {datum && <span className={`heute-todo-datum${ueberfaellig ? ' rot' : ''}`}>{datum}</span>}
      {ueberfaellig && !haken && (
        <span className="heute-verschieben">
          <button type="button" className="klein" onClick={() => void verschieben(heute)} aria-label={`${t.titel} auf heute`}>
            → heute
          </button>
          <button type="button" className="klein" onClick={() => void verschieben(tagPlus(heute, 1))} aria-label={`${t.titel} auf morgen`}>
            → morgen
          </button>
        </span>
      )}
      <Stern t={t} />
      {t.gebaeude && <span className="heute-todo-datum">{t.gebaeude}</span>}
      {t.erinnerung && t.erinnerung.slice(0, 10) === heute && (
        <span className="heute-todo-datum" title="Erinnerung – der Kirchturm läutet">
          <E e="🔔" /> {t.erinnerung.slice(11, 16)}
        </span>
      )}
      {t.wiederholen && (
        <span className="heute-todo-datum" title={`wiederkehrend: ${t.wiederholen}`} aria-label={`wiederkehrend: ${t.wiederholen}`}>
          <E e="🔁" />
        </span>
      )}
      {t.dauer && (
        <span className="heute-todo-datum" title={t.fokusMin ? `Fokus bisher ${t.fokusMin} von ${t.dauer} min` : 'geschätzte Dauer'}>
          <E e="⏱" /> {t.fokusMin ? `${minutenText(t.fokusMin)} / ` : ''}
          {minutenText(t.dauer)}
        </span>
      )}
      {t.schritte && t.schritte.length > 0 && (
        // E119: der nächste offene Schritt – die eine Sache, mit der man anfängt
        <span className="heute-todo-datum heute-schritt" title={t.schritte.find((x) => !x.erledigt)?.text ?? 'alle Schritte erledigt'}>
          <E e="☑" /> {t.schritte.filter((x) => x.erledigt).length}/{t.schritte.length}
          {t.schritte.some((x) => !x.erledigt) && <span className="heute-schritt-text"> · {t.schritte.find((x) => !x.erledigt)!.text}</span>}
        </span>
      )}
      {fehler && <span className="fehler">{fehler}</span>}
    </li>
  );
}

// ---- Fokus (Kirchturm) -----------------------------------------------------------------------------

function Fokus({ k, laedt, fehler: ladeFehler, jetzt, heuteMin }: { k: (KirchturmZustand & { versatz: number }) | undefined; laedt: boolean; fehler: string; jetzt: number; heuteMin: number }) {
  const qc = useQueryClient();
  const apple = useDesign() === 'apple';
  const [fehler, setFehler] = useState('');
  const befehl = async (b: Record<string, unknown>) => {
    setFehler('');
    try {
      const z = await api<KirchturmZustand>('/api/kirchturm', { body: b });
      qc.setQueryData(['kirchturm'], { ...z, versatz: Date.parse(z.jetzt) - Date.now() });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  const serverJetzt = jetzt + (k?.versatz ?? 0);
  const p = k?.pomodoro;
  const e = p?.einstellungen;
  const rest = p && e ? (p.status === 'laeuft' && p.ende ? Date.parse(p.ende) - serverJetzt : (p.restMs ?? e.arbeitMin * 60_000)) : 0;
  const gesamt = p && e ? (p.phase === 'kurz' ? e.kurzMin : p.phase === 'lang' ? e.langMin : e.arbeitMin) * 60_000 : 1;
  const phase = p ? { aus: 'Bereit', arbeit: 'Arbeiten', kurz: 'Kurze Pause', lang: 'Lange Pause' }[p.phase] : '';
  const timer = (k?.timer ?? []).filter((t) => t.status !== 'fertig');
  const wecker = (k?.wecker ?? [])
    .filter((w) => w.aktiv && w.naechster)
    .sort((a, b) => a.naechster!.localeCompare(b.naechster!))[0];
  const weckerText = (iso: string) => {
    const o = ort(iso);
    const heute = ort(new Date(serverJetzt).toISOString()).tag;
    const tag = o.tag === heute ? 'heute' : o.tag === tagPlus(heute, 1) ? 'morgen' : tagText(o.tag, { weekday: 'long' });
    return `${tag} ${o.zeit}`;
  };

  return (
    <section className={`karte heute-karte heute-fokus${p && p.phase !== 'aus' ? ` phase-${p.phase}` : ''}`} aria-label="Fokus">
      <div className="heute-karte-kopf">
        <h2>
          <E e="🍅" /> Fokus
        </h2>
        <span className="heute-fokus-links">
          <a href="/fokus" onClick={linkKlick} className="heute-mehr" title="Nur die Uhr – ohne Ablenkung">
            <E e="⛶" /> Vollbild
          </a>{' '}
          <a href={KIRCHTURM_URL} onClick={linkKlick} className="heute-mehr">
            Kirchturm →
          </a>
        </span>
      </div>
      {laedt && <p className="leise">Lade …</p>}
      {ladeFehler && <p className="fehler">Kirchturm nicht erreichbar: {ladeFehler}</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      {e?.tagesZielMin ? (
        // E134: Fokus-Ziel des Tages
        <div className={`heute-fokus-ziel${heuteMin >= e.tagesZielMin ? ' erreicht' : ''}`} role="meter" aria-label="Fokus-Ziel heute" aria-valuemin={0} aria-valuemax={e.tagesZielMin} aria-valuenow={Math.min(heuteMin, e.tagesZielMin)}>
          <div className="heute-fokus-ziel-balken" aria-hidden>
            <span style={{ width: `${Math.min(1, heuteMin / e.tagesZielMin) * 100}%` }} />
          </div>
          <span className="leise">
            {heuteMin >= e.tagesZielMin ? `🎯 Ziel erreicht – ${minutenText(heuteMin)} Fokus heute` : `${minutenText(heuteMin)} von ${minutenText(e.tagesZielMin)} Fokus heute`}
          </span>
        </div>
      ) : null}
      {p && e && (
        <div className="heute-fokus-zeile">
          {p.phase === 'aus' ? (
            <p className="heute-fokus-text">
              Eine Runde konzentriert arbeiten – {e.arbeitMin} Minuten{e.thema ? `, Thema „${e.thema}“` : ''}.
            </p>
          ) : (
            <div className="heute-fokus-lauf">
              {apple ? (
                <Ring anteil={1 - rest / gesamt} groesse={52} dicke={6} className="heute-fokus-ring-a" />
              ) : (
                <div className="heute-fokus-ring" style={{ ['--anteil' as string]: `${Math.min(1, Math.max(0, 1 - rest / gesamt))}` }} aria-hidden />
              )}
              <div>
                <div className="heute-fokus-zeit" data-testid="heute-fokus-rest">
                  {dauerText(rest)}
                </div>
                <div className="leise">
                  {phase}
                  {p.status === 'pause' ? ' · pausiert' : p.status === 'wartet' ? ' · wartet auf dich' : ''}
                  {e.thema ? ` · ${e.thema}` : ''}
                </div>
              </div>
            </div>
          )}
          <div className="heute-fokus-knoepfe">
            {p.status === 'aus' && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'start' })}>
                <E e="🍅" /> Fokus starten
              </button>
            )}
            {p.status === 'wartet' && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'start' })}>
                <E e="▶" /> {p.phase === 'arbeit' ? 'Weiterarbeiten' : 'Pause starten'}
              </button>
            )}
            {p.status === 'laeuft' && (
              <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'pause' })}>
                <E e="⏸" /> Pause
              </button>
            )}
            {p.status === 'pause' && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'weiter' })}>
                <E e="▶" /> Weiter
              </button>
            )}
            {p.phase !== 'aus' && (
              <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'stopp' })}>
                <E e="⏹" /> Stopp
              </button>
            )}
          </div>
        </div>
      )}
      {(timer.length > 0 || wecker) && (
        <ul className="heute-uhren">
          {timer.map((t) => (
            <li key={t.id}>
              <span>
                <E e="⏲️" /> {t.name || 'Timer'}
              </span>
              <strong>
                {dauerText(t.status === 'laeuft' && t.ende ? Date.parse(t.ende) - serverJetzt : (t.restMs ?? 0))}
                {t.status === 'pause' ? ' (Pause)' : ''}
              </strong>
            </li>
          ))}
          {wecker && (
            <li>
              <span>
                <E e="⏰" /> Nächster Wecker{wecker.name ? ` · ${wecker.name}` : ''}
              </span>
              <strong>{weckerText(wecker.naechster!)}</strong>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** ⭐ an/aus – die 1–3 wichtigsten Dinge (oben auf „Heute“, zuerst beim Tag planen, in der Morgenzeitung) */
export function Stern({ t }: { t: TodoInfo }) {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className={`stern${t.wichtig ? ' an' : ''}`}
      aria-pressed={!!t.wichtig}
      aria-label={`${t.titel} ${t.wichtig ? 'nicht mehr wichtig' : 'als wichtig markieren'}`}
      title={t.wichtig ? 'Nicht mehr wichtig' : 'Wichtig für heute'}
      onClick={async (e) => {
        e.stopPropagation();
        await api('/api/todos', { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, wichtig: !t.wichtig } }).catch(() => undefined);
        await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
      }}
    >
      {t.wichtig ? '★' : '☆'}
    </button>
  );
}

/** „Heute“ als Startseite (merkt sich das Gerät) */
function StartSchalter() {
  const [an, setAn] = useState(() => localStorage.getItem('dorf-start') === 'heute');
  return (
    <label className="heute-start leise">
      <input
        type="checkbox"
        checked={an}
        onChange={(e) => {
          setAn(e.target.checked);
          if (e.target.checked) localStorage.setItem('dorf-start', 'heute');
          else localStorage.removeItem('dorf-start');
        }}
      />{' '}
      Beim Öffnen zuerst „Heute“ zeigen
    </label>
  );
}

// ---- E123: Jetzt dran ------------------------------------------------------------------------------

function JetztDran({ d }: { d: NonNullable<ReturnType<typeof jetztDran>> }) {
  const qc = useQueryClient();
  const [fehler, setFehler] = useState('');
  const los = async () => {
    setFehler('');
    try {
      await api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: d.todo.titel, ...(d.todo.gruppe ? { gruppe: d.todo.gruppe } : {}), pfad: d.todo.pfad } });
      await qc.invalidateQueries({ queryKey: ['kirchturm'] });
      navigieren('/fokus');
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  const lueckeText = d.luecke === Infinity ? '' : d.bis ? `${minutenText(d.luecke)} bis ${d.bis.titel}` : `${minutenText(d.luecke)} bis 22 Uhr`;
  return (
    <div className="heute-jetztdran" role="region" aria-label="Jetzt dran">
      <span className="heute-jetztdran-marke">
        <E e="👉" /> Jetzt dran
      </span>
      <div className="heute-jetztdran-text">
        <strong>{d.todo.titel}</strong>
        {d.schritt && <span className="heute-jetztdran-schritt">nächster Schritt: {d.schritt}</span>}
        {!d.schritt && d.todo.verschoben && d.todo.verschoben >= 3 ? (
          <span className="heute-jetztdran-schritt">schon {d.todo.verschoben}× verschoben – fang mit 10 Minuten an, oder zerleg es im Brett in Schritte</span>
        ) : null}
        <span className="leise">
          {d.passt ? `passt in die ${lueckeText}` : `für einen 🍅 reicht's (${lueckeText})`}
          {d.todo.dauer ? ` · ⏱ ${minutenText(d.todo.dauer)}` : ''}
          {d.energie === 'beste-zeit' ? ' · 🧠 deine beste Zeit' : d.energie === 'leicht' ? ' · 🪶 etwas Leichtes' : ''}
        </span>
      </div>
      <button type="button" className="haupt" onClick={() => void los()} aria-label={`Fokus starten: ${d.todo.titel}`}>
        <E e="🍅" /> Los
      </button>
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}

// ---- E129: Hinweis auf die Wochenplanung (So ab 12 Uhr, Mo bis 12 Uhr), solange nicht alle Schritte erledigt ------

function PlanenHinweis() {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const stunde = Number(teile.hour);
  if (!((teile.weekday === 'Sun' && stunde >= 12) || (teile.weekday === 'Mon' && stunde < 12))) return null;
  const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) + 'T12:00:00Z');
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  let fertig = 0;
  try {
    fertig = (JSON.parse(localStorage.getItem(`dorf-planen-${d.toISOString().slice(0, 10)}`) ?? '[]') as string[]).length;
  } catch {
    /* egal */
  }
  if (fertig >= 4) return null;
  return (
    <a href="/planen" onClick={linkKlick} className="karte heute-karte planen-hinweis">
      <E e="🗓️" /> <strong>Zeit für die Wochenplanung</strong> – 10 Minuten, vier Schritte{fertig ? ` (${fertig}/4)` : ''} →
    </a>
  );
}

// ---- E146: Hinweis auf den Tagesabschluss (ab 19 Uhr), solange nicht alle Schritte erledigt ----------------------

// ---- E174: Projekt hinterher / ruht – ein Satz mit Link ----------------------------------------------------

function ProjektHinweis() {
  const q = useQuery({ queryKey: ['liste', 'todo', 'projekte'], queryFn: () => api<Projekt[]>('/api/projekte'), staleTime: 5 * 60_000 });
  const p = (q.data ?? []).filter((x) => x.offen > 0 && (x.hinterher > 0 || x.ruhtMelden)).sort((a, b) => b.hinterher - a.hinterher || b.ruhtTage - a.ruhtTage)[0];
  if (!p) return null;
  return (
    <a href="/gebaeude/Marktplatz?reiter=projekte" onClick={linkKlick} className="karte heute-karte planen-hinweis projekt-hinweis">
      <E e="📁" /> <strong>{p.name}</strong> – {p.hinterher > 0 ? `${p.hinterher} ${p.hinterher === 1 ? 'Schritt' : 'Schritte'} hinterher` : `ruht seit ${p.ruhtTage} Tagen`}
      {p.naechster ? ` · 👉 ${p.naechster.titel}` : ''} →
    </a>
  );
}

function AbschlussHinweis() {
  const stunde = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (stunde < 19) return null;
  let fertig = 0;
  try {
    fertig = (JSON.parse(localStorage.getItem(`dorf-abschluss-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })}`) ?? '[]') as string[]).length;
  } catch {
    /* egal */
  }
  if (fertig >= 4) return null;
  return (
    <a href="/abschluss" onClick={linkKlick} className="karte heute-karte planen-hinweis">
      <E e="🌙" /> <strong>Tag abschließen</strong> – 5 Minuten, dann ist Feierabend{fertig ? ` (${fertig}/4)` : ''} →
    </a>
  );
}

// ---- E141: Morgen im Blick (ab 18 Uhr) ----------------------------------------------------------------

export function MorgenKarte({ todos, termine, morgen }: { todos: TodoInfo[]; termine: KalenderTermin[]; morgen: string }) {
  // für morgen Geplantes zuerst, dann was mitwandert (überfällig/heute); ⭐ jeweils vorn
  const dran = todos
    .filter((t) => !t.erledigt && t.faellig && t.faellig <= morgen)
    .sort((a, b) => Number(b.faellig === morgen) - Number(a.faellig === morgen) || Number(!!b.wichtig) - Number(!!a.wichtig));
  const zeitig = termine.filter((t) => !t.ganztags && !istFristBlock(t));
  // 8–22 Uhr morgen (Ortszeit) minus Termine; Minuten des Tages über ort()
  const iv = zeitig.map((t) => {
    const a = ort(t.start);
    const b = ort(t.ende);
    return [a.tag < morgen ? 0 : a.min, b.tag > morgen ? 24 * 60 : b.min] as [number, number];
  });
  const frei = Math.max(0, 14 * 60 - belegtMs(iv, 8 * 60, 22 * 60));
  const geschaetzt = dran.reduce((s, t) => s + (t.dauer ?? 0), 0);
  if (!dran.length && !zeitig.length) return null;
  return (
    <section className="karte heute-karte morgen-karte" aria-label="Morgen im Blick">
      <div className="heute-karte-kopf">
        <h2>
          <E e="🌅" /> Morgen
        </h2>
        <a href="/gebaeude/Marktplatz?reiter=wochenplan" onClick={linkKlick} className="heute-mehr">
          Wochenplan →
        </a>
      </div>
      <p>
        {dran.length} To-do{dran.length === 1 ? '' : 's'}
        {geschaetzt ? ` (≈ ${minutenText(geschaetzt)})` : ''}
        {zeitig.length ? ` · ${zeitig.length} Termin${zeitig.length === 1 ? '' : 'e'}` : ''} · frei ≈ {minutenText(frei)}
      </p>
      {geschaetzt > frei * 0.7 && <p className="warnung-text">Eng – vielleicht etwas auf später verschieben.</p>}
      {/* E168: Überschneidungen morgen */}
      {ueberschneidungen(zeitig.filter((t) => ort(t.start).tag === morgen)).slice(0, 2).map(([a, b]) => (
        <p key={`${a.id}-${b.id}`} className="warnung-text">
          ⚠️ Überschneidung: {ort(a.start).zeit} {a.titel} ↔ {ort(b.start).zeit} {b.titel}
        </p>
      ))}
      {dran.length > 0 && (
        <ul className="morgen-liste">
          {dran.slice(0, 5).map((t) => (
            <li key={t.pfad}>
              {t.wichtig ? '⭐ ' : ''}
              {t.titel}
              {t.dauer ? <span className="leise"> · ⏱ {minutenText(t.dauer)}</span> : null}
            </li>
          ))}
          {dran.length > 5 && <li className="leise">… und {dran.length - 5} weitere</li>}
        </ul>
      )}
    </section>
  );
}
