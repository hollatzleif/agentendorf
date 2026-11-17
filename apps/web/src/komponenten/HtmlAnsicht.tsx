import { useQuery } from '@tanstack/react-query';
import { api, rohUrl } from '../api';

export const seiteUrl = (pfad: string, v?: string) => `/api/vault/seite?pfad=${encodeURIComponent(pfad)}${v ? `&v=${v.slice(0, 12)}` : ''}`;

/**
 * HTML aus dem Vault (z. B. Lernzettel, Probeklausur) – abgeschottet:
 * sandbox="allow-scripts" ohne allow-same-origin, der Server schickt zusätzlich eine CSP ohne Netz.
 */
export function HtmlAnsicht({ pfad }: { pfad: string }) {
  // Version nur, damit der Rahmen nach Änderungen (Live-Ereignis) neu lädt
  const d = useQuery({ queryKey: ['datei', pfad, 'seite'], queryFn: () => api<{ version: string }>(`/api/vault/datei?pfad=${encodeURIComponent(pfad)}`) });
  const url = seiteUrl(pfad, d.data?.version);
  return (
    <div className="html-ansicht">
      <div className="zeile">
        <span className="leise">Abgeschottete Seite – Skripte laufen, aber ohne Netz und ohne Zugriff auf das Dorf.</span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Vollbild
        </a>
        <a href={rohUrl(pfad, true)}>Herunterladen</a>
      </div>
      {d.data && <iframe key={url} title={pfad} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="html-rahmen" />}
    </div>
  );
}
