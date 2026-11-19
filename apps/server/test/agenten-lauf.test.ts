import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { motorenSetzen } from '../src/agenten/modelle.js';
import { AgentenDienst } from '../src/agenten/dienst.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';

async function dorfMitAktion(kopf = '') {
  const d = await testDorf();
  fs.writeFileSync(
    path.join(d.vault.wurzel, 'Uni/aktionen/test.md'),
    `---\nname: Test\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: auftrag\n    typ: langtext\n${kopf}---\n{auftrag}`,
  );
  return d;
}

describe('Läufe, Chats, Protokolle', () => {
  it('Aktion starten → Chat, Spiegel, Protokoll mit Fakten aus dem Log, Verbrauch', async () => {
    const d = await dorfMitAktion();
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'Schreib eine Notiz [schreibe Uni/2026-11-16_1200_notiz.md] [schreibe Post/2026-11-16_1200_boese.md]' });
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe).toHaveLength(1);
    expect(c.laeufe[0]).toMatchObject({ status: 'fertig', motor: 'claude-code', modell: 'claude-sonnet-5-5', einToken: 1000, ausToken: 200 });
    expect(c.laeufe[0]!.kostenUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6);
    expect(c.nachrichten.map((n) => n.rolle)).toEqual(['nutzer', 'werkzeug', 'werkzeug', 'agent']);
    expect(await d.vault.existiert('Uni/2026-11-16_1200_notiz.md')).toBe(true);
    expect(await d.vault.existiert('Post/2026-11-16_1200_boese.md')).toBe(false);

    const protokoll = (await d.vault.lesen(c.protokollPfad!)).inhalt;
    expect(c.protokollPfad).toMatch(/^Uni\/protokolle\/\d{4}-\d{2}-\d{2}_\d{4}_test-schreib-eine-notiz/);
    expect(protokoll).toContain('## Lauf 1');
    expect(protokoll).toContain('claude-code / claude-sonnet-5-5');
    expect(protokoll).toContain('**Geschrieben:** [[Uni/2026-11-16_1200_notiz]]');
    expect(protokoll).toMatch(/Von der Leine verweigert:\*\* vault_schreiben Post\/2026-11-16_1200_boese\.md/);
    expect(protokoll).toContain('### Offen\nNichts.');
    const spiegel = (await d.vault.lesen(c.spiegelPfad!)).inhalt;
    expect(spiegel).toContain('### 🧑 Leif');
    expect(spiegel).toContain('### 🤖 Agent');
  });

  it('Fortsetzen hängt an Protokoll an; api-Motor bekommt den unveränderten Verlauf', async () => {
    const d = await dorfMitAktion();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/api.md'), '---\nname: Api\nmotor: api\n---\nHallo');
    const { chatId } = await d.agenten.aktionStarten('Uni/api', {});
    await d.agenten.leerlauf();
    d.agenten.nachrichtSenden(chatId, 'Und weiter?');
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe.map((l) => l.nummer)).toEqual([1, 2]);
    expect(c.nachrichten.at(-1)!.text).toContain('Verlauf: 2'); // Nutzer + Agent aus Lauf 1
    const p = (await d.vault.lesen(c.protokollPfad!)).inhalt;
    expect(p).toContain('## Lauf 1');
    expect(p).toContain('## Lauf 2');
    expect(p.match(/^# Protokoll/gm)).toHaveLength(1);
  });

  it('Obergrenze je Motor wird eingehalten, Abbrechen wirkt, Fehler blockieren andere nicht', async () => {
    const d = await dorfMitAktion();
    await motorenSetzen(d.vault, { alleAuf: 'keiner', parallel: { 'claude-code': 1, api: 4 } });
    const a = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 400]' });
    const b = await d.agenten.aktionStarten('Uni/test', { auftrag: '[fehler]' });
    const c = await d.agenten.aktionStarten('Uni/test', { auftrag: 'normal' });
    let maxGleichzeitig = 0;
    const t = setInterval(() => {
      maxGleichzeitig = Math.max(maxGleichzeitig, d.agenten.aktiveLaeufe().filter((l) => l.status === 'laeuft').length);
    }, 5);
    await new Promise((r) => setTimeout(r, 50));
    d.agenten.abbrechen(a.laufId);
    await d.agenten.leerlauf();
    clearInterval(t);
    expect(maxGleichzeitig).toBe(1);
    expect(d.agenten.chatDetail(a.chatId).laeufe[0]!.status).toBe('abgebrochen');
    expect(d.agenten.chatDetail(b.chatId).laeufe[0]).toMatchObject({ status: 'fehler', fehler: 'Attrappe: absichtlicher Fehler' });
    expect(d.agenten.chatDetail(c.chatId).laeufe[0]!.status).toBe('fertig');
    expect(() => d.agenten.abbrechen(c.laufId)).toThrow(/schon beendet/);
  });

  it('Notschalter alle_auf und Zeitplan-Läufe nutzen die API', async () => {
    const d = await dorfMitAktion();
    const z = await d.agenten.aktionStarten('Uni/test', { auftrag: 'nachts' }, 'zeitplan');
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(z.chatId).laeufe[0]!.motor).toBe('api');
    await motorenSetzen(d.vault, { alleAuf: 'api', parallel: { 'claude-code': 2, api: 4 } });
    const k = await d.agenten.aktionStarten('Uni/test', { auftrag: 'per Klick' });
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(k.chatId).laeufe[0]!.motor).toBe('api');
  });

  it('freigabe_vor_start: Lauf wartet, bis Leif zustimmt', async () => {
    const d = await dorfMitAktion('freigabe_vor_start: ja\n');
    const { chatId, laufId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'teuer' });
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[0]!.status).toBe('wartet_freigabe');
    const [f] = d.agenten.freigaben.liste('offen');
    expect(f).toMatchObject({ art: 'lauf_starten', inhalt: { laufId } });
    await d.agenten.freigaben.entscheiden(f!.id, true);
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[0]!.status).toBe('fertig');
  });

  it('E185 Warteschlange: Nachrichten während eines Laufs warten und kommen danach gesammelt als EIN Lauf dran; Löschen geht, solange sie warten', async () => {
    const d = await dorfMitAktion();
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 250]' });
    expect(d.agenten.nachrichtSenden(chatId, 'noch was')).toEqual({ wartend: 1 });
    expect(d.agenten.nachrichtSenden(chatId, 'das hier doch nicht')).toEqual({ wartend: 2 });
    expect(d.agenten.nachrichtSenden(chatId, 'und der Betreff soll kürzer sein')).toEqual({ wartend: 3 });
    const wartend = d.agenten.chatDetail(chatId).wartend;
    expect(wartend.map((w) => w.text)).toEqual(['noch was', 'das hier doch nicht', 'und der Betreff soll kürzer sein']);
    // noch kein zweiter Lauf, nichts im Verlauf
    expect(d.agenten.chatDetail(chatId).laeufe).toHaveLength(1);
    d.agenten.wartendeLoeschen(chatId, wartend[1]!.id);
    expect(() => d.agenten.wartendeLoeschen(chatId, wartend[1]!.id)).toThrow(/wartet nicht mehr/);
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.wartend).toEqual([]);
    expect(c.laeufe.map((l) => l.status)).toEqual(['fertig', 'fertig']);
    expect(c.laeufe[1]).toMatchObject({ ausloeser: 'klick', auftrag: 'Nachricht 1:\nnoch was\n\n---\n\nNachricht 2:\nund der Betreff soll kürzer sein' });
    // ist der Chat frei, startet eine Nachricht wie bisher sofort einen Lauf
    expect(d.agenten.nachrichtSenden(chatId, 'danke')).toEqual({ laufId: expect.any(String) });
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[2]!.auftrag).toBe('danke');
    expect(() => d.agenten.nachrichtSenden(chatId, '   ')).toThrow(/leer/);
  });

  it('E185 Warteschlange: auch nach Abbruch und Fehler geht nichts verloren; Nachschub in den laufenden Lauf, wenn der Motor es kann', async () => {
    const d = await dorfMitAktion();
    // Abbruch: Leif bricht ab, um zu korrigieren – die Korrektur läuft danach
    const a = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 5000]' });
    await new Promise((r) => setTimeout(r, 30));
    d.agenten.nachrichtSenden(a.chatId, 'anders: bitte an Frau Leemhuis');
    d.agenten.abbrechen(a.laufId);
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(a.chatId).laeufe.map((l) => [l.status, l.auftrag.slice(0, 30)])).toEqual([
      ['abgebrochen', '[warte 5000]'],
      ['fertig', 'anders: bitte an Frau Leemhuis'],
    ]);
    // Fehler im Lauf
    const f = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 100] [fehler]' });
    d.agenten.nachrichtSenden(f.chatId, 'trotzdem weiter');
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(f.chatId).laeufe.map((l) => l.status)).toEqual(['fehler', 'fertig']);
    // Nachschub: der Motor holt Wartendes zwischen den Schritten – dann gibt es KEINEN zweiten Lauf
    const n = await d.agenten.aktionStarten('Uni/test', { auftrag: '[pause 200] [nachschub]' });
    await new Promise((r) => setTimeout(r, 30));
    expect(d.agenten.nachrichtSenden(n.chatId, 'ach ja: mit Anhang')).toEqual({ wartend: 1 });
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(n.chatId);
    expect(c.laeufe).toHaveLength(1);
    expect(c.wartend).toEqual([]);
    expect(c.nachrichten.filter((x) => x.rolle === 'nutzer').map((x) => x.text)).toEqual(['[pause 200] [nachschub]', 'ach ja: mit Anhang']);
  });

  it('E185: Web + Fremdinhalte ist erlaubt (Leifs Entscheidung) – der Lauf bekommt Web, jeder Web-Abruf steht im werkzeug_log', async () => {
    const d = await dorfMitAktion();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/web.md'), '---\nname: Web\nwerkzeuge: [web, post]\nfremdinhalte: ja\n---\nx');
    const { chatId } = await d.agenten.aktionStarten('Uni/web', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[0]!.status).toBe('fertig');
    const werkzeuge = JSON.parse((d.db.prepare('SELECT werkzeuge_json FROM chats WHERE id = ?').get(chatId) as { werkzeuge_json: string }).werkzeuge_json) as string[];
    expect(werkzeuge).toEqual(expect.arrayContaining(['web', 'post_lesen', 'post_entwurf_neu']));
  });

  it('nach einem Neustart gelten hängende Läufe als fehlgeschlagen', async () => {
    const d = await dorfMitAktion();
    const { chatId, laufId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'x' });
    await d.agenten.leerlauf();
    d.db.prepare("UPDATE laeufe SET status = 'laeuft' WHERE id = ?").run(laufId);
    new AgentenDienst(d.db, d.uhr, d.vault, d.suche, d.hub, { api: attrappe('api'), 'claude-code': attrappe('claude-code') });
    expect(d.agenten.chatDetail(chatId).laeufe[0]).toMatchObject({ status: 'fehler', fehler: expect.stringMatching(/neu gestartet/) });
  });

  it('Verbrauch nach Tag/Woche/Monat und Motor', async () => {
    const d = await dorfMitAktion();
    await d.agenten.aktionStarten('Uni/test', { auftrag: 'a' });
    await d.agenten.aktionStarten('Uni/test', { auftrag: 'b' }, 'zeitplan');
    await d.agenten.leerlauf();
    const r = await d.app.inject({ url: '/api/verbrauch', headers: { cookie: 'x' } });
    expect(r.statusCode).toBe(401);
    const { verbrauchAuswerten } = await import('../src/agenten/verbrauch.js');
    const v = verbrauchAuswerten(d.db, d.uhr.jetzt());
    expect(v.tage.map((z) => [z.motor, z.laeufe, z.einToken])).toEqual([
      ['api', 1, 1000],
      ['claude-code', 1, 1000],
    ]);
    expect(v.monate).toHaveLength(2);
  });
});
