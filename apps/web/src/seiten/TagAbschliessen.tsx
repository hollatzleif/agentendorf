import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FokusStatistik, TodoInfo } from '@dorf/shared';
import { minutenText } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { linkKlick } from '../router';
import { tagPlus } from '../komponenten/MarktKalender';
import { StimmungZeile } from '../komponenten/StimmungZeile';
import { GewohnheitenKarte } from '../komponenten/GewohnheitenKarte';
import { Stern } from './Heute';

/**
 * E146: Tag abschließen (/abschluss) – das 5-Minuten-Ritual am Abend, Gegenstück zu „Woche planen“:
 * 1. Geschafft (Erledigtes, Fokus, Stimmung), 2. Offenes von heute verteilen (morgen / nächste Woche / ohne Datum),
 * 3. die drei Wichtigsten für morgen ⭐, 4. Kopf leeren (eine Notiz). Abgehakte Schritte merkt sich das Gerät je Tag.
 * Nichts geschieht automatisch – jede Änderung ist ein Klick von Leif.
 */
const SCHRITTE = [
  ['geschafft', '1 · Geschafft', 'Was heute erledigt wurde – auch Kleines zählt.'],
  ['offen', '2 · Offenes verteilen', 'Was heute liegen blieb, bekommt einen neuen Tag – oder fliegt raus.'],
  ['morgen', '3 · Die drei für morgen', 'Höchstens drei ⭐ – damit „Heute“ morgen früh weiß, womit du anfängst.'],
  ['kopf', '4 · Kopf leeren', 'Was dir noch durch den Kopf geht, kommt in die Tagesnotiz – dann darf es raus.'],
] as const;

const ortTag = (ms = Date.now()) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

