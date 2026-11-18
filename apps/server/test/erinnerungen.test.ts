import { describe, expect, it } from 'vitest';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { einstellungenLaden, einstellungenSetzen } from '../src/telegram/einstellungen.js';
import { testDorf } from './hilfen.js';

const STUNDE = 3_600_000;
const ics = (termine: [string, string, number][]) =>
  `BEGIN:VCALENDAR\r\n${termine
    .map(([uid, titel, ms]) => {
      const z = new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      return `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nCATEGORIES:CDA\r\nDTSTART:${z}\r\nEND:VEVENT\r\n`;
    })
    .join('')}END:VCALENDAR\r\n`;

async function aufbau(weg: 'kalender' | 'google' = 'kalender') {
  const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
  const api: TelegramSchnittstelle = {
    async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
      aufrufe.push({ m, p });
      return { message_id: aufrufe.length } as T;
    },
    async dateiLaden() {
      return { name: 'x', inhalt: Buffer.from('') };
    },
  };
  let text = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  const quelle = { laden: async () => text };
  const d = await testDorf({ telegram: api, ...(weg === 'google' ? { google: { fristen: quelle } } : { kalender: quelle }), env: { TELEGRAM_CHAT_ID: '1' } });
  // Meldungen über neue Fristen ausschalten – hier geht es nur um Erinnerungen
  await einstellungenSetzen(d.vault, { ...(await einstellungenLaden(d.vault)), moodle: false });
  const bot = d.telegram!;
  const gesendet = () => aufrufe.filter((a) => a.m === 'sendMessage');
  const t0 = d.uhr.jetzt();
  let u = 1;
  const knopf = (data: string, von = 1) =>
    bot.verarbeiten({ update_id: u++, callback_query: { id: `k${u}`, data, from: { id: von }, message: { message_id: 7, chat: { id: von }, text: 'Abgabe …\nZur Uni' } } });
  return { d, bot, aufrufe, gesendet, t0, knopf, setzen: (t: string) => (text = t) };
}

describe('Erinnerungen an Fristen (Telegram)', () => {
  it('3 Tage / 1 Tag / 3 Stunden vorher, jede Stufe einmal; abhaken per Knopf stoppt alles', async () => {
    const x = await aufbau();
    x.setzen(ics([['a', 'Übung 1 ist fällig', x.t0 + 50 * STUNDE], ['t', 'Zwischentest schließt', x.t0 + 5 * STUNDE], ['v', 'Vorlesung entfällt', x.t0 + 2 * STUNDE]]));
    await x.d.uni.abgleichen();

    expect(await x.bot.erinnerungenSenden()).toBe(2);
    const [t, a] = x.gesendet().map((g) => String(g.p.text)); // nach Frist sortiert: Test zuerst
    expect(a).toMatch(/^⏰ <b>Abgabe in 3 Tagen<\/b>\nÜbung 1 ist fällig \(CDA\)\nFrist: /);
    expect(t).toMatch(/^⏰ <b>Test in 1 Tag<\/b>\nZwischentest schließt/);
    expect(await x.bot.erinnerungenSenden()).toBe(0); // nichts doppelt

    x.d.uhr.vor(3 * STUNDE); // Test in 2 h, Abgabe in 47 h
    expect(await x.bot.erinnerungenSenden()).toBe(1);
    expect(String(x.gesendet().at(-1)!.p.text)).toMatch(/Test in wenigen Stunden/);

    // Abgabe abhaken per Knopf aus der Nachricht
    const markup = x.gesendet().find((g) => String(g.p.text).includes('Übung 1'))!.p.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    const daten = markup.inline_keyboard[0]![0]!.callback_data;
    expect(markup.inline_keyboard[0]![0]!.text).toBe('✅ Erledigt');
    expect(daten.length).toBeLessThanOrEqual(64); // Telegram-Grenze
    await x.knopf(daten);
    expect(x.d.uni.fristen().find((f) => f.titel === 'Übung 1 ist fällig')!.abgegeben).toBe(true);
    expect(x.aufrufe.find((c) => c.m === 'editMessageText')!.p.text).toBe('Abgabe …\n\n✅ Erledigt');

    x.d.uhr.vor(30 * STUNDE); // 1-Tag-Stufe der Abgabe wäre jetzt fällig – aber abgehakt
    x.d.uhr.vor(30 * STUNDE); // nach der Frist – keine Nachfrage
    const vorher = x.gesendet().length;
    expect(await x.bot.erinnerungenSenden()).toBe(0);
    expect(x.gesendet()).toHaveLength(vorher);
  });

  it('Erledigt-Knopf wirkt auch bei Fristen aus Leifs Google-Kalender (gfrist:) und bleibt nach dem Abgleich abgehakt', async () => {
    const x = await aufbau('google');
    x.setzen(ics([['g1@google.com', '⏰ CDA: Übung 5', x.t0 + 50 * STUNDE]]));
    await x.d.uni.abgleichen();
    expect(await x.bot.erinnerungenSenden()).toBe(1);
    const daten = (x.gesendet()[0]!.p.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]![0]!.callback_data;
    expect(daten).toMatch(/^e:gfrist:/);
    expect(daten.length).toBeLessThanOrEqual(64);
    await x.knopf(daten);
    expect(x.aufrufe.filter((c) => c.m === 'answerCallbackQuery').map((c) => c.p.text)).toEqual(['Abgehakt.']);
    await x.d.uni.abgleichen(); // das Skript hat den Titel (noch) nicht mit ✅ markiert
    expect(x.d.uni.fristen().find((f) => f.titel === 'Übung 5')!.abgegeben).toBe(true);
  });

  it('gefälschte oder fremde Knöpfe wirken nicht', async () => {
    const x = await aufbau();
    x.setzen(ics([['a', 'Übung 1 ist fällig', x.t0 + 50 * STUNDE]]));
    await x.d.uni.abgleichen();
    await x.bot.erinnerungenSenden();
    const daten = (x.gesendet()[0]!.p.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]![0]!.callback_data;
    const [, art, hashTeil, sig] = daten.split(':');
    await x.knopf(`e:${art}:${hashTeil}:${'A'.repeat(16)}`); // falsche Signatur
    await x.knopf(`e:${art}:${'0'.repeat(32)}:${sig}`); // Signatur einer anderen Frist
    await x.knopf(daten, 999); // fremder Chat
    expect(x.d.uni.fristen()[0]!.abgegeben).toBe(false);
    const antworten = x.aufrufe.filter((c) => c.m === 'answerCallbackQuery').map((c) => c.p.text);
    expect(antworten).toEqual(['Ungültiger Knopf.', 'Ungültiger Knopf.', 'Nicht erlaubt.']);
  });

  it('Nachholen: nur die dringendste Stufe; danach Nachfrage „erledigt?“; verschobene Frist erinnert neu; abschaltbar', async () => {
    const x = await aufbau();
    x.setzen(ics([['a', 'Blatt 4 ist fällig', x.t0 + 2 * STUNDE]]));
    await x.d.uni.abgleichen();
    expect(await x.bot.erinnerungenSenden()).toBe(1); // nicht 3 Nachrichten (3t, 1t, 3h)
    expect(String(x.gesendet()[0]!.p.text)).toMatch(/Abgabe in wenigen Stunden/);

    x.d.uhr.vor(2 * STUNDE + 30 * 60_000); // 30 min nach der Frist: noch keine Nachfrage
    expect(await x.bot.erinnerungenSenden()).toBe(0);
    x.d.uhr.vor(60 * 60_000);
    expect(await x.bot.erinnerungenSenden()).toBe(1);
    expect(String(x.gesendet().at(-1)!.p.text)).toMatch(/^❓ <b>Frist vorbei – erledigt\?<\/b>\nBlatt 4 ist fällig/);
    expect(await x.bot.erinnerungenSenden()).toBe(0);

    // Frist wird verschoben → neue Erinnerung
    x.setzen(ics([['a', 'Blatt 4 ist fällig', x.d.uhr.jetzt() + 20 * STUNDE]]));
    await x.d.uni.abgleichen();
    expect(await x.bot.erinnerungenSenden()).toBe(1);
    expect(String(x.gesendet().at(-1)!.p.text)).toMatch(/Abgabe in 1 Tag/);

    // abschaltbar
    await einstellungenSetzen(x.d.vault, { ...(await einstellungenLaden(x.d.vault)), erinnerungen: false });
    x.d.uhr.vor(18 * STUNDE);
    expect(await x.bot.erinnerungenSenden()).toBe(0);
  });
});

