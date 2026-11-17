import { describe, expect, it } from 'vitest';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { Aufwachen } from '../src/aufwachen.js';
import { testDorf } from './hilfen.js';

const kal = (...ev: string[]) => `BEGIN:VCALENDAR\r\n${ev.join('')}END:VCALENDAR\r\n`;
const ev = (uid: string, titel: string, ende: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${ende}\r\nDTEND:${ende}\r\nEND:VEVENT\r\n`;

async function aufbau(fristen: string) {
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
  let text = fristen;
  const d = await testDorf({ telegram: api, env: { TELEGRAM_CHAT_ID: '1' }, google: { fristen: { laden: async () => text } } });
  await d.uni.abgleichen();
  return { d, texte, setzen: (t: string) => (text = t) };
}

describe('Aufwachen des Bürgermeisters', () => {
  it('Weckzeiten alle 2 Stunden von 7 bis 21 Uhr Linzer Zeit', () => {
    // 16.11.2026 12:00 UTC = 13:00 Linz → nächste 15:00 Linz = 14:00 UTC
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 10, 16, 12))).toISOString()).toBe('2026-11-16T14:00:00.000Z');
    // 21:30 Linz → morgen 07:00 Linz
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 10, 16, 20, 30))).toISOString()).toBe('2026-11-17T06:00:00.000Z');
    // Sommerzeit: 06:00 UTC = 08:00 Linz → 09:00 Linz = 07:00 UTC
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 6, 1, 6))).toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });

  it('nichts los: keine KI, kein Lauf, keine Meldung', async () => {
    const { d, texte } = await aufbau(kal());
    const r = await d.aufwachen.aufwachen();
    expect(r).toEqual({ gestartet: 0, anlaesse: 0, neu: 0, lagebericht: null });
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM laeufe').get()).toEqual({ n: 0 });
    expect(texte).toHaveLength(0);
  });

  it('neue Schreibtisch-Aufgabe aus Obsidian wird angegangen – über api, nicht über das Abo', async () => {
    const { d } = await aufbau(kal());
    const a = await d.schreibtisch.anlegen({ text: 'Notiz aus Obsidian: Frage zur Bibliothek', quelle: 'app' });
    const r = await d.aufwachen.aufwachen();
    expect(r.gestartet).toBe(1);
    await d.agenten.leerlauf();
    const chatId = d.schreibtisch.holen(a.id).chatId!;
    expect(d.agenten.chatDetail(chatId).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan', status: 'fertig' });
  });

  it('Frist ohne Haken → Lagebericht (einmal pro Tag), Bürgermeister über api; ohne Tat keine Telegram-Meldung', async () => {
    const { d, texte } = await aufbau(kal(ev('a', '⏰ CDA: Übung 3 ist fällig', '20261117T225900Z')));
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ anlaesse: 1, neu: 1 });
    expect(r.lagebericht).not.toBeNull();
    await d.agenten.leerlauf();
    const aufgabe = d.schreibtisch.holen(r.lagebericht!);
    expect(aufgabe).toMatchObject({ quelle: 'aufwachen' });
    const notiz = (await d.vault.lesen(aufgabe.pfad)).inhalt;
    expect(notiz).toContain('<fremdinhalt quelle="lagebericht">');
    expect(notiz).toContain('[NEU] Abgabe „Übung 3 ist fällig“ (CDA)');
    const lauf = d.agenten.chatDetail(aufgabe.chatId!).laeufe[0]!;
    expect(lauf).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
    expect(texte.filter((t) => t.includes('Fertig'))).toHaveLength(0); // nichts getan → keine Meldung

    // Gleicher Anlass zwei Stunden später: keine neue KI-Runde
    d.uhr.vor(2 * 3_600_000);
    expect(await d.aufwachen.aufwachen()).toMatchObject({ anlaesse: 1, neu: 0, lagebericht: null });
    // Am nächsten Tag schaut er noch einmal drauf
    d.uhr.vor(20 * 3_600_000);
    expect((await d.aufwachen.aufwachen()).neu).toBe(1);
    await d.agenten.leerlauf();
    // Abgehakt → kein Anlass mehr
    d.uni.erledigtSetzen(d.uni.fristen()[0]!.id, true);
    d.uhr.vor(24 * 3_600_000);
    expect((await d.aufwachen.aufwachen()).anlaesse).toBe(0);
  });

  it('startet er beim Aufwachen einen Helfer, läuft der auch über api – und dann kommt eine Meldung', async () => {
    // Die Attrappe führt [helfer …] aus, das hier im (fremden!) Titel steht – der echte Bürgermeister würde das nicht tun;
    // hier geht es nur darum, dass ein Helfer aus einem automatischen Lauf über api läuft.
    const { d, texte } = await aufbau(kal(ev('a', '⏰ CDA: Blatt [helfer Bibliothek] ist fällig', '20261117T225900Z')));
    const r = await d.aufwachen.aufwachen();
    await d.agenten.leerlauf();
    const buergermeisterChat = d.schreibtisch.holen(r.lagebericht!).chatId!;
    const helfer = d.db.prepare('SELECT id FROM chats WHERE eltern_chat_id = ?').get(buergermeisterChat) as { id: string };
    expect(d.agenten.chatDetail(helfer.id).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
    expect(texte.some((t) => t.includes('Bürgermeister: Aufwachen'))).toBe(true);
  });
});
