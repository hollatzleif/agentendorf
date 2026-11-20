import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CodingUebersicht } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick, navigieren, useOrt } from '../router';
import { groesseText } from '../komponenten/Anhaenge';
import { monaco, modellUri, THEMA, type Thema } from './monaco';
import { editorApi, nameVon, schnellFiltern } from './schnittstelle';
import { AgentLeiste, BaumLeiste, FrageFenster, GitLeiste, SuchLeiste, type FrageOpt, type Werk } from './Leisten';
import { TerminalFeld } from './TerminalFeld';

/**
 * Editor im Codehaus (E197): „wie VS Code“, aber als Seite der Dorf-App – Monaco-Editor mit Reitern, Dateibaum,
 * Volltext- und Schnellsuche, Git-Leiste mit Diff, Terminal und Coding-Agent daneben. Alle Daten kommen über das Dorf
 * (/api/coding/editor/*, /api/coding/terminal) aus dem Coding-Container; am Handy ist immer ein Bereich sichtbar.
 */

const PROJEKT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const editorUrl = (projekt?: string) => `/codehaus/editor${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ''}`;

export default function CodeEditorSeite() {
  const { suche } = useOrt();
  const projekt = suche.get('projekt') ?? '';
  if (projekt && PROJEKT.test(projekt)) return <Werkbank key={projekt} projekt={projekt} />;
  return <ProjektWahl />;
}

function ProjektWahl() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['coding'], queryFn: () => api<CodingUebersicht>('/api/coding') });
  const [name, setName] = useState('');
  const [fehler, setFehler] = useState('');
  const anlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler('');
    if (!PROJEKT.test(name)) return setFehler('Ein einzelner Ordnername: Buchstaben, Ziffern, Punkt, _ und - (z. B. spielwiese).');
    try {
      await editorApi.projektAnlegen(name);
      await qc.invalidateQueries({ queryKey: ['coding'] });
      navigieren(editorUrl(name));
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  return (
    <section className="karte ce-wahl">
      <a href="/gebaeude/Codehaus" onClick={linkKlick} className="zurueck">
        ← Codehaus
      </a>
      <h1>💻 Editor</h1>
      <p className="leise">Programmieren direkt im Dorf: Editor, Dateien, Terminal, Git und der Coding-Agent – in den Projekten des Coding-Containers (/arbeit).</p>
      {q.isPending && <p className="leise">Lade …</p>}
      {q.isError && <p className="fehler">{q.error.message}</p>}
      {q.data?.fehler && <p className="fehler">{q.data.fehler}</p>}
      {q.data && !q.data.erreichbar && !q.data.fehler && (
        <p>
          Das Codehaus ist noch nicht eingerichtet. Auf dem Server: <code>{q.data.befehl}</code>
        </p>
      )}
      {q.data?.erreichbar && (
        <>
          <h3>Projekt öffnen</h3>
          {q.data.projekte.length === 0 && <p className="leise">Noch keine Projekte.</p>}
          <ul className="chatliste" data-testid="editor-projekte">
            {q.data.projekte.map((p) => (
              <li key={p.name}>
                <a href={editorUrl(p.name)} onClick={linkKlick}>
                  {p.name}
                </a>{' '}
                {p.git && <span className="abzeichen">git</span>}
              </li>
            ))}
          </ul>
          <h3>Neues Projekt</h3>
          <form onSubmit={(e) => void anlegen(e)} className="ce-neu-projekt">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ordnername, z. B. spielwiese" aria-label="Name des neuen Projekts" autoCapitalize="off" spellCheck={false} />
            <button type="submit">Anlegen</button>
          </form>
          {fehler && <p className="fehler">{fehler}</p>}
        </>
      )}
    </section>
  );
}

type Seite = 'dateien' | 'suche' | 'git' | 'agent';
interface Reiter {
  id: string;
  pfad: string;
  art: 'datei' | 'diff' | 'hinweis';
  hinweis?: string;
}
/** Eine geladene Datei: Modell, Stand auf dem Server, Stand beim letzten Speichern */
interface Geladen {
  modell: monaco.editor.ITextModel;
  version: string | undefined;
  gespeichert: number;
  ansicht?: monaco.editor.ICodeEditorViewState | null;
  horcher: monaco.IDisposable;
}

