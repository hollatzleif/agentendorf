import { useEffect, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { LiveEreignis } from '@dorf/shared';

type Zustand = 'verbinde' | 'verbunden' | 'getrennt';
let zustand: Zustand = 'verbinde';
const zuhoerer = new Set<() => void>();
const ereignisZuhoerer = new Set<(e: LiveEreignis) => void>();
const setzen = (z: Zustand) => {
  zustand = z;
  zuhoerer.forEach((f) => f());
};

export function useLiveZustand() {
  return useSyncExternalStore(
    (f) => {
      zuhoerer.add(f);
      return () => zuhoerer.delete(f);
    },
    () => zustand,
  );
}

export function useLiveEreignis(fn: (e: LiveEreignis) => void) {
  useEffect(() => {
    ereignisZuhoerer.add(fn);
    return () => {
      ereignisZuhoerer.delete(fn);
    };
  }, [fn]);
}

/**
 * Hält die WebSocket-Verbindung zum Server und übersetzt Ereignisse in Cache-Invalidierungen.
 * Verbindet sich nach Abbrüchen mit wachsendem Abstand neu (1 s … 30 s).
 */
export function useLiveVerbindung(qc: QueryClient, aktiv: boolean) {
  useEffect(() => {
    if (!aktiv) return;
    let ws: WebSocket | null = null;
    let versuch = 0;
    let timer: number | undefined;
    let beendet = false;

    const verbinden = () => {
      setzen('verbinde');
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      ws.onopen = () => {
        versuch = 0;
        setzen('verbunden');
        // nach einer Unterbrechung alles frisch holen
        void qc.invalidateQueries();
      };
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data)) as LiveEreignis;
        ereignisZuhoerer.forEach((f) => f(e));
        switch (e.typ) {
          case 'vault.geaendert':
            void qc.invalidateQueries({ queryKey: ['baum'] });
            void qc.invalidateQueries({ queryKey: ['datei', e.pfad] });
            void qc.invalidateQueries({ queryKey: ['suche'] });
            break;
          case 'gebaeude.geaendert':
            void qc.invalidateQueries({ queryKey: ['gebaeude'] });
            break;
          case 'konflikte.geaendert':
            void qc.invalidateQueries({ queryKey: ['konflikte'] });
            break;
          case 'sitzung.beendet':
            window.dispatchEvent(new Event('dorf:abgemeldet'));
            break;
          case 'lauf.status':
            void qc.invalidateQueries({ queryKey: ['plaene'] });
            void qc.invalidateQueries({ queryKey: ['chat', e.chatId] });
            void qc.invalidateQueries({ queryKey: ['chats'] });
            void qc.invalidateQueries({ queryKey: ['laeufe-aktiv'] });
            if (e.status !== 'laeuft') liveTextLeeren(e.laufId);
            break;
          case 'lauf.text':
            liveTextAnhaengen(e.laufId, e.text);
            break;
          case 'chat.geaendert':
            void qc.invalidateQueries({ queryKey: ['chat', e.chatId] });
            void qc.invalidateQueries({ queryKey: ['chats'] });
            break;
          case 'freigaben.geaendert':
            void qc.invalidateQueries({ queryKey: ['freigaben'] });
            break;
          case 'verbrauch.geaendert':
            void qc.invalidateQueries({ queryKey: ['verbrauch'] });
            break;
          case 'aktionen.geaendert':
            void qc.invalidateQueries({ queryKey: ['aktionen'] });
            break;
          case 'konfig.geaendert':
            void qc.invalidateQueries({ queryKey: ['agenten-konfig'] });
            void qc.invalidateQueries({ queryKey: ['telegram'] });
            break;
          case 'schreibtisch.geaendert':
            void qc.invalidateQueries({ queryKey: ['schreibtisch'] });
            break;
          case 'plaene.geaendert':
            void qc.invalidateQueries({ queryKey: ['plaene'] });
            break;
          case 'post.geaendert':
            void qc.invalidateQueries({ queryKey: ['post'] });
            break;
          case 'uni.geaendert':
            void qc.invalidateQueries({ queryKey: ['uni'] });
            void qc.invalidateQueries({ queryKey: ['aktion-quellen'] });
            break;
        }
      };
      ws.onclose = (ev) => {
        setzen('getrennt');
        if (beendet || ev.code === 4001) return;
        const warte = Math.min(30_000, 1000 * 2 ** versuch++);
        timer = window.setTimeout(verbinden, warte);
      };
    };
    verbinden();
    const sichtbar = () => {
      if (document.visibilityState === 'visible' && ws?.readyState === WebSocket.CLOSED) {
        window.clearTimeout(timer);
        versuch = 0;
        verbinden();
      }
    };
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      beendet = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sichtbar);
      ws?.close();
    };
  }, [qc, aktiv]);
}

// ---- Live-Text laufender Agenten (entsteht Stück für Stück) -----------------------------------
const liveTexte = new Map<string, string>();
const liveTextZuhoerer = new Set<() => void>();
function liveTextAnhaengen(laufId: string, t: string) {
  liveTexte.set(laufId, (liveTexte.get(laufId) ?? '') + t);
  liveTextZuhoerer.forEach((f) => f());
}
function liveTextLeeren(laufId: string) {
  if (liveTexte.delete(laufId)) liveTextZuhoerer.forEach((f) => f());
}
export function useLiveText(laufId: string | undefined) {
  return useSyncExternalStore(
    (f) => {
      liveTextZuhoerer.add(f);
      return () => liveTextZuhoerer.delete(f);
    },
    () => (laufId ? (liveTexte.get(laufId) ?? '') : ''),
  );
}
