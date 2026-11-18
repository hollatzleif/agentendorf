import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KalenderAntwort, KalenderTermin, TodoInfo, WochenzieleStand } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { ort, tagPlus } from './MarktKalender';
import { minutenText } from '../tagesbudget';

/**
 * E121: Wochenplan – die To-dos der Woche als Spalten Mo–So, links der Eingang (ohne Datum, Überfälliges).
 * Verschieben per Ziehen (PC) oder Auswahl (Handy) setzt nur das Fälligkeitsdatum. Je Tag: geschätzte Zeit (E120)
 * plus Termine gegen die Tageszeit 8–22 Uhr – so sieht man beim Sonntags-Planen, welcher Tag schon voll ist.
 */
const TAG_MIN = 14 * 60; // 8–22 Uhr
const wochentag = (tag: string) => (new Date(`${tag}T12:00:00Z`).getUTCDay() + 6) % 7;
const tagKurz = (tag: string) => new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

function terminMinuten(termine: KalenderTermin[], tag: string) {
  // nur Termine mit Uhrzeit, auf 8–22 Uhr des Tages begrenzt
  let summe = 0;
  for (const t of termine) {
    if (t.ganztags) continue;
    const a = ort(t.start);
    const b = ort(t.ende);
    if (a.tag > tag || b.tag < tag) continue;
    const von = Math.max(a.tag < tag ? 0 : a.min, 8 * 60);
    const bis = Math.min(b.tag > tag ? 24 * 60 : b.min, 22 * 60);
    if (bis > von) summe += bis - von;
  }
  return summe;
}

