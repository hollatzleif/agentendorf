import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { KirchturmZustand, LiveEreignis } from '@dorf/shared';
import { api } from '../api';
import { useLiveEreignis } from '../live';
import { Klingelt, useKirchturm } from '../komponenten/KirchturmUhr';
import { glocke, glockeStopp, istProgramm, melden } from './desktop';

/**
 * E74: Wenn der Kirchturm klingelt – überall ein Hinweis mit „Aus“/„Schlummern“, im Desktop-Programm dazu
 * die Glocke und eine Systemmeldung. Andere Töne gibt es im Dorf nicht.
 */
export function KirchturmGlocke() {
  const qc = useQueryClient();
  const q = useKirchturm();
  const gelaeutet = useRef(new Set<string>());
  const programm = istProgramm();

  const ereignis = useCallback(
    (e: LiveEreignis) => {
      if (e.typ !== 'kirchturm.klingelt' || gelaeutet.current.has(e.klingel.id)) return;
      gelaeutet.current.add(e.klingel.id);
      if (!programm) return;
      const wiederholen = q.data?.toene.weckerWiederholen ?? 6;
      void glocke(e.klingel.ton, e.klingel.ton === 'gelaeut' ? wiederholen : 1);
      void melden(e.klingel.titel, e.klingel.text);
    },
    [programm, q.data?.toene.weckerWiederholen],
  );
  useLiveEreignis(ereignis);

  // alles ausgeschaltet (hier oder auf einem anderen Gerät) → Glocke verstummt
  const anzahl = q.data?.klingelt.length ?? 0;
  const vorher = useRef(0);
  useEffect(() => {
    if (programm && vorher.current > 0 && anzahl === 0) void glockeStopp();
    vorher.current = anzahl;
  }, [anzahl, programm]);

  const imKirchturm = location.pathname.startsWith('/gebaeude/Kirchturm') || new URLSearchParams(location.search).get('g') === 'Kirchturm';
  if (!q.data?.klingelt.length || imKirchturm) return null;
  const befehl = async (b: Record<string, unknown>) => {
    const z = await api<KirchturmZustand>('/api/kirchturm', { body: b });
    qc.setQueryData(['kirchturm'], { ...z, versatz: Date.parse(z.jetzt) - Date.now() });
  };
  return (
    <div className="kirchturm-schwebend">
      <Klingelt z={q.data} befehl={befehl} />
    </div>
  );
}
