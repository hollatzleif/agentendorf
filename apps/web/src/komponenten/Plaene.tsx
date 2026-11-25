import { useQuery } from '@tanstack/react-query';
import type { PlanInfo, PlanInhalt } from '@dorf/shared';
import { api } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { laufStatusText, stufeText, zeitKurz } from '../texte';
import { Em } from '../apple/wissen-teile';

const PLAN_STATUS: Record<PlanInfo['status'], string> = { wartet: 'wartet auf dich', abgelehnt: 'abgelehnt', laeuft: 'Helfer arbeiten', fertig: 'fertig' };

/** Teilaufgaben eines Plans als Tabelle (auch in Freigaben verwendet) */
export function PlanTabelle({ p }: { p: PlanInhalt }) {
  return (
    <table className="tabelle plan-tabelle">
      <thead>
        <tr>
          <th>#</th>
          <th>Teilaufgabe</th>
          <th>Gebäude</th>
          <th>Aktion</th>
          <th>Motor · Stufe</th>
        </tr>
      </thead>
      <tbody>
        {p.teilaufgaben.map((t, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td title={t.auftrag}>
              {t.titel}
              {!!t.nach?.length && <span className="leise"> (nach {t.nach.join(', ')})</span>}
            </td>
            <td>{t.gebaeude}</td>
            <td>{t.aktion ?? 'freier Helfer'}</td>
            <td>
              {t.motor} · {stufeText(t.stufe)}
              {t.kostenUsd > 0 ? ` · ~${t.kostenUsd.toFixed(2)} $` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Plaene() {
  const q = useQuery({ queryKey: ['plaene'], queryFn: () => api<PlanInfo[]>('/api/plaene') });
  if (q.isPending) return <p className="leise">Lade …</p>;
  if (!q.data?.length) return <p className="leise">Noch keine Pläne. Der Bürgermeister macht einen, wenn eine Aufgabe mehrere Helfer braucht – bestätigen musst du nur, wenn du selbst einen Plan sehen wolltest.</p>;
  return (
    <div className="plaene">
      {q.data.map((p) => (
        <div key={p.planId} className="karte innen plan-karte">
          <div className="leise">
            {zeitKurz(p.erstellt)} · <span className={`lauf-chip plan-${p.status}`}>{PLAN_STATUS[p.status]}</span> ·{' '}
            <a href={`/chats/${p.chatId}`} onClick={linkKlick}>
              Bürgermeister-Chat
            </a>
            {p.vaultPfad && (
              <>
                {' · '}
                <a href={bibliothekUrl(p.vaultPfad)} onClick={linkKlick}>
                  im Vault
                </a>
              </>
            )}
          </div>
          <h4>{p.zusammenfassung}</h4>
          <PlanTabelle p={p} />
          <p className="leise">
            {p.hinweis}
            {p.ohneFreigabe ? ' Ohne Rückfrage gestartet.' : ''}
          </p>
          {!!p.uebersprungen?.length && (
            <ul className="chatliste">
              {p.uebersprungen.map((u) => (
                <li key={u.nr}>
                  {u.nr}. <Em e="⏭️" /> nicht gestartet – {u.grund}
                </li>
              ))}
            </ul>
          )}
          {p.helfer.length > 0 && (
            <ul className="chatliste">
              {p.helfer.map((h) => (
                <li key={h.nr}>
                  {h.nr}.{' '}
                  <a href={`/chats/${h.chatId}`} onClick={linkKlick}>
                    {h.titel}
                  </a>{' '}
                  {h.status && <span className={`lauf-chip ${h.status}`}>{laufStatusText(h.status)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
