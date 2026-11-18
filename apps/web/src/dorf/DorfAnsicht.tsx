import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEKO_ARTEN, DEKO_NAMEN, WETTER_TEXT, type DorfAntwort, type DorfFigur, type DorfLayout, type DorfStatus, type Gebaeude, type MorgenzeitungUebersicht, type SchreibtischAufgabe } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick, navigieren, useOrt } from '../router';
import { GebaeudeInhalt, standardReiter } from '../seiten/Gebaeude';
import { DorfSzene, type KameraStand, type SzeneTreffer } from './szene';
import { BauSteuerung, type Auswahl, type Werkzeug } from './bauen';
import { GebaeudeKnoepfe } from './Knoepfe';
import { useLiveEreignis, useLiveText } from '../live';
import { DorfTicker } from './Ticker';
import { Neuigkeiten } from './Neuigkeiten';

const KAMERA_SCHLUESSEL = 'dorf-kamera';
const ZEITUNG_GELESEN = 'dorf-zeitung-gelesen';
const handy = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const reduziert = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function dauer(ab?: string) {
  if (!ab) return '–';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(ab)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
const zahl = (n: number) => n.toLocaleString('de-AT');
const STATUS_TEXT: Record<string, string> = { laeuft: 'arbeitet', wartend: 'wartet in der Schlange', wartet_freigabe: 'wartet auf deine Freigabe' };

export default function DorfAnsicht({ zurListe }: { zurListe: () => void }) {
  const qc = useQueryClient();
  const { suche } = useOrt();
  const gewaehlt = suche.get('g');
  const reiter = suche.get('reiter') ?? (gewaehlt ? standardReiter(gewaehlt) : '');
  const gebaeude = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const dorf = useQuery({ queryKey: ['dorf'], queryFn: () => api<DorfAntwort>('/api/dorf') });
  const status = useQuery({ queryKey: ['dorf-status'], queryFn: () => api<DorfStatus>('/api/dorf/status'), refetchInterval: 60_000 });

  // Morgenzeitung: roter Punkt am Zeitungs-Knopf, bis die neueste Ausgabe einmal geöffnet wurde (je Gerät)
  const zeitung = useQuery({ queryKey: ['morgenzeitung'], queryFn: () => api<MorgenzeitungUebersicht>('/api/morgenzeitung') });
  const [gelesen, setGelesen] = useState(() => localStorage.getItem(ZEITUNG_GELESEN) ?? '');
  const neueste = zeitung.data?.aktuell?.pfad ?? '';
  useEffect(() => {
    if (gewaehlt === 'Rathaus' && reiter === 'morgenzeitung' && neueste && neueste !== gelesen) {
      localStorage.setItem(ZEITUNG_GELESEN, neueste);
      setGelesen(neueste);
    }
  }, [gewaehlt, reiter, neueste, gelesen]);
  const zeitungNeu = !!neueste && neueste !== gelesen;

  const [wetterOffen, setWetterOffen] = useState(false);
  const buehne = useRef<HTMLDivElement>(null);
  const szene = useRef<DorfSzene | null>(null);
  const [figur, setFigur] = useState<string | null>(null); // laufId oder 'buergermeister'
  // Was die Agenten gerade tun (letztes Werkzeug je Lauf) – kommt live über den WebSocket
  const [gerade, setGerade] = useState<Record<string, string>>({});
  useLiveEreignis((e) => {
    if (e.typ === 'lauf.werkzeug') setGerade((g) => ({ ...g, [e.laufId]: `${WERKZEUG_TEXT[e.name] ?? e.name}${e.kurz ? `: ${e.kurz}` : ''}${e.erlaubt ? '' : ' (verweigert)'}` }));
  });
  const [, tick] = useState(0);

  // ---- Bau-Modus ----
  const [bauen, setBauen] = useState(false);
  const [entwurf, setEntwurf] = useState<DorfLayout | null>(null);
  const entwurfRef = useRef<DorfLayout | null>(null);
  const versionRef = useRef(0);
  const [rueck, setRueck] = useState<DorfLayout[]>([]);
  const [werkzeug, setWerkzeugState] = useState<Werkzeug>({ art: 'auswahl' });
  const [auswahl, setAuswahl] = useState<Auswahl>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const steuerung = useRef<BauSteuerung | null>(null);
  const speicherKette = useRef<Promise<void>>(Promise.resolve());

  const layout = entwurf ?? dorf.data?.layout ?? null;
  useEffect(() => {
    if (dorf.data && !entwurfRef.current) versionRef.current = dorf.data.version;
  }, [dorf.data]);

  // Szene anlegen (einmal)
  useEffect(() => {
    if (!buehne.current) return;
    let kamera: KameraStand | null = null;
    try {
      kamera = JSON.parse(sessionStorage.getItem(KAMERA_SCHLUESSEL) ?? 'null');
    } catch {
      kamera = null;
    }
    const s = new DorfSzene(buehne.current, {
      reduziert: reduziert(),
      handy: handy(),
      kamera,
      onKlick: (t: SzeneTreffer) => klickRef.current(t),
    });
    szene.current = s;
    (window as unknown as { __dorf?: DorfSzene }).__dorf = s;
    return () => {
      sessionStorage.setItem(KAMERA_SCHLUESSEL, JSON.stringify(s.kameraStand()));
      s.entsorgen();
      szene.current = null;
    };
  }, []);

  // Angetipptes Gebäude (Spiel-Auswahl mit runden Knöpfen); ein offenes Menü (?g=) zählt auch als Auswahl
  const [angetippt, setAngetippt] = useState<string | null>(gewaehlt);
  useEffect(() => {
    if (gewaehlt) setAngetippt(gewaehlt);
  }, [gewaehlt]);
  useEffect(() => {
    szene.current?.waehlen(bauen ? null : angetippt);
  }, [angetippt, bauen, layout]);

  const klickRef = useRef<(t: SzeneTreffer) => void>(() => undefined);
  klickRef.current = (t) => {
    if (bauen) return;
    if (t.art === 'gebaeude') {
      setFigur(null);
      if (gewaehlt) navigieren('/');
      setAngetippt(t.id);
    } else if (t.art === 'figur' || t.art === 'buergermeister') {
      setAngetippt(null);
      if (gewaehlt) navigieren('/');
      setFigur(t.art === 'figur' ? t.laufId : 'buergermeister');
    } else {
      setFigur(null);
      setAngetippt(null);
    }
  };

  // Daten → Szene
  useEffect(() => {
    if (szene.current && layout && gebaeude.data) szene.current.setzen({ gebaeude: gebaeude.data, layout, status: status.data });
  }, [layout, gebaeude.data, status.data]);

  // Laufzeit in der Figurenkarte mitzählen
  useEffect(() => {
    if (!figur) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [figur]);

  // ---- Bau-Modus: Speichern mit Versionsprüfung ----
  const speichern = useCallback(
    (l: DorfLayout) => {
      speicherKette.current = speicherKette.current.then(async () => {
        setSpeichert(true);
        try {
          const r = await api<DorfAntwort>('/api/dorf/layout', { methode: 'PUT', body: { basisVersion: versionRef.current, layout: l } });
          versionRef.current = r.version;
          qc.setQueryData(['dorf'], r);
        } catch (e) {
          if (e instanceof ApiFehler && e.status === 409) {
            const d = e.daten as unknown as DorfAntwort;
            versionRef.current = d.version;
            entwurfRef.current = d.layout;
            setEntwurf(d.layout);
            setRueck([]);
            qc.setQueryData(['dorf'], d);
            setHinweis('Auf einem anderen Gerät wurde gleichzeitig gebaut – ich habe den neuen Stand geladen.');
          } else {
            setHinweis(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
            void qc.invalidateQueries({ queryKey: ['dorf'] });
          }
        } finally {
          setSpeichert(false);
        }
      });
    },
    [qc],
  );

  const gespeichertRef = useRef<DorfLayout | null>(null);
  const aendern = useCallback(
    (l: DorfLayout, vorlaeufig?: boolean) => {
      entwurfRef.current = l;
      setEntwurf(l);
      if (vorlaeufig) return;
      const vorher = gespeichertRef.current;
      if (vorher) setRueck((r) => [...r.slice(-49), vorher]);
      gespeichertRef.current = l;
      speichern(l);
    },
    [speichern],
  );

  // Von anderen Geräten geänderter Stand während des Bauens: übernehmen, wenn wir nicht gerade speichern
  useEffect(() => {
    if (!bauen || !dorf.data || speichert) return;
    if (dorf.data.version > versionRef.current) {
      versionRef.current = dorf.data.version;
      entwurfRef.current = dorf.data.layout;
      gespeichertRef.current = dorf.data.layout;
      setEntwurf(dorf.data.layout);
    }
  }, [dorf.data, bauen, speichert]);

  const bauModus = (an: boolean) => {
    const s = szene.current;
    if (!s) return;
    if (an && dorf.data) {
      setFigur(null);
      if (gewaehlt) navigieren('/', true);
      versionRef.current = dorf.data.version;
      entwurfRef.current = dorf.data.layout;
      gespeichertRef.current = dorf.data.layout;
      setEntwurf(dorf.data.layout);
      setRueck([]);
      const st = new BauSteuerung(s, {
        layout: () => entwurfRef.current!,
        aendern,
        auswahlGeaendert: setAuswahl,
        hinweis: setHinweis,
      });
      steuerung.current = st;
      s.bau = st;
      s.rasterZeigen(true);
      setWerkzeugState({ art: 'auswahl' });
    } else {
      s.bau = null;
      s.rasterZeigen(false);
      s.markieren([], null);
      steuerung.current = null;
      setAuswahl(null);
      void speicherKette.current.then(() => {
        entwurfRef.current = null;
        setEntwurf(null);
      });
    }
    setBauen(an);
    setHinweis(null);
  };

  const werkzeugWaehlen = (w: Werkzeug) => {
    steuerung.current?.setzeWerkzeug(w);
    setWerkzeugState(w);
    if (w.art === 'platzieren') setHinweis('Tippe auf die linke obere Ecke des neuen Grundstücks (4 × 4 Felder).');
    else setHinweis(null);
  };

  const rueckgaengig = () => {
    const vorher = rueck[rueck.length - 1];
    if (!vorher) return;
    setRueck((r) => r.slice(0, -1));
    entwurfRef.current = vorher;
    gespeichertRef.current = vorher;
    setEntwurf(vorher);
    steuerung.current?.waehlen(null);
    speichern(vorher);
  };

  // ---- Anzeige ----
  const gName = (id: string) => gebaeude.data?.find((g) => g.id === id)?.name ?? id;
  const gNameStabil = useCallback((id: string) => gebaeude.data?.find((g) => g.id === id)?.name ?? id, [gebaeude.data]);
  const figurDaten: DorfFigur | null =
    figur === 'buergermeister'
      ? (status.data?.figuren.find((f) => f.buergermeister && f.status === 'laeuft') ?? status.data?.figuren.find((f) => f.buergermeister) ?? null)
      : (status.data?.figuren.find((f) => f.laufId === figur) ?? null);
  const lager = layout?.lager.filter((id) => gebaeude.data?.some((g) => g.id === id)) ?? [];
  const fehler = dorf.error ?? gebaeude.error;

  const abbrechen = async (f: DorfFigur) => {
    if (!confirm(`Lauf „${f.titel}“ wirklich abbrechen?`)) return;
    try {
      await api(`/api/laeufe/${encodeURIComponent(f.laufId)}/abbrechen`, { methode: 'POST' });
      void qc.invalidateQueries({ queryKey: ['dorf-status'] });
    } catch (e) {
      setHinweis(e instanceof Error ? e.message : 'Abbrechen fehlgeschlagen.');
    }
  };

  const panelOffen = !!gewaehlt && !bauen;
  const feiern = useCallback((id: string) => szene.current?.feiern(id), []);
  const knopf = useMemo(
    () => (titel: string, inhalt: React.ReactNode, f: () => void, extra = '') => (
      <button className={`dorf-knopf ${extra}`} onClick={f} title={titel} aria-label={titel}>
        {inhalt}
      </button>
    ),
    [],
  );

  return (
    <div className="dorf-buehne" data-bauen={bauen ? 'ja' : 'nein'}>
      <div ref={buehne} className="dorf-leinwand" data-testid="dorf-leinwand" />
      {(dorf.isPending || gebaeude.isPending) && <div className="dorf-laden">Das Dorf wird aufgebaut …</div>}
      {fehler && <div className="dorf-laden fehler">{fehler.message}</div>}

      {!bauen && (
        <DorfTicker
          status={status.data}
          name={gNameStabil}
          feiern={feiern}
          zeigen={(z) => {
            if (!z || !szene.current) return;
            if (z.art === 'figur') szene.current.blickAufFigur(z.id, 16);
            else {
              const p = layout?.gebaeude[z.id];
              if (p) szene.current.blickAuf(p.x + 2, p.z + 2, 22);
              setAngetippt(z.id);
            }
          }}
        />
      )}
      <div className="dorf-werkzeuge oben-rechts">
        {!bauen && status.data?.wetter && (
          <button className="dorf-wetter" onClick={() => setWetterOffen((x) => !x)} aria-expanded={wetterOffen} aria-label={`Wetter in Linz: ${WETTER_TEXT[status.data.wetter.art].text}, ${Math.round(status.data.wetter.temperatur)} Grad`}>
            {WETTER_TEXT[status.data.wetter.art].symbol} {Math.round(status.data.wetter.temperatur)}°
          </button>
        )}
        {!bauen &&
          knopf(
            zeitungNeu ? 'Morgenzeitung (neue Ausgabe)' : 'Morgenzeitung',
            <>
              📰{zeitungNeu && <span className="dorf-punkt" aria-hidden="true" />}
            </>,
            () => navigieren('/?g=Rathaus&reiter=morgenzeitung'),
          )}
        {!bauen && knopf('Als Liste anzeigen', '☰ Liste', zurListe, 'text')}
        {knopf(bauen ? 'Bau-Modus beenden' : 'Bauen', bauen ? '✓ Fertig' : '🔨 Bauen', () => bauModus(!bauen), `text ${bauen ? 'haupt' : ''}`)}
      </div>
      {wetterOffen && status.data?.wetter && !bauen && (
        <div className="dorf-wetterkarte" role="dialog" aria-label="Wetter in Linz">
          <strong>
            {WETTER_TEXT[status.data.wetter.tag.art].symbol} Linz heute: {WETTER_TEXT[status.data.wetter.tag.art].text}
          </strong>
          <span>
            {status.data.wetter.tag.min}–{status.data.wetter.tag.max} °C{status.data.wetter.tag.regen != null ? ` · Regen ${status.data.wetter.tag.regen} %` : ''}
          </span>
          <span className="leise">
            Jetzt {String(status.data.wetter.temperatur).replace('.', ',')} °C, {WETTER_TEXT[status.data.wetter.art].text}
            {status.data.wetter.tag.regen != null && status.data.wetter.tag.regen >= 60 ? ' – Schirm mitnehmen!' : ''}
          </span>
        </div>
      )}
      {!bauen && !panelOffen && <Neuigkeiten />}
      <div className="dorf-werkzeuge unten-rechts">
        {knopf('Nach links drehen', '⟲', () => szene.current?.drehen(-1))}
        {knopf('Nach rechts drehen', '⟳', () => szene.current?.drehen(1))}
        {knopf('Hineinzoomen', '+', () => szene.current?.zoomen(0.8), 'nur-desktop')}
        {knopf('Herauszoomen', '−', () => szene.current?.zoomen(1.25), 'nur-desktop')}
        {knopf('Zum Rathaus', '⌂', () => szene.current?.zentrieren())}
      </div>

      {figurDaten || figur === 'buergermeister' ? (
        <div className="dorf-karte figur-karte" role="dialog" aria-label="Figur">
          <button className="schliessen" onClick={() => setFigur(null)} aria-label="Schließen">
            ×
          </button>
          {figur === 'buergermeister' && <h3>🎩 Bürgermeister</h3>}
          {figurDaten ? (
            <>
              {figur !== 'buergermeister' && (
                <h3>
                  {figurDaten.motor === 'api' ? '🔵' : '🟠'} {figurDaten.ausloeser === 'buergermeister' ? 'Helfer des Bürgermeisters' : 'Agent'} in {gName(figurDaten.gebaeude)}
                </h3>
              )}
              <p className="figur-titel">{figurDaten.titel}</p>
              <p className="figur-auftrag">{figurDaten.auftrag}</p>
              <GeradeZeile laufId={figurDaten.laufId} gerade={gerade[figurDaten.laufId]} />
              <dl>
                <dt>Status</dt>
                <dd>{STATUS_TEXT[figurDaten.status] ?? figurDaten.status}</dd>
                <dt>Motor</dt>
                <dd>{figurDaten.motor}</dd>
                <dt>Modell</dt>
                <dd>
                  {figurDaten.modell} <span className="leise">({figurDaten.stufe})</span>
                </dd>
                <dt>Token</dt>
                <dd>{zahl(figurDaten.token)}</dd>
                <dt>Laufzeit</dt>
                <dd>{dauer(figurDaten.start ?? figurDaten.erstellt)}</dd>
              </dl>
              <div className="zeile">
                <a className="knopf" href={`/chats/${encodeURIComponent(figurDaten.chatId)}`} onClick={linkKlick}>
                  Zum Chat
                </a>
                <button className="gefahr" onClick={() => void abbrechen(figurDaten)}>
                  Abbrechen
                </button>
              </div>
            </>
          ) : (
            <BuergermeisterRuht />
          )}
        </div>
      ) : figur ? (
        <div className="dorf-karte figur-karte">
          <button className="schliessen" onClick={() => setFigur(null)} aria-label="Schließen">
            ×
          </button>
          <p>Dieser Agent ist gerade fertig geworden.</p>
        </div>
      ) : null}

      {!panelOffen && !bauen && angetippt && gebaeude.data?.find((g) => g.id === angetippt) && layout?.gebaeude[angetippt] && (
        <GebaeudeKnoepfe
          g={gebaeude.data.find((g) => g.id === angetippt)!}
          status={status.data?.gebaeude[angetippt]}
          freigaben={status.data?.gebaeude[angetippt]?.freigaben ?? 0}
          figuren={status.data?.figuren.filter((f) => f.gebaeude === angetippt).length ?? 0}
          oeffnen={(k) => navigieren(`/?g=${encodeURIComponent(angetippt)}&reiter=${k}`)}
          bauen={() => {
            const id = angetippt;
            bauModus(true);
            setTimeout(() => steuerung.current?.waehlen({ art: 'gebaeude', id }), 0);
          }}
          schliessen={() => setAngetippt(null)}
        />
      )}
      {panelOffen && (
        <aside className="dorf-panel" aria-label={`Gebäude ${gName(gewaehlt)}`}>
          <div className="dorf-panel-kopf">
            <a className="knopf klein" href={`/gebaeude/${encodeURIComponent(gewaehlt)}${reiter ? `?reiter=${reiter}` : ''}`} onClick={linkKlick}>
              Ganze Seite ↗
            </a>
            <button className="schliessen" onClick={() => navigieren('/')} aria-label="Menü schließen">
              ×
            </button>
          </div>
          <div className="dorf-panel-inhalt">
            <GebaeudeInhalt id={gewaehlt} reiter={reiter} kompakt reiterWaehlen={(k) => navigieren(`/?g=${encodeURIComponent(gewaehlt)}&reiter=${k}`, true)} />
          </div>
        </aside>
      )}

      {bauen && (
        <div className="bau-leiste" role="toolbar" aria-label="Bau-Werkzeuge">
          <div className="bau-gruppe">
            {(
              [
                [{ art: 'auswahl' }, '👆 Auswählen'],
                [{ art: 'strasse' }, '🛣️ Straße'],
                [{ art: 'wasser' }, '💧 Wasser'],
                [{ art: 'abreissen' }, '🧹 Abreißen'],
              ] as [Werkzeug, string][]
            ).map(([w, t]) => (
              <button key={w.art} className={werkzeug.art === w.art ? 'aktiv' : ''} onClick={() => werkzeugWaehlen(w)}>
                {t}
              </button>
            ))}
          </div>
          <div className="bau-gruppe deko-reihe" role="group" aria-label="Deko setzen">
            {DEKO_ARTEN.map((d) => (
              <button
                key={d}
                className={`deko-knopf ${werkzeug.art === 'deko' && werkzeug.deko === d ? 'aktiv' : ''}`}
                onClick={() => werkzeugWaehlen({ art: 'deko', deko: d })}
                title={DEKO_NAMEN[d]}
                aria-label={DEKO_NAMEN[d]}
              >
                <span aria-hidden>{DEKO_SYMBOL[d]}</span>
              </button>
            ))}
          </div>
          {auswahl && (
            <div className="bau-gruppe">
              <span className="bau-auswahl">{auswahl.art === 'gebaeude' ? gName(auswahl.id) : DEKO_NAMEN[layout?.deko[auswahl.index]?.art ?? 'baum']}</span>
              <button onClick={() => steuerung.current?.drehen()}>⟳ Drehen</button>
              <button onClick={() => steuerung.current?.entfernen()}>{auswahl.art === 'gebaeude' ? '📦 Ins Lager' : '🗑️ Entfernen'}</button>
            </div>
          )}
          {lager.length > 0 && (
            <div className="bau-gruppe">
              <span className="leise">Lager:</span>
              {lager.map((id) => (
                <button key={id} className={werkzeug.art === 'platzieren' && werkzeug.id === id ? 'aktiv' : ''} onClick={() => werkzeugWaehlen({ art: 'platzieren', id })}>
                  📦 {gName(id)}
                </button>
              ))}
            </div>
          )}
          <div className="bau-gruppe">
            <button onClick={rueckgaengig} disabled={!rueck.length}>
              ↶ Rückgängig
            </button>
            <span className="leise bau-stand">{speichert ? 'speichert …' : 'gespeichert'}</span>
          </div>
          {hinweis && (
            <p className="bau-hinweis" role="status">
              {hinweis}
            </p>
          )}
          {!hinweis && werkzeug.art === 'auswahl' && !auswahl && <p className="bau-hinweis leise">Gebäude oder Deko antippen und ziehen zum Verschieben. Straßen und Wasser malst du mit gedrückter Maus bzw. dem Finger.</p>}
        </div>
      )}
      {!bauen && hinweis && (
        <p className="dorf-hinweis" role="status" onClick={() => setHinweis(null)}>
          {hinweis}
        </p>
      )}
    </div>
  );
}

const DEKO_SYMBOL: Record<(typeof DEKO_ARTEN)[number], string> = {
  baum: '🌳',
  tanne: '🌲',
  busch: '🌿',
  blumen: '🌷',
  laterne: '🏮',
  bank: '🪑',
  brunnen: '⛲',
  felsen: '🪨',
  hecke: '🟩',
};

const WERKZEUG_TEXT: Record<string, string> = {
  vault_lesen: '📖 liest',
  vault_liste: '📂 schaut nach',
  vault_suchen: '🔎 sucht',
  vault_schreiben: '✍️ schreibt',
  freigabe_beantragen: '✉️ bittet um Freigabe',
  helfer_starten: '🧭 schickt einen Helfer los',
  plan_vorlegen: '📋 legt einen Plan vor',
  aktionen_liste: '📋 schaut sich die Aktionen an',
  rechenraum_befehl: '🧮 rechnet',
  rechenraum_schreiben: '🧮 schreibt im Rechenraum',
  rechenraum_ablegen: '📄 legt ein PDF ab',
  rechenraum_seite_ansehen: '👀 prüft eine Seite',
  rechenraum_vault_kopieren: '🧮 holt eine Datei',
  post_lesen: '📬 liest eine Mail',
  post_entwurf: '📝 entwirft eine Antwort',
  moodle_oeffnen: '🌐 öffnet Moodle',
  moodle_klicken: '🌐 klickt in Moodle',
  moodle_seite: '🌐 liest in Moodle',
  moodle_zurueck: '🌐 geht zurück',
  moodle_bild: '🌐 schaut genau hin',
  moodle_herunterladen: '⬇️ lädt herunter',
};

/** „Gerade:“ – letztes Werkzeug und die letzten Worte der laufenden Antwort */
function GeradeZeile({ laufId, gerade }: { laufId: string; gerade?: string }) {
  const text = useLiveText(laufId);
  const ende = text.trim().split(/\s+/).slice(-18).join(' ');
  if (!gerade && !ende) return null;
  return (
    <div className="figur-gerade">
      {gerade && <p>Gerade: {gerade}</p>}
      {ende && <p className="leise">… {ende}</p>}
    </div>
  );
}

const uhrzeit = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

/** Karte des ruhenden Bürgermeisters: wann er zuletzt wach war, was dabei herauskam, wann er wieder aufwacht */
function BuergermeisterRuht() {
  const auf = useQuery({
    queryKey: ['aufwachen'],
    queryFn: () => api<{ naechste: string | null; anlaesse: string[]; verbrauchHeute: number; tagesbudget: number; eigeneAufgaben: boolean }>('/api/aufwachen'),
  });
  const tisch = useQuery({ queryKey: ['schreibtisch'], queryFn: () => api<SchreibtischAufgabe[]>('/api/schreibtisch') });
  const letzte = tisch.data?.find((a) => a.quelle === 'aufwachen');
  return (
    <>
      <p>Ruht gerade. Er ist rund um die Uhr im Dienst: jede Stunde schaut er nach, ob es Neues gibt, alle paar Stunden geht er seine Runde durchs Dorf.</p>
      <dl>
        {letzte && (
          <>
            <dt>Zuletzt wach</dt>
            <dd>
              {uhrzeit.format(new Date(letzte.erstellt))} – {letzte.titel}
            </dd>
          </>
        )}
        {auf.data?.naechste && (
          <>
            <dt>Nächste Runde</dt>
            <dd>{uhrzeit.format(new Date(auf.data.naechste))}</dd>
          </>
        )}
        {auf.data && (
          <>
            <dt>Budget heute</dt>
            <dd>
              {auf.data.verbrauchHeute.toLocaleString('de-AT', { style: 'currency', currency: 'USD' })} von{' '}
              {auf.data.tagesbudget.toLocaleString('de-AT', { style: 'currency', currency: 'USD' })}
            </dd>
          </>
        )}
      </dl>
      <div className="zeile">
        {letzte?.chatId && (
          <a className="knopf" href={`/chats/${encodeURIComponent(letzte.chatId)}`} onClick={linkKlick}>
            Letzte Runde
          </a>
        )}
        <a className="knopf" href="/?g=Rathaus&reiter=schreibtisch" onClick={linkKlick}>
          Zum Schreibtisch
        </a>
      </div>
    </>
  );
}
