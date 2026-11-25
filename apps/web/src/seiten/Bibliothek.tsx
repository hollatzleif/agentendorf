import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveEreignis, SchreibErgebnis, Suchtreffer, VaultDatei } from '@dorf/shared';
import { api, ApiFehler, rohUrl } from '../api';
import { bibliothekUrl, linkKlick, navigieren, useOrt } from '../router';
import { useLiveEreignis } from '../live';
import { BILD_ENDUNGEN, TEXT_ENDUNGEN, endung, finden, ordnerVon, useBaum } from '../vaultHilfen';
import { Dateibaum } from '../komponenten/Dateibaum';
import { Markdown } from '../komponenten/Markdown';
import { useDesign } from '../apple/design';
import { Symbol } from '../apple/Ikon';
import { Chevron, Em } from '../apple/wissen-teile';
// Schwere Teile (PDF-Anzeige, Editor) erst laden, wenn sie gebraucht werden – wichtig fürs Handy.
const Editor = lazy(() => import('../komponenten/Editor').then((m) => ({ default: m.Editor })));
const HtmlAnsicht = lazy(() => import('../komponenten/HtmlAnsicht').then((m) => ({ default: m.HtmlAnsicht })));
const PdfAnsicht = lazy(() => import('../komponenten/PdfAnsicht').then((m) => ({ default: m.PdfAnsicht })));

