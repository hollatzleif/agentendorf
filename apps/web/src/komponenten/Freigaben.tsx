import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FreigabeInfo, PlanInhalt } from '@dorf/shared';
import { PlanTabelle } from './Plaene';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { zeitKurz } from '../texte';

const ARTEN: Record<string, string> = {
  datei_loeschen: 'Datei löschen',
  datei_ueberschreiben: 'Datei überschreiben',
  sonstiges: 'Sonstiges (erledigst du selbst)',
  lauf_starten: 'Aktion starten',
  plan_ausfuehren: 'Plan des Bürgermeisters',
  aktion_anlegen: 'Neuer Skill',
  persoenlichkeit_aendern: 'Persönlichkeit des Bürgermeisters',
  termin_anlegen: 'Termin eintragen (Vorschlag eines Agenten)',
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
              <strong>{f.titel}</strong> – {f.status}{f.automatisch ? " (automatisch, keine Antwort)" : ""}
              {f.ergebnis ? `: ${f.ergebnis}` : ''}
              {f.grund ? ` – Grund: „${f.grund}“` : ''} <span className="leise">({f.entschieden && zeitKurz(f.entschieden)})</span>
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
  const [grund, setGrund] = useState('');
  const inhalt = f.inhalt as { pfad?: string; inhalt?: string; beschreibung?: string; markdown?: string };
  const entscheiden = async (annehmen: boolean) => {
    setLaeuft(true);
    try {
      await api(`/api/freigaben/${f.id}/entscheiden`, { body: annehmen ? { annehmen } : { annehmen, ...(grund.trim() ? { grund: grund.trim() } : {}) } });
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
      {f.art === 'plan_ausfuehren' && (
        <>
          <PlanTabelle p={f.inhalt as PlanInhalt} />
          <p className="leise">{(f.inhalt as PlanInhalt).hinweis}</p>
        </>
      )}
      {f.begruendung && <p>{f.begruendung}</p>}
      {inhalt.pfad && f.art !== 'aktion_anlegen' && (
        <p>
          Datei:{' '}
          <a href={bibliothekUrl(inhalt.pfad)} onClick={linkKlick}>
            <code>{inhalt.pfad}</code>
          </a>
        </p>
      )}
      {inhalt.beschreibung && f.art !== 'plan_ausfuehren' && <p>{inhalt.beschreibung}</p>}
      {f.art === 'aktion_anlegen' && inhalt.markdown && (
        <details open>
          <summary>Vorgeschlagener Skill (wird so als Aktion gespeichert)</summary>
          <pre className="rohtext">{inhalt.markdown}</pre>
        </details>
      )}
      {inhalt.inhalt !== undefined && (
        <details open={f.art === 'persoenlichkeit_aendern'}>
          <summary>{f.art === 'persoenlichkeit_aendern' ? 'So soll der Bürgermeister künftig auftreten' : 'Neuer Inhalt ansehen'}</summary>
          <pre className="rohtext">{inhalt.inhalt}</pre>
        </details>
      )}
      <label className="grund">
        Falls du ablehnst – warum? (optional{f.chatId ? ', geht an den Bürgermeister' : ''})
        <input value={grund} onChange={(e) => setGrund(e.target.value)} maxLength={2000} placeholder="z. B. „zu teuer“, „erst nach der Prüfung“, „lieber nur Mathe 3“" />
      </label>
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
