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
  it('Weckzeiten: zufällig 3–7 Stunden später, auf die Minute, nicht zur vollen Stunde (E181)', () => {
    const ab = Date.UTC(2026, 10, 16, 12);
    expect(new Date(Aufwachen.naechsteWeckzeit(ab, 3, 7, () => 0)).toISOString()).toBe('2026-11-16T15:00:00.000Z');
    expect(new Date(Aufwachen.naechsteWeckzeit(ab, 3, 7, () => 0.999999)).toISOString()).toBe('2026-11-16T19:00:00.000Z');
    // 3 h + 0,37 × 4 h = 4 h 28,8 min → 16:29 UTC
    expect(new Date(Aufwachen.naechsteWeckzeit(ab, 3, 7, () => 0.37)).toISOString()).toBe('2026-11-16T16:29:00.000Z');
    // vertauschte Grenzen werden gedreht
    expect(Aufwachen.naechsteWeckzeit(ab, 7, 3, () => 0)).toBe(ab + 3 * 3_600_000);
    // echter Zufall: immer im Rahmen, ganze Minuten, und nicht alle gleich
    const z = Array.from({ length: 200 }, () => Aufwachen.naechsteWeckzeit(ab));
    for (const x of z) {
      expect(x).toBeGreaterThanOrEqual(ab + 3 * 3_600_000);
      expect(x).toBeLessThanOrEqual(ab + 7 * 3_600_000);
      expect(x % 60_000).toBe(0);
    }
    expect(new Set(z).size).toBeGreaterThan(50);
    expect(z.filter((x) => x % 3_600_000 !== 0).length).toBeGreaterThan(150);
  });

  it('nächstes Aufwachen übersteht einen Neustart; verpasster Termin → eine Minute nach dem Start (E181)', async () => {
    const { d } = await aufbau(kal());
    const jetzt = d.uhr.jetzt();
    const stand = (w?: string) =>
      w === undefined
        ? (d.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'aufwachen_naechste'").get() as { wert: string } | undefined)?.wert
        : d.db.prepare("INSERT INTO dorf_stand (schluessel, wert) VALUES ('aufwachen_naechste', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert").run(w);
    const neu = () => new Aufwachen({ ...(d.aufwachen as unknown as { o: ConstructorParameters<typeof Aufwachen>[0] }).o, zufall: () => 0.5 });
    const warte = async (a: Aufwachen) => {
      for (let i = 0; i < 50 && a.naechsteZeit == null; i++) await new Promise((r) => setTimeout(r, 10));
      a.stoppen();
      return a.naechsteZeit!;
    };
    // nichts gemerkt → neu ausgewürfelt (Mitte: 5 h)
    d.db.prepare("DELETE FROM dorf_stand WHERE schluessel = 'aufwachen_naechste'").run();
    const a1 = neu();
    a1.starten();
    expect(await warte(a1)).toBe(Math.round((jetzt + 5 * 3_600_000) / 60_000) * 60_000);
    expect(Number(stand())).toBe(a1.naechsteZeit);
    // gemerkter Termin in der Zukunft bleibt (Deploy verschiebt nichts)
    stand(String(jetzt + 2 * 3_600_000 + 17 * 60_000));
    const a2 = neu();
    a2.starten();
    expect(await warte(a2)).toBe(jetzt + 2 * 3_600_000 + 17 * 60_000);
    // verpasst (Server war aus) → gleich nach dem Start
    stand(String(jetzt - 3_600_000));
    const a3 = neu();
    a3.starten();
    expect(await warte(a3)).toBe(jetzt + 60_000);
    // unsinnig weit weg (z. B. alte Einstellung) → neu ausgewürfelt
    stand(String(jetzt + 30 * 3_600_000));
    const a4 = neu();
    a4.starten();
    expect(await warte(a4)).toBe(Math.round((jetzt + 5 * 3_600_000) / 60_000) * 60_000);
  });

  it('nichts los und keine eigenen Aufgaben: keine KI, kein Lauf, keine Meldung', async () => {
    const { d, texte } = await aufbau(kal());
    const r = await d.aufwachen.aufwachen();
    expect(r).toEqual({ gestartet: 0, anlaesse: 0, neu: 0, lagebericht: null, rundgang: null, budgetErreicht: false, eigeneTodos: 0, aktivitaeten: [] });
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

  it('E195: Zeitgeber und „Jetzt wecken“ gleichzeitig → EIN Aufwachen, ein Lagebericht (der zweite Aufruf wartet und bekommt denselben Bericht)', async () => {
    const { d } = await aufbau(kal(ev('a', '⏰ CDA: Übung 3 ist fällig', '20261117T225900Z')));
    const [a, b] = await Promise.all([d.aufwachen.aufwachen(), d.aufwachen.aufwachen()]);
    expect(a.lagebericht).not.toBeNull();
    expect(b).toBe(a);
    await d.agenten.leerlauf();
    expect(d.schreibtisch.liste().filter((x) => x.quelle === 'aufwachen')).toHaveLength(1);
    // danach ist die Sperre wieder frei
    expect((await d.aufwachen.aufwachen()).lagebericht).toBeNull();
    await d.app.close();
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

  it('Rundgang: nichts Neues → höchstens alle 3 Stunden Aktivitäten aus dem Katalog (über api); keine einzelne Meldung (E192)', async () => {
    const { d, texte } = await aufbau(kal(), 'eigene_aufgaben: ja');
    // Anlass für „Überfällige To-dos zerlegen“: ein To-do, das seit einer Woche fällig ist
    await d.todos.anlegen({ titel: 'Steuererklärung', faellig: '2026-11-05' }, 'Leif');
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ lagebericht: null, budgetErreicht: false, aktivitaeten: ['todos-ueberfaellig'] });
    expect(r.rundgang).not.toBeNull();
    await d.agenten.leerlauf();
    const a = d.schreibtisch.holen(r.rundgang!);
    expect(a.titel).toMatch(/^Rundgang \d\d:\d\d/);
    expect(a.pfad).toMatch(/^Rathaus\/schreibtisch\/aufwachen\//);
    const notiz = (await d.vault.lesen(a.pfad)).inhalt;
    expect(notiz).toContain('<fremdinhalt quelle="rundgang">');
    expect(notiz).toContain('<fremdinhalt quelle="rundgang-todos-ueberfaellig">');
    expect(notiz).toContain('Steuererklärung');
    expect(notiz).toContain('Höchstens EINEN Helfer');
    expect(d.agenten.chatDetail(a.chatId!).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
    expect(texte.filter((t) => t.includes('Rundgang'))).toHaveLength(0); // still

    // dieselbe Aktivität ist „täglich“ – eine und drei Stunden später kommt sie nicht wieder dran, und ohne Anlass gibt es keinen Lauf
    d.uhr.vor(3_600_000);
    expect((await d.aufwachen.aufwachen()).rundgang).toBeNull();
    d.uhr.vor(2 * 3_600_000);
    expect(await d.aufwachen.aufwachen()).toMatchObject({ rundgang: null, aktivitaeten: [] });
    // am nächsten Tag wieder
    d.uhr.vor(21 * 3_600_000);
    expect((await d.aufwachen.aufwachen()).aktivitaeten).toEqual(['todos-ueberfaellig']);
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
