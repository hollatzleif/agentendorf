import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import matter from 'gray-matter';
import type { ModellKlient } from '../src/agenten/motor-api.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { Morgenzeitung } from '../src/morgenzeitung.js';
import { testDorf } from './hilfen.js';

const kal = (...ev: string[]) => `BEGIN:VCALENDAR\r\n${ev.join('')}END:VCALENDAR\r\n`;
const ev = (uid: string, titel: string, von: string, bis: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${von}\r\nDTEND:${bis}\r\nEND:VEVENT\r\n`;

function modell(einleitung = 'Heute ist viel los: Abgabe morgen, Zahnarzt um 15 Uhr.') {
  const anfragen: Record<string, unknown>[] = [];
  const klient: ModellKlient = {
    async streamen(params) {
      anfragen.push(params as Record<string, unknown>);
      return {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: JSON.stringify({ einleitung }), citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 800, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as BetaMessage;
    },
  };
  return { klient, anfragen };
}

describe('Morgenzeitung', () => {
  it('erscheint um 06:30 Linzer Zeit – im Winter und im Sommer', () => {
    expect(new Date(Morgenzeitung.naechsterTermin(Date.UTC(2026, 10, 16, 12))).toISOString()).toBe('2026-11-17T05:30:00.000Z');
    expect(new Date(Morgenzeitung.naechsterTermin(Date.UTC(2026, 10, 16, 5))).toISOString()).toBe('2026-11-16T05:30:00.000Z');
    expect(new Date(Morgenzeitung.naechsterTermin(Date.UTC(2026, 6, 1, 3))).toISOString()).toBe('2026-07-01T04:30:00.000Z');
  });

  it('Fakten vom Code, Einleitung von der KI, Vault + Telegram; Leifs Änderungen bleiben', async () => {
    const texte: string[] = [];
    const api: TelegramSchnittstelle = {
      async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
        if (m === 'sendMessage') texte.push(String(p.text));
        return { message_id: texte.length } as T;
      },
      async dateiLaden() {
        return { name: 'x', inhalt: Buffer.from('') };
      },
    };
    const m = modell();
    // TestUhr: Mo 16.11.2026 12:00 UTC = 13:00 Linz
    const d = await testDorf({
      telegram: api,
      env: { TELEGRAM_CHAT_ID: '1' },
      ki: () => m.klient,
      google: {
        termine: { laden: async () => kal(ev('z', 'Zahnarzt', '20261116T140000Z', '20261116T150000Z'), ev('m', 'Morgen-Termin', '20261117T090000Z', '20261117T100000Z')) },
        pflicht: { laden: async () => kal(ev('p', 'Pflicht: Mathe III UE', '20261116T160000Z', '20261116T173000Z')) },
        fristen: { laden: async () => kal(ev('a', '⏰ CDA: Übung 2 ist fällig', '20261117T222900Z', '20261117T225900Z'), ev('b', '⏰ CDA: Übung 9 ist fällig', '20261130T222900Z', '20261130T225900Z')) },
      },
    });
    await d.uni.abgleichen();
    d.db.prepare("INSERT INTO post_mails (id, thread_id, von, betreff, datum, kategorie, wichtig, antwort_noetig, zusammenfassung, eingeordnet) VALUES ('x', 't', 'Prof ‹p@jku.at›', 'Prüfungstermin', ?, 'Uni', 1, 1, 'Neuer Termin für die Prüfung.', ?)").run(d.uhr.jetzt() - 3600_000, d.uhr.jetzt());
    await d.schreibtisch.anlegen({ text: 'Steuer erledigen', quelle: 'app' });

    const pfad = await d.morgenzeitung.erstellen();
    expect(pfad).toBe('Rathaus/morgenzeitung/2026-11-16.md');
    const datei = (await d.vault.lesen(pfad)).inhalt;
    const { data, content } = matter(datei);
    expect(data).toMatchObject({ datum: '2026-11-16', fremdinhalt: true });
    expect(content).toContain('# ☀️ Morgenzeitung – Montag, 16. November 2026');
    expect(content).toContain('> Heute ist viel los');
    const abschnitt = (t: string) => content.split(`## ${t}\n\n`)[1]!.split('\n\n')[0]!;
    expect(abschnitt('Heute')).toBe('- 15:00–16:00 Zahnarzt\n- 17:00–18:30 🎓 Mathe III UE (Pflicht)');
    expect(abschnitt('Fristen (7 Tage)')).toBe('- **morgen** 23:59 · Abgabe · Übung 2 ist fällig (CDA)'); // 30.11. ist weiter als 7 Tage
    expect(abschnitt('Wichtige Mails')).toBe('- Prof ‹p@jku.at›: „Prüfungstermin“ – Neuer Termin für die Prüfung. · Antwort nötig');
    expect(abschnitt('Wartet auf dich')).toMatch(/🗂️ 1 auf dem Schreibtisch: Steuer erledigen/);

    // KI: ohne Werkzeuge, Fakten nur in der Fremdinhalt-Hülle, verbucht
    expect(m.anfragen[0]!.tools).toBeUndefined();
    expect(String((m.anfragen[0]!.messages as { content: string }[])[0]!.content)).toMatch(/^<fremdinhalt quelle="morgenzeitung">/);
    expect(d.db.prepare("SELECT COUNT(*) AS n FROM chats WHERE rolle = 'system' AND titel LIKE 'Rathaus: Morgenzeitung%'").get()).toEqual({ n: 1 });

    // Telegram
    expect(texte.at(-1)).toMatch(/^☀️ <b>Morgenzeitung<\/b>\n\n<i>Heute ist viel los/);
    expect(texte.at(-1)).toContain('• <b>morgen</b> 23:59 · Abgabe · Übung 2 ist fällig (CDA)');
    expect(texte.at(-1)).toContain('reiter=morgenzeitung');

    // App
    const u = await d.morgenzeitung.uebersicht();
    expect(u.aktuell).toMatchObject({ datum: '2026-11-16', pfad });

    // Leif bearbeitet die Zeitung – ein zweiter Druck am selben Tag überschreibt sie nicht
    await d.vault.schreiben(pfad, `${datei}\nMeine Notiz.\n`);
    await d.morgenzeitung.erstellen();
    expect((await d.vault.lesen(pfad)).inhalt).toContain('Meine Notiz.');
    expect((await d.vault.konflikte()).length).toBe(1);
  });

  it('Heute: To-dos dran mit Schätzung gegen freie Zeit 8–22 Uhr minus Termine (E120)', async () => {
    const d = await testDorf({
      google: { termine: { laden: async () => kal(ev('v', 'Vorlesung', '20261116T080000Z', '20261116T120000Z')) } },
    });
    await d.todos.anlegen({ titel: 'Referat', faellig: '2026-11-16', dauer: 300 }, 'Leif');
    await d.todos.anlegen({ titel: 'Alt', faellig: '2026-11-10', dauer: 360 }, 'Leif');
    await d.todos.anlegen({ titel: 'Ohne', faellig: '2026-11-16' }, 'Leif');
    await d.todos.anlegen({ titel: 'Morgen', faellig: '2026-11-17', dauer: 60 }, 'Leif');
    const h = (await d.morgenzeitung.fakten()).abschnitte.find((a) => a.titel === 'Heute')!.zeilen;
    // 14 h minus 4 h Vorlesung = 10 h frei; 11 h geschätzt → zu viel
    expect(h.at(-1)).toBe('☑️ 3 To-dos dran (≈ 11 h geschätzt, 1 ohne Schätzung) · frei 8–22 Uhr ≈ 10 h – mehr, als in den Tag passt: etwas verschieben?');
  });

  it('ohne API-Schlüssel und ohne Kalender: Zeitung trotzdem, nur ohne Einleitung; Telegram abschaltbar', async () => {
    const d = await testDorf();
    const pfad = await d.morgenzeitung.erstellen();
    const c = matter((await d.vault.lesen(pfad)).inhalt).content;
    expect(c).not.toContain('> ');
    expect(c).toContain('## Heute\n\n- –');
  });

  it('„Der Bürgermeister seit gestern“: was er von selbst getan hat; ruhige Rundgänge nur als Zahl, nicht unter „erledigt“', async () => {
    const d = await testDorf();
    const tat = await d.schreibtisch.anlegen({ text: 'Rundgang 03:00\n[schreibe Rathaus/aufraeumen/2026-11-16_0300_vorschlaege.md]', quelle: 'aufwachen' });
    const ruhig = await d.schreibtisch.anlegen({ text: 'Rundgang 06:00\nNichts zu tun.', quelle: 'aufwachen' });
    await d.buergermeister.starten(tat.id, 'zeitplan');
    await d.buergermeister.starten(ruhig.id, 'zeitplan');
    await d.agenten.leerlauf();
    d.uhr.vor(60_000);
    const c = matter((await d.vault.lesen(await d.morgenzeitung.erstellen())).inhalt).content;
    const abschnitt = (t: string) => (c.split(`## ${t}\n\n`)[1] ?? '').split('\n\n')[0]!;
    expect(abschnitt('Der Bürgermeister seit gestern')).toMatch(/^- Rundgang 03:00: .+\n- Dazu 1 ruhiger Rundgang ohne Anlass\.$/);
    expect(abschnitt('Seit gestern erledigt')).not.toContain('Rundgang');
  });
});