describe('/fristen in Telegram', () => {
  it('listet offene Abgaben/Prüfungen der nächsten 7 Tage mit Erledigt-Knöpfen; abgehakt verschwindet', async () => {
    const x = await aufbau();
    x.setzen(ics([['a', 'Übung 1 ist fällig', x.t0 + 50 * STUNDE], ['t', 'Zwischentest schließt', x.t0 + 5 * STUNDE], ['f', 'Übung 9 ist fällig', x.t0 + 20 * 24 * STUNDE]]));
    await x.d.uni.abgleichen();
    let u = 100;
    const befehl = (text: string) => x.bot.verarbeiten({ update_id: u++, message: { message_id: u, chat: { id: 1 }, from: { id: 1 }, text } });
    await befehl('/fristen');
    const m = x.gesendet().at(-1)!;
    expect(String(m.p.text)).toMatch(/^⏰ <b>Fristen \(7 Tage\)<\/b>\n• <b>.+<\/b> · (Prüfung|Abgabe) · /);
    expect(String(m.p.text)).not.toContain('Übung 9'); // erst in 20 Tagen
    const knoepfe = (m.p.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.map((r) => r[0]!);
    expect(knoepfe).toHaveLength(2);
    expect(knoepfe.every((k) => k.callback_data.length <= 64)).toBe(true);
    await x.knopf(knoepfe.find((k) => k.text.includes('Übung 1'))!.callback_data);
    await befehl('/fristen');
    expect(String(x.gesendet().at(-1)!.p.text)).not.toContain('Übung 1');
    // alles erledigt
    await x.knopf(knoepfe.find((k) => !k.text.includes('Übung 1'))!.callback_data);
    await befehl('/fristen');
    expect(String(x.gesendet().at(-1)!.p.text)).toMatch(/Keine offenen Abgaben/);
  });
});

describe('/heute in Telegram', () => {
  it('Tagesüberblick: Termine heute, Fristen, was wartet – ohne die Morgenzeitung zu speichern', async () => {
    const x = await aufbau();
    x.setzen(ics([['t', 'Zwischentest schließt', x.t0 + 5 * STUNDE], ['a', 'Übung 1 ist fällig', x.t0 + 50 * STUNDE]]));
    await x.d.uni.abgleichen();
    await x.bot.verarbeiten({ update_id: 500, message: { message_id: 500, chat: { id: 1 }, from: { id: 1 }, text: '/heute' } });
    const t = String(x.gesendet().at(-1)!.p.text);
    expect(t).toMatch(/^📅 <b>Dein Tag<\/b>\n\n<b>Heute<\/b>/);
    expect(t).toContain('<b>Fristen (7 Tage)</b>');
    expect(t).toContain('Übung 1 ist fällig');
    expect(t).toContain('<b>Wartet auf dich</b>');
    expect((await x.d.morgenzeitung.uebersicht()).aktuell).toBeNull(); // nichts gespeichert
  });
});
