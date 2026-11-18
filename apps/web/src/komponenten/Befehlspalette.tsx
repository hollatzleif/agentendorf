import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { terminAusText, type AktionInfo, type Gebaeude, type Suchtreffer, type TodoInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, navigieren } from '../router';

/**
 * Befehlspalette (Strg/⌘+K, Nacht 18./19.11.): ein Feld für alles.
 *  - suchen: Gebäude, Seiten, offene To-dos, Aktionen, Bibliothek (Volltext)
 *  - Befehle: „todo …“, „termin morgen 14 Uhr …“, „fokus [Thema]“, „timer 10 [Name]“, „frag …“ (an den Bürgermeister)
 * Ohne Befehlswort werden Treffer gezeigt und unten die passenden Befehle angeboten.
 */
type Eintrag = { id: string; symbol: string; titel: string; zusatz?: string; tun: () => Promise<string | void> | string | void };

const SEITEN: [string, string, string][] = [
  ['🏡', 'Dorf', '/'],
  ['📚', 'Bibliothek', '/bibliothek'],
  ['⚙️', 'Einstellungen', '/einstellungen'],
  ['📅', 'Kalender', '/gebaeude/Marktplatz?reiter=kalender'],
  ['🧺', 'To-do-Brett', '/gebaeude/Marktplatz?reiter=todo'],
  ['🔔', 'Kirchturm (Uhr, Pomodoro)', '/gebaeude/Kirchturm'],
  ['🗓️', 'Wochenrückblick', '/gebaeude/Rathaus?reiter=woche'],
  ['📊', 'Statistik', '/gebaeude/Rathaus?reiter=statistik'],
  ['📝', 'Notizen', '/gebaeude/Rathaus?reiter=notizen'],
  ['🎓', 'Noten & ECTS', '/gebaeude/Uni?reiter=noten'],
  ['📋', 'Heute (Mein Tag)', '/heute'],
  ['🍅', 'Fokus-Vollbild', '/fokus'],
  ['🧭', 'So nutzt du das Dorf (Anleitung)', '/anleitung'],
  ['☀️', 'Morgenzeitung', '/gebaeude/Rathaus?reiter=morgenzeitung'],
  ['✉️', 'Freigaben', '/gebaeude/Rathaus?reiter=freigaben'],
];

const passt = (text: string, q: string) => {
  const t = text.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w));
};

export function Befehlspalette() {
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOffen((o) => !o);
      }
    };
    const auf = () => setOffen(true);
    window.addEventListener('keydown', k);
    window.addEventListener('dorf:palette', auf);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('dorf:palette', auf);
    };
  }, []);
  if (!offen) return null;
  return <Palette schliessen={() => setOffen(false)} />;
}

