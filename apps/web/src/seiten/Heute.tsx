import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WETTER_TEXT, type DorfStatus, type FokusStatistik, type FreigabeInfo, type KartenFach, type KalenderAntwort, type KalenderTermin, type KirchturmZustand, type MorgenzeitungUebersicht, type PostUebersicht, type TodoInfo } from '@dorf/shared';
import { api, ApiFehler, offlineGemerkt } from '../api';
import { minutenText, tagesBudget } from '../tagesbudget';
import { linkKlick } from '../router';
import { FARBEN, ort, tagPlus } from '../komponenten/MarktKalender';
import { dauerText, useKirchturm } from '../komponenten/KirchturmUhr';
import { TagPlanen } from '../komponenten/TagPlanen';
import { GewohnheitenKarte } from '../komponenten/GewohnheitenKarte';
import { WochenzieleKarte } from '../komponenten/WochenzieleKarte';
import { StimmungZeile } from '../komponenten/StimmungZeile';
import { ErsteSchritte } from '../komponenten/ErsteSchritte';

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
  const offen = (todos.data ?? []).filter((t) => !t.erledigt);
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
  const geladen = !kalender.isPending && !todos.isPending;

  const zeitungHeute = zeitung.data?.aktuell?.datum === heute ? zeitung.data.aktuell : null;
  const nf = freigaben.data?.length ?? 0;
  const wetter = status.data?.wetter;

  return (
    <section className="heute" aria-label="Mein Tag">
      <header className="karte heute-kopf">
        <div className="heute-kopf-zeile">
          <div>
            <p className="heute-datum">{tagText(heute, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="heute-gruss">{gruss(stunde)}, Leif</h1>
            <StartSchalter />
          </div>
          {wetter && (
            <div className="heute-wetter" aria-label={`Wetter in ${wetter.ort ?? 'Konstanz'}`}>
              <span className="heute-wetter-symbol" aria-hidden>
                {WETTER_TEXT[wetter.art].symbol}
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

        {geladen && (
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
              <span>Nichts Dringendes. Zeit für das, was dir wichtig ist. 🌿</span>
            )}
          </div>
        )}

        <div className="heute-zahlen">
          {kalender.data && (
            <span className="heute-zahl">
              📅 {termineHeute.length === 0 ? 'keine Termine' : `${termineHeute.length} Termin${termineHeute.length === 1 ? '' : 'e'}`}
            </span>
          )}
          {ueberfaellig.length > 0 && <span className="heute-zahl rot">⚠️ {ueberfaellig.length} überfällig</span>}
          {todos.data && <span className="heute-zahl">☑️ {faelligHeute.length} heute fällig</span>}
          {erledigtHeute > 0 && <span className="heute-zahl gruen">✓ {erledigtHeute} erledigt</span>}
          {(fokus.data?.heuteMin ?? 0) > 0 && <span className="heute-zahl">🍅 {fokus.data!.heuteMin} min Fokus</span>}
          {naechstePruefung && (
            <span className={`heute-zahl${naechstePruefung.tage <= 3 ? ' rot' : ''}`} title={`Prüfung am ${naechstePruefung.faellig}`}>
              📝 {naechstePruefung.name} {naechstePruefung.tage === 0 ? 'heute' : naechstePruefung.tage === 1 ? 'morgen' : `in ${naechstePruefung.tage} Tagen`}
            </span>
          )}
          {antworten > 0 && (
            <a className="heute-zahl" href="/gebaeude/Post" onClick={linkKlick} title="Mails der letzten 3 Tage, die eine Antwort brauchen">
              ✉️ {antworten} {antworten === 1 ? 'Mail wartet' : 'Mails warten'} auf Antwort
            </a>
          )}
          {kartenDran > 0 && (
            <a className="heute-zahl" href="/gebaeude/Uni?reiter=karten" onClick={linkKlick}>
              🃏 {kartenDran} Karten dran
            </a>
          )}
          {kalender.data?.modus === 'google' && (
            <button type="button" className="klein heute-planen" onClick={() => setPlanen(true)}>
              🧭 Tag planen
            </button>
          )}
        </div>
        {planen && <TagPlanen schliessen={() => setPlanen(false)} />}
      </header>

      {(nf > 0 || zeitungHeute) && (
        <div className="heute-hinweise">
          {nf > 0 && (
            <a href="/gebaeude/Rathaus?reiter=freigaben" onClick={linkKlick} className="heute-hinweis freigabe">
              <span className="heute-hinweis-symbol" aria-hidden>
                ✉️
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
                📰
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
        <div className="heute-spalte">
          <section className="karte heute-karte" aria-label="Termine">
            <div className="heute-karte-kopf">
              <h2>📅 Termine</h2>
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
                    <TerminGruppe titel="Heute" termine={termineHeute} farbe={farbe} vorbei={vorbei} laeuft={laeuft} leer="Heute steht nichts im Kalender." />
                    {termineMorgen.length > 0 && (
                      <TerminGruppe titel={`Morgen · ${tagText(morgen, { weekday: 'long' })}`} termine={termineMorgen} farbe={farbe} vorbei={() => false} laeuft={() => false} />
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <Fokus k={k} laedt={kirchturm.isPending} fehler={kirchturm.isError ? kirchturm.error.message : ''} jetzt={jetzt} />
          <GewohnheitenKarte />
          {stunde >= 17 && <StimmungZeile />}
        </div>

        <div className="heute-spalte">
          <ErsteSchritte />
          <WochenzieleKarte />
          <section className="karte heute-karte" aria-label="To-dos">
            <div className="heute-karte-kopf">
              <h2>☑️ To-dos</h2>
              <a href={TODO_URL} onClick={linkKlick} className="heute-mehr">
                Alle{offen.length ? ` (${offen.length})` : ''} →
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
            <TodoGruppe titel="In den nächsten 7 Tagen" todos={bald} heute={heute} />
            <TodoGruppe titel="Ohne Datum" todos={ohneDatum} heute={heute} />
            {ohneDatumAlle.length > ohneDatum.length && (
              <a href={TODO_URL} onClick={linkKlick} className="heute-mehr unten">
                + {ohneDatumAlle.length - ohneDatum.length} weitere ohne Datum
              </a>
            )}
          </section>
        </div>
      </div>
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
      await api('/api/todos', { body: { titel: titel.trim(), ...(fuerHeute ? { faellig: heute } : {}) } });
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
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neues To-do …" maxLength={200} aria-label="Neues To-do" enterKeyHint="done" />
        <label className={`heute-neu-heute${fuerHeute ? ' an' : ''}`} title="Heute fällig">
          <input type="checkbox" checked={fuerHeute} onChange={(e) => setFuerHeute(e.target.checked)} />
          heute
        </label>
        <button type="submit" className="haupt" disabled={laeuft} aria-label="To-do anlegen">
          +
        </button>
      </form>
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
          🔔 {t.erinnerung.slice(11, 16)}
        </span>
      )}
      {t.wiederholen && (
        <span className="heute-todo-datum" title={`wiederkehrend: ${t.wiederholen}`} aria-label={`wiederkehrend: ${t.wiederholen}`}>
          🔁
        </span>
      )}
      {t.dauer && <span className="heute-todo-datum" title="geschätzte Dauer">⏱ {minutenText(t.dauer)}</span>}
      {t.schritte && t.schritte.length > 0 && (
        // E119: der nächste offene Schritt – die eine Sache, mit der man anfängt
        <span className="heute-todo-datum heute-schritt" title={t.schritte.find((x) => !x.erledigt)?.text ?? 'alle Schritte erledigt'}>
          ☑ {t.schritte.filter((x) => x.erledigt).length}/{t.schritte.length}
          {t.schritte.some((x) => !x.erledigt) && <span className="heute-schritt-text"> · {t.schritte.find((x) => !x.erledigt)!.text}</span>}
        </span>
      )}
      {fehler && <span className="fehler">{fehler}</span>}
    </li>
  );
}

// ---- Fokus (Kirchturm) -----------------------------------------------------------------------------

function Fokus({ k, laedt, fehler: ladeFehler, jetzt }: { k: (KirchturmZustand & { versatz: number }) | undefined; laedt: boolean; fehler: string; jetzt: number }) {
  const qc = useQueryClient();
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
        <h2>🍅 Fokus</h2>
        <span className="heute-fokus-links">
          <a href="/fokus" onClick={linkKlick} className="heute-mehr" title="Nur die Uhr – ohne Ablenkung">
            ⛶ Vollbild
          </a>{' '}
          <a href={KIRCHTURM_URL} onClick={linkKlick} className="heute-mehr">
            Kirchturm →
          </a>
        </span>
      </div>
      {laedt && <p className="leise">Lade …</p>}
      {ladeFehler && <p className="fehler">Kirchturm nicht erreichbar: {ladeFehler}</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      {p && e && (
        <div className="heute-fokus-zeile">
          {p.phase === 'aus' ? (
            <p className="heute-fokus-text">
              Eine Runde konzentriert arbeiten – {e.arbeitMin} Minuten{e.thema ? `, Thema „${e.thema}“` : ''}.
            </p>
          ) : (
            <div className="heute-fokus-lauf">
              <div className="heute-fokus-ring" style={{ ['--anteil' as string]: `${Math.min(1, Math.max(0, 1 - rest / gesamt))}` }} aria-hidden />
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
                🍅 Fokus starten
              </button>
            )}
            {p.status === 'wartet' && (
              <button type="button" className="haupt" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'start' })}>
                ▶ {p.phase === 'arbeit' ? 'Weiterarbeiten' : 'Pause starten'}
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
              <button type="button" onClick={() => void befehl({ befehl: 'pomodoro', aktion: 'stopp' })}>
                ⏹ Stopp
              </button>
            )}
          </div>
        </div>
      )}
      {(timer.length > 0 || wecker) && (
        <ul className="heute-uhren">
          {timer.map((t) => (
            <li key={t.id}>
              <span>⏲️ {t.name || 'Timer'}</span>
              <strong>
                {dauerText(t.status === 'laeuft' && t.ende ? Date.parse(t.ende) - serverJetzt : (t.restMs ?? 0))}
                {t.status === 'pause' ? ' (Pause)' : ''}
              </strong>
            </li>
          ))}
          {wecker && (
            <li>
              <span>⏰ Nächster Wecker{wecker.name ? ` · ${wecker.name}` : ''}</span>
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
