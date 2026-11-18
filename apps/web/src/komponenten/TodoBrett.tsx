import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TodoInfo } from '@dorf/shared';
import { api, ApiFehler, offlineGemerkt } from '../api';
import { bibliothekUrl, linkKlick, navigieren } from '../router';
import { LernzeitPlaner } from './LernzeitPlaner';
import { Stern } from '../seiten/Heute';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const datumText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' });

/**
 * To-do-Brett auf dem Marktplatz (E65): immer aktuell (Live-Ereignis), abhaken, anlegen, bearbeiten, löschen.
 * Jedes To-do ist eine Datei in Marktplatz/todos/ – auch Agenten und Telegram pflegen sie.
 */
export function TodoBrett({ liste: name = 'todo', platzhalter = 'Neues To-do …', gruppiert = false }: { liste?: string; platzhalter?: string; gruppiert?: boolean } = {}) {
  const qc = useQueryClient();
  const basis = name === 'todo' ? '/api/todos' : `/api/listen/${name}`;
  const liste = useQuery({ queryKey: ['liste', name], queryFn: () => api<TodoInfo[]>(basis) });
  const [titel, setTitel] = useState('');
  const [faellig, setFaellig] = useState('');
  const [fehler, setFehler] = useState('');
  const neu = () => qc.invalidateQueries({ queryKey: ['liste', name] });
  const ausfuehren = async (f: () => Promise<unknown>) => {
    setFehler('');
    try {
      await f();
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
      if (offlineGemerkt(e)) return true;
    }
    await neu();
    return false;
  };

  const anlegen = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titel.trim()) return;
    void ausfuehren(async () => {
      await api(basis, { body: { titel: titel.trim(), ...(faellig ? { faellig } : {}) } });
      setTitel('');
      setFaellig('');
    }).then((offline) => {
      // offline gemerkt: Feld leeren, sonst tippt man es nochmal und es kommt doppelt an
      if (offline) {
        setTitel('');
        setFaellig('');
      }
    });
  };

  const offen = (liste.data?.filter((t) => !t.erledigt) ?? []).slice();
  // Einkaufsliste: nach Abteilung sortiert, damit man im Laden der Reihe nach abhakt
  if (gruppiert) offen.sort((a, b) => (a.gruppe ?? 'zzz').localeCompare(b.gruppe ?? 'zzz', 'de') || a.titel.localeCompare(b.titel, 'de'));
  const erledigt = liste.data?.filter((t) => t.erledigt) ?? [];
  return (
    <div className="todo-brett">
      <form className="todo-neu" onSubmit={anlegen} aria-label="Neues To-do">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={platzhalter} maxLength={200} aria-label="Neues To-do" />
        <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
        <button type="submit" className="haupt">
          +
        </button>
      </form>
      {fehler && <p className="fehler">{fehler}</p>}
      {liste.isLoading && <p className="leise">Lade …</p>}
      {liste.data && !offen.length && <p className="leise">Nichts offen. 🎉</p>}
      <ul className="todo-liste">
        {offen.map((t) => (
          <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} basis={basis} />
        ))}
      </ul>
      {erledigt.length > 0 && (
        <details>
          <summary>Erledigt ({erledigt.length})</summary>
          <ul className="todo-liste erledigt">
            {erledigt.map((t) => (
              <TodoZeile key={`${t.pfad}:${t.version}`} t={t} ausfuehren={ausfuehren} basis={basis} />
            ))}
          </ul>
        </details>
      )}
      <p className="leise">
        {name === 'einkauf'
          ? 'Auch per Telegram: /einkauf. Der Essensplan setzt Zutaten von selbst drauf.'
          : name === 'todo'
            ? 'Auch in Obsidian unter Marktplatz/todos/ – und per Telegram: /todo. Gelöschtes liegt im Papierkorb.'
            : 'Gelöschtes liegt im Papierkorb.'}
      </p>
    </div>
  );
}

