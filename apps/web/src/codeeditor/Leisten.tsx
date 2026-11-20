import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatDetail, EditorEintrag, EditorGitAntwort, EditorGitStatus, EditorTreffer } from '@dorf/shared';
import { api } from '../api';
import { groesseText } from '../komponenten/Anhaenge';
import { ChatSeite } from '../seiten/Chat';
import { editorApi, elternVon, nameVon, pfadFehler, verbinden } from './schnittstelle';

/** Seitenleisten des Editors (E197): Dateibaum, Volltextsuche, Git, Coding-Agent – und das kleine Rückfrage-Fenster. */

export interface FrageOpt {
  titel: string;
  text?: string;
  /** mit Eingabefeld (Startwert) – ohne: reine Bestätigung */
  eingabe?: string;
  ok: string;
  gefahr?: boolean;
  pruefen?: (wert: string) => string | null;
}

export interface Werk {
  projekt: string;
  oeffnen(pfad: string, pos?: { zeile: number; spalte: number }): void;
  diffOeffnen(pfad: string): void;
  fragen(f: FrageOpt): Promise<string | null>;
  melden(text: string, fehler?: boolean): void;
  /** Datei/Ordner gibt es nicht mehr (gelöscht, umbenannt): Reiter schließen */
  dateiWeg(pfad: string): void;
  /** offene, unveränderte Dateien neu vom Server holen (nach Agent, Pull, Branch-Wechsel) */
  auffrischen(): Promise<void>;
  /** hat die Datei (oder etwas in dem Ordner) ungespeicherte Änderungen? */
  ungespeichert(pfad: string): boolean;
  aktivePfad: string;
}

