import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { istNacht } from '../src/aufwachen.js';
import { testDorf } from './hilfen.js';

const STUNDE = 3_600_000;
const ics = (termine: [string, string, number][]) =>
  `BEGIN:VCALENDAR\r\n${termine
    .map(([uid, titel, ms]) => {
      const z = new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      return `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nCATEGORIES:CDA\r\nDTSTART:${z}\r\nEND:VEVENT\r\n`;
    })
    .join('')}END:VCALENDAR\r\n`;

describe('Telegram: Nachtruhe 22–7 Uhr (Linz)', () => {
  it('istNacht nach Linzer Uhr, auch in der Sommerzeit', () => {
    expect(istNacht(Date.UTC(2026, 10, 16, 21, 30))).toBe(true); // 22:30 Linz
    expect(istNacht(Date.UTC(2026, 10, 16, 5, 59))).toBe(true); // 06:59 Linz
    expect(istNacht(Date.UTC(2026, 10, 16, 6, 0))).toBe(false); // 07:00 Linz
    expect(istNacht(Date.UTC(2026, 6, 1, 4, 30))).toBe(true); // 06:30 Linz (Sommer)
    expect(istNacht(Date.UTC(2026, 6, 1, 5, 0))).toBe(false); // 07:00 Linz (Sommer)
  });

  it('nachts: Meldungen und Freigaben werden gesammelt, nur Dringendes kommt sofort; um 7 Uhr alles in einer Nachricht', async () => {
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
    const d = await testDorf({ telegram: api, google: { fristen: { laden: async () => text } }, env: { TELEGRAM_CHAT_ID: '1' } });
    const gesendet = () => aufrufe.filter((a) => a.m === 'sendMessage').map((a) => String(a.p.text));
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}');
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Uni/aktionen/frage.md'),
      '---\nname: Frage\nmotor: claude-code\nstufe: klein\nfreigabe_vor_start: ja\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}',
    );
    // 23:00 Linz
    d.uhr.vor(10 * STUNDE);
    const t0 = d.uhr.jetzt();
    text = ics([['bald', 'Blatt 7 ist fällig', t0 + 2 * STUNDE], ['spaeter', 'Blatt 8 ist fällig', t0 + 60 * STUNDE]]);
    await d.uni.abgleichen();

    await d.agenten.aktionStarten('Uni/test', { auftrag: 'Zusammenfassung schreiben' });
    await d.agenten.aktionStarten('Uni/frage', { auftrag: 'Darf ich?' });
    await d.agenten.leerlauf();
    expect(await d.telegram!.erinnerungenSenden()).toBe(1); // nur die in wenigen Stunden
    const nachts = gesendet();
    expect(nachts).toHaveLength(1);
    expect(nachts[0]).toMatch(/wenigen Stunden/);
    expect(await d.telegram!.nachtNachholen()).toBe(0); // noch Nacht → nichts

    // 07:10 Linz
    d.uhr.vor(8 * STUNDE + 10 * 60_000);
    expect(await d.telegram!.nachtNachholen()).toBe(3); // Fertig-Meldung, Moodle-Meldung, Freigabe
    const morgens = gesendet().slice(1);
    expect(morgens[0]).toMatch(/^🌙 <b>Über Nacht<\/b> \(2\)/);
    expect(morgens[0]).toContain('Neu in Moodle');
    expect(morgens[0]).toContain('Fertig');
    expect(morgens[1]).toMatch(/Freigabe/);
    const knoepfe = aufrufe.filter((a) => a.m === 'sendMessage').at(-1)!.p.reply_markup as { inline_keyboard: { text: string }[][] };
    expect(knoepfe.inline_keyboard[0]!.map((k) => k.text)).toEqual(['✅ Ja', '❌ Nein']);
    expect(await d.telegram!.nachtNachholen()).toBe(0); // nur einmal
    // tagsüber wie gewohnt: Nachfrage „erledigt?“ zu Blatt 7 (Frist war nachts) und 3-Tage-Erinnerung zu Blatt 8
    expect(await d.telegram!.erinnerungenSenden()).toBe(2);
    expect(gesendet().slice(-2).join('\n')).toMatch(/erledigt\?[\s\S]*Blatt 7|Blatt 8[\s\S]*erledigt\?/);
  });

  it('Nachtruhe abschaltbar', async () => {
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
    const d = await testDorf({ telegram: api, env: { TELEGRAM_CHAT_ID: '1' } });
    const alt = await d.vault.lesen('00_Stadtordnung/aufwachen.md');
    await d.vault.schreiben('00_Stadtordnung/aufwachen.md', alt.inhalt.replace('nachtruhe: ja', 'nachtruhe: nein'), { basisVersion: alt.version });
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}');
    d.uhr.vor(11 * STUNDE); // 00:00 Linz
    await d.agenten.aktionStarten('Uni/test', { auftrag: 'nachts' });
    await d.agenten.leerlauf();
    await new Promise((r) => setTimeout(r, 50));
    expect(texte.some((t) => t.includes('Fertig'))).toBe(true);
  });
});
