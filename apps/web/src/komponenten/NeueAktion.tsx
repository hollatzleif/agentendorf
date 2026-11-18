import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Gebaeude } from '@dorf/shared';
import { api, ApiFehler } from '../api';

type Werkzeug = 'vault_schreiben' | 'post' | 'moodle' | 'kalender' | 'rechenraum' | 'web';
const WERKZEUGE: { id: Werkzeug; text: string; fremd?: boolean }[] = [
  { id: 'vault_schreiben', text: 'Im Gebäude schreiben' },
  { id: 'kalender', text: 'Kalender lesen', fremd: true },
  { id: 'post', text: 'Mails lesen, Entwürfe', fremd: true },
  { id: 'moodle', text: 'Moodle-Browser', fremd: true },
  { id: 'rechenraum', text: 'Rechenraum (LaTeX, Python)' },
  { id: 'web', text: 'Internet' },
];

interface EingabeZeile {
  name: string;
  beschriftung: string;
  pflicht: boolean;
  standard: string;
}

/**
 * Skill (Aktion) anlegen: Formular → Server prüft wie jede Aktion → Markdown-Datei in <Gebäude>/aktionen/.
 * Fremdinhalte ergeben sich aus den Werkzeugen (Kalender, Mails, Moodle); Internet schließt das aus (Stadtordnung).
 */
