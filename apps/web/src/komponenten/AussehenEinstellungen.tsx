import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ANIMATIONEN,
  DUNKEL_AUTO,
  AUSSEHEN_STANDARD,
  BREITEN,
  DICHTEN,
  FARB_ROLLE_TEXT,
  FARB_ROLLEN,
  FOKUS_RINGE,
  HINTERGRUENDE,
  KNOEPFE,
  RAHMEN,
  SCHATTEN,
  SCHRIFT_TEXT,
  SCHRIFTEN,
  STARTSEITEN,
  TABELLEN,
  TITEL_GEWICHTE,
  VORLAGE_FARBEN,
  VORLAGEN,
  type AussehenT,
  type FarbRolle,
  type Vorlage,
} from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { aussehenAnwenden, aussehenMerken, farbenVon, geraetAussehen, geraetAussehenSetzen, SCHRIFT_STAPEL, wirksam } from '../aussehen';

const VORLAGE_TEXT: Record<Vorlage, string> = {
  spiel: 'Spiel (wie bisher)',
  schlicht: 'Schlicht',
  nacht: 'Nacht',
  mitternacht: 'Mitternacht',
  pastell: 'Pastell',
  wald: 'Wald',
  ozean: 'Ozean',
  abendrot: 'Abendrot',
  papier: 'Papier',
  terminal: 'Terminal',
  kontrast: 'Hoher Kontrast',
};
const TEXTE: Record<string, string> = {
  kompakt: 'Kompakt', normal: 'Normal', luftig: 'Luftig',
  spiel: 'Spiel (3D)', weich: 'Weich', flach: 'Flach', keine: 'Keine',
  dick: 'Dick', duenn: 'Dünn',
  umriss: 'Umriss', pille: 'Pille',
  verlauf: 'Verlauf', einfarbig: 'Einfarbig', punkte: 'Punkte', karo: 'Karo', linien: 'Linien',
  schmal: 'Schmal', breit: 'Breit', voll: 'Ganze Breite',
  an: 'An', reduziert: 'Reduziert', aus: 'Aus',
  schlicht: 'Schlicht', zebra: 'Zebra', gitter: 'Gitter',
  mitlaufend: 'Läuft mit', fest: 'Bleibt oben',
  gelb: 'Gelb', akzent: 'Akzentfarbe',
  fett: 'Fett', extra: 'Extra fett',
  dorf: '3D-Dorf', liste: 'Dorf als Liste', heute: '„Heute“',
  system: 'Wie das Gerät', nachts: 'Nachts (20–7 Uhr)',
};
const AKZENTE = ['#2f8a2b', '#2a78d6', '#6250d6', '#b5548f', '#e34948', '#eb6834', '#d97706', '#0e7490', '#1baf7a', '#111827'];

/** Knopfreihe für eine Auswahl */
function Wahl<T extends string>({ text, werte, wert, setzen, hilfe }: { text: string; werte: readonly T[]; wert: T; setzen: (w: T) => void; hilfe?: string }) {
  return (
    <div className="aussehen-feld" role="group" aria-label={text} title={hilfe}>
      <span>{text}</span>
      <span className="ba-chips">
        {werte.map((w) => (
          <button key={w} type="button" className={`klein${wert === w ? ' an' : ''}`} aria-pressed={wert === w} onClick={() => setzen(w)}>
            {TEXTE[w] ?? w}
          </button>
        ))}
      </span>
    </div>
  );
}
function Regler({ text, wert, min, max, schritt, einheit, setzen }: { text: string; wert: number; min: number; max: number; schritt: number; einheit: string; setzen: (n: number) => void }) {
  return (
    <label className="aussehen-feld">
      <span>
        {text}: <strong>{wert.toLocaleString('de-DE')}{einheit}</strong>
      </span>
      <input type="range" min={min} max={max} step={schritt} value={wert} onChange={(e) => setzen(Number(e.target.value))} aria-label={text} />
    </label>
  );
}