/** E94: „heute 18:00“, „morgen 09:00“, sonst „Fr., 20.11. 14:00“ (Ortszeit wie gespeichert) */
function erinnerungText(z: string) {
  const tag = z.slice(0, 10);
  const h = heute();
  const morgen = new Date(Date.parse(`${h}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const wann = tag === h ? 'heute' : tag === morgen ? 'morgen' : new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${wann} ${z.slice(11, 16)}`;
}

/** E92: Auswahl für wiederkehrende To-dos (Obsidian: Feld „wiederholen“, auch „alle 3 tage“ usw.) */
const WIEDERHOLEN_WAHL = [
  ['', 'Nicht wiederholen'],
  ['täglich', '🔁 täglich'],
  ['werktags', '🔁 werktags'],
  ['wöchentlich', '🔁 wöchentlich'],
  ['alle 2 wochen', '🔁 alle 2 Wochen'],
  ['monatlich', '🔁 monatlich'],
  ['jährlich', '🔁 jährlich'],
] as const;

function TodoZeile({ t, ausfuehren, basis }: { t: TodoInfo; ausfuehren: (f: () => Promise<unknown>) => Promise<unknown>; basis: string }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [titel, setTitel] = useState(t.titel);
  const [faellig, setFaellig] = useState(t.faellig ?? '');
  const [notiz, setNotiz] = useState(t.notiz ?? '');
  const [gruppe, setGruppe] = useState(t.gruppe ?? '');
  const [wiederholen, setWiederholen] = useState(t.wiederholen ?? '');
  const [erinnerung, setErinnerung] = useState(t.erinnerung ?? '');
  // Häkchen sofort zeigen; die Zeile wird mit der neuen Version vom Server ohnehin neu aufgebaut
  const [haken, setHaken] = useState(t.erledigt);
  const [planen, setPlanen] = useState(false);
  const aendern = (a: Record<string, unknown>) => ausfuehren(() => api(basis, { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, ...a } }));
  const ueberfaellig = !t.erledigt && t.faellig && t.faellig < heute();
  const vonAgent = t.quelle && t.quelle !== 'Leif' && t.quelle !== 'Telegram';

  if (bearbeiten)
    return (
      <li className="todo bearbeiten">
        <form
          className="formspalte"
          onSubmit={(e) => {
            e.preventDefault();
            void aendern({ titel, faellig, notiz, gruppe, ...(wiederholen !== (t.wiederholen ?? '') ? { wiederholen } : {}), ...(erinnerung !== (t.erinnerung ?? '') ? { erinnerung: erinnerung.slice(0, 16) } : {}) }).then(() => setBearbeiten(false));
          }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} aria-label="Titel" />
          <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
          <input value={gruppe} onChange={(e) => setGruppe(e.target.value)} maxLength={60} placeholder="Gruppe (Abteilung, Amt …)" aria-label="Gruppe" />
          <label className="todo-erinnerung">
            🔔 Erinnerung
            <input type="datetime-local" value={erinnerung} onChange={(e) => setErinnerung(e.target.value)} aria-label="Erinnerung" />
          </label>
          <select value={wiederholen} onChange={(e) => setWiederholen(e.target.value)} aria-label="Wiederholen">
            {[...WIEDERHOLEN_WAHL, ...(wiederholen && !WIEDERHOLEN_WAHL.some(([w]) => w === wiederholen) ? [[wiederholen, `🔁 ${wiederholen}`] as const] : [])].map(([w, text]) => (
              <option key={w} value={w}>
                {text}
              </option>
            ))}
          </select>
          <textarea rows={3} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz" aria-label="Notiz" />
          <div className="zeile">
            <button type="submit" className="haupt">
              Speichern
            </button>
            <button type="button" onClick={() => setBearbeiten(false)}>
              Abbrechen
            </button>
            <button type="button" className="gefahr" onClick={() => void ausfuehren(() => api(`${basis}?pfad=${encodeURIComponent(t.pfad)}`, { methode: 'DELETE' }))}>
              Löschen
            </button>
          </div>
        </form>
      </li>
    );
  return (
    <li className={`todo${t.erledigt ? ' fertig' : ''}${ueberfaellig ? ' ueberfaellig' : ''}`}>
      {basis === '/api/todos' && !t.erledigt && <Stern t={t} />}
      <label className="todo-haken">
        <input
          type="checkbox"
          checked={haken}
          onChange={(e) => {
            setHaken(e.target.checked);
            void aendern({ erledigt: e.target.checked });
          }}
          aria-label={`${t.titel} erledigt`}
        />
      </label>
      <div className="todo-text">
        <button type="button" className="todo-titel" onClick={() => setBearbeiten(true)} title="Bearbeiten">
          {t.titel}
        </button>
        <span className="todo-meta">
          {t.faellig && <span className={`abzeichen${ueberfaellig ? ' warnung' : ''}`}>📅 {datumText(t.faellig)}</span>}
          {t.erinnerung && !t.erledigt && (
            <span className="abzeichen" title="Läutet im Kirchturm und schickt eine Telegram-Nachricht">
              🔔 {erinnerungText(t.erinnerung)}
            </span>
          )}
          {t.wiederholen && (
            <span className="abzeichen" title={`Wiederkehrend: ${t.wiederholen} – beim Abhaken kommt das nächste`}>
              🔁 {t.wiederholen}
            </span>
          )}
          {t.gruppe && <span className="abzeichen">{t.gruppe}</span>}
          {t.gebaeude && <span className="abzeichen">{t.gebaeude}</span>}
          {t.fremd && (
            <span className="abzeichen" title="Aus Mails oder Moodle – Agenten mit Internet sehen diesen Eintrag nicht">
              ✉️ aus Mail
            </span>
          )}
          {vonAgent && <span className="abzeichen" title={t.quelle}>🤖 {t.quelle}</span>}
          {t.notiz && (
            <a href={bibliothekUrl(t.pfad)} onClick={linkKlick} className="leise">
              Notiz
            </a>
          )}
          {basis === '/api/todos' && !t.erledigt && t.faellig && t.faellig >= heute() && (
            <button type="button" className="klein" title="Freie Zeit im Kalender bis zur Frist finden" aria-label={`Lernzeit: ${t.titel}`} onClick={() => setPlanen((x) => !x)}>
              📅
            </button>
          )}
          {basis === '/api/todos' && !t.erledigt && (
            <button
              type="button"
              className="klein"
              title="Pomodoro für dieses To-do starten"
              aria-label={`Fokus: ${t.titel}`}
              onClick={() => void ausfuehren(() => api('/api/kirchturm', { body: { befehl: 'pomodoro_fuer', titel: t.titel, ...(t.gruppe ? { gruppe: t.gruppe } : {}), pfad: t.pfad } }))}
            >
              🍅
            </button>
          )}
          {basis.endsWith('/wunsch') && !t.erledigt && (
            <button
              type="button"
              className="klein"
              title="Preise und Alternativen im Netz suchen lassen"
              onClick={() =>
                void ausfuehren(async () => {
                  const r = await api<{ chatId: string }>('/api/aktionen/starten', { body: { id: 'Einkaufsladen/preisvergleich', eingaben: { produkt: t.titel } } });
                  navigieren(`/chats/${r.chatId}`);
                })
              }
            >
              🔎 Preise
            </button>
          )}
        </span>
        {planen && t.faellig && (
          // Frist = Ende des Fälligkeitstags (Linz); der Server rechnet in Ortszeit
          <LernzeitPlaner titel={t.titel.replace(/^(Abgabe|Prüfung): /, '')} bis={new Date(`${t.faellig}T23:00:00+01:00`).toISOString()} fristTag={t.faellig} schliessen={() => setPlanen(false)} />
        )}
      </div>
    </li>
  );
}
