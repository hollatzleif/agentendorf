import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KarteFaellig, KartenFach } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick, navigieren } from '../router';
import { Markdown } from './Markdown';
import { useDesign } from '../apple/design';
import { Chevron, Em } from '../apple/wissen-teile';

const BEWERTUNG: [string, string, string][] = [
  ['nochmal', 'Nochmal', '1'],
  ['schwer', 'Schwer', '2'],
  ['gut', 'Gut', '3'],
  ['leicht', 'Leicht', '4'],
];

/**
 * Karteikarten (Nacht 18./19.11.): je Fach `karten.md` im Fach-Ordner („Frage :: Antwort“ oder „### Frage“ + Text).
 * Wiederholung in wachsenden Abständen; Tastatur: Leertaste = Antwort, 1–4 = bewerten.
 */
/** E199: Karten eines Fachs als Anki-Paket herunterladen (gebaut im Rechenraum) – Fehler sichtbar statt einer kaputten Datei */
async function ankiHerunterladen(fach: string): Promise<string> {
  const r = await fetch(`/api/karten/anki?fach=${encodeURIComponent(fach)}`, { credentials: 'same-origin' });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { fehler?: string };
    return j.fehler ?? `Anki-Export fehlgeschlagen (HTTP ${r.status}).`;
  }
  const name = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name ? decodeURIComponent(name) : `${fach}.apkg`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return '';
}