export function WochenPlan() {
  const qc = useQueryClient();
  const heute = ort(new Date().toISOString()).tag;
  const [versatz, setVersatz] = useState(0);
  const montag = tagPlus(tagPlus(heute, -wochentag(heute)), 7 * versatz);
  const tage = Array.from({ length: 7 }, (_, i) => tagPlus(montag, i));
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const von = new Date(Date.parse(`${montag}T00:00:00Z`) - 3 * 3600_000).toISOString();
  const bis = new Date(Date.parse(`${tagPlus(montag, 7)}T00:00:00Z`) + 3 * 3600_000).toISOString();
  const kalender = useQuery({ queryKey: ['kalender', von, bis], queryFn: () => api<KalenderAntwort>(`/api/kalender?von=${von}&bis=${bis}`), placeholderData: (alt) => alt });
  const ziele = useQuery({ queryKey: ['liste', 'wochenziele'], queryFn: () => api<WochenzieleStand>('/api/wochenziele') });
  const [fehler, setFehler] = useState('');
  const [ziehe, setZiehe] = useState<string | null>(null);
  const [ueber, setUeber] = useState<string | null>(null);

  const offen = (todos.data ?? []).filter((t) => !t.erledigt);
  // Überfälliges aus früheren Wochen landet im Eingang; was in dieser Woche liegt, steht (rot) in seiner Spalte
  const eingang = offen.filter((t) => !t.faellig || (versatz === 0 && t.faellig < heute && t.faellig < tage[0]!)).sort((a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9').localeCompare(b.faellig ?? '9'));
  const amTag = (tag: string) => offen.filter((t) => t.faellig === tag);
  const erledigtAm = (tag: string) => (todos.data ?? []).filter((t) => t.erledigt && t.erledigtAm && ort(t.erledigtAm).tag === tag).length;
  const aus = (() => {
    try {
      return JSON.parse(localStorage.getItem('kalender-aus') ?? '[]') as string[];
    } catch {
      return [];
    }
  })();
  const termine = (kalender.data?.termine ?? []).filter((t) => !aus.includes(t.kalenderId));

  const verschieben = async (pfad: string, faellig: string) => {
    const t = offen.find((x) => x.pfad === pfad);
    if (!t || (t.faellig ?? '') === faellig) return;
    setFehler('');
    // sofort zeigen, der Server bestätigt gleich
    qc.setQueryData<TodoInfo[]>(['liste', 'todo'], (l) => l?.map((x) => (x.pfad === pfad ? { ...x, faellig: faellig || undefined } : x)));
    try {
      await api('/api/todos', { methode: 'PATCH', body: { pfad, basisVersion: t.version, faellig } });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
  };
  const ablegen = (ziel: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const pfad = e.dataTransfer.getData('text/x-dorf-todo') || ziehe;
    setZiehe(null);
    setUeber(null);
    if (pfad) void verschieben(pfad, ziel);
  };
  const zone = (ziel: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!ziehe && !e.dataTransfer.types.includes('text/x-dorf-todo')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setUeber(ziel);
    },
    onDragLeave: () => setUeber((u) => (u === ziel ? null : u)),
    onDrop: ablegen(ziel),
  });

  const karte = (t: TodoInfo) => (
    <li
      key={t.pfad}
      className={`wplan-karte${t.wichtig ? ' wichtig' : ''}${t.faellig && t.faellig < heute ? ' ueberfaellig' : ''}${ziehe === t.pfad ? ' zieht' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-dorf-todo', t.pfad);
        e.dataTransfer.effectAllowed = 'move';
        setZiehe(t.pfad);
      }}
      onDragEnd={() => {
        setZiehe(null);
        setUeber(null);
      }}
    >
      <span className="wplan-titel">
        {t.wichtig && '⭐ '}
        {t.titel}
      </span>
      <span className="wplan-meta">
        {t.dauer && <span>⏱ {minutenText(t.dauer)}</span>}
        {t.schritte?.length ? (
          <span>
            ☑ {t.schritte.filter((s) => s.erledigt).length}/{t.schritte.length}
          </span>
        ) : null}
        {t.faellig && t.faellig < heute && <span className="warnung">seit {tagKurz(t.faellig)}</span>}
        <select className="wplan-wahl" value={t.faellig && tage.includes(t.faellig) ? t.faellig : ''} onChange={(e) => void verschieben(t.pfad, e.target.value)} aria-label={`Tag für ${t.titel}`}>
          <option value="">{t.faellig && !tage.includes(t.faellig) ? tagKurz(t.faellig) : 'ohne Datum'}</option>
          {tage.map((d) => (
            <option key={d} value={d}>
              {tagKurz(d)}
            </option>
          ))}
        </select>
      </span>
    </li>
  );

  return (
    <section className="wplan" aria-label="Wochenplan">
      <div className="wplan-kopf">
        <button type="button" className="klein" onClick={() => setVersatz(versatz - 1)} aria-label="Vorige Woche">
          ‹
        </button>
        <strong>
          {tagKurz(tage[0]!)} – {tagKurz(tage[6]!)}
        </strong>
        <button type="button" className="klein" onClick={() => setVersatz(versatz + 1)} aria-label="Nächste Woche">
          ›
        </button>
        {versatz !== 0 && (
          <button type="button" className="klein" onClick={() => setVersatz(0)}>
            Diese Woche
          </button>
        )}
        {versatz === 0 && ziele.data && ziele.data.ziele.length > 0 && (
          <span className="wplan-ziele" title="Wochenziele (Heute)">
            🎯 {ziele.data.ziele.map((z) => (z.erledigt ? `✓ ${z.text}` : z.text)).join(' · ')}
          </span>
        )}
      </div>
      <p className="leise wplan-tipp">Ziehen (PC) oder Tag auswählen (Handy) – das setzt nur das Fälligkeitsdatum. Die Leiste zeigt geschätzte Zeit und Termine gegen 8–22 Uhr.
        <span className="wplan-legende" aria-hidden>
          <span>
            <i className="wplan-last-termine" />
            Termine
          </span>
          <span>
            <i className="wplan-last-todos" />
            To-dos
          </span>
          <span>
            <i className="zu-voll" />
            zu voll
          </span>
        </span>
      </p>
      {fehler && <p className="fehler">{fehler}</p>}
      {todos.isError && <p className="fehler">To-dos nicht erreichbar: {todos.error.message}</p>}
      <div className="wplan-spalten">
        <div className={`wplan-spalte eingang${ueber === '' ? ' ueber' : ''}`} {...zone('')} aria-label="Ohne Datum">
          <h3>📥 Ohne Datum{versatz === 0 ? ' & Überfälliges' : ''}</h3>
          <ul>{eingang.map(karte)}</ul>
          {todos.data && !eingang.length && <p className="leise">Leer – alles eingeplant.</p>}
        </div>
        {tage.map((tag) => {
          const l = amTag(tag);
          const geplant = l.reduce((s, t) => s + (t.dauer ?? 0), 0);
          const ohne = l.filter((t) => !t.dauer).length;
          const term = terminMinuten(termine, tag);
          const voll = Math.min(1, (geplant + term) / TAG_MIN);
          const zuViel = geplant + term > TAG_MIN;
          const ganztags = termine.filter((t) => t.ganztags && t.start <= tag && tag < t.ende);
          const fertig = erledigtAm(tag);
          return (
            <div key={tag} className={`wplan-spalte${tag === heute ? ' heute' : ''}${tag < heute ? ' vorbei' : ''}${l.length === 0 && term === 0 ? ' leer' : ''}${ueber === tag ? ' ueber' : ''}`} {...zone(tag)} aria-label={tagKurz(tag)}>
              <h3>
                {tagKurz(tag)}
                {tag === heute && <span className="abzeichen">heute</span>}
              </h3>
              <div className={`wplan-last${zuViel ? ' voll' : ''}`} title={`${minutenText(geplant)} geschätzt${ohne ? ` (+${ohne} ohne Schätzung)` : ''} · ${minutenText(term)} Termine`}>
                <span className="wplan-last-termine" style={{ width: `${Math.min(1, term / TAG_MIN) * 100}%` }} />
                <span className="wplan-last-todos" style={{ width: `${Math.max(0, voll - Math.min(1, term / TAG_MIN)) * 100}%` }} />
              </div>
              <span className={`wplan-summe${zuViel ? ' voll' : ''}`}>
                {l.length} To-do{l.length === 1 ? '' : 's'}
                {geplant > 0 && ` · ⏱ ${minutenText(geplant)}`}
                {term > 0 && ` · 📅 ${minutenText(term)}`}
                {fertig > 0 && ` · ✓ ${fertig}`}
              </span>
              {ganztags.length > 0 && <span className="leise wplan-ganztags">📌 {ganztags.map((t) => t.titel).join(', ')}</span>}
              <ul>{l.map(karte)}</ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
