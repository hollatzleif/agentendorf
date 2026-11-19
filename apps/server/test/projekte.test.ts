import { describe, expect, it } from 'vitest';
import type { TodoInfo } from '@dorf/shared';
import { projekteAus } from '@dorf/shared';
import { kopf } from './etappe7.test.js';

const t = (titel: string, o: Partial<TodoInfo> = {}): TodoInfo => ({ pfad: `Marktplatz/todos/${titel}.md`, version: 'v', titel, erledigt: false, ...o });

describe('Projekte (E161)', () => {
  it('Gruppen ab 3 To-dos oder 2 offenen; Fortschritt, nächster Schritt, Ruhe, Fokus', () => {
    const jetzt = Date.parse('2026-11-16T12:00:00Z');
    const p = projekteAus(
      [
        t('Gliederung', { gruppe: 'Bachelorarbeit', erledigt: true, erledigtAm: '2026-11-14T10:00:00Z', erstellt: '2026-11-01T10:00:00Z' }),
        t('Kapitel 1', { gruppe: 'Bachelorarbeit', faellig: '2026-11-20', erstellt: '2026-11-01T10:00:00Z', fokusMin: 50, schritte: [{ text: 'Quellen sammeln', erledigt: false }] }),
        t('Kapitel 2', { gruppe: 'Bachelorarbeit', erstellt: '2026-11-01T10:00:00Z' }),
        t('Kisten', { gruppe: 'Umzug', erstellt: '2026-11-01T10:00:00Z' }),
        t('Ummelden', { gruppe: 'Umzug', erstellt: '2026-11-02T10:00:00Z' }),
        t('Einzeln', { gruppe: 'Solo' }),
        t('Ohne Gruppe'),
      ],
      jetzt,
    );
    expect(p.map((x) => x.name)).toEqual(['Bachelorarbeit', 'Umzug']);
    expect(p[0]).toMatchObject({ gesamt: 3, erledigt: 1, offen: 2, dieseWoche: 1, fokusMin: 50, ruhtTage: 2, naechster: { titel: 'Kapitel 1', faellig: '2026-11-20', schritt: 'Quellen sammeln' } });
    expect(p[1]).toMatchObject({ offen: 2, ruhtTage: 14 });
  });
});

describe('Projekte im Wochenrückblick (E161)', () => {
  it('Zeile mit Fortschritt', async () => {
    const { testDorf } = await import('./hilfen.js');
    const d = await testDorf();
    for (const x of ['A', 'B', 'C']) await d.todos.anlegen({ titel: `Kapitel ${x}`, gruppe: 'Bachelorarbeit' }, 'Leif');
    const t = (await d.todos.liste())[0]!;
    await d.todos.aendern(t.pfad, { erledigt: true });
    const r = await d.wochenrueckblick.fakten();
    expect(r.abschnitte.find((x) => x.titel === 'Erledigt und offen')!.zeilen.join('\n')).toContain('📁 Projekte: Bachelorarbeit 1/3 (+1)');
  });
});

