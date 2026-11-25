import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aufHundert,
  jahresRendite,
  kennzahlen,
  konzentration,
  korrelation,
  monatsRenditen,
  schneiden,
  summieren,
  zeitraumVon,
  ZEITRAEUME,
  ZEITRAUM_TEXT,
  type BoerseAnalyse,
  type Kennzahlen,
  type Punkt,
  type Zeitraum,
} from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { useDesign } from '../apple/design';
import { Em, EmText } from '../hafen/zeichen';
import { AnteilBalken, FARBEN, LinienDiagramm, datumKurz, geldFormat, prozentText, usePrivat, type Reihe } from './teile';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
type Anzeige = 'wert' | 'prozent' | 'index';
type Gruppe = 'position' | 'art' | 'waehrung' | 'depot';

interface Teil {
  schluessel: string;
  /** E226: Wert nachgerechnet (Saxo meldete 0) */
  geschaetzt?: boolean;
  name: string;
  depot: 'Saxo' | 'Eigenes Depot' | 'Watchlist';
  art: string;
  waehrung: string;
  /** Wert jetzt in Kontowährung (Watchlist: null) */
  wert: number | null;
  /** Wertreihe in Kontowährung bzw. Kurs (Watchlist) */
  reihe: Punkt[];
  /** zeitgewichtete Rendite (nur Saxo-Konto) */
  rendite?: Punkt[];
  /** Hinweis zur Herkunft der Reihe */
  quelle: string;
  /** Einstand (Kaufwert) in Kontowährung, wenn bekannt */
  einstandWert?: number;
  gesamt?: boolean;
  nurKurs?: boolean;
}

/** Wertreihe einer Saxo-Position: genaue Tagesstände, davor Kursverlauf × heutige Stück × heutiger Umrechnungsfaktor */
function saxoReihe(a: BoerseAnalyse, symbol: string | undefined, name: string): { reihe: Punkt[]; quelle: string } {
  const s = a.saxo!;
  const genau: Punkt[] = s.tage.map((t) => [t.tag, t.positionen.find((p) => (p.symbol ?? p.name) === (symbol ?? name))?.wert ?? NaN] as Punkt).filter(([, v]) => Number.isFinite(v) && v !== 0);
  const jetzt = s.positionen.find((p) => (p.symbol ?? p.name) === (symbol ?? name));
  const kuerzel = symbol ? a.zuordnung[symbol]?.kuerzel : undefined;
  const h = kuerzel ? a.historien[kuerzel] : undefined;
  if (!h?.punkte.length || !jetzt?.stueck || !jetzt.wert) return { reihe: genau, quelle: genau.length ? 'Tagesstände' : 'noch kein Verlauf' };
  // E226: Faktor gegen den letzten Schlusskurs des Verlaufs (gleiche Währung wie der Verlauf; Saxo schickt nicht immer einen Kurs)
  const faktor = jetzt.wert / (h.punkte.at(-1)![1] * jetzt.stueck);
  const ab = genau[0]?.[0] ?? '9999';
  const davor: Punkt[] = h.punkte.filter(([d]) => d < ab).map(([d, k]) => [d, k * jetzt.stueck! * faktor]);
  return { reihe: [...davor, ...genau], quelle: genau.length ? `Kursverlauf ${kuerzel} (heutige Stückzahl), ab ${datumKurz(ab)} genaue Tagesstände` : `Kursverlauf ${kuerzel} × heutige Stückzahl` };
}

function teileBauen(a: BoerseAnalyse): Teil[] {
  const teile: Teil[] = [];
  const s = a.saxo;
  if (s) {
    const konto: Punkt[] = s.verlauf.map((v) => [v.datum, v.wert]);
    const tageGesamt: Punkt[] = s.tage.filter((t) => t.gesamt != null).map((t) => [t.tag, t.gesamt!]);
    const zusammen = new Map<string, number>(konto);
    for (const [d, v] of tageGesamt) if (!zusammen.has(d)) zusammen.set(d, v);
    const rendite: Punkt[] = s.verlauf.filter((v) => v.rendite != null).map((v) => [v.datum, v.rendite!]);
    teile.push({ schluessel: 'saxo', name: 'Saxo-Konto gesamt', depot: 'Saxo', art: 'Konto', waehrung: s.waehrung, wert: s.gesamt, reihe: [...zusammen.entries()].sort((x, y) => x[0].localeCompare(y[0])), rendite, quelle: 'Saxo-Performance (Kontowert, inkl. Ein-/Auszahlungen)', gesamt: true });
    for (const p of s.positionen) {
      const r = saxoReihe(a, p.symbol, p.name);
      const faktor = p.wert && p.kurs && p.stueck ? p.wert / (p.kurs * p.stueck) : null;
      teile.push({ schluessel: `saxo:${p.symbol ?? p.name}`, name: p.name, ...(p.geschaetzt ? { geschaetzt: true } : {}), depot: 'Saxo', art: p.art ?? 'Sonstiges', waehrung: p.waehrung ?? s.waehrung, wert: p.wert ?? null, reihe: r.reihe, quelle: r.quelle, ...(p.einstand && p.stueck && faktor ? { einstandWert: p.einstand * p.stueck * faktor } : {}) });
    }
    if (s.bar) teile.push({ schluessel: 'saxo:bar', name: 'Bargeld (Saxo)', depot: 'Saxo', art: 'Bargeld', waehrung: s.waehrung, wert: s.bar, reihe: s.tage.length ? [] : [], quelle: 'nur aktueller Stand' });
  }
  const eigene: Teil[] = [];
  for (const w of a.eigen) {
    const h = w.symbol ? a.historien[w.symbol] : undefined;
    const faktor = w.kurs && w.wertEur && w.stueck ? w.wertEur / (w.kurs * w.stueck) : w.waehrung === 'EUR' ? 1 : null;
    const reihe: Punkt[] = h && w.stueck && faktor ? h.punkte.map(([d, k]) => [d, k * w.stueck! * faktor]) : [];
    eigene.push({ schluessel: `eigen:${w.index}`, name: w.name, depot: 'Eigenes Depot', art: w.symbol?.endsWith('.US') ? 'Aktie/ETF (US)' : 'Aktie/ETF', waehrung: w.waehrung ?? 'EUR', wert: w.wertEur ?? null, reihe, quelle: h ? `Kursverlauf ${w.symbol} × ${w.stueck ?? 0} Stück` : 'noch kein Kursverlauf', ...(w.einstand && w.stueck ? { einstandWert: w.einstand * w.stueck } : {}) });
  }
  if (eigene.length) {
    const mit = eigene.filter((e) => e.reihe.length);
    teile.push({ schluessel: 'eigen', name: 'Eigenes Depot gesamt', depot: 'Eigenes Depot', art: 'Konto', waehrung: 'EUR', wert: eigene.reduce((x, e) => x + (e.wert ?? 0), 0), reihe: mit.length ? summieren(mit.map((e) => e.reihe)) : [], quelle: 'Summe der Kursverläufe (heutige Stückzahlen)', gesamt: true });
    teile.push(...eigene);
  }
  for (const w of a.watchlist) {
    const h = w.symbol ? a.historien[w.symbol] : undefined;
    teile.push({ schluessel: `watch:${w.index}`, name: w.name, depot: 'Watchlist', art: 'Watchlist', waehrung: h?.waehrung ?? w.waehrung ?? 'EUR', wert: null, reihe: h?.punkte ?? [], quelle: h ? `Kurs ${w.symbol}` : 'noch kein Kursverlauf', nurKurs: true });
  }
  return teile;
}

