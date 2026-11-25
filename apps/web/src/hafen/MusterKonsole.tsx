// E238: Trainings-Konsole des Muster-Modells – was das Training gemacht/überlegt hat und WARUM (Daten, Trennzeit, je Modell
// Test und Entscheidung, RL mit Beispiel-Trades und Q-Werten). Während eines Trainings live: alle 1,5 s mit ab= nachladen.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KRYPTO_MUSTER_MODELLE, type KryptoKonsoleZeile, type KryptoMusterKonsole } from '@dorf/shared';
import { ApiFehler, api } from '../api';

type Filter = 'alle' | 'entscheidung' | 'warnung';
const NACHLADEN_MS = 1500;
const PRUEFEN_MS = 5000;

/** +mm:ss.s seit Laufbeginn */
export function konsoleZeit(t: number): string {
  const min = Math.floor(t / 60_000);
  const sek = ((t % 60_000) / 1000).toFixed(1).padStart(4, '0');
  return `+${String(min).padStart(2, '0')}:${sek}`;
}

const bereichName = (b: string) => {
  const m = KRYPTO_MUSTER_MODELLE.find((x) => x.schluessel === b);
  return m ? m.name.replace(/ \(.*$/, '') : b;
};

function zeilenKlasse(z: KryptoKonsoleZeile) {
  if (z.stufe === 'warnung' && z.bereich === 'Dienst' && /^Fehler/.test(z.text)) return 'mk-zeile warnung fehler';
  return `mk-zeile ${z.stufe}`;
}

export function MusterKonsole({ schliessen }: { schliessen: () => void }) {
  /** null = automatisch (laufendes bzw. letztes Training) */
  const [wahl, setWahl] = useState<number | null>(null);
  const [zeilen, setZeilen] = useState<KryptoKonsoleZeile[]>([]);
  const [kopf, setKopf] = useState<Omit<KryptoMusterKonsole, 'zeilen'> | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('alle');
  const [bereich, setBereich] = useState('');
  const [kopiert, setKopiert] = useState<string | null>(null);
  const feld = useRef<HTMLDivElement>(null);
  const unten = useRef(true);

  useEffect(() => {
    let aus = false;
    let zeitgeber: ReturnType<typeof setTimeout> | undefined;
    let geladen: KryptoKonsoleZeile[] = [];
    let version: number | null = wahl;
    setZeilen([]);
    setKopf(null);
    setFehler(null);
    unten.current = true;
    const holen = async () => {
      try {
        const p = new URLSearchParams();
        // automatisch (wahl null): ohne version – so fällt ein neues Training auf (andere version → von vorn)
        if (wahl != null) p.set('version', String(wahl));
        if (geladen.length) p.set('ab', String(geladen.length));
        const k = await api<KryptoMusterKonsole>(`/api/krypto/muster/konsole${p.size ? `?${p}` : ''}`);
        if (aus) return;
        if (k.version !== version || k.gesamt < geladen.length) {
          // anderer Lauf (neues Training) oder kürzer als gedacht: von vorn
          const neu = version !== null && geladen.length > 0;
          version = k.version;
          if (neu || k.gesamt < geladen.length) {
            geladen = [];
            zeitgeber = setTimeout(holen, 0);
            return;
          }
        }
        geladen = geladen.concat(k.zeilen);
        setZeilen(geladen);
        const { zeilen: _z, ...rest } = k;
        setKopf(rest);
        setFehler(null);
        if (k.laeuft) zeitgeber = setTimeout(holen, NACHLADEN_MS);
        else if (wahl == null) zeitgeber = setTimeout(holen, PRUEFEN_MS);
      } catch (e) {
        if (aus) return;
        setFehler(e instanceof ApiFehler ? e.message : String(e));
        zeitgeber = setTimeout(holen, PRUEFEN_MS);
      }
    };
    void holen();
    return () => {
      aus = true;
      if (zeitgeber) clearTimeout(zeitgeber);
    };
  }, [wahl]);

  const bereiche = useMemo(() => [...new Set(zeilen.map((z) => z.bereich))], [zeilen]);
  const sichtbar = useMemo(
    () => zeilen.filter((z) => (filter === 'alle' || z.stufe === filter) && (!bereich || z.bereich === bereich)),
    [zeilen, filter, bereich],
  );

  // automatisch nach unten, solange man unten ist
  useLayoutEffect(() => {
    const f = feld.current;
    if (f && unten.current) f.scrollTop = f.scrollHeight;
  }, [sichtbar]);

  const kopieren = async () => {
    const text = sichtbar.map((z) => `${konsoleZeit(z.t)} [${z.bereich}] ${z.stufe === 'entscheidung' ? '» ' : z.stufe === 'warnung' ? '! ' : ''}${z.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(`${sichtbar.length} Zeilen kopiert.`);
    } catch {
      setKopiert('Kopieren nicht möglich (Browser erlaubt es hier nicht).');
    }
    setTimeout(() => setKopiert(null), 2500);
  };

  const datum = (iso: string) => new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lauf = kopf?.laeufe.find((l) => l.version === kopf.version);

  return (
    <section className="muster-konsole" aria-label="Trainings-Konsole" data-testid="muster-konsole">
      <div className="hafen-kopf">
        <h4 style={{ margin: 0 }}>🖥️ Trainings-Konsole</h4>
        <button type="button" className="klein" onClick={schliessen}>
          Schließen
        </button>
      </div>
      <div className="mk-leiste">
        <label>
          Lauf{' '}
          <select value={wahl ?? ''} onChange={(e) => setWahl(e.target.value ? Number(e.target.value) : null)} data-testid="konsole-lauf">
            <option value="">neuester / laufender</option>
            {kopf?.laeufe.map((l) => (
              <option key={l.version} value={l.version}>
                v{l.version} · {datum(l.erstellt)} · {l.laeuft ? 'läuft …' : l.fehler ? '⚠ fehlgeschlagen' : `aktiv geworden: ${l.aktivGeworden.length ? l.aktivGeworden.map(bereichName).join(', ') : 'keins'}`}
              </option>
            ))}
          </select>
        </label>
        <div className="mk-filter" role="group" aria-label="Filter">
          {(
            [
              ['alle', 'Alle'],
              ['entscheidung', 'Entscheidungen'],
              ['warnung', 'Warnungen'],
            ] as [Filter, string][]
          ).map(([f, text]) => (
            <button key={f} type="button" className={`klein${filter === f ? ' an' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`konsole-filter-${f}`}>
              {text}
            </button>
          ))}
        </div>
        <label>
          Bereich{' '}
          <select value={bereich} onChange={(e) => setBereich(e.target.value)} data-testid="konsole-bereich">
            <option value="">alle</option>
            {bereiche.map((b) => (
              <option key={b} value={b}>
                {bereichName(b)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="klein" onClick={() => void kopieren()} disabled={!sichtbar.length} data-testid="konsole-kopieren">
          📋 Kopieren
        </button>
      </div>
      {kopf && (
        <p className="leise mk-kopf" data-testid="konsole-kopf">
          {kopf.version == null
            ? 'Noch kein Training gelaufen.'
            : `v${kopf.version}${lauf ? ` · ${datum(lauf.erstellt)}` : ''}${kopf.laeuft ? ' · läuft – lädt live nach' : ''}${lauf?.dauerMs != null ? ` · ${Math.round(lauf.dauerMs / 1000)} s` : ''}${lauf?.fehler ? ` · fehlgeschlagen: ${lauf.fehler}` : ''}${lauf && !kopf.laeuft && !lauf.fehler ? ` · aktiv geworden: ${lauf.aktivGeworden.length ? lauf.aktivGeworden.map(bereichName).join(', ') : 'keins'}` : ''} · ${sichtbar.length} von ${kopf.gesamt} Zeilen`}
        </p>
      )}
      {kopiert && (
        <p className="leise" role="status" style={{ margin: 0 }}>
          {kopiert}
        </p>
      )}
      {fehler && <p className="hinweis">Konsole nicht erreichbar: {fehler}</p>}
      <div
        className="mk-feld"
        ref={feld}
        role="log"
        aria-live={kopf?.laeuft ? 'polite' : 'off'}
        data-testid="konsole-zeilen"
        onScroll={(e) => {
          const f = e.currentTarget;
          unten.current = f.scrollHeight - f.scrollTop - f.clientHeight < 30;
        }}
      >
        {!kopf && !fehler && <div className="mk-zeile info">Lade …</div>}
        {kopf && kopf.version != null && !zeilen.length && <div className="mk-zeile info">Für diesen Lauf gibt es keine Konsole (vor E238 trainiert).</div>}
        {sichtbar.map((z, i) => (
          <div key={i} className={zeilenKlasse(z)} data-stufe={z.stufe}>
            <span className="mk-zeit">{konsoleZeit(z.t)}</span>
            <span className="mk-bereich">{bereichName(z.bereich)}</span>
            <span className="mk-text">{z.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
