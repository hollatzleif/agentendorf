import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';
import { Em } from '../apple/wissen-teile';

/** Etappe 7: neues Gebäude anlegen – Ordner + gebaeude.md; das Dorf sucht ihm einen Platz */
export function NeuesGebaeude({ fertig }: { fertig?: (id: string) => void }) {
  const qc = useQueryClient();
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('🏠');
  const [beschreibung, setBeschreibung] = useState('');
  const [fehler, setFehler] = useState('');
  if (!offen)
    return (
      <button type="button" onClick={() => setOffen(true)}>
        <Em e="🏗️" /> Neues Gebäude
      </button>
    );
  return (
    <form
      className="karte innen formspalte neues-gebaeude"
      aria-label="Neues Gebäude"
      onSubmit={async (e) => {
        e.preventDefault();
        setFehler('');
        try {
          const r = await api<{ id: string }>('/api/gebaeude', { body: { name, symbol, beschreibung } });
          await qc.invalidateQueries({ queryKey: ['gebaeude'] });
          await qc.invalidateQueries({ queryKey: ['dorf'] });
          setOffen(false);
          setName('');
          setBeschreibung('');
          fertig?.(r.id);
        } catch (err) {
          setFehler(err instanceof ApiFehler ? err.message : String(err));
        }
      }}
    >
      <div className="zeile">
        <label>
          Symbol
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={8} style={{ width: '5rem' }} />
        </label>
        <label style={{ flex: 1 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required minLength={2} placeholder="z. B. Fitnessstudio" />
        </label>
      </div>
      <label>
        Wofür ist es da?
        <input value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} maxLength={200} placeholder="Ein Satz" />
      </label>
      <div className="zeile">
        <button type="submit" className="haupt">
          Bauen
        </button>
        <button type="button" onClick={() => setOffen(false)}>
          Abbrechen
        </button>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
    </form>
  );
}
