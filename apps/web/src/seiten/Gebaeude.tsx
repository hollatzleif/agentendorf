import { useQuery } from '@tanstack/react-query';
import type { Gebaeude, VaultDatei } from '@dorf/shared';
import { api } from '../api';
import { linkKlick, navigieren, useOrt } from '../router';
import { Markdown } from '../komponenten/Markdown';
import { Dateibaum } from '../komponenten/Dateibaum';
import { Aktionen } from '../komponenten/Aktionen';
import { ChatListe } from '../komponenten/ChatListe';
import { Freigaben } from '../komponenten/Freigaben';
import { Verbrauch } from '../komponenten/Verbrauch';
import { AgentenEinstellungen } from '../komponenten/AgentenEinstellungen';
import { Schreibtisch } from '../komponenten/Schreibtisch';
import { Plaene } from '../komponenten/Plaene';
import { UniUebersicht } from '../komponenten/UniUebersicht';
import { PostEingang } from '../komponenten/PostEingang';
import { MorgenzeitungAnsicht } from '../komponenten/MorgenzeitungAnsicht';

const REITER = [
  ['aktionen', 'Aktionen'],
  ['chats', 'Chats'],
  ['uebersicht', 'Übersicht'],
  ['dateien', 'Dateien'],
] as const;
const RATHAUS_VORNE = [
  ['schreibtisch', 'Schreibtisch'],
  ['morgenzeitung', 'Morgenzeitung'],
  ['plaene', 'Pläne'],
] as const;
const UNI_VORNE = [['studium', 'Studium']] as const;
const POST_VORNE = [['eingang', 'Eingang']] as const;
const RATHAUS_REITER = [
  ['freigaben', 'Freigaben'],
  ['alle-chats', 'Alle Chats'],
  ['verbrauch', 'Verbrauch'],
  ['agenten', 'Agenten-Einstellungen'],
] as const;

export function standardReiter(id: string) {
  return id === 'Rathaus' ? 'schreibtisch' : id === 'Uni' ? 'studium' : id === 'Post' ? 'eingang' : 'aktionen';
}

export function GebaeudeSeite({ id }: { id: string }) {
  const { suche } = useOrt();
  const reiter = suche.get('reiter') ?? standardReiter(id);
  return (
    <section>
      <a href="/" onClick={linkKlick} className="zurueck">
        ← Dorf
      </a>
      <GebaeudeInhalt id={id} reiter={reiter} reiterWaehlen={(k) => navigieren(`/gebaeude/${encodeURIComponent(id)}?reiter=${k}`, true)} />
    </section>
  );
}

/** Kopf, Reiter und Inhalt eines Gebäudes – als eigene Seite oder als Menü über dem Dorf */
export function GebaeudeInhalt({ id, reiter, reiterWaehlen, kompakt }: { id: string; reiter: string; reiterWaehlen: (k: string) => void; kompakt?: boolean }) {
  const liste = useQuery({ queryKey: ['gebaeude'], queryFn: () => api<Gebaeude[]>('/api/gebaeude') });
  const g = liste.data?.find((x) => x.id === id);
  const anweisung = useQuery({
    queryKey: ['datei', `${id}/gebaeude.md`],
    queryFn: () => api<VaultDatei>(`/api/vault/datei?pfad=${encodeURIComponent(`${id}/gebaeude.md`)}`),
    enabled: reiter === 'uebersicht',
  });

  if (liste.isPending) return <p>Lade …</p>;
  if (!g) return <p className="karte">Gebäude „{id}“ gibt es nicht (mehr).</p>;
  const alle = id === 'Rathaus' ? [...RATHAUS_VORNE, ...REITER, ...RATHAUS_REITER] : id === 'Uni' ? [...UNI_VORNE, ...REITER] : id === 'Post' ? [...POST_VORNE, ...REITER] : REITER;

  return (
    <>
      {kompakt ? (
        <h2>
          {g.symbol} {g.name} {g.status === 'geschlossen' && <span className="abzeichen">noch nicht eröffnet</span>}
        </h2>
      ) : (
        <h1>
          {g.symbol} {g.name} {g.status === 'geschlossen' && <span className="abzeichen">noch nicht eröffnet</span>}
        </h1>
      )}
      {g.fehler && <p className="fehler">{g.fehler}</p>}
      <div className="reiter">
        {alle.map(([k, t]) => (
          <button key={k} className={reiter === k ? 'aktiv' : ''} onClick={() => reiterWaehlen(k)}>
            {t}
          </button>
        ))}
      </div>
      <div className="karte">
        {reiter === 'aktionen' &&
          (g.status === 'geschlossen' ? <p className="leise">Dieses Gebäude ist noch nicht eröffnet.</p> : <Aktionen gebaeude={id} />)}
        {reiter === 'chats' && <ChatListe gebaeude={id} />}
        {reiter === 'uebersicht' && (anweisung.data ? <Markdown inhalt={anweisung.data.inhalt} pfad={anweisung.data.pfad} /> : <p>Lade …</p>)}
        {reiter === 'dateien' && <Dateibaum wurzel={id} />}
        {reiter === 'schreibtisch' && <Schreibtisch />}
        {reiter === 'studium' && <UniUebersicht />}
        {reiter === 'eingang' && <PostEingang />}
        {reiter === 'morgenzeitung' && <MorgenzeitungAnsicht />}
        {reiter === 'plaene' && <Plaene />}
        {reiter === 'freigaben' && <Freigaben />}
        {reiter === 'alle-chats' && <ChatListe />}
        {reiter === 'verbrauch' && <Verbrauch />}
        {reiter === 'agenten' && <AgentenEinstellungen />}
      </div>
    </>
  );
}