export function Bibliothek() {
  const { suche } = useOrt();
  const pfad = suche.get('pfad') ?? '';
  const q = suche.get('q') ?? '';
  const baum = useBaum();
  const eintrag = finden(baum.data, pfad);
  const istOrdner = !eintrag || eintrag.art === 'ordner';
  const ordner = istOrdner ? (eintrag ? pfad : '') : ordnerVon(pfad);
  const [suchtext, setSuchtext] = useState(q);
  const [meldung, setMeldung] = useState('');
  const [baumOffen, setBaumOffen] = useState(false);
  const qc = useQueryClient();
  const apple = useDesign() === 'apple';

  useEffect(() => setSuchtext(q), [q]);
  useEffect(() => setBaumOffen(false), [pfad]);

  const fehlerZeigen = (e: unknown) => setMeldung(e instanceof ApiFehler ? e.message : String(e));

  const neueNotiz = async () => {
    const name = prompt(`Name der neuen Notiz in „${ordner || 'Vault'}“:`);
    if (!name) return;
    const datei = name.endsWith('.md') ? name : `${name}.md`;
    const ziel = ordner ? `${ordner}/${datei}` : datei;
    const heute = new Date().toISOString().slice(0, 10);
    try {
      const r = await api<SchreibErgebnis>('/api/vault/datei', {
        methode: 'PUT',
        body: { pfad: ziel, inhalt: `---\ntitel: ${name.replace(/\.md$/, '')}\nerstellt: ${heute}\n---\n\n`, neu: true },
      });
      await qc.invalidateQueries({ queryKey: ['baum'] });
      navigieren(bibliothekUrl(r.pfad) + '&bearbeiten=1');
    } catch (e) {
      fehlerZeigen(e);
    }
  };

  const neuerOrdner = async () => {
    const name = prompt(`Name des neuen Ordners in „${ordner || 'Vault'}“:`);
    if (!name) return;
    try {
      const r = await api<{ pfad: string }>('/api/vault/ordner', { body: { pfad: ordner ? `${ordner}/${name}` : name } });
      await qc.invalidateQueries({ queryKey: ['baum'] });
      navigieren(bibliothekUrl(r.pfad));
    } catch (e) {
      fehlerZeigen(e);
    }
  };

  const hochladen = async (dateien: FileList | File[]) => {
    const f = new FormData();
    for (const d of Array.from(dateien)) f.append('datei', d, d.name);
    setMeldung('Lade hoch …');
    try {
      const r = await api<{ gespeichert: string[] }>(`/api/vault/hochladen?ordner=${encodeURIComponent(ordner)}`, { formular: f });
      setMeldung(`Hochgeladen: ${r.gespeichert.join(', ')}`);
      await qc.invalidateQueries({ queryKey: ['baum'] });
      if (r.gespeichert.length === 1) navigieren(bibliothekUrl(r.gespeichert[0]!));
    } catch (e) {
      fehlerZeigen(e);
    }
  };

  const verschieben = async () => {
    const nach = prompt('Neuer Pfad (Ordner/Name):', pfad);
    if (!nach || nach === pfad) return;
    try {
      const r = await api<{ pfad: string }>('/api/vault/verschieben', { body: { von: pfad, nach } });
      await qc.invalidateQueries({ queryKey: ['baum'] });
      navigieren(bibliothekUrl(r.pfad), true);
    } catch (e) {
      fehlerZeigen(e);
    }
  };

  const loeschen = async () => {
    if (!confirm(`„${pfad}“ in den Papierkorb legen?`)) return;
    try {
      await api(`/api/vault/eintrag?pfad=${encodeURIComponent(pfad)}`, { methode: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['baum'] });
      navigieren(bibliothekUrl(ordnerVon(pfad)), true);
      setMeldung('In den Papierkorb gelegt.');
    } catch (e) {
      fehlerZeigen(e);
    }
  };

  const dateiInput = useRef<HTMLInputElement>(null);
  const [ziehen, setZiehen] = useState(false);

  return (
    <section
      className={`bibliothek${ziehen ? ' ziehen' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setZiehen(true);
      }}
      onDragLeave={() => setZiehen(false)}
      onDrop={(e) => {
        e.preventDefault();
        setZiehen(false);
        if (e.dataTransfer.files.length) void hochladen(e.dataTransfer.files);
      }}
    >
      <aside className={`seitenleiste${baumOffen ? ' offen' : ''}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigieren(bibliothekUrl(pfad, suchtext.trim()));
          }}
        >
          <input type="search" placeholder="Im Vault suchen …" value={suchtext} onChange={(e) => setSuchtext(e.target.value)} aria-label="Suche" />
        </form>
        <div className="werkzeuge bib-werkzeuge">
          <button onClick={neueNotiz}>+ Notiz</button>
          <button onClick={neuerOrdner}>+ Ordner</button>
          <button onClick={() => dateiInput.current?.click()}>Hochladen</button>
          <input ref={dateiInput} type="file" multiple hidden onChange={(e) => e.target.files && void hochladen(e.target.files)} />
        </div>
        <Dateibaum key={pfad ? 'mit' : 'ohne'} ausgewaehlt={pfad} />
      </aside>

      <div className="inhalt">
        <div className="pfadleiste">
          <button className="nur-mobil" onClick={() => setBaumOffen((o) => !o)}>
            {apple ? <Symbol name="liste" /> : '☰'} Dateien
          </button>
          <Brotkrumen pfad={pfad} />
          {pfad && (
            <span className="werkzeuge">
              {!istOrdner && (
                <a className="knopf" href={rohUrl(pfad, true)}>
                  Herunterladen
                </a>
              )}
              <button onClick={verschieben}>Umbenennen</button>
              <button onClick={loeschen} className="gefahr">
                Löschen
              </button>
            </span>
          )}
        </div>
        {meldung && (
          <p className="meldung" onClick={() => setMeldung('')}>
            {meldung}
          </p>
        )}
        {q ? (
          <Suchergebnisse q={q} pfad={pfad} />
        ) : istOrdner ? (
          <OrdnerAnsicht pfad={eintrag ? pfad : ''} />
        ) : (
          <DateiAnsicht key={pfad} pfad={pfad} />
        )}
        <p className="leise ablage">Dateien hierher ziehen, um sie in „{ordner || 'Vault'}“ abzulegen.</p>
      </div>
    </section>
  );
}