/** E224: Einstellungen → Aussehen – mit Live-Vorschau; gespeichert gilt es auf allen Geräten */
export function AussehenEinstellungen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['aussehen'], queryFn: () => api<AussehenT>('/api/aussehen') });
  const [entwurf, setEntwurf] = useState<AussehenT | null>(null);
  const [meldung, setMeldung] = useState('');
  const [teilen, setTeilen] = useState('');
  const [nurGeraet, setNurGeraet] = useState(() => !!geraetAussehen());
  const gespeichert = useRef<AussehenT | null>(null);
  gespeichert.current = q.data ?? null;
  const basis = (nurGeraet ? geraetAussehen() : null) ?? q.data ?? AUSSEHEN_STANDARD;
  const a = entwurf ?? basis;
  const geaendert = !!entwurf && JSON.stringify(entwurf) !== JSON.stringify(basis);

  // Vorschau sofort; beim Verlassen ohne Speichern zurück zum Gespeicherten
  useEffect(() => {
    if (!entwurf) return;
    document.documentElement.dataset.vorschau = 'ja';
    aussehenAnwenden(entwurf);
  }, [entwurf]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.vorschau;
      const g = geraetAussehen() ?? gespeichert.current;
      if (g) aussehenAnwenden(g);
    },
    [],
  );

  const aendern = (x: Partial<AussehenT>) => {
    setMeldung('');
    setEntwurf({ ...a, ...x });
  };
  const farbe = (r: FarbRolle, f: string | null) => {
    const farben = { ...a.farben };
    if (f) farben[r] = f;
    else delete farben[r];
    aendern({ farben });
  };
  const speichern = async () => {
    if (nurGeraet) {
      geraetAussehenSetzen(a);
      delete document.documentElement.dataset.vorschau;
      aussehenAnwenden(a);
      setEntwurf(null);
      setMeldung('✅ Gespeichert – nur auf diesem Gerät.');
      return;
    }
    try {
      const r = await api<AussehenT>('/api/aussehen', { methode: 'PUT', body: a });
      aussehenMerken(r);
      qc.setQueryData(['aussehen'], r);
      delete document.documentElement.dataset.vorschau;
      aussehenAnwenden(r);
      setEntwurf(null);
      setMeldung('✅ Gespeichert – gilt jetzt auf allen Geräten.');
    } catch (e) {
      setMeldung(`⚠️ ${e instanceof ApiFehler ? e.message : String(e)}`);
    }
  };
  const verwerfen = () => {
    setEntwurf(null);
    delete document.documentElement.dataset.vorschau;
    const g = geraetAussehen() ?? q.data;
    if (g) aussehenAnwenden(g);
  };
  const geraetUmschalten = (an: boolean) => {
    setNurGeraet(an);
    setEntwurf(null);
    delete document.documentElement.dataset.vorschau;
    if (an) {
      geraetAussehenSetzen(q.data ?? AUSSEHEN_STANDARD);
      setMeldung('Dieses Gerät hat jetzt sein eigenes Aussehen (Kopie des gemeinsamen).');
    } else {
      geraetAussehenSetzen(null);
      if (q.data) aussehenAnwenden(q.data);
      setMeldung('Dieses Gerät folgt wieder dem gemeinsamen Aussehen.');
    }
  };
  const w = wirksam(a);
  const f = farbenVon(a);

  return (
    <div className="karte aussehen" id="aussehen">
      <h2>🎨 Aussehen</h2>
      <p className="leise">Alles wirkt sofort als Vorschau. Gespeichert gilt es auf allen deinen Geräten (Handy, PC, Programm) – außer du stellst dieses Gerät extra ein.</p>
      <label className="ba-schalter">
        <input type="checkbox" checked={nurGeraet} onChange={(e) => geraetUmschalten(e.target.checked)} /> Nur auf diesem Gerät anders einstellen (z. B. das Handy dunkel, den PC hell)
      </label>

      <section aria-label="Vorlagen">
        <h3>Vorlage</h3>
        <div className="aussehen-vorlagen">
          {VORLAGEN.map((v) => {
            const p = VORLAGE_FARBEN[v];
            return (
              <button key={v} type="button" className={`aussehen-vorlage${a.vorlage === v ? ' aktiv' : ''}`} aria-pressed={a.vorlage === v} onClick={() => aendern({ ...AUSSEHEN_STANDARD, vorlage: v, css: a.css, startseite: a.startseite, groesse: a.groesse, dunkelAuto: a.dunkelAuto, dunkelVorlage: a.dunkelVorlage })}>
                <span className="aussehen-muster" aria-hidden="true">
                  <span style={{ background: p.kopf }} />
                  <span style={{ background: p.grund }} />
                  <span style={{ background: p.karte }} />
                  <span style={{ background: p.akzent }} />
                </span>
                <strong>{VORLAGE_TEXT[v]}</strong>
              </button>
            );
          })}
        </div>
        <p className="leise">Eine Vorlage setzt Farben und Stil zurück; Schriftgröße, Startseite und eigenes CSS bleiben.</p>
      </section>

      <section aria-label="Farben">
        <h3>Farben</h3>
        <div className="aussehen-feld">
          <span>Akzent schnell</span>
          <span className="ba-chips">
            {AKZENTE.map((x) => (
              <button key={x} type="button" className={`klein${f.akzent === x ? ' an' : ''}`} style={{ background: x, borderColor: x, width: '2rem', height: '1.6rem' }} aria-label={`Akzent ${x}`} onClick={() => farbe('akzent', x)} />
            ))}
          </span>
        </div>
        <div className="aussehen-farben">
          {FARB_ROLLEN.map((r) => (
            <label key={r} className="aussehen-farbe">
              <input type="color" value={f[r]} onChange={(e) => farbe(r, e.target.value)} aria-label={FARB_ROLLE_TEXT[r]} />
              <span>{FARB_ROLLE_TEXT[r]}</span>
              {a.farben[r] && (
                <button type="button" className="klein" title="Farbe der Vorlage" onClick={() => farbe(r, null)}>
                  ↺
                </button>
              )}
            </label>
          ))}
        </div>
      </section>

      <section aria-label="Schrift">
        <h3>Schrift</h3>
        <div className="aussehen-gruppe">
          <label className="aussehen-feld">
            <span>Schriftart</span>
            <select value={a.schrift} onChange={(e) => aendern({ schrift: e.target.value as AussehenT['schrift'] })} aria-label="Schriftart">
              {SCHRIFTEN.map((s) => (
                <option key={s} value={s} style={{ fontFamily: SCHRIFT_STAPEL[s] }}>
                  {SCHRIFT_TEXT[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="aussehen-feld">
            <span>Überschriften</span>
            <select value={a.schriftTitel} onChange={(e) => aendern({ schriftTitel: e.target.value as AussehenT['schriftTitel'] })} aria-label="Schrift der Überschriften">
              <option value="wie-text">wie der Text</option>
              {SCHRIFTEN.map((s) => (
                <option key={s} value={s}>
                  {SCHRIFT_TEXT[s]}
                </option>
              ))}
            </select>
          </label>
          <Regler text="Größe" wert={a.groesse} min={12} max={24} schritt={1} einheit=" px" setzen={(n) => aendern({ groesse: n })} />
          <Regler text="Zeilenabstand" wert={a.zeilenhoehe} min={1.2} max={2} schritt={0.05} einheit="" setzen={(n) => aendern({ zeilenhoehe: n })} />
          <Wahl text="Überschriften-Stärke" werte={TITEL_GEWICHTE} wert={w.titelGewicht} setzen={(x) => aendern({ titelGewicht: x })} />
        </div>
      </section>

      <section aria-label="Form und Stil">
        <h3>Form & Stil</h3>
        <div className="aussehen-gruppe">
          <Regler text="Ecken" wert={w.ecken} min={0} max={28} schritt={1} einheit=" px" setzen={(n) => aendern({ ecken: n })} />
          <Wahl text="Schatten" werte={SCHATTEN} wert={w.schatten} setzen={(x) => aendern({ schatten: x })} />
          <Wahl text="Rahmen" werte={RAHMEN} wert={w.rahmen} setzen={(x) => aendern({ rahmen: x })} />
          <Wahl text="Knöpfe" werte={KNOEPFE} wert={w.knoepfe} setzen={(x) => aendern({ knoepfe: x })} />
          <Wahl text="Hintergrund" werte={HINTERGRUENDE} wert={w.hintergrund} setzen={(x) => aendern({ hintergrund: x })} />
          <Wahl text="Abstände" werte={DICHTEN} wert={w.dichte} setzen={(x) => aendern({ dichte: x })} />
        </div>
      </section>

      <section aria-label="Anzeige">
        <h3>Anzeige</h3>
        <div className="aussehen-gruppe">
          <Wahl text="Startseite" werte={STARTSEITEN} wert={a.startseite} setzen={(x) => aendern({ startseite: x })} />
          <Wahl text="Automatisch dunkel" werte={DUNKEL_AUTO} wert={a.dunkelAuto} setzen={(x) => aendern({ dunkelAuto: x })} hilfe="Dann gilt die dunkle Vorlage – zum Beispiel abends oder wenn dein Handy im Dunkelmodus ist" />
          {a.dunkelAuto !== 'aus' && (
            <label className="aussehen-feld">
              <span>Dunkle Vorlage</span>
              <select value={a.dunkelVorlage} onChange={(e) => aendern({ dunkelVorlage: e.target.value as Vorlage })} aria-label="Dunkle Vorlage">
                {VORLAGEN.filter((v) => VORLAGE_FARBEN[v].dunkel).map((v) => (
                  <option key={v} value={v}>
                    {VORLAGE_TEXT[v]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Wahl text="Seitenbreite" werte={BREITEN} wert={w.breite} setzen={(x) => aendern({ breite: x })} />
          <Wahl text="Tabellen" werte={TABELLEN} wert={w.tabellen} setzen={(x) => aendern({ tabellen: x })} />
          <Wahl text="Kopfleiste" werte={['mitlaufend', 'fest'] as const} wert={w.kopfleiste} setzen={(x) => aendern({ kopfleiste: x })} />
          <Wahl text="Bewegung" werte={ANIMATIONEN} wert={w.animationen} setzen={(x) => aendern({ animationen: x })} />
          <Wahl text="Fokus-Rahmen (Tastatur)" werte={FOKUS_RINGE} wert={w.fokusRing} setzen={(x) => aendern({ fokusRing: x })} />
        </div>
      </section>

      <section aria-label="Vorschau" className="aussehen-vorschau">
        <h3>Vorschau</h3>
        <div className="karte innen">
          <p>
            So sieht Text aus – mit einem <a href="#aussehen">Link</a>, <span className="leise">leisem Text</span>, <span className="plus">+12,3 %</span> und <span className="minus">−4,1 %</span>.
          </p>
          <div className="zeile" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <button type="button" className="haupt">
              Hauptknopf
            </button>
            <button type="button">Knopf</button>
            <button type="button" className="klein">
              Klein
            </button>
            <button type="button" className="gefahr">
              Löschen
            </button>
            <span className="abzeichen">Abzeichen</span>
            <span className="abzeichen warnung">Frist</span>
          </div>
          <input placeholder="Eingabefeld" aria-label="Beispiel-Eingabe" style={{ marginTop: '0.6rem' }} />
          <p className="hinweis" style={{ marginTop: '0.6rem' }}>
            Ein Hinweis.
          </p>
          <table className="tabelle zahlen">
            <thead>
              <tr>
                <th>Wert</th>
                <th>Kurs</th>
                <th>Tag</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vanguard All-World</td>
                <td>123,45</td>
                <td className="plus">+0,8 %</td>
              </tr>
              <tr>
                <td>Apple</td>
                <td>201,10</td>
                <td className="minus">−1,2 %</td>
              </tr>
              <tr>
                <td>Nestlé</td>
                <td>88,00</td>
                <td className="plus">+0,1 %</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details>
        <summary>
          <strong>Eigenes CSS</strong> <span className="leise">– für alles, was es oben nicht gibt</span>
        </summary>
        <textarea
          className="aussehen-css"
          value={a.css}
          onChange={(e) => aendern({ css: e.target.value })}
          placeholder={'/* Beispiel */\n.kopf { background: #222; }\n.todo-titel-text { font-size: 1.1rem; }'}
          aria-label="Eigenes CSS"
          spellCheck={false}
          maxLength={20000}
        />
        <p className="leise">Ohne @import und url(…) – das Dorf lädt nichts von außen nach.</p>
      </details>

      <details>
        <summary>
          <strong>Teilen & sichern</strong>
        </summary>
        <div className="zeile" style={{ flexWrap: 'wrap', gap: '0.5rem', margin: '0.5rem 0' }}>
          <button type="button" className="klein" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(a, null, 2)).then(() => setMeldung('In die Zwischenablage kopiert.'))}>
            Als Text kopieren
          </button>
          <button
            type="button"
            className="klein"
            onClick={() => {
              try {
                aendern({ ...AUSSEHEN_STANDARD, ...(JSON.parse(teilen) as Partial<AussehenT>) });
              } catch {
                setMeldung('⚠️ Das ist kein gültiger Aussehen-Text.');
              }
            }}
            disabled={!teilen.trim()}
          >
            Einfügen übernehmen
          </button>
          <button type="button" className="klein gefahr" onClick={() => aendern({ ...AUSSEHEN_STANDARD })}>
            Alles zurücksetzen
          </button>
        </div>
        <textarea className="aussehen-css" value={teilen} onChange={(e) => setTeilen(e.target.value)} placeholder="Kopiertes Aussehen hier einfügen …" aria-label="Aussehen einfügen" />
      </details>

      {(geaendert || meldung) && (
        <div className="aussehen-leiste" role="status">
          {geaendert && (
            <>
              <button type="button" className="haupt" onClick={() => void speichern()}>
                Speichern
              </button>
              <button type="button" onClick={verwerfen}>
                Verwerfen
              </button>
              <span className="leise">Vorschau – noch nicht gespeichert</span>
            </>
          )}
          {meldung && <span>{meldung}</span>}
        </div>
      )}
    </div>
  );
}