describe('Projekte in Telegram und Morgenzeitung (E163)', () => {
  it('/projekte mit Balken und 🍅-Knopf; Zeitung nennt ein ruhendes Projekt', async () => {
    const { testDorf } = await import('./hilfen.js');
    const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
    const api = { aufruf: async (m: string, p: Record<string, unknown> = {}) => (aufrufe.push({ m, p }), m === 'sendMessage' ? { message_id: 1 } : true), dateiLaden: async () => ({ daten: Buffer.alloc(0), name: 'x' }) };
    const d = await testDorf({ env: { TELEGRAM_CHAT_ID: '42', ORIGIN: 'https://dorf.test' }, telegram: api as never });
    for (const x of ['A', 'B', 'C']) await d.todos.anlegen({ titel: `Kapitel ${x}`, gruppe: 'Bachelorarbeit' }, 'Leif');
    await d.telegram!.verarbeiten({ update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/projekte' } });
    const p = aufrufe.filter((x) => x.m === 'sendMessage').at(-1)!.p;
    expect(String(p.text)).toContain('📁 <b>Bachelorarbeit</b> ▱▱▱▱▱▱▱▱ 0/3');
    expect((p.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]![0]!.callback_data).toMatch(/^jl:/);
    d.uhr.vor(9 * 86_400_000);
    const z = await d.morgenzeitung.fakten();
    expect(z.abschnitte.find((x) => x.titel === 'Heute')!.zeilen.join('\n')).toContain('💤 Bachelorarbeit ruht seit 9 Tagen – nächster Schritt: Kapitel A');
  });
});

describe('Review 8 (E166)', () => {
  it('Wartendes ist kein nächster Schritt; „ruht“ nur, wenn es sich lohnt; Fokus zählt als Bewegung; wiederkehrende zählen nicht', () => {
    const jetzt = Date.parse('2026-11-16T12:00:00Z');
    const alt = '2026-11-01T10:00:00Z';
    const p = projekteAus(
      [
        // nur Wartendes offen → kein nächster Schritt, kein „ruht“
        t('Kisten', { gruppe: 'Umzug', erstellt: alt, wartet: 'Vermieter', faellig: '2026-11-26' }),
        t('Vertrag', { gruppe: 'Umzug', erstellt: alt, erledigt: true, erledigtAm: alt }),
        t('Schlüssel', { gruppe: 'Umzug', erstellt: alt, erledigt: true, erledigtAm: alt }),
        // nächster Schritt erst in 3 Wochen fällig (Uni-Fristen) → kein „ruht“
        t('Übung 5', { gruppe: 'Analysis', erstellt: alt, faellig: '2026-12-07' }),
        t('Übung 6', { gruppe: 'Analysis', erstellt: alt, faellig: '2026-12-14' }),
        // Fokus gestern → bewegt
        t('Kapitel 2', { gruppe: 'BA', erstellt: alt, fokusZuletzt: '2026-11-15T18:00:00Z' }),
        t('Kapitel 3', { gruppe: 'BA', erstellt: alt }),
        // wiederkehrend → kein Projekt
        t('Sport', { gruppe: 'Fitness', wiederholen: 'täglich' }),
        t('Sport2', { gruppe: 'Fitness', wiederholen: 'täglich', erledigt: true }),
        t('Sport3', { gruppe: 'Fitness', wiederholen: 'täglich', erledigt: true }),
      ],
      jetzt,
    );
    const nach = Object.fromEntries(p.map((x) => [x.name, x]));
    expect(Object.keys(nach).sort()).toEqual(['Analysis', 'BA', 'Umzug']);
    expect(nach.Umzug!.naechster).toBeUndefined();
    expect(nach.Umzug!.ruhtMelden).toBe(false);
    expect(nach.Analysis!.ruhtTage).toBe(15);
    expect(nach.Analysis!.ruhtMelden).toBe(false);
    expect(nach.BA!.ruhtTage).toBe(0);
    expect(nach.BA!.ruhtMelden).toBe(false);
  });
});

describe('/api/projekte (E167)', () => {
  it('liefert die Auswertung', async () => {
    const { testDorf } = await import('./hilfen.js');
    const d = await testDorf();
    for (const x of ['A', 'B', 'C']) await d.todos.anlegen({ titel: `Kapitel ${x}`, gruppe: 'BA' }, 'Leif');
    const r = (await d.app.inject({ url: '/api/projekte', headers: await kopf(d) })).json();
    expect(r).toEqual([expect.objectContaining({ name: 'BA', gesamt: 3, offen: 3, naechster: expect.objectContaining({ titel: 'Kapitel A' }) })]);
  });
});

describe('Projekte im Plan (E172)', () => {
  it('Frist = spätestes offenes Datum; hinterher = offene Schritte vor heute (ohne Wartendes)', () => {
    const jetzt = Date.parse('2026-11-16T12:00:00Z');
    const [p] = projekteAus(
      [
        t('Referat – Etappe 1/3', { gruppe: 'Referat', faellig: '2026-11-14' }),
        t('Referat – Etappe 2/3', { gruppe: 'Referat', faellig: '2026-11-15' }),
        t('Referat – Etappe 3/3', { gruppe: 'Referat', faellig: '2026-11-17' }),
        t('Referat', { gruppe: 'Referat', faellig: '2026-11-20' }),
        t('Rückmeldung', { gruppe: 'Referat', wartet: 'Prof' }),
      ],
      jetzt,
    );
    expect(p).toMatchObject({ frist: '2026-11-20', hinterher: 2 });
  });
});

describe('Projekt hinterher in der Morgenzeitung (E174)', () => {
  it('nennt das Projekt mit den meisten überfälligen Schritten', async () => {
    const { testDorf } = await import('./hilfen.js');
    const d = await testDorf();
    await d.todos.anlegen({ titel: 'Referat – Etappe 1/3', gruppe: 'Referat', faellig: '2026-11-14' }, 'Leif');
    await d.todos.anlegen({ titel: 'Referat – Etappe 2/3', gruppe: 'Referat', faellig: '2026-11-15' }, 'Leif');
    await d.todos.anlegen({ titel: 'Referat', gruppe: 'Referat', faellig: '2026-11-20' }, 'Leif');
    const z = await d.morgenzeitung.fakten();
    expect(z.abschnitte.find((x) => x.titel === 'Heute')!.zeilen.join('\n')).toContain('⚠️ Referat: 2 Schritte hinterher (Frist 2026-11-20) – als Nächstes: Referat – Etappe 1/3');
  });
});

describe('/projekte mit Frist und hinterher (E175)', () => {
  it('zeigt 🏁 und ⚠️', async () => {
    const { testDorf } = await import('./hilfen.js');
    const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
    const api = { aufruf: async (m: string, p: Record<string, unknown> = {}) => (aufrufe.push({ m, p }), m === 'sendMessage' ? { message_id: 1 } : true), dateiLaden: async () => ({ daten: Buffer.alloc(0), name: 'x' }) };
    const d = await testDorf({ env: { TELEGRAM_CHAT_ID: '42', ORIGIN: 'https://dorf.test' }, telegram: api as never });
    await d.todos.anlegen({ titel: 'Etappe 1', gruppe: 'Referat', faellig: '2026-11-14' }, 'Leif');
    await d.todos.anlegen({ titel: 'Etappe 2', gruppe: 'Referat', faellig: '2026-11-17' }, 'Leif');
    await d.todos.anlegen({ titel: 'Abgabe', gruppe: 'Referat', faellig: '2026-11-20' }, 'Leif');
    await d.telegram!.verarbeiten({ update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/projekte' } });
    expect(String(aufrufe.filter((x) => x.m === 'sendMessage').at(-1)!.p.text)).toContain('0/3 · ⚠️ 1 hinterher · 🏁 2026-11-20');
  });
});

describe('hinterher nur vor der Frist (E176)', () => {
  it('nach der Abgabe (keine offene Frist mehr) mahnt nichts', () => {
    const jetzt = Date.parse('2026-11-16T12:00:00Z');
    const [p] = projekteAus(
      [
        t('Referat – Etappe 1/2', { gruppe: 'Referat', faellig: '2026-11-10' }),
        t('Referat – Etappe 2/2', { gruppe: 'Referat', faellig: '2026-11-11' }),
        t('Referat', { gruppe: 'Referat', faellig: '2026-11-12', erledigt: true }),
      ],
      jetzt,
    );
    expect(p!.hinterher).toBe(0);
  });
});
