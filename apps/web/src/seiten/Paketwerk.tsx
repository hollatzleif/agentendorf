// E230: Paketwerk – Python-Pakete für den Rechenraum installieren (eigener Container mit Internet, pip --user in einen
// eigenen Paketordner; der Rechenraum sieht ihn nur lesend). Nur Leif führt hier aus – Agenten schlagen Befehle nur vor.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFehler, api } from '../api';
import { useOrt } from '../router';

interface PaketwerkStand {
  eingerichtet: boolean;
  pakete: { name: string; version: string }[];
  fehler?: string;
}
interface KonsolenStand {
  ausgabe: string;
  bis: number;
  fertig: boolean;
  code: number | null;
  sekunden: number;
}

const VERLAUF_SCHLUESSEL = 'dorf-paketwerk-verlauf';

function verlaufLaden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(VERLAUF_SCHLUESSEL) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function PaketwerkSeite() {
  const qc = useQueryClient();
  const { suche } = useOrt();
  const vorschlag = suche.get('befehl');
  const q = useQuery({ queryKey: ['paketwerk'], queryFn: () => api<PaketwerkStand>('/api/paketwerk') });
  const [eingabe, setEingabe] = useState(vorschlag ?? '');
  const [vomAgenten, setVomAgenten] = useState(!!vorschlag);
  const [ausgabe, setAusgabe] = useState('');
  const [job, setJob] = useState<{ id: string; bis: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<string[]>(verlaufLaden);
  const [verlaufPos, setVerlaufPos] = useState(-1);
  const ausgabeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (vorschlag) {
      setEingabe(vorschlag);
      setVomAgenten(true);
    }
  }, [vorschlag]);

  // Ausgabe abholen, bis der Befehl fertig ist
  useEffect(() => {
    if (!job) return;
    let aus = false;
    let ab = job.bis;
    const holen = async () => {
      try {
        const s = await api<KonsolenStand>(`/api/paketwerk/stand?id=${encodeURIComponent(job.id)}&ab=${ab}`);
        if (aus) return;
        ab = s.bis;
        if (s.ausgabe) setAusgabe((a) => a + s.ausgabe);
        if (s.fertig) {
          setStatus(`fertig mit Code ${s.code ?? '?'} (${Math.round(s.sekunden)} s)`);
          setJob(null);
          void qc.invalidateQueries({ queryKey: ['paketwerk'] });
          return;
        }
        setStatus(`läuft … ${Math.round(s.sekunden)} s`);
      } catch (e) {
        if (aus) return;
        setFehler(e instanceof ApiFehler ? e.message : String(e));
        setJob(null);
        return;
      }
      zeitgeber = setTimeout(() => void holen(), 700);
    };
    let zeitgeber = setTimeout(() => void holen(), 700);
    return () => {
      aus = true;
      clearTimeout(zeitgeber);
    };
  }, [job, qc]);

  useEffect(() => {
    const el = ausgabeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ausgabe]);

  const ausfuehren = async () => {
    const befehl = eingabe.trim();
    if (!befehl || job) return;
    setFehler(null);
    setVomAgenten(false);
    try {
      const r = await api<{ id: string }>('/api/paketwerk/start', { methode: 'POST', body: { befehl } });
      const neu = [befehl, ...verlauf.filter((v) => v !== befehl)].slice(0, 30);
      setVerlauf(neu);
      localStorage.setItem(VERLAUF_SCHLUESSEL, JSON.stringify(neu));
      setVerlaufPos(-1);
      setAusgabe((a) => `${a}${a ? '\n' : ''}$ ${befehl}\n`);
      setStatus('läuft … 0 s');
      setEingabe('');
      setJob({ id: r.id, bis: 0 });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  const abbrechen = async () => {
    if (!job) return;
    try {
      await api('/api/paketwerk/abbrechen', { methode: 'POST', body: { id: job.id } });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  const taste = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void ausfuehren();
    } else if (ev.key === 'ArrowUp' && verlauf.length) {
      ev.preventDefault();
      const p = Math.min(verlaufPos + 1, verlauf.length - 1);
      setVerlaufPos(p);
      setEingabe(verlauf[p]!);
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      const p = verlaufPos - 1;
      setVerlaufPos(Math.max(p, -1));
      setEingabe(p >= 0 ? verlauf[p]! : '');
    }
  };

  const d = q.data;
  return (
    <section className="pw">
      <h1>🧪 Paketwerk – Pakete für den Rechenraum</h1>
      <p>
        Hier installierst du Python-Pakete für den Rechenraum. pip läuft als <code>--user</code> in einen eigenen Paketordner; der Rechenraum sieht die Pakete sofort, aber nur lesend. Installiert wird nur, was du hier selbst ausführst – Agenten
        schlagen Befehle nur vor.
      </p>
      <p className="leise">
        Pakete kommen ungeprüft aus PyPI: nimm feste Versionen (z. B. <code>pip install scikit-learn==1.9.1</code>). Nur Python-Pakete, keine Systemprogramme.
      </p>
      {d && !d.eingerichtet && (
        <p className="hinweis" role="status">
          Das Paketwerk kommt mit dem nächsten Deploy.{d.fehler ? ` (${d.fehler})` : ''}
        </p>
      )}
      {d?.eingerichtet && d.fehler && <p className="hinweis">{d.fehler}</p>}

      <div className="pw-konsole" aria-label="Konsole">
        <pre ref={ausgabeRef} className="pw-ausgabe" aria-label="Ausgabe" aria-live="polite">
          {ausgabe || 'Noch nichts ausgeführt.'}
        </pre>
        {vomAgenten && (
          <p className="pw-vorschlag" role="note">
            Vom Agenten vorgeschlagen – prüfen, dann Ausführen.
          </p>
        )}
        <div className="pw-zeile">
          <span className="pw-prompt" aria-hidden>
            $
          </span>
          <input
            className="pw-eingabe"
            aria-label="Befehl"
            value={eingabe}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="pip install paket==version"
            onChange={(ev) => setEingabe(ev.target.value)}
            onKeyDown={taste}
          />
          {job ? (
            <button type="button" className="klein" onClick={() => void abbrechen()}>
              Abbrechen
            </button>
          ) : (
            <button type="button" className="klein" onClick={() => void ausfuehren()} disabled={!eingabe.trim() || !d?.eingerichtet}>
              Ausführen
            </button>
          )}
        </div>
        <div className="pw-status" role="status">
          {status ?? 'bereit'}
        </div>
      </div>
      {fehler && (
        <p className="hinweis" role="alert">
          {fehler}
        </p>
      )}

      <div className="pw-knoepfe">
        <button type="button" className="klein" onClick={() => setEingabe('pip list --user')}>
          pip list --user
        </button>
        <button type="button" className="klein" onClick={() => void qc.invalidateQueries({ queryKey: ['paketwerk'] })}>
          Installierte Pakete neu laden
        </button>
      </div>

      <h2>Installierte Pakete</h2>
      {d?.pakete.length ? (
        <ul className="pw-pakete" aria-label="Installierte Pakete">
          {d.pakete.map((p) => (
            <li key={p.name}>
              <code>
                {p.name}=={p.version}
              </code>
              <button type="button" className="klein" onClick={() => setEingabe(`pip uninstall -y ${p.name}`)}>
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="leise">{q.isLoading ? 'Lade …' : 'Noch keine eigenen Pakete.'}</p>
      )}
    </section>
  );
}
