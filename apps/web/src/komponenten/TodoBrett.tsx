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

/** E120: geschätzte Dauer – „Tag planen“ und „Heute“ rechnen damit */
const DAUER_WAHL = [
  ['', 'Dauer: keine Schätzung'],
  ['15', '⏱ 15 min'],
  ['30', '⏱ 30 min'],
  ['45', '⏱ 45 min'],
  ['60', '⏱ 1 h'],
  ['90', '⏱ 1,5 h'],
  ['120', '⏱ 2 h'],
  ['180', '⏱ 3 h'],
  ['240', '⏱ 4 h'],
] as const;

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

const OFFENE_SCHRITTE = new Set<string>();

function TodoZeile({ t, ausfuehren, basis }: { t: TodoInfo; ausfuehren: (f: () => Promise<unknown>) => Promise<unknown>; basis: string }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [titel, setTitel] = useState(t.titel);
  const [faellig, setFaellig] = useState(t.faellig ?? '');
  const [notiz, setNotiz] = useState(t.notiz ?? '');
  const [gruppe, setGruppe] = useState(t.gruppe ?? '');
  const [wiederholen, setWiederholen] = useState(t.wiederholen ?? '');
  const [erinnerung, setErinnerung] = useState(t.erinnerung ?? '');
  const [dauer, setDauer] = useState(t.dauer ? String(t.dauer) : '');
  // Häkchen sofort zeigen; die Zeile wird mit der neuen Version vom Server ohnehin neu aufgebaut
  const [haken, setHaken] = useState(t.erledigt);
  const [planen, setPlanen] = useState(false);
  // die Zeile wird bei jeder neuen Version neu aufgebaut (key) – offen bleibt sie trotzdem
  const [schritteOffen, setSchritteOffenRoh] = useState(() => OFFENE_SCHRITTE.has(t.pfad));
  const setSchritteOffen = (f: (x: boolean) => boolean) =>
    setSchritteOffenRoh((x) => {
      const n = f(x);
      if (n) OFFENE_SCHRITTE.add(t.pfad);
      else OFFENE_SCHRITTE.delete(t.pfad);
      return n;
    });
  const sch = t.schritte ?? [];
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
            void aendern({ titel, faellig, notiz, gruppe, ...(wiederholen !== (t.wiederholen ?? '') ? { wiederholen } : {}), ...(erinnerung !== (t.erinnerung ?? '') ? { erinnerung: erinnerung.slice(0, 16) } : {}), ...(dauer !== (t.dauer ? String(t.dauer) : '') ? { dauer: Number(dauer) || 0 } : {}) }).then(() => setBearbeiten(false));
          }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} aria-label="Titel" />
          <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig am" />
          <input value={gruppe} onChange={(e) => setGruppe(e.target.value)} maxLength={60} placeholder="Gruppe (Abteilung, Amt …)" aria-label="Gruppe" />
          <label className="todo-erinnerung">
            🔔 Erinnerung
            <input type="datetime-local" value={erinnerung} onChange={(e) => setErinnerung(e.target.value)} aria-label="Erinnerung" />
          </label>
          <select value={dauer} onChange={(e) => setDauer(e.target.value)} aria-label="Geschätzte Dauer">
            {[...DAUER_WAHL, ...(dauer && !DAUER_WAHL.some(([w]) => w === dauer) ? [[dauer, `⏱ ${dauer} min`] as const] : [])].map(([w, text]) => (
              <option key={w} value={w}>
                {text}
              </option>
            ))}
          </select>
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
          {t.dauer && !t.erledigt && (
            <span className="abzeichen" title="Geschätzte Dauer">
              ⏱ {t.dauer >= 60 ? `${Math.floor(t.dauer / 60)} h${t.dauer % 60 ? ` ${t.dauer % 60}` : ''}` : `${t.dauer} min`}
            </span>
          )}
          {t.fokusMin ? (
            // E122: tatsächliche Fokuszeit – rot, wenn schon mehr als geschätzt
            <span className={`abzeichen${t.dauer && t.fokusMin > t.dauer ? ' warnung' : ''}`} title={t.dauer ? `Fokus bisher: ${t.fokusMin} von ${t.dauer} min geschätzt` : `Fokus bisher: ${t.fokusMin} min`}>
              🍅 {t.fokusMin} min
            </span>
          ) : null}
          {t.wiederholen && (
            <span className="abzeichen" title={`Wiederkehrend: ${t.wiederholen} – beim Abhaken kommt das nächste`}>
              🔁 {t.wiederholen}
            </span>
          )}
          {(sch.length > 0 || (!t.erledigt && basis === '/api/todos')) && (
            <button
              type="button"
              className={`klein todo-schritte-knopf${sch.length && sch.every((x) => x.erledigt) ? ' fertig' : ''}`}
              aria-expanded={schritteOffen}
              aria-label={sch.length ? `Schritte: ${sch.filter((x) => x.erledigt).length} von ${sch.length}` : `Schritte für ${t.titel}`}
              title={sch.length ? 'Teilschritte' : 'In Teilschritte zerlegen'}
              onClick={() => setSchritteOffen((x) => !x)}
            >
              ☑ {sch.length ? `${sch.filter((x) => x.erledigt).length}/${sch.length}` : '+'}
            </button>
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
        {schritteOffen && <Schritte t={t} basis={basis} ausfuehren={ausfuehren} />}
        {planen && t.faellig && (
          // Frist = Ende des Fälligkeitstags (Linz); der Server rechnet in Ortszeit
          <LernzeitPlaner titel={t.titel.replace(/^(Abgabe|Prüfung): /, '')} bis={new Date(`${t.faellig}T23:00:00+01:00`).toISOString()} fristTag={t.faellig} schliessen={() => setPlanen(false)} />
        )}
      </div>
    </li>
  );
}

