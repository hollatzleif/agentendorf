// E239: „Muster-Kielwasser“ (/hafen/muster) – das Training des Muster-Modells im Stil des Bot-Terminals: Kopf mit Lauf-
// auswahl und Status, Tafeln Modelle (Test gegen Raten/Konstante + Entscheidung), Verlauf über die Trainings, Lernkurve und
// Merkmale des gewählten Modells, RL-Zeitraffer (Kapitalkurve mit Kauf-/Verkaufs-Markern) und die Konsole. Alles Paper.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KRYPTO_MUSTER_MODELLE,
  type KryptoMusterModellInfo,
  type KryptoMusterSchluessel,
  type KryptoMusterStatus,
  type KryptoMusterVerlauf,
  type KryptoMusterVerlaufModell,
  type KryptoRlBeispielTrade,
  type KryptoRlEntscheidungInfo,
  type KryptoUebersicht,
} from '@dorf/shared';
import { ApiFehler, api } from '../api';
import { linkKlick } from '../router';
import { LinienChart, SERIEN_FARBEN, type ChartMarke, type ChartSerie } from './chart';
import { Eur, EuroKurs, KURS_QUELLE, eurJeSolAus, eurText, kursText, useEurJeSol } from './euro';
import { MusterKonsole } from './MusterKonsole';
import { Em } from './zeichen';
import { prozent, solVz, uhrzeit } from './format';
import './hafen.css';

const WAHRSCHEINLICH = new Set(KRYPTO_MUSTER_MODELLE.filter((m) => m.art === 'wahrscheinlichkeit').map((m) => m.schluessel));
const STANDARD_LINIEN: KryptoMusterSchluessel[] = ['basis', 'pump', 'absturz', 'verlauf1m'];

/** feste Farbe je Modell (innerhalb eines Charts eindeutig; Hoch/Tief 5 min gestrichelt in der Farbe von 1 min) */
const LINIE: Record<KryptoMusterSchluessel, { farbe: string; gestrichelt?: boolean }> = {
  basis: { farbe: SERIEN_FARBEN[0] },
  pump: { farbe: SERIEN_FARBEN[1] },
  absturz: { farbe: SERIEN_FARBEN[2] },
  fruehPump: { farbe: SERIEN_FARBEN[3] },
  fruehAbsturz: { farbe: SERIEN_FARBEN[4] },
  verlauf5s: { farbe: SERIEN_FARBEN[0] },
  verlauf15s: { farbe: SERIEN_FARBEN[1] },
  verlauf30s: { farbe: SERIEN_FARBEN[2] },
  verlauf1m: { farbe: SERIEN_FARBEN[3] },
  verlauf2m: { farbe: SERIEN_FARBEN[4] },
  verlauf5m: { farbe: SERIEN_FARBEN[5] },
  hoch1: { farbe: SERIEN_FARBEN[6] },
  hoch5: { farbe: SERIEN_FARBEN[6], gestrichelt: true },
  tief1: { farbe: SERIEN_FARBEN[7] },
  tief5: { farbe: SERIEN_FARBEN[7], gestrichelt: true },
};

const name = (k: string) => KRYPTO_MUSTER_MODELLE.find((m) => m.schluessel === k)?.name ?? (k === 'rl' ? 'RL-Agent' : k);
const kurzName = (k: string) => name(k).replace(/ \(.*$/, '');
const datum = (ms: number | string) => new Date(ms).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const komma = (n: number, st = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: st, maximumFractionDigits: st });
const kurzZahl = (n: number) => (Math.abs(n) >= 100 ? komma(n, 0) : Math.abs(n) >= 1 ? komma(n, 2) : Number(n.toPrecision(3)).toLocaleString('de-DE', { maximumSignificantDigits: 3 }));
/** Verbesserung gegenüber der Konstante in % (Wert-Modelle) */
const verbesserung = (fehler: number | null, basis: number | null) => (fehler != null && basis != null && basis > 0 ? (1 - fehler / basis) * 100 : null);

