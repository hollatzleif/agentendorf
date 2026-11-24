import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AktionInfo, BoerseAnalyse, VaultEintrag } from '@dorf/shared';
import { api } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { AktionStarten } from '../komponenten/Aktionen';

const BERATER = [
  { id: 'Boerse/aktie-analysieren', symbol: '🔍', titel: 'Aktie analysieren', text: 'Geschäft, Zahlen, Bewertung, Chancen und Risiken – mit klarer Einschätzung' },
  { id: 'Boerse/etf-vergleichen', symbol: '🧺', titel: 'ETF finden & vergleichen', text: 'Kosten, Index, Größe, Abbildung, Überschneidung mit deinem Depot' },
  { id: 'Boerse/depot-check', symbol: '🩺', titel: 'Depot-Check', text: 'Streuung, Klumpen, Kosten, Währungen – passt es zu deinem Ziel?' },
  { id: 'Boerse/berater-frage', symbol: '💬', titel: 'Frag den Berater', text: 'Freie Frage – im Chat, mit Quellen, du kannst nachfragen' },
] as const;

/** E223: Börse → Berater – Aktien- und ETF-Berater (Agenten mit Web und Depot-Werkzeugen, über Leifs Abo) */
export function BoerseBerater() {
  const aktionen = useQuery({ queryKey: ['aktionen', 'Boerse'], queryFn: () => api<AktionInfo[]>('/api/aktionen?gebaeude=Boerse') });
  const analyse = useQuery({ queryKey: ['boerse', 'analyse'], queryFn: () => api<BoerseAnalyse>('/api/boerse/analyse') });
  const berichte = useQuery({ queryKey: ['baum', 'Boerse/berater'], queryFn: () => api<VaultEintrag>('/api/vault/baum?pfad=Boerse/berater').catch(() => null) });
  const [offen, setOffen] = useState<{ id: string; vorgabe?: Record<string, string>; n: number } | null>(null);
  const a = offen ? aktionen.data?.find((x) => x.id === offen.id) : undefined;

  // Schnellfragen aus dem eigenen Depot
  const positionen = [...(analyse.data?.saxo?.positionen ?? []).map((p) => ({ name: p.name, wert: p.wert ?? 0, tag: p.tagProzent })), ...(analyse.data?.eigen ?? []).map((p) => ({ name: p.name, wert: p.wertEur ?? 0, tag: p.veraenderungProzent }))].sort((x, y) => y.wert - x.wert);
  const groesste = positionen[0];
  const bewegt = [...positionen].filter((p) => p.tag != null).sort((x, y) => Math.abs(y.tag!) - Math.abs(x.tag!))[0];
  const schnell: { text: string; id: string; vorgabe: Record<string, string> }[] = [
    ...(groesste ? [{ text: `Wie steht es um ${groesste.name}?`, id: 'Boerse/aktie-analysieren', vorgabe: { wert: groesste.name } }] : []),
    ...(bewegt && Math.abs(bewegt.tag!) >= 1 ? [{ text: `Warum bewegt sich ${bewegt.name} heute so (${bewegt.tag! > 0 ? '+' : ''}${bewegt.tag!.toFixed(1)} %)?`, id: 'Boerse/berater-frage', vorgabe: { frage: `Warum bewegt sich ${bewegt.name} heute um ${bewegt.tag!.toFixed(1)} %? Was steckt dahinter, und ist das für einen langfristigen Anleger wichtig?` } }] : []),
    { text: 'Welcher Welt-ETF passt zu mir?', id: 'Boerse/etf-vergleichen', vorgabe: { thema: 'Welt-ETF (MSCI World, FTSE All-World, MSCI ACWI)', wunsch: 'Sparplan-fähig, niedrige Kosten' } },
    { text: 'Bin ich zu einseitig investiert?', id: 'Boerse/depot-check', vorgabe: {} },
    { text: 'Was bedeuten die aktuellen Zinsen für mein Depot?', id: 'Boerse/berater-frage', vorgabe: { frage: 'Was bedeuten die aktuelle Zinsentwicklung (EZB, Fed) und die Marktlage für mein Depot? Muss ich etwas beachten?' } },
    { text: 'Wie investiere ich einen Einmalbetrag klug?', id: 'Boerse/berater-frage', vorgabe: { frage: 'Ich habe einen Einmalbetrag übrig. Auf einmal investieren oder über Monate verteilen? Was passt zu meinem Depot?' } },
  ];
  const liste = [...(berichte.data?.kinder ?? [])].filter((k) => k.art === 'datei').sort((x, y) => y.name.localeCompare(x.name)).slice(0, 12);

  return (
    <div className="boerse-berater">
      <p className="hinweis">
        Die Berater sind KI-Agenten mit Websuche und Blick auf dein Depot. Sie recherchieren, rechnen und sagen klar, was sie denken – sind aber keine zugelassene Anlageberatung. Kaufen und verkaufen kannst nur du; das Dorf handelt nie.
      </p>
      <div className="berater-karten">
        {BERATER.map((b) => {
          const da = aktionen.data?.some((x) => x.id === b.id);
          return (
            <button key={b.id} type="button" className={`berater-karte${offen?.id === b.id ? ' aktiv' : ''}`} disabled={!da} onClick={() => setOffen(offen?.id === b.id ? null : { id: b.id, n: Date.now() })}>
              <span className="berater-symbol" aria-hidden="true">
                {b.symbol}
              </span>
              <strong>{b.titel}</strong>
              <span className="leise">{da ? b.text : 'Aktion fehlt im Vault (kommt beim nächsten Start)'}</span>
            </button>
          );
        })}
      </div>
      <div className="ba-chips berater-schnell" aria-label="Schnellfragen">
        {schnell.map((x) => (
          <button key={x.text} type="button" className="klein" onClick={() => setOffen({ id: x.id, vorgabe: x.vorgabe, n: Date.now() })}>
            {x.text}
          </button>
        ))}
      </div>
      {a && <AktionStarten key={`${a.id}${offen!.n}`} a={a} vorgabe={offen!.vorgabe} />}
      <section className="karte innen" aria-label="Berichte der Berater">
        <h3>Letzte Berichte</h3>
        {liste.length ? (
          <ul className="berater-berichte">
            {liste.map((k) => (
              <li key={k.pfad}>
                <a href={bibliothekUrl(k.pfad)} onClick={linkKlick}>
                  {k.name.replace(/\.md$/, '').replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_/, '$1 $2:$3 · ').replace(/-/g, ' ')}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="leise">Noch keine – die Berater legen ihre Berichte in Boerse/berater/ ab.</p>
        )}
      </section>
    </div>
  );
}
