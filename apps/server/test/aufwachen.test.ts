import { describe, expect, it } from 'vitest';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { AUFWACHEN_PFAD, Aufwachen } from '../src/aufwachen.js';
import { testDorf } from './hilfen.js';

const kal = (...ev: string[]) => `BEGIN:VCALENDAR\r\n${ev.join('')}END:VCALENDAR\r\n`;
const ev = (uid: string, titel: string, ende: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${ende}\r\nDTEND:${ende}\r\nEND:VEVENT\r\n`;

async function aufbau(fristen: string, einstellungen = 'eigene_aufgaben: nein') {
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
  const alt = await d.vault.lesen(AUFWACHEN_PFAD);
  await d.vault.schreiben(AUFWACHEN_PFAD, alt.inhalt.replace(/^eigene_aufgaben: ja$/m, einstellungen), { basisVersion: alt.version });
  await d.uni.abgleichen();
  return { d, texte, setzen: (t: string) => (text = t) };
}

describe('Aufwachen des Bürgermeisters', () => {
  it('Weckzeiten: jede volle Stunde, rund um die Uhr (Linzer Zeit)', () => {
    // 16.11.2026 12:00 UTC = 13:00 Linz → 14:00 Linz = 13:00 UTC
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 10, 16, 12))).toISOString()).toBe('2026-11-16T13:00:00.000Z');
    // 21:30 Linz → 22:00 Linz (auch nachts)
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 10, 16, 20, 30))).toISOString()).toBe('2026-11-16T21:00:00.000Z');
    // 03:20 Linz → 04:00 Linz
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 10, 17, 2, 20))).toISOString()).toBe('2026-11-17T03:00:00.000Z');
    // Sommerzeit: 06:00 UTC = 08:00 Linz → 09:00 Linz = 07:00 UTC
    expect(new Date(Aufwachen.naechsteWeckzeit(Date.UTC(2026, 6, 1, 6))).toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });

  it('nichts los und keine eigenen Aufgaben: keine KI, kein Lauf, keine Meldung', async () => {
    const { d, texte } = await aufbau(kal());
    const r = await d.aufwachen.aufwachen();
    expect(r).toEqual({ gestartet: 0, anlaesse: 0, neu: 0, lagebericht: null, rundgang: null, budgetErreicht: false });
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

  it('startet er beim Aufwachen einen Helfer, läuft der über Leifs Abo (claude-code) – und dann kommt eine Meldung', async () => {
    // Die Attrappe führt [helfer …] aus, das hier im (fremden!) Titel steht – der echte Bürgermeister würde das nicht tun;
    // hier geht es nur darum, mit welchem Motor ein Helfer aus einem automatischen Lauf läuft (E56).
    const { d, texte } = await aufbau(kal(ev('a', '⏰ CDA: Blatt [helfer Bibliothek] ist fällig', '20261117T225900Z')));
    const r = await d.aufwachen.aufwachen();
    await d.agenten.leerlauf();
    const buergermeisterChat = d.schreibtisch.holen(r.lagebericht!).chatId!;
    const helfer = d.db.prepare('SELECT id FROM chats WHERE eltern_chat_id = ?').get(buergermeisterChat) as { id: string };
    expect(d.agenten.chatDetail(helfer.id).laeufe[0]).toMatchObject({ motor: 'claude-code', ausloeser: 'buergermeister' });
    expect(texte.some((t) => t.includes('Bürgermeister: Aufwachen'))).toBe(true);
  });

  it('Rundgang: nichts Neues → höchstens alle 3 Stunden selbst umschauen (über api); ohne Tat keine Meldung', async () => {
    const { d, texte } = await aufbau(kal(), 'eigene_aufgaben: ja');
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ lagebericht: null, budgetErreicht: false });
    expect(r.rundgang).not.toBeNull();
    await d.agenten.leerlauf();
    const a = d.schreibtisch.holen(r.rundgang!);
    expect(a.titel).toMatch(/^Rundgang \d\d:\d\d/);
    const notiz = (await d.vault.lesen(a.pfad)).inhalt;
    expect(notiz).toContain('<fremdinhalt quelle="rundgang">');
    expect(notiz).toContain('höchstens EINEN Helfer');
    expect(d.agenten.chatDetail(a.chatId!).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
    expect(texte.filter((t) => t.includes('Rundgang'))).toHaveLength(0); // nichts getan → still

    d.uhr.vor(3_600_000);
    expect((await d.aufwachen.aufwachen()).rundgang).toBeNull(); // eine Stunde später: noch nicht wieder
    d.uhr.vor(2 * 3_600_000);
    expect((await d.aufwachen.aufwachen()).rundgang).not.toBeNull(); // nach drei Stunden: wieder
    await d.agenten.leerlauf();
  });

  it('Tagesbudget: ist es aufgebraucht, wacht er bis Mitternacht nur ohne KI auf', async () => {
    const { d } = await aufbau(kal(ev('a', '⏰ CDA: Übung 4 ist fällig', '20261117T225900Z')), 'eigene_aufgaben: ja');
    const jetzt = d.uhr.jetzt();
    d.db
      .prepare("INSERT INTO chats (id, gebaeude, titel, motor, stufe, modell, erstellt, geaendert, rolle) VALUES ('sys', 'Post', 'Post: Einordnung', 'api', 'klein', 'm', ?, ?, 'system')")
      .run(jetzt, jetzt);
    d.db
      .prepare(
        `INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, kosten_usd)
         VALUES ('teuer', 'sys', 1, 'api', 'm', 'klein', 'low', 'fertig', 'zeitplan', 'x', ?, 5.2)`,
      )
      .run(jetzt - 3_600_000);
    expect(d.aufwachen.verbrauchHeute()).toBeCloseTo(5.2);
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ budgetErreicht: true, lagebericht: null, rundgang: null, anlaesse: 1 });
    expect((d.db.prepare('SELECT COUNT(*) AS n FROM laeufe').get() as { n: number }).n).toBe(1);
    // Neuer Tag (Linzer Mitternacht) → neues Budget
    d.uhr.vor(24 * 3_600_000);
    expect(d.aufwachen.verbrauchHeute()).toBe(0);
    expect((await d.aufwachen.aufwachen()).budgetErreicht).toBe(false);
    await d.agenten.leerlauf();
  });
});
