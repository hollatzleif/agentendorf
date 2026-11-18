import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';

describe('Kursalarm (E117)', () => {
  it('meldet einmal beim Unterschreiten, erst nach Erholung wieder; eigene Felder in depot.md bleiben', async () => {
    const kurse: Record<string, { datum: string; kurs: number }[]> = { 'VWCE.XETRA': [{ datum: '2026-11-13', kurs: 95 }] };
    const klient = { eod: async (s: string) => kurse[s] ?? [], suche: async () => null };
    const d = await testDorf({ boerse: klient, boerseFx: async () => ({ datum: '2026-11-13', kurs: 1.1 }) });
    await d.vault.schreiben('Boerse/depot.md', '---\nwatchlist:\n  - name: All-World\n    symbol: VWCE.XETRA\n    alarm_unter: 100\n    alarm_ueber: 140\n    notiz: langfristig\n---\n');
    const meldungen: string[] = [];
    d.boerse.beiAlarm.push((t) => meldungen.push(t));
    await d.boerse.aktualisieren();
    expect(meldungen).toEqual(['📉 All-World: 95 EUR – unter deiner Grenze 100 (Schlusskurs 2026-11-13)']);
    // nächster Tag, immer noch darunter → keine zweite Meldung
    d.uhr.vor(86_400_000);
    kurse['VWCE.XETRA'] = [{ datum: '2026-11-16', kurs: 94 }];
    await d.boerse.aktualisieren();
    expect(meldungen).toHaveLength(1);
    // erholt, dann wieder darunter → neue Meldung
    d.uhr.vor(86_400_000);
    kurse['VWCE.XETRA'] = [{ datum: '2026-11-17', kurs: 105 }];
    await d.boerse.aktualisieren();
    d.uhr.vor(86_400_000);
    kurse['VWCE.XETRA'] = [{ datum: '2026-11-18', kurs: 99 }];
    await d.boerse.aktualisieren();
    expect(meldungen).toHaveLength(2);
    // App ändert die Watchlist → eigenes Feld „notiz“ bleibt
    await d.boerse.wertAendern('watchlist', { neu: { name: 'Apple', symbol: 'AAPL.US' } });
    expect((await d.vault.lesen('Boerse/depot.md')).inhalt).toContain('notiz: langfristig');
  });
});
