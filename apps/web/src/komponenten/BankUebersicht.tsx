import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BankDatei, BankMonat, TodoInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { Em } from '../apple/wissen-teile';

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const monatName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
const tag = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });

/**
 * Bank (Etappe 7): Monatsübersicht aus Kontoauszügen – nur lesen und auswerten, bezahlt wird nie.
 * Auszüge (CSV oder PDF) landen in Bank/auszuege/; das Dorf liest sie von selbst ein.
 */
export function BankUebersicht() {
  const qc = useQueryClient();
  const [monat, setMonat] = useState<string | null>(null);
  const daten = useQuery({ queryKey: ['bank', monat], queryFn: () => api<BankMonat>(`/api/bank/monat${monat ? `?monat=${monat}` : ''}`) });
  const rechnungen = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const [meldung, setMeldung] = useState('');
  const datei = useRef<HTMLInputElement>(null);
  const neu = () => qc.invalidateQueries({ queryKey: ['bank'] });

  const hochladen = async (dateien: FileList) => {
    setMeldung('');
    const f = new FormData();
    for (const x of Array.from(dateien)) f.append('datei', x, x.name);
    try {
      await api('/api/vault/hochladen?ordner=Bank%2Fauszuege', { formular: f });
      const r = await api<{ neu: number }>('/api/bank/einlesen', { body: {} });
      setMeldung(`Hochgeladen – ${r.neu} neue Buchungen. PDFs liest gleich ein Agent ein.`);
      await neu();
    } catch (e) {
      setMeldung(`⚠️ ${e instanceof ApiFehler ? e.message : String(e)}`);
    }
  };

  const d = daten.data;
  const offeneRechnungen = (rechnungen.data ?? []).filter((t) => !t.erledigt && t.gebaeude === 'Bank');
  return (
    <div className="bank">
      <div className="zeile bank-kopf">
        {d && d.monate.length > 0 && (
          <select aria-label="Monat" value={d.monat} onChange={(e) => setMonat(e.target.value)}>
            {d.monate.map((m) => (
              <option key={m} value={m}>
                {monatName(m)}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="haupt" onClick={() => datei.current?.click()}>
          <Em e="📄" /> Kontoauszug hochladen
        </button>
        <input ref={datei} type="file" accept=".csv,.txt,.pdf" multiple hidden onChange={(e) => e.target.files && void hochladen(e.target.files)} />
      </div>
      {meldung && <p className="hinweis">{meldung}</p>}
      {d?.fehler && <p className="fehler">{d.fehler}</p>}
      {d && !d.monate.length && (
        <p className="leise">
          Noch keine Buchungen. Lade den CSV-Export deiner Bank hoch (Online-Banking → Umsätze → Export als CSV) – oder PDF-Kontoauszüge, die liest ein Agent. Nichts davon
          verlässt dein Dorf außer zur Einordnung unbekannter Händler (abschaltbar in Bank/einstellungen.md).
        </p>
      )}
      {d?.dateien.filter((x) => x.status === 'zuordnung').map((x) => <Zuordnen key={x.datei} datei={x} fertig={neu} />)}

      {d && d.monate.length > 0 && (
        <>
          <div className="bank-kacheln bank-wallet">
            <div className="bank-kachel">
              <span className="leise">Einnahmen</span>
              <strong className="plus">{euro(d.einnahmen)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Ausgaben</span>
              <strong>{euro(d.ausgaben)}</strong>
            </div>
            <div className="bank-kachel">
              <span className="leise">Übrig</span>
              <strong className={d.saldo >= 0 ? 'plus' : 'minus'}>{euro(d.saldo)}</strong>
            </div>
          </div>

          <h3>Ausgaben nach Kategorie</h3>
          <ul className="bank-balken">
            {d.kategorien.map((k) => {
              const p = k.budget ? k.betrag / k.budget : null;
              return (
                <li key={k.kategorie}>
                  <span className="bank-kategorie">{k.kategorie}</span>
                  <span className="bank-leiste">
                    <span
                      className={p == null ? '' : p >= 1 ? 'voll' : p >= 0.8 ? 'knapp' : 'gut'}
                      style={{ width: `${Math.min(100, p == null ? (k.betrag / Math.max(1, d.ausgaben)) * 100 : p * 100)}%` }}
                    />
                  </span>
                  <span className="bank-betrag">
                    {euro(k.betrag)}
                    {k.budget ? <span className="leise"> / {euro(k.budget)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="leise">
            Budgets und Sparziele stellst du in{' '}
            <a href={bibliothekUrl('Bank/einstellungen.md')} onClick={linkKlick}>
              Bank/einstellungen.md
            </a>{' '}
            ein.
          </p>
        </>
      )}

      {offeneRechnungen.length > 0 && (
        <>
          <h3>Offene Rechnungen</h3>
          <ul className="chatliste">
            {offeneRechnungen.map((t) => (
              <li key={t.pfad}>
                {t.titel}
                {t.faellig && <span className="abzeichen warnung"> bis {tag(t.faellig)}</span>}{' '}
                <a href="/?g=Marktplatz" onClick={linkKlick} className="leise">
                  abhaken auf dem Marktplatz
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      {d && d.abos.length > 0 && (
        <>
          <h3>Abos und Daueraufträge ({euro(d.abos.reduce((s, a) => s + a.proMonat, 0))} im Monat)</h3>
          <ul className="chatliste">
            {d.abos.map((a) => (
              <li key={a.gegenseite}>
                <strong>{a.gegenseite}</strong> – {euro(a.betrag)} {a.rhythmus} <span className="leise">· zuletzt {tag(a.letzte)}, nächstes etwa {tag(a.naechste)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {d && d.sparziele.length > 0 && (
        <>
          <h3>Sparziele</h3>
          <ul className="bank-balken">
            {d.sparziele.map((s) => (
              <li key={s.name}>
                <span className="bank-kategorie">{s.name}</span>
                <span className="bank-leiste">
                  <span className="gut" style={{ width: `${s.prozent}%` }} />
                </span>
                <span className="bank-betrag">
                  {euro(s.gespart)} <span className="leise">/ {euro(s.ziel)}{s.bis ? ` bis ${s.bis}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {d && d.buchungen.length > 0 && (
        <details>
          <summary>Buchungen im {monatName(d.monat)} ({d.buchungen.length})</summary>
          <table className="tabelle zahlen bank-buchungen">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Wer / wofür</th>
                <th>Kategorie</th>
                <th>Betrag</th>
              </tr>
            </thead>
            <tbody>
              {d.buchungen.map((b) => (
                <tr key={b.id}>
                  <td>{tag(b.datum)}</td>
                  <td>
                    {b.gegenseite || '–'}
                    <div className="leise">{b.zweck.slice(0, 80)}</div>
                  </td>
                  <td>
                    <select
                      aria-label={`Kategorie ${b.gegenseite}`}
                      value={b.kategorie}
                      onChange={(e) =>
                        void api(`/api/bank/buchung/${b.id}`, { methode: 'PATCH', body: { kategorie: e.target.value } })
                          .then(neu)
                          .catch((err) => setMeldung(`⚠️ ${err instanceof ApiFehler ? err.message : String(err)}`))
                      }
                    >
                      {[...new Set([...d.kategorienListe, b.kategorie])].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </td>
                  <td className={b.betrag >= 0 ? 'plus' : ''}>{euro(b.betrag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="leise">Stellst du eine Kategorie um, gilt das für alle Buchungen dieser Gegenseite – auch künftige.</p>
        </details>
      )}

      {d && d.dateien.length > 0 && (
        <details>
          <summary>Eingelesene Auszüge ({d.dateien.length})</summary>
          <ul className="chatliste">
            {d.dateien.map((x) => (
              <li key={x.datei}>
                <code>{x.datei.replace('Bank/auszuege/', '')}</code> – {x.status === 'ok' ? `${x.anzahl} Buchungen` : 'wartet auf Zuordnung'}
                {x.fehler && <span className="leise"> · {x.fehler}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const FELDER: [string, string][] = [
  ['datum', 'Datum *'],
  ['betrag', 'Betrag *'],
  ['gegenseite', 'Wer (Empfänger/Auftraggeber)'],
  ['zweck', 'Verwendungszweck'],
  ['soll', 'Soll (statt Betrag)'],
  ['haben', 'Haben (statt Betrag)'],
];

/** Spalten eines unbekannten Bank-Formats einmal zuordnen – gemerkt für alle Auszüge dieses Formats */
function Zuordnen({ datei, fertig }: { datei: BankDatei; fertig: () => void }) {
  const [z, setZ] = useState<Record<string, number>>({});
  const [fehler, setFehler] = useState('');
  const s = datei.spalten!;
  return (
    <form
      className="karte innen formspalte breit"
      aria-label={`Spalten zuordnen ${datei.datei}`}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('/api/bank/zuordnung', { body: { kennung: s.kennung, zuordnung: z } });
          fertig();
        } catch (err) {
          setFehler(err instanceof ApiFehler ? err.message : String(err));
        }
      }}
    >
      <h3>Welche Spalte ist was? ({datei.datei.replace('Bank/auszuege/', '')})</h3>
      <p className="leise">Dieses Format kennt das Dorf noch nicht. Einmal zuordnen – danach geht es bei jedem Auszug dieser Bank von selbst.</p>
      <table className="tabelle">
        <thead>
          <tr>{s.kopf.map((k, i) => <th key={i}>{k || `Spalte ${i + 1}`}</th>)}</tr>
        </thead>
        <tbody>
          {s.beispiel.map((zeile, j) => (
            <tr key={j}>{s.kopf.map((_, i) => <td key={i}>{zeile[i] ?? ''}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <div className="zeile">
        {FELDER.map(([feld, text]) => (
          <label key={feld}>
            {text}
            <select value={z[feld] ?? ''} onChange={(e) => setZ((alt) => { const n = { ...alt }; if (e.target.value === '') delete n[feld]; else n[feld] = Number(e.target.value); return n; })}>
              <option value="">–</option>
              {s.kopf.map((k, i) => (
                <option key={i} value={i}>
                  {k || `Spalte ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button type="submit" className="haupt">
        Zuordnen und einlesen
      </button>
      {fehler && <p className="fehler">{fehler}</p>}
    </form>
  );
}