export function MusterKielwasserSeite() {
  const qc = useQueryClient();
  const [wahl, setWahl] = useState<number | null>(null);
  const [modell, setModell] = useState<KryptoMusterSchluessel>('basis');
  const [hinweis, setHinweis] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['krypto', 'muster'], queryFn: () => api<KryptoMusterStatus>('/api/krypto/muster'), refetchInterval: (x) => (x.state.data?.training.laeuft ? 2000 : 15_000), retry: false });
  const laeuft = !!status.data?.training.laeuft;
  const verlauf = useQuery({
    queryKey: ['krypto', 'muster', 'verlauf', wahl],
    queryFn: () => api<KryptoMusterVerlauf>(`/api/krypto/muster/verlauf${wahl != null ? `?version=${wahl}` : ''}`),
    refetchInterval: laeuft ? 5000 : 60_000,
    placeholderData: (alt) => alt,
    retry: false,
  });
  const uebersicht = useQuery({ queryKey: ['krypto'], queryFn: () => api<KryptoUebersicht>('/api/krypto'), refetchInterval: 30_000, retry: false });
  // Training fertig → Verlauf neu
  const vorher = useRef(laeuft);
  useEffect(() => {
    if (vorher.current && !laeuft) void qc.invalidateQueries({ queryKey: ['krypto', 'muster', 'verlauf'] });
    vorher.current = laeuft;
  }, [laeuft, qc]);
  useEffect(() => {
    const alt = document.title;
    document.title = 'Muster-Kielwasser · Hafen';
    return () => {
      document.title = alt;
    };
  }, []);
  const trainieren = useMutation({
    mutationFn: () => api('/api/krypto/muster/training', { methode: 'POST' }),
    onSuccess: () => {
      setHinweis('Training gestartet – die Konsole lädt live nach.');
      setWahl(null);
      void qc.invalidateQueries({ queryKey: ['krypto', 'muster'] });
    },
    onError: (e) => {
      setHinweis(e instanceof ApiFehler && e.status === 409 ? 'Das Training läuft schon.' : e instanceof ApiFehler ? e.message : String(e));
      void qc.invalidateQueries({ queryKey: ['krypto', 'muster'] });
    },
  });
  const eurJeSol = eurJeSolAus(uebersicht.data?.solUsd, uebersicht.data?.usdJeEur);

  if (status.isError && !status.data)
    return (
      <div className="kw">
        <div className="kw-tafel">
          <h2>Muster-Kielwasser</h2>
          <p className="minus">{(status.error as Error).message}</p>
          <a href="/gebaeude/Hafen" onClick={linkKlick}>
            <Em e="←" /> zurück zum Hafen
          </a>
        </div>
      </div>
    );
  const m = status.data;
  const v = verlauf.data;
  const lauf = v?.lauf ?? null;
  const zusammenfassung = lauf ? v?.laeufe.find((l) => l.version === lauf.version) : undefined;
  return (
    <EuroKurs.Provider value={eurJeSol}>
      <div className="kw muster-kw" aria-label="Muster-Kielwasser">
        <Kopf m={m} v={v} wahl={wahl} setWahl={setWahl} trainieren={() => trainieren.mutate()} startet={trainieren.isPending} hinweis={hinweis} hinweisWeg={() => setHinweis(null)} />
        {verlauf.isError && !v && <p className="minus mono">Verlauf nicht erreichbar: {(verlauf.error as Error).message}</p>}
        <div className="kw-mitte">
          <ModelleTafel lauf={lauf} zusammenfassung={zusammenfassung} gewaehlt={modell} waehlen={setModell} laedt={!v} />
          <VerlaufTafel v={v} gewaehlt={modell} waehlen={setModell} />
        </div>
        <div className="kw-mitte">
          <LernkurveTafel info={lauf?.modelle.find((x) => x.schluessel === modell)} schluessel={modell} lauf={lauf?.version ?? null} />
          <MerkmaleTafel info={lauf?.modelle.find((x) => x.schluessel === modell)} schluessel={modell} />
        </div>
        <RlTafel rl={lauf?.rl ?? null} lauf={lauf?.version ?? null} />
        <MusterKonsole version={wahl} />
      </div>
    </EuroKurs.Provider>
  );
}

