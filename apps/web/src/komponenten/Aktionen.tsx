import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AktionInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { navigieren } from '../router';
import { alleDateien, useBaum } from '../vaultHilfen';
import { stufeText } from '../texte';

/** Aktionen eines Gebäudes als Knöpfe; ein Klick öffnet das Eingabeformular. */
export function Aktionen({ gebaeude }: { gebaeude: string }) {
  const q = useQuery({ queryKey: ['aktionen', gebaeude], queryFn: () => api<AktionInfo[]>(`/api/aktionen?gebaeude=${encodeURIComponent(gebaeude)}`) });
  const [offen, setOffen] = useState<string | null>(null);
  if (q.isPending) return <p className="leise">Lade Aktionen …</p>;
  if (q.isError) return <p className="fehler">{q.error.message}</p>;
  if (!q.data.length)
    return (
      <p className="leise">
        Noch keine Aktionen. Lege eine Markdown-Datei in <code>{gebaeude}/aktionen/</code> an – sie erscheint sofort hier.
      </p>
    );
  return (
    <div className="aktionen">
      <div className="aktions-knoepfe">
        {q.data.map((a) => (
          <button
            key={a.id}
            className={`aktion-knopf${a.fehler ? ' kaputt' : ''}${offen === a.id ? ' aktiv' : ''}`}
            onClick={() => setOffen(offen === a.id ? null : a.id)}
            title={a.fehler ?? a.beschreibung}
          >
            <strong>{a.name}</strong>
            <span className="leise">
              {a.fehler ? 'fehlerhaft' : `${a.motor} · ${stufeText(a.stufe)}${a.werkzeuge.includes('web') ? ' · Web' : ''}${a.fremdinhalte ? ' · Fremdinhalte' : ''}`}
            </span>
          </button>
        ))}
      </div>
      {offen && <AktionStarten key={offen} a={q.data.find((x) => x.id === offen)!} />}
    </div>
  );
}

function AktionStarten({ a }: { a: AktionInfo }) {
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(a.eingaben.map((e) => [e.name, e.typ === 'auswahl' ? (e.optionen?.[0] ?? '') : ''])),
  );
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const baum = useBaum();
  const dateien = useMemo(() => alleDateien(baum.data), [baum.data]);

  if (a.fehler)
    return (
      <div className="karte innen">
        <p className="fehler">{a.fehler}</p>
        <p className="leise">Datei: {a.pfad}</p>
      </div>
    );

  const starten = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaeuft(true);
    setFehler('');
    try {
      const r = await api<{ chatId: string }>('/api/aktionen/starten', { body: { id: a.id, eingaben: werte } });
      navigieren(`/chats/${r.chatId}`);
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
      setLaeuft(false);
    }
  };

  return (
    <form className="karte innen formspalte breit" onSubmit={starten}>
      <h3>{a.name}</h3>
      {a.beschreibung && <p className="leise">{a.beschreibung}</p>}
      {a.eingaben.map((e) => {
        const name = e.beschriftung ?? e.name;
        const setzen = (w: string) => setWerte((alt) => ({ ...alt, [e.name]: w }));
        return (
          <label key={e.name}>
            {name}
            {e.pflicht ? ' *' : ''}
            {e.typ === 'langtext' ? (
              <textarea rows={5} value={werte[e.name]} onChange={(x) => setzen(x.target.value)} required={e.pflicht} />
            ) : e.typ === 'auswahl' ? (
              <select value={werte[e.name]} onChange={(x) => setzen(x.target.value)}>
                {e.optionen?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : e.typ === 'datei' ? (
              <>
                <input list={`dateien-${e.name}`} value={werte[e.name]} onChange={(x) => setzen(x.target.value)} required={e.pflicht} placeholder="Pfad im Vault" />
                <datalist id={`dateien-${e.name}`}>
                  {dateien.slice(0, 2000).map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            ) : (
              <input value={werte[e.name]} onChange={(x) => setzen(x.target.value)} required={e.pflicht} />
            )}
          </label>
        );
      })}
      <p className="leise">
        Motor {a.motor}, Stufe {stufeText(a.stufe)}
        {a.freigabeVorStart ? ' – startet erst nach deiner Freigabe' : ''}
      </p>
      {fehler && <p className="fehler">{fehler}</p>}
      <button type="submit" className="haupt" disabled={laeuft}>
        {laeuft ? 'Starte …' : 'Starten'}
      </button>
    </form>
  );
}
