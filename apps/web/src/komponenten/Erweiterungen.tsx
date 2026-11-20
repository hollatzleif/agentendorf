import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ErweiterungErgebnis, ErweiterungTreffer, ErweiterungenStand, ErweiterungenSuche } from '@dorf/shared';
import { api, ApiFehler } from '../api';

/**
 * Erweiterungen für VS Code im Codehaus (E205): in Open VSX suchen, installieren, entfernen, VSIX hochladen.
 * Alles geht über das Dorf (/api/coding/erweiterungen*); installiert wird nur auf Klick hier – nie durch einen Agenten.
 * Texte aus Open VSX erscheinen nur als Text (React maskiert), Links baut das Dorf selbst.
 */
const B = '/api/coding/erweiterungen';
const VSIX_MAX = 50 * 1024 * 1024;
const zahlKurz = (n: number) => new Intl.NumberFormat('de', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

async function vsixHochladen(datei: Blob): Promise<ErweiterungErgebnis> {
  const r = await fetch(`${B}/vsix`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: datei, credentials: 'same-origin' });
  const j = (await r.json().catch(() => ({}))) as ErweiterungErgebnis & { fehler?: string };
  if (r.ok) return j;
  if (r.status === 401) window.dispatchEvent(new Event('dorf:abgemeldet'));
  throw new ApiFehler(r.status, j.fehler ?? (r.status === 413 ? 'Die Datei ist zu groß (höchstens 50 MB).' : `Fehler ${r.status}`));
}

