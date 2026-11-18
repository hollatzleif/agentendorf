import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModellKlient } from '../src/agenten/motor-api.js';
import { schritteLesen, schritteZuruecksetzen } from '../src/todos.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';
import { TelegramBot } from '../src/telegram/bot.js';

function modell(schritte: string[]) {
  const anfragen: Record<string, unknown>[] = [];
  const klient: ModellKlient = {
    async streamen(params) {
      anfragen.push(params as Record<string, unknown>);
      return {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: JSON.stringify({ schritte }), citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as BetaMessage;
    },
  };
  return { klient, anfragen };
}

describe('Teilschritte in To-dos (E119)', () => {
  it('Telegram-Zeile zeigt Fortschritt und den nächsten Schritt (HTML-sicher)', () => {
    expect(TelegramBot.schrittText({ schritte: [{ text: 'a', erledigt: true }, { text: '<b>', erledigt: false }] })).toBe(' <i>☑ 1/2 → &lt;b&gt;</i>');
    expect(TelegramBot.schrittText({})).toBe('');
  });

  it('lesen, zurücksetzen', () => {
    expect(schritteLesen('Text\n- [ ] eins\n- [x] zwei\n* [X] drei\nkein - [ ] Schritt')).toEqual([
      { text: 'eins', erledigt: false, zeile: 1 },
      { text: 'zwei', erledigt: true, zeile: 2 },
      { text: 'drei', erledigt: true, zeile: 3 },
    ]);
    expect(schritteZuruecksetzen('a\n- [x] eins\n- [ ] zwei')).toBe('a\n- [ ] eins\n- [ ] zwei');
  });

  it('anhängen hinter die vorhandenen, abhaken mit Text-Prüfung, entfernen; Notiz und Obsidian-Text bleiben', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Referat', notiz: 'Thema: Regression\n\nQuellen später.' } })).json();
    let r = await d.app.inject({ method: 'POST', url: '/api/todos/schritte', headers: h, payload: { pfad: t.pfad, schritte: ['Gliederung', '  Folien  bauen '] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().schritte).toEqual([{ text: 'Gliederung', erledigt: false }, { text: 'Folien bauen', erledigt: false }]);
    let datei = (await d.vault.lesen(t.pfad)).inhalt;
    expect(datei).toContain('Thema: Regression\n\nQuellen später.\n\n- [ ] Gliederung\n- [ ] Folien bauen\n');
    // in Obsidian Text unter die Schritte geschrieben → neue Schritte kommen direkt hinter den letzten
    const v = await d.vault.lesen(t.pfad);
    await d.vault.schreiben(t.pfad, `${v.inhalt}\nNachtrag aus Obsidian\n`, { basisVersion: v.version });
    await d.app.inject({ method: 'POST', url: '/api/todos/schritte', headers: h, payload: { pfad: t.pfad, schritte: ['Probevortrag'] } });
    datei = (await d.vault.lesen(t.pfad)).inhalt;
    expect(datei).toContain('- [ ] Folien bauen\n- [ ] Probevortrag\n\nNachtrag aus Obsidian');
    r = await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr: 1, erledigt: true, text: 'Folien bauen' } });
    expect(r.json().schritte.map((s: { erledigt: boolean }) => s.erledigt)).toEqual([false, true, false]);
    // falscher Text zur Nummer → 409 statt falscher Schritt
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr: 0, erledigt: true, text: 'Folien bauen' } })).statusCode).toBe(409);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr: 9, erledigt: true } })).statusCode).toBe(404);
    r = await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr: 0, entfernen: true, text: 'Gliederung' } });
    expect(r.json().schritte.map((s: { text: string }) => s.text)).toEqual(['Folien bauen', 'Probevortrag']);
    expect(r.json().notiz).toContain('Thema: Regression');
    // anderer Ordner wird abgelehnt
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: 'Rathaus/memory.md', nr: 0, erledigt: true } })).statusCode).toBe(400);
    // gleichzeitig abhaken: beide Häkchen kommen an
    await Promise.all([0, 1].map((nr) => d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr, erledigt: true } })));
    expect((await d.todos.holen(t.pfad)).schritte?.every((s) => s.erledigt)).toBe(true);
  });

  it('wiederkehrendes To-do: Nachfolger beginnt mit offenen Schritten', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Wochenputz', wiederholen: 'wöchentlich', faellig: '2026-11-16', notiz: '- [ ] Bad\n- [ ] Küche' } })).json();
    await d.app.inject({ method: 'POST', url: '/api/todos/schritt', headers: h, payload: { pfad: t.pfad, nr: 0, erledigt: true } });
    const neu = (await d.todos.holen(t.pfad)).version;
    await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: neu, erledigt: true } });
    const nf = (await d.todos.liste()).find((x) => !x.erledigt && x.titel === 'Wochenputz')!;
    expect(nf.faellig).toBe('2026-11-23');
    expect(nf.schritte).toEqual([{ text: 'Bad', erledigt: false }, { text: 'Küche', erledigt: false }]);
  });

  it('KI zerlegen: nur Vorschlag (nichts geschrieben), Fremdes in der Hülle, verbucht; ohne Schlüssel 503', async () => {
    const m = modell(['1. Gliederung schreiben', '- Folien bauen', '', 'Probevortrag halten']);
    const d = await testDorf({ ki: () => m.klient });
    const h = await kopf(d);
    const t = await d.todos.anlegen({ titel: 'Referat vorbereiten' }, 'Postbote', { fremd: true });
    const vorher = (await d.vault.lesen(t.pfad)).inhalt;
    const r = await d.app.inject({ method: 'POST', url: '/api/todos/zerlegen', headers: h, payload: { pfad: t.pfad } });
    expect(r.json()).toEqual({ schritte: ['Gliederung schreiben', 'Folien bauen', 'Probevortrag halten'] });
    expect((await d.vault.lesen(t.pfad)).inhalt).toBe(vorher);
    const nachricht = JSON.stringify((m.anfragen[0]!.messages as unknown[])[0]);
    expect(nachricht).toContain('Referat vorbereiten');
    expect(nachricht).toMatch(/fremdinhalt/i);
    expect(m.anfragen[0]!.tools).toBeUndefined();
    expect((d.db.prepare("SELECT zusammenfassung FROM laeufe ORDER BY erstellt DESC LIMIT 1").get() as { zusammenfassung: string }).zusammenfassung).toBe('3 Schritte vorgeschlagen');
    const ohne = await testDorf();
    const h2 = await kopf(ohne);
    const t2 = await ohne.todos.anlegen({ titel: 'x' }, 'Leif');
    expect((await ohne.app.inject({ method: 'POST', url: '/api/todos/zerlegen', headers: h2, payload: { pfad: t2.pfad } })).statusCode).toBe(503);
  });
});
