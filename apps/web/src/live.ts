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