export function NeueAktion({ gebaeude, fertig }: { gebaeude: string; fertig: (id: string) => void }) {
  const qc = useQueryClient();
  const alle = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const [ziel, setZiel] = useState(gebaeude);
  const [name, setName] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [anweisung, setAnweisung] = useState('');
  const [werkzeuge, setWerkzeuge] = useState<Werkzeug[]>(['vault_schreiben']);
  const [motor, setMotor] = useState<'claude-code' | 'api'>('claude-code');
  const [stufe, setStufe] = useState<'klein' | 'mittel' | 'gross'>('mittel');
  const [zeitplan, setZeitplan] = useState('');
  const [ablage, setAblage] = useState('');
  const [eingaben, setEingaben] = useState<EingabeZeile[]>([]);
  const [vorschau, setVorschau] = useState<string | null>(null);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const fremd = werkzeuge.some((w) => WERKZEUGE.find((x) => x.id === w)?.fremd);
  const umschalten = (w: Werkzeug) =>
    setWerkzeuge((alt) => {
      if (alt.includes(w)) return alt.filter((x) => x !== w);
      // Internet und Fremdinhalte schließen sich aus
      if (w === 'web') return [...alt.filter((x) => !WERKZEUGE.find((y) => y.id === x)?.fremd), w];
      if (WERKZEUGE.find((y) => y.id === w)?.fremd) return [...alt.filter((x) => x !== 'web'), w];
      return [...alt, w];
    });

  const entwurf = () => ({
    gebaeude: ziel,
    name: name.trim(),
    beschreibung: beschreibung.trim(),
    anweisung,
    motor,
    stufe,
    werkzeuge: ['vault_lesen', 'vault_suchen', ...werkzeuge],
    fremdinhalte: fremd,
    ...(zeitplan.trim() ? { zeitplan: zeitplan.trim() } : {}),
    ...(ablage.trim() ? { ablage: ablage.trim() } : {}),
    eingaben: eingaben
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        typ: 'text',
        pflicht: e.pflicht,
        ...(e.beschriftung.trim() ? { beschriftung: e.beschriftung.trim() } : {}),
        ...(e.standard.trim() ? { standard: e.standard.trim() } : {}),
      })),
  });

  const pruefen = async () => {
    setFehler('');
    try {
      setVorschau((await api<{ markdown: string }>('/api/aktionen/pruefen', { body: entwurf() })).markdown);
    } catch (e) {
      setVorschau(null);
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };

  const anlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaeuft(true);
    setFehler('');
    try {
      const r = await api<{ id: string }>('/api/aktionen/neu', { body: entwurf() });
      await qc.invalidateQueries({ queryKey: ['aktionen'] });
      fertig(r.id);
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <form className="karte innen formspalte breit neue-aktion" onSubmit={anlegen} aria-label="Neue Aktion">
      <h3>Neue Aktion (Skill)</h3>
      <p className="leise">Wird als Markdown-Datei im Gebäude gespeichert – in Obsidian weiter bearbeitbar.</p>
      <label>
        Gebäude
        <select value={ziel} onChange={(e) => setZiel(e.target.value)}>
          {(alle.data ?? [{ id: gebaeude, name: gebaeude } as Gebaeude]).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name *
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="z. B. Checkliste" />
      </label>
      <label>
        Kurzbeschreibung
        <input value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} maxLength={400} placeholder="Ein Satz: was der Skill tut" />
      </label>
      <label>
        Anweisung an den Agenten *
        <textarea rows={8} value={anweisung} onChange={(e) => setAnweisung(e.target.value)} required placeholder="Was soll er tun, woher die Infos nehmen, was soll herauskommen? Eingaben als {name}." />
      </label>
      <fieldset>
        <legend>Werkzeuge (Lesen und Suchen im Vault hat jeder)</legend>
        {WERKZEUGE.map((w) => (
          <label key={w.id} className="zeile-label">
            <input type="checkbox" checked={werkzeuge.includes(w.id)} onChange={() => umschalten(w.id)} /> {w.text}
          </label>
        ))}
        {fremd && <p className="leise">Liest Fremdes (Mails, Moodle, Kalender) → wird als Fremdinhalt behandelt, Internet ist dann aus.</p>}
      </fieldset>
      <div className="zeile">
        <label>
          Motor
          <select value={motor} onChange={(e) => setMotor(e.target.value as 'claude-code' | 'api')}>
            <option value="claude-code">Abo (claude-code)</option>
            <option value="api">API-Schlüssel</option>
          </select>
        </label>
        <label>
          Stufe
          <select value={stufe} onChange={(e) => setStufe(e.target.value as 'klein' | 'mittel' | 'gross')}>
            <option value="klein">klein (Routine)</option>
            <option value="mittel">mittel</option>
            <option value="gross">groß (schwer)</option>
          </select>
        </label>
      </div>
      <label>
        Zeitplan (optional)
        <input value={zeitplan} onChange={(e) => setZeitplan(e.target.value)} placeholder="z. B. täglich 06:00 · werktags 07:00, 18:00 · mo, mi 08:00" />
      </label>
      <label>
        Ergebnis-Datei, die jedes Mal ersetzt wird (optional)
        <input value={ablage} onChange={(e) => setAblage(e.target.value)} placeholder={`z. B. ${ziel}/00_Ergebnis.html – alte Fassung kommt ins Archiv`} />
      </label>
      <fieldset>
        <legend>Eingaben (optional)</legend>
        {eingaben.map((e, i) => {
          const setzen = (t: Partial<EingabeZeile>) => setEingaben((alt) => alt.map((x, j) => (j === i ? { ...x, ...t } : x)));
          return (
            <div key={i} className="zeile eingabe-zeile">
              <input aria-label="Name der Eingabe" value={e.name} onChange={(x) => setzen({ name: x.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="name" />
              <input aria-label="Beschriftung" value={e.beschriftung} onChange={(x) => setzen({ beschriftung: x.target.value })} placeholder="Frage im Formular" />
              <input aria-label="Standardwert" value={e.standard} onChange={(x) => setzen({ standard: x.target.value })} placeholder="Standard (für Zeitplan)" />
              <label className="zeile-label">
                <input type="checkbox" checked={e.pflicht} onChange={(x) => setzen({ pflicht: x.target.checked })} /> Pflicht
              </label>
              <button type="button" className="klein" onClick={() => setEingaben((alt) => alt.filter((_, j) => j !== i))} aria-label="Eingabe entfernen">
                ×
              </button>
            </div>
          );
        })}
        {eingaben.length < 10 && (
          <button type="button" onClick={() => setEingaben((alt) => [...alt, { name: '', beschriftung: '', pflicht: false, standard: '' }])}>
            + Eingabe
          </button>
        )}
      </fieldset>
      {fehler && <p className="fehler">{fehler}</p>}
      {vorschau && (
        <details open>
          <summary>So wird die Datei aussehen</summary>
          <pre className="rohtext">{vorschau}</pre>
        </details>
      )}
      <div className="zeile">
        <button type="button" onClick={() => void pruefen()}>
          Prüfen
        </button>
        <button type="submit" className="haupt" disabled={laeuft}>
          {laeuft ? 'Lege an …' : 'Aktion anlegen'}
        </button>
      </div>
    </form>
  );
}