function Palette({ schliessen }: { schliessen: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [wahl, setWahl] = useState(0);
  const [meldung, setMeldung] = useState('');
  const [bestaetigen, setBestaetigen] = useState<string | null>(null);
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => feld.current?.focus(), []);

  const gebaeude = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const aktionen = useQuery({ queryKey: ['aktionen', 'alle'], queryFn: () => api<AktionInfo[]>('/api/aktionen') });
  const suche = q.trim().length >= 3 && !/^(todo|termin|fokus|timer|frag)\b/i.test(q.trim());
  const treffer = useQuery({ queryKey: ['suche', q.trim()], queryFn: () => api<Suchtreffer[]>(`/api/vault/suche?q=${encodeURIComponent(q.trim())}`), enabled: suche });

  const gehe = (url: string) => {
    navigieren(url);
    schliessen();
  };

  const eintraege = useMemo((): Eintrag[] => {
    const t = q.trim();
    const befehl = /^(todo|termin|fokus|timer|frag|notiz)\b\s*(.*)$/i.exec(t);
    const rest = befehl?.[2]?.trim() ?? '';
    const aus: Eintrag[] = [];
    // Befehle
    const termin = terminAusText(befehl?.[1]?.toLowerCase() === 'termin' ? rest : t, Date.now());
    const terminText = termin ? `${termin.titel} · ${termin.ganztags ? new Date(`${termin.start}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }) + ' (ganztags)' : `${new Date(`${termin.start.slice(0, 10)}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}, ${termin.start.slice(11)}–${termin.ende.slice(11)}`}${termin.ort ? ` · 📍 ${termin.ort}` : ''}` : '';
    const todoText = befehl?.[1]?.toLowerCase() === 'todo' ? rest : t;
    const cmds: Eintrag[] = [];
    if (todoText && (!befehl || befehl[1]!.toLowerCase() === 'todo'))
      cmds.push({
        id: 'cmd:todo',
        symbol: '➕',
        titel: `To-do anlegen: ${todoText}`,
        tun: async () => {
          await api('/api/todos', { body: { titel: todoText.slice(0, 200) } });
          void qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
          return `✅ To-do angelegt: ${todoText}`;
        },
      });
    if (termin && (!befehl || befehl[1]!.toLowerCase() === 'termin') && (befehl || /\d|heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag/i.test(t)))
      cmds.push({
        id: 'cmd:termin',
        symbol: '📅',
        titel: `Termin eintragen: ${terminText}`,
        zusatz: 'Enter zeigt die Vorschau, noch einmal Enter trägt ein',
        tun: async () => {
          if (bestaetigen !== terminText) {
            setBestaetigen(terminText);
            return `Eintragen? ${terminText} – Enter zum Bestätigen`;
          }
          await api('/api/kalender/schnell', { body: { text: befehl?.[1]?.toLowerCase() === 'termin' ? rest : t } });
          void qc.invalidateQueries({ queryKey: ['kalender'] });
          setBestaetigen(null);
          return `📅 Eingetragen: ${terminText}`;
        },
      });
    if (befehl?.[1]?.toLowerCase() === 'fokus' || (!befehl && passt('fokus pomodoro', t)))
      cmds.push({
        id: 'cmd:fokus',
        symbol: '🍅',
        titel: `Fokus starten${rest ? `: ${rest}` : ''}`,
        tun: async () => {
          await api('/api/kirchturm', { body: rest ? { befehl: 'pomodoro_fuer', titel: rest.slice(0, 200) } : { befehl: 'pomodoro', aktion: 'start' } });
          return '🍅 Fokus läuft.';
        },
      });
    const tm = /^(\d{1,3})\s*(?:min)?\s*(.*)$/i.exec(rest);
    if (befehl?.[1]?.toLowerCase() === 'timer' && tm)
      cmds.push({
        id: 'cmd:timer',
        symbol: '⏳',
        titel: `Timer ${tm[1]} min${tm[2] ? `: ${tm[2]}` : ''}`,
        tun: async () => {
          await api('/api/kirchturm', { body: { befehl: 'timer_start', name: tm[2]?.slice(0, 60) ?? '', dauerMs: Number(tm[1]) * 60_000 } });
          return `⏳ Timer ${tm[1]} min läuft.`;
        },
      });
    if (befehl?.[1]?.toLowerCase() === 'notiz' && rest)
      cmds.push({
        id: 'cmd:notiz',
        symbol: '📝',
        titel: `Notiz: ${rest}`,
        zusatz: 'in die Tagesnotiz (Rathaus/notizen)',
        tun: async () => {
          await api('/api/notiz', { body: { text: rest } });
          return '📝 Notiert.';
        },
      });
    if (befehl?.[1]?.toLowerCase() === 'frag' && rest)
      cmds.push({
        id: 'cmd:frag',
        symbol: '🎩',
        titel: `Den Bürgermeister fragen: ${rest}`,
        tun: async () => {
          const f = new FormData();
          f.append('text', rest);
          await api('/api/schreibtisch', { formular: f });
          return '🎩 Liegt auf dem Schreibtisch des Bürgermeisters.';
        },
      });
    if (befehl) return cmds;
    // Treffer
    for (const [symbol, titel, url] of SEITEN) if (!t || passt(titel, t)) aus.push({ id: `seite:${url}`, symbol, titel, tun: () => gehe(url) });
    for (const g of gebaeude.data ?? []) if (!t || passt(`${g.name} ${g.id}`, t)) aus.push({ id: `g:${g.id}`, symbol: g.symbol, titel: g.name, zusatz: 'Gebäude', tun: () => gehe(`/gebaeude/${encodeURIComponent(g.id)}`) });
    if (t) {
      for (const x of (todos.data ?? []).filter((y) => !y.erledigt && passt(y.titel, t)).slice(0, 6))
        aus.push({ id: `t:${x.pfad}`, symbol: '☐', titel: x.titel, zusatz: x.faellig ? `To-do · fällig ${x.faellig}` : 'To-do', tun: () => gehe('/gebaeude/Marktplatz?reiter=todo') });
      for (const a of (aktionen.data ?? []).filter((y) => passt(`${y.name} ${y.gebaeude} ${y.beschreibung}`, t)).slice(0, 6))
        aus.push({ id: `a:${a.id}`, symbol: '⚡', titel: a.name, zusatz: `Aktion · ${a.gebaeude}`, tun: () => gehe(`/gebaeude/${encodeURIComponent(a.gebaeude)}?reiter=aktionen&aktion=${encodeURIComponent(a.id)}`) });
      for (const s of (treffer.data ?? []).slice(0, 8)) aus.push({ id: `v:${s.pfad}`, symbol: '📄', titel: s.titel, zusatz: s.pfad, tun: () => gehe(bibliothekUrl(s.pfad)) });
    }
    return [...aus.slice(0, 30), ...(t ? cmds : [])];
  }, [q, gebaeude.data, todos.data, aktionen.data, treffer.data, bestaetigen, qc]);

  useEffect(() => setWahl(0), [q]);
  const ausfuehren = async (e?: Eintrag) => {
    if (!e) return;
    setMeldung('');
    try {
      const r = await e.tun();
      if (typeof r === 'string') {
        setMeldung(r);
        if (!r.startsWith('Eintragen?')) setQ('');
      }
    } catch (err) {
      setMeldung(`⚠️ ${err instanceof ApiFehler ? err.message : String(err)}`);
    }
  };

  return (
    <div className="fenster-hintergrund palette-hintergrund" onClick={schliessen}>
      <div className="palette karte" role="dialog" aria-label="Befehlspalette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={feld}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setWahl(0); // sofort, nicht erst im Effekt – sonst kann ein schnelles Enter ins Leere gehen
            setBestaetigen(null);
          }}
          placeholder="Suchen oder: todo …, termin morgen 14 Uhr …, notiz …, fokus …, timer 10 …, frag …"
          aria-label="Befehl oder Suche"
          onKeyDown={(e) => {
            if (e.key === 'Escape') schliessen();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setWahl((w) => Math.min(eintraege.length - 1, w + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setWahl((w) => Math.max(0, w - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void ausfuehren(eintraege[Math.min(wahl, eintraege.length - 1)]);
            }
          }}
        />
        {meldung && <p className="hinweis palette-meldung">{meldung}</p>}
        <ul className="palette-liste" role="listbox" aria-label="Treffer">
          {eintraege.map((e, i) => (
            <li key={e.id} role="option" aria-selected={i === wahl} className={i === wahl ? 'gewaehlt' : ''} onMouseEnter={() => setWahl(i)} onClick={() => void ausfuehren(e)}>
              <span className="palette-symbol">{e.symbol}</span>
              <span className="palette-titel">{e.titel}</span>
              {e.zusatz && <span className="leise palette-zusatz">{e.zusatz}</span>}
            </li>
          ))}
        </ul>
        <p className="leise palette-hilfe">↑↓ wählen · Enter ausführen · Esc schließen · Strg/⌘+K öffnet überall</p>
      </div>
    </div>
  );
}