function Brotkrumen({ pfad }: { pfad: string }) {
  const teile = pfad ? pfad.split('/') : [];
  const apple = useDesign() === 'apple';
  return (
    <span className="brotkrumen">
      <a href={bibliothekUrl('')} onClick={linkKlick}>
        Vault
      </a>
      {teile.map((t, i) => (
        <span key={i}>
          {apple ? <Chevron /> : ' / '}
          <a href={bibliothekUrl(teile.slice(0, i + 1).join('/'))} onClick={linkKlick}>
            {t}
          </a>
        </span>
      ))}
    </span>
  );
}

function Suchergebnisse({ q, pfad }: { q: string; pfad: string }) {
  const r = useQuery({ queryKey: ['suche', q], queryFn: () => api<Suchtreffer[]>(`/api/vault/suche?q=${encodeURIComponent(q)}`) });
  if (r.isPending) return <p>Suche …</p>;
  if (r.isError) return <p className="fehler">{r.error.message}</p>;
  return (
    <div className="karte">
      <h2>
        {r.data.length} Treffer für „{q}“{' '}
        <a href={bibliothekUrl(pfad)} onClick={linkKlick} className="leise">
          (Suche schließen)
        </a>
      </h2>
      <ul className="treffer">
        {r.data.map((t) => (
          <li key={t.pfad}>
            <a href={bibliothekUrl(t.pfad)} onClick={linkKlick}>
              {t.titel}
            </a>
            <div className="leise">{t.pfad}</div>
            <div>
              {t.ausschnitt.split(/(«[^»]*»)/).map((s, i) => (s.startsWith('«') ? <mark key={i}>{s.slice(1, -1)}</mark> : <span key={i}>{s}</span>))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrdnerAnsicht({ pfad }: { pfad: string }) {
  const baum = useBaum();
  const apple = useDesign() === 'apple';
  const e = finden(baum.data, pfad);
  if (!e) return <p className="leise">Lade …</p>;
  const kinder = e.kinder ?? [];
  return (
    <div className="karte">
      <h2>{pfad || 'Vault'}</h2>
      {kinder.length === 0 && <p className="leise">Leer.</p>}
      <ul className="ordnerliste">
        {kinder.map((k) => (
          <li key={k.pfad} className={k.art}>
            <a href={bibliothekUrl(k.pfad)} onClick={linkKlick}>
              {apple ? (
                <>
                  <span className="ordner-ikon">
                    <Symbol name={k.art === 'ordner' ? 'ordner' : 'dokument'} />
                  </span>
                  <span className="ordner-name">{k.name}</span>
                </>
              ) : (
                <>
                  {k.art === 'ordner' ? '📁' : '📄'} {k.name}
                </>
              )}
            </a>
            {k.geaendert && <span className="leise"> · {new Date(k.geaendert).toLocaleString('de-AT')}</span>}
            {apple && k.art === 'ordner' && <Chevron />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DateiAnsicht({ pfad }: { pfad: string }) {
  const e = endung(pfad);
  if (TEXT_ENDUNGEN.has(e)) return <TextAnsicht pfad={pfad} />;
  if (e === 'html' || e === 'htm')
    return (
      <Suspense fallback={<p className="leise">Lade …</p>}>
        <HtmlAnsicht pfad={pfad} />
      </Suspense>
    );
  if (e === 'pdf')
    return (
      <Suspense fallback={<p className="leise">Lade PDF-Anzeige …</p>}>
        <PdfAnsicht url={rohUrl(pfad)} />
      </Suspense>
    );
  if (BILD_ENDUNGEN.has(e) || ['heic', 'heif', 'tif', 'tiff', 'bmp', 'avif', 'atelier'].includes(e))
    return (
      <>
        {/* E198: Bilder (und Atelier-Projekte) direkt im Bildeditor öffnen */}
        <p>
          <a className="knopf" href={`/atelier?pfad=${encodeURIComponent(pfad)}`} onClick={linkKlick}>
            <Em e="🎨" /> Im Atelier bearbeiten
          </a>
        </p>
        {BILD_ENDUNGEN.has(e) ? <img className="bild" src={rohUrl(pfad)} alt={pfad} /> : <p className="leise">Für dieses Format gibt es hier keine Vorschau – das Atelier kann es öffnen.</p>}
      </>
    );
  if (['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus'].includes(e)) return <audio controls src={rohUrl(pfad)} />;
  if (['mp4', 'webm', 'mov'].includes(e)) return <video controls src={rohUrl(pfad)} className="bild" />;
  // E207: alles andere (Word, Excel, PowerPoint, OpenDocument, Mails, Archive …) über die Umwandlung im Rechenraum
  return <UmgewandeltAnsicht pfad={pfad} />;
}

interface Vorschau {
  name: string;
  typ: string;
  art: string;
  text: string;
  bilder: { mime: string; base64: string; titel: string }[];
  hinweise: string[];
}

/** E207: Vorschau als umgewandelter Text (Markdown, ohne HTML) + Bilder – das Original bleibt unverändert im Vault */
function UmgewandeltAnsicht({ pfad }: { pfad: string }) {
  const v = useQuery({
    queryKey: ['vorschau', pfad],
    queryFn: () => api<Vorschau>(`/api/vault/vorschau?pfad=${encodeURIComponent(pfad)}`),
    staleTime: 60_000,
    retry: false,
  });
  if (v.isLoading) return <p className="leise">Vorschau wird erstellt … (bei großen Dateien ein paar Sekunden)</p>;
  if (v.error || !v.data)
    return (
      <p className="karte">
        Vorschau nicht möglich{v.error instanceof ApiFehler ? ` (${v.error.message})` : ''}. <a href={rohUrl(pfad, true)}>Herunterladen</a>
      </p>
    );
  const d = v.data;
  const leer = !d.text.trim() && d.bilder.length === 0;
  return (
    <div className="karte umgewandelt">
      <p className="leise">
        {d.typ} · Vorschau (umgewandelt – Layout kann abweichen) · <a href={rohUrl(pfad, true)}>Original herunterladen</a>
      </p>
      {leer ? <p>Für diese Datei gibt es keine Vorschau.</p> : <Markdown inhalt={d.text} pfad={pfad} />}
      {d.bilder.map((b, i) => (
        <figure key={i}>
          <img className="bild" src={`data:${b.mime};base64,${b.base64}`} alt={b.titel || `Bild ${i + 1}`} />
          {b.titel && <figcaption className="leise">{b.titel}</figcaption>}
        </figure>
      ))}
      {d.hinweise.length > 0 && (
        <details>
          <summary className="leise">Hinweise zur Umwandlung</summary>
          <ul>
            {d.hinweise.map((h, i) => (
              <li key={i} className="leise">
                {h}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TextAnsicht({ pfad }: { pfad: string }) {
  const { suche } = useOrt();
  const qc = useQueryClient();
  const datei = useQuery({ queryKey: ['datei', pfad], queryFn: () => api<VaultDatei>(`/api/vault/datei?pfad=${encodeURIComponent(pfad)}`) });
  const [bearbeiten, setBearbeiten] = useState(suche.get('bearbeiten') === '1');
  // Während des Bearbeitens gehört der Text allein dem Editor: Serverstände ersetzen ihn nie, sie lösen nur einen Hinweis aus.
  const [text, setText] = useState('');
  const [basis, setBasis] = useState<string | null>(null); // Version, auf der die Bearbeitung beruht
  const [gespeichert, setGespeichert] = useState<string | null>(null); // Text beim Laden/letzten Speichern
  const [editorSchluessel, setEditorSchluessel] = useState(0);
  const [geaendertWoanders, setGeaendertWoanders] = useState(false);
  const [status, setStatus] = useState('');
  const ungespeichert = bearbeiten && gespeichert !== null && text !== gespeichert;

  const vomServer = useCallback((d: VaultDatei) => {
    setText(d.inhalt);
    setBasis(d.version);
    setGespeichert(d.inhalt);
    setGeaendertWoanders(false);
    setEditorSchluessel((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!datei.data) return;
    if (!bearbeiten || basis === null) vomServer(datei.data);
    else if (datei.data.version !== basis && datei.data.inhalt !== text) setGeaendertWoanders(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datei.data]);

  useLiveEreignis(
    useCallback(
      (e: LiveEreignis) => {
        if (e.typ === 'vault.geaendert' && e.pfad === pfad && e.art === 'geloescht') setStatus('Diese Datei wurde gelöscht oder verschoben.');
      },
      [pfad],
    ),
  );

  useEffect(() => {
    if (!ungespeichert) return;
    const warnen = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [ungespeichert]);

  const speichern = useCallback(async () => {
    setStatus('Speichere …');
    const inhalt = text;
    try {
      const r = await api<SchreibErgebnis>('/api/vault/datei', { methode: 'PUT', body: { pfad, inhalt, basisVersion: basis ?? undefined } });
      // Abfragen, die noch vor dem Speichern losgeschickt wurden, liefern die alte Fassung – verwerfen.
      await qc.cancelQueries({ queryKey: ['datei', pfad] });
      if (r.konflikt) {
        setStatus(`Die Datei wurde inzwischen woanders geändert. Deine Fassung liegt als Konfliktkopie daneben: ${r.konfliktPfad}`);
        setBearbeiten(false);
        await qc.invalidateQueries({ queryKey: ['datei', pfad] });
        const d = qc.getQueryData<VaultDatei>(['datei', pfad]);
        if (d) vomServer(d);
      } else {
        setBasis(r.version);
        setGespeichert(inhalt);
        setGeaendertWoanders(false);
        qc.setQueryData(['datei', pfad], (alt: VaultDatei | undefined) => (alt ? { ...alt, inhalt, version: r.version } : alt));
        setStatus('Gespeichert.');
      }
    } catch (e) {
      setStatus(e instanceof ApiFehler ? e.message : String(e));
    }
  }, [pfad, text, basis, qc, vomServer]);

  if (datei.isPending) return <p>Lade …</p>;
  if (datei.isError) return <p className="fehler">{datei.error.message}</p>;

  return (
    <div className="karte textansicht">
      <div className="werkzeuge">
        {bearbeiten ? (
          <>
            <button onClick={speichern} disabled={!ungespeichert} className="haupt">
              Speichern
            </button>
            <button
              onClick={() => {
                if (ungespeichert && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
                setBearbeiten(false);
                vomServer(datei.data);
              }}
            >
              Fertig
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              vomServer(datei.data);
              setBearbeiten(true);
            }}
          >
            Bearbeiten
          </button>
        )}
        {ungespeichert && <span className="leise">ungespeichert</span>}
        {status && <span className="leise">{status}</span>}
      </div>
      {geaendertWoanders && (
        <p className="hinweis">
          Diese Datei wurde gerade woanders geändert (Obsidian oder ein anderes Gerät). Dein Text bleibt unangetastet; beim Speichern entsteht
          eine Konfliktkopie – nichts geht verloren.
        </p>
      )}
      {bearbeiten ? (
        <Suspense fallback={<p className="leise">Lade Editor …</p>}>
          <Editor key={editorSchluessel} wert={text} beiAenderung={setText} beiSpeichern={() => void speichern()} />
        </Suspense>
      ) : endung(pfad) === 'md' || endung(pfad) === 'markdown' ? (
        <Markdown inhalt={datei.data.inhalt} pfad={pfad} />
      ) : (
        <pre className="rohtext">{datei.data.inhalt}</pre>
      )}
    </div>
  );
}
