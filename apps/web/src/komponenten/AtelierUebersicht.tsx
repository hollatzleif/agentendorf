import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AtelierStand } from '@dorf/shared';
import { api, rohUrl } from '../api';
import { linkKlick } from '../router';
import { alleDateien, endung, finden, ordnerVon, useBaum } from '../vaultHilfen';

/** E198 – Atelier: Einstieg in den Bildeditor und die Bilder des Gebäudes (Editor selbst: /atelier, wird erst dort geladen) */
const VORSCHAU = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const OEFFENBAR = new Set([...VORSCHAU, 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'atelier']);

export function AtelierUebersicht() {
  const baum = useBaum();
  const stand = useQuery({ queryKey: ['atelier', 'stand'], queryFn: () => api<AtelierStand>('/api/atelier/stand'), staleTime: 60_000 });
  const bilder = useMemo(
    () =>
      alleDateien(finden(baum.data, 'Atelier'))
        .filter((p) => OEFFENBAR.has(endung(p)) && !p.includes('.konflikt-'))
        .sort((a, b) => a.localeCompare(b, 'de')),
    [baum.data],
  );
  const s = stand.data;
  return (
    <>
      <p>
        <a className="knopf haupt" href="/atelier" onClick={linkKlick} data-testid="atelier-oeffnen">
          🎨 Bildeditor öffnen
        </a>
      </p>
      <p className="leise">
        Ebenen, Pinsel, Auswahl, Text, Formen, Anpassungen und Filter – direkt hier in der App, auch am Handy. Bilder aus dem ganzen Vault öffnest du im Editor über „Datei → Öffnen“ oder in der Bibliothek über „Im Atelier bearbeiten“.
      </p>
      {s && (
        <ul className="leise" data-testid="atelier-stand">
          <li>Hintergrund entfernen: {s.hintergrund ? 'bereit (rechnet der Rechenraum, ohne Internet)' : s.rechenraum ? 'Modell fehlt noch – kommt mit dem nächsten Deploy' : 'Rechenraum nicht erreichbar'}</li>
          <li>Hochskalieren: {s.hochskalieren ? 'bereit (bis etwa 1024 × 1024)' : s.rechenraum ? 'Modell fehlt noch – kommt mit dem nächsten Deploy' : 'Rechenraum nicht erreichbar'}</li>
          <li>
            Bild generieren / generatives Füllen: {s.generieren ? 'eingerichtet (Cloudflare Workers AI, kostenloses Tageskontingent)' : <>nicht eingerichtet – auf dem Server <code>dorf bilder-einrichten</code></>}
          </li>
        </ul>
      )}
      <h2>Bilder im Atelier</h2>
      {baum.isPending ? (
        <p className="leise">Lade …</p>
      ) : bilder.length === 0 ? (
        <p className="leise" data-testid="atelier-leer">
          Noch keine Bilder. Der Editor speichert standardmäßig nach <code>Atelier/bilder/</code>.
        </p>
      ) : (
        <ul className="atelier-bilder" data-testid="atelier-bilder">
          {bilder.map((p) => (
            <li key={p}>
              <a href={`/atelier?pfad=${encodeURIComponent(p)}`} onClick={linkKlick} title={`${p} im Editor öffnen`}>
                {VORSCHAU.has(endung(p)) ? <img src={rohUrl(p)} alt="" loading="lazy" /> : <span className="datei-symbol">{endung(p) === 'atelier' ? '🗂️' : '🖼️'}</span>}
                <strong>{p.slice(p.lastIndexOf('/') + 1)}</strong>
                <span className="leise">{ordnerVon(p).replace(/^Atelier\/?/, '') || 'Atelier'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
