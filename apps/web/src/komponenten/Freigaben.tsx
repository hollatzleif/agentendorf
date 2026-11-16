import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FreigabeInfo } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { zeitKurz } from '../texte';

const ARTEN: Record<string, string> = {
  datei_loeschen: 'Datei löschen',
  datei_ueberschreiben: 'Datei überschreiben',
  sonstiges: 'Sonstiges (erledigst du selbst)',
  lauf_starten: 'Aktion starten',
};

export function Freigaben() {
  const offen = useQuery({ queryKey: ['freigaben', 'offen'], queryFn: () => api<FreigabeInfo[]>('/api/freigaben?status=offen') });
  const erledigt = useQuery({ queryKey: ['freigaben', 'erledigt'], queryFn: () => api<FreigabeInfo[]>('/api/freigaben?status=erledigt') });
  return (
    <div>
      <h3>Wartet auf dich</h3>
      {offen.data?.length === 0 && <p className="leise">Nichts offen. 👍</p>}
      {offen.data?.map((f) => <FreigabeKarte key={f.id} f={f} />)}
      <details>
        <summary>Erledigt ({erledigt.data?.length ?? 0})</summary>
        <ul className="chatliste">
          {erledigt.data?.map((f) => (
            <li key={f.id}>
              <strong>{f.titel}</strong> – {f.status}
              {f.ergebnis ? `: ${f.ergebnis}` : ''} <span className="leise">({f.entschieden && zeitKurz(f.entschieden)})</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function FreigabeKarte({ f }: { f: FreigabeInfo }) {
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const inhalt = f.inhalt as { pfad?: string; inhalt?: string; beschreibung?: string };
  const entscheiden = async (annehmen: boolean) => {
    setLaeuft(true);
    try {
      await api(`/api/freigaben/${f.id}/entscheiden`, { body: { annehmen } });
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
      setLaeuft(false);
    }
  };
  return (
    <div className="karte innen freigabe">
      <div className="leise">
        {ARTEN[f.art] ?? f.art} · {f.gebaeude} · {zeitKurz(f.erstellt)}
        {f.chatId && (
          <>
            {' · '}
            <a href={`/chats/${f.chatId}`} onClick={linkKlick}>
              Chat
            </a>
          </>
        )}
      </div>
      <h4>{f.titel}</h4>
      {f.begruendung && <p>{f.begruendung}</p>}
      {inhalt.pfad && (
        <p>
          Datei:{' '}
          <a href={bibliothekUrl(inhalt.pfad)} onClick={linkKlick}>
            <code>{inhalt.pfad}</code>
          </a>
        </p>
      )}
      {inhalt.beschreibung && <p>{inhalt.beschreibung}</p>}
      {inhalt.inhalt !== undefined && (
        <details>
          <summary>Neuer Inhalt ansehen</summary>
          <pre className="rohtext">{inhalt.inhalt}</pre>
        </details>
      )}
      <div className="werkzeuge">
        <button className="haupt" disabled={laeuft} onClick={() => entscheiden(true)}>
          Ja, ausführen
        </button>
        <button className="gefahr" disabled={laeuft} onClick={() => entscheiden(false)}>
          Ablehnen
        </button>
      </div>
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}
