import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoerseUebersicht as Daten, BoerseWert } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const euro = (n?: number) => (n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const prozent = (n?: number) => (n == null ? '' : `${n > 0 ? '+' : ''}${n.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);
const kurs = (w: BoerseWert) => (w.kurs == null ? 'kein Kurs' : `${w.kurs.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${w.waehrung ?? ''}`);

/** Börse (Etappe 7): Depot und Watchlist mit Schlusskursen – gehandelt wird nie */
export function BoerseUebersicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['boerse'], queryFn: () => api<Daten>('/api/boerse') });
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const neu = () => qc.invalidateQueries({ queryKey: ['boerse'] });
  const d = q.data;
  if (!d) return <p className="leise">Lade …</p>;

  const holen = async () => {
    setFehler('');
    setLaeuft(true);
    try {
      const r = await api<{ abgerufen: number; offen: number; fehler?: string }>('/api/boerse/aktualisieren', { body: {} });
      if (r.fehler) setFehler(r.fehler);
      await neu();
    } finally {
      setLaeuft(false);
    }
  };
  const entfernen = async (art: 'positionen' | 'watchlist', index: number) => {
    try {
      await api(`/api/boerse/wert?art=${art}&index=${index}`, { methode: 'DELETE' });
      await neu();
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  return (
    <div className="boerse">
      {!d.eingerichtet && (
        <p className="hinweis">
          Für automatische Kurse fehlt noch der EODHD-Schlüssel (kostenlos auf eodhd.com). Auf dem Server: <code>dorf boerse-schluessel</code>. Bis dahin siehst du Depot und
          Einstand ohne aktuelle Kurse.
        </p>
      )}
      {d.fehler && <p className="fehler">{d.fehler}</p>}
      <div className="bank-kacheln">
        <div className="bank-kachel">
          <span className="leise">Depotwert</span>
          <strong>{euro(d.gesamtEur)}</strong>
        </div>
        <div className="bank-kachel">
          <span className="leise">Eingesetzt</span>
          <strong>{euro(d.einstandEur)}</strong>
        </div>
        <div className="bank-kachel">
          <span className="leise">Gewinn/Verlust</span>
          <strong className={d.gesamtEur >= d.einstandEur ? 'plus' : 'minus'}>
            {d.einstandEur ? `${euro(d.gesamtEur - d.einstandEur)} (${prozent(((d.gesamtEur - d.einstandEur) / d.einstandEur) * 100)})` : '–'}
          </strong>
        </div>
      </div>
      <div className="zeile bank-kopf">
        <button type="button" onClick={() => void holen()} disabled={laeuft || !d.eingerichtet}>
          {laeuft ? 'Hole Kurse …' : '↻ Kurse holen'}
        </button>
        <span className="leise">
          Abrufe heute: {d.abrufeHeute}/{d.abrufeMax} (kostenlose Stufe)
          {d.letzter ? ` · zuletzt ${new Date(d.letzter.zeit).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}${d.letzter.offen ? `, ${d.letzter.offen} Werte folgen morgen` : ''}` : ''}
          {d.dollarJeEuro ? ` · 1 € = ${d.dollarJeEuro.kurs.toLocaleString('de-DE')} $ (EZB ${d.dollarJeEuro.datum})` : ''}
        </span>
      </div>
      {(fehler || d.letzter?.fehler) && <p className="fehler">{fehler || d.letzter?.fehler}</p>}

      <h3>Depot</h3>
      <Tabelle werte={d.positionen} depot entfernen={(i) => void entfernen('positionen', i)} />
      <WertNeu art="positionen" fertig={neu} />
      <h3>Watchlist</h3>
      <Tabelle werte={d.watchlist} entfernen={(i) => void entfernen('watchlist', i)} />
      <WertNeu art="watchlist" fertig={neu} />
      <p className="leise">
        Gehandelt wird nie. Sonntags schreibt ein Agent den{' '}
        <a href={bibliothekUrl('Boerse/00_Wochenbericht.md')} onClick={linkKlick}>
          Wochenbericht
        </a>
        ; alles steht auch in{' '}
        <a href={bibliothekUrl('Boerse/depot.md')} onClick={linkKlick}>
          Boerse/depot.md
        </a>
        .
      </p>
    </div>
  );
}

function Tabelle({ werte, depot, entfernen }: { werte: BoerseWert[]; depot?: boolean; entfernen: (i: number) => void }) {
  if (!werte.length) return <p className="leise">Noch leer.</p>;
  return (
    <table className="tabelle zahlen boerse-tabelle">
      <thead>
        <tr>
          <th>Wert</th>
          <th>Kurs</th>
          <th>Tag</th>
          {depot && <th>Wert €</th>}
          {depot && <th>Gewinn</th>}
          <th />
        </tr>
      </thead>
      <tbody>
        {werte.map((w) => (
          <tr key={`${w.index}-${w.name}`}>
            <td>
              <strong>{w.name}</strong>
              <div className="leise">
                {w.symbol ?? w.isin}
                {depot && w.stueck != null ? ` · ${w.stueck} Stück` : ''}
                {w.datum ? ` · ${w.datum}` : ''}
              </div>
            </td>
            <td>{kurs(w)}</td>
            <td className={(w.veraenderungProzent ?? 0) >= 0 ? 'plus' : 'minus'}>{prozent(w.veraenderungProzent)}</td>
            {depot && <td>{euro(w.wertEur)}</td>}
            {depot && <td className={(w.gewinnEur ?? 0) >= 0 ? 'plus' : 'minus'}>{w.gewinnEur == null ? '–' : `${euro(w.gewinnEur)} (${prozent(w.gewinnProzent)})`}</td>}
            <td>
              <button type="button" className="klein" aria-label={`${w.name} entfernen`} onClick={() => entfernen(w.index)}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WertNeu({ art, fertig }: { art: 'positionen' | 'watchlist'; fertig: () => void }) {
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState('');
  const [kennung, setKennung] = useState('');
  const [boerse, setBoerse] = useState<'XETRA' | 'US'>('XETRA');
  const [stueck, setStueck] = useState('');
  const [einstand, setEinstand] = useState('');
  const [fehler, setFehler] = useState('');
  if (!offen)
    return (
      <button type="button" onClick={() => setOffen(true)}>
        + {art === 'positionen' ? 'Position' : 'Beobachten'}
      </button>
    );
  return (
    <form
      className="karte innen formspalte"
      aria-label={art === 'positionen' ? 'Neue Position' : 'Neuer Watchlist-Wert'}
      onSubmit={async (e) => {
        e.preventDefault();
        setFehler('');
        const k = kennung.trim().toUpperCase();
        const istIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(k);
        try {
          await api('/api/boerse/wert', {
            body: {
              art,
              neu: {
                name: name.trim(),
                ...(istIsin ? { isin: k, boerse } : { symbol: k.includes('.') ? k : `${k}.${boerse}` }),
                ...(art === 'positionen' && stueck ? { stueck: Number(stueck.replace(',', '.')) } : {}),
                ...(art === 'positionen' && einstand ? { einstand: Number(einstand.replace(',', '.')) } : {}),
              },
            },
          });
          setOffen(false);
          setName('');
          setKennung('');
          setStueck('');
          setEinstand('');
          fertig();
        } catch (err) {
          setFehler(err instanceof ApiFehler ? err.message : String(err));
        }
      }}
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="z. B. Vanguard FTSE All-World" />
      </label>
      <div className="zeile">
        <label style={{ flex: 1 }}>
          ISIN oder Kürzel
          <input value={kennung} onChange={(e) => setKennung(e.target.value)} required placeholder="IE00BK5BQT80 oder AAPL" />
        </label>
        <label>
          Börse
          <select value={boerse} onChange={(e) => setBoerse(e.target.value as 'XETRA' | 'US')}>
            <option value="XETRA">Xetra (€)</option>
            <option value="US">USA ($)</option>
          </select>
        </label>
      </div>
      {art === 'positionen' && (
        <div className="zeile">
          <label>
            Stück
            <input value={stueck} onChange={(e) => setStueck(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Einstand je Stück (€)
            <input value={einstand} onChange={(e) => setEinstand(e.target.value)} inputMode="decimal" />
          </label>
        </div>
      )}
      <div className="zeile">
        <button type="submit" className="haupt">
          Hinzufügen
        </button>
        <button type="button" onClick={() => setOffen(false)}>
          Abbrechen
        </button>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
    </form>
  );
}