/**
 * E119: Teilschritte – die Obsidian-Checkliste im Text des To-dos. Abhaken, ergänzen, entfernen; bei der To-do-Liste
 * schlägt die KI auf Wunsch Schritte vor (es wird erst geschrieben, wenn Leif „Übernehmen“ klickt).
 */
function Schritte({ t, basis, ausfuehren }: { t: TodoInfo; basis: string; ausfuehren: (f: () => Promise<unknown>) => Promise<unknown> }) {
  const sch = t.schritte ?? [];
  const [neu, setNeu] = useState('');
  const [vorschlag, setVorschlag] = useState<{ text: string; an: boolean }[] | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  // Häkchen sofort zeigen; mit der neuen Version vom Server wird die Zeile ohnehin neu aufgebaut
  const [lokal, setLokal] = useState<Record<number, boolean>>({});
  const fertig = sch.filter((x) => x.erledigt).length;
  const hinzufuegen = (texte: string[]) => ausfuehren(() => api(`${basis}/schritte`, { body: { pfad: t.pfad, schritte: texte } }));
  return (
    <div className="todo-schritte" aria-label={`Schritte: ${t.titel}`} role="group">
      {sch.length > 0 && (
        <div className="todo-schritte-balken" aria-hidden>
          <span style={{ width: `${(fertig / sch.length) * 100}%` }} />
        </div>
      )}
      {sch.length > 0 && (
        <ul>
          {sch.map((x, i) => (
            <li key={`${i}-${x.text}`} className={x.erledigt ? 'fertig' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={lokal[i] ?? x.erledigt}
                  onChange={(e) => {
                    const an = e.target.checked;
                    setLokal((l) => ({ ...l, [i]: an }));
                    void ausfuehren(() => api(`${basis}/schritt`, { body: { pfad: t.pfad, nr: i, erledigt: an, text: x.text } }));
                  }}
                  aria-label={`Schritt erledigt: ${x.text}`}
                />
                <span>{x.text}</span>
              </label>
              <button type="button" className="klein leise-knopf" aria-label={`Schritt entfernen: ${x.text}`} onClick={() => void ausfuehren(() => api(`${basis}/schritt`, { body: { pfad: t.pfad, nr: i, entfernen: true, text: x.text } }))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {!t.erledigt && (
        <form
          className="todo-schritt-neu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!neu.trim()) return;
            void hinzufuegen([neu.trim()]).then(() => setNeu(''));
          }}
        >
          <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Nächster Schritt …" maxLength={200} aria-label="Neuer Schritt" />
          <button type="submit" className="klein" aria-label="Schritt hinzufügen">
            +
          </button>
          {basis === '/api/todos' && (
            <button
              type="button"
              className="klein"
              disabled={laedt}
              title="Die KI schlägt 3–7 kleine Schritte vor – du entscheidest, welche übernommen werden"
              onClick={async () => {
                setFehler('');
                setLaedt(true);
                try {
                  const r = await api<{ schritte: string[] }>('/api/todos/zerlegen', { body: { pfad: t.pfad } });
                  setVorschlag(r.schritte.map((text) => ({ text, an: true })));
                } catch (e) {
                  setFehler(e instanceof ApiFehler ? e.message : String(e));
                } finally {
                  setLaedt(false);
                }
              }}
            >
              {laedt ? '✂️ denkt …' : '✂️ Vorschlagen'}
            </button>
          )}
        </form>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
      {vorschlag && (
        <div className="todo-vorschlag" role="group" aria-label="Vorgeschlagene Schritte">
          {vorschlag.length === 0 && <p className="leise">Keine Vorschläge.</p>}
          {vorschlag.map((v, i) => (
            <label key={i}>
              <input type="checkbox" checked={v.an} onChange={(e) => setVorschlag(vorschlag.map((x, j) => (j === i ? { ...x, an: e.target.checked } : x)))} />
              <span>{v.text}</span>
            </label>
          ))}
          <div className="zeile">
            <button
              type="button"
              className="haupt klein"
              disabled={!vorschlag.some((v) => v.an)}
              onClick={() => void hinzufuegen(vorschlag.filter((v) => v.an).map((v) => v.text)).then(() => setVorschlag(null))}
            >
              Übernehmen ({vorschlag.filter((v) => v.an).length})
            </button>
            <button type="button" className="klein" onClick={() => setVorschlag(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
