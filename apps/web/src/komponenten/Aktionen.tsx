import { useEffect, useMemo, useState } from 'react';
import { useOrt } from '../router';
import { useQuery } from '@tanstack/react-query';
import type { AktionInfo, AktionQuelle, QuellenOption } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { navigieren } from '../router';
import { alleDateien, useBaum } from '../vaultHilfen';
import { stufeText } from '../texte';
import { NeueAktion } from './NeueAktion';
import { useDesign } from '../apple/design';
import { Symbol } from '../apple/Ikon';
import { Blatt, Chevron, Em } from '../apple/wissen-teile';

/** Aktionen eines Gebäudes als Knöpfe; ein Klick öffnet das Eingabeformular. */
export function Aktionen({ gebaeude }: { gebaeude: string }) {
  const q = useQuery({ queryKey: ['aktionen', gebaeude], queryFn: () => api<AktionInfo[]>(`/api/aktionen?gebaeude=${encodeURIComponent(gebaeude)}`) });
  // ?aktion=Uni/lernen öffnet eine Aktion gleich (Schnellknöpfe im Dorf)
  const { suche } = useOrt();
  const [offen, setOffen] = useState<string | null>(() => suche.get('aktion'));
  const [neu, setNeu] = useState(false);
  const apple = useDesign() === 'apple';
  if (q.isPending) return <p className="leise">Lade Aktionen …</p>;
  if (q.isError) return <p className="fehler">{q.error.message}</p>;
  const neuKnopf = (
    <button
      className={`aktion-knopf neu${neu ? ' aktiv' : ''}`}
      onClick={() => {
        setNeu(!neu);
        setOffen(null);
      }}
    >
      {apple && (
        <span className="aktion-ikon neu" aria-hidden>
          <Symbol name="plus" />
        </span>
      )}
      <strong>+ Neue Aktion</strong>
      <span className="leise">eigener Skill</span>
    </button>
  );
  const neueAktion = neu && (
    <NeueAktion
      gebaeude={gebaeude}
      fertig={(id) => {
        setNeu(false);
        if (id.startsWith(`${gebaeude}/`)) setOffen(id);
      }}
    />
  );
  // Apple: Formulare als Sheet über der Liste (gleiche Komponenten, gleiche Handler)
  const formular =
    neueAktion && apple ? (
      <Blatt titel="Neue Aktion" schliessen={() => setNeu(false)}>
        {neueAktion}
      </Blatt>
    ) : (
      neueAktion
    );
  if (!q.data.length)
    return (
      <div className="aktionen">
        <p className="leise">
          Noch keine Aktionen. Leg hier eine an – oder eine Markdown-Datei in <code>{gebaeude}/aktionen/</code> (Vorlage: <code>00_Stadtordnung/aktion-vorlage.md</code>).
        </p>
        <div className="aktions-knoepfe">{neuKnopf}</div>
        {formular}
      </div>
    );
  return (
    <div className="aktionen">
      <div className="aktions-knoepfe">
        {q.data.map((a) => (
          <button
            key={a.id}
            className={`aktion-knopf${a.fehler ? ' kaputt' : ''}${offen === a.id ? ' aktiv' : ''}`}
            onClick={() => {
              setOffen(offen === a.id ? null : a.id);
              setNeu(false);
            }}
            title={a.fehler ?? a.beschreibung}
          >
            {apple && (
              <span className={`aktion-ikon${a.fehler ? ' kaputt' : ''}`} aria-hidden>
                <Symbol name={a.fehler ? 'warnung' : a.zeitplan ? 'uhr' : 'blitz'} />
              </span>
            )}
            <strong>{a.name}</strong>
            <span className="leise">
              {a.fehler ? 'fehlerhaft' : `${a.motor} · ${stufeText(a.stufe)}${a.werkzeuge.includes('web') ? ' · Web' : ''}${a.fremdinhalte ? ' · Fremdinhalte' : ''}`}
            </span>
            {a.zeitplan && !a.fehler && <span className="leise"><Em e="⏰" /> {a.zeitplan}{a.zeitplanJe ? ` · je ${a.zeitplanJe}` : ''}</span>}
            {apple && <Chevron />}
          </button>
        ))}
        {neuKnopf}
      </div>
      {formular}
      {offen &&
        q.data.some((x) => x.id === offen) &&
        (apple ? (
          <Blatt titel={q.data.find((x) => x.id === offen)!.name} schliessen={() => setOffen(null)}>
            <AktionStarten key={offen} a={q.data.find((x) => x.id === offen)!} />
          </Blatt>
        ) : (
          <AktionStarten key={offen} a={q.data.find((x) => x.id === offen)!} />
        ))}
    </div>
  );
}

/** Auswahl, deren Werte der Server liefert (Kurse, offene Abgaben aus Moodle) */
function QuellenAuswahl({ quelle, wert, setzen }: { quelle: AktionQuelle; wert: string; setzen: (w: string) => void }) {
  const q = useQuery({ queryKey: ['aktion-quellen', quelle], queryFn: () => api<QuellenOption[]>(`/api/aktionen/quelle?name=${quelle}`) });
  const erste = q.data?.[0]?.wert;
  useEffect(() => {
    if (!wert && erste) setzen(erste);
  }, [wert, erste, setzen]);
  if (!q.data) return <span className="leise"> Lade …</span>;
  if (!q.data.length)
    return <span className="leise"> – nichts zur Auswahl{quelle.startsWith('uni.') ? ' (Moodle verbunden und abgeglichen? Uni → Übersicht)' : ''}</span>;
  return (
    <select value={wert} onChange={(x) => setzen(x.target.value)} required>
      {q.data.map((o) => (
        <option key={o.wert} value={o.wert}>
          {o.beschriftung}
        </option>
      ))}
    </select>
  );
}

/** Formular einer Aktion; `vorgabe` füllt Felder vor (E223: Schnellfragen im Börsen-Berater) */
export function AktionStarten({ a, vorgabe }: { a: AktionInfo; vorgabe?: Record<string, string> }) {
  const [werte, setWerte] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(a.eingaben.map((e) => [e.name, e.standard ?? (e.typ === 'auswahl' ? (e.optionen?.[0] ?? '') : '')])),
    ...vorgabe,
  }));
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
            ) : e.quelle ? (
              <QuellenAuswahl quelle={e.quelle} wert={werte[e.name] ?? ''} setzen={setzen} />
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
      {a.zeitplan && (
        <p className="leise">
          <Em e="⏰" /> Läuft von selbst: {a.zeitplan}{a.zeitplanJe ? ` – einmal für jede Auswahl von „${a.zeitplanJe}“` : ''}
          {a.naechsterLauf ? ` – nächstes Mal ${new Date(a.naechsterLauf).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      )}
      {a.ablage && <p className="leise"><Em e="📄" /> Ergebnis landet in {a.ablage} (die vorige Fassung kommt ins Archiv)</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      <button type="submit" className="haupt" disabled={laeuft}>
        {laeuft ? 'Starte …' : 'Starten'}
      </button>
    </form>
  );
}