function sichtbarLaden(): string[] | null {
  try {
    return JSON.parse(localStorage.getItem('dorf-boerse-sichtbar') ?? 'null') as string[] | null;
  } catch {
    return null;
  }
}

/** E223: Börse → Analyse – alle Zeiträume, jeder Teil einzeln ein- und ausblendbar, Kennzahlen, Allokation, Monate */
export function BoerseAnalyseAnsicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['boerse', 'analyse'], queryFn: () => api<BoerseAnalyse>('/api/boerse/analyse') });
  const [privat, setPrivat] = usePrivat();
  const apple = useDesign() === 'apple';
  const [zeitraum, setZeitraum] = useState<Zeitraum | 'eigen'>(() => (localStorage.getItem('dorf-boerse-zeitraum') as Zeitraum | null) ?? '1J');
  const [eigenVon, setEigenVon] = useState('');
  const [eigenBis, setEigenBis] = useState('');
  const [anzeige, setAnzeige] = useState<Anzeige>(() => (localStorage.getItem('dorf-boerse-anzeige') as Anzeige | null) ?? 'wert');
  const [sichtbarRoh, setSichtbarRoh] = useState<string[] | null>(sichtbarLaden);
  const [summeZeigen, setSummeZeigen] = useState(false);
  const [gruppe, setGruppe] = useState<Gruppe>('position');
  const [sortierung, setSortierung] = useState<'wert' | 'prozent' | 'name' | 'rueckgang'>('wert');
  const [heatmapTeil, setHeatmapTeil] = useState<string>('');
  const [meldung, setMeldung] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const a = q.data;
  const teile = useMemo(() => (a ? teileBauen(a) : []), [a]);
  const von = zeitraum === 'eigen' ? eigenVon || null : zeitraumVon(zeitraum, heute());
  const bis = zeitraum === 'eigen' ? eigenBis || null : null;
  // Kennzahlen aller Teile nur neu rechnen, wenn sich Daten oder Zeitraum ändern (nicht bei jedem Klick)
  const kz = useMemo(() => new Map<string, Kennzahlen | null>(teile.map((t) => [t.schluessel, kennzahlen(schneiden(t.reihe, von, bis), t.rendite ? schneiden(t.rendite, von, bis) : undefined)])), [teile, von, bis]);
  if (q.isLoading) return <p className="leise">Lade …</p>;
  if (q.error) return <p className="fehler">{(q.error as Error).message}</p>;
  if (!a || !teile.length)
    return (
      <p className="hinweis">
        Noch nichts zu analysieren: Verbinde Saxo (Reiter Depot) oder trag Positionen ins eigene Depot ein. Kursverläufe kommen mit dem EODHD-Schlüssel.
      </p>
    );

  const farbeVon = (k: string) => FARBEN[Math.max(0, teile.findIndex((t) => t.schluessel === k)) % FARBEN.length]!;
  const standard = teile.filter((t) => t.gesamt).slice(0, 1).map((t) => t.schluessel);
  const sichtbar = new Set((sichtbarRoh ?? standard).filter((k) => teile.some((t) => t.schluessel === k)));
  const umschalten = (k: string) => {
    const n = new Set(sichtbar);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSichtbarRoh([...n]);
    localStorage.setItem('dorf-boerse-sichtbar', JSON.stringify([...n]));
  };
  const alle = (an: boolean, filter?: (t: Teil) => boolean) => {
    const n = an ? teile.filter((t) => (filter ? filter(t) : true)).map((t) => t.schluessel) : [];
    setSichtbarRoh(n);
    localStorage.setItem('dorf-boerse-sichtbar', JSON.stringify(n));
  };
  /** nur diesen Teil zeigen – Kennzahlen und Diagramm gelten dann ihm */
  const einzeln = (k: string) => {
    setSichtbarRoh([k]);
    localStorage.setItem('dorf-boerse-sichtbar', JSON.stringify([k]));
    document.querySelector('.ba-kacheln')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const zeitraumWaehlen = (z: Zeitraum | 'eigen') => {
    setZeitraum(z);
    if (z !== 'eigen') localStorage.setItem('dorf-boerse-zeitraum', z);
  };
  const anzeigeWaehlen = (x: Anzeige) => {
    setAnzeige(x);
    localStorage.setItem('dorf-boerse-anzeige', x);
  };

  const waehrung = a.saxo?.waehrung ?? 'EUR';
  const geld = geldFormat(privat, waehrung);
  const geld0 = geldFormat(privat, waehrung, 0);
  // Reihen im Zeitraum
  const imZeitraum = (t: Teil) => schneiden(t.reihe, von, bis);
  const sichtbare = teile.filter((t) => sichtbar.has(t.schluessel));
  const nurKurs = sichtbare.some((t) => t.nurKurs);
  const anzeigeJetzt: Anzeige = nurKurs && anzeige === 'wert' ? 'index' : anzeige;
  const reihen: Reihe[] = sichtbare
    .map((t) => {
      const p = imZeitraum(t);
      const twr = t.rendite ? schneiden(t.rendite, von, bis) : null;
      let punkte: Punkt[] = p;
      if (anzeigeJetzt === 'index') punkte = twr && twr.length > 1 ? twr.map(([d, r]) => [d, ((1 + r) / (1 + twr[0]![1])) * 100]) : aufHundert(p);
      if (anzeigeJetzt === 'prozent') punkte = twr && twr.length > 1 ? twr.map(([d, r]) => [d, (1 + r) / (1 + twr[0]![1]) - 1]) : aufHundert(p).map(([d, v]) => [d, v / 100 - 1]);
      return { schluessel: t.schluessel, name: t.name, farbe: farbeVon(t.schluessel), punkte };
    })
    .filter((r) => r.punkte.length > 1);
  const saxoPos = a.saxo?.positionen ?? [];
  const saxoOhneWert = saxoPos.some((p) => !p.wert || p.geschaetzt);
  const kursOffen = saxoPos.some((p) => p.symbol && !a.historien[a.zuordnung[p.symbol]?.kuerzel ?? '']?.punkte.length) || undefined;
  const ohneLinie = sichtbare.filter((t) => !reihen.some((r) => r.schluessel === t.schluessel) && t.schluessel !== 'saxo:bar');
  if (summeZeigen && anzeigeJetzt === 'wert') {
    const teilReihen = sichtbare.filter((t) => !t.gesamt && !t.nurKurs).map(imZeitraum).filter((r) => r.length);
    if (teilReihen.length > 1) reihen.push({ schluessel: 'summe', name: 'Summe der sichtbaren Positionen', farbe: 'var(--text)', punkte: summieren(teilReihen), strich: true });
  }
  const format = anzeigeJetzt === 'wert' ? (n: number) => geld0(n) : anzeigeJetzt === 'index' ? (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : (n: number) => prozentText(n);

  // Kennzahlen-Karte: erster sichtbarer Teil mit Werten
  const fokus = sichtbare.find((t) => kz.get(t.schluessel)) ?? teile.find((t) => kz.get(t.schluessel));
  const k = fokus ? kz.get(fokus.schluessel)! : null;

  // Tabelle aller Teile
  const tabelle = teile
    .filter((t) => !t.gesamt)
    .map((t) => ({ t, k: kz.get(t.schluessel) ?? null }))
    .sort((x, y) =>
      sortierung === 'name' ? x.t.name.localeCompare(y.t.name, 'de') : sortierung === 'prozent' ? (y.k?.prozent ?? -9) - (x.k?.prozent ?? -9) : sortierung === 'rueckgang' ? (x.k?.maxRueckgang?.anteil ?? 0) - (y.k?.maxRueckgang?.anteil ?? 0) : (y.t.wert ?? -1) - (x.t.wert ?? -1),
    );
  const mitWert = teile.filter((t) => !t.gesamt && !t.nurKurs && (t.wert ?? 0) > 0);
  const summeJetzt = mitWert.reduce((s, t) => s + (t.wert ?? 0), 0);

  // Allokation
  const gruppen = new Map<string, number>();
  for (const t of mitWert) {
    const g = gruppe === 'position' ? t.name : gruppe === 'art' ? t.art : gruppe === 'waehrung' ? t.waehrung : t.depot;
    gruppen.set(g, (gruppen.get(g) ?? 0) + (t.wert ?? 0));
  }
  const allok = [...gruppen.entries()].sort((x, y) => y[1] - x[1]);
  const anteile = allok.slice(0, 7).map(([name, wert], i) => ({ name, wert, farbe: FARBEN[i]! }));
  if (allok.length > 7) anteile.push({ name: 'Übrige', wert: allok.slice(7).reduce((s, [, w]) => s + w, 0), farbe: '#9aa8bc' });
  const konz = konzentration(mitWert.map((t) => t.wert ?? 0));

  // Gewinner / Verlierer im Zeitraum
  const bewertet = tabelle.filter((x) => x.k?.prozent != null && !x.t.nurKurs);
  const gewinner = [...bewertet].sort((x, y) => y.k!.prozent! - x.k!.prozent!).slice(0, 3);
  const verlierer = [...bewertet].sort((x, y) => x.k!.prozent! - y.k!.prozent!).slice(0, 3);

  // Monats-Heatmap
  const hmTeil = teile.find((t) => t.schluessel === heatmapTeil) ?? teile.find((t) => t.gesamt) ?? teile[0]!;
  const hmIndex: Punkt[] = hmTeil.rendite?.length ? hmTeil.rendite.map(([d, r]) => [d, 1 + r]) : hmTeil.reihe;
  const monate = monatsRenditen(hmIndex);
  const jahre = Object.keys(monate).map(Number).sort((x, y) => y - x);

  const historieLaden = async (kuerzel?: string[]) => {
    setMeldung('');
    setLaeuft(true);
    try {
      const r = await api<{ geholt: number; offen: number; fehler?: string }>('/api/boerse/historie', { body: kuerzel ? { kuerzel } : {} });
      setMeldung(`${r.geholt} Kursverläufe geladen${r.offen ? `, ${r.offen} offen (Tageslimit – morgen automatisch)` : ''}${r.fehler ? ` · ${r.fehler}` : ''}`);
      await qc.invalidateQueries({ queryKey: ['boerse'] });
    } catch (e) {
      setMeldung(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };
  const kuerzelSetzen = async (saxo: string, kuerzel: string) => {
    try {
      await api('/api/boerse/kuerzel', { methode: 'PUT', body: { saxo, kuerzel } });
      await qc.invalidateQueries({ queryKey: ['boerse', 'analyse'] });
      if (kuerzel) await historieLaden([kuerzel.toUpperCase()]);
    } catch (e) {
      setMeldung(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  return (
    <div className="boerse-analyse">
      <div className="ba-leiste">
        <div className="ba-chips" role="group" aria-label="Zeitraum">
          {ZEITRAEUME.map((z) => (
            <button key={z} type="button" className={`klein${zeitraum === z ? ' an' : ''}`} aria-pressed={zeitraum === z} title={ZEITRAUM_TEXT[z]} onClick={() => zeitraumWaehlen(z)}>
              {z === 'MAX' ? 'Max' : z}
            </button>
          ))}
          <button type="button" className={`klein${zeitraum === 'eigen' ? ' an' : ''}`} aria-pressed={zeitraum === 'eigen'} onClick={() => zeitraumWaehlen('eigen')}>
            Eigener
          </button>
          {zeitraum === 'eigen' && (
            <>
              <input type="date" value={eigenVon} onChange={(e) => setEigenVon(e.target.value)} aria-label="Von" />
              <input type="date" value={eigenBis} onChange={(e) => setEigenBis(e.target.value)} aria-label="Bis" />
            </>
          )}
        </div>
        <div className="ba-chips" role="group" aria-label="Anzeige">
          {(
            [
              ['wert', 'Wert'],
              ['prozent', '%'],
              ['index', 'Index 100'],
            ] as const
          ).map(([x, text]) => (
            <button key={x} type="button" className={`klein${anzeigeJetzt === x ? ' an' : ''}`} aria-pressed={anzeigeJetzt === x} onClick={() => anzeigeWaehlen(x)}>
              {text}
            </button>
          ))}
          <button type="button" className={`klein${privat ? ' an' : ''}`} aria-pressed={privat} title="Beträge verbergen" onClick={() => setPrivat(!privat)}>
            <EmText t={privat ? '🙈 Beträge aus' : '👁 Beträge'} />
          </button>
        </div>
      </div>

      {k && fokus && (
        <div className="bank-kacheln ba-kacheln" aria-label={`Kennzahlen: ${fokus.name}`}>
          <div className="bank-kachel">
            <span className="leise">{fokus.name}</span>
            <strong>{fokus.nurKurs ? k.ende.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : geld(k.ende)}</strong>
          </div>
          <div className="bank-kachel">
            <span className="leise">{zeitraum === 'eigen' ? 'Im Zeitraum' : ZEITRAUM_TEXT[zeitraum]}</span>
            <strong className={(k.prozent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozentText(k.prozent)}</strong>
            {!fokus.nurKurs && <span className="leise">{geld(k.differenz, true)}</span>}
          </div>
          {k.proJahr != null && (
            <div className="bank-kachel">
              <span className="leise">pro Jahr</span>
              <strong className={k.proJahr >= 0 ? 'plus' : 'minus'}>{prozentText(k.proJahr)}</strong>
            </div>
          )}
          <div className="bank-kachel">
            <span className="leise">Größter Rückgang</span>
            <strong className="minus">{prozentText(k.maxRueckgang?.anteil ?? 0)}</strong>
            {k.maxRueckgang && (
              <span className="leise">
                {datumKurz(k.maxRueckgang.von)} → {datumKurz(k.maxRueckgang.bis)}
              </span>
            )}
          </div>
          <div className="bank-kachel">
            <span className="leise">Schwankung p. a.</span>
            <strong>{k.volatilitaet == null ? '–' : prozentText(k.volatilitaet).replace('+', '')}</strong>
            {k.plusTage != null && <span className="leise">{Math.round(k.plusTage * 100)} % Plus-Tage</span>}
          </div>
          <div className="bank-kachel">
            <span className="leise">Hoch / Tief</span>
            <strong>{fokus.nurKurs ? k.hoch.wert.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : geld0(k.hoch.wert)}</strong>
            <span className="leise">{fokus.nurKurs ? k.tief.wert.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : geld0(k.tief.wert)}</span>
          </div>
          {k.besterTag && (
            <div className="bank-kachel">
              <span className="leise">Bester / schlechtester Tag</span>
              <strong className="plus">{prozentText(k.besterTag.anteil)}</strong>
              <span className="leise">
                {datumKurz(k.besterTag.datum)} · <span className="minus">{prozentText(k.schlechtesterTag!.anteil)}</span> {datumKurz(k.schlechtesterTag!.datum)}
              </span>
            </div>
          )}
        </div>
      )}

      <DepotZiel jetzt={(a.saxo?.gesamt ?? 0) + a.eigen.reduce((x, w) => x + (w.wertEur ?? 0), 0)} geld={geld0} />

      <section className="karte innen ba-diagramm" aria-label="Verlauf">
        <LinienDiagramm
          reihen={reihen}
          format={format}
          nullLinie={anzeigeJetzt === 'prozent' ? 0 : anzeigeJetzt === 'index' ? 100 : undefined}
          referenz={anzeigeJetzt === 'wert' && sichtbare.length === 1 && sichtbare[0]!.einstandWert ? { wert: sichtbare[0]!.einstandWert, text: `Einstand ${geld0(sichtbare[0]!.einstandWert)}` } : undefined}
        />
        {nurKurs && anzeige === 'wert' && <p className="leise">Watchlist-Werte haben keinen Depotwert – darum als Index (Start = 100).</p>}
        {ohneLinie.length > 0 && (
          <p className="leise ba-hinweis" role="status">
            Ohne Linie im Zeitraum: {ohneLinie.map((t) => t.name).join(', ')} – {ohneLinie.some((t) => t.depot === 'Saxo') ? 'für Saxo-Positionen braucht es einen Kursverlauf (unten bei „Kursverläufe & Kürzel“ laden) oder mindestens zwei Tagesstände.' : 'noch kein Kursverlauf (unten bei „Kursverläufe & Kürzel“ laden).'}
          </p>
        )}
        {anzeigeJetzt === 'wert' && sichtbare.some((t) => t.gesamt) && sichtbare.some((t) => !t.gesamt && !t.nurKurs) && (
          <p className="leise">
            Tipp: Gesamt und einzelne Positionen liegen in Euro weit auseinander –{' '}
            <button type="button" className="ba-sort ba-link" onClick={() => anzeigeWaehlen('prozent')}>
              in % vergleichen
            </button>
            .
          </p>
        )}
      </section>

      <section className="karte innen" aria-label="Teile des Depots">
        <div className="zeile ba-kopf">
          <h3>Teile ein- und ausblenden</h3>
          <span className="ba-chips">
            <button type="button" className="klein" onClick={() => alle(true, (t) => !t.nurKurs)}>
              Alle Positionen
            </button>
            <button type="button" className="klein" onClick={() => alle(true, (t) => !!t.gesamt)}>
              Nur Gesamt
            </button>
            <button type="button" className="klein" onClick={() => alle(false)}>
              Keine
            </button>
            <label className="ba-schalter">
              <input type="checkbox" checked={summeZeigen} onChange={(e) => setSummeZeigen(e.target.checked)} /> Summe der sichtbaren
            </label>
            <button type="button" className="klein" title="Tabelle für den gewählten Zeitraum als CSV (Excel, Numbers)" onClick={() => csvLaden(teile, kz, zeitraum === 'eigen' ? `${von ?? 'anfang'}_${bis ?? 'heute'}` : zeitraum)}>
              <Em e="⬇" /> CSV
            </button>
          </span>
        </div>
        <div className="tabelle-rahmen">
          <table className="tabelle zahlen ba-tabelle">
            <thead>
              <tr>
                <th />
                <th>
                  <button type="button" className="ba-sort" onClick={() => setSortierung('name')}>
                    Teil {sortierung === 'name' ? '▾' : ''}
                  </button>
                </th>
                <th>
                  <button type="button" className="ba-sort" onClick={() => setSortierung('wert')}>
                    Wert {sortierung === 'wert' ? '▾' : ''}
                  </button>
                </th>
                <th>Anteil</th>
                <th>
                  <button type="button" className="ba-sort" onClick={() => setSortierung('prozent')}>
                    Zeitraum {sortierung === 'prozent' ? '▾' : ''}
                  </button>
                </th>
                <th>€ im Zeitraum</th>
                <th>
                  <button type="button" className="ba-sort" onClick={() => setSortierung('rueckgang')}>
                    Max. Rückgang {sortierung === 'rueckgang' ? '▾' : ''}
                  </button>
                </th>
                <th>Schwankung</th>
              </tr>
            </thead>
            <tbody>
              {teile
                .filter((t) => t.gesamt)
                .map((t) => (
                  <ZeileTeil key={t.schluessel} t={t} k={kz.get(t.schluessel) ?? null} an={sichtbar.has(t.schluessel)} farbe={farbeVon(t.schluessel)} umschalten={umschalten} einzeln={einzeln} geld={geld} summe={summeJetzt} />
                ))}
              {tabelle.map(({ t, k: kk }) => (
                <ZeileTeil key={t.schluessel} t={t} k={kk} an={sichtbar.has(t.schluessel)} farbe={farbeVon(t.schluessel)} umschalten={umschalten} einzeln={einzeln} geld={geld} summe={summeJetzt} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ba-raster">
        <section className="karte innen" aria-label="Aufteilung">
          <div className="zeile ba-kopf">
            <h3>Aufteilung</h3>
            <select value={gruppe} onChange={(e) => setGruppe(e.target.value as Gruppe)} aria-label="Aufteilen nach">
              <option value="position">nach Position</option>
              <option value="art">nach Art</option>
              <option value="waehrung">nach Währung</option>
              <option value="depot">nach Depot</option>
            </select>
          </div>
          <AnteilBalken teile={anteile} format={(n) => geld0(n)} />
          {konz && (
            <p className="leise">
              Größte Position {Math.round(konz.groesste * 100)} % · Top 3 {Math.round(konz.top3 * 100)} % · wirkt wie {konz.effektiv.toLocaleString('de-DE', { maximumFractionDigits: 1 })} gleich große Positionen
              {konz.groesste > 0.3 ? ' – ein Wert trägt viel vom Risiko (Klumpen).' : ''}
            </p>
          )}
        </section>
        <section className="karte innen" aria-label="Gewinner und Verlierer">
          <h3>Gewinner & Verlierer {zeitraum === 'eigen' ? 'im Zeitraum' : `· ${ZEITRAUM_TEXT[zeitraum]}`}</h3>
          {bewertet.length ? (
            <div className="ba-gv">
              <ol aria-label="Am besten">
                <li className="ba-gv-kopf">Am besten</li>
                {gewinner.map(({ t, k: kk }) => (
                  <li key={t.schluessel}>
                    {t.name} <strong className="plus">{prozentText(kk!.prozent)}</strong>
                  </li>
                ))}
              </ol>
              <ol aria-label="Am schwächsten">
                <li className="ba-gv-kopf">Am schwächsten</li>
                {verlierer.map(({ t, k: kk }) => (
                  <li key={t.schluessel}>
                    {t.name} <strong className={(kk!.prozent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozentText(kk!.prozent)}</strong>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="leise">Dafür braucht es Kursverläufe (unten laden).</p>
          )}
        </section>
      </div>

      <section className="karte innen" aria-label="Monatsrenditen">
        <div className="zeile ba-kopf">
          <h3>Monate</h3>
          <select value={hmTeil.schluessel} onChange={(e) => setHeatmapTeil(e.target.value)} aria-label="Monatsrenditen von">
            {teile
              .filter((t) => t.reihe.length > 20)
              .map((t) => (
                <option key={t.schluessel} value={t.schluessel}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        {jahre.length ? (
          <div className="tabelle-rahmen">
            <table className="ba-monate">
              <thead>
                <tr>
                  <th />
                  {['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].map((m) => (
                    <th key={m}>{m}</th>
                  ))}
                  <th>Jahr</th>
                </tr>
              </thead>
              <tbody>
                {jahre.map((j) => (
                  <tr key={j}>
                    <th>{j}</th>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const r = monate[j]![m];
                      return (
                        <td key={m} style={r == null ? undefined : { background: zelle(r, apple) }} title={r == null ? '' : `${m}/${j}: ${prozentText(r)}`}>
                          {r == null ? '' : prozentText(r, 1).replace(' %', '')}
                        </td>
                      );
                    })}
                    <td className={jahresRendite(monate[j]!) >= 0 ? 'plus' : 'minus'}>
                      <strong>{prozentText(jahresRendite(monate[j]!))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="leise">Noch zu wenig Verlauf für Monatswerte.</p>
        )}
      </section>

      <Aehnlichkeit teile={teile.filter((t) => !t.gesamt && t.reihe.length > 20)} von={von} bis={bis} farbeVon={farbeVon} />

      {saxoOhneWert && <SaxoDiagnose a={a} />}

      <details className="karte innen" aria-label="Kursverläufe" open={kursOffen}>
        <summary>
          <strong>Kursverläufe & Kürzel</strong> <span className="leise">· EODHD heute {a.abrufeHeute}/{a.abrufeMax}</span>
        </summary>
        {!a.eodhd && <p className="hinweis">Kursverläufe kommen von EODHD – auf dem Server fehlt der Schlüssel (dorf boerse-schluessel). Saxo-Konto und Tagesstände gehen trotzdem.</p>}
        <p className="leise">
          Ältere Werte je Position rechnet das Dorf aus dem Kursverlauf mal der heutigen Stückzahl (Käufe/Verkäufe davor sind darin nicht enthalten). Seit dem Verbinden mit Saxo nimmt es die genauen Tagesstände. Fehlende Verläufe
          lädt es nebenbei mit, solange das Tageslimit reicht.
        </p>
        <button type="button" onClick={() => void historieLaden()} disabled={laeuft || !a.eodhd}>
          {laeuft ? 'Lade …' : '↻ Fehlende Kursverläufe jetzt laden'}
        </button>
        {meldung && <p className="hinweis">{meldung}</p>}
        <ul className="ba-kuerzel">
          {(a.saxo?.positionen ?? [])
            .filter((p) => p.symbol)
            .map((p) => (
              <KuerzelZeile key={p.symbol} name={p.name} saxo={p.symbol!} z={a.zuordnung[p.symbol!]} punkte={a.historien[a.zuordnung[p.symbol!]?.kuerzel ?? '']?.punkte.length ?? 0} setzen={kuerzelSetzen} />
            ))}
          {teile
            .filter((t) => t.depot !== 'Saxo')
            .map((t) => (
              <li key={t.schluessel}>
                <strong>{t.name}</strong> <span className="leise">{t.quelle}</span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

/** 🎯 Depot-Ziel: wie weit, und wann es mit Sparrate und angenommener Rendite erreicht wäre (Gerät merkt es sich) */
function DepotZiel({ jetzt, geld }: { jetzt: number; geld: (n: number | null | undefined, v?: boolean) => string }) {
  const [z, setZ] = useState<{ betrag: string; bis: string; monatlich: string; rendite: string }>(() => ({ betrag: '', bis: '', monatlich: '200', rendite: '5', ...(JSON.parse(localStorage.getItem('dorf-boerse-ziel') ?? '{}') as object) }));
  const setzen = (k: keyof typeof z, v: string) => {
    const n = { ...z, [k]: v };
    setZ(n);
    localStorage.setItem('dorf-boerse-ziel', JSON.stringify(n));
  };
  const zahl = (t: string) => Number(t.replace(/\./g, '').replace(',', '.')) || 0;
  const ziel = zahl(z.betrag);
  const anteil = ziel > 0 ? Math.min(1, jetzt / ziel) : 0;
  // Monate bis zum Ziel mit Sparrate und Rendite (höchstens 60 Jahre)
  const r = (1 + zahl(z.rendite) / 100) ** (1 / 12) - 1;
  let w = jetzt;
  let m = 0;
  while (ziel > 0 && w < ziel && m < 720) {
    w = w * (1 + r) + zahl(z.monatlich);
    m++;
  }
  const erreicht = new Date();
  erreicht.setMonth(erreicht.getMonth() + m);
  const bisMonate = z.bis ? Math.max(0, Math.round((Date.parse(z.bis) - Date.now()) / (30.44 * 86_400_000))) : null;
  let noetig: number | null = null;
  if (bisMonate && ziel > jetzt) {
    const auf = (1 + r) ** bisMonate;
    const rest = ziel - jetzt * auf;
    noetig = rest <= 0 ? 0 : r ? (rest * r) / (auf - 1) : rest / bisMonate;
  }
  return (
    <details className="karte innen ba-ziel" open={ziel > 0}>
      <summary>
        <strong>
          <EmText t="🎯 Depot-Ziel" />
        </strong>
        {ziel > 0 && (
          <span className="leise">
            {' '}
            · {Math.round(anteil * 100)} % von {geld(ziel)}
          </span>
        )}
      </summary>
      <div className="rechner-felder">
        <label className="rechner-feld">
          <span>Ziel (€)</span>
          <input inputMode="decimal" value={z.betrag} onChange={(e) => setzen('betrag', e.target.value)} placeholder="z. B. 50.000" aria-label="Zielbetrag" />
        </label>
        <label className="rechner-feld">
          <span>Bis (optional)</span>
          <input type="date" value={z.bis} onChange={(e) => setzen('bis', e.target.value)} aria-label="Ziel bis" />
        </label>
        <label className="rechner-feld">
          <span>Sparrate / Monat</span>
          <input inputMode="decimal" value={z.monatlich} onChange={(e) => setzen('monatlich', e.target.value)} aria-label="Sparrate" />
        </label>
        <label className="rechner-feld">
          <span>Rendite p. a. (%)</span>
          <input inputMode="decimal" value={z.rendite} onChange={(e) => setzen('rendite', e.target.value)} aria-label="Angenommene Rendite" />
        </label>
      </div>
      {ziel > 0 && (
        <>
          <div className="ba-ziel-balken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(anteil * 100)} aria-label="Fortschritt zum Ziel">
            <span style={{ width: `${anteil * 100}%` }} />
          </div>
          <p className="leise">
            Jetzt {geld(jetzt)} – {jetzt >= ziel ? 'Ziel erreicht! 🎉' : m >= 720 ? 'mit diesen Annahmen nicht in 60 Jahren erreichbar.' : `mit ${geld(zahl(z.monatlich))} im Monat und ${z.rendite} % Rendite voraussichtlich ${erreicht.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })}.`}
            {noetig != null && noetig > 0 ? ` Für ${new Date(z.bis).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })} bräuchte es ${geld(noetig)} im Monat.` : ''}
          </p>
        </>
      )}
    </details>
  );
}

/** Wie ähnlich laufen die Werte? Korrelation der Tagesrenditen im gewählten Zeitraum (höchstens 8 Werte) */
function Aehnlichkeit({ teile, von, bis, farbeVon }: { teile: Teil[]; von: string | null; bis: string | null; farbeVon: (k: string) => string }) {
  const apple = useDesign() === 'apple';
  const liste = teile.slice(0, 8);
  const matrix = useMemo(() => liste.map((a) => liste.map((b) => (a === b ? 1 : korrelation(schneiden(a.reihe, von, bis), schneiden(b.reihe, von, bis))))), [liste, von, bis]);
  if (liste.length < 2) return null;
  const paare: { a: string; b: string; r: number }[] = [];
  liste.forEach((a, i) => liste.forEach((b, j) => j > i && matrix[i]![j] != null && paare.push({ a: a.name, b: b.name, r: matrix[i]![j]! })));
  const aehnlichste = [...paare].sort((x, y) => y.r - x.r)[0];
  return (
    <section className="karte innen" aria-label="Wie ähnlich laufen deine Werte">
      <h3>Wie ähnlich laufen deine Werte?</h3>
      <p className="leise">
        1 = bewegen sich gleich, 0 = unabhängig, −1 = gegenläufig (Tagesrenditen im Zeitraum). Viele hohe Werte heißt: Die Streuung schützt weniger, als die Zahl der Positionen vermuten lässt.
        {aehnlichste && aehnlichste.r > 0.8 ? ` Am ähnlichsten: ${aehnlichste.a} und ${aehnlichste.b} (${aehnlichste.r.toFixed(2).replace('.', ',')}).` : ''}
      </p>
      <div className="tabelle-rahmen">
        <table className="ba-korrelation">
          <thead>
            <tr>
              <th />
              {liste.map((t) => (
                <th key={t.schluessel} title={t.name}>
                  <span className="diagramm-punkt" style={{ background: farbeVon(t.schluessel) }} /> {t.name.split(/\s+/)[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liste.map((a, i) => (
              <tr key={a.schluessel}>
                <th>{a.name}</th>
                {liste.map((b, j) => {
                  const r = matrix[i]![j];
                  return (
                    <td key={b.schluessel} style={r == null || i === j ? undefined : { background: apple ? `color-mix(in srgb, var(--a-blau) ${Math.round(Math.max(0, r) * 60)}%, transparent)` : `rgba(42, 120, 214, ${Math.max(0, r) * 0.6})` }} title={r == null ? 'zu wenig gemeinsame Tage' : `${a.name} ↔ ${b.name}: ${r.toFixed(2)}`}>
                      {i === j ? '·' : r == null ? '–' : r.toFixed(2).replace('.', ',')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Rot/Grün mit Stärke nach Betrag (±10 % = voll) – die Zahl steht immer daneben */
function zelle(r: number, apple = false) {
  const s = Math.min(1, Math.abs(r) / 0.1);
  // E240: Apple – Systemgrün/-rot, getönt
  if (apple) return `color-mix(in srgb, var(${r >= 0 ? '--a-gruen' : '--a-rot'}) ${Math.round((0.12 + s * 0.5) * 100)}%, transparent)`;
  return r >= 0 ? `rgba(31, 138, 43, ${0.12 + s * 0.5})` : `rgba(210, 53, 42, ${0.12 + s * 0.5})`;
}

/** Tabelle als CSV (Semikolon, deutsches Komma – öffnet so in Excel) */
function csvLaden(teile: Teil[], kz: Map<string, Kennzahlen | null>, name: string) {
  const z = (n: number | null | undefined, f = 2) => (n == null || !Number.isFinite(n) ? '' : n.toFixed(f).replace('.', ','));
  const zeilen = [['Teil', 'Depot', 'Art', 'Währung', 'Wert jetzt', 'Start', 'Ende', 'Änderung', 'Änderung %', 'pro Jahr %', 'Max. Rückgang %', 'Schwankung p. a. %', 'Von', 'Bis'].join(';')];
  for (const t of teile) {
    const k = kz.get(t.schluessel);
    zeilen.push([`"${t.name.replace(/"/g, '""')}"`, t.depot, t.art, t.waehrung, z(t.wert), z(k?.start), z(k?.ende), z(k?.differenz), z(k?.prozent != null ? k.prozent * 100 : null), z(k?.proJahr != null ? k.proJahr * 100 : null), z(k?.maxRueckgang ? k.maxRueckgang.anteil * 100 : null), z(k?.volatilitaet != null ? k.volatilitaet * 100 : null), k?.von ?? '', k?.bis ?? ''].join(';'));
  }
  const url = URL.createObjectURL(new Blob(['\ufeff' + zeilen.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const l = document.createElement('a');
  l.href = url;
  l.download = `boerse-analyse-${name}.csv`;
  l.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function ZeileTeil({ t, k, an, farbe, umschalten, einzeln, geld, summe }: { t: Teil; k: Kennzahlen | null; an: boolean; farbe: string; umschalten: (k: string) => void; einzeln: (k: string) => void; geld: (n: number | null | undefined, v?: boolean) => string; summe: number }) {
  return (
    <tr className={`${t.gesamt ? 'ba-gesamt' : ''}${an ? '' : ' ba-aus'}`}>
      <td>
        <label className="ba-auge" title={an ? 'Ausblenden' : 'Einblenden'}>
          <input type="checkbox" checked={an} onChange={() => umschalten(t.schluessel)} aria-label={`${t.name} im Diagramm`} />
          <span className="diagramm-punkt" style={{ background: an ? farbe : 'transparent', borderColor: farbe }} />
        </label>
      </td>
      <td>
        <button type="button" className="ba-sort" title="Nur diesen Teil ansehen" onClick={() => einzeln(t.schluessel)}>
          {t.name}
        </button>
        <div className="leise">
          {t.depot}
          {t.art && t.art !== 'Konto' ? ` · ${t.art}` : ''} · {t.waehrung}
          {t.reihe.length ? '' : ' · ohne Verlauf'}
        </div>
      </td>
      <td title={t.geschaetzt ? 'Saxo meldet hier keinen Marktwert – aus Stück × Kurs nachgerechnet' : undefined}>{t.nurKurs ? '' : !t.wert && !t.gesamt ? '–' : `${t.geschaetzt ? '≈ ' : ''}${geld(t.wert)}`}</td>
      <td>{!t.nurKurs && !t.gesamt && summe && t.wert ? `${((t.wert / summe) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : ''}</td>
      <td className={(k?.prozent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozentText(k?.prozent)}</td>
      <td className={(k?.differenz ?? 0) >= 0 ? 'plus' : 'minus'}>{t.nurKurs || !k ? '' : geld(k.differenz, true)}</td>
      <td className="minus">{k?.maxRueckgang ? prozentText(k.maxRueckgang.anteil) : '–'}</td>
      <td>{k?.volatilitaet == null ? '–' : `${(k.volatilitaet * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %`}</td>
    </tr>
  );
}

/** E226: Was Saxo je Position wirklich schickt – damit sich sehen lässt, warum Kurs/Wert fehlen */
function SaxoDiagnose({ a }: { a: BoerseAnalyse }) {
  const roh = a.saxo?.roh ?? [];
  const fehlen = (a.saxo?.positionen ?? []).filter((p) => !p.wert);
  const geschaetzt = (a.saxo?.positionen ?? []).filter((p) => p.wert && p.geschaetzt);
  return (
    <details className="karte innen" aria-label="Saxo-Diagnose">
      <summary>
        <strong>Warum fehlen Saxo-Werte?</strong>{' '}
        <span className="leise">
          · {fehlen.length ? `${fehlen.length} ohne Wert` : ''}
          {fehlen.length > 0 && geschaetzt.length > 0 ? ', ' : ''}
          {geschaetzt.length ? `${geschaetzt.length} nachgerechnet (≈)` : ''}
        </span>
      </summary>
      <p className="leise">
        Saxo schickt für diese Positionen keinen Marktwert (oft auch keinen Kurs) – meist, weil dem API-Zugang die Kursdaten fehlen. Das Dorf rechnet dann mit dem letzten
        Schlusskurs von EODHD × Stückzahl (dafür braucht es den Kursverlauf unten) oder verteilt den Kontowert anteilig. Unten steht, was Saxo wirklich liefert.
      </p>
      {geschaetzt.length > 0 && (
        <ul className="leise">
          {geschaetzt.map((p) => (
            <li key={p.symbol ?? p.name}>
              {p.name}: {p.kursQuelle ?? 'anteilig aus Kontowert − Bargeld'}
            </li>
          ))}
        </ul>
      )}
      {roh.length ? (
        <div className="tabelle-rahmen">
          {roh.map((r) => (
            <details key={r.name} className="ba-roh">
              <summary>{r.name}</summary>
              <code>
                {Object.entries(r.felder)
                  .map(([k, v]) => `${k.replace(/^NetPosition/, '')} = ${v}`)
                  .join('\n')}
              </code>
            </details>
          ))}
        </div>
      ) : (
        <p className="leise">Rohdaten kommen mit dem nächsten Abruf von Saxo (alle 30 Minuten).</p>
      )}
    </details>
  );
}

function KuerzelZeile({ name, saxo, z, punkte, setzen }: { name: string; saxo: string; z?: { kuerzel: string; eigen: boolean; fehler?: string }; punkte: number; setzen: (saxo: string, k: string) => Promise<void> }) {
  const [wert, setWert] = useState(z?.eigen ? z.kuerzel : '');
  return (
    <li>
      <strong>{name}</strong> <span className="leise">Saxo {saxo} → </span>
      <form
        className="ba-kuerzel-form"
        onSubmit={(e) => {
          e.preventDefault();
          void setzen(saxo, wert);
        }}
      >
        <input value={wert} onChange={(e) => setWert(e.target.value)} placeholder={z?.kuerzel ?? 'Kürzel wie NESN.SW'} aria-label={`EODHD-Kürzel für ${name}`} maxLength={30} />
        <button type="submit" className="klein">
          {wert ? 'Setzen' : 'Automatisch'}
        </button>
      </form>
      <span className="leise">{punkte ? `${punkte} Kurse` : 'noch kein Verlauf'}</span>
      {!punkte && z?.fehler && <span className="minus ba-fehler">EODHD: {z.fehler} – Kürzel prüfen (z. B. auf eodhd.com suchen)</span>}
    </li>
  );
}