function Werkbank({ projekt }: { projekt: string }) {
  const qc = useQueryClient();
  const [reiter, setReiter] = useState<Reiter[]>([]);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [schmutzig, setSchmutzig] = useState<Set<string>>(new Set());
  const [seite, setSeite] = useState<Seite | null>('dateien');
  const [terminalOffen, setTerminalOffen] = useState(false);
  const [terminals, setTerminals] = useState<number[]>([]);
  const [terminalAktiv, setTerminalAktiv] = useState(0);
  const terminalZaehler = useRef(0);
  /** Handy: genau ein Bereich sichtbar */
  const [bereich, setBereich] = useState<'seite' | 'editor' | 'terminal'>('seite');
  const [thema, setThema] = useState<Thema>(() => (localStorage.getItem('dorf-editor-thema') === 'dunkel' ? 'dunkel' : 'hell'));
  const [frage, setFrage] = useState<{ opt: FrageOpt; antwort: (w: string | null) => void } | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [konflikt, setKonflikt] = useState<string | null>(null);
  const [schnell, setSchnell] = useState(false);
  const [zeiger, setZeiger] = useState({ zeile: 1, spalte: 1 });

  const editorEl = useRef<HTMLDivElement>(null);
  const diffEl = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const dateien = useRef(new Map<string, Geladen>());
  const originale = useRef(new Map<string, monaco.editor.ITextModel>());
  const diffModelle = useRef(new Map<string, { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel }>());
  const reiterRef = useRef<Reiter[]>([]);
  reiterRef.current = reiter;
  const aktivRef = useRef<string | null>(null);
  aktivRef.current = aktiv;
  const aktiverReiter = reiter.find((r) => r.id === aktiv) ?? null;

  const melden = useCallback((text: string, fehler = false) => setMeldung({ text, fehler }), []);
  useEffect(() => {
    if (!meldung) return;
    const t = setTimeout(() => setMeldung(null), meldung.fehler ? 9000 : 3500);
    return () => clearTimeout(t);
  }, [meldung]);
  const fragen = useCallback((opt: FrageOpt) => new Promise<string | null>((fertig) => setFrage({ opt, antwort: fertig })), []);

  // ---- Monaco: ein Editor und ein Diff-Editor, Modelle je Datei ----
  useEffect(() => {
    const schmal = window.matchMedia('(max-width: 800px)').matches;
    const gemeinsam = {
      theme: THEMA[thema],
      automaticLayout: true,
      fontSize: schmal ? 13 : 14,
      // klassisches Eingabefeld statt EditContext: die Tastenkürzel der App erkennen es als Texteingabe
      editContext: false,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
    } as const;
    const e = monaco.editor.create(editorEl.current!, { ...gemeinsam, model: null, minimap: { enabled: !schmal }, tabSize: 2, renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, wordWrap: schmal ? 'on' : 'off' });
    const d = monaco.editor.createDiffEditor(diffEl.current!, { ...gemeinsam, renderSideBySide: !schmal, originalEditable: false, minimap: { enabled: false } });
    editor.current = e;
    diff.current = d;
    for (const ed of [e, d.getModifiedEditor()]) {
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void speichernRef.current());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => setSchnell(true));
      ed.onDidChangeCursorPosition((p) => setZeiger({ zeile: p.position.lineNumber, spalte: p.position.column }));
    }
    // Testhilfe (wie window.__dorf im 3D-Dorf)
    (window as unknown as { __editor?: unknown }).__editor = {
      wert: () => (aktivRef.current?.startsWith('diff:') ? d.getModifiedEditor() : e).getValue(),
      original: () => d.getOriginalEditor().getValue(),
      sprache: () => e.getModel()?.getLanguageId() ?? '',
      thema: () => document.querySelector('.ce-editor .monaco-editor')?.classList.contains('vs-dark') ?? false,
    };
    const geladen = dateien.current;
    const orig = originale.current;
    return () => {
      delete (window as unknown as { __editor?: unknown }).__editor;
      e.dispose();
      d.dispose();
      for (const g of geladen.values()) {
        g.horcher.dispose();
        g.modell.dispose();
      }
      for (const m of orig.values()) m.dispose();
      geladen.clear();
      orig.clear();
    };
    // einmal je Projekt (key am Bauteil); das Thema wechselt unten ohne Neuaufbau
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(THEMA[thema]);
    localStorage.setItem('dorf-editor-thema', thema);
  }, [thema]);

  const schmutzSetzen = useCallback((pfad: string, an: boolean) => {
    setSchmutzig((s) => {
      if (s.has(pfad) === an) return s;
      const n = new Set(s);
      if (an) n.add(pfad);
      else n.delete(pfad);
      return n;
    });
  }, []);

  /** Datei vom Server holen und als Modell bereithalten (einmal je Pfad) */
  const laden = useCallback(
    async (pfad: string): Promise<Geladen | { hinweis: string }> => {
      const da = dateien.current.get(pfad);
      if (da) return da;
      const d = await editorApi.datei(projekt, pfad);
      if (d.binaer) return { hinweis: `Binärdatei (${groesseText(d.groesse)}) – der Editor zeigt nur Text. Du kannst sie herunterladen.` };
      if (d.zuGross || d.text === undefined) return { hinweis: `Die Datei ist zu groß für den Editor (${groesseText(d.groesse)}, Grenze 2 MB). Du kannst sie herunterladen oder im Terminal bearbeiten.` };
      // inzwischen von einem zweiten Aufruf geladen?
      const doppelt = dateien.current.get(pfad);
      if (doppelt) return doppelt;
      const uri = modellUri(projekt, pfad);
      const modell = monaco.editor.getModel(uri) ?? monaco.editor.createModel(d.text, undefined, uri);
      const g: Geladen = { modell, version: d.version, gespeichert: modell.getAlternativeVersionId(), horcher: { dispose: () => undefined } };
      g.horcher = modell.onDidChangeContent(() => schmutzSetzen(pfad, modell.getAlternativeVersionId() !== g.gespeichert));
      dateien.current.set(pfad, g);
      return g;
    },
    [projekt, schmutzSetzen],
  );

  const reiterZeigen = useCallback((r: Reiter) => {
    setReiter((alle) => (alle.some((x) => x.id === r.id) ? alle.map((x) => (x.id === r.id ? r : x)) : [...alle, r]));
    setAktiv(r.id);
    setBereich('editor');
  }, []);

  const oeffnen = useCallback(
    (pfad: string, pos?: { zeile: number; spalte: number }) => {
      void (async () => {
        try {
          const g = await laden(pfad);
          if ('hinweis' in g) return reiterZeigen({ id: pfad, pfad, art: 'hinweis', hinweis: g.hinweis });
          reiterZeigen({ id: pfad, pfad, art: 'datei' });
          if (pos) g.ansicht = null;
          // nach dem Umschalten (Effekt unten) an die Stelle springen
          if (pos)
            setTimeout(() => {
              const e = editor.current;
              if (!e || e.getModel() !== g.modell) return;
              e.setPosition({ lineNumber: pos.zeile, column: pos.spalte });
              e.revealLineInCenter(pos.zeile);
              e.focus();
            }, 30);
        } catch (e) {
          melden(e instanceof ApiFehler ? e.message : String(e), true);
        }
      })();
    },
    [laden, melden, reiterZeigen],
  );

  const diffOeffnen = useCallback(
    (pfad: string) => {
      void (async () => {
        try {
          const o = await editorApi.git<{ text: string; neu?: boolean; binaer?: boolean }>(projekt, 'original', { pfad });
          if (o.binaer) return melden('Binärdatei – kein Textvergleich möglich.', true);
          let g: Geladen | { hinweis: string };
          try {
            g = await laden(pfad);
          } catch (e) {
            // gelöschte Datei: links der alte Stand, rechts leer
            if (!(e instanceof ApiFehler) || e.status !== 404) throw e;
            const uri = modellUri(projekt, pfad, 'geloescht');
            const leer = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', undefined, uri);
            g = { modell: leer, version: undefined, gespeichert: leer.getAlternativeVersionId(), horcher: { dispose: () => leer.dispose() } };
            originale.current.set(`weg:${pfad}`, leer);
          }
          if ('hinweis' in g) return melden(g.hinweis, true);
          const uri = modellUri(projekt, pfad, 'original');
          const alt = originale.current.get(pfad) ?? monaco.editor.getModel(uri) ?? monaco.editor.createModel(o.text, g.modell.getLanguageId(), uri);
          if (alt.getValue() !== o.text) alt.setValue(o.text);
          originale.current.set(pfad, alt);
          diffModelle.current.set(pfad, { original: alt, modified: g.modell });
          reiterZeigen({ id: `diff:${pfad}`, pfad, art: 'diff' });
        } catch (e) {
          melden(e instanceof ApiFehler ? e.message : String(e), true);
        }
      })();
    },
    [laden, melden, projekt, reiterZeigen],
  );

  // Reiterwechsel: Modell in den passenden Editor, Ansicht (Rollstand, Schreibmarke) merken und wiederherstellen
  const vorher = useRef<string | null>(null);
  useEffect(() => {
    const e = editor.current;
    const d = diff.current;
    if (!e || !d) return;
    const alt = vorher.current ? dateien.current.get(vorher.current) : undefined;
    if (alt && e.getModel() === alt.modell) alt.ansicht = e.saveViewState();
    vorher.current = null;
    if (!aktiverReiter || aktiverReiter.art === 'hinweis') {
      e.setModel(null);
      return;
    }
    if (aktiverReiter.art === 'diff') {
      const m = diffModelle.current.get(aktiverReiter.pfad);
      if (m && (d.getModel()?.modified !== m.modified || d.getModel()?.original !== m.original)) d.setModel(m);
      return;
    }
    const g = dateien.current.get(aktiverReiter.pfad);
    if (!g) return;
    if (e.getModel() !== g.modell) {
      e.setModel(g.modell);
      if (g.ansicht) e.restoreViewState(g.ansicht);
    }
    vorher.current = aktiverReiter.pfad;
    if (!window.matchMedia('(max-width: 800px)').matches) e.focus();
  }, [aktiverReiter]);

  // ---- Speichern ----
  const speichern = useCallback(
    async (ueberschreiben = false) => {
      const r = reiterRef.current.find((x) => x.id === aktivRef.current);
      if (!r || r.art === 'hinweis') return;
      const g = dateien.current.get(r.pfad);
      if (!g) return melden('Diese Datei gibt es nicht mehr – sie lässt sich hier nicht speichern.', true);
      const stand = g.modell.getAlternativeVersionId();
      try {
        const antwort = await editorApi.speichern(projekt, r.pfad, g.modell.getValue(), ueberschreiben ? undefined : g.version);
        g.version = antwort.version;
        g.gespeichert = stand;
        schmutzSetzen(r.pfad, g.modell.getAlternativeVersionId() !== stand);
        setKonflikt(null);
        melden(`Gespeichert: ${r.pfad}`);
        void qc.invalidateQueries({ queryKey: ['editor-git', projekt] });
      } catch (e) {
        if (e instanceof ApiFehler && e.status === 409 && e.daten.konflikt) return setKonflikt(r.pfad);
        melden(e instanceof ApiFehler ? e.message : String(e), true);
      }
    },
    [melden, projekt, qc, schmutzSetzen],
  );
  const speichernRef = useRef(speichern);
  speichernRef.current = speichern;

  /** Stand vom Server übernehmen (eigene Änderungen an dieser Datei gehen verloren) */
  const neuLaden = useCallback(
    async (pfad: string) => {
      const g = dateien.current.get(pfad);
      if (!g) return;
      const d = await editorApi.datei(projekt, pfad);
      if (d.text === undefined) return;
      if (d.version !== g.version || g.modell.getValue() !== d.text) {
        const ansicht = editor.current?.getModel() === g.modell ? editor.current.saveViewState() : null;
        g.modell.setValue(d.text);
        if (ansicht) editor.current?.restoreViewState(ansicht);
      }
      g.version = d.version;
      g.gespeichert = g.modell.getAlternativeVersionId();
      schmutzSetzen(pfad, false);
    },
    [projekt, schmutzSetzen],
  );

  const schliessenOhneFrage = useCallback(
    (ids: string[]) => {
      const alle = reiterRef.current;
      const bleibt = alle.filter((r) => !ids.includes(r.id));
      if (bleibt.length === alle.length) return;
      // Modelle freigeben, die kein Reiter mehr braucht
      for (const [pfad, g] of dateien.current) {
        if (bleibt.some((r) => r.pfad === pfad)) continue;
        if (editor.current?.getModel() === g.modell) editor.current.setModel(null);
        if (diff.current?.getModel()?.modified === g.modell) diff.current.setModel(null);
        g.horcher.dispose();
        g.modell.dispose();
        dateien.current.delete(pfad);
        diffModelle.current.delete(pfad);
        schmutzSetzen(pfad, false);
      }
      if (aktivRef.current && ids.includes(aktivRef.current)) {
        const i = alle.findIndex((r) => r.id === aktivRef.current);
        setAktiv((bleibt[Math.min(i, bleibt.length - 1)] ?? null)?.id ?? null);
      }
      reiterRef.current = bleibt;
      setReiter(bleibt);
    },
    [schmutzSetzen],
  );

  const schliessen = useCallback(
    async (id: string) => {
      const r = reiterRef.current.find((x) => x.id === id);
      if (!r) return;
      const letzter = !reiterRef.current.some((x) => x.id !== id && x.pfad === r.pfad);
      if (letzter && dateien.current.has(r.pfad) && schmutzigRef.current.has(r.pfad)) {
        const ja = await fragen({ titel: `„${nameVon(r.pfad)}“ schließen?`, text: 'Die Datei hat ungespeicherte Änderungen – sie gehen verloren.', ok: 'Verwerfen und schließen', gefahr: true });
        if (ja === null) return;
      }
      schliessenOhneFrage([id]);
    },
    [fragen, schliessenOhneFrage],
  );
  const schmutzigRef = useRef(schmutzig);
  schmutzigRef.current = schmutzig;

  const werk: Werk = useMemo(
    () => ({
      projekt,
      oeffnen,
      diffOeffnen,
      fragen,
      melden,
      aktivePfad: aktiverReiter?.pfad ?? '',
      dateiWeg: (pfad) => schliessenOhneFrage(reiterRef.current.filter((r) => r.pfad === pfad || r.pfad.startsWith(`${pfad}/`)).map((r) => r.id)),
      ungespeichert: (pfad) => [...schmutzigRef.current].some((p) => p === pfad || p.startsWith(`${pfad}/`)),
      auffrischen: async () => {
        for (const pfad of [...dateien.current.keys()]) {
          if (schmutzigRef.current.has(pfad)) continue;
          await neuLaden(pfad).catch(() => undefined);
        }
        // offene Vergleiche: linke Seite neu holen
        for (const r of reiterRef.current.filter((x) => x.art === 'diff')) {
          const o = await editorApi.git<{ text: string }>(projekt, 'original', { pfad: r.pfad }).catch(() => null);
          const alt = originale.current.get(r.pfad);
          if (o && alt && alt.getValue() !== o.text) alt.setValue(o.text);
        }
      },
    }),
    [projekt, oeffnen, diffOeffnen, fragen, melden, aktiverReiter?.pfad, schliessenOhneFrage, neuLaden],
  );

  // Tastenkürzel auch außerhalb des Editors (Baum, Leisten): Strg+S speichert, Strg+P öffnet die Schnellsuche
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.key.toLowerCase();
      if (t === 's') {
        e.preventDefault();
        void speichernRef.current();
      } else if (t === 'p' && !e.shiftKey) {
        e.preventDefault();
        setSchnell(true);
      } else if (t === 'j' || (t === 'ö' && !e.shiftKey)) {
        e.preventDefault();
        terminalUmschalten();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ungespeichertes: Warnung beim Verlassen der Seite (Neuladen, Schließen des Fensters)
  useEffect(() => {
    if (!schmutzig.size) return;
    const warnen = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [schmutzig.size]);

  // Terminals: Zustand zusätzlich in Refs, damit die Knöpfe ohne Nebenwirkungen in Zustands-Funktionen auskommen
  const terminalsRef = useRef<number[]>([]);
  terminalsRef.current = terminals;
  const terminalOffenRef = useRef(false);
  terminalOffenRef.current = terminalOffen;
  const terminalNeu = () => {
    if (terminalsRef.current.length >= 8) return;
    const n = ++terminalZaehler.current;
    terminalsRef.current = [...terminalsRef.current, n];
    setTerminals(terminalsRef.current);
    setTerminalAktiv(n);
  };
  const terminalUmschalten = () => {
    const auf = !terminalOffenRef.current;
    if (auf && terminalsRef.current.length === 0) terminalNeu();
    terminalOffenRef.current = auf;
    setTerminalOffen(auf);
  };
  const terminalZu = (n: number) => {
    const bleibt = terminalsRef.current.filter((x) => x !== n);
    terminalsRef.current = bleibt;
    setTerminals(bleibt);
    setTerminalAktiv((a) => (a === n ? (bleibt.at(-1) ?? 0) : a));
    if (!bleibt.length) {
      terminalOffenRef.current = false;
      setTerminalOffen(false);
      setBereich((x) => (x === 'terminal' ? 'editor' : x));
    }
  };

  const seiteWaehlen = (s: Seite) => {
    setSeite((alt) => (alt === s && bereich === 'seite' ? (window.matchMedia('(max-width: 800px)').matches ? s : null) : s));
    setBereich('seite');
  };
  const seitenKnopf = (s: Seite, symbol: string, titel: string) => (
    <button type="button" className={`ce-akt${seite === s && bereich === 'seite' ? ' aktiv' : ''}${seite === s ? ' gewaehlt' : ''}`} title={titel} aria-label={titel} aria-pressed={seite === s} onClick={() => seiteWaehlen(s)}>
      <span aria-hidden>{symbol}</span>
      <small>{titel}</small>
    </button>
  );

  return (
    <div className={`codeeditor ${thema} b-${bereich}${seite ? '' : ' ohne-seite'}${terminalOffen ? ' mit-terminal' : ''}`} data-testid="codeeditor">
      <div className="ce-kopf">
        <a href="/gebaeude/Codehaus" onClick={linkKlick} className="zurueck" title="Zurück zum Codehaus">
          ← <span className="ce-breit">Codehaus</span>
        </a>
        <a href={editorUrl()} onClick={linkKlick} className="ce-projekt" title="Anderes Projekt öffnen">
          💻 {projekt}
        </a>
        <button type="button" className="klein ce-schnell-knopf" onClick={() => setSchnell(true)} title="Datei öffnen (Strg+P)" aria-label="Datei öffnen (Strg+P)">
          🔎 <span className="ce-breit">Datei öffnen … </span>
          <kbd className="ce-breit">Strg+P</kbd>
        </button>
        <span className="ce-kopf-rechts">
          <button type="button" className="klein" onClick={() => void speichern()} disabled={!aktiverReiter || aktiverReiter.art === 'hinweis' || !schmutzig.has(aktiverReiter.pfad)} title="Speichern (Strg+S)" data-testid="speichern">
            💾 <span className="ce-breit">Speichern</span>
          </button>
          <button type="button" className="klein" onClick={() => setThema((t) => (t === 'hell' ? 'dunkel' : 'hell'))} title={thema === 'hell' ? 'Dunkles Thema' : 'Helles Thema'} aria-label="Thema umschalten" data-testid="thema">
            {thema === 'hell' ? '🌙' : '☀️'}
          </button>
        </span>
      </div>

      <div className="ce-mitte">
        <nav className="ce-aktleiste" aria-label="Bereiche">
          {seitenKnopf('dateien', '📁', 'Dateien')}
          {seitenKnopf('suche', '🔍', 'Suche')}
          {seitenKnopf('git', '🌿', 'Git')}
          {seitenKnopf('agent', '🤖', 'Agent')}
          <button type="button" className={`ce-akt nur-handy${bereich === 'editor' ? ' aktiv' : ''}`} onClick={() => setBereich('editor')} aria-label="Editor">
            <span aria-hidden>📝</span>
            <small>Editor</small>
          </button>
          <button
            type="button"
            className={`ce-akt${terminalOffen && bereich !== 'seite' && bereich !== 'editor' ? ' aktiv' : ''}${terminalOffen ? ' gewaehlt' : ''}`}
            title="Terminal (Strg+J)"
            aria-label="Terminal"
            aria-pressed={terminalOffen}
            data-testid="terminal-knopf"
            onClick={() => {
              if (window.matchMedia('(max-width: 800px)').matches) {
                if (!terminalOffen) terminalUmschalten();
                setBereich('terminal');
              } else terminalUmschalten();
            }}
          >
            <span aria-hidden>⌨️</span>
            <small>Terminal</small>
          </button>
        </nav>

        {seite && (
          <aside className="ce-seite">
            {/* Baum bleibt eingehängt (aufgeklappte Ordner bleiben), die anderen Leisten laden bei Bedarf */}
            <div style={{ display: seite === 'dateien' ? 'contents' : 'none' }}>
              <BaumLeiste w={werk} />
            </div>
            {seite === 'suche' && <SuchLeiste w={werk} />}
            {seite === 'git' && <GitLeiste w={werk} />}
            {seite === 'agent' && <AgentLeiste w={werk} />}
          </aside>
        )}

        <div className="ce-haupt">
          <div className="ce-arbeit">
            <div className="ce-reiter" role="tablist" aria-label="Offene Dateien">
              {reiter.map((r) => (
                <div key={r.id} className={`ce-tab${r.id === aktiv ? ' aktiv' : ''}`} role="tab" aria-selected={r.id === aktiv} title={r.pfad} data-ungespeichert={schmutzig.has(r.pfad) ? 'ja' : 'nein'}>
                  <button type="button" className="ce-tab-name" onClick={() => setAktiv(r.id)}>
                    {r.art === 'diff' ? '± ' : ''}
                    {nameVon(r.pfad)}
                    {schmutzig.has(r.pfad) && (
                      <span className="ce-punkt" title="ungespeichert" aria-label="ungespeichert">
                        {' '}
                        ●
                      </span>
                    )}
                  </button>
                  <button type="button" className="ce-tab-zu" aria-label={`${nameVon(r.pfad)} schließen`} title="Schließen" onClick={() => void schliessen(r.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {konflikt && (
              <div className="ce-konflikt" role="alert">
                <strong>{nameVon(konflikt)}</strong> wurde inzwischen von jemand anderem geändert (Agent, Terminal, Git). Nichts wurde überschrieben.
                <span className="ce-knoepfe">
                  <button type="button" className="klein" onClick={() => void neuLaden(konflikt).then(() => setKonflikt(null))}>
                    Neu laden (meine Änderungen verwerfen)
                  </button>
                  <button type="button" className="klein gefahr" onClick={() => void speichern(true)}>
                    Meine Fassung speichern
                  </button>
                  <button type="button" className="klein" onClick={() => setKonflikt(null)}>
                    Später
                  </button>
                </span>
              </div>
            )}
            <div className="ce-editor">
              <div ref={editorEl} className="ce-monaco" style={{ display: aktiverReiter?.art === 'datei' ? undefined : 'none' }} data-testid="monaco" />
              <div ref={diffEl} className="ce-monaco" style={{ display: aktiverReiter?.art === 'diff' ? undefined : 'none' }} data-testid="monaco-diff" />
              {aktiverReiter?.art === 'hinweis' && (
                <div className="ce-leer">
                  <p>{aktiverReiter.hinweis}</p>
                  <a className="knopf" href={editorApi.rohUrl(projekt, aktiverReiter.pfad)} download={nameVon(aktiverReiter.pfad)}>
                    ⬇ Herunterladen
                  </a>
                </div>
              )}
              {!aktiverReiter && (
                <div className="ce-leer">
                  <p>
                    <strong>{projekt}</strong>
                  </p>
                  <p className="leise">
                    Datei links im Baum wählen oder mit <kbd>Strg+P</kbd> suchen. <kbd>Strg+S</kbd> speichert, <kbd>Strg+F</kbd> sucht in der Datei, <kbd>Strg+H</kbd> ersetzt, <kbd>Strg+J</kbd> öffnet das Terminal,{' '}
                    <kbd>F1</kbd> zeigt alle Befehle.
                  </p>
                </div>
              )}
            </div>
          </div>

          {terminalOffen && (
            <div className="ce-terminals">
              <div className="ce-terminal-kopf">
                <strong className="ce-breit">Terminal</strong>
                {terminals.map((n, i) => (
                  <span key={n} className={`ce-tab${n === terminalAktiv ? ' aktiv' : ''}`}>
                    <button type="button" className="ce-tab-name" onClick={() => setTerminalAktiv(n)}>
                      {i + 1}: bash
                    </button>
                    <button type="button" className="ce-tab-zu" aria-label={`Terminal ${i + 1} schließen`} onClick={() => terminalZu(n)}>
                      ✕
                    </button>
                  </span>
                ))}
                <button type="button" className="klein ce-symbol" onClick={terminalNeu} disabled={terminals.length >= 8} title="Weiteres Terminal" aria-label="Weiteres Terminal">
                  ＋
                </button>
                <span className="ce-kopf-rechts">
                  <button type="button" className="klein ce-symbol ce-nur-breit" onClick={() => setTerminalOffen(false)} title="Terminal ausblenden (läuft weiter)" aria-label="Terminal ausblenden">
                    ▾
                  </button>
                </span>
              </div>
              {terminals.map((n) => (
                <TerminalFeld key={n} projekt={projekt} thema={thema} sichtbar={n === terminalAktiv} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ce-fuss">
        <span className="ce-fuss-pfad">{aktiverReiter ? aktiverReiter.pfad : 'keine Datei offen'}</span>
        {aktiverReiter?.art === 'datei' && (
          <span>
            Zeile {zeiger.zeile}, Spalte {zeiger.spalte}
          </span>
        )}
        {aktiverReiter && aktiverReiter.art !== 'hinweis' && <span data-testid="stand">{schmutzig.has(aktiverReiter.pfad) ? '● ungespeichert' : 'gespeichert'}</span>}
        {meldung && (
          <span className={`ce-meldung${meldung.fehler ? ' fehler' : ''}`} role="status" data-testid="meldung">
            {meldung.text}
          </span>
        )}
      </div>

      {schnell && <SchnellSuche projekt={projekt} zu={() => setSchnell(false)} oeffnen={oeffnen} />}
      {frage && (
        <FrageFenster
          frage={frage.opt}
          antwort={(w) => {
            frage.antwort(w);
            setFrage(null);
          }}
        />
      )}
    </div>
  );
}

/** Strg+P: Datei über ihren Namen öffnen (Liste von ripgrep im Container, beachtet .gitignore) */
function SchnellSuche({ projekt, zu, oeffnen }: { projekt: string; zu: () => void; oeffnen: (pfad: string) => void }) {
  const liste = useQuery({ queryKey: ['editor-dateien', projekt], queryFn: () => editorApi.dateien(projekt), staleTime: 30_000 });
  const [text, setText] = useState('');
  const [wahl, setWahl] = useState(0);
  const treffer = useMemo(() => schnellFiltern(liste.data?.dateien ?? [], text), [liste.data, text]);
  const nimm = (pfad: string | undefined) => {
    if (!pfad) return;
    oeffnen(pfad);
    zu();
  };
  return (
    <div className="fenster-hintergrund ce-schnell-hintergrund" onClick={zu}>
      <div className="karte ce-schnell" role="dialog" aria-modal="true" aria-label="Datei öffnen" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setWahl(0);
          }}
          placeholder="Dateiname …"
          aria-label="Datei öffnen"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape') zu();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setWahl((w) => Math.min(w + 1, treffer.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setWahl((w) => Math.max(w - 1, 0));
            } else if (e.key === 'Enter') nimm(treffer[wahl]);
          }}
        />
        {liste.isPending && <p className="leise">Lade Dateiliste …</p>}
        {liste.isError && <p className="fehler">{liste.error.message}</p>}
        <ul className="ce-schnell-liste" data-testid="schnell-liste">
          {treffer.map((p, i) => (
            <li key={p}>
              <button type="button" className={`ce-zeile ce-eintrag${i === wahl ? ' markiert' : ''}`} onClick={() => nimm(p)}>
                {nameVon(p)} <span className="leise">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        {liste.data && treffer.length === 0 && <p className="leise">Nichts gefunden.</p>}
        {liste.data?.gekuerzt && <p className="leise">Die Liste ist gekürzt (sehr großes Projekt).</p>}
      </div>
    </div>
  );
}
