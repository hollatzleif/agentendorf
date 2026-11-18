import { describe, expect, it } from 'vitest';
import { kalenderwoche } from '../src/wochenrueckblick.js';
import { testDorf } from './hilfen.js';

describe('Wochenrückblick (Nacht 18./19.11.)', () => {
  it('Kalenderwoche nach ISO (Montag zuerst, Jahreswechsel)', () => {
    expect(kalenderwoche('2026-11-16')).toBe('2026-KW47');
    expect(kalenderwoche('2026-11-22')).toBe('2026-KW47'); // Sonntag gehört zur selben Woche
    expect(kalenderwoche('2026-11-23')).toBe('2026-KW48');
    expect(kalenderwoche('2027-01-01')).toBe('2026-KW53');
    expect(kalenderwoche('2027-01-04')).toBe('2027-KW01');
  });

  it('Fakten: erledigt/offen/überfällig, Fokus je Fach, nächste Woche; Datei im Rathaus und Telegram', async () => {
    const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
    const api = {
      async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
        aufrufe.push({ m, p });
        return { message_id: aufrufe.length } as T;
      },
      async dateiLaden() {
        return { name: 'x', inhalt: Buffer.from('') };
      },
    };
    const kal = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1', 'SUMMARY:⏰ Mathe III: Blatt 6 ist fällig', 'DTSTART:20261119T222900Z', 'DTEND:20261119T225900Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const d = await testDorf({ telegram: api, google: { fristen: { laden: async () => kal } }, env: { TELEGRAM_CHAT_ID: '1' } });
    await d.uni.abgleichen();
    const a = await d.todos.anlegen({ titel: 'Folien lesen' }, 'Leif');
    await d.todos.aendern(a.pfad, { erledigt: true });
    await d.todos.anlegen({ titel: 'Steuer machen', faellig: '2026-11-10' }, 'Leif');
    d.kirchturm.ausfuehren({ befehl: 'pomodoro_fuer', titel: 'Blatt 6', gruppe: 'Mathe III' });
    d.uhr.vor(25 * 60_000);
    d.kirchturm.pruefen();
    const pfad = await d.wochenrueckblick.erstellen();
    expect(pfad).toBe('Rathaus/wochenrueckblick/2026-KW47.md');
    const text = (await d.vault.lesen(pfad)).inhalt;
    expect(text).toMatch(/# 🗓️ Wochenrückblick 2026 · KW 47/);
    expect(text).toMatch(/\*\*1\*\* To-do erledigt: Folien lesen/);
    expect(text).toMatch(/davon \*\*1 überfällig\*\*: Steuer machen/);
    expect(text).toMatch(/\*\*25 min\*\* Fokus in 7 Tagen/);
    expect(text).toMatch(/Fächer\/Themen: Mathe III 25 min/);
    expect(text).toMatch(/## Nächste Woche[\s\S]*⏰ .*Mathe III – Blatt 6 ist fällig/);
    expect(text).toMatch(/fremdinhalt: true/);
    expect(await d.wochenrueckblick.aktuell()).toMatchObject({ woche: '2026-KW47' });
    const msg = aufrufe.filter((x) => x.m === 'sendMessage').map((x) => String(x.p.text)).find((t) => t.includes('Wochenrückblick'));
    expect(msg).toMatch(/🗓️ <b>Wochenrückblick<\/b> \(2026 · KW 47\)/);
    expect(msg).toMatch(/reiter=woche/);
  });
});
