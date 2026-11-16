import { useState } from 'react';
import type { VaultEintrag } from '@dorf/shared';
import { bibliothekUrl, navigieren } from '../router';
import { finden, useBaum } from '../vaultHilfen';

export function Dateibaum({ wurzel = '', ausgewaehlt }: { wurzel?: string; ausgewaehlt?: string }) {
  const baum = useBaum();
  const [offen, setOffen] = useState<Set<string>>(() => {
    const s = new Set<string>([wurzel]);
    // Pfad zum ausgewählten Eintrag aufklappen
    if (ausgewaehlt) {
      const teile = ausgewaehlt.split('/');
      for (let i = 1; i < teile.length; i++) s.add(teile.slice(0, i).join('/'));
    }
    return s;
  });
  if (baum.isPending) return <p className="leise">Lade Dateien …</p>;
  if (baum.isError) return <p className="fehler">{baum.error.message}</p>;
  const start = finden(baum.data, wurzel);
  if (!start) return <p className="leise">Ordner nicht gefunden.</p>;

  const umschalten = (p: string) =>
    setOffen((alt) => {
      const neu = new Set(alt);
      if (neu.has(p)) neu.delete(p);
      else neu.add(p);
      return neu;
    });

  const zeile = (e: VaultEintrag, tiefe: number): React.ReactNode => (
    <li key={e.pfad}>
      <button
        className={`baum-zeile ${e.art}${e.pfad === ausgewaehlt ? ' gewaehlt' : ''}`}
        style={{ paddingLeft: `${0.4 + tiefe * 0.9}rem` }}
        onClick={() => {
          if (e.art === 'ordner') umschalten(e.pfad);
          navigieren(bibliothekUrl(e.pfad));
        }}
        title={e.pfad}
      >
        <span className="baum-symbol">{e.art === 'ordner' ? (offen.has(e.pfad) ? '▾' : '▸') : '·'}</span>
        {e.name}
      </button>
      {e.art === 'ordner' && offen.has(e.pfad) && e.kinder && e.kinder.length > 0 && <ul>{e.kinder.map((k) => zeile(k, tiefe + 1))}</ul>}
    </li>
  );

  return <ul className="baum">{(start.kinder ?? []).map((k) => zeile(k, 0))}</ul>;
}