export function Erweiterungen({ beiAenderung }: { beiAenderung?: () => void }) {
  const qc = useQueryClient();
  const [ansicht, setAnsicht] = useState<'suche' | 'installiert'>('suche');
  const [eingabe, setEingabe] = useState('');
  const [frage, setFrage] = useState<string | null>(null);
  const [seiten, setSeiten] = useState<ErweiterungenSuche[]>([]);
  const [sucht, setSucht] = useState(false);
  const [arbeit, setArbeit] = useState<string | null>(null);
  const [rueckfrage, setRueckfrage] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);

  const stand = useQuery({ queryKey: ['coding-erweiterungen'], queryFn: () => api<ErweiterungenStand>(B), retry: false });
  const installiert = new Map((stand.data?.erweiterungen ?? []).map((e) => [e.id, e.version]));

  const suchen = async (text: string, versatz = 0) => {
    setSucht(true);
    setMeldung(null);
    try {
      const r = await api<ErweiterungenSuche>(`${B}/suche?${new URLSearchParams({ q: text, versatz: String(versatz) }).toString()}`);
      setFrage(text);
      setSeiten((alt) => (versatz === 0 ? [r] : [...alt, r]));
    } catch (e) {
      setMeldung({ text: (e as Error).message, fehler: true });
    } finally {
      setSucht(false);
    }
  };

  const ausfuehren = async (schluessel: string, tat: () => Promise<ErweiterungErgebnis>, fertig: string) => {
    setArbeit(schluessel);
    setRueckfrage(null);
    setMeldung(null);
    try {
      const r = await tat();
      qc.setQueryData(['coding-erweiterungen'], { erweiterungen: r.erweiterungen });
      setMeldung({ text: `${fertig} Schon offenes VS Code zeigt das nach „Neu laden“.` });
      beiAenderung?.();
    } catch (e) {
      setMeldung({ text: (e as Error).message, fehler: true });
    } finally {
      setArbeit(null);
    }
  };
  const installieren = (t: ErweiterungTreffer) => {
    // nicht verifizierter Herausgeber: erst nach einem zweiten Klick
    if (!t.verifiziert && rueckfrage !== `i:${t.id}`) return setRueckfrage(`i:${t.id}`);
    void ausfuehren(t.id, () => api<ErweiterungErgebnis>(`${B}/installieren`, { body: { id: t.id } }), `„${t.name}“ ist installiert.`);
  };
  const entfernen = (id: string) => {
    if (rueckfrage !== `e:${id}`) return setRueckfrage(`e:${id}`);
    void ausfuehren(id, () => api<ErweiterungErgebnis>(`${B}/entfernen`, { body: { id } }), `„${id}“ ist entfernt.`);
  };
  const hochladen = (datei: File | undefined) => {
    if (dateiFeld.current) dateiFeld.current.value = '';
    if (!datei) return;
    if (datei.size > VSIX_MAX) return setMeldung({ text: 'Die Datei ist zu groß (höchstens 50 MB).', fehler: true });
    void ausfuehren('vsix', () => vsixHochladen(datei), `„${datei.name}“ ist installiert.`);
  };

  const treffer = seiten.flatMap((s) => s.treffer);
  const gesamt = seiten[0]?.gesamt ?? 0;

  return (
    <div className="erweiterungen" data-testid="erweiterungen">
      <p className="erw-warnung" role="note">
        ⚠️ Erweiterungen laufen mit vollem Zugriff im Codehaus (Shell, Internet, Vault) – installiere nur, was du für vertrauenswürdig hältst.
      </p>
      <p className="leise">
        Sie wirken im VS Code (Reiter „VS Code“), nicht im schlanken Editor der App. Quelle ist{' '}
        <a href="https://open-vsx.org" target="_blank" rel="noopener noreferrer">
          Open VSX
        </a>{' '}
        – Erweiterungen, die Microsoft nur im eigenen Marketplace anbietet (Pylance, C/C++, Remote, Copilot …), gibt es hier nicht.
      </p>
      <div className="reiter klein" role="tablist">
        <button type="button" role="tab" aria-selected={ansicht === 'suche'} className={ansicht === 'suche' ? 'aktiv' : ''} onClick={() => setAnsicht('suche')}>
          Suchen
        </button>
        <button type="button" role="tab" aria-selected={ansicht === 'installiert'} className={ansicht === 'installiert' ? 'aktiv' : ''} onClick={() => setAnsicht('installiert')} data-testid="erw-installiert-reiter">
          Installiert{stand.data ? ` (${stand.data.erweiterungen.length})` : ''}
        </button>
      </div>
      {meldung && (
        <p className={meldung.fehler ? 'fehler erw-meldung' : 'erw-meldung'} role="status" data-testid="erw-meldung">
          {meldung.text}
        </p>
      )}
      {stand.isError && <p className="fehler">{stand.error.message}</p>}

      {ansicht === 'suche' && (
        <>
          <form
            className="erw-suche"
            onSubmit={(e) => {
              e.preventDefault();
              void suchen(eingabe.trim());
            }}
          >
            <input value={eingabe} onChange={(e) => setEingabe(e.target.value)} placeholder="z. B. prettier, python, vim" aria-label="Erweiterung suchen" maxLength={100} autoCapitalize="off" spellCheck={false} />
            <button type="submit" disabled={sucht}>
              {sucht ? 'Suche …' : 'Suchen'}
            </button>
          </form>
          {frage === null && !sucht && <p className="leise">Suchwort eingeben – oder leer suchen für die meistgeladenen.</p>}
          {frage !== null && treffer.length === 0 && !sucht && <p className="leise">Nichts gefunden.</p>}
          <ul className="erw-liste" data-testid="erw-treffer">
            {treffer.map((t) => {
              const da = installiert.get(t.id);
              return (
                <li key={t.id} data-id={t.id}>
                  <div className="erw-kopf">
                    <strong>{t.name}</strong> <span className="leise">{t.herausgeber}</span> {t.verifiziert && <span className="abzeichen" title="Open VSX: Der Namensraum gehört nachweislich dem, der veröffentlicht hat. Der Code selbst ist damit nicht geprüft.">✔ verifiziert</span>}{' '}
                    {t.veraltet && <span className="abzeichen warnung">veraltet</span>}
                  </div>
                  {t.beschreibung && <div className="erw-text">{t.beschreibung}</div>}
                  <div className="leise erw-daten">
                    <code>{t.id}</code> · v{t.version || '?'} · ⬇ {zahlKurz(t.downloads)} · Lizenz: {t.lizenz ?? 'nicht angegeben'}
                    {t.bewertung !== null && <> · ★ {t.bewertung.toLocaleString('de')}</>} ·{' '}
                    <a href={t.seite} target="_blank" rel="noopener noreferrer">
                      bei Open VSX
                    </a>
                  </div>
                  <div className="erw-knoepfe">
                    {!t.installierbar ? (
                      <span className="leise">Nur in VS Code selbst installierbar (ungewöhnliche Kennung).</span>
                    ) : da ? (
                      <>
                        <span className="abzeichen gut">installiert {da}</span>
                        <button type="button" className="klein" disabled={arbeit !== null} onClick={() => entfernen(t.id)}>
                          {arbeit === t.id ? 'Entferne …' : rueckfrage === `e:${t.id}` ? 'Wirklich entfernen?' : 'Entfernen'}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="klein" disabled={arbeit !== null} onClick={() => installieren(t)}>
                        {arbeit === t.id ? 'Installiere …' : rueckfrage === `i:${t.id}` ? 'Nicht verifiziert – trotzdem installieren?' : 'Installieren'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {treffer.length > 0 && treffer.length < gesamt && seiten.length < 20 && (
            <button type="button" className="klein" disabled={sucht} onClick={() => void suchen(frage ?? '', seiten.length * 10)}>
              Mehr laden ({treffer.length} von {gesamt})
            </button>
          )}
        </>
      )}

      {ansicht === 'installiert' && (
        <>
          {stand.isPending && <p className="leise">Lade …</p>}
          {stand.data && stand.data.erweiterungen.length === 0 && <p className="leise">Noch keine Erweiterungen installiert (die eingebauten von VS Code zählen nicht).</p>}
          <ul className="erw-liste" data-testid="erw-installiert">
            {(stand.data?.erweiterungen ?? []).map((e) => (
              <li key={e.id} data-id={e.id}>
                <code>{e.id}</code> <span className="leise">v{e.version}</span>
                <button type="button" className="klein" disabled={arbeit !== null} onClick={() => entfernen(e.id)}>
                  {arbeit === e.id ? 'Entferne …' : rueckfrage === `e:${e.id}` ? 'Wirklich entfernen?' : 'Entfernen'}
                </button>
              </li>
            ))}
          </ul>
          <p className="erw-vsix">
            <label className="knopf klein">
              {arbeit === 'vsix' ? 'Installiere …' : 'VSIX-Datei hochladen und installieren'}
              <input ref={dateiFeld} type="file" accept=".vsix" hidden disabled={arbeit !== null} onChange={(e) => hochladen(e.target.files?.[0])} data-testid="erw-vsix" />
            </label>{' '}
            <span className="leise">höchstens 50 MB – z. B. eine selbst gebaute Erweiterung.</span>
          </p>
        </>
      )}
    </div>
  );
}