export function KartenLernen() {
  const ueb = useQuery({ queryKey: ['uni', 'karten'], queryFn: () => api<KartenFach[]>('/api/karten') });
  const [fach, setFach] = useState<string | null>(() => new URLSearchParams(location.search).get('fach'));
  const [anki, setAnki] = useState<{ fach: string; text: string } | null>(null);
  if (fach) return <Lernen fach={fach} zurueck={() => setFach(null)} />;
  return (
    <div className="karten">
      {ueb.isLoading && <p className="leise">Lade …</p>}
      {ueb.data && !ueb.data.length && (
        <p className="leise">
          Noch keine Karten. Leg in einem Fach-Ordner eine Datei <code>karten.md</code> an – je Zeile <code>Frage :: Antwort</code> oder <code>### Frage</code> mit der Antwort
          darunter. Oder lass sie erstellen: Uni → Aktionen → „Karteikarten erstellen“.
        </p>
      )}
      <div className="fach-karten">
        {ueb.data?.map((f) => (
          <section key={f.fach} className="karte innen fach-karte" aria-label={`Karten ${f.fach}`}>
            <h3>
              <Em e="🃏" /> {f.fach}
            </h3>
            <div className="fach-zahlen">
              <span>
                <strong>{f.faellig}</strong> heute dran
              </span>
              <span className="leise">
                {f.gesamt} Karten · {f.neu} neu · {f.gelernt} sitzen
              </span>
            </div>
            <div className="zeile">
              <button type="button" className="haupt" disabled={!f.faellig} onClick={() => setFach(f.fach)}>
                {f.faellig ? 'Lernen' : 'Alles erledigt ✓'}
              </button>
              <a href={bibliothekUrl(`Uni/faecher/${f.fach}/karten.md`)} onClick={linkKlick} className="leise">
                Karten bearbeiten
              </a>
              <button
                type="button"
                title="Alle Karten als Anki-Paket (.apkg) – für AnkiDroid/AnkiMobile; erneuter Import aktualisiert"
                disabled={anki?.fach === f.fach && anki.text === '…'}
                onClick={() => {
                  setAnki({ fach: f.fach, text: '…' });
                  void ankiHerunterladen(f.fach).then(
                    (text) => setAnki(text ? { fach: f.fach, text } : null),
                    (e: unknown) => setAnki({ fach: f.fach, text: String(e) }),
                  );
                }}
              >
                {anki?.fach === f.fach && anki.text === '…' ? 'Baue …' : 'Für Anki'}
              </button>
            </div>
            {anki?.fach === f.fach && anki.text !== '…' && (
              <p className="fehler" role="alert">
                {anki.text}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Lernen({ fach, zurueck }: { fach: string; zurueck: () => void }) {
  const qc = useQueryClient();
  const [stapel, setStapel] = useState<KarteFaellig[] | null>(null);
  const [zeigen, setZeigen] = useState(false);
  const [fertig, setFertig] = useState(0);
  const [fehler, setFehler] = useState('');
  const apple = useDesign() === 'apple';
  useEffect(() => {
    void api<KarteFaellig[]>(`/api/karten/faellig?fach=${encodeURIComponent(fach)}`)
      .then(setStapel)
      .catch((e) => setFehler(e instanceof ApiFehler ? e.message : String(e)));
  }, [fach]);
  const karte = stapel?.[0];
  const bewerten = async (b: string) => {
    if (!karte) return;
    setFehler('');
    try {
      await api('/api/karten/antwort', { body: { fach, id: karte.id, bewertung: b } });
      setFertig((n) => n + 1);
      // „Nochmal“ kommt in dieser Runde noch einmal dran (hinten)
      setStapel((s) => (s ? [...s.slice(1), ...(b === 'nochmal' ? [{ ...karte, neu: false }] : [])] : s));
      setZeigen(false);
      void qc.invalidateQueries({ queryKey: ['uni'] });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === ' ' && !zeigen) {
        e.preventDefault();
        setZeigen(true);
      } else if (zeigen && ['1', '2', '3', '4'].includes(e.key)) void bewerten(BEWERTUNG[Number(e.key) - 1]![0]);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="karten-lernen">
      <div className="zeile">
        <button type="button" className="karten-zurueck" onClick={zurueck}>
          {apple ? <Chevron richtung="links" /> : '←'} Fächer
        </button>
        <strong>
          <Em e="🃏" /> {fach}
        </strong>
        {stapel && <span className="leise">{stapel.length ? `noch ${stapel.length}` : ''} · {fertig} erledigt</span>}
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
      {stapel && !karte && (
        <div className="karte innen karten-ende">
          <p>
            <Em e="🎉" /> Fertig für heute – {fertig} Karten.
          </p>
          <button type="button" onClick={() => navigieren('/heute')}>
            Zu „Heute“
          </button>
        </div>
      )}
      {karte && apple && (
        // Apple: große Karte, die sich zur Antwort umdreht (Feder; bei „weniger Bewegung“ nur Überblenden)
        <div key={`${karte.id}-${fertig}`} className={`karteikarte-wende${zeigen ? ' gewendet' : ''}`} aria-label="Karteikarte" role="group">
          <div className="karteikarte-innen">
            <div className="karteikarte-seite vorne" inert={zeigen}>
              {karte.neu && <span className="abzeichen">neu</span>}
              <div className="karten-frage">
                <Markdown inhalt={karte.frage} pfad={`Uni/faecher/${fach}/karten.md`} />
              </div>
              <button type="button" className="haupt" onClick={() => setZeigen(true)}>
                Antwort zeigen <span className="leise">(Leertaste)</span>
              </button>
            </div>
            {zeigen && (
              <div className="karteikarte-seite hinten">
                <div className="karten-frage klein">
                  <Markdown inhalt={karte.frage} pfad={`Uni/faecher/${fach}/karten.md`} />
                </div>
                <div className="karten-antwort">
                  <Markdown inhalt={karte.antwort} pfad={`Uni/faecher/${fach}/karten.md`} />
                </div>
                <div className="zeile karten-knoepfe">
                  {BEWERTUNG.map(([b, t, taste]) => (
                    <button key={b} type="button" className={`karten-${b}`} onClick={() => void bewerten(b)}>
                      {t} <span className="leise">({taste})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {karte && !apple && (
        <div className="karte innen karteikarte" aria-label="Karteikarte">
          {karte.neu && <span className="abzeichen">neu</span>}
          <div className="karten-frage">
            <Markdown inhalt={karte.frage} pfad={`Uni/faecher/${fach}/karten.md`} />
          </div>
          {zeigen ? (
            <>
              <hr />
              <div className="karten-antwort">
                <Markdown inhalt={karte.antwort} pfad={`Uni/faecher/${fach}/karten.md`} />
              </div>
              <div className="zeile karten-knoepfe">
                {BEWERTUNG.map(([b, t, taste]) => (
                  <button key={b} type="button" className={`karten-${b}`} onClick={() => void bewerten(b)}>
                    {t} <span className="leise">({taste})</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button type="button" className="haupt" onClick={() => setZeigen(true)}>
              Antwort zeigen <span className="leise">(Leertaste)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
