import { useState } from 'react';
import { linkKlick } from '../router';
import { WochenrueckblickAnsicht } from '../komponenten/WochenrueckblickAnsicht';
import { WochenzieleKarte } from '../komponenten/WochenzieleKarte';
import { WochenPlan } from '../komponenten/WochenPlan';
import { GewohnheitenKarte } from '../komponenten/GewohnheitenKarte';
import { Projekte } from '../komponenten/Projekte';

/**
 * E129: Wochenplanung (/planen) – das 10-Minuten-Ritual am Sonntag (oder Montag früh) auf einer Seite:
 * 1. zurückschauen, 2. drei Ziele, 3. To-dos auf die Tage verteilen, 4. Gewohnheiten prüfen.
 * Die Schritte sind die bekannten Bausteine; abgehakte Schritte merkt sich das Gerät je Woche.
 */
const SCHRITTE = [
  ['rueckblick', '1 · Zurückschauen', 'Was lief gut, was blieb liegen? Ein Blick genügt.'],
  ['ziele', '2 · Drei Ziele', 'Welche 3 Dinge sollen diese Woche fertig werden? Weniger ist mehr.'],
  ['verteilen', '3 · Woche verteilen', 'To-dos aus dem Eingang auf die Tage – „✨ Woche verteilen“ macht einen Vorschlag.'],
  ['gewohnheiten', '4 · Gewohnheiten', 'Passt der Rhythmus noch? Ein Häkchen weniger ist besser als ein Vorsatz zu viel.'],
] as const;

function wocheSchluessel() {
  // Sonntag zählt zur kommenden Woche (dann wird für sie geplant)
  const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) + 'T12:00:00Z');
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `dorf-planen-${d.toISOString().slice(0, 10)}`;
}

export function WochePlanen() {
  const schluessel = wocheSchluessel();
  const [fertig, setFertig] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(schluessel) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const haken = (k: string, an: boolean) => {
    const n = an ? [...new Set([...fertig, k])] : fertig.filter((x) => x !== k);
    setFertig(n);
    localStorage.setItem(schluessel, JSON.stringify(n));
  };
  const sonntag = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/Vienna', weekday: 'short' }) === 'Sun';
  return (
    <section className="planen" aria-label="Wochenplanung">
      <a href="/heute" onClick={linkKlick}>
        ← Heute
      </a>
      <h1>🗓️ Woche planen</h1>
      <p className="leise">
        10 Minuten, vier Schritte – {sonntag ? 'heute für die kommende Woche' : 'für diese Woche'}.{' '}
        <strong>
          {fertig.length}/{SCHRITTE.length} erledigt
        </strong>
        {fertig.length === SCHRITTE.length && ' – gute Woche! 🌸'}
      </p>
      <nav className="planen-schritte" aria-label="Schritte">
        {SCHRITTE.map(([k, titel]) => (
          <a key={k} href={`#${k}`} className={fertig.includes(k) ? 'fertig' : ''}>
            {fertig.includes(k) ? '✓ ' : ''}
            {titel}
          </a>
        ))}
      </nav>
      {SCHRITTE.map(([k, titel, text]) => (
        <section key={k} id={k} className={`planen-schritt${fertig.includes(k) ? ' fertig' : ''}`} aria-label={titel}>
          <div className="planen-kopf">
            <h2>{titel}</h2>
            <label className="planen-haken">
              <input type="checkbox" checked={fertig.includes(k)} onChange={(e) => haken(k, e.target.checked)} aria-label={`${titel} erledigt`} /> erledigt
            </label>
          </div>
          <p className="leise">{text}</p>
          {k === 'rueckblick' && <WochenrueckblickAnsicht />}
          {k === 'ziele' && <WochenzieleKarte />}
          {k === 'ziele' && (
            // E165: Ziele entstehen oft aus Projekten – was ruht, fällt hier auf
            <details className="planen-projekte">
              <summary>📁 Deine Projekte ansehen</summary>
              <Projekte />
            </details>
          )}
          {k === 'verteilen' && <WochenPlan startVersatz={sonntag ? 1 : 0} />}
          {k === 'gewohnheiten' && <GewohnheitenKarte />}
        </section>
      ))}
    </section>
  );
}
