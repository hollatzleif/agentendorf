import type { LaufStatus, Stufe } from '@dorf/shared';

export const laufStatusText = (s: LaufStatus) =>
  ({ wartet_freigabe: 'wartet auf Freigabe', wartend: 'in der Warteschlange', laeuft: 'läuft', fertig: 'fertig', fehler: 'Fehler', abgebrochen: 'abgebrochen' })[s];

export const stufeText = (s: Stufe) => ({ klein: 'klein', mittel: 'mittel', gross: 'groß' })[s];

export const zeitKurz = (iso: string) => new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
