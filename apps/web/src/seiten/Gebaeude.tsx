import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Gebaeude, VaultDatei } from '@dorf/shared';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick, navigieren, useOrt } from '../router';
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
import { TodoBrett } from '../komponenten/TodoBrett';
import { BankUebersicht } from '../komponenten/BankUebersicht';
import { CorpsUebersicht } from '../komponenten/CorpsUebersicht';
import { BoerseUebersicht } from '../komponenten/BoerseUebersicht';
import { KirchturmUhr } from '../komponenten/KirchturmUhr';
import { MarktKalender } from '../komponenten/MarktKalender';

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
const MARKT_VORNE = [
  ['todo', 'To-do'],
  ['kalender', 'Kalender'],
] as const;
const BANK_VORNE = [['konto', 'Konto']] as const;
const BOERSE_VORNE = [['depot', 'Depot']] as const;
const KIRCHTURM_VORNE = [['uhr', 'Uhr']] as const;
const CORPS_VORNE = [
  ['termine', 'Termine'],
  ['aemter', 'Ämter & Aufgaben'],
  ['corpspost', 'Corps-Mails'],
] as const;
const EINKAUF_VORNE = [
  ['einkauf', 'Einkaufsliste'],
  ['wunsch', 'Wunschliste'],
] as const;
const RATHAUS_REITER = [
  ['freigaben', 'Freigaben'],
  ['alle-chats', 'Alle Chats'],
  ['verbrauch', 'Verbrauch'],
  ['agenten', 'Agenten-Einstellungen'],
] as const;

/** Alle Reiter eines Gebäudes (Schlüssel, Titel) – auch für die Knöpfe im Dorf */
export function reiterFuer(id: string): readonly (readonly [string, string])[] {
  return id === 'Rathaus' ? [...RATHAUS_VORNE, ...REITER, ...RATHAUS_REITER] : id === 'Uni' ? [...UNI_VORNE, ...REITER] : id === 'Post' ? [...POST_VORNE, ...REITER] : id === 'Marktplatz' ? [...MARKT_VORNE, ...REITER] : id === 'Einkaufsladen' ? [...EINKAUF_VORNE, ...REITER] : id === 'Bank' ? [...BANK_VORNE, ...REITER] : id === 'Corpshaus' ? [...CORPS_VORNE, ...REITER] : id === 'Boerse' ? [...BOERSE_VORNE, ...REITER] : id === 'Kirchturm' ? [...KIRCHTURM_VORNE, ...REITER] : REITER;
}

export function standardReiter(id: string) {
  return id === 'Rathaus' ? 'schreibtisch' : id === 'Uni' ? 'studium' : id === 'Post' ? 'eingang' : id === 'Marktplatz' ? 'todo' : id === 'Einkaufsladen' ? 'einkauf' : id === 'Bank' ? 'konto' : id === 'Corpshaus' ? 'termine' : id === 'Boerse' ? 'depot' : id === 'Kirchturm' ? 'uhr' : 'aktionen';
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
  const alle = reiterFuer(id);

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
        {reiter === 'aktionen' && (g.status === 'geschlossen' ? <Eroeffnen id={id} /> : <Aktionen gebaeude={id} />)}
        {reiter === 'chats' && <ChatListe gebaeude={id} />}
        {reiter === 'uebersicht' && (
          <>
            {anweisung.data ? <Markdown inhalt={anweisung.data.inhalt} pfad={anweisung.data.pfad} /> : <p>Lade …</p>}
            <GebaeudeEinstellen g={g} />
          </>
        )}
        {reiter === 'dateien' && <Dateibaum wurzel={id} />}
        {reiter === 'schreibtisch' && <Schreibtisch />}
        {reiter === 'studium' && <UniUebersicht />}
        {reiter === 'eingang' && <PostEingang />}
        {reiter === 'todo' && <TodoBrett />}
        {reiter === 'konto' && <BankUebersicht />}
        {reiter === 'termine' && <CorpsUebersicht />}
        {reiter === 'depot' && <BoerseUebersicht />}
        {reiter === 'uhr' && <KirchturmUhr />}
        {reiter === 'kalender' && <MarktKalender />}
        {reiter === 'aemter' && <TodoBrett liste="corps" platzhalter="Neue Aufgabe – das Amt trägst du beim Bearbeiten als Gruppe ein" gruppiert />}
        {reiter === 'corpspost' && <PostEingang fest="Corps" />}
        {reiter === 'einkauf' && <TodoBrett liste="einkauf" platzhalter="Was fehlt? z. B. 2 l Milch" gruppiert />}
        {reiter === 'wunsch' && <TodoBrett liste="wunsch" platzhalter="Was möchtest du kaufen?" />}
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

/** Etappe 7: „noch nicht eröffnet“ → per Knopf eröffnen */
function Eroeffnen({ id }: { id: string }) {
  const [fehler, setFehler] = useState('');
  return (
    <div>
      <p>Dieses Gebäude ist noch nicht eröffnet.</p>
      <button
        className="haupt"
        onClick={() =>
          void api(`/api/gebaeude/${encodeURIComponent(id)}`, { methode: 'PATCH', body: { status: 'offen' } }).catch((e) => setFehler(e instanceof ApiFehler ? e.message : String(e)))
        }
      >
        🎉 Gebäude eröffnen
      </button>
      {fehler && <p className="fehler">{fehler}</p>}
    </div>
  );
}

/** Etappe 7: Name, Symbol, Beschreibung ändern, schließen; Arbeitsanweisung in der Bibliothek bearbeiten */
function GebaeudeEinstellen({ g }: { g: Gebaeude }) {
  const qc = useQueryClient();
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState(g.name);
  const [symbol, setSymbol] = useState(g.symbol);
  const [beschreibung, setBeschreibung] = useState(g.beschreibung);
  const [fehler, setFehler] = useState('');
  const speichern = async (body: Record<string, unknown>) => {
    setFehler('');
    try {
      await api(`/api/gebaeude/${encodeURIComponent(g.id)}`, { methode: 'PATCH', body });
      await qc.invalidateQueries({ queryKey: ['gebaeude'] });
      setOffen(false);
    } catch (e) {
      setFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  };
  return (
    <details className="gebaeude-einstellen" open={offen} onToggle={(e) => setOffen((e.target as HTMLDetailsElement).open)}>
      <summary>Gebäude einstellen</summary>
      <form
        className="formspalte"
        aria-label="Gebäude einstellen"
        onSubmit={(e) => {
          e.preventDefault();
          void speichern({ name, symbol, beschreibung });
        }}
      >
        <div className="zeile">
          <label>
            Symbol
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={8} style={{ width: '5rem' }} />
          </label>
          <label style={{ flex: 1 }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
        </div>
        <label>
          Kurzbeschreibung
          <input value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} maxLength={200} />
        </label>
        <div className="zeile">
          <button type="submit" className="haupt">
            Speichern
          </button>
          <a className="knopf" href={bibliothekUrl(`${g.id}/gebaeude.md`)} onClick={linkKlick}>
            Arbeitsanweisung bearbeiten
          </a>
          {g.id !== 'Rathaus' && (
            <button type="button" className="gefahr" onClick={() => void speichern({ status: 'geschlossen' })}>
              Schließen
            </button>
          )}
        </div>
        {fehler && <p className="fehler">{fehler}</p>}
      </form>
    </details>
  );
}