function Kopf({ m, v, wahl, setWahl, trainieren, startet, hinweis, hinweisWeg }: { m: KryptoMusterStatus | undefined; v: KryptoMusterVerlauf | undefined; wahl: number | null; setWahl: (x: number | null) => void; trainieren: () => void; startet: boolean; hinweis: string | null; hinweisWeg: () => void }) {
  const eurJeSol = useEurJeSol();
  const aktiv = m?.modelle?.filter((x) => x.aktiv).length ?? 0;
  const t = m?.training;
  const gezeigt = v?.lauf ? v.laeufe.find((l) => l.version === v.lauf!.version) : undefined;
  return (
    <header className="kw-tafel kw-kopf">
      <div className="kw-wer">
        <div className="kw-avatar" aria-hidden>
          <Em e="🧠" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="kw-name">
            Muster-Kielwasser<span className="kw-pille">PAPER</span>
          </div>
          <div className="kw-zeile">
            <span>Training des Muster-Modells</span>
            {m && (
              <span>
                {m.daten.ticks.toLocaleString('de-DE')} Ticks · {m.daten.tokens.toLocaleString('de-DE')} Tokens
                {m.archiv ? ` · Archiv ${m.archiv.beispiele.toLocaleString('de-DE')} Beispiele` : ''}
              </span>
            )}
            {eurJeSol != null && <span title={KURS_QUELLE}>{kursText(eurJeSol)}</span>}
          </div>
          <div className="kw-zeile mk-kopfzeile">
            <label className="mk-auswahl">
              Lauf{' '}
              <select value={wahl ?? ''} onChange={(e) => setWahl(e.target.value ? Number(e.target.value) : null)} data-testid="muster-lauf">
                <option value="">neuester / laufender</option>
                {v?.laeufe.map((l) => (
                  <option key={l.version} value={l.version}>
                    v{l.version} · {datum(l.erstellt)}
                    {l.dauerMs != null ? ` · ${Math.round(l.dauerMs / 1000)} s` : ''} ·{' '}
                    {l.laeuft ? 'läuft …' : l.fehler ? '⚠ fehlgeschlagen' : `aktiv geworden: ${l.aktivGeworden.length ? l.aktivGeworden.map(kurzName).join(', ') : 'keins'}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {gezeigt && (
            <div className="kw-zeile" data-testid="muster-lauf-info">
              <span>
                gezeigt: v{gezeigt.version} · {datum(gezeigt.erstellt)}
                {gezeigt.dauerMs != null ? ` · Dauer ${Math.round(gezeigt.dauerMs / 1000)} s` : ''}
              </span>
              <span>aktiv geworden: {gezeigt.aktivGeworden.length ? gezeigt.aktivGeworden.map(kurzName).join(', ') : 'keins'}</span>
            </div>
          )}
        </div>
      </div>
      <div className="kw-konto mk-konto">
        <strong data-testid="muster-aktiv">
          {aktiv}/{KRYPTO_MUSTER_MODELLE.length}
        </strong>
        <span>Modelle aktiv</span>
        <div className="mk-status" data-testid="muster-status">
          {!t ? (
            <span className="leise">lade …</span>
          ) : t.laeuft ? (
            <>
              <span className="kw-online">Training läuft · {Math.round(t.fortschritt)} %</span>
              <div className="kw-fortschritt" role="progressbar" aria-label="Training" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.fortschritt)}>
                <b style={{ width: `${Math.round(t.fortschritt)}%` }} />
              </div>
            </>
          ) : t.fehler ? (
            <span className="minus">⚠ fehlgeschlagen: {t.fehler}</span>
          ) : (
            <span className="plus">
              <Em e="✓" /> fertig{t.letzter ? ` · ${datum(t.letzter)}` : ''}</span>
          )}
        </div>
        <div className="kw-zeile" style={{ justifyContent: 'flex-end', marginTop: '0.35rem' }}>
          {t?.naechster && <span>nächster Lauf {datum(t.naechster)}</span>}
        </div>
        <div className="kw-zeile mk-knoepfe">
          <button type="button" className="kw-knopf" disabled={!t || t.laeuft || startet} onClick={trainieren} data-testid="muster-trainieren">
            {t?.laeuft ? 'Trainiert …' : 'Jetzt trainieren'}
          </button>
          <a href="/gebaeude/Hafen" onClick={linkKlick} className="kw-zurueck">
            <Em e="←" /> Flotte
          </a>
        </div>
        {hinweis && (
          <p className="mono mk-hinweis" role="status">
            {hinweis}{' '}
            <button type="button" className="kw-knopf" onClick={hinweisWeg}>
              ok
            </button>
          </p>
        )}
      </div>
    </header>
  );
}

const ENTSCHEIDUNG: Record<KryptoMusterVerlaufModell['entscheidung'], string> = { uebernommen: 'ÜBERNOMMEN', behaelt: 'BEHÄLT', nicht_aktiv: 'NICHT AKTIV', nicht_trainiert: 'NICHT TRAINIERT' };

/** a) je Modell: aktiv-Punkt, Name, Test-Wert gegen Raten/Konstante (Balken), Entscheidung mit Grund im Tooltip */
function ModelleTafel({ lauf, zusammenfassung, gewaehlt, waehlen, laedt }: { lauf: KryptoMusterVerlauf['lauf']; zusammenfassung: KryptoMusterVerlauf['laeufe'][number] | undefined; gewaehlt: KryptoMusterSchluessel; waehlen: (k: KryptoMusterSchluessel) => void; laedt: boolean }) {
  return (
    <section className="kw-tafel" aria-label="Modelle">
      <div className="kw-chart-kopf">
        <h3>Modelle{lauf ? ` · v${lauf.version}` : ''}</h3>
        <span className="leise mono mk-klein">Balken: Modell vs. Raten (AUC 0,5) bzw. Konstante (Fehler)</span>
      </div>
      {laedt ? (
        <p className="leise mono">lade …</p>
      ) : !lauf ? (
        <p className="leise mono">Noch kein Training gespeichert.</p>
      ) : (
        <ul className="mk-modelle" data-testid="muster-modelle-liste">
          {KRYPTO_MUSTER_MODELLE.map((d) => {
            const info = lauf.modelle.find((x) => x.schluessel === d.schluessel);
            const e = zusammenfassung?.modelle[d.schluessel];
            return <ModellZeile key={d.schluessel} schluessel={d.schluessel} info={info} e={e} an={gewaehlt === d.schluessel} waehlen={() => waehlen(d.schluessel)} />;
          })}
        </ul>
      )}
    </section>
  );
}

function ModellZeile({ schluessel, info, e, an, waehlen }: { schluessel: KryptoMusterSchluessel; info: KryptoMusterModellInfo | undefined; e: KryptoMusterVerlaufModell | undefined; an: boolean; waehlen: () => void }) {
  const p = WAHRSCHEINLICH.has(schluessel);
  const t = info?.test;
  let modellW: number | null = null;
  let vergleichW: number | null = null;
  let text = '–';
  let besser = false;
  if (t && p && t.auc != null) {
    // AUC auf 0,3 … 0,9 abgebildet (0,5 = Raten)
    const s = (x: number) => Math.max(0, Math.min(1, (x - 0.3) / 0.6));
    modellW = s(t.auc);
    vergleichW = s(0.5);
    besser = t.auc > 0.5;
    text = `${komma(t.auc)} vs. 0,50`;
  } else if (t && !p && t.fehler != null && t.fehlerBasis != null) {
    const max = Math.max(t.fehler, t.fehlerBasis, 1e-9);
    modellW = t.fehler / max;
    vergleichW = t.fehlerBasis / max;
    besser = t.fehler < t.fehlerBasis;
    text = `${kurzZahl(t.fehler)} vs. ${kurzZahl(t.fehlerBasis)}`;
  }
  const entscheidung = e?.entscheidung ?? (info ? (info.aktiv ? 'uebernommen' : 'nicht_aktiv') : 'nicht_trainiert');
  const grund = e?.grund ?? (info ? (info.gruende.join('; ') || 'Test bestanden') : 'in diesem Lauf nicht trainiert');
  return (
    <li className={an ? 'an' : ''}>
      <button type="button" onClick={waehlen} aria-pressed={an} data-testid={`modell-${schluessel}`} title={`${name(schluessel)} – für Lernkurve und Merkmale wählen`}>
        <span className={`hafen-punkt${info?.aktiv ? ' an' : ''}`} title={info?.aktiv ? 'Test bestanden (aktiv)' : 'Test nicht bestanden'} aria-label={info?.aktiv ? 'aktiv' : 'nicht aktiv'} />
        <span className="mk-name">{name(schluessel)}</span>
        <span className="mk-balken" title={p ? 'Test-AUC (oben) gegen Raten 0,5 (unten) – länger ist besser' : 'Fehler im Test (oben) gegen die Konstante (unten) – kürzer ist besser'}>
          {modellW != null ? (
            <>
              <i className={besser ? 'gut' : 'schlecht'} style={{ width: `${Math.max(2, modellW * 100)}%` }} />
              <i className="vergleich" style={{ width: `${Math.max(2, (vergleichW ?? 0) * 100)}%` }} />
            </>
          ) : null}
        </span>
        <span className="mk-wert mono">{text}</span>
      </button>
      <span className={`kw-tag mk-entscheidung ${entscheidung}`} title={grund} data-testid={`entscheidung-${schluessel}`}>
        {ENTSCHEIDUNG[entscheidung]}
        {entscheidung === 'behaelt' && e?.behaeltVersion != null ? ` v${e.behaeltVersion}` : ''}
      </span>
    </li>
  );
}

/** b) Verlauf über die Trainings – AUC (Wahrscheinlichkeiten) und Verbesserung gegen die Konstante (Werte), je ein Chart */
function VerlaufTafel({ v, gewaehlt, waehlen }: { v: KryptoMusterVerlauf | undefined; gewaehlt: KryptoMusterSchluessel; waehlen: (k: KryptoMusterSchluessel) => void }) {
  const [linien, setLinien] = useState<KryptoMusterSchluessel[]>(STANDARD_LINIEN);
  const laeufe = useMemo(() => (v?.laeufe ?? []).filter((l) => !l.laeuft && !l.fehler).sort((a, b) => a.version - b.version), [v]);
  const versionBei = new Map(laeufe.map((l) => [Date.parse(l.erstellt), l.version]));
  const serie = (k: KryptoMusterSchluessel): ChartSerie => ({
    id: k,
    name: kurzName(k),
    farbe: LINIE[k].farbe,
    gestrichelt: LINIE[k].gestrichelt,
    punkte: laeufe.flatMap((l) => {
      const x = l.modelle[k];
      if (!x) return [];
      const y = WAHRSCHEINLICH.has(k) ? x.auc : verbesserung(x.fehler, x.fehlerBasis);
      return y == null || !Number.isFinite(y) ? [] : [{ x: Date.parse(l.erstellt), y, voll: x.entscheidung === 'uebernommen' }];
    }),
  });
  const pSerien = linien.filter((k) => WAHRSCHEINLICH.has(k)).map(serie);
  const wSerien = linien.filter((k) => !WAHRSCHEINLICH.has(k)).map(serie);
  const xLang = (x: number) => `v${versionBei.get(x) ?? '?'} · ${datum(x)}`;
  const xText = (x: number) => datum(x);
  const umschalten = (k: KryptoMusterSchluessel) => setLinien((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  return (
    <section className="kw-tafel" aria-label="Verlauf über die Trainings" data-testid="muster-verlauf">
      <div className="kw-chart-kopf">
        <h3>Verlauf über die Trainings</h3>
        <span className="leise mono mk-klein">{laeufe.length} Läufe · gefüllt = übernommen · Klick wählt das Modell</span>
      </div>
      <div className="mk-chips" role="group" aria-label="Linien">
        {KRYPTO_MUSTER_MODELLE.map((d) => (
          <button key={d.schluessel} type="button" className={linien.includes(d.schluessel) ? 'an' : ''} aria-pressed={linien.includes(d.schluessel)} onClick={() => umschalten(d.schluessel)} data-testid={`linie-${d.schluessel}`}>
            <i className={LINIE[d.schluessel].gestrichelt ? 'gestrichelt' : ''} style={{ ['--farbe' as string]: LINIE[d.schluessel].farbe }} aria-hidden />
            {kurzName(d.schluessel)}
          </button>
        ))}
      </div>
      {!v ? (
        <p className="leise mono">lade …</p>
      ) : !laeufe.length ? (
        <p className="leise mono">Noch kein Training gespeichert.</p>
      ) : (
        <>
          {pSerien.length > 0 && (
            <>
              <p className="mk-achse">Test-AUC (0,5 = Raten)</p>
              <LinienChart serien={pSerien} xText={xText} xLang={xLang} yText={(y) => komma(y)} hilfslinie={{ y: 0.5, text: 'Raten 0,50' }} yMuss={[0.5]} hoehe={220} onSerie={(id) => waehlen(id as KryptoMusterSchluessel)} gewaehlt={gewaehlt} label={`Test-AUC über ${laeufe.length} Läufe: ${pSerien.map((s) => s.name).join(', ')}`} testid="verlauf-auc" />
            </>
          )}
          {wSerien.length > 0 && (
            <>
              <p className="mk-achse">Fehler besser als die Konstante (%)</p>
              <LinienChart serien={wSerien} xText={xText} xLang={xLang} yText={(y) => `${y >= 0 ? '+' : '−'}${komma(Math.abs(y), 1)} %`} hilfslinie={{ y: 0, text: 'Konstante 0 %' }} yMuss={[0]} hoehe={200} onSerie={(id) => waehlen(id as KryptoMusterSchluessel)} gewaehlt={gewaehlt} label={`Verbesserung gegen die Konstante über ${laeufe.length} Läufe: ${wSerien.map((s) => s.name).join(', ')}`} testid="verlauf-wert" />
            </>
          )}
          {!pSerien.length && !wSerien.length && <p className="leise mono">Oben eine Linie wählen.</p>}
        </>
      )}
    </section>
  );
}

/** c) Lernkurve – Verlust auf Lern- und Testdaten je Baum */
function LernkurveTafel({ info, schluessel, lauf }: { info: KryptoMusterModellInfo | undefined; schluessel: KryptoMusterSchluessel; lauf: number | null }) {
  const k = info?.lernkurve;
  const verlust = WAHRSCHEINLICH.has(schluessel) ? 'Log-Loss' : schluessel.startsWith('verlauf') ? 'asymmetrischer Fehler auf log(1 + x/100)' : 'quadratischer Fehler auf log(1 + x/100)';
  const mitTest = k?.filter((p) => p.test != null) ?? [];
  const bester = mitTest.length ? mitTest.reduce((a, b) => (b.test! < a.test! ? b : a)) : null;
  const letzter = mitTest.at(-1);
  const ueber = bester && letzter && letzter.test! > bester.test! * 1.01;
  return (
    <section className="kw-tafel" aria-label="Lernkurve" data-testid="muster-lernkurve">
      <div className="kw-chart-kopf">
        <h3>Lernkurve · {name(schluessel)}</h3>
        <span className="leise mono mk-klein">{verlust} je Baum</span>
      </div>
      {!lauf ? (
        <p className="leise mono">Noch kein Training gespeichert.</p>
      ) : !info ? (
        <p className="leise mono">In v{lauf} nicht trainiert (zu wenig Daten).</p>
      ) : !k?.length ? (
        <p className="leise mono" data-testid="lernkurve-spaeter">
          Die Lernkurve gibt es ab dem nächsten Training (v{lauf} ist älter).
        </p>
      ) : (
        <>
          <LinienChart
            serien={[
              { id: 'lern', name: 'Lerndaten', farbe: SERIEN_FARBEN[0], punkte: k.map((p) => ({ x: p.baum, y: p.lern })) },
              { id: 'test', name: 'Testdaten', farbe: SERIEN_FARBEN[1], punkte: mitTest.map((p) => ({ x: p.baum, y: p.test! })) },
            ]}
            xText={(x) => `Baum ${Math.round(x)}`}
            yText={(y) => kurzZahl(y)}
            hoehe={220}
            label={`Lernkurve ${name(schluessel)}: Lernverlust ${kurzZahl(k[0]!.lern)} → ${kurzZahl(k.at(-1)!.lern)}${letzter ? `, Testverlust ${kurzZahl(mitTest[0]!.test!)} → ${kurzZahl(letzter.test!)}` : ''}`}
            testid="lernkurve-chart"
          />
          <p className="leise mono mk-klein" data-testid="lernkurve-urteil">
            {!bester
              ? 'Ohne Testdaten – nur der Lernverlust.'
              : ueber
                ? `Test am besten bei Baum ${bester.baum} und steigt danach wieder – das Modell passt sich ab dort zu sehr an die Lerndaten an.`
                : `Test sinkt bis Baum ${bester.baum} – keine Über-Anpassung sichtbar.`}
          </p>
        </>
      )}
    </section>
  );
}

/** d) wichtigste 10 Merkmale des gewählten Modells */
function MerkmaleTafel({ info, schluessel }: { info: KryptoMusterModellInfo | undefined; schluessel: KryptoMusterSchluessel }) {
  const liste = (info?.merkmale ?? []).slice(0, 10);
  const max = Math.max(1e-9, ...liste.map((x) => x.wichtigkeit));
  return (
    <section className="kw-tafel" aria-label="Merkmale" data-testid="muster-merkmale">
      <div className="kw-chart-kopf">
        <h3>Merkmale · {kurzName(schluessel)}</h3>
        <span className="leise mono mk-klein">Anteil am Gain aller Bäume</span>
      </div>
      {liste.length ? (
        <ul className="kw-liste" style={{ marginTop: '0.5rem' }}>
          {liste.map((x) => (
            <li key={x.name}>
              <div className="zeile">
                <span className="mk-umbruch">{x.name}</span>
                <span>{(Math.round(x.wichtigkeit * 1000) / 10).toLocaleString('de-DE')} %</span>
              </div>
              <div className="kw-fortschritt">
                <b style={{ width: `${Math.max(2, (x.wichtigkeit / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="leise mono">Keine Merkmale für dieses Modell in diesem Lauf.</p>
      )}
    </section>
  );
}

const HANDLUNG: Record<string, string> = { kaufen: 'KAUFEN', raus: 'RAUS', halb: 'HALB', warten: 'WARTEN' };
const w2 = (x: number | null) => (x == null ? '–' : komma(x));
const pz1 = (x: number | null) => (x == null ? '–' : prozent(x, 1));

function lageText(e: KryptoRlEntscheidungInfo) {
  const l = e.lage;
  const t = [`p ${w2(l.p)}`, `🚀 ${w2(l.pump)}`, `💥 ${w2(l.absturz)}`, `v1m ${pz1(l.v1m)}`];
  if (l.alarm) t.push(`Alarm ${l.alarm === 'absturz' ? '💥' : '🚀'}`);
  if (l.plusProzent != null) t.push(`Plus ${pz1(l.plusProzent)}`);
  if (l.haltSek != null) t.push(`${Math.round(l.haltSek)} s gehalten`);
  return t.join(' · ');
}
function warumText(e: KryptoRlEntscheidungInfo) {
  if (e.grund === 'sicherung') return `Sicherung: ${e.sicherung ?? ''}`;
  if (e.grund === 'regel' || !e.q) return 'Lage nie geübt → Regel ohne Q-Werte';
  return e.q.map((x, i) => `${i ? (e.q![i - 1]!.wert > x.wert ? ' > ' : ' = ') : ''}${x.handlung} ${komma(x.wert, 3)}`).join('');
}
const mintKurz = (m: string) => (m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m);
const zeitLang = (ms: number) => new Date(ms).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function MarkerInhalt({ t, kauf }: { t: KryptoRlBeispielTrade; kauf: boolean }) {
  const e = kauf ? t.kauf : t.verkauf;
  return (
    <>
      <b className={kauf ? 'plus' : 'minus'}>
        {kauf ? '▲ Kauf' : `▼ ${t.verkauf ? HANDLUNG[t.verkauf.handlung] : 'Ende der Aufzeichnung'}`} {mintKurz(t.mint)}
      </b>
      <br />
      {zeitLang(kauf ? t.kauf.zeit : t.ende)}
      {!kauf && ` · nach ${Math.round(t.haltSek)} s`}
      {e && (
        <>
          <br />
          {lageText(e)}
          <br />
          <span className="leise">warum: {warumText(e)}</span>
        </>
      )}
      <br />
      <span className={t.gewinnSol >= 0 ? 'plus' : 'minus'}>
        Ergebnis {solVz(t.gewinnSol, 4)} SOL
        <Eur sol={t.gewinnSol} vz />
      </span>
    </>
  );
}

/** e) RL-Zeitraffer – Kapitalkurve über die Testdaten mit Kauf/Verkauf-Markern, Kennzahlen, Beispiel-Trades */
function RlTafel({ rl, lauf }: { rl: KryptoMusterStatus['rl']; lauf: number | null }) {
  const eurJeSol = useEurJeSol();
  const z = rl?.zeitraffer;
  const kurve = rl?.kurve ?? [];
  const start = rl?.startSol ?? 10;
  const kapitalBei = (zeit: number) => {
    let k = start;
    for (const p of kurve) if (p.zeit <= zeit) k = p.kapitalSol;
    return k;
  };
  const marken: ChartMarke[] = (rl?.beispiele ?? []).flatMap((t, i) => [
    { id: `k${i}`, x: t.kauf.zeit, y: kapitalBei(t.kauf.zeit), kauf: true, inhalt: <MarkerInhalt t={t} kauf /> },
    { id: `v${i}`, x: t.ende, y: kapitalBei(t.ende), kauf: false, inhalt: <MarkerInhalt t={t} kauf={false} /> },
  ]);
  return (
    <section className="kw-tafel" aria-label="RL-Zeitraffer" data-testid="muster-rl">
      <div className="kw-chart-kopf">
        <h3>RL-Zeitraffer{rl ? ` · v${rl.version}` : ''}</h3>
        <span className="leise mono mk-klein">gierig auf den Testdaten (nie gesehen) · {komma(rl?.einsatzSol ?? 0.5, 1)} SOL je Kauf · Gebühren wie Paper</span>
      </div>
      {!lauf ? (
        <p className="leise mono">Noch kein Training gespeichert.</p>
      ) : !rl || !z ? (
        <p className="leise mono">Kein RL-Agent in v{lauf} (zu wenig Daten).</p>
      ) : (
        <div className="mk-rl">
          <div style={{ minWidth: 0 }}>
            {kurve.length ? (
              <LinienChart
                serien={[{ id: 'kapital', name: 'Kapital', farbe: SERIEN_FARBEN[6], stufen: true, punkte: [{ x: kurve[0]!.zeit - 1, y: start }, ...kurve.map((p) => ({ x: p.zeit, y: p.kapitalSol }))] }]}
                xText={(x) => uhrzeit(x)}
                xLang={(x) => zeitLang(x)}
                yText={(y) => komma(y, 2)}
                hilfslinie={{ y: start, text: `Start ${komma(start, 2)} SOL` }}
                yMuss={[start]}
                hoehe={260}
                marken={marken}
                label={`Kapital im Zeitraffer: Start ${komma(start, 2)} SOL, Ende ${komma(kurve.at(-1)!.kapitalSol, 2)} SOL, ${z.trades} Trades, ${marken.length / 2} Beispiel-Trades markiert`}
                testid="rl-chart"
                zusatz={(_x, w) =>
                  w[0] ? (
                    <>
                      {eurJeSol != null && <div className="hafen-eur">≈ {eurText(w[0].y * eurJeSol)}</div>}
                      <div className={w[0].y >= start ? 'plus' : 'minus'}>
                        {solVz(w[0].y - start, 3)} SOL seit Start
                        <Eur sol={w[0].y - start} vz />
                      </div>
                    </>
                  ) : null
                }
              />
            ) : (
              <p className="leise mono" data-testid="rl-spaeter">
                Kapitalkurve und Beispiel-Trades gibt es ab dem nächsten Training (v{lauf} ist älter).
              </p>
            )}
            <div className="kw-zahlen mk-zahlen4">
              <div>
                <span>Trades</span>
                <strong>{z.trades.toLocaleString('de-DE')}</strong>
              </div>
              <div>
                <span>Gewinn n. Geb.</span>
                <strong className={z.gewinnSol >= 0 ? 'plus' : 'minus'} data-testid="rl-gewinn">
                  {solVz(z.gewinnSol)}
                  <Eur sol={z.gewinnSol} vz />
                </strong>
              </div>
              <div>
                <span>Treffer</span>
                <strong>{z.trefferquote == null ? '–' : `${Math.round(z.trefferquote * 100)} %`}</strong>
              </div>
              <div title="Kasse leer → Nachschuss (Paper-Spielgeld, zählt nie als Gewinn)">
                <span>Pleiten</span>
                <strong>{z.pleiten}</strong>
              </div>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ marginTop: '0.2rem' }}>Beispiel-Trades</h3>
            {rl.beispiele?.length ? (
              <ul className="kw-eintraege mk-trades" data-testid="rl-trades">
                {rl.beispiele.map((t, i) => (
                  <li key={i}>
                    <span>{uhrzeit(t.kauf.zeit, true)}</span>
                    <span className={`kw-tag ${t.gewinnSol >= 0 ? 'kauf' : 'fehlschlag'}`}>{solVz(t.gewinnSol, 3)}</span>
                    <span>
                      <b style={{ color: 'var(--kw-text)' }}>{mintKurz(t.mint)}</b> KAUFEN · {lageText(t.kauf)} · warum: {warumText(t.kauf)}
                      <br />→ {t.verkauf ? `${HANDLUNG[t.verkauf.handlung]} nach ${Math.round(t.haltSek)} s · ${lageText(t.verkauf)} · warum: ${warumText(t.verkauf)}` : `Ende der Aufzeichnung nach ${Math.round(t.haltSek)} s`}
                      {t.halbVerkaeufe ? ` (vorher ${t.halbVerkaeufe}× halb)` : ''} · Ergebnis {solVz(t.gewinnSol, 4)} SOL
                      <Eur sol={t.gewinnSol} vz />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="leise mono">{kurve.length ? 'Keine Trades im Zeitraffer.' : 'ab dem nächsten Training'}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

