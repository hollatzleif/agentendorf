import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatDetail, FreigabeInfo, LiveEreignis } from '@dorf/shared';
import { api } from '../api';
import { useLiveEreignis } from '../live';
import { glocke, istProgramm, melden as systemMeldung, zaehlerSetzen } from './desktop';
import { useKirchturm } from '../komponenten/KirchturmUhr';

const imHintergrund = () => document.hidden || !document.hasFocus();

/**
 * Nur im Desktop-Programm (Etappe 6): Systemmeldungen für neue Freigaben und fertige/fehlgeschlagene Aufgaben
 * (nur wenn das Fenster nicht im Vordergrund ist) und die Zahl offener Freigaben fürs Symbol in der Leiste.
 */
export function ProgrammMeldungen() {
  const aktiv = istProgramm();
  // E74: ein Glockenschlag zur Mitteilung (abschaltbar im Kirchturm)
  const kirchturm = useKirchturm();
  const mitTon = kirchturm.data?.toene.mitteilungen ?? true;
  const melden = useCallback(
    (titel: string, text: string) => {
      if (mitTon) void glocke('schlag', 1);
      return systemMeldung(titel, text);
    },
    [mitTon],
  );
  const freigaben = useQuery({ queryKey: ['freigaben', 'offen'], queryFn: () => api<FreigabeInfo[]>('/api/freigaben?status=offen'), enabled: aktiv });
  const bekannt = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!aktiv || !freigaben.data) return;
    void zaehlerSetzen(freigaben.data.length);
    const ids = new Set(freigaben.data.map((f) => f.id));
    // beim ersten Laden nichts melden – nur, was danach neu dazukommt
    if (bekannt.current && imHintergrund()) for (const f of freigaben.data) if (!bekannt.current.has(f.id)) void melden('✉️ Freigabe wartet', f.titel);
    bekannt.current = ids;
  }, [aktiv, freigaben.data, melden]);

  const gemeldet = useRef(new Set<string>());
  const ereignis = useCallback(
    (e: LiveEreignis) => {
      if (!aktiv || e.typ !== 'lauf.status' || (e.status !== 'fertig' && e.status !== 'fehler') || gemeldet.current.has(e.laufId)) return;
      gemeldet.current.add(e.laufId);
      if (!imHintergrund()) return;
      void api<ChatDetail>(`/api/chats/${encodeURIComponent(e.chatId)}`)
        .then((c) => {
          // Helfer meldet der Bürgermeister gesammelt; System-Läufe (Einordnung, Zeitung) nicht
          if (c.elternChatId || c.rolle === 'system') return;
          return melden(e.status === 'fertig' ? '✅ Fertig' : '❌ Fehler', c.titel);
        })
        .catch(() => undefined);
    },
    [aktiv, melden],
  );
  useLiveEreignis(ereignis);
  return null;
}
