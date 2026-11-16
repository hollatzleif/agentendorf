import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Aufwand, MotorenKonfig, Stufe, StufenKonfig } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { stufeText } from '../texte';

const AUFWAND: Aufwand[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const VORSCHLAEGE = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'];

export function AgentenEinstellungen() {
  const qc = useQueryClient();
  const k = useQuery({ queryKey: ['agenten-konfig'], queryFn: () => api<{ modelle: StufenKonfig; motoren: MotorenKonfig }>('/api/einstellungen/agenten') });
  const [meldung, setMeldung] = useState('');
  if (!k.data) return <p className="leise">Lade …</p>;
  const neu = () => qc.invalidateQueries({ queryKey: ['agenten-konfig'] });
  const fehler = (e: unknown) => setMeldung(e instanceof ApiFehler ? e.message : String(e));

  return (
    <div className="formspalte breit">
      {k.data.modelle.fehler && <p className="fehler">{k.data.modelle.fehler}</p>}
      {k.data.motoren.fehler && <p className="fehler">{k.data.motoren.fehler}</p>}
      <h3>Modellstufen</h3>
      <datalist id="modelle">
        {VORSCHLAEGE.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {(['klein', 'mittel', 'gross'] as Stufe[]).map((s) => (
        <StufeZeile key={s} stufe={s} wert={k.data.modelle.stufen[s]} beiFehler={fehler} beiOk={() => (setMeldung(`Stufe ${stufeText(s)} gespeichert.`), neu())} />
      ))}
      <h3>Motoren</h3>
      <MotorenForm k={k.data.motoren} beiFehler={fehler} beiOk={() => (setMeldung('Motoren gespeichert.'), neu())} />
      {meldung && <p className="hinweis">{meldung}</p>}
      <p className="leise">
        Gespeichert wird in <code>00_Stadtordnung/modelle.md</code> und <code>motoren.md</code> – du kannst beides auch in Obsidian ändern.
      </p>
    </div>
  );
}

function StufeZeile(p: { stufe: Stufe; wert: { modell: string; aufwand: Aufwand }; beiFehler: (e: unknown) => void; beiOk: () => void }) {
  const [modell, setModell] = useState(p.wert.modell);
  const [aufwand, setAufwand] = useState<Aufwand>(p.wert.aufwand);
  const geaendert = modell !== p.wert.modell || aufwand !== p.wert.aufwand;
  return (
    <div className="formzeile">
      <strong className="stufe-name">{stufeText(p.stufe)}</strong>
      <input list="modelle" value={modell} onChange={(e) => setModell(e.target.value.trim())} aria-label={`Modell ${p.stufe}`} />
      <select value={aufwand} onChange={(e) => setAufwand(e.target.value as Aufwand)} aria-label={`Aufwand ${p.stufe}`}>
        {AUFWAND.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <button disabled={!geaendert} onClick={() => api('/api/einstellungen/stufe', { methode: 'PUT', body: { stufe: p.stufe, modell, aufwand } }).then(p.beiOk, p.beiFehler)}>
        Speichern
      </button>
    </div>
  );
}

function MotorenForm(p: { k: MotorenKonfig; beiFehler: (e: unknown) => void; beiOk: () => void }) {
  const [alleAuf, setAlleAuf] = useState(p.k.alleAuf);
  const [cc, setCc] = useState(p.k.parallel['claude-code']);
  const [apiN, setApiN] = useState(p.k.parallel.api);
  return (
    <div className="formspalte">
      <label>
        Notschalter – alle Aktionen über
        <select value={alleAuf} onChange={(e) => setAlleAuf(e.target.value as MotorenKonfig['alleAuf'])}>
          <option value="keiner">jeweils eigenen Motor (normal)</option>
          <option value="api">api (API-Schlüssel)</option>
          <option value="claude-code">claude-code (Abo)</option>
        </select>
      </label>
      <label>
        Gleichzeitig claude-code
        <input type="number" min={0} max={10} value={cc} onChange={(e) => setCc(Number(e.target.value))} />
      </label>
      <label>
        Gleichzeitig api
        <input type="number" min={0} max={20} value={apiN} onChange={(e) => setApiN(Number(e.target.value))} />
      </label>
      <button onClick={() => api('/api/einstellungen/motoren', { methode: 'PUT', body: { alleAuf, parallel: { 'claude-code': cc, api: apiN } } }).then(p.beiOk, p.beiFehler)}>
        Speichern
      </button>
    </div>
  );
}
