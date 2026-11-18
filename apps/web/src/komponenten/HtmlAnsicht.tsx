import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, rohUrl } from '../api';

export const seiteUrl = (pfad: string, v?: string) => `/api/vault/seite?pfad=${encodeURIComponent(pfad)}${v ? `&v=${v.slice(0, 12)}` : ''}`;

/**
 * HTML aus dem Vault (z. B. Lernzettel, Probeklausur, Checkliste) – abgeschottet:
 * sandbox="allow-scripts" ohne allow-same-origin, der Server schickt zusätzlich eine CSP ohne Netz.
 *
 * Häkchen-Brücke (E60): Die Seite selbst kann nichts speichern. Sie darf der App aber per postMessage einen kleinen
 * Zustand geben, den die App für genau diese Datei im Dorf speichert:
 *   parent.postMessage({ dorf: 'stand-laden' }, '*')            → Antwort an die Seite: { dorf: 'stand', stand }
 *   parent.postMessage({ dorf: 'stand-speichern', stand }, '*')  → wird (gebündelt) gespeichert
 * Nur Nachrichten aus genau diesem Rahmen zählen; mehr kann die Seite über die Brücke nicht.
 */
export function HtmlAnsicht({ pfad }: { pfad: string }) {
  // Version nur, damit der Rahmen nach Änderungen (Live-Ereignis) neu lädt
  const d = useQuery({ queryKey: ['datei', pfad, 'seite'], queryFn: () => api<{ version: string }>(`/api/vault/datei?pfad=${encodeURIComponent(pfad)}`) });
  const url = seiteUrl(pfad, d.data?.version);
  const rahmen = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let zeitgeber: ReturnType<typeof setTimeout> | undefined;
    let offen: unknown;
    const speichern = () => {
      zeitgeber = undefined;
      void api('/api/vault/seitenstand', { methode: 'PUT', body: { pfad, stand: offen } }).catch(() => undefined);
    };
    const nachricht = (e: MessageEvent) => {
      if (!rahmen.current || e.source !== rahmen.current.contentWindow) return;
      const m = e.data as { dorf?: string; stand?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      if (m.dorf === 'stand-laden') {
        void api<{ stand: unknown }>(`/api/vault/seitenstand?pfad=${encodeURIComponent(pfad)}`)
          .then((r) => rahmen.current?.contentWindow?.postMessage({ dorf: 'stand', stand: r.stand }, '*'))
          .catch(() => rahmen.current?.contentWindow?.postMessage({ dorf: 'stand', stand: null }, '*'));
      } else if (m.dorf === 'stand-speichern') {
        offen = m.stand;
        if (zeitgeber) clearTimeout(zeitgeber);
        zeitgeber = setTimeout(speichern, 400);
      }
    };
    window.addEventListener('message', nachricht);
    return () => {
      window.removeEventListener('message', nachricht);
      // beim Schließen nichts verlieren
      if (zeitgeber) {
        clearTimeout(zeitgeber);
        speichern();
      }
    };
  }, [pfad]);

  return (
    <div className="html-ansicht">
      <div className="zeile">
        <span className="leise">Abgeschottete Seite – Skripte laufen, aber ohne Netz und ohne Zugriff auf das Dorf.</span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Vollbild
        </a>
        <a href={rohUrl(pfad, true)}>Herunterladen</a>
      </div>
      {d.data && <iframe ref={rahmen} key={url} title={pfad} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="html-rahmen" />}
    </div>
  );
}
