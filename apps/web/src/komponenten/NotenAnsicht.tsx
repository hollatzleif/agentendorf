import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotenStand } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * Noten & ECTS (E98): Kennzahlen (Schnitt, ECTS bestanden, Fortschritt zum Ziel) und eine Tabelle zum Pflegen.
 * Gespeichert in Uni/noten.md – auch in Obsidian änderbar.
 */
type Note = NotenStand['faecher'][number]['note'];
const KEY = ['uni', 'noten'];
const NOTEN: [string, string][] = [
  ['', '– offen'],
  ['1', '1 Sehr gut'],
  ['2', '2 Gut'],
  ['3', '3 Befriedigend'],
  ['4', '4 Genügend'],
  ['5', '5 Nicht genügend'],
  ['bestanden', '✓ bestanden (ohne Note)'],
];
const alsNote = (w: string): Note => (w === '' ? null : w === 'bestanden' ? 'bestanden' : Number(w));
const komma = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 2 });

export function NotenAnsicht() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<NotenStand>('/api/uni/noten') });
  const [fehler, setFehler] = useState('');
  const aufruf = async (f: () => Promise<NotenStand>) => {
    setFehler('');
    try {
      qc.setQueryData(KEY, await f());
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  const setzen = (e: NotenStand['faecher'][number]) => aufruf(() => api<NotenStand>('/api/uni/noten', { methode: 'PUT', body: e }));
  const s = q.data;
  const anteil = s?.zielEcts ? Math.min(100, Math.round((s.ectsBestanden / s.zielEcts) * 100)) : null;
  return (
    <section className="noten" aria-label="Noten und ECTS">
      {q.isError && <p className="fehler">{q.error.message}</p>}
      {fehler && <p className="fehler">{fehler}</p>}
      {s && (
        <>
          <div className="statistik-kacheln">
            <div className="statistik-kachel">
              <span className="statistik-kachel-titel">Notenschnitt</span>
              <span className="statistik-kachel-wert">{s.schnitt == null ? '–' : komma(s.schnitt)}</span>
              <span className="statistik-kachel-unter">nach ECTS gewichtet</span>
            </div>
            <div className="statistik-kachel">
              <span className="statistik-kachel-titel">ECTS bestanden</span>
              <span className="statistik-kachel-wert">{komma(s.ectsBestanden)}</span>
              <span className="statistik-kachel-unter">{s.ectsOffen ? `${komma(s.ectsOffen)} noch offen` : 'nichts offen'}</span>
            </div>
            <div className="statistik-kachel">
              <span className="statistik-kachel-titel">Ziel</span>
              <span className="statistik-kachel-wert">{anteil == null ? '–' : `${anteil} %`}</span>
              <label className="statistik-kachel-unter noten-ziel">
                von
                <input
                  type="number"
                  min={0}
                  max={600}
                  defaultValue={s.zielEcts ?? ''}
                  placeholder="180"
                  aria-label="Ziel-ECTS"
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (v !== s.zielEcts) void aufruf(() => api<NotenStand>('/api/uni/noten/ziel', { methode: 'PUT', body: { ects: v } }));
                  }}
                />
                ECTS
              </label>
            </div>
          </div>
          {anteil != null && (
            <div className="wochenziele-balken" aria-hidden>
              <span style={{ width: `${anteil}%` }} />
            </div>
          )}
          <div className="statistik-tabelle">
            <table>
              <thead>
                <tr>
                  <th>Fach</th>
                  <th>ECTS</th>
                  <th>Note</th>
                  <th>Semester</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.faecher.map((f) => (
                  <tr key={f.fach}>
                    <td>{f.fach}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.5}
                        defaultValue={f.ects}
                        className="noten-zahl"
                        aria-label={`ECTS ${f.fach}`}
                        onBlur={(e) => Number(e.target.value) !== f.ects && void setzen({ ...f, ects: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <select value={f.note == null ? '' : String(f.note)} onChange={(e) => void setzen({ ...f, note: alsNote(e.target.value) })} aria-label={`Note ${f.fach}`}>
                        {NOTEN.map(([w, t]) => (
                          <option key={w} value={w}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        defaultValue={f.semester ?? ''}
                        placeholder="WS 2026"
                        maxLength={20}
                        className="noten-semester"
                        aria-label={`Semester ${f.fach}`}
                        onBlur={(e) => e.target.value !== (f.semester ?? '') && void setzen({ ...f, semester: e.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <button type="button" className="klein" aria-label={`${f.fach} entfernen`} onClick={() => void aufruf(() => api<NotenStand>(`/api/uni/noten?fach=${encodeURIComponent(f.fach)}`, { methode: 'DELETE' }))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NeuesFach vorschlaege={s.vorschlaege} anlegen={(fach, ects) => void setzen({ fach, ects, note: null })} />
        </>
      )}
    </section>
  );
}

function NeuesFach({ vorschlaege, anlegen }: { vorschlaege: string[]; anlegen: (fach: string, ects: number) => void }) {
  const [fach, setFach] = useState('');
  const [ects, setEcts] = useState(6);
  return (
    <form
      className="heute-neu noten-neu"
      aria-label="Fach zur Notenliste"
      onSubmit={(e) => {
        e.preventDefault();
        if (!fach.trim()) return;
        anlegen(fach.trim(), ects);
        setFach('');
      }}
    >
      <input value={fach} onChange={(e) => setFach(e.target.value)} list="noten-vorschlaege" placeholder="Fach hinzufügen …" maxLength={100} aria-label="Fach" />
      <datalist id="noten-vorschlaege">
        {vorschlaege.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <input type="number" min={0} max={60} step={0.5} value={ects} onChange={(e) => setEcts(Number(e.target.value))} className="noten-zahl" aria-label="ECTS neu" />
      <button type="submit" className="haupt" aria-label="Fach hinzufügen">
        +
      </button>
    </form>
  );
}