export function TagAbschliessen() {
  const heute = ortTag();
  const morgen = tagPlus(heute, 1);
  const schluessel = `dorf-abschluss-${heute}`;
  const [fertig, setFertig] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(schluessel) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const haken = (k: string, an: boolean) => {
    const n = an ? [...new Set([...fertig, k])] : fertig.filter((x) => x !== k);
    setFertig(n);
    localStorage.setItem(schluessel, JSON.stringify(n));
  };
  const todos = useQuery({ queryKey: ['liste', 'todo'], queryFn: () => api<TodoInfo[]>('/api/todos') });
  const fokus = useQuery({ queryKey: ['kirchturm', 'fokus'], queryFn: () => api<FokusStatistik>('/api/kirchturm/fokus') });
  const alle = todos.data ?? [];
  const erledigt = alle.filter((t) => t.erledigt && t.erledigtAm && ortTag(Date.parse(t.erledigtAm)) === heute);
  const offen = alle.filter((t) => !t.erledigt && t.faellig && t.faellig <= heute);
  const fuerMorgen = alle
    .filter((t) => !t.erledigt && ((t.faellig && t.faellig <= morgen) || (!t.faellig && t.wichtig)))
    .sort((a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9').localeCompare(b.faellig ?? '9'));
  const sterne = fuerMorgen.filter((t) => t.wichtig).length;
  return (
    <section className="planen abschluss" aria-label="Tag abschließen">
      <a href="/heute" onClick={linkKlick}>
        ← Heute
      </a>
      <h1>🌙 Tag abschließen</h1>
      <p className="leise">
        5 Minuten, vier Schritte – dann ist Feierabend.{' '}
        <strong>
          {fertig.length}/{SCHRITTE.length} erledigt
        </strong>
        {fertig.length === SCHRITTE.length && ' – schönen Abend! 🌙'}
      </p>
      <nav className="planen-schritte" aria-label="Schritte">
        {SCHRITTE.map(([k, titel]) => (
          <a key={k} href={`#${k}`} className={fertig.includes(k) ? 'fertig' : ''}>
            {fertig.includes(k) ? '✓ ' : ''}
            {titel}
          </a>
        ))}
      </nav>
      {SCHRITTE.map(([k, titel, text]) => (
        <section key={k} id={k} className={`planen-schritt${fertig.includes(k) ? ' fertig' : ''}`} aria-label={titel}>
          <div className="planen-kopf">
            <h2>{titel}</h2>
            <label className="planen-haken">
              <input type="checkbox" checked={fertig.includes(k)} onChange={(e) => haken(k, e.target.checked)} aria-label={`${titel} erledigt`} /> erledigt
            </label>
          </div>
          <p className="leise">{text}</p>
          {k === 'geschafft' && (
            <div className="karte">
              {todos.isLoading ? (
                <p className="leise">Lade …</p>
              ) : erledigt.length ? (
                <ul className="abschluss-liste">
                  {erledigt.map((t) => (
                    <li key={t.pfad}>✓ {t.titel}</li>
                  ))}
                </ul>
              ) : (
                <p className="leise">Heute nichts abgehakt – das ist okay. Morgen ist ein neuer Tag.</p>
              )}
              <p>
                🍅 <strong>{minutenText(fokus.data?.heuteMin ?? 0)}</strong> Fokus heute
                {fokus.data && fokus.data.serie > 1 ? ` · ${fokus.data.serie} Tage in Folge 🔥` : ''}
              </p>
              <StimmungZeile />
            </div>
          )}
          {/* E159: Gewohnheiten von heute gleich mit abhaken */}
          {k === 'geschafft' && <GewohnheitenKarte />}
          {k === 'offen' && <OffenVerteilen offen={offen} heute={heute} laedt={todos.isLoading} />}
          {k === 'morgen' && (
            <div className="karte">
              <p className={sterne > 3 ? 'fehler' : 'leise'}>
                ⭐ {sterne}/3{sterne > 3 ? ' – das sind mehr als drei. Was davon kann warten?' : ''}
              </p>
              {fuerMorgen.length ? (
                <ul className="abschluss-liste">
                  {fuerMorgen.slice(0, 12).map((t) => (
                    <li key={t.pfad} className="abschluss-zeile">
                      <Stern t={t} />
                      <span>{t.titel}</span>
                      {t.dauer ? <span className="leise">⏱ {minutenText(t.dauer)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="leise">Für morgen steht noch nichts an – ein freier Tag oder Zeit für Liegengebliebenes.</p>
              )}
            </div>
          )}
          {k === 'kopf' && <KopfLeeren onFertig={() => haken('kopf', true)} />}
        </section>
      ))}
    </section>
  );
}

function OffenVerteilen({ offen, heute, laedt }: { offen: TodoInfo[]; heute: string; laedt: boolean }) {
  const qc = useQueryClient();
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const montag = (() => {
    const d = new Date(`${heute}T12:00:00Z`);
    return tagPlus(heute, 7 - ((d.getUTCDay() + 6) % 7));
  })();
  const aendern = async (liste: TodoInfo[], b: (t: TodoInfo) => Record<string, unknown>) => {
    setFehler('');
    setLaeuft(true);
    try {
      // nacheinander: jede Änderung mit ihrer eigenen Version (Konflikt → Meldung, Rest läuft weiter)
      const fehlgeschlagen: string[] = [];
      for (const t of liste) await api('/api/todos', { methode: 'PATCH', body: { pfad: t.pfad, basisVersion: t.version, ...b(t) } }).catch(() => fehlgeschlagen.push(t.titel));
      if (fehlgeschlagen.length) setFehler(`Nicht geändert (gerade woanders bearbeitet?): ${fehlgeschlagen.join(', ')}`);
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setLaeuft(false);
      await qc.invalidateQueries({ queryKey: ['liste', 'todo'] });
    }
  };
  if (laedt) return <p className="leise">Lade …</p>;
  if (!offen.length)
    return (
      <div className="karte">
        <p>Nichts liegen geblieben. 🎉</p>
      </div>
    );
  const morgen = tagPlus(heute, 1);
  return (
    <div className="karte">
      <ul className="abschluss-liste">
        {offen.map((t) => (
          <li key={t.pfad} className="abschluss-zeile">
            <span>
              {t.titel}
              {t.faellig && t.faellig < heute && <span className="rot"> · seit {t.faellig}</span>}
              {t.verschoben && t.verschoben >= 3 ? <span className="rot" title="Zu groß? Im To-do-Brett in Schritte zerlegen – oder ehrlich streichen."> · ↻ {t.verschoben}× verschoben</span> : null}
            </span>
            <span className="zeile">
              <button type="button" className="klein" disabled={laeuft} onClick={() => void aendern([t], () => ({ erledigt: true }))} aria-label={`${t.titel} erledigt`}>
                ✓
              </button>
              <button type="button" className="klein" disabled={laeuft} onClick={() => void aendern([t], () => ({ faellig: morgen }))} aria-label={`${t.titel} auf morgen`}>
                → morgen
              </button>
              <button type="button" className="klein" disabled={laeuft || !!t.wiederholen} title={t.wiederholen ? 'wiederkehrend – die Serie bleibt auf ihrem Tag' : undefined} onClick={() => void aendern([t], () => ({ faellig: montag }))} aria-label={`${t.titel} auf nächste Woche`}>
                → Mo
              </button>
              <button type="button" className="klein" disabled={laeuft || !!t.wiederholen || !!t.wartet} title={t.wiederholen ? 'wiederkehrend – bleibt mit Datum' : t.wartet ? 'wartet – der Nachfass-Tag bleibt' : 'ohne Datum in den Eingang'} onClick={() => void aendern([t], () => ({ faellig: '' }))} aria-label={`${t.titel} ohne Datum`}>
                ↩ Eingang
              </button>
            </span>
          </li>
        ))}
      </ul>
      {/* wiederkehrende bleiben auf ihrem Tag – sonst wandert die ganze Serie (Review) */}
      {offen.filter((t) => !t.wiederholen).length > 1 && (
        <button type="button" disabled={laeuft} onClick={() => void aendern(offen.filter((t) => !t.wiederholen), () => ({ faellig: morgen }))}>
          Alle {offen.filter((t) => !t.wiederholen).length} auf morgen{offen.some((t) => t.wiederholen) ? ' (ohne wiederkehrende)' : ''}
        </button>
      )}
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}

function KopfLeeren({ onFertig }: { onFertig: () => void }) {
  const [text, setText] = useState('');
  const [meldung, setMeldung] = useState('');
  const speichern = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setMeldung('');
    try {
      await api('/api/notiz', { body: { text: text.trim() } });
      setText('');
      setMeldung('✓ In der Tagesnotiz – Rathaus → Notizen.');
      onFertig();
    } catch (e2) {
      setMeldung(e2 instanceof ApiFehler ? e2.message : String(e2));
    }
  };
  return (
    <form className="karte abschluss-kopf" onSubmit={(e) => void speichern(e)} aria-label="Kopf leeren">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder="Was geht dir noch durch den Kopf? Ideen, Sorgen, Dinge für morgen …" aria-label="Gedanken für die Tagesnotiz" />
      <button type="submit" className="haupt" disabled={!text.trim()}>
        In die Notiz
      </button>
      {meldung && <p className="leise">{meldung}</p>}
    </form>
  );
}