export function FrageFenster({ frage, antwort }: { frage: FrageOpt; antwort: (wert: string | null) => void }) {
  const [wert, setWert] = useState(frage.eingabe ?? '');
  const [fehler, setFehler] = useState('');
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    feld.current?.focus();
    // Dateiname ohne Endung vorwählen
    const punkt = (frage.eingabe ?? '').lastIndexOf('.');
    if (feld.current && punkt > 0) feld.current.setSelectionRange((frage.eingabe ?? '').lastIndexOf('/') + 1, punkt);
  }, [frage]);
  const ok = (e: React.FormEvent) => {
    e.preventDefault();
    if (frage.eingabe === undefined) return antwort('');
    const f = frage.pruefen?.(wert.trim()) ?? null;
    if (f) return setFehler(f);
    antwort(wert.trim());
  };
  return (
    <div className="fenster-hintergrund" onClick={() => antwort(null)} onKeyDown={(e) => e.key === 'Escape' && antwort(null)}>
      <form className="karte ce-frage" role="dialog" aria-modal="true" aria-label={frage.titel} onClick={(e) => e.stopPropagation()} onSubmit={ok}>
        <h2>{frage.titel}</h2>
        {frage.text && <p>{frage.text}</p>}
        {frage.eingabe !== undefined && <input ref={feld} value={wert} onChange={(e) => setWert(e.target.value)} aria-label={frage.titel} autoCapitalize="off" autoCorrect="off" spellCheck={false} />}
        {fehler && <p className="fehler">{fehler}</p>}
        <div className="werkzeuge">
          <button type="submit" className={frage.gefahr ? 'gefahr' : 'haupt'} autoFocus={frage.eingabe === undefined}>
            {frage.ok}
          </button>
          <button type="button" onClick={() => antwort(null)}>
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- Dateibaum ---------------------------------------------------------------------------------------

const SYMBOL: Record<EditorEintrag['art'], string> = { ordner: '📁', datei: '📄', link: '🔗', sonst: '▫️' };

export function BaumLeiste({ w }: { w: Werk }) {
  const qc = useQueryClient();
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const [markiert, setMarkiert] = useState<{ pfad: string; art: EditorEintrag['art'] } | null>(null);
  const hoch = useRef<HTMLInputElement>(null);
  const neuLaden = () => {
    void qc.invalidateQueries({ queryKey: ['editor-baum', w.projekt] });
    void qc.invalidateQueries({ queryKey: ['editor-dateien', w.projekt] });
    void qc.invalidateQueries({ queryKey: ['editor-git', w.projekt] });
  };
  // Zielordner für „neu“ und „hochladen“: der markierte Ordner, sonst der Ordner der markierten Datei, sonst die Wurzel
  const ziel = markiert ? (markiert.art === 'ordner' ? markiert.pfad : elternVon(markiert.pfad)) : '';
  const tun = async (f: () => Promise<unknown>, danach?: () => void) => {
    try {
      await f();
      danach?.();
      neuLaden();
    } catch (e) {
      w.melden((e as Error).message, true);
    }
  };
  const neu = async (art: 'datei' | 'ordner') => {
    const name = await w.fragen({ titel: art === 'datei' ? 'Neue Datei' : 'Neuer Ordner', text: `in ${ziel || 'der Projektwurzel'} – Unterordner mit / (z. B. src/neu.ts)`, eingabe: '', ok: 'Anlegen', pruefen: pfadFehler });
    if (name === null) return;
    const pfad = verbinden(ziel, name);
    await tun(
      () => editorApi.neu(w.projekt, pfad, art),
      () => {
        setOffen((o) => new Set([...o, ...vorfahren(pfad), ...(art === 'ordner' ? [pfad] : [])]));
        if (art === 'datei') w.oeffnen(pfad);
      },
    );
  };
  const umbenennen = async () => {
    if (!markiert) return;
    if (w.ungespeichert(markiert.pfad)) return w.melden('Erst speichern – dort gibt es ungespeicherte Änderungen.', true);
    const nach = await w.fragen({ titel: 'Umbenennen / verschieben', text: 'Neuer Pfad im Projekt:', eingabe: markiert.pfad, ok: 'Umbenennen', pruefen: pfadFehler });
    if (nach === null || nach === markiert.pfad) return;
    const alt = markiert;
    await tun(
      () => editorApi.umbenennen(w.projekt, alt.pfad, nach),
      () => {
        w.dateiWeg(alt.pfad);
        setMarkiert({ pfad: nach, art: alt.art });
        if (alt.art === 'datei') w.oeffnen(nach);
      },
    );
  };
  const loeschen = async () => {
    if (!markiert) return;
    const alt = markiert;
    const ja = await w.fragen({
      titel: `„${nameVon(alt.pfad)}“ löschen?`,
      text: `${alt.art === 'ordner' ? 'Der Ordner mit allem darin' : 'Die Datei'} wandert in den Papierkorb des Projekts (/arbeit/.papierkorb, 14 Tage).${w.ungespeichert(alt.pfad) ? ' Ungespeicherte Änderungen gehen verloren.' : ''}`,
      ok: 'Löschen',
      gefahr: true,
    });
    if (ja === null) return;
    await tun(
      () => editorApi.loeschen(w.projekt, alt.pfad),
      () => {
        w.dateiWeg(alt.pfad);
        setMarkiert(null);
      },
    );
  };
  const hochladen = async (dateien: FileList | null) => {
    for (const d of Array.from(dateien ?? [])) {
      const pfad = verbinden(ziel, d.name);
      try {
        await editorApi.hochladen(w.projekt, pfad, d);
      } catch (e) {
        if ((e as { status?: number }).status !== 409) {
          w.melden(`${d.name}: ${(e as Error).message}`, true);
          continue;
        }
        const ja = await w.fragen({ titel: `„${d.name}“ ersetzen?`, text: `${pfad} gibt es schon.`, ok: 'Ersetzen', gefahr: true });
        if (ja === null) continue;
        await editorApi.hochladen(w.projekt, pfad, d, true).catch((f: Error) => w.melden(`${d.name}: ${f.message}`, true));
      }
    }
    if (hoch.current) hoch.current.value = '';
    setOffen((o) => new Set([...o, ...vorfahren(verbinden(ziel, 'x'))]));
    neuLaden();
    void w.auffrischen();
  };
  const knopf = (symbol: string, titel: string, klick: () => void, aus = false) => (
    <button type="button" className="klein ce-symbol" title={titel} aria-label={titel} onClick={klick} disabled={aus}>
      {symbol}
    </button>
  );
  return (
    <div className="ce-leiste" data-testid="baum">
      <div className="ce-leiste-kopf">
        <strong>Dateien</strong>
        <span className="ce-knoepfe">
          {knopf('📄＋', 'Neue Datei', () => void neu('datei'))}
          {knopf('📁＋', 'Neuer Ordner', () => void neu('ordner'))}
          {knopf('⬆', 'Dateien hochladen', () => hoch.current?.click())}
          {knopf('✏️', 'Umbenennen', () => void umbenennen(), !markiert)}
          {knopf('🗑', 'Löschen', () => void loeschen(), !markiert)}
          {markiert?.art === 'datei' ? (
            <a className="knopf klein ce-symbol" title="Herunterladen" aria-label="Herunterladen" href={editorApi.rohUrl(w.projekt, markiert.pfad)} download={nameVon(markiert.pfad)}>
              ⬇
            </a>
          ) : (
            knopf('⬇', 'Herunterladen', () => undefined, true)
          )}
          {knopf('↻', 'Neu laden', neuLaden)}
        </span>
        <input ref={hoch} type="file" multiple hidden data-testid="hochladen" onChange={(e) => void hochladen(e.target.files)} />
      </div>
      <div className="ce-leiste-inhalt ce-baum" role="tree" aria-label={`Dateien in ${w.projekt}`}>
        <Ordner
          w={w}
          pfad=""
          tiefe={0}
          offen={offen}
          markiert={markiert?.pfad ?? null}
          klick={(pfad, art) => {
            setMarkiert({ pfad, art });
            if (art === 'ordner')
              setOffen((o) => {
                const n = new Set(o);
                if (n.has(pfad)) n.delete(pfad);
                else n.add(pfad);
                return n;
              });
            else if (art === 'datei') w.oeffnen(pfad);
            else w.melden('Verknüpfungen (Symlinks) öffnet der Editor nicht – nimm dafür das Terminal.', true);
          }}
        />
      </div>
      <div className="ce-leiste-fuss leise">Ziel für Neues: {ziel || '(Projektwurzel)'}</div>
    </div>
  );
}

const vorfahren = (pfad: string) => {
  const aus: string[] = [];
  let p = elternVon(pfad);
  while (p) {
    aus.push(p);
    p = elternVon(p);
  }
  return aus;
};

function Ordner({ w, pfad, tiefe, offen, markiert, klick }: { w: Werk; pfad: string; tiefe: number; offen: Set<string>; markiert: string | null; klick: (pfad: string, art: EditorEintrag['art']) => void }) {
  const q = useQuery({ queryKey: ['editor-baum', w.projekt, pfad], queryFn: () => editorApi.baum(w.projekt, pfad) });
  if (q.isPending) return <div className="leise ce-zeile" style={{ paddingLeft: `${0.5 + tiefe * 0.9}rem` }}>Lade …</div>;
  if (q.isError) return <div className="fehler ce-zeile" style={{ paddingLeft: `${0.5 + tiefe * 0.9}rem` }}>{q.error.message}</div>;
  return (
    <>
      {q.data.eintraege.length === 0 && <div className="leise ce-zeile" style={{ paddingLeft: `${0.5 + tiefe * 0.9}rem` }}>(leer)</div>}
      {q.data.eintraege.map((e) => {
        const p = verbinden(pfad, e.name);
        const auf = e.art === 'ordner' && offen.has(p);
        return (
          <div key={p} role="treeitem" aria-expanded={e.art === 'ordner' ? auf : undefined}>
            <button
              type="button"
              className={`ce-zeile ce-eintrag${markiert === p ? ' markiert' : ''}${w.aktivePfad === p ? ' aktiv' : ''}`}
              style={{ paddingLeft: `${0.5 + tiefe * 0.9}rem` }}
              title={e.art === 'datei' ? `${p} · ${groesseText(e.groesse)}` : p}
              onClick={() => klick(p, e.art)}
            >
              <span aria-hidden>{e.art === 'ordner' ? (auf ? '📂' : '📁') : SYMBOL[e.art]}</span> {e.name}
            </button>
            {auf && <Ordner w={w} pfad={p} tiefe={tiefe + 1} offen={offen} markiert={markiert} klick={klick} />}
          </div>
        );
      })}
      {q.data.gekuerzt && <div className="leise ce-zeile">… gekürzt (sehr großer Ordner)</div>}
    </>
  );
}

// ---- Volltextsuche -----------------------------------------------------------------------------------

export function SuchLeiste({ w }: { w: Werk }) {
  const [text, setText] = useState('');
  const [opt, setOpt] = useState({ regex: false, gross: false, wort: false });
  const [ergebnis, setErgebnis] = useState<{ treffer: EditorTreffer[]; gekuerzt: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const suchen = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text) return;
    setLaeuft(true);
    setFehler('');
    try {
      setErgebnis(await editorApi.suche(w.projekt, text, opt));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };
  const gruppen = new Map<string, EditorTreffer[]>();
  for (const t of ergebnis?.treffer ?? []) gruppen.set(t.pfad, [...(gruppen.get(t.pfad) ?? []), t]);
  const schalter = (k: keyof typeof opt, zeichen: string, titel: string) => (
    <button type="button" className={`klein ce-symbol${opt[k] ? ' aktiv' : ''}`} title={titel} aria-label={titel} aria-pressed={opt[k]} onClick={() => setOpt((o) => ({ ...o, [k]: !o[k] }))}>
      {zeichen}
    </button>
  );
  return (
    <div className="ce-leiste" data-testid="suche">
      <div className="ce-leiste-kopf">
        <strong>Im Projekt suchen</strong>
      </div>
      <form className="ce-suchform" onSubmit={(e) => void suchen(e)}>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Text im Projekt …" aria-label="Im Projekt suchen" autoCapitalize="off" spellCheck={false} />
        <span className="ce-knoepfe">
          {schalter('gross', 'Aa', 'Groß-/Kleinschreibung beachten')}
          {schalter('wort', 'ab|', 'Nur ganze Wörter')}
          {schalter('regex', '.*', 'Regulärer Ausdruck')}
          <button type="submit" className="klein" disabled={laeuft || !text}>
            {laeuft ? 'Suche …' : 'Suchen'}
          </button>
        </span>
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
      <div className="ce-leiste-inhalt">
        {ergebnis && (
          <p className="leise">
            {ergebnis.treffer.length} Treffer in {gruppen.size} Datei{gruppen.size === 1 ? '' : 'en'}
            {ergebnis.gekuerzt ? ' (gekürzt – such genauer)' : ''}
          </p>
        )}
        {[...gruppen].map(([pfad, treffer]) => (
          <div key={pfad} className="ce-treffer-gruppe">
            <div className="ce-treffer-datei">{pfad}</div>
            {treffer.map((t, i) => (
              <button key={i} type="button" className="ce-zeile ce-eintrag" onClick={() => w.oeffnen(t.pfad, { zeile: t.zeile, spalte: t.spalte })}>
                <span className="leise">{t.zeile}:</span> {t.text.trim().slice(0, 160)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Git ---------------------------------------------------------------------------------------------

const STAND: Record<string, string> = { '?': 'neu', M: 'geändert', A: 'hinzugefügt', D: 'gelöscht', R: 'umbenannt', C: 'kopiert', U: 'Konflikt', T: 'Typ geändert' };
const standText = (x: string, y: string) => STAND[y !== ' ' ? y : x] ?? `${x}${y}`.trim();

export function GitLeiste({ w }: { w: Werk }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['editor-git', w.projekt], queryFn: () => editorApi.gitStatus(w.projekt), refetchInterval: 20_000 });
  const branches = useQuery({
    queryKey: ['editor-git-branches', w.projekt],
    queryFn: () => editorApi.git<{ aktuell: string; lokal: string[]; fern: string[] }>(w.projekt, 'branches'),
    enabled: !!status.data?.git,
  });
  const [nachricht, setNachricht] = useState('');
  const [ausgabe, setAusgabe] = useState('');
  const [laeuft, setLaeuft] = useState('');
  const neuLaden = () => {
    void qc.invalidateQueries({ queryKey: ['editor-git', w.projekt] });
    void qc.invalidateQueries({ queryKey: ['editor-git-branches', w.projekt] });
  };
  /** Befehl ausführen, Ausgabe zeigen; `dateien`: danach Baum und offene Dateien auffrischen (Pull, Wechsel, Verwerfen) */
  const tun = async (name: string, befehl: string, mehr: Record<string, unknown> = {}, dateien = false) => {
    setLaeuft(name);
    try {
      const r = await editorApi.git<EditorGitAntwort>(w.projekt, befehl, mehr);
      setAusgabe(`$ git ${name}\n${r.ausgabe || (r.ok ? '(ok)' : '(fehlgeschlagen)')}`);
      if (!r.ok) w.melden(`git ${name} ist fehlgeschlagen – siehe Ausgabe in der Git-Leiste.`, true);
      if (dateien) {
        void qc.invalidateQueries({ queryKey: ['editor-baum', w.projekt] });
        void qc.invalidateQueries({ queryKey: ['editor-dateien', w.projekt] });
        await w.auffrischen();
      }
      return r.ok;
    } catch (e) {
      setAusgabe(`$ git ${name}\n${(e as Error).message}`);
      w.melden((e as Error).message, true);
      return false;
    } finally {
      setLaeuft('');
      neuLaden();
    }
  };
  const s: EditorGitStatus | undefined = status.data;
  if (status.isPending) return <div className="ce-leiste leise">Lade …</div>;
  if (status.isError) return <div className="ce-leiste fehler">{status.error.message}</div>;
  if (!s?.git)
    return (
      <div className="ce-leiste" data-testid="git">
        <div className="ce-leiste-kopf">
          <strong>Git</strong>
        </div>
        <p className="leise">Dieses Projekt ist (noch) kein Git-Repository.</p>
        <p>
          <button type="button" onClick={() => void tun('init', 'init')} disabled={!!laeuft}>
            git init
          </button>
        </p>
        {ausgabe && <pre className="ce-ausgabe">{ausgabe}</pre>}
      </div>
    );
  const vorgemerkt = s.dateien.filter((d) => d.x !== ' ' && d.x !== '?');
  const commit = async (alle: boolean) => {
    if (!nachricht.trim()) return w.melden('Commit-Nachricht fehlt.', true);
    if (await tun('commit', 'commit', { nachricht, alle })) setNachricht('');
  };
  const branchWechseln = async (branch: string) => {
    if (!branch || branch === s.branch) return;
    if (branch === '+neu') {
      const name = await w.fragen({ titel: 'Neuer Branch', text: `Zweigt vom aktuellen Stand (${s.branch}) ab.`, eingabe: '', ok: 'Anlegen und wechseln', pruefen: (n) => (/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(n) && !n.includes('..') ? null : 'Nur Buchstaben, Ziffern, . _ - und /') });
      if (name) await tun(`switch -c ${name}`, 'anlegen', { branch: name }, true);
      return;
    }
    await tun(`switch ${branch}`, 'wechseln', { branch }, true);
  };
  const verwerfen = async (pfad: string) => {
    const ja = await w.fragen({ titel: `Änderungen an „${nameVon(pfad)}“ verwerfen?`, text: 'Die Datei wird auf den Stand des letzten Commits zurückgesetzt. Das lässt sich nicht rückgängig machen.', ok: 'Verwerfen', gefahr: true });
    if (ja !== null) await tun(`restore ${pfad}`, 'verwerfen', { pfad }, true);
  };
  return (
    <div className="ce-leiste" data-testid="git">
      <div className="ce-leiste-kopf">
        <strong>Git</strong>
        <span className="ce-knoepfe">
          <button type="button" className="klein ce-symbol" title="Status neu laden" aria-label="Status neu laden" onClick={neuLaden}>
            ↻
          </button>
        </span>
      </div>
      <label className="ce-branch">
        <span className="leise">Branch</span>
        <select value={s.branch} onChange={(e) => void branchWechseln(e.target.value)} aria-label="Branch" disabled={!!laeuft}>
          {[...new Set([s.branch, ...(branches.data?.lokal ?? [])])].map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          {(branches.data?.fern ?? []).length > 0 && (
            <optgroup label="nur auf dem Server (origin)">
              {branches.data!.fern.map((b) => (
                <option key={`f-${b}`} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
          )}
          <option value="+neu">＋ Neuer Branch …</option>
        </select>
      </label>
      <p className="leise" data-testid="git-zweig">
        {s.upstream ? `↔ ${s.upstream}` : 'noch nicht auf dem Server'}
        {s.voraus ? ` · ${s.voraus} ↑` : ''}
        {s.zurueck ? ` · ${s.zurueck} ↓` : ''}
      </p>
      <div className="ce-knoepfe ce-git-knoepfe">
        <button type="button" className="klein" onClick={() => void tun('pull', 'pull', {}, true)} disabled={!!laeuft}>
          {laeuft === 'pull' ? '…' : '⬇ Pull'}
        </button>
        <button type="button" className="klein" onClick={() => void tun('push', 'push')} disabled={!!laeuft}>
          {laeuft === 'push' ? '…' : '⬆ Push'}
        </button>
        <button type="button" className="klein" onClick={() => void tun('fetch', 'holen')} disabled={!!laeuft}>
          Fetch
        </button>
      </div>
      <div className="ce-leiste-inhalt">
        <h4>
          Änderungen <span className="abzeichen">{s.dateien.length}</span>
        </h4>
        {s.dateien.length === 0 && <p className="leise">Nichts geändert.</p>}
        <ul className="ce-git-liste" data-testid="git-dateien">
          {s.dateien.map((d) => {
            const vor = d.x !== ' ' && d.x !== '?';
            return (
              <li key={d.pfad} className={vor ? 'vorgemerkt' : ''}>
                <button type="button" className="ce-zeile ce-eintrag" title={d.x === '?' ? `${d.pfad} – neue Datei öffnen` : `${d.pfad} – Unterschiede anzeigen`} onClick={() => (d.x === '?' ? w.oeffnen(d.pfad) : w.diffOeffnen(d.pfad))}>
                  <span className={`ce-stand s-${(d.y !== ' ' ? d.y : d.x).replace('?', 'neu')}`}>{standText(d.x, d.y)}</span> {nameVon(d.pfad)} <span className="leise">{elternVon(d.pfad)}</span>
                </button>
                <span className="ce-knoepfe">
                  {vor ? (
                    <button type="button" className="klein ce-symbol" title="Vormerkung zurücknehmen" aria-label={`${d.pfad}: Vormerkung zurücknehmen`} onClick={() => void tun(`reset ${d.pfad}`, 'zuruecknehmen', { pfad: d.pfad })}>
                      −
                    </button>
                  ) : (
                    <button type="button" className="klein ce-symbol" title="Für den Commit vormerken" aria-label={`${d.pfad}: vormerken`} onClick={() => void tun(`add ${d.pfad}`, 'vormerken', { pfad: d.pfad })}>
                      ＋
                    </button>
                  )}
                  {d.x !== '?' && (
                    <button type="button" className="klein ce-symbol" title="Änderungen verwerfen" aria-label={`${d.pfad}: Änderungen verwerfen`} onClick={() => void verwerfen(d.pfad)}>
                      ↶
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <textarea value={nachricht} onChange={(e) => setNachricht(e.target.value)} rows={3} placeholder="Commit-Nachricht" aria-label="Commit-Nachricht" />
        <div className="ce-knoepfe ce-git-knoepfe">
          <button type="button" className="haupt klein" onClick={() => void commit(true)} disabled={!!laeuft || !s.dateien.length}>
            Commit (alles)
          </button>
          <button type="button" className="klein" onClick={() => void commit(false)} disabled={!!laeuft || !vorgemerkt.length} title="Nur was mit ＋ vorgemerkt ist">
            nur Vorgemerktes ({vorgemerkt.length})
          </button>
        </div>
        {ausgabe && (
          <pre className="ce-ausgabe" data-testid="git-ausgabe">
            {ausgabe}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---- Coding-Agent ------------------------------------------------------------------------------------

const AGENT_AKTION = 'Codehaus/programmieren';

export function AgentLeiste({ w }: { w: Werk }) {
  const qc = useQueryClient();
  const merker = `dorf-editor-chat-${w.projekt}`;
  const [chatId, setChatId] = useState<string | null>(() => localStorage.getItem(merker));
  const [auftrag, setAuftrag] = useState('');
  const [fehler, setFehler] = useState('');
  const [startet, setStartet] = useState(false);
  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api<ChatDetail>(`/api/chats/${chatId}`), enabled: !!chatId, retry: false });
  const status = useQuery({ queryKey: ['editor-git', w.projekt], queryFn: () => editorApi.gitStatus(w.projekt) });
  const arbeitet = !!chat.data?.laeufe.some((l) => ['wartend', 'laeuft', 'wartet_freigabe'].includes(l.status));
  // Lauf zu Ende: was der Agent geändert hat, steht sofort im Editor (offene Dateien, Baum, Git)
  const vorher = useRef(false);
  useEffect(() => {
    if (vorher.current && !arbeitet) {
      void qc.invalidateQueries({ queryKey: ['editor-baum', w.projekt] });
      void qc.invalidateQueries({ queryKey: ['editor-dateien', w.projekt] });
      void qc.invalidateQueries({ queryKey: ['editor-git', w.projekt] });
      void w.auffrischen();
    }
    vorher.current = arbeitet;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeitet]);
  // gemerkter Chat gibt es nicht mehr
  useEffect(() => {
    if (chat.isError) {
      localStorage.removeItem(merker);
      setChatId(null);
    }
  }, [chat.isError, merker]);
  const starten = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auftrag.trim()) return;
    setStartet(true);
    setFehler('');
    try {
      const r = await api<{ chatId: string }>('/api/aktionen/starten', { body: { id: AGENT_AKTION, eingaben: { projekt: w.projekt, auftrag } } });
      localStorage.setItem(merker, r.chatId);
      setChatId(r.chatId);
      setAuftrag('');
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setStartet(false);
    }
  };
  const geaendert = status.data?.dateien ?? [];
  return (
    <div className="ce-leiste ce-agent" data-testid="agent">
      <div className="ce-leiste-kopf">
        <strong>Coding-Agent</strong>
        {chatId && (
          <button
            type="button"
            className="klein"
            onClick={() => {
              localStorage.removeItem(merker);
              setChatId(null);
            }}
          >
            Neuer Auftrag
          </button>
        )}
      </div>
      <div className="ce-leiste-inhalt">
        {!chatId ? (
          <form onSubmit={(e) => void starten(e)} className="ce-agent-form">
            <p className="leise">
              Der Agent programmiert selbstständig in <strong>{w.projekt}</strong> – im selben Ordner wie du (Aktion „Programmieren“, Motor coding).
            </p>
            <textarea value={auftrag} onChange={(e) => setAuftrag(e.target.value)} rows={5} placeholder="Was soll gebaut oder geändert werden?" aria-label="Auftrag für den Coding-Agenten" />
            <button type="submit" className="haupt" disabled={startet || !auftrag.trim()}>
              {startet ? 'Starte …' : 'Agent starten'}
            </button>
            {fehler && <p className="fehler">{fehler}</p>}
          </form>
        ) : (
          <>
            {!arbeitet && geaendert.length > 0 && (
              <div className="ce-agent-geaendert" data-testid="agent-geaendert">
                <strong>Geänderte Dateien</strong> <span className="leise">(gegenüber dem letzten Commit)</span>
                {geaendert.slice(0, 30).map((d) => (
                  <button key={d.pfad} type="button" className="ce-zeile ce-eintrag" onClick={() => (d.x === '?' ? w.oeffnen(d.pfad) : w.diffOeffnen(d.pfad))}>
                    <span className={`ce-stand s-${(d.y !== ' ' ? d.y : d.x).replace('?', 'neu')}`}>{standText(d.x, d.y)}</span> {d.pfad}
                  </button>
                ))}
              </div>
            )}
            <ChatSeite id={chatId} eingebettet />
          </>
        )}
      </div>
    </div>
  );
}
